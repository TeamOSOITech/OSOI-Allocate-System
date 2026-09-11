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
const { canAssignRole } = require("../../config/permissions");

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
 * PERFORMANCE FIX (bulk upload was extremely slow): emailExists() above
 * pages through EVERY Supabase Auth user (1000 per page) just to check
 * ONE email. bulkAddUser() in user.controller.js used to call
 * emailExists() separately FOR EACH ROW of the uploaded file — so a
 * 50-row file on a platform with a few thousand auth users meant
 * re-scanning the entire user list 50 times over.
 *
 * Fix: page through the list ONCE here, return every email as a Set,
 * and have bulkAddUser() call this a single time before its loop, then
 * do an O(1) `.has()` check per row instead of a fresh network scan.
 */
async function fetchAllAuthEmails() {
  const perPage = 1000;
  let page = 1;
  const emails = new Set();

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    for (const u of data.users) {
      emails.add(normalizeEmail(u.email));
    }

    if (data.users.length < perPage) break; // last page reached
    page += 1;
  }

  return emails;
}

/**
 * PERFORMANCE FIX: same N+1 problem as emailExists() above, but for
 * reporting-manager validation — validateReportingManager() runs 2 DB
 * queries per call, and bulkAddUser() used to call it once per row.
 *
 * Fetches every valid reporting-manager candidate for the organization
 * (real users from user_master + manually-added names from
 * reporting_managers) in 2 queries TOTAL, not 2 queries per row.
 * validateReportingManagerAgainst() below then checks a row's value
 * against these in-memory sets — no DB call per row at all.
 */
async function fetchOrgReportingManagerCandidates(organizationId) {
  const [userRes, customRes] = await Promise.all([
    supabaseAdmin
      .from("user_master")
      .select("Email")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("reporting_managers")
      .select("name")
      .eq("organization_id", organizationId),
  ]);

  if (userRes.error) {
    console.error(
      "fetchOrgReportingManagerCandidates: user_master lookup failed:",
      userRes.error,
    );
  }
  if (customRes.error) {
    console.error(
      "fetchOrgReportingManagerCandidates: reporting_managers lookup failed:",
      customRes.error,
    );
  }

  const emailSet = new Set(
    (userRes.data || []).map((r) => normalizeEmail(r.Email)).filter(Boolean),
  );
  const nameSet = new Set(
    (customRes.data || []).map((r) => normalizeEmail(r.name)).filter(Boolean),
  );

  return { emailSet, nameSet };
}

// Sync counterpart of validateReportingManager() — checks a value
// against the pre-fetched candidate sets instead of hitting the DB.
// Same matching rules: real user email first, then the manually-added
// reporting_managers list (case-insensitive, since that's how the "+"
// control on Add User stores whatever was typed).
function validateReportingManagerAgainst(email, { emailSet, nameSet }) {
  if (!email) return { valid: true }; // optional field

  const normalized = normalizeEmail(email);
  if (emailSet.has(normalized) || nameSet.has(normalized)) {
    return { valid: true };
  }

  return {
    valid: false,
    message: `Reporting manager "${email}" was not found in your organization.`,
  };
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

/**
 * Looks up a user's own Email + Role from user_master by their Auth User
 * Id. Used by approvals.controller.js's applyApprovedAction() (USER_CREATE
 * case) to reconstruct the original requester's identity — the gate only
 * has req.user available at REQUEST time, but by APPROVAL time all we're
 * handed back is the stored `requested_by` (an Auth User Id) — so
 * processAddUserRequest() below still gets a real role + email to run its
 * checks against, instead of those checks silently no-op'ing.
 */
async function getRequesterContext(authUserId, organizationId) {
  const { data, error } = await supabaseAdmin
    .from("user_master")
    .select('"Email", "Role"')
    .eq("Auth User Id", authUserId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return { email: data["Email"], role: data["Role"] };
}

/**
 * Core add-user (single) validation + creation — every check and the
 * actual account creation that used to live inline in user.controller.js's
 * addUser(). Pulled out so it can run from TWO call sites with identical
 * behaviour:
 *   1. user.controller.js addUser() — the immediate path, for callers NOT
 *      gated by APPROVAL_RULES.USER_CREATE (Ops Manager, Super Admin).
 *   2. approvals.controller.js applyApprovedAction()'s USER_CREATE case —
 *      re-runs this SAME function once an Ops Manager approves a Process
 *      Lead's pending request. This matters: a request can sit PENDING
 *      for a while, during which the seat limit could fill up, or the
 *      requested email could get taken by something else — re-checking
 *      at approval time (rather than trusting whatever passed at request
 *      time) means those cases are still caught instead of silently
 *      creating a bad/duplicate account.
 *
 * @param {object} body - same shape as the add-user request body.
 * @param {object} requester - { role, email, organizationId } of whoever
 *   is ultimately responsible for this create (the original Process Lead
 *   requester when called from applyApprovedAction — NOT the Ops Manager
 *   who approved it — so role/domain checks stay anchored to who actually
 *   asked for this account, matching what would have happened had it not
 *   been gated).
 * @returns {{statusCode: number, body: object}} - always resolves (never
 *   throws for expected validation failures); caller decides whether to
 *   forward this straight to res.json() (addUser) or just log it
 *   (applyApprovedAction, matching the HIDE_TASK pattern of logging
 *   failures rather than throwing out of an approval decision).
 */
async function processAddUserRequest(body, requester) {
  body = body || {};
  const {
    role: requesterRole,
    email: requesterEmail,
    organizationId,
  } = requester || {};

  const email = normalizeEmail(body.email);

  if (!body.fullName || !email || !body.role) {
    return {
      statusCode: 400,
      body: { message: "Full name, email and role are required." },
    };
  }

  if (!isProfessionalEmail(email)) {
    return {
      statusCode: 400,
      body: {
        message:
          "Email must be a company domain (Gmail, Yahoo, Outlook etc. are not allowed).",
      },
    };
  }

  const creatorDomain = getDomain(requesterEmail);
  if (!sameDomain(email, creatorDomain)) {
    return {
      statusCode: 400,
      body: {
        message: creatorDomain
          ? `You can only add users with an @${creatorDomain} email address.`
          : "Could not verify your organization's domain. Contact support.",
      },
    };
  }

  const requestedRole = String(body.role)
    .toUpperCase()
    .trim()
    .replace(/[\s\-]+/g, "_");
  if (!canAssignRole(requesterRole, requestedRole)) {
    return {
      statusCode: 403,
      body: {
        message: `Your role (${requesterRole}) is not allowed to create a user with role ${requestedRole}.`,
      },
    };
  }

  if (body.phone && !isValidPhone(body.phone)) {
    return {
      statusCode: 400,
      body: { message: "Phone number must be exactly 10 digits." },
    };
  }

  if (body.reportingManager) {
    const rmCheck = await validateReportingManager(
      body.reportingManager,
      organizationId,
    );
    if (!rmCheck.valid) {
      return { statusCode: 400, body: { message: rmCheck.message } };
    }
  }

  const alreadyExists = await emailExists(email);
  if (alreadyExists) {
    return {
      statusCode: 409,
      body: { message: `A user with email ${email} already exists.` },
    };
  }

  const [limit, currentCount] = await Promise.all([
    getOrgUserLimit(organizationId),
    getOrgUserCount(organizationId),
  ]);
  if (currentCount >= limit) {
    return {
      statusCode: 403,
      body: {
        message: `Your plan allows up to ${limit} users and you've reached that limit. Upgrade your subscription to add more users.`,
      },
    };
  }

  const tempPassword = body.password || generateFallbackPassword();

  const {
    user,
    resetLink,
    resetLinkGenerated,
    resetLinkError,
    resetEmailSent,
    resetEmailError,
    userMasterInserted,
    userMasterError,
  } = await createUserAndGenerateResetLink({
    email,
    tempPassword,
    organizationId,
    metadata: {
      fullName: body.fullName,
      firstName: body.firstName,
      lastName: body.lastName,
      employeeId: body.employeeId,
      designation: body.designation,
      department: body.department,
      dob: body.dob,
      doj: body.doj,
      reportingManager: body.reportingManager,
      workedInTeams: body.Teams,
      role: requestedRole,
    },
  });

  return {
    statusCode: 201,
    body: {
      message: !userMasterInserted
        ? `User created in Auth, but user_master insert failed (${userMasterError}) — this user CANNOT log in until this is fixed.`
        : resetEmailSent
          ? "User created, reset link emailed."
          : "User created, but the reset email could not be sent — copy resetLink and share it manually.",
      user,
      resetLink,
      resetLinkGenerated,
      resetLinkError,
      resetEmailSent,
      resetEmailError,
      userMasterInserted,
      userMasterError,
    },
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
  fetchAllAuthEmails,
  fetchOrgReportingManagerCandidates,
  validateReportingManagerAgainst,
  createUserAndGenerateResetLink,
  generateFallbackPassword,
  getRequesterContext,
  processAddUserRequest,
};
