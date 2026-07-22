// src/test-mail.js
require("dotenv").config();
const { sendMail, buildResetLinkEmailHtml } = require("./mailer");

async function run() {
  try {
    const html = buildResetLinkEmailHtml({
      heading: "Test Email",
      bodyText:
        "Ye ek test email hai mailer.js ke naye fix ko check karne ke liye.",
      actionLink: "https://example.com/reset",
      buttonText: "Reset Password",
    });

    const info = await sendMail({
      to: "apna-email@example.com", // yaha apna real email daalo
      subject: "Test — mailer.js fix check",
      html,
    });

    console.log("✅ Mail sent successfully:", info.messageId);
  } catch (err) {
    console.error("❌ Mail failed:", err.message, "(code:", err.code, ")");
  } finally {
    process.exit(0);
  }
}

run();
