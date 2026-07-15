// src/modules/employees/employees.routes.js
const express = require("express");
const router = express.Router();
const { listEmployees } = require("./employees.controller");

// GET /api/employees
router.get("/", listEmployees);

module.exports = router;
