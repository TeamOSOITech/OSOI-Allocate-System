require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const app = express();

// Import Supabase Client
const supabase = require("./src/config/supabaseClient");

// ========================
// 🔐 Security middleware
// ========================
app.use(helmet());

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
app.use("/api/verticals", require("./src/modules/verticals/verticals.routes"));
app.use("/api/users", require("./src/modules/users/user.routes"));
app.use("/api/clients", require("./src/modules/clients/clients.routes"));
app.use("/api/subclients", require("./src/modules/clients/subclients.routes"));
app.use("/api/employees", require("./src/modules/employees/employees.routes"));

// ========================
// ✅ TEST SUPABASE AUTH
// ========================
app.get("/test-auth", async (req, res) => {
  try {
    console.log("Testing Supabase Auth...");

    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      console.error("List Users Error:", error);

      return res.status(500).json({
        success: false,
        error,
      });
    }

    return res.json({
      success: true,
      totalUsers: data.users.length,
      users: data.users.map((u) => ({
        id: u.id,
        email: u.email,
      })),
    });
  } catch (err) {
    console.error("TEST AUTH ERROR:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
      error: err,
    });
  }
});

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
