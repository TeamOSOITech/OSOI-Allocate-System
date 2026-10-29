const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const {
  loginHandler,
  logoutHandler,
  refreshHandler,
} = require("./auth.controller");
const { forgotPasswordHandler } = require("./auth.controller");
const {
  registerOrganizationHandler,
} = require("./registerOrganization.controller");
const {
  registerWithPaymentHandler,
} = require("./registerWithPayment.controller");

// SECURITY FIX: these endpoints had NO rate limiting at all — an
// attacker could try unlimited passwords per second against any known
// email (credential stuffing / brute force), or spam the
// forgot-password email sender. Both are now capped per IP.
// Only FAILED logins count (skipSuccessfulRequests): an office where many
// people share one public IP and all log in at 9:00 must not lock itself out.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 FAILED attempts per IP per window
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in a few minutes.",
  },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 reset requests per IP per window — prevents email-bombing a target
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again later.",
  },
});

// Per-ADDRESS cap on top of the per-IP one: an attacker rotating IPs could
// otherwise still flood one victim's inbox with reset emails. Keyed on the
// normalised email; responses stay identical so nothing is revealed.
const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `reset:${String(req.body?.email || "")
      .trim()
      .toLowerCase()}`,
  skip: (req) => !req.body?.email,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again later.",
  },
});

// Prevents someone from spamming new tenant/org creation from one IP
const registerOrgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 organizations per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many signup attempts. Please try again later.",
  },
});

// Per-ACCOUNT limit, on top of the per-IP one above — otherwise an attacker
// rotating IPs can guess passwords against one email indefinitely.
//
// Counts failed logins only, and the cap is deliberately higher than the
// per-IP one: a single attacker (one IP) is stopped by the per-IP limit
// above long before this, so he can no longer lock the real user out of
// their own account. Reaching this one takes failures from several IPs.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `acct:${String(req.body?.email || "")
      .trim()
      .toLowerCase()}`,
  skip: (req) => !req.body?.email,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in a few minutes.",
  },
});

// Login using Supabase Authentication
router.post("/login", loginLimiter, loginAccountLimiter, loginHandler);

// Clears the auth cookies. No rate limit needed — it only ever hurts
// the caller's own session, nothing to abuse.
router.post("/logout", logoutHandler);

// Called by the frontend's authFetch wrapper on a 401 — uses the
// refreshToken httpOnly cookie to mint a new access token without the
// user having to log in again. Rate-limited a bit looser than login
// since legitimate traffic can hit this fairly often (every ~1hr per
// active user, plus retries).
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many session refresh attempts. Please log in again.",
  },
});
router.post("/refresh", refreshLimiter, refreshHandler);

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  forgotPasswordEmailLimiter,
  forgotPasswordHandler,
);

router.post(
  "/register-organization",
  registerOrgLimiter,
  registerOrganizationHandler,
);

// Same abuse protection as register-organization — completes the paid
// signup flow started by /api/billing/create-order (or /mock-checkout)
// + /api/billing/verify-payment. Was previously written but never
// mounted here, so the paid-signup page had nothing to call.
router.post(
  "/register-with-payment",
  registerOrgLimiter,
  registerWithPaymentHandler,
);

module.exports = router;
