// Manual check that the Brevo mailer works.
//   node src/scripts/test-mail.js you@example.com
require("dotenv").config();
const { sendMail, buildResetLinkEmailHtml } = require("../mailer");

async function run() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: node src/scripts/test-mail.js <recipient-email>");
    process.exit(1);
  }

  try {
    const html = buildResetLinkEmailHtml({
      heading: "Test Email",
      bodyText: "This is a test email to verify the mailer configuration.",
      actionLink: "https://example.com/reset",
      buttonText: "Reset Password",
    });

    const info = await sendMail({ to, subject: "Mailer test", html });
    console.log("Mail sent:", info.messageId);
  } catch (err) {
    console.error("Mail failed:", err.message, "(code:", err.code, ")");
    process.exitCode = 1;
  }
}

run();
