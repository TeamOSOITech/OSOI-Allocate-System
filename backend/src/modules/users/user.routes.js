// userRoutes.js
//
// Express router for user creation, wired to Supabase Auth.
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

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { sendMail, buildResetLinkEmailHtml } = require("../../mailer"); // adjust path if mailer.js lives elsewhere
const { authenticate } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");
const { canAssignRole } = require("../../config/permissions");
const { PLAN_USER_LIMITS } = require("../billings/billing.service");
const { getPrimaryFrontendUrl } = require("../../config/ABC");

const router = express.Router();

// FIX: this entire router previously had ZERO authentication — anyone
// could create user accounts (with a Supabase auth login!) by hitting
// these endpoints directly, no token needed.
router.use(authenticate);

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

// NEW: Reporting Manager must be a real, existing user's email — and
// that user must belong to the SAME organization as the person being
// added. Prevents typos (silently storing a manager that doesn't exist)
// and cross-tenant leakage (pointing at someone else's org).
// NEW: Reporting Manager must EITHER be a real existing user's email
// (same org, from user_master), OR a name/email added via the "+"
// control on Add User — which lives in the `reporting_managers` table
// (see optionsRoutes.js POST /api/options). Checks user_master first
// (real users), falls back to reporting_managers (curated/manually-added
// names) if not found there.
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
  // Add User writes here). Matched case-insensitively against `name`.
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

// ---------------------------------------------------------------------------
// POST /api/users/add-user  (single user)
// ---------------------------------------------------------------------------

router.post(
  "/add-user",
  requirePermission("users.onboard"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const email = normalizeEmail(body.email);

      if (!body.fullName || !email || !body.role) {
        return res
          .status(400)
          .json({ message: "Full name, email and role are required." });
      }

      // SECURITY FIX (Finding #09): this rule previously only lived in
      // the frontend form — enforce it here too so a direct API call
      // can't bypass it.
      if (!isProfessionalEmail(email)) {
        return res.status(400).json({
          message:
            "Email must be a company domain (Gmail, Yahoo, Outlook etc. are not allowed).",
        });
      }

      // NEW: tenant lock — new user's email domain must match the
      // requesting admin's own domain (same organization). Prevents an
      // admin at "you@cms.com" from onboarding "someone@otherco.com".
      // req.user.email comes straight from Supabase Auth (authenticate
      // middleware) — no extra DB lookup needed.
      const creatorDomain = getDomain(req.user.email);
      if (!sameDomain(email, creatorDomain)) {
        return res.status(400).json({
          message: creatorDomain
            ? `You can only add users with an @${creatorDomain} email address.`
            : "Could not verify your organization's domain. Contact support.",
        });
      }

      // SECURITY: never trust body.role blindly — check it against what
      // THIS caller's role is allowed to hand out. See ASSIGNABLE_ROLES
      // in config/permissions.js. Without this, any role holding
      // "users.onboard" could set role: "SUPER_ADMIN" and self-escalate.
      const requestedRole = String(body.role).toUpperCase().trim();
      if (!canAssignRole(req.user.role, requestedRole)) {
        return res.status(403).json({
          message: `Your role (${req.user.role}) is not allowed to create a user with role ${requestedRole}.`,
        });
      }

      // NEW: phone must be 10 digits, if provided.
      if (body.phone && !isValidPhone(body.phone)) {
        return res.status(400).json({
          message: "Phone number must be exactly 10 digits.",
        });
      }

      // NEW: reporting manager, if provided, must be a real user in the
      // same organization.
      if (body.reportingManager) {
        const rmCheck = await validateReportingManager(
          body.reportingManager,
          req.user.organizationId,
        );
        if (!rmCheck.valid) {
          return res.status(400).json({ message: rmCheck.message });
        }
      }

      const alreadyExists = await emailExists(email);
      if (alreadyExists) {
        return res
          .status(409)
          .json({ message: `A user with email ${email} already exists.` });
      }

      // Plan seat limit — count is by email in user_master for this org.
      const [limit, currentCount] = await Promise.all([
        getOrgUserLimit(req.user.organizationId),
        getOrgUserCount(req.user.organizationId),
      ]);
      if (currentCount >= limit) {
        return res.status(403).json({
          message: `Your plan allows up to ${limit} users and you've reached that limit. Upgrade your subscription to add more users.`,
        });
      }

      // Password is optional from the frontend now — if somehow missing,
      // generate one here too as a safety net.
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
        organizationId: req.user.organizationId,
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
          // FIX (Finding #06): frontend (adduser.tsx) sends this field as
          // "Teams" (capital T), not "workedInTeams" — the old key was
          // never sent by the client, so every newly created user got
          // "Worked In Teams": null despite it being a required field.
          // The edit path already read the right key; this was the
          // unfixed create-path instance of the same mismatch.
          workedInTeams: body.Teams,
          role: requestedRole,
        },
      });

      return res.status(201).json({
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
      });
    } catch (err) {
      console.error("add-user error:", err);
      return res
        .status(500)
        .json({ message: err.message || "Failed to create user." });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/users/bulk-add-user  (array of users from Excel)
// ---------------------------------------------------------------------------

router.post(
  "/bulk-add-user",
  requirePermission("users.onboard"),
  async (req, res) => {
    try {
      const users = Array.isArray(req.body?.users) ? req.body.users : [];
      if (users.length === 0) {
        return res.status(400).json({ message: "No users provided." });
      }

      const results = [];
      const seenEmails = new Set();

      // Plan seat limit — figure out how many more users this org can
      // add before touching anything, then stop handing out slots once
      // it's used up (still runs duplicate/validation checks on the rest
      // so the response reports why each row was skipped).
      const [limit, currentCount] = await Promise.all([
        getOrgUserLimit(req.user.organizationId),
        getOrgUserCount(req.user.organizationId),
      ]);
      let remainingSlots = Math.max(limit - currentCount, 0);

      // NEW: tenant lock — resolve the caller's own domain once, reuse
      // for every row. req.user.email comes from Supabase Auth directly.
      const creatorDomain = getDomain(req.user.email);

      for (const rawUser of users) {
        const email = normalizeEmail(rawUser.email);

        if (!email) {
          results.push({
            email: rawUser.email || "(missing)",
            success: false,
            message: "Missing email.",
          });
          continue;
        }

        // SECURITY FIX (Finding #09): same rule as add-user — reject rows
        // with a personal/free email domain instead of trusting the
        // frontend's client-side check.
        if (!isProfessionalEmail(email)) {
          results.push({
            email,
            success: false,
            message:
              "Email must be a company domain (Gmail, Yahoo, Outlook etc. are not allowed).",
          });
          continue;
        }

        // NEW: tenant lock — every row's email domain must match the
        // caller's own domain.
        if (!sameDomain(email, creatorDomain)) {
          results.push({
            email,
            success: false,
            message: creatorDomain
              ? `Email domain doesn't match your organization (@${creatorDomain}).`
              : "Could not verify your organization's domain.",
          });
          continue;
        }

        // SECURITY: same check as add-user — reject any row asking for a
        // role this caller isn't allowed to hand out, instead of trusting
        // whatever the Excel file says. See ASSIGNABLE_ROLES.
        const requestedRole = String(rawUser.role || "")
          .toUpperCase()
          .trim();
        if (!canAssignRole(req.user.role, requestedRole)) {
          results.push({
            email,
            success: false,
            message: `Your role (${req.user.role}) is not allowed to create a user with role ${requestedRole || "(missing)"}.`,
          });
          continue;
        }

        // NEW: phone must be 10 digits, if provided.
        if (rawUser.phone && !isValidPhone(rawUser.phone)) {
          results.push({
            email,
            success: false,
            message: "Phone number must be exactly 10 digits.",
          });
          continue;
        }

        // NEW: reporting manager, if provided, must be a real user in
        // the same organization.
        if (rawUser.reportingManager) {
          const rmCheck = await validateReportingManager(
            rawUser.reportingManager,
            req.user.organizationId,
          );
          if (!rmCheck.valid) {
            results.push({ email, success: false, message: rmCheck.message });
            continue;
          }
        }

        // Duplicate check within THIS upload batch — email only, role/password ignored
        if (seenEmails.has(email)) {
          results.push({
            email,
            success: false,
            message: "Duplicate email in this file — skipped.",
          });
          continue;
        }
        seenEmails.add(email);

        if (remainingSlots <= 0) {
          results.push({
            email,
            success: false,
            message: `Your plan allows up to ${limit} users — skipped, upgrade your subscription to add more.`,
          });
          continue;
        }

        try {
          // Duplicate check against existing DB/auth users — email only
          const alreadyExists = await emailExists(email);
          if (alreadyExists) {
            results.push({
              email,
              success: false,
              message: "User with this email already exists.",
            });
            continue;
          }

          const tempPassword = rawUser.password || generateFallbackPassword();

          const {
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
            organizationId: req.user.organizationId,
            metadata: {
              fullName: rawUser.firstName
                ? `${rawUser.firstName} ${rawUser.lastName || ""}`.trim()
                : undefined,
              firstName: rawUser.firstName,
              lastName: rawUser.lastName,
              employeeId: rawUser.employeeId,
              designation: rawUser.designation,
              department: rawUser.department,
              dob: rawUser.dob,
              doj: rawUser.doj,
              reportingManager: rawUser.reportingManager,
              // FIX (Finding #06): bulk rows are mapped client-side via
              // mapBulkRow() in adduser.tsx, which also uses "Teams"
              // (capital T), same mismatch as the single add-user path
              // above.
              workedInTeams: rawUser.Teams,
              role: requestedRole,
            },
          });

          remainingSlots -= 1;

          // Account creation always counts as success here — email delivery
          // is reported separately so a failed send doesn't look like a
          // failed signup. resetLink is still included as a manual fallback.
          results.push({
            email,
            success: true,
            resetLink,
            resetEmailSent,
            userMasterInserted,
            message: !userMasterInserted
              ? `User created in Auth, but user_master insert failed (${userMasterError}) — CANNOT log in until fixed.`
              : resetEmailSent
                ? "User created, reset link emailed."
                : `User created, but reset email failed (${resetEmailError}). Use resetLink to share manually.`,
          });

          // Small delay between rows — Gmail SMTP has its own send-rate
          // limits, so don't hammer it in a tight bulk loop.
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (innerErr) {
          results.push({
            email,
            success: false,
            message: innerErr.message || "Failed to create this user.",
          });
        }
      }

      return res.status(200).json({ results });
    } catch (err) {
      console.error("bulk-add-user error:", err);
      return res
        .status(500)
        .json({ message: err.message || "Bulk upload failed." });
    }
  },
);

function generateFallbackPassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%";
  let pass = "";
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

module.exports = router;
