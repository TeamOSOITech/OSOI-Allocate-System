const crypto = require("crypto");
const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Amounts are in paise (Razorpay's smallest currency unit for INR).
// Keep this in sync with the PLANS array in Landing.tsx — Free and
// Enterprise never hit this service (Free skips payment, Enterprise
// goes to Contact Sales).
const PLAN_CONFIG = {
  basic: { amount: 14900, label: "Basic" }, // ₹149
  professional: { amount: 19900, label: "Professional" }, // ₹199
};

const createOrder = async (planKey) => {
  const plan = PLAN_CONFIG[planKey];
  if (!plan) {
    throw new Error("Invalid plan selected");
  }

  const order = await razorpay.orders.create({
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
  razorpay,
  PLAN_CONFIG,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
