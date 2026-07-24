const express = require("express");
const router = express.Router();

const {
  getPlansHandler,
  createOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getSignupStatusHandler,
} = require("./billing.controller");

router.get("/plans", getPlansHandler);
router.post("/create-order", createOrderHandler);
router.post("/verify-payment", verifyPaymentHandler);
router.get("/signup-status", getSignupStatusHandler);

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
