const supabase = require("../../config/supabaseClient");
const { sendMail, buildResetLinkEmailHtml } = require("../../mailer"); // adjust path if mailer.js lives elsewhere
const { getPrimaryFrontendUrl } = require("../../config/frontendUrl");

const login = async (email, password) => {
  const { data: candidates, error: candidatesError } = await supabase
    .from("user_master")
    .select("*")
    .eq("Email", email);

  if (candidatesError || !candidates || candidates.length === 0) {
    console.error("NO CANDIDATES FOUND:", candidatesError);
    throw new Error("Invalid email or password");
  }

  console.log(`Found ${candidates.length} account(s) for this email`);

  let authData = null;
  let matchedUser = null;

  for (const candidate of candidates) {
    const loginEmail = candidate["Login Email"];

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    console.log("Supabase Error:", error);

    if (!error && data?.session) {
      authData = data;
      matchedUser = candidate;
      break;
    }
  }

  if (!authData || !matchedUser) {
    console.error("NO MATCHING ROLE ACCOUNT FOR PASSWORD");
    throw new Error("Invalid email or password");
  }

  const rawRole = matchedUser["Role"];

  if (!rawRole) {
    console.error("ROLE MISSING for user:", matchedUser["Auth User Id"]);
    throw new Error(
      "No role assigned to this account. Contact an administrator.",
    );
  }

  // FIX: roles are now stored/checked as SNAKE_CASE codes (TEAM_MEMBER,
  // VERTICAL_HEAD, PROCESS_LEAD, OPS_MANAGER, AUDIT_MANAGER, SUPER_ADMIN)
  // per src/config/permissions.js. If user_master.Role still has spaces
  // ("Team Member"), .toUpperCase() alone would produce "TEAM MEMBER",
  // which would NOT match any permission — so we also collapse spaces.
  const normalizedRole = String(rawRole)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  console.log(
    "Login successful for user:",
    matchedUser["Auth User Id"],
    "role:",
    normalizedRole,
  );

  return {
    accessToken: authData.session.access_token,
    refreshToken: authData.session.refresh_token,

    user: {
      id: authData.user.id,
      email: matchedUser["Email"],
      role: normalizedRole,
      organizationId: matchedUser["organization_id"],
      firstName: matchedUser["First Name"],
      lastName: matchedUser["Last Name"],
      department: matchedUser["Department"],
      designation: matchedUser["Designation"],
    },
  };
};

// UPDATED: Forgot password — generates a reset link for every role-account
// registered under this real email, then EMAILS each link via Gmail SMTP
// (see mailer.js) rather than sending it through Supabase's own mailer.
//
// IMPORTANT: link generation + emailing now happens in the BACKGROUND,
// after the HTTP response has already been sent. This keeps the request
// fast even if Gmail SMTP is slow to respond, instead of the caller
// waiting on every email to actually be delivered before getting a reply.
const forgotPassword = async (email) => {
  console.log("==================================");
  console.log("Forgot password request for:", email);

  const { data: rows, error } = await supabase
    .from("user_master")
    .select('"Login Email", "Role"')
    .eq("Email", email);

  if (error) {
    console.error("FORGOT PASSWORD LOOKUP ERROR:", error);
    throw new Error(error.message);
  }

  // Always respond the same way whether or not the email exists —
  // this prevents leaking which emails have accounts to an attacker.
  if (!rows || rows.length === 0) {
    console.log(
      "No accounts found for this email (not revealing this to caller).",
    );
    return { message: "If an account exists, a reset link has been sent." };
  }

  // Fire off link generation + email sending in the background.
  // Deliberately NOT awaited here — the function returns to the caller
  // immediately below, and this loop keeps running after the response
  // has already gone out.
  (async () => {
    for (const row of rows) {
      const loginEmail = row["Login Email"];
      if (!loginEmail) continue;

      try {
        const { data: linkData, error: linkError } =
          await supabase.auth.admin.generateLink({
            type: "recovery",
            email: loginEmail,
            options: {
              redirectTo: `${getPrimaryFrontendUrl()}/reset-password`,
            },
          });

        if (linkError) throw linkError;

        const actionLink = linkData?.properties?.action_link;
        if (!actionLink) throw new Error("No action_link returned.");

        await sendMail({
          to: email, // send to the real/contact email, not the internal Login Email
          subject: "Password reset request",
          html: buildResetLinkEmailHtml({
            heading: "Reset your password",
            bodyText: `We received a request to reset the password for your ${row["Role"]} account. Click below to set a new password.`,
            actionLink,
            buttonText: "Reset Password",
          }),
        });

        console.log(`Reset email sent for role ${row["Role"]} -> ${email}`);
      } catch (err) {
        console.error(`RESET LINK/EMAIL FAILED for ${loginEmail}:`, err);
      }
    }
  })();

  return { message: "If an account exists, a reset link has been sent." };
};

// Called by POST /api/auth/refresh. Runs server-side using the
// refreshToken httpOnly cookie (the frontend can no longer read this
// value directly, so it can't call supabase.auth.refreshSession()
// itself anymore — that logic moves here).
const refreshSession = async (refreshToken) => {
  if (!refreshToken) {
    throw new Error("No refresh token provided.");
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data?.session) {
    throw new Error(error?.message || "Session refresh failed.");
  }

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
};

module.exports = {
  login,
  forgotPassword,
  refreshSession,
};
