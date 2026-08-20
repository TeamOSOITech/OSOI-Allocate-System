// user.service.js
//
// All the actual business logic + Supabase/DB work for user creation.
// Pulled out of user.routes.js (which used to hold routes, validation,
// AND Supabase calls all in one file) so routes only handle HTTP and
// the controller only handles req/res shaping.
//
// Flow implemented here:
//   1. Frontend sends a user (or list of users) with an auto-generated
//      placeholder password (see AddUser.tsx changes).
//   2. Backend checks for duplicates BY EMAIL ONLY (not role/password).
//   3. Backend creates the Supabase auth user with the placeholder password.
//   4. Backend mints a recovery link via Supabase Admin (generateLink) and
//      returns it directly in the API response — NO EMAIL IS SENT.
//      The admin/caller is expected to copy this link and share it with
//      the new user manually (WhatsApp, SMS, in person, etc.) so they can
//      set their own password. This avoids any dependency on an email
//      provider (Supabase's built-in mailer or Resend) entirely.
//
//   NOTE: We deliberately do NOT use supabaseAdmin.auth.resetPasswordForEmail()
//   here, since that method both mints AND sends the email through Supabase's
//   built-in mailer. generateLink() only mints the link — it never sends
//   anything — which is exactly what we want for this manual-share flow.
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   <-- service role key, backend only, NEVER expose to frontend
//   APP_URL                     <-- e.g. https://yourapp.com (or http://localhost:5173 in dev)

const { createClient } = require("@supabase/supabase-js");
const { sendMail, buildResetLinkEmailHtml } = require("../../mailer"); // adjust path if mailer.js lives elsewhere
const { PLAN_USER_LIMITS } = require("../billings/billing.service");
const { getPrimaryFrontendUrl } = require("../../config/frontendUrl");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeEmail(email) {
  return (email || "").toString().trim().toLowerCase();
}

// SECURITY FIX (Finding #09): "professional email only" was enforced ONLY
// in the frontend (adduser.tsx isProfessionalEmail) — anyone calling
// /api/users/add-user or /bulk-add-user directly (Postman, curl, a script)
// bypassed the rule entirely. Mirrors the same blocklist server-side so
// the rule actually holds regardless of caller.
const BLOCKED_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "rediffmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "msn.com",
];

function isProfessionalEmail(email) {
  const trimmed = normalizeEmail(email);
  const domain = trimmed.split("@")[1];
  return !!domain && !BLOCKED_EMAIL_DOMAINS.includes(domain);
}

// ---------------------------------------------------------------------------
// NEW: Tenant lock — a user can only add other users whose email domain
// matches their OWN email domain (e.g. an admin at "you@cms.com" can only
// create "*@cms.com" accounts). This stops one org's admin from
// accidentally (or deliberately) onboarding someone into the wrong tenant.
//
// We resolve the caller's own domain by looking up their row in
// user_master via Auth User Id (req.user.userId), rather than trusting
// anything from the request body.
// ---------------------------------------------------------------------------

function getDomain(email) {
  return normalizeEmail(email).split("@")[1] || null;
}

function sameDomain(email, domain) {
  if (!domain) return false;
  return normalizeEmail(email).split("@")[1] === domain;
}

// NEW: phone must be exactly 10 digits. Strips spaces/dashes/+91 etc.
// before checking, so "+91 98765-43210" and "9876543210" are both
// accepted as long as the core number is 10 digits — adjust the strip
// regex if you want to be stricter (e.g. reject +91 entirely).
function isValidPhone(phone) {
  if (!phone) return true; // phone is optional — only validate if provided
  const digitsOnly = phone
    .toString()
    .replace(/[\s\-()]/g, "")
    .replace(/^\+?91/, "");
  return /^\d{10}$/.test(digitsOnly);
}

// ---------------------------------------------------------------------------
// FIX: Reporting Manager must EITHER be a real existing user's email
// (same org, from user_master), OR a name/email that was added via the
// "+" control on Add User — which is persisted to the `reporting_managers`
// table (see optionsRoutes.js -> POST /api/options).
//
// Previously this ONLY checked user_master, so anything added through the
// "+" control (which the dropdown happily showed, and which WAS saved to
// the DB) would still fail validation at submit time with "Reporting
// manager ... was not found in your organization" — even though it really
// was in the database, just in a different table. Now we check both,
// user_master first (real users), then fall back to reporting_managers
// (curated/manually-added names) if not found there.
// ---------------------------------------------------------------------------
async function validateReportingManager(email, organizationId) {
  if (!email) return { valid: true }; // optional field

  const normalized = normalizeEmail(email);

  // 1. Check real users first.
  const { data: userMatch, error: userErr } = await supabaseAdmin
    .from("user_master")
    .select("Email")
    .eq("Email", normalized)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (userErr) {
    console.error(
      "validateReportingManager user_master lookup failed:",
      userErr,
    );
    return { valid: false, message: "Could not verify reporting manager." };
  }

  if (userMatch) return { valid: true };

  // 2. Fall back to manually-added reporting managers (the "+" control on
  // Add User writes here). Matched case-insensitively against `name`,
  // since that table stores whatever raw value was typed in.
  const { data: customMatch, error: customErr } = await supabaseAdmin
    .from("reporting_managers")
    .select("name")
    .ilike("name", normalized)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (customErr) {
    console.error(
      "validateReportingManager reporting_managers lookup failed:",
      customErr,
    );
    return { valid: false, message: "Could not verify reporting manager." };
  }

  if (!customMatch) {
    return {
      valid: false,
      message: `Reporting manager "${email}" was not found in your organization.`,
    };
  }

  return { valid: true };
}

/**
 * How many users this organization's plan is allowed to have — based on
 * their active row in `subscriptions` (joined to `plans` for the name).
 * Orgs with no active subscription row (the free /register-organization
 * signup path, or a lapsed subscription) fall back to the Free limit.
 */
async function getOrgUserLimit(organizationId) {
  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("status, plans ( name )")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("current_period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getOrgUserLimit: subscription lookup failed:", error);
  }

  const planName = (sub?.plans?.name || "free").toString().toLowerCase();
  return PLAN_USER_LIMITS[planName] ?? PLAN_USER_LIMITS.free;
}

/**
 * Current user count for this organization — one row per email in
 * user_master, so this is a straight per-email count.
 */
async function getOrgUserCount(organizationId) {
  const { count, error } = await supabaseAdmin
    .from("user_master")
    .select("Email", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (error) throw error;
  return count || 0;
}

/**
 * Checks whether a user with this email already exists in Supabase Auth.
 * Uses the admin listUsers endpoint filtered by email.
 */
async function emailExists(email) {
  // listUsers doesn't support filtering by email server-side in all
  // supabase-js versions, so we page through everyone and compare.
  // For large user bases, consider querying your own `users`/`profiles`
  // table (if you mirror auth users there) with a `WHERE email = ...`
  // instead — it'll be far cheaper than paging through Supabase Auth.
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const match = data.users.find((u) => normalizeEmail(u.email) === email);
    if (match) return true;

    if (data.users.length < perPage) break; // last page reached
    page += 1;
  }

  return false;
}

/**
 * Creates the Supabase auth user with the placeholder password, then mints
 * a recovery link via Supabase Admin. The link is returned to the caller —
 * NOTHING IS EMAILED. The admin UI is expected to display this link so it
 * can be copied and shared with the new user manually.
 */
async function createUserAndGenerateResetLink({
  email,
  tempPassword,
  metadata,
  organizationId,
}) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true, // skip the normal signup-confirmation email
    user_metadata: metadata,
  });
  if (error) throw error;

  // ---------------------------------------------------------------------
  // Insert the matching row into user_master.
  //
  // The login/forgotPassword code (authService.js) does NOT check Supabase
  // Auth directly — it looks the user up in this custom table first, by
  // "Email" (the real/contact email), then uses "Login Email" for the
  // actual supabase.auth call and "Auth User Id" / "Role" for the session.
  // Without this row, a user can exist in Supabase Auth (so createUser
  // succeeds) but be completely invisible to login/forgot-password.
  //
  // "Login Email" and "Email" are set to the same address here — this
  // system supports multiple role-accounts under one real email with
  // *different* login emails, but this flow only ever creates one
  // Supabase Auth user per call, so they're the same value for now.
  // ---------------------------------------------------------------------
  let userMasterInserted = true;
  let userMasterError = null;

  try {
    const { error: insertError } = await supabaseAdmin
      .from("user_master")
      .insert({
        "First Name": metadata?.firstName || null,
        "Last Name": metadata?.lastName || null,
        "Employee ID": metadata?.employeeId || null,
        Department: metadata?.department || null,
        "Date of Birth": metadata?.dob || null,
        "Date of Joining": metadata?.doj || null,
        "Reporting Manager": metadata?.reportingManager || null,
        "Worked In Teams": metadata?.workedInTeams || null,
        Designation: metadata?.designation || null,
        Email: email,
        "Login Email": email,
        Role: metadata?.role || null,
        "Auth User Id": data.user.id,
        organization_id: organizationId,
      });
    if (insertError) throw insertError;
  } catch (err) {
    userMasterInserted = false;
    userMasterError = err?.message || JSON.stringify(err);
    // This is a real problem even though createUser already succeeded —
    // the user won't be able to log in or reset their password until this
    // row exists, so log it loudly.
    console.error(`user_master insert FAILED for ${email}. Raw error:`, err);
  }

  // Account creation succeeded at this point — don't let a failed link
  // generation turn this into a hard failure. Report it separately instead.
  let resetLinkGenerated = true;
  let resetLinkError = null;
  let resetLink = null;

  try {
    // generateLink only MINTS the recovery link — it does NOT send anything.
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo: `${getPrimaryFrontendUrl()}/reset-password`,
        },
      });
    if (linkError) throw linkError;

    resetLink = linkData?.properties?.action_link;
    if (!resetLink) {
      throw new Error("Supabase did not return an action_link.");
    }
  } catch (err) {
    resetLinkGenerated = false;
    resetLinkError =
      err?.message ||
      err?.error_description ||
      err?.msg ||
      err?.error ||
      (typeof err === "string" ? err : JSON.stringify(err)) ||
      "Unknown error generating reset link.";
    // Log the FULL raw error server-side, not just the extracted message.
    console.error(`Reset link generation failed for ${email}. Raw error:`, err);
  }

  // Email the link via Gmail SMTP (see mailer.js). Only attempted if the
  // link was actually generated. A failure here doesn't undo the account
  // or the link — it's reported separately so the caller can still copy
  // the link and share it manually as a fallback.
  let resetEmailSent = false;
  let resetEmailError = null;

  if (resetLinkGenerated && resetLink) {
    try {
      await sendMail({
        to: email,
        subject: "Welcome — set up your account",
        html: buildResetLinkEmailHtml({
          heading: "Welcome!",
          bodyText:
            "Your account has been created. Click below to set your own password and finish setting up your account.",
          actionLink: resetLink,
          buttonText: "Create Password",
        }),
      });
      resetEmailSent = true;
    } catch (err) {
      resetEmailError = err?.message || JSON.stringify(err);
      console.error(`Reset email FAILED to send for ${email}. Raw error:`, err);
    }
  }

  return {
    user: data.user,
    resetLink,
    resetLinkGenerated,
    resetLinkError,
    resetEmailSent,
    resetEmailError,
    userMasterInserted,
    userMasterError,
  };
}

function generateFallbackPassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";
  let pass = "";
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

module.exports = {
  supabaseAdmin,
  normalizeEmail,
  isProfessionalEmail,
  getDomain,
  sameDomain,
  isValidPhone,
  validateReportingManager,
  getOrgUserLimit,
  getOrgUserCount,
  emailExists,
  createUserAndGenerateResetLink,
  generateFallbackPassword,
};
