require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");

const app = express();

// Import Supabase Client
const supabase = require("./src/config/supabaseClient");

// ========================
// 🔐 Security middleware
// ========================
app.use(helmet());
app.use(compression());

// ========================
// 🧠 Body parser
// ========================
app.use(express.json());

// ========================
// 🌐 CORS
// ========================
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.options("*", cors());

// ========================
// 🛣️ ROUTES
// ========================
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
app.use("/api/users", loadRoute("users", "./src/modules/users/user.routes"));
app.use(
  "/api/clients",
  loadRoute("clients", "./src/modules/clients/clients.routes"),
);
app.use(
  "/api/subclients",
  loadRoute("subclients", "./src/modules/clients/subclients.routes"),
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
