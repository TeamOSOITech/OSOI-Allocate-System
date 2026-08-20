// user.controller.js
//
// Req/res handling for user creation (single + bulk). All the actual
// validation rules and Supabase/DB work live in user.service.js — this
// file just orchestrates: read the request, call the service, shape the
// response. Wired up by user.routes.js.

const { canAssignRole } = require("../../config/permissions");
const userService = require("./user.service");

// ---------------------------------------------------------------------------
// POST /api/users/add-user  (single user)
// ---------------------------------------------------------------------------
async function addUser(req, res) {
  try {
    const body = req.body || {};
    const email = userService.normalizeEmail(body.email);

    if (!body.fullName || !email || !body.role) {
      return res
        .status(400)
        .json({ message: "Full name, email and role are required." });
    }

    // SECURITY FIX (Finding #09): this rule previously only lived in
    // the frontend form — enforce it here too so a direct API call
    // can't bypass it.
    if (!userService.isProfessionalEmail(email)) {
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
    const creatorDomain = userService.getDomain(req.user.email);
    if (!userService.sameDomain(email, creatorDomain)) {
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
    //
    // FIX: normalize spaces/dashes to underscores too (e.g. "TEAM
    // MEMBER" -> "TEAM_MEMBER") — the frontend now does this on bulk
    // uploads, but the backend must never rely on the frontend having
    // done so (direct API calls, older cached frontend builds, etc).
    const requestedRole = String(body.role)
      .toUpperCase()
      .trim()
      .replace(/[\s\-]+/g, "_");
    if (!canAssignRole(req.user.role, requestedRole)) {
      return res.status(403).json({
        message: `Your role (${req.user.role}) is not allowed to create a user with role ${requestedRole}.`,
      });
    }

    // NEW: phone must be 10 digits, if provided.
    if (body.phone && !userService.isValidPhone(body.phone)) {
      return res.status(400).json({
        message: "Phone number must be exactly 10 digits.",
      });
    }

    // NEW: reporting manager, if provided, must be a real user OR a
    // manually-added entry, in the same organization.
    if (body.reportingManager) {
      const rmCheck = await userService.validateReportingManager(
        body.reportingManager,
        req.user.organizationId,
      );
      if (!rmCheck.valid) {
        return res.status(400).json({ message: rmCheck.message });
      }
    }

    const alreadyExists = await userService.emailExists(email);
    if (alreadyExists) {
      return res
        .status(409)
        .json({ message: `A user with email ${email} already exists.` });
    }

    // Plan seat limit — count is by email in user_master for this org.
    const [limit, currentCount] = await Promise.all([
      userService.getOrgUserLimit(req.user.organizationId),
      userService.getOrgUserCount(req.user.organizationId),
    ]);
    if (currentCount >= limit) {
      return res.status(403).json({
        message: `Your plan allows up to ${limit} users and you've reached that limit. Upgrade your subscription to add more users.`,
      });
    }

    // Password is optional from the frontend now — if somehow missing,
    // generate one here too as a safety net.
    const tempPassword =
      body.password || userService.generateFallbackPassword();

    const {
      user,
      resetLink,
      resetLinkGenerated,
      resetLinkError,
      resetEmailSent,
      resetEmailError,
      userMasterInserted,
      userMasterError,
    } = await userService.createUserAndGenerateResetLink({
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
}

// ---------------------------------------------------------------------------
// POST /api/users/bulk-add-user  (array of users from Excel)
// ---------------------------------------------------------------------------
async function bulkAddUser(req, res) {
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
      userService.getOrgUserLimit(req.user.organizationId),
      userService.getOrgUserCount(req.user.organizationId),
    ]);
    let remainingSlots = Math.max(limit - currentCount, 0);

    // NEW: tenant lock — resolve the caller's own domain once, reuse
    // for every row. req.user.email comes from Supabase Auth directly.
    const creatorDomain = userService.getDomain(req.user.email);

    for (const rawUser of users) {
      const email = userService.normalizeEmail(rawUser.email);

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
      if (!userService.isProfessionalEmail(email)) {
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
      if (!userService.sameDomain(email, creatorDomain)) {
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
      //
      // FIX: normalize spaces/dashes to underscores too (e.g. "TEAM
      // MEMBER" -> "TEAM_MEMBER") — same reasoning as add-user above.
      const requestedRole = String(rawUser.role || "")
        .toUpperCase()
        .trim()
        .replace(/[\s\-]+/g, "_");
      if (!canAssignRole(req.user.role, requestedRole)) {
        results.push({
          email,
          success: false,
          message: `Your role (${req.user.role}) is not allowed to create a user with role ${requestedRole || "(missing)"}.`,
        });
        continue;
      }

      // NEW: phone must be 10 digits, if provided.
      if (rawUser.phone && !userService.isValidPhone(rawUser.phone)) {
        results.push({
          email,
          success: false,
          message: "Phone number must be exactly 10 digits.",
        });
        continue;
      }

      // NEW: reporting manager, if provided, must be a real user OR a
      // manually-added entry, in the same organization.
      if (rawUser.reportingManager) {
        const rmCheck = await userService.validateReportingManager(
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
        const alreadyExists = await userService.emailExists(email);
        if (alreadyExists) {
          results.push({
            email,
            success: false,
            message: "User with this email already exists.",
          });
          continue;
        }

        const tempPassword =
          rawUser.password || userService.generateFallbackPassword();

        const {
          resetLink,
          resetEmailSent,
          resetEmailError,
          userMasterInserted,
          userMasterError,
        } = await userService.createUserAndGenerateResetLink({
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
}

module.exports = {
  addUser,
  bulkAddUser,
};
