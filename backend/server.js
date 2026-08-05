require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

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
app.use(
  "/api/attendance",
  loadRoute("attendance", "./src/modules/attendance/attendance.routes"),
);
app.use("/api/qc", loadRoute("qc", "./src/modules/qualitychecks/qc.routes"));
app.use("/api", loadRoute("profile", "./src/modules/profiles/profile.route"));

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
// 🚀 START SERVER
// ========================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
