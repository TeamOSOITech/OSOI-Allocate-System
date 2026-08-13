// registerWithPayment.controller.js (FIXED)
//
// This replaces the previous version, which was disconnected from the
// rest of the app: it wrote to a `users` table with a bcrypt hash and
// signed its own custom JWT — completely bypassing Supabase Auth and
// `user_master`, which is what every other route (and the `authenticate`
// middleware) actually relies on. It was also never wired into
// auth.routes.js, so it wasn't reachable yet.
//
// This version:
//   1. Creates a new `organizations` row (this signup becomes tenant #2,
//      #3, etc. — OSOI is tenant #1, seeded by the migration).
//   2. Creates the person via Supabase Auth (supabase.auth.admin.createUser),
//      exactly like migrateAdmins.js does for existing admins.
//   3. Creates their `user_master` row with organization_id + Role =
//      SUPER_ADMIN (org-level super admin — see permissions.js; this is
//      the org's own top role, not a platform-operator concept).
//   4. Creates a `subscriptions` row tied to the new organization, on
//      the plan they paid for.
//   5. Signs them in via supabase.auth.signInWithPassword so the
//      response shape matches the normal /api/auth/login response
//      exactly — same accessToken/refreshToken/user shape Landing.tsx
//      and every other page already expect.

const supabase = require("../../config/supabaseClient");
const { setAuthCookies } = require("../../config/authCookies");

// POST /api/auth/register-with-payment
// body: { token, name, password }
const registerWithPaymentHandler = async (req, res) => {
  try {
    const { token, name, password } = req.body;

    if (!token || !name || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters",
      });
    }

    // 1. Validate the paid signup token
    const { data: signup, error: signupError } = await supabase
      .from("payment_signups")
      .select("email, plan, used, expires_at")
      .eq("signup_token", token)
      .single();

    if (signupError || !signup) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid or expired signup link" });
    }
    if (signup.used) {
      return res
        .status(400)
        .json({ success: false, message: "This signup link was already used" });
    }
    if (new Date(signup.expires_at) < new Date()) {
      return res
        .status(400)
        .json({ success: false, message: "This signup link has expired" });
    }

    // 2. Make sure an account for this email doesn't already exist
    //    (checked against user_master, the real identity table — the
    //    previous version checked a `users` table nothing else uses)
    const { data: existingProfile } = await supabase
      .from("user_master")
      .select("id")
      .eq("Email", signup.email)
      .maybeSingle();

    if (existingProfile) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }

    // 3. Create the new organization (this signup = a brand new tenant)
    //
    // FIX: this used to also insert `slug` and status: "trialing" — but
    // per registerOrganization.controller.js's notes (the other org-
    // creation flow, already working), the real `organizations` table
    // only has id, name, created_at, status, plan. There is no `slug`
    // column, so this insert was failing with "Could not find the
    // 'slug' column of 'organizations' in the schema cache" every time.
    // Matching the other flow's status value ("ACTIVE") too, for
    // consistency between the two signup paths.
    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .insert({ name: name.trim(), status: "ACTIVE" })
      .select()
      .single();

    if (orgError) throw orgError;

    // 4. Create the Supabase Auth user
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: signup.email,
        password,
        email_confirm: true,
      });

    if (authError) {
      // Roll back the org row so we don't leave an orphaned tenant behind
      await supabase.from("organizations").delete().eq("id", organization.id);
      throw authError;
    }

    // 5. Create their user_master row — org-level SUPER_ADMIN, since
    //    they're the first (and so far only) person in this new org.
    const [firstName, ...rest] = name.trim().split(/\s+/);
    const { error: profileError } = await supabase.from("user_master").insert({
      "Auth User Id": authData.user.id,
      "First Name": firstName || name.trim(),
      "Last Name": rest.join(" ") || null,
      Email: signup.email,
      "Login Email": signup.email,
      Role: "SUPER_ADMIN",
      organization_id: organization.id,
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      await supabase.from("organizations").delete().eq("id", organization.id);
      throw profileError;
    }

    // 6. Look up the plan they paid for and create their subscription
    const { data: plan } = await supabase
      .from("plans")
      .select("id, price_per_user")
      .ilike("name", signup.plan)
      .single();

    if (plan) {
      await supabase.from("subscriptions").insert({
        organization_id: organization.id,
        plan_id: plan.id,
        status: "active",
        price_per_user_snapshot: plan.price_per_user,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
    } else {
      console.error(
        `No matching plan found for signup.plan="${signup.plan}" — subscription NOT created. Check plans table names match PLAN_CONFIG keys.`,
      );
    }

    // 7. Mark the signup token as used (prevents replay)
    await supabase
      .from("payment_signups")
      .update({ used: true })
      .eq("signup_token", token);

    // 8. Sign in immediately, same shape as normal /api/auth/login
    const { data: sessionData, error: sessionError } =
      await supabase.auth.signInWithPassword({
        email: signup.email,
        password,
      });

    if (sessionError || !sessionData?.session) {
      // Account was created successfully even if auto-login fails —
      // tell them to log in manually rather than erroring the whole flow.
      return res.status(201).json({
        success: true,
        message: "Account created. Please log in.",
        data: { requiresLogin: true },
      });
    }

    // BUG FIX: this handler used to return accessToken/refreshToken raw
    // in the JSON body and never called setAuthCookies — so unlike
    // loginHandler, it never set the httpOnly accessToken/refreshToken
    // cookies OR the JS-readable csrfToken cookie. The account/session
    // was created fine, but the very next state-changing request the
    // freshly-signed-up user made (anything hitting csrfProtection) had
    // no csrfToken cookie to compare against the header, and failed with
    // "CSRF check failed." Matching loginHandler's pattern fixes it.
    const csrfToken = setAuthCookies(res, {
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
    });

    return res.status(201).json({
      success: true,
      data: {
        csrfToken,
        user: {
          id: authData.user.id,
          email: signup.email,
          role: "SUPER_ADMIN",
          firstName: firstName || name.trim(),
          lastName: rest.join(" ") || null,
          organizationId: organization.id,
        },
      },
    });
  } catch (err) {
    console.error("REGISTER WITH PAYMENT ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { registerWithPaymentHandler };
