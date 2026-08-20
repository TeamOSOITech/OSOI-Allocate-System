// user.routes.js
//
// Express router for user creation, wired to Supabase Auth.
// This file ONLY defines routes + middleware. Request handling lives in
// user.controller.js, and all business/DB logic lives in user.service.js.

const express = require("express");
const { authenticate } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");
const userController = require("./user.controller");

const router = express.Router();

// FIX: this entire router previously had ZERO authentication — anyone
// could create user accounts (with a Supabase auth login!) by hitting
// these endpoints directly, no token needed.
router.use(authenticate);

// ---------------------------------------------------------------------------
// POST /api/users/add-user  (single user)
// ---------------------------------------------------------------------------
router.post(
  "/add-user",
  requirePermission("users.onboard"),
  userController.addUser,
);

// ---------------------------------------------------------------------------
// POST /api/users/bulk-add-user  (array of users from Excel)
// ---------------------------------------------------------------------------
router.post(
  "/bulk-add-user",
  requirePermission("users.onboard"),
  userController.bulkAddUser,
);

module.exports = router;
