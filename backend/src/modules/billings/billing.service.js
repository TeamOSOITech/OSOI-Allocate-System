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

const createOrder = async (planKey, extraNotes = {}) => {
  const plan = PLAN_CONFIG[planKey];
  if (!plan) {
    throw new Error("Invalid plan selected");
  }

  const order = await getRazorpay().orders.create({
    amount: plan.amount,
    currency: "INR",
    receipt: `receipt_${planKey}_${Date.now()}`,
    // extraNotes lets callers (e.g. the in-app upgrade flow) stamp the
    // organization_id onto the order too, alongside the plan — purely
    // for traceability in the Razorpay dashboard; verify-payment never
    // trusts these notes for anything security-relevant.
    notes: { plan: planKey, ...extraNotes },
  });

  return order;
};

// supabase client passed in by the caller (billing.controller.js already
// has one) so this file doesn't need its own connection just for this.
//
// Looks up the plans row by name (case-insensitively — PLAN_CONFIG keys
// are lowercase, the `plans` table's `name` column may not be).
const getPlanByName = async (supabase, planKey) => {
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, price_per_user")
    .ilike("name", planKey)
    .maybeSingle();

  if (error) throw error;
  return data;
};

// The organization's current ACTIVE subscription row (if any), most
// recent period first — same query shape as user.service.js's
// getOrgUserLimit, just also returning the row's id/dates so the caller
// can decide update-vs-insert.
const getActiveSubscription = async (supabase, organizationId) => {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, plan_id, status, current_period_start, current_period_end, plans ( name )",
    )
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("current_period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
};

// Moves an organization onto a new plan: updates its existing active
// subscription row in place if one exists (so upgrading doesn't leave
// a trail of duplicate "active" rows for the same org), otherwise
// inserts a fresh one — covers orgs that started on the free plan
// (registerOrganization.controller.js's path never creates a
// subscriptions row at all) and are upgrading for the first time.
const upgradeOrgSubscription = async (supabase, organizationId, plan) => {
  const periodStart = new Date();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const existing = await getActiveSubscription(supabase, organizationId);

  if (existing) {
    const { data, error } = await supabase
      .from("subscriptions")
      .update({
        plan_id: plan.id,
        status: "active",
        price_per_user_snapshot: plan.price_per_user,
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd.toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      organization_id: organizationId,
      plan_id: plan.id,
      status: "active",
      price_per_user_snapshot: plan.price_per_user,
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
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
  getPlanByName,
  getActiveSubscription,
  upgradeOrgSubscription,
};
