const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const {
  createRequest,
  listRequests,
  decideRequest,
} = require("./approvals.controller");

router.use(authenticate);

// Raise a request (QC_PERMISSION_GRANT / NEW_VERTICAL / HIDE_TASK).
// Eligibility to request is checked per-type inside the controller,
// against APPROVAL_RULES in src/config/permissions.js.
router.post("/", createRequest);

// List pending requests this user is eligible to act on (or their own).
router.get("/", listRequests);

// Approve or reject. Eligibility to decide is checked per-type inside
// the controller as well.
router.post("/:id/decision", decideRequest);

module.exports = router;
