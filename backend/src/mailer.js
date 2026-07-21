// mailer.js
//
// Shared email sender using Gmail SMTP via Nodemailer, sending from
// team@osoitech.com (an existing, working Google Workspace mailbox).
//
// Why Gmail SMTP instead of Resend: sending "as" a mailbox you already
// own and control needs no separate domain verification — Gmail already
// trusts its own mailbox. This was the fastest path to reliable delivery
// without needing DNS/domain access.
//
// Setup required (one-time):
//   1. Enable 2-Step Verification on the team@osoitech.com Google account.
//   2. Generate an App Password: myaccount.google.com/apppasswords
//   3. Add to .env:
//        GMAIL_USER=team@osoitech.com
//        GMAIL_APP_PASSWORD=<the 16-character app password>
//
// Gmail's free-tier sending limit is roughly 500 emails/day — plenty for
// transactional account/reset emails, not suitable for bulk marketing.
//
// npm install nodemailer

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  connectionTimeout: 10000, // max 10 sec to connect to Gmail SMTP
  greetingTimeout: 10000, // max 10 sec to receive SMTP greeting
  socketTimeout: 10000, // max 10 sec of socket inactivity
});

/**
 * Sends an email via the shared Gmail SMTP transporter.
 * Throws on failure — callers should wrap in their own try/catch if they
 * want to treat email failure as non-fatal (e.g. account already created).
 */
async function sendMail({ to, subject, html }) {
  return transporter.sendMail({
    from: `"Allocate System" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
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
         style="display:inline-block;padding:12px 24px;background:#2A2F8F;
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
