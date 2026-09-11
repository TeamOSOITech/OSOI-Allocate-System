const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const {
  createRequest,
  listRequests,
  listHistory,
  decideRequest,
} = require("./approvals.controller");

router.use(authenticate);

// Raise a request (QC_PERMISSION_GRANT / NEW_VERTICAL / HIDE_TASK).
// Eligibility to request is checked per-type inside the controller,
// against APPROVAL_RULES in src/config/permissions.js.
router.post("/", createRequest);

// List pending requests this user is eligible to act on (or their own).
router.get("/", listRequests);

// NEW: decided requests (APPROVED/REJECTED) this user is eligible to
// see — same visibility rule as the pending list, just already decided.
// Placed before "/:id/decision" isn't a concern here since it's a GET
// on a distinct path, but kept above listRequests' plain "/" for
// readability.
router.get("/history", listHistory);

// Approve or reject. Eligibility to decide is checked per-type inside
// the controller as well.
router.post("/:id/decision", decideRequest);

module.exports = router;
