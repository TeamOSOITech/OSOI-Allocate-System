// src/modules/employees/employees.routes.js
const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");
const {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} = require("./employees.controller");

// FIX: this entire router previously had ZERO authentication —
// anyone could list, edit, or delete every employee record without
// logging in. Every route below now requires a valid session.
router.use(authenticate);

// Any logged-in user can view the directory / a single record —
// needed so Team Members and Vertical Heads can see who's on their team.
router.get("/", listEmployees);
router.get("/:id", getEmployeeById);

// Editing/removing employee master data is an Ops Manager / Super Admin
// action ("change team assignments", "deactivate users") per the
// approval flow doc.
router.put("/:id", requirePermission("employees.manage"), updateEmployee);
router.patch("/:id", requirePermission("employees.manage"), updateEmployee);
router.delete("/:id", requirePermission("employees.manage"), deleteEmployee);

module.exports = router;
