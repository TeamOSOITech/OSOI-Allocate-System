// src/modules/employees/employees.routes.js
const express = require("express");
const router = express.Router();
const {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} = require("./employees.controller");

// GET /api/employees
router.get("/", listEmployees);

// GET /api/employees/:id
router.get("/:id", getEmployeeById);

// PUT /api/employees/:id
router.put("/:id", updateEmployee);

// PATCH /api/employees/:id  (frontend uses PATCH for saving edits)
router.patch("/:id", updateEmployee);

// DELETE /api/employees/:id
router.delete("/:id", deleteEmployee);

module.exports = router;
