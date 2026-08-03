const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { loginHandler } = require("./auth.controller");
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
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
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

// Login using Supabase Authentication
router.post("/login", loginLimiter, loginHandler);

router.post("/forgot-password", forgotPasswordLimiter, forgotPasswordHandler);

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
