// src/modules/dailyWork/dailyWork.routes.js
const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listDailyWork,
  getDailyWorkById,
  createDailyWork,
  bulkCreateDailyWork,
  updateDailyWork,
  deleteDailyWork,
  seedDummyCases,
} = require("./dailywork.controller");

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

// Bulk version of the same create — one Excel upload with (Service Name,
// Quantity) rows instead of one form submit per service. Literal path,
// same permission as the single-row create above.
router.post(
  "/bulk",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  bulkCreateDailyWork,
);

// "Load Test Cases" button on the Allocation page — seeds one dummy
// daily_work case per service for the given date (skips services that
// already have one for that date). Literal path, so it never collides
// with GET/PUT/PATCH/DELETE "/:id" below. Same permission as creating
// a real Daily Work batch.
router.post(
  "/seed-dummy",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  seedDummyCases,
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
