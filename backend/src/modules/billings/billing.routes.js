const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");

const {
  getPlansHandler,
  createOrderHandler,
  mockCheckoutHandler,
  verifyPaymentHandler,
  webhookHandler,
  getSignupStatusHandler,
  getMySubscriptionHandler,
  createUpgradeOrderHandler,
  verifyUpgradePaymentHandler,
  mockUpgradeHandler,
} = require("./billing.controller");

router.get("/plans", getPlansHandler);
router.post("/create-order", createOrderHandler);
// Dummy/demo payment path — no real Razorpay keys configured, see
// mockCheckoutHandler for details. Frontend's checkout modal calls this.
router.post("/mock-checkout", mockCheckoutHandler);
router.post("/verify-payment", verifyPaymentHandler);
router.get("/signup-status", getSignupStatusHandler);

// ---- In-app upgrade (already logged in, changing your OWN org's plan) ----
// All three sit behind `authenticate` — organizationId is always read off
// req.user server-side, never trusted from the client. Not CSRF-exempt
// (unlike the pre-signup routes above): a logged-in session already has a
// csrfToken by this point, so the normal double-submit check applies.
//
// NEW: also gated on "billing.manage" — previously these had NO role
// check at all beyond being logged in, so any authenticated user could
// call /upgrade/mock directly and change their org's plan even though
// the frontend only ever showed the Upgrade button to Super Admin. Now
// only Super Admin (via the "*" wildcard) and Ops Manager actually hold
// this permission (see permissions.js) — everyone else can still GET
// /subscription and /plans to view the page read-only, they just can't
// act on it. Kept as a SEPARATE middleware per route (not router.use())
// so GET /subscription right below stays open to every role.
router.get("/subscription", authenticate, getMySubscriptionHandler);
router.post(
  "/upgrade/create-order",
  authenticate,
  requireAnyPermission("billing.manage"),
  createUpgradeOrderHandler,
);
router.post(
  "/upgrade/verify-payment",
  authenticate,
  requireAnyPermission("billing.manage"),
  verifyUpgradePaymentHandler,
);
// Dummy/demo card path for the in-app Subscription page — see
// mockUpgradeHandler for details. Used instead of create-order +
// Razorpay Checkout + verify-payment when no live Razorpay keys are set.
router.post(
  "/upgrade/mock",
  authenticate,
  requireAnyPermission("billing.manage"),
  mockUpgradeHandler,
);

// IMPORTANT: Razorpay's webhook signature is computed over the RAW
// request body. If your app.js already does `app.use(express.json())`
// globally before routes are mounted, this handler will receive an
// already-parsed object and signature verification will always fail.
//
// Fix: mount express.raw() for this exact path BEFORE the global JSON
// parser, e.g. in app.js:
//
//   app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
//   app.use(express.json());
//   app.use("/api/billing", billingRoutes);
//
// The express.raw() call below is kept as a second safeguard but the
// app.js ordering above is what actually matters.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler,
);

module.exports = router;
