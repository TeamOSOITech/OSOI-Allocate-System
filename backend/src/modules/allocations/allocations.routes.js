const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listAllocations,
  autoAllocate,
  manualAllocate,
  selfAllocate,
  bulkUpsertAllocations,
  transferAllocation,
  updateAllocationStatus,
  submitAllocationWork,
  bulkSubmitAllocationWork,
  clearAllocationsForBatch,
} = require("./allocations.controller");

router.use(authenticate);

// Viewing allocations — any authenticated user (an employee needs to
// see their own row; managers need to see everyone's).
router.get("/", listAllocations);

// Creating allocations (auto-split or manual) is an allocate action —
// same permission as task allocation (Vertical Head = own team,
// Process Lead/Ops Manager/Super Admin = org-wide).
router.post(
  "/auto",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  autoAllocate,
);
router.post(
  "/manual",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  manualAllocate,
);
// NEW: self-allocation — Team Member / Vertical Head picking up PENDING
// work for THEMSELVES on the redesigned Today's Allocation page. Separate
// permission code (tasks.allocate.self) from the manager routes above —
// holding tasks.allocate.team/org does NOT grant this route, and holding
// tasks.allocate.self does NOT grant the manager routes above. The
// controller itself also hard-codes employee_id to req.user.userId, so
// even a tampered request body can never target someone else.
router.post("/self", requireAnyPermission("tasks.allocate.self"), selfAllocate);
router.post(
  "/bulk-upsert",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  bulkUpsertAllocations,
);
router.post(
  "/transfer",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  transferAllocation,
);
router.delete(
  "/by-daily-work/:dailyWorkId",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  clearAllocationsForBatch,
);

// Status update: ownership vs. manager-permission check happens
// inside the controller itself (an employee can update their OWN
// allocation without holding the allocate permission).
router.patch("/:id/status", updateAllocationStatus);

// Submitting completed work: same self-or-manager rule as above.
// Bulk route (literal path) comes first so it can never be shadowed
// by the "/:id/submit" pattern below.
router.patch("/bulk-submit", bulkSubmitAllocationWork);
router.patch("/:id/submit", submitAllocationWork);

module.exports = router;
