// mailer.js
const nodemailer = require("nodemailer");
const dns = require("dns");
const dnsPromises = dns.promises;

// `family: 4` and `dns.setDefaultResultOrder("ipv4first")` are NOT reliable
// guarantees — in testing, nodemailer 9.0.3 still resolved and connected to
// smtp.gmail.com over IPv6 in some environments even with both of these set
// (ipv4first only reorders results if both A/AAAA come back; it doesn't
// force IPv4, and `family` isn't consistently honored by every code path in
// the SMTP connection module). On hosts with broken/unreachable IPv6 egress
// (e.g. some Render instances), that unreliability is exactly what produces
// ENETUNREACH.
//
// The bulletproof fix: resolve the IPv4 address ourselves with
// dns.promises.resolve4() and connect directly to that literal IP, bypassing
// nodemailer's/Node's own family negotiation entirely. We still set
// tls.servername so the TLS certificate check validates against the real
// hostname (smtp.gmail.com) even though we're connecting to a bare IP.
dns.setDefaultResultOrder("ipv4first"); // harmless to keep as a first line of defense

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;

let cachedIp = null;
let cachedAt = 0;
const IP_CACHE_MS = 5 * 60 * 1000; // re-resolve every 5 min in case Google rotates IPs

async function resolveSmtpIpv4() {
  const now = Date.now();
  if (cachedIp && now - cachedAt < IP_CACHE_MS) return cachedIp;

  try {
    const addresses = await dnsPromises.resolve4(SMTP_HOST);
    if (!addresses.length) throw new Error("resolve4 returned no addresses");
    cachedIp = addresses[0];
    cachedAt = now;
    console.log(`[mailer] Resolved ${SMTP_HOST} -> ${cachedIp} (IPv4, forced)`);
    return cachedIp;
  } catch (err) {
    console.error(
      `[mailer] dns.resolve4 failed for ${SMTP_HOST}:`,
      err.message,
    );
    // Fall back to the hostname itself — worse than a forced IP, but better
    // than throwing here and killing startup; sendMail will still surface
    // any resulting connection error normally.
    cachedIp = null;
    throw err;
  }
}

async function buildTransporter() {
  const ip = await resolveSmtpIpv4().catch(() => null);

  return nodemailer.createTransport({
    host: ip || SMTP_HOST, // literal IPv4 if we got one, hostname as fallback
    port: SMTP_PORT,
    secure: false, // false for port 587 — uses STARTTLS instead of direct SSL
    requireTLS: true, // explicitly require STARTTLS to upgrade the connection
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
    family: 4, // kept as defense-in-depth even though host is now a literal IP
    tls: {
      // Required when connecting to a bare IP: without this, the TLS
      // handshake validates the cert against the IP string and fails.
      // Setting servername forces SNI + cert validation against the real
      // hostname instead.
      servername: SMTP_HOST,
    },
    // Surface full SMTP conversation logs in Render's log stream so if this
    // still fails we can see exactly where it's hanging (DNS, TCP connect,
    // TLS handshake, or AUTH) instead of just an opaque error code.
    logger: true,
    debug: true,
  });
}

// Transporter is built lazily (needs an async DNS resolve first) and cached.
let transporterPromise = null;
function getTransporter() {
  if (!transporterPromise) transporterPromise = buildTransporter();
  return transporterPromise;
}

// Verify the connection once at startup so a broken SMTP path shows up
// immediately in Render's logs instead of only surfacing when the first
// user happens to trigger a reset email.
const smtpReadyPromise = getTransporter()
  .then((t) => t.verify())
  .then(() => {
    console.log("[mailer] SMTP verify OK — ready to send.");
  })
  .catch((err) => {
    console.error("[mailer] SMTP verify FAILED:", err.message);
    // Don't rethrow — a bad verify at boot shouldn't crash the process.
    // sendMail() below will still attempt to send and surface errors
    // per-request, with retry for transient network codes.
  });

// Error codes worth retrying — anything that indicates a transient
// network/connection problem rather than a config or auth failure.
// ENETUNREACH/EHOSTUNREACH are included because that's the exact error
// this app hit in production (IPv6 route unavailable on the host);
// nodemailer sometimes preserves the raw OS code and sometimes wraps it
// as ECONNECTION depending on where in the connection lifecycle the
// failure occurs, so both forms are covered here.
const TRANSIENT_CODES = [
  "ETIMEDOUT",
  "ECONNECTION",
  "ESOCKET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNRESET",
  "EAI_AGAIN",
];

async function sendMail({ to, subject, html }) {
  const MAX_ATTEMPTS = 2;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const transporter = await getTransporter();
      return await transporter.sendMail({
        from: `"Allocate System" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html,
      });
    } catch (err) {
      lastErr = err;
      console.error(
        `[mailer] sendMail attempt ${attempt}/${MAX_ATTEMPTS} failed for ${to}: ${err.message} (code: ${err.code})`,
      );

      // If the cached IP itself is the problem (e.g. Google rotated it or
      // it started dropping traffic), force a fresh resolve on the next
      // attempt instead of retrying against the same bad IP.
      if (["ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(err.code)) {
        cachedIp = null;
        transporterPromise = null;
      }

      const transient = TRANSIENT_CODES.includes(err.code);
      if (!transient || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  throw lastErr;
}

function buildResetLinkEmailHtml({
  heading,
  bodyText,
  actionLink,
  buttonText,
}) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
      <h2>${heading}</h2>
      <p>${bodyText}</p>
      <a href="${actionLink}"
         style="display:inline-block;padding:12px 24px;background:#204297;
                color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">
        ${buttonText}
      </a>
      <p style="color:#888;font-size:12px;margin-top:24px;">
        If you didn't expect this email, you can ignore it.
      </p>
    </div>
  `;
}

module.exports = { sendMail, buildResetLinkEmailHtml, smtpReadyPromise };
