// mailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  family: 4, // force IPv4 — fixes ENETUNREACH on hosts without IPv6 egress
});

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
