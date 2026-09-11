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
// APPROVAL: intercepts Process Lead's bulk-add-user request here and
// files it as a pending approval, same as single Add User above — see
// USER_BULK_CREATE in src/config/permissions.js. This route's body is
// already plain JSON ({ users: [...] }, parsed client-side from the
// Excel file), so the regular approvalGate() (not the file-upload
// bulkApprovalGate() used by clients/products) applies here unchanged.
// Ops Manager / Super Admin are unaffected (act immediately).
// ---------------------------------------------------------------------------
router.post(
  "/bulk-add-user",
  requirePermission("users.onboard"),
  approvalGate("USER_BULK_CREATE"),
  userController.bulkAddUser,
);

module.exports = router;
