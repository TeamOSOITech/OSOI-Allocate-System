// registerOrganization.controller.js
//
// "Sign up your organization" flow from the landing page popup — just
// Organization Name + Email, no payment/token involved (that's the
// separate registerWithPayment.controller.js flow for paid plans).
//
// What this does:
//   1. Creates a new `organizations` row (tenant id is DB-generated —
//      nobody types one in, matching the existing organizations.id
//      default used by registerWithPayment.controller.js).
//   2. Creates the person via Supabase Auth with a random password that
//      nobody knows (they set their own via the emailed recovery link —
//      mirrors auth.service.js's forgotPassword pattern exactly).
//   3. Creates their `user_master` row with organization_id + Role =
//      SUPER_ADMIN (first person in a brand new org).
//   4. Generates a Supabase "recovery" link and emails it via Brevo
//      (mailer.js) so they can set a password and then log in normally
//      at /login — this does NOT log them in or return a session.
//
// On any failure after the organization row is created, we roll back
// (delete org / delete auth user) so we never leave an orphaned tenant.

const crypto = require("crypto");
const supabase = require("../../config/supabaseClient");
const { sendMail, buildResetLinkEmailHtml } = require("../../mailer");

// POST /api/auth/register-organization
// body: { organizationName, email }
const registerOrganizationHandler = async (req, res) => {
  let organization = null;
  let authUserId = null;

  try {
    const { organizationName, email } = req.body;

    if (!organizationName || !organizationName.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Organization name is required." });
    }
    if (!email || !email.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required." });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedOrgName = organizationName.trim();

    // Make sure an account for this email doesn't already exist
    const { data: existingProfile } = await supabase
      .from("user_master")
      .select("id")
      .eq("Email", trimmedEmail)
      .maybeSingle();

    if (existingProfile) {
      return res.status(409).json({
        success: false,
        message:
          "An account with this email already exists. Please log in instead.",
      });
    }

    // 1. Create the new organization — id is DB-generated, never supplied.
    // (organizations table only has: id, name, created_at, status, plan —
    // no slug column, unlike the paid-signup flow's assumption.)
    const { data: orgData, error: orgError } = await supabase
      .from("organizations")
      .insert({ name: trimmedOrgName, status: "ACTIVE" })
      .select()
      .single();

    if (orgError) throw orgError;
    organization = orgData;

    // 2. Create the Supabase Auth user with a random password nobody
    //    knows — they'll set their own via the recovery link emailed
    //    below.
    const tempPassword = crypto.randomBytes(24).toString("base64");

    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: trimmedEmail,
        password: tempPassword,
        email_confirm: true,
      });

    if (authError) throw authError;
    authUserId = authData.user.id;

    // 3. Create their user_master row — org-level SUPER_ADMIN, since
    //    they're the first (and so far only) person in this new org.
    const { error: profileError } = await supabase.from("user_master").insert({
      "Auth User Id": authUserId,
      "First Name": trimmedOrgName,
      "Last Name": null,
      Email: trimmedEmail,
      "Login Email": trimmedEmail,
      Role: "SUPER_ADMIN",
      organization_id: organization.id,
    });

    if (profileError) throw profileError;

    // 4. Generate a recovery link and email it — same pattern as
    //    auth.service.js's forgotPassword, so they land on the same
    //    /reset-password page the rest of the app already uses.
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "recovery",
        email: trimmedEmail,
        options: {
          redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
        },
      });

    if (linkError) throw linkError;

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error("No action_link returned.");

    await sendMail({
      to: trimmedEmail,
      subject: "Set up your organization's password",
      html: buildResetLinkEmailHtml({
        heading: `Welcome, ${trimmedOrgName}!`,
        bodyText:
          "Your organization has been created. Click below to set your password, then log in as your organization's admin.",
        actionLink,
        buttonText: "Set Password",
      }),
    });

    return res.status(201).json({
      success: true,
      message:
        "Organization created. Check your email to set your password, then log in.",
    });
  } catch (err) {
    console.error("REGISTER ORGANIZATION ERROR:", err);

    // Roll back so we never leave an orphaned tenant / dangling auth user
    if (authUserId) {
      await supabase.auth.admin.deleteUser(authUserId);
    }
    if (organization) {
      await supabase.from("organizations").delete().eq("id", organization.id);
    }

    return res.status(500).json({
      success: false,
      message: err.message || "Something went wrong. Please try again.",
    });
  }
};

module.exports = { registerOrganizationHandler };
