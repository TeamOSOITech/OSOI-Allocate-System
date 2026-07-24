// src/modules/approvals/approvals.controller.js
//
// Implements the three approval-gated actions from
// "Approval Flow for Allocation App.docx":
//   1. QC_PERMISSION_GRANT — Process Lead requests, Ops Manager /
//      Audit Manager / Super Admin approve (any ONE of them).
//   2. NEW_VERTICAL        — Ops Manager requests, Super Admin approves.
//   3. HIDE_TASK           — Ops Manager requests, Super Admin approves.
//
// Requires a Postgres table (see db/migration_rbac_approvals.sql):
//   approval_requests(id, type, requested_by, target_user_id,
//                      payload jsonb, status, approved_by, decided_at,
//                      created_at)

const supabase = require("../../config/supabaseClient");
const { APPROVAL_RULES } = require("../../config/permissions");

async function createRequest(req, res) {
  try {
    const { type, targetUserId, payload } = req.body;
    const rule = APPROVAL_RULES[type];

    if (!rule) {
      return res.status(400).json({
        success: false,
        message: `Unknown approval type: ${type}`,
      });
    }

    if (!rule.requestedBy.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `${req.user.role} cannot request ${type}`,
      });
    }

    // Business rule for QC_PERMISSION_GRANT: target user must not
    // already be doing QC in any vertical.
    if (type === "QC_PERMISSION_GRANT" && targetUserId) {
      const { data: existingQc } = await supabase
        .from("qc_assignments")
        .select("id")
        .eq("user_id", targetUserId)
        .limit(1);

      if (existingQc && existingQc.length > 0) {
        return res.status(409).json({
          success: false,
          message:
            "User already performs QC tasks in a vertical — cannot grant again",
        });
      }
    }

    const { data, error } = await supabase
      .from("approval_requests")
      .insert({
        type,
        requested_by: req.user.userId,
        target_user_id: targetUserId || null,
        payload: payload || {},
        status: "PENDING",
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

async function listRequests(req, res) {
  try {
    // A user only sees requests they're eligible to act on (or their own).
    const eligibleTypes = Object.entries(APPROVAL_RULES)
      .filter(([, rule]) => rule.approvers.includes(req.user.role))
      .map(([type]) => type);

    let query = supabase
      .from("approval_requests")
      .select("*")
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });

    if (req.user.role !== "SUPER_ADMIN") {
      // Super Admin can override/see everything; everyone else only
      // sees pending requests they're allowed to decide on, plus their own.
      query = query.or(
        `type.in.(${eligibleTypes.length ? eligibleTypes.join(",") : "NONE"}),requested_by.eq.${req.user.userId}`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

async function decideRequest(req, res) {
  try {
    const { id } = req.params;
    const { decision } = req.body; // "APPROVE" | "REJECT"

    if (!["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "decision must be APPROVE or REJECT",
      });
    }

    const { data: request, error: fetchError } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !request) {
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    }

    if (request.status !== "PENDING") {
      return res
        .status(409)
        .json({ success: false, message: `Request already ${request.status}` });
    }

    const rule = APPROVAL_RULES[request.type];
    const isEligibleApprover =
      req.user.role === "SUPER_ADMIN" || rule.approvers.includes(req.user.role);

    if (!isEligibleApprover) {
      return res.status(403).json({
        success: false,
        message: `${req.user.role} cannot decide on ${request.type}`,
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from("approval_requests")
      .update({
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        approved_by: req.user.userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Apply the side effect only on approval.
    if (decision === "APPROVE") {
      await applyApprovedAction(request);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

async function applyApprovedAction(request) {
  switch (request.type) {
    case "QC_PERMISSION_GRANT":
      await supabase.from("qc_assignments").insert({
        user_id: request.target_user_id,
        vertical_id: request.payload?.verticalId || null,
        granted_via_request_id: request.id,
      });
      break;
    case "NEW_VERTICAL":
      await supabase.from("verticals").insert({
        name: request.payload?.name,
        created_via_request_id: request.id,
      });
      break;
    case "HIDE_TASK":
      await supabase
        .from("products_master")
        .update({ hidden: true })
        .eq("id", request.payload?.taskId);
      break;
  }
}

module.exports = { createRequest, listRequests, decideRequest };
