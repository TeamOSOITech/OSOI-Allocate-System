const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listAllocations,
  autoAllocate,
  manualAllocate,
  bulkUpsertAllocations,
  transferAllocation,
  updateAllocationStatus,
  submitAllocationWork,
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
router.patch("/:id/submit", submitAllocationWork);

module.exports = router;
