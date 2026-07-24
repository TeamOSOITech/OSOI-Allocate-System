const crypto = require("crypto");

// TODO: point this at your existing Supabase client (the same one used
// by clients.controller.js / verticals.controller.js).
const supabase = require("../../config/supabaseClient");

const {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  PLAN_CONFIG,
} = require("./billing.service");

const SIGNUP_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

const generateSignupRecord = ({ email, plan, orderId, paymentId }) => ({
  email,
  plan,
  razorpay_order_id: orderId,
  razorpay_payment_id: paymentId,
  signup_token: crypto.randomBytes(24).toString("hex"),
  status: "paid",
  used: false,
  expires_at: new Date(Date.now() + SIGNUP_TOKEN_TTL_MS).toISOString(),
});

// GET /api/billing/plans
// Lets the frontend read live prices instead of hardcoding them twice.
const getPlansHandler = (_req, res) => {
  return res.json({ success: true, data: PLAN_CONFIG });
};

// POST /api/billing/create-order
// body: { plan: "basic" | "professional" }
const createOrderHandler = async (req, res) => {
  try {
    const { plan } = req.body;
    const order = await createOrder(plan);

    return res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/billing/verify-payment
// Called by the frontend immediately after Razorpay Checkout's success
// handler fires. This is what actually unlocks account creation.
const verifyPaymentHandler = async (req, res) => {
  try {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      plan,
      email,
    } = req.body;

    if (!orderId || !paymentId || !signature || !plan || !email) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const isValid = verifyPaymentSignature({ orderId, paymentId, signature });
    if (!isValid) {
      return res
        .status(400)
        .json({ success: false, message: "Payment verification failed" });
    }

    const record = generateSignupRecord({ email, plan, orderId, paymentId });

    const { error } = await supabase
      .from("payment_signups")
      .upsert(record, { onConflict: "razorpay_payment_id" });

    if (error) throw error;

    return res.json({
      success: true,
      data: { signupToken: record.signup_token },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/billing/webhook
// Razorpay's own server-to-server confirmation — the safety net for
// cases where the browser never calls verify-payment (closed tab,
// network drop, etc.). req.body here is a raw Buffer, see routes file.
const webhookHandler = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const isValid = verifyWebhookSignature(req.body, signature);

    if (!isValid) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid webhook signature" });
    }

    const payload = JSON.parse(req.body.toString());

    if (payload.event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const plan = payment.notes?.plan || null;
      const email = payment.email;

      const record = generateSignupRecord({
        email,
        plan,
        orderId: payment.order_id,
        paymentId: payment.id,
      });

      await supabase
        .from("payment_signups")
        .upsert(record, { onConflict: "razorpay_payment_id" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Razorpay webhook error:", err.message);
    return res.status(500).json({ success: false });
  }
};

// GET /api/billing/signup-status?token=...
// The /register page calls this first to confirm the token is real,
// unused, and not expired before showing the account-creation form.
const getSignupStatusHandler = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ success: false, message: "Missing token" });
    }

    const { data, error } = await supabase
      .from("payment_signups")
      .select("email, plan, used, expires_at")
      .eq("signup_token", token)
      .single();

    if (error || !data) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid or expired link" });
    }
    if (data.used) {
      return res
        .status(400)
        .json({ success: false, message: "This signup link was already used" });
    }
    if (new Date(data.expires_at) < new Date()) {
      return res
        .status(400)
        .json({ success: false, message: "This signup link has expired" });
    }

    return res.json({
      success: true,
      data: { email: data.email, plan: data.plan },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getPlansHandler,
  createOrderHandler,
  verifyPaymentHandler,
  webhookHandler,
  getSignupStatusHandler,
};
