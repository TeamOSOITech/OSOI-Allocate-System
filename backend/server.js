require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

// SECURITY / BUG FIX: Render (like most hosts) sits behind a reverse
// proxy — every incoming request's socket IP is the proxy's own IP, not
// the real client's. Without this, express-rate-limit (see auth.routes.js)
// treats every single user as coming from that ONE shared IP, so the
// "10 login attempts per IP" limit was actually being shared across
// EVERY user on the platform combined — a handful of unrelated login
// attempts anywhere would lock everyone else out, including someone
// logging in for the very first time.
//
// CONFIRMED IN PROD LOGS: requests here pass through TWO proxy hops
// before reaching this process — Cloudflare, then Render's own internal
// load balancer — producing an X-Forwarded-For chain shaped like:
//   "<real client ip>, <cloudflare ip>, <render internal ip>"
// Neither intermediate hop is a loopback address, so `"loopback"` never
// matched and req.ip was falling back to the raw socket address (Render's
// internal 10.x.x.x IP) — the exact same bug as having no setting at all.
// `2` tells Express to trust the 2 nearest hops (Cloudflare + Render's
// LB) and take the next address in the chain as the real client IP.
app.set("trust proxy", 2);

// Import Supabase Client
const supabase = require("./src/config/supabaseClient");

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

// TEMP DEBUG: remove once CORS is confirmed working in production. Prints
// exactly what the server resolved FRONTEND_URLS to at boot, so a typo,
// missing env var, or stray whitespace/quotes is visible in the Render logs
// instead of having to guess from the CORS error alone.
console.log("CORS allowedOrigins:", allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header = same-origin request or a non-browser client
      // (curl/Postman/server-to-server, e.g. the Razorpay webhook) — allow.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`CORS: blocked request from disallowed origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // X-CSRF-Token was missing here — without it, the browser's CORS
    // preflight rejects the request before it ever reaches csrf.js,
    // so every non-GET call from the frontend would fail outright.
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);

app.options("*", cors());

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

  console.log(`\n====================`);
  console.log(`${name}`);
  console.log("Type:", typeof route);
  console.log("Constructor:", route?.constructor?.name);
  console.log("Keys:", Object.keys(route));
  console.log("====================\n");

  return route;
}

app.use("/api/auth", loadRoute("auth", "./src/modules/auth/auth.routes"));
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
app.use(
  "/api/holidays",
  loadRoute("holidays", "./src/modules/holidays/holidays.routes"),
);

// ========================
// ⚠️ REMOVED: /test-auth
// ========================
// This debug endpoint called supabase.auth.admin.listUsers() with NO
// authentication at all — anyone who found the URL could dump every
// user's id + email. It was leftover from development. If you need
// this for debugging again, add `authenticate` + `authorize("SUPER_ADMIN")`
// and never leave it reachable in a deployed environment.

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
  // Deliberately not calling process.exit() here — killing the process
  // on every uncaught error would turn one bad request into a full
  // outage for every other in-flight request. Better to log it and keep
  // serving; if it becomes a real problem, add a process manager
  // (pm2/systemd) that restarts on repeated crashes.
});

// ========================
// 🚀 START SERVER
// ========================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
