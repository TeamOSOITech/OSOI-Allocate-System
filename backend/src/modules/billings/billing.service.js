const crypto = require("crypto");

// LAZY on purpose, both the `require` and the construction: the
// "razorpay" package may not even be installed (this project runs
// payment through the mock-checkout dummy-card path — see
// billing.controller.js — so it's optional), and the Razorpay SDK
// also throws at construction time if key_id/key_secret are missing.
// Doing either eagerly at the top of this file would crash the whole
// server on startup the moment billing.routes.js gets loaded, even
// though nothing here needs it yet. Only touched by createOrder(),
// which only real Razorpay Checkout would call.
let _razorpay = null;
const getRazorpay = () => {
  if (!_razorpay) {
    let Razorpay;
    try {
      Razorpay = require("razorpay");
    } catch {
      throw new Error(
        "The 'razorpay' package isn't installed. Run `npm install` in backend/, or keep using the dummy-card mock-checkout flow instead.",
      );
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
};

// Amounts are in paise (Razorpay's smallest currency unit for INR).
// Keep this in sync with the PLANS array in Landing.tsx — Free and
// Enterprise never hit this service (Free skips payment, Enterprise
// goes to Contact Sales).
const PLAN_CONFIG = {
  basic: { amount: 14900, label: "Basic" }, // ₹149
  professional: { amount: 19900, label: "Professional" }, // ₹199
};

// Max users an organization on each plan is allowed to create, per the
// pricing cards on Landing.tsx ("Up to 5 / 25 / 100 Users", "Unlimited").
// Counted by row in user_master (one row per email) for the org.
// "free" is the default for organizations with no active subscriptions
// row at all (the no-payment /register-organization signup path).
const PLAN_USER_LIMITS = {
  free: 5,
  basic: 25,
  professional: 100,
  enterprise: Infinity,
};

const createOrder = async (planKey) => {
  const plan = PLAN_CONFIG[planKey];
  if (!plan) {
    throw new Error("Invalid plan selected");
  }

  const order = await getRazorpay().orders.create({
    amount: plan.amount,
    currency: "INR",
    receipt: `receipt_${planKey}_${Date.now()}`,
    notes: { plan: planKey },
  });

  return order;
};

// Verifies the signature Razorpay Checkout returns to the browser after
// a successful payment (order_id + payment_id + signature).
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return expected === signature;
};

// Verifies the signature on Razorpay's server-to-server webhook calls.
// Needs the RAW request body (a string/Buffer), not the parsed JSON —
// see the express.raw() note in billing.routes.js.
const verifyWebhookSignature = (rawBody, signature) => {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return expected === signature;
};

module.exports = {
  getRazorpay,
  PLAN_CONFIG,
  PLAN_USER_LIMITS,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
