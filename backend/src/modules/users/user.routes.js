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
 * Creates the Supabase auth user with the placeholder password, then mints
 * a recovery link via Supabase Admin. The link is returned to the caller —
 * NOTHING IS EMAILED. The admin UI is expected to display this link so it
 * can be copied and shared with the new user manually.
 */
async function createUserAndGenerateResetLink({
  email,
  tempPassword,
  metadata,
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
          redirectTo: `${process.env.APP_URL}/reset-password`,
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
