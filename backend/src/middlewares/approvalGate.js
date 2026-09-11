// src/middlewares/approvalGate.js
//
// Sits between a permission check and the real controller on a
// create/update/delete route. If the caller's role is listed under
// APPROVAL_RULES[type].requestedBy (see src/config/permissions.js),
// the request is intercepted here: instead of reaching the real
// controller, it's filed as a PENDING row in approval_requests, and the
// response tells the caller it's now waiting on an approver. Nothing is
// actually created/updated/deleted until an eligible approver hits
// POST /api/approvals/:id/decision with APPROVE — see
// applyApprovedAction() in approvals.controller.js for what runs then.
//
// Any role NOT listed in requestedBy for this type is unaffected —
// next() is called immediately and the real controller runs as normal.
// This means, for example, Ops Manager and Super Admin's own
// create/update/delete on Services/Clients/Subclients still take effect
// immediately; only Process Lead's get gated (per APPROVAL_RULES).

const fs = require("fs");
const supabase = require("../config/supabaseClient");
const { APPROVAL_RULES } = require("../config/permissions");

// Looks up the requester's own "Reporting Manager" (stored as an email
// string on user_master — see employees.controller.js's mapRow), then
// resolves THAT email to its own Auth User Id. Returns null if the
// requester has no reporting manager set, or if that email doesn't match
// any user in this org — callers must handle null by falling back to the
// role-based approver list (see APPROVAL_RULES[type].approvers), so a
// request never becomes permanently un-actionable just because the
// employee record is incomplete.
async function resolveReportingManagerId(requesterUserId, organizationId) {
  const { data: requester, error: requesterErr } = await supabase
    .from("user_master")
    .select('"Reporting Manager"')
    .eq("Auth User Id", requesterUserId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (requesterErr || !requester) return null;

  const managerEmail = requester["Reporting Manager"];
  if (!managerEmail) return null;

  const { data: manager, error: managerErr } = await supabase
    .from("user_master")
    .select('"Auth User Id"')
    .eq("Email", managerEmail)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (managerErr || !manager) return null;
  return manager["Auth User Id"] || null;
}

/**
 * @param {string} type - one of the keys in APPROVAL_RULES (e.g. "SERVICE_CREATE")
 * @param {object} [options]
 * @param {boolean} [options.includeParamsId] - merge req.params.id into the
 *   stored payload as `id` (needed for UPDATE/DELETE, where the target
 *   record's id lives in the URL, not the body).
 */
function approvalGate(type, { includeParamsId = false } = {}) {
  return async (req, res, next) => {
    try {
      const rule = APPROVAL_RULES[type];
      if (!rule) {
        // Misconfigured call site (typo'd type) — fail loudly in
        // development rather than silently letting the write through.
        return res.status(500).json({
          success: false,
          message: `approvalGate: unknown approval type "${type}"`,
        });
      }

      if (!rule.requestedBy.includes(req.user.role)) {
        // This role acts directly — not gated for this action.
        return next();
      }

      const payload = includeParamsId
        ? { id: req.params.id, ...req.body }
        : { ...req.body };

      // When this rule is meant to go specifically to the requester's own
      // reporting manager (rather than any Ops Manager broadly), resolve
      // that now. Falls back to null (broad role-based approval, handled
      // in approvals.controller.js) if no manager could be resolved.
      const targetUserId = rule.restrictToReportingManager
        ? await resolveReportingManagerId(
            req.user.userId,
            req.user.organizationId,
          )
        : null;

      const { data, error } = await supabase
        .from("approval_requests")
        .insert({
          type,
          requested_by: req.user.userId,
          target_user_id: targetUserId,
          payload,
          status: "PENDING",
          organization_id: req.user.organizationId,
        })
        .select()
        .single();

      if (error) throw error;

      // 202 Accepted: request understood, but the actual effect hasn't
      // happened yet — distinct from the 200/201 a direct create/update
      // would return, so the frontend can tell the two apart if needed.
      return res.status(202).json({
        success: true,
        pendingApproval: true,
        message:
          "Submitted for approval — an Ops Manager needs to approve this before it takes effect.",
        data,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };
}

/**
 * Same idea as approvalGate() above, but for bulk-upload (Excel/CSV)
 * routes, which arrive as multer's `req.file` rather than a JSON
 * `req.body` — approvalGate() can't gate those directly since there'd
 * be nothing meaningful to store as `payload`.
 *
 * Sits AFTER multer (so req.file is populated) and BEFORE the real bulk
 * controller. If the caller's role is listed under
 * APPROVAL_RULES[type].requestedBy, the uploaded file is parsed into
 * rows right here (via the caller-supplied `parseRows` function — the
 * SAME parsing function the real controller itself uses, so a
 * later-approved request replays against identical rows) and stored as
 * the request's payload (`{ rows }`) instead of ever reaching the
 * controller. Any role NOT listed acts immediately — next() is called
 * and the real controller parses + processes the file itself, unchanged.
 *
 * @param {string} type - one of the keys in APPROVAL_RULES (e.g.
 *   "CLIENT_BULK_CREATE").
 * @param {(file: Express.Multer.File) => Array<object>} parseRows -
 *   turns the uploaded file into an array of row objects. Errors thrown
 *   here are treated as a bad upload (400), not a server error.
 */
function bulkApprovalGate(type, parseRows) {
  return async (req, res, next) => {
    try {
      const rule = APPROVAL_RULES[type];
      if (!rule) {
        return res.status(500).json({
          success: false,
          message: `bulkApprovalGate: unknown approval type "${type}"`,
        });
      }

      if (!rule.requestedBy.includes(req.user.role)) {
        // This role acts directly — not gated for this action.
        return next();
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      let rows;
      try {
        rows = parseRows(req.file);
      } catch (parseErr) {
        if (req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          message: parseErr.message || "Could not parse uploaded file",
        });
      }

      // Disk-storage uploads (multer `dest`) leave a temp file behind —
      // it's now been read into `rows` and won't be touched again by the
      // real controller (that never runs for a gated role), so clean it
      // up here. memoryStorage uploads have no `.path` and need nothing.
      if (req.file.path) fs.unlink(req.file.path, () => {});

      if (!Array.isArray(rows) || rows.length === 0) {
        return res
          .status(400)
          .json({ message: "Uploaded file has no data rows" });
      }

      const targetUserId = rule.restrictToReportingManager
        ? await resolveReportingManagerId(
            req.user.userId,
            req.user.organizationId,
          )
        : null;

      const { data, error } = await supabase
        .from("approval_requests")
        .insert({
          type,
          requested_by: req.user.userId,
          target_user_id: targetUserId,
          payload: { rows },
          status: "PENDING",
          organization_id: req.user.organizationId,
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(202).json({
        success: true,
        pendingApproval: true,
        message:
          "Submitted for approval — an Ops Manager needs to approve this before it takes effect.",
        data,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  };
}

module.exports = { approvalGate, bulkApprovalGate };
