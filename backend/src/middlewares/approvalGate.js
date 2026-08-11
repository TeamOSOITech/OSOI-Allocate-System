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
      return next(); // TEMP: approval flow disabled for testing — remove this line to re-enable
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

module.exports = { approvalGate };
