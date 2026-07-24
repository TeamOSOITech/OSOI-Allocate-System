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
app.use("/api/auth", require("./src/modules/auth/auth.routes"));
app.use("/api/tasks", require("./src/modules/tasks/tasks.routes"));
app.use("/api/reports", require("./src/modules/reports/reports.routes"));
app.use("/api/products", require("./src/modules/products/products.routes"));
app.use("/api/users", require("./src/modules/users/user.routes"));
app.use("/api/clients", require("./src/modules/clients/clients.routes"));
app.use("/api/subclients", require("./src/modules/clients/subclients.routes"));
app.use("/api/employees", require("./src/modules/employees/employees.routes"));
app.use("/api/approvals", require("./src/modules/approvals/approvals.routes"));
// FIX: this route file existed but was never mounted anywhere — the
// /profile endpoint was dead code until now.
app.use("/api", require("./src/modules/profiles/profile.route"));

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
