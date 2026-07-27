// src/modules/dailyWork/dailyWork.routes.js
const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listDailyWork,
  getDailyWorkById,
  createDailyWork,
  updateDailyWork,
  deleteDailyWork,
} = require("./dailyWork.controller");

router.use(authenticate);

// Viewing daily work batches — koi bhi authenticated user (Dashboard
// pending table + SmartAutoAllocation dropdown dono ko chahiye).
router.get("/", listDailyWork);
router.get("/:id", getDailyWorkById);

// Create/edit/delete allocation feed karta hai, isliye same permission
// jo allocation khud use karta hai.
router.post(
  "/",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  createDailyWork,
);
router.put(
  "/:id",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  updateDailyWork,
);
router.patch(
  "/:id",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  updateDailyWork,
);
router.delete(
  "/:id",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  deleteDailyWork,
);

module.exports = router;
