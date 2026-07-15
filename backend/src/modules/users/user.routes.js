// userRoutes.js
//
// Express router for user creation, wired to Supabase Auth.
//
// Flow implemented here:
//   1. Frontend sends a user (or list of users) with an auto-generated
//      placeholder password (see AddUser.tsx changes).
//   2. Backend checks for duplicates BY EMAIL ONLY (not role/password).
//   3. Backend creates the Supabase auth user with the placeholder password.
//   4. Backend immediately fires a password-reset email for that user,
//      so they never actually log in with the generated password —
//      they always land on /reset-password to set their own.
//
// Env vars required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   <-- service role key, backend only, NEVER expose to frontend
//   APP_URL                     <-- e.g. https://yourapp.com (or http://localhost:5173 in dev)

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

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
 * Creates the Supabase auth user with the placeholder password, then
 * immediately triggers a "reset password" email so the user sets their
 * own password on first access instead of ever using the generated one.
 */
async function createUserAndSendResetLink({ email, tempPassword, metadata }) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true, // skip the normal signup-confirmation email
    user_metadata: metadata,
  });
  if (error) throw error;

  // Account creation succeeded at this point — don't let a failed/rate-limited
  // reset email turn this into a hard failure. Report it separately instead.
  let resetEmailSent = true;
  let resetEmailError = null;
  try {
    const { error: resetError } =
      await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.APP_URL}/reset-password`,
      });
    if (resetError) throw resetError;
  } catch (err) {
    resetEmailSent = false;
    resetEmailError =
      err?.message ||
      err?.error_description ||
      err?.msg ||
      err?.error ||
      (typeof err === "string" ? err : JSON.stringify(err)) ||
      "Unknown error sending reset email.";
    // Log the FULL raw error server-side, not just the extracted message,
    // so we can see the real shape of whatever Supabase/SMTP returned.
    console.error(`Reset email failed for ${email}. Raw error:`, err);
  }

  return { user: data.user, resetEmailSent, resetEmailError };
}

// ---------------------------------------------------------------------------
// POST /api/users/add-user  (single user)
// ---------------------------------------------------------------------------

router.post("/add-user", async (req, res) => {
  try {
    const body = req.body || {};
    const email = normalizeEmail(body.email);

    if (!body.fullName || !email || !body.role) {
      return res
        .status(400)
        .json({ message: "Full name, email and role are required." });
    }

    const alreadyExists = await emailExists(email);
    if (alreadyExists) {
      return res
        .status(409)
        .json({ message: `A user with email ${email} already exists.` });
    }

    // Password is optional from the frontend now — if somehow missing,
    // generate one here too as a safety net.
    const tempPassword = body.password || generateFallbackPassword();

    const { user, resetEmailSent, resetEmailError } =
      await createUserAndSendResetLink({
        email,
        tempPassword,
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
          workedInTeams: body.workedInTeams,
          role: (body.role || "").toString().toUpperCase().trim(),
        },
      });

    return res.status(201).json({
      message: resetEmailSent
        ? "User created, reset link sent."
        : "User created, but reset email could not be sent (see resetEmailError). You may need to resend it once your SMTP/rate limit is sorted.",
      user,
      resetEmailSent,
      resetEmailError,
    });
  } catch (err) {
    console.error("add-user error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to create user." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/bulk-add-user  (array of users from Excel)
// ---------------------------------------------------------------------------

router.post("/bulk-add-user", async (req, res) => {
  try {
    const users = Array.isArray(req.body?.users) ? req.body.users : [];
    if (users.length === 0) {
      return res.status(400).json({ message: "No users provided." });
    }

    const results = [];
    const seenEmails = new Set();

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

        const { resetEmailSent, resetEmailError } =
          await createUserAndSendResetLink({
            email,
            tempPassword,
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
              workedInTeams: rawUser.workedInTeams,
              role: (rawUser.role || "").toString().toUpperCase().trim(),
            },
          });

        // Account creation always counts as success here — email delivery
        // is reported separately so a rate limit doesn't look like a failed signup.
        results.push({
          email,
          success: true,
          message: resetEmailSent
            ? "User created, reset link sent."
            : `User created, but reset email failed (${resetEmailError}). Resend later once SMTP/rate limit is fixed.`,
        });

        // Small delay between rows to reduce the chance of hitting
        // Supabase's default email rate limit during bulk uploads.
        // Once you've set up a custom SMTP provider, this can be removed.
        await new Promise((resolve) => setTimeout(resolve, 1200));
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
});

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
