const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// TODO: same as billing.controller.js — point this at your existing
// Supabase client instead of a fresh import if one already exists.
const supabase = require("../../config/supabaseClient");

// TODO: if you already have a generateTokens()/signTokens() helper in
// auth.service.js (used by your normal login flow), delete the
// signTokens() function below and import that one instead — keeping
// token generation in one place avoids the two flows drifting apart.
const signTokens = (user) => {
  const accessToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m" },
  );
  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" },
  );
  return { accessToken, refreshToken };
};

// POST /api/auth/register-with-payment
// body: { token, name, password }
//
// Flow:
//   1. Look up the signup_token in payment_signups (must exist, be
//      unused, and not be expired).
//   2. Create the user account tied to that email + plan.
//   3. Mark the payment_signups row as used so the link can't be
//      redeemed a second time.
//   4. Sign in the new user immediately (same response shape as your
//      normal /api/auth/login), so Landing.tsx's role-redirect logic
//      keeps working unchanged.
const registerWithPaymentHandler = async (req, res) => {
  try {
    const { token, name, password } = req.body;

    if (!token || !name || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({
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
    const { data: existingUser } = await supabase
      .from("users") // TODO: adjust table name if yours differs
      .select("id")
      .eq("email", signup.email)
      .maybeSingle();

    if (existingUser) {
      return res
        .status(409)
        .json({
          success: false,
          message: "An account with this email already exists",
        });
    }

    // 3. Create the account
    const passwordHash = await bcrypt.hash(password, 10);

    // TODO: "OPS_MANAGER" is a guess at the right role for someone
    // who just paid and is setting up their organization. Swap in
    // whatever role your schema uses for a new org owner/admin.
    const { data: newUser, error: createError } = await supabase
      .from("users")
      .insert({
        name,
        email: signup.email,
        password_hash: passwordHash,
        role: "OPS_MANAGER",
        plan: signup.plan,
      })
      .select()
      .single();

    if (createError) throw createError;

    // 4. Mark the signup token as used (prevents replay)
    await supabase
      .from("payment_signups")
      .update({ used: true })
      .eq("signup_token", token);

    // 5. Sign the user in immediately
    const { accessToken, refreshToken } = signTokens(newUser);

    return res.status(201).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { registerWithPaymentHandler };
