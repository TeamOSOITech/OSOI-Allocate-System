// user.controller.js
//
// Req/res handling for user creation (single + bulk). All the actual
// validation rules and Supabase/DB work live in user.service.js — this
// file just orchestrates: read the request, call the service, shape the
// response. Wired up by user.routes.js.

const userService = require("./user.service");

// ---------------------------------------------------------------------------
// POST /api/users/add-user  (single user)
//
// APPROVAL: when the caller is PROCESS_LEAD, this route never actually
// reaches here — approvalGate("USER_CREATE") (see user.routes.js) files
// the request into approval_requests instead. Only callers who act
// directly (Ops Manager, Super Admin) hit this handler. All the actual
// validation + creation logic now lives in
// userService.processAddUserRequest() so the SAME checks run again, on a
// Process Lead's original payload, once an Ops Manager approves it — see
// applyApprovedAction()'s USER_CREATE case in approvals.controller.js.
// ---------------------------------------------------------------------------
async function addUser(req, res) {
  try {
    const result = await userService.processAddUserRequest(req.body, {
      role: req.user.role,
      email: req.user.email,
      organizationId: req.user.organizationId,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    console.error("add-user error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Failed to create user." });
  }
}

// ---------------------------------------------------------------------------
// POST /api/users/bulk-add-user  (array of users from Excel)
//
// APPROVAL: when the caller is PROCESS_LEAD, this route never actually
// reaches here — approvalGate("USER_BULK_CREATE") (see user.routes.js)
// files the request into approval_requests instead, same pattern as
// add-user above. Only callers who act directly (Ops Manager, Super
// Admin) hit this handler. All the actual per-row validation + creation
// logic now lives in userService.processBulkAddUserRequest() so the SAME
// checks run again, on a Process Lead's original rows, once an Ops
// Manager approves it — see applyApprovedAction()'s USER_BULK_CREATE
// case in approvals.controller.js.
// ---------------------------------------------------------------------------
async function bulkAddUser(req, res) {
  try {
    const users = Array.isArray(req.body?.users) ? req.body.users : [];
    if (users.length === 0) {
      return res.status(400).json({ message: "No users provided." });
    }

    const results = await userService.processBulkAddUserRequest(users, {
      role: req.user.role,
      email: req.user.email,
      organizationId: req.user.organizationId,
    });

    return res.status(200).json({ results });
  } catch (err) {
    console.error("bulk-add-user error:", err);
    return res
      .status(500)
      .json({ message: err.message || "Bulk upload failed." });
  }
}

module.exports = {
  addUser,
  bulkAddUser,
};
