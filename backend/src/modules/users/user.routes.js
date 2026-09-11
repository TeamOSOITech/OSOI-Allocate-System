// user.routes.js
//
// Express router for user creation, wired to Supabase Auth.
// This file ONLY defines routes + middleware. Request handling lives in
// user.controller.js, and all business/DB logic lives in user.service.js.

const express = require("express");
const { authenticate } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");

// APPROVAL: intercepts Process Lead's Add User request here and files it
// as a pending approval instead of letting it reach the route handler —
// see src/middlewares/approvalGate.js and the USER_CREATE rule in
// src/config/permissions.js. Ops Manager / Super Admin are unaffected
// (act immediately), same pattern as clients.routes.js.
const { approvalGate } = require("../../middlewares/approvalGate");
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
  approvalGate("USER_CREATE"),
  userController.addUser,
);

// ---------------------------------------------------------------------------
// POST /api/users/bulk-add-user  (array of users from Excel)
//
// NOT approval-gated, deliberately — mirrors the same exemption already
// in place for clients/subclients/products bulk uploads (see
// clients.routes.js). Bulk uploads always create directly regardless of
// caller's role.
// ---------------------------------------------------------------------------
router.post(
  "/bulk-add-user",
  requirePermission("users.onboard"),
  userController.bulkAddUser,
);

module.exports = router;
