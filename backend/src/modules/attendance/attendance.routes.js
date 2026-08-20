// src/modules/attendance/attendance.routes.js
const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listAttendance,
  bulkMarkAttendance,
} = require("./attendance.controller");

router.use(authenticate);

// Viewing today's grid — any authenticated user (Dashboard/Smart Auto
// Allocation both need to know who's present).
router.get("/", listAttendance);

// Marking attendance feeds directly into allocation, so it uses the same
// permission as tasks.allocate — the same person who creates a Daily Work
// batch and runs Smart Auto Allocation is the one marking who's present.
router.post(
  "/bulk",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  bulkMarkAttendance,
);

module.exports = router;
