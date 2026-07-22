// mailer.js
// Sends transactional email via Brevo's HTTP API (https://api.brevo.com/v3/smtp/email).
// Uses plain HTTPS (port 443) instead of SMTP (port 25/465/587), which avoids
// the outbound-SMTP-port block on Render's free tier entirely — no DNS/TLS/
// STARTTLS handshake, no IPv4-vs-IPv6 route issues, just a normal API POST.
const axios = require("axios");

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "team@osoitech.com";
const SENDER_NAME = process.env.BREVO_SENDER_NAME || "Allocate System";

if (!BREVO_API_KEY) {
  console.error(
    "[mailer] BREVO_API_KEY is not set — sendMail will fail until this is configured in .env / Render env vars.",
  );
}

// Error codes/statuses worth retrying — network blips and Brevo's own
// rate-limit response, not auth or bad-request errors (retrying those
// would just fail the same way twice).
const TRANSIENT_STATUS_CODES = [408, 429, 500, 502, 503, 504];
const TRANSIENT_ERROR_CODES = [
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENETUNREACH",
  "EAI_AGAIN",
];

async function sendMail({ to, subject, html }) {
  const MAX_ATTEMPTS = 2;
  let lastErr;

  const payload = {
    sender: { email: SENDER_EMAIL, name: SENDER_NAME },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(BREVO_API_URL, payload, {
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
      });

      console.log(
        `[mailer] Mail sent to ${to} — Brevo messageId: ${response.data?.messageId}`,
      );
      return response.data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const brevoMessage = err.response?.data?.message || err.message;

      console.error(
        `[mailer] sendMail attempt ${attempt}/${MAX_ATTEMPTS} failed for ${to}: ${brevoMessage} (status: ${status}, code: ${err.code})`,
      );

      const transient =
        TRANSIENT_STATUS_CODES.includes(status) ||
        TRANSIENT_ERROR_CODES.includes(err.code);

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

module.exports = { sendMail, buildResetLinkEmailHtml };
