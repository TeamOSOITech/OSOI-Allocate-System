// src/modules/externalmembers/externalmembers.routes.js
const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const {
  listExternalMembers,
  saveExternalMembers,
} = require("./externalmembers.controller");

router.use(authenticate);

// Viewing which externals are already added for a service+date — same
// access level as viewing attendance (any authenticated user).
router.get("/", listExternalMembers);

// Saving external members feeds straight into allocation eligibility
// (see todaysallocationcases.tsx), so it uses the same permission as
// marking attendance / running Smart Allocation.
router.put(
  "/",
  requireAnyPermission("tasks.allocate.team", "tasks.allocate.org"),
  saveExternalMembers,
);

module.exports = router;
