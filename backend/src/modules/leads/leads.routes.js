// src/modules/leads/leads.routes.js
//
// PUBLIC lead-capture endpoint for the landing page's "Book a Demo" form.
//   POST /api/leads/demo-request
//   body: { name, contact, email, organizationName, source? }
//
// There is no session yet (the visitor has no account), so this route is
// unauthenticated and CSRF-exempt (see server.js). Because it is public it is
// defended in layers: strict input validation, a tight per-IP rate limit, and
// silent de-duplication per email so it cannot be used to flood the table.

const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const supabase = require("../../config/supabaseClient");

const SUCCESS_MESSAGE =
  "Thanks! Our team will reach out to schedule your walkthrough.";

// 5 submissions per IP per hour is plenty for a real visitor.
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.DEMO_REQUEST_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => "demo:" + req.ip,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

// Strings only (a JSON body like {"name": {"$ne": 1}} must never get through),
// trimmed, control characters removed, whitespace collapsed.
function clean(value, max) {
  if (typeof value !== "string") return null;
  const v = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!v || v.length > max) return null;
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{7,20}$/;
const SOURCE_RE = /^[a-z0-9_-]{1,50}$/i;

router.post("/demo-request", demoLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    const name = clean(body.name, 100);
    const contact = clean(body.contact, 20);
    const emailRaw = clean(body.email, 254);
    const organizationName = clean(body.organizationName, 150);

    if (!name || name.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "Please enter your name." });
    }
    if (!contact || !PHONE_RE.test(contact)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid contact number.",
      });
    }
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }
    if (!organizationName || organizationName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Please enter your organisation name.",
      });
    }

    // `source` is only an attribution tag — fall back to a safe default.
    const sourceRaw = clean(body.source, 50);
    const source =
      sourceRaw && SOURCE_RE.test(sourceRaw) ? sourceRaw : "landing_page";

    // Same email already asked within 24h: answer "success" but store nothing,
    // so repeats (or a script) cannot fill the table.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentErr } = await supabase
      .from("demo_requests")
      .select("id")
      .eq("email", email)
      .gte("created_at", since)
      .limit(1);
    if (recentErr) throw recentErr;
    if (recent && recent.length > 0) {
      return res.json({ success: true, message: SUCCESS_MESSAGE });
    }

    const row = {
      name,
      contact,
      email,
      organization_name: organizationName,
      source,
    };

    let { error } = await supabase.from("demo_requests").insert(row);

    // `status` is NOT NULL: if the column has no DB default, retry once with one.
    if (
      error &&
      error.code === "23502" &&
      /status/i.test(error.message || "")
    ) {
      ({ error } = await supabase
        .from("demo_requests")
        .insert({ ...row, status: "new" }));
    }
    if (error) throw error;

    return res.json({ success: true, message: SUCCESS_MESSAGE });
  } catch (err) {
    console.error("LEADS demo-request error:", err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
    });
  }
});

module.exports = router;
