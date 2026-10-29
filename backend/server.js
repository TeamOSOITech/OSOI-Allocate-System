require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const app = express();

// Render sits behind two proxy hops (Cloudflare -> Render's load balancer), so
// the X-Forwarded-For chain is "<client>, <cloudflare>, <render>". Trusting
// exactly that many hops makes req.ip the REAL client address. Without it every
// user shares one IP and the per-IP rate limits (see auth.routes.js) would lock
// everybody out together; trusting too MANY hops would let a client spoof its
// IP by sending its own X-Forwarded-For. Override with TRUST_PROXY_HOPS when
// the deployment topology changes.
const TRUST_PROXY_HOPS =
  process.env.TRUST_PROXY_HOPS &&
  Number.isInteger(Number(process.env.TRUST_PROXY_HOPS))
    ? Number(process.env.TRUST_PROXY_HOPS)
    : 2;
app.set("trust proxy", TRUST_PROXY_HOPS);

// ========================
// 🔐 Security middleware
// ========================
app.use(helmet());
app.use(compression());
app.use(cookieParser());

// ========================
// 🧠 Body parser
// ========================
// IMPORTANT: the Razorpay webhook needs the RAW request body to verify
// its signature — this has to be mounted BEFORE express.json(), or by
// the time it reaches billing.routes.js the body is already parsed and
// signature verification always fails. See billing.routes.js.
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ========================
// 🚦 General API rate limits
// ========================
// Two layers on every /api route (the auth routes add stricter ones of their own):
//   1. per USER  - keyed on a hash of the access token, so a whole office behind
//      ONE shared IP does not share a single bucket. Requests with no token fall
//      back to the client IP. API_RATE_LIMIT_MAX (per minute, default 600).
//   2. per IP    - a ceiling in front of (1), because (1) alone can be dodged by
//      sending a different junk token on every request (each gets a fresh bucket
//      and costs a Supabase call). API_IP_RATE_LIMIT_MAX (per minute, default 1200).
const apiLimiter = (max, keyGenerator) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.method === "OPTIONS" || req.path.startsWith("/billing/webhook"),
    keyGenerator,
    message: {
      success: false,
      message: "Too many requests. Please slow down and try again shortly.",
    },
  });

const tokenKey = (req) => {
  const token =
    req.cookies?.accessToken ||
    req.headers.authorization?.replace("Bearer ", "");
  return token
    ? "u:" +
        crypto.createHash("sha256").update(token).digest("hex").slice(0, 32)
    : "ip:" + req.ip;
};

app.use(
  "/api",
  apiLimiter(Number(process.env.API_RATE_LIMIT_MAX) || 600, tokenKey),
);
app.use(
  "/api",
  apiLimiter(
    Number(process.env.API_IP_RATE_LIMIT_MAX) || 1200,
    (req) => "ip:" + req.ip,
  ),
);

// ========================
// 🌐 CORS
// ========================
// SECURITY FIX: this used to be `origin: true` with `credentials: true`,
// which reflects ANY calling origin back as allowed — meaning literally
// any website could make a credentialed (cookie-carrying) request to this
// API from a victim's browser and read the JSON response. That defeats
// most of the point of httpOnly cookies. Restricted to an explicit
// whitelist instead; add every real frontend origin (prod + local dev) to
// FRONTEND_URL in your .env as a comma-separated list (singular name —
// matches the env var already set on Render), e.g.:
//   FRONTEND_URL=https://your-app.vercel.app,http://localhost:5173
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
  console.warn(
    "FRONTEND_URL is not set - CORS only allows http://localhost:5173. Set it to your real frontend origin(s).",
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header = same-origin request or a non-browser client
      // (curl/Postman/server-to-server, e.g. the Razorpay webhook) — allow.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`CORS: blocked request from disallowed origin: ${origin}`);
      // Pass `false` (not an Error) so the browser just gets no CORS
      // headers, instead of a 500 from the global error handler.
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // X-CSRF-Token was missing here — without it, the browser's CORS
    // preflight rejects the request before it ever reaches csrf.js,
    // so every non-GET call from the frontend would fail outright.
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);

// (Preflight requests are already answered by the cors() middleware above,
// using the same origin whitelist. A second, unconfigured app.options("*",
// cors()) here was dead code at best, and a wide-open CORS reply at worst.)

// ========================
// 🛡️ CSRF (double-submit cookie check)
// ========================
// Applied globally to all non-GET requests EXCEPT the handful of routes
// that legitimately can't carry a csrfToken yet:
//   - /api/auth/login, /register-organization, /register-with-payment,
//     /forgot-password — the very first request of a session, before any
//     auth/csrf cookie has ever been set.
//   - /api/auth/refresh — carries the csrfToken cookie fine in practice
//     (it persists across access-token refreshes), but is exempted as a
//     safety net so a slow-arriving cookie can never accidentally lock a
//     user out of refreshing their own session.
//   - /api/billing/webhook — called server-to-server by Razorpay, not by
//     a browser, so it has neither our cookies nor a CSRF header.
// /api/auth/logout is intentionally NOT exempted — it should still only
// be callable by a request that has our own frontend's csrfToken.
const { csrfProtection } = require("./src/middlewares/csrf");

const CSRF_EXEMPT_PATHS = [
  "/api/billing/webhook",
  // Pre-signup checkout flow — called from the public landing/checkout
  // page BEFORE an account or session exists, so there is no csrfToken
  // cookie yet to echo back (same reasoning as the auth routes below).
  "/api/billing/create-order",
  "/api/billing/mock-checkout",
  "/api/billing/verify-payment",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/forgot-password",
  "/api/auth/register-organization",
  "/api/auth/register-with-payment",
];

app.use((req, res, next) => {
  if (CSRF_EXEMPT_PATHS.some((p) => req.path.startsWith(p))) return next();
  return csrfProtection(req, res, next);
});

// ========================
// 🛣️ ROUTES
// ========================

function loadRoute(name, path) {
  const route = require(path);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Loaded route module: ${name}`);
  }
  return route;
}

app.use("/api/auth", loadRoute("auth", "./src/modules/auth/auth.routes"));
// Per-organization branding — GET is open to any logged-in role (the
// header showing the logo isn't SUPER_ADMIN-only), PATCH is gated to
// SUPER_ADMIN inside the route file itself.
app.use(
  "/api",
  loadRoute("organizations", "./src/modules/organizations/organization.routes"),
);
app.use("/api/tasks", loadRoute("tasks", "./src/modules/tasks/tasks.routes"));
app.use(
  "/api/reports",
  loadRoute("reports", "./src/modules/reports/reports.routes"),
);
app.use(
  "/api/products",
  loadRoute("products", "./src/modules/products/products.routes"),
);
// Teams master list — powers the Teams dropdown on the Add/Edit Service
// modal (Products page). Mounted right alongside /api/products since a
// Product's `teams` field references these by name.
app.use("/api/teams", loadRoute("teams", "./src/modules/teams/teams.routes"));
app.use("/api/users", loadRoute("users", "./src/modules/users/user.routes"));
app.use(
  "/api/billing",
  loadRoute("billing", "./src/modules/billings/billing.routes"),
);
app.use(
  "/api/clients",
  loadRoute("clients", "./src/modules/clients/clients.routes"),
);
app.use(
  "/api/subclients",
  loadRoute("subclients", "./src/modules/clients/subclients.routes"),
);

app.use(
  "/api/options",
  loadRoute("options", "./src/modules/options/options.routes"),
);
app.use(
  "/api/role-labels",
  loadRoute("roleLabels", "./src/modules/roleLabels/roleLabels.routes"),
);
app.use(
  "/api/employees",
  loadRoute("employees", "./src/modules/employees/employees.routes"),
);
app.use(
  "/api/approvals",
  loadRoute("approvals", "./src/modules/approvals/approvals.routes"),
);
app.use(
  "/api/allocations",
  loadRoute("allocations", "./src/modules/allocations/allocations.routes"),
);
app.use(
  "/api/daily-work",
  loadRoute("dailywork", "./src/modules/dailywork/dailywork.routes"),
);
// NEW: "Case Register" — second tab on the Daily Work page. Separate
// module/table entirely (service_cases), untouched dailywork.routes.js.
app.use(
  "/api/service-cases",
  loadRoute("servicecases", "./src/modules/servicecases/servicecases.routes"),
);
app.use(
  "/api/attendance",
  loadRoute("attendance", "./src/modules/attendance/attendance.routes"),
);
// NEW: Leave Periods (from date -> to date) — an employee marked on
// leave for a date range shows as Leave by default inside it, no daily
// marking needed. Merged into attendance by attendance.service.js.
app.use(
  "/api/employee-leaves",
  loadRoute(
    "employeeleaves",
    "./src/modules/employeeleaves/employeeleaves.routes",
  ),
);
// NEW: "External Members" — persists who's been borrowed onto a service
// for a given work date on the Employees tab (Today's Allocation page),
// so the picks survive a page refresh/reopen instead of resetting.
app.use(
  "/api/external-members",
  loadRoute(
    "externalmembers",
    "./src/modules/externalmembers/externalmembers.routes",
  ),
);
// NEW: Client Dashboard — client logins see only what staff share with them.
app.use(
  "/api/client-portal",
  loadRoute("clientportal", "./src/modules/clientportal/clientportal.routes"),
);
app.use("/api/qc", loadRoute("qc", "./src/modules/qualitychecks/qc.routes"));
// NEW: QC + Audit workflow on top of service_cases (Employee submits ->
// QC review -> Audit review). Deliberately separate from /api/qc above
// (the older standalone Quality Scores log, untouched by this).
app.use(
  "/api/qc-audit",
  loadRoute("qcaudit", "./src/modules/qcaudit/Qcaudit.routes"),
);
app.use("/api", loadRoute("profile", "./src/modules/profiles/profile.route"));
// NEW: Home page "Holidays" card — company holiday calendar. Anyone
// logged in can view; only SUPER_ADMIN can add/bulk-upload/delete. The
// "Birthdays" card next to it on the Home page needs no new module —
// it reads dateOfBirth straight off GET /api/employees, already open to
// every logged-in user.
// NEW: in-app notifications (bell icon) — e.g. "more than 8 hours" alert.
app.use(
  "/api/notifications",
  loadRoute(
    "notifications",
    "./src/modules/notifications/notifications.routes",
  ),
);
app.use(
  "/api/holidays",
  loadRoute("holidays", "./src/modules/holidays/holidays.routes"),
);
// NEW: Blue Collar (manpower-based) mode — locations, role->services Excel
// upload, team view and the employee tick-and-submit flow.
app.use(
  "/api/blue",
  loadRoute("bluecollar", "./src/modules/bluecollar/bluecollar.routes"),
);

// ========================
// ❤️ HEALTH CHECK
// ========================
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running 🚀",
  });
});

// ========================
// 🧭 404 — unmatched routes
// ========================
// MONITORING/RELIABILITY FIX: there was no catch-all here before, so a
// request to a mistyped or removed endpoint fell through to Express's
// default HTML 404 page — unhelpful for an API, and inconsistent with
// every other error response in this app (which are all JSON).
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ========================
// 🛑 GLOBAL ERROR HANDLER
// ========================
// MONITORING/RELIABILITY FIX: this app had no final Express error
// middleware. Every route handler here does catch its own errors (try/
// catch + res.status(500)), but that's a per-route convention, not a
// guarantee — anything that slips through (a bug in a handler, a
// middleware that calls next(err), a thrown error in code added later
// without a try/catch) would previously either hang the request with no
// response, or let Express fall back to its default HTML error page
// (which can also leak the stack trace to the client outside
// production). This is the safety net: log it server-side with enough
// detail to debug, and always send back a plain JSON 500 instead.
// Must be defined with all 4 params (err, req, res, next) — that's how
// Express recognizes it as an error handler.
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    success: false,
    message: "Something went wrong on our end. Please try again.",
  });
});

// ========================
// 🚨 PROCESS-LEVEL SAFETY NET
// ========================
// MONITORING FIX: previously an uncaught exception or unhandled promise
// rejection anywhere outside a request (a background job, a stray
// `.then()` without `.catch()`, etc.) would either crash the process
// with just Node's default stack trace, or — for unhandledRejection —
// be silently swallowed depending on the Node version, with no record
// of what happened. These at least guarantee it's logged clearly before
// anything else happens. (If you add a real error-tracking service like
// Sentry later, this is the place to report to it too.)
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  // After an uncaught exception the process state is undefined. Exit so the
  // host (Render) restarts it cleanly instead of serving from a bad state.
  process.exit(1);
});

// ========================
// 🚀 START SERVER
// ========================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);

  // NEW (ROLLOVER): cases allocated on an earlier day and still not
  // submitted go back to the pool. Runs once at startup and then every 5
  // minutes (the Cases list / Smart Allocation / Profile also trigger it
  // on demand, so nothing stale is ever shown).
  const {
    rolloverAllOrgs,
  } = require("./src/modules/servicecases/servicecases.controller");
  const runRollover = () =>
    rolloverAllOrgs().catch((e) =>
      console.error("Rollover failed:", e?.message || e),
    );
  runRollover();
  setInterval(runRollover, 5 * 60 * 1000);
});
