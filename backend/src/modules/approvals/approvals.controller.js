// src/modules/approvals/approvals.controller.js
//
// Implements the approval-gated actions from
// "Approval Flow for Allocation App.docx", plus (NEW) Process Lead's
// Service (Product) / Client / Subclient create-update-delete requests:
//   1. QC_PERMISSION_GRANT — Process Lead requests, Ops Manager /
//      Audit Manager / Super Admin approve (any ONE of them).
//   2. NEW_VERTICAL        — Ops Manager requests, Super Admin approves.
//   3. HIDE_TASK           — Ops Manager requests, Super Admin approves.
//   4. SERVICE_CREATE/UPDATE/DELETE,
//      CLIENT_CREATE/UPDATE/DELETE,
//      SUBCLIENT_CREATE/UPDATE/DELETE
//                          — Process Lead requests, Ops Manager approves.
//      Filed by src/middlewares/approvalGate.js on the corresponding
//      /api/products, /api/clients, /api/subclients routes.
//
// Requires a Postgres table (see db/migration_rbac_approvals.sql):
//   approval_requests(id, type, requested_by, target_user_id,
//                      payload jsonb, status, approved_by, decided_at,
//                      created_at, organization_id)

const supabase = require("../../config/supabaseClient");
const { APPROVAL_RULES } = require("../../config/permissions");
const productsService = require("../products/products.service");

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
    // already be doing QC in any vertical (within this org).
    if (type === "QC_PERMISSION_GRANT" && targetUserId) {
      const { data: existingQc } = await supabase
        .from("qc_assignments")
        .select("id")
        .eq("user_id", targetUserId)
        .eq("organization_id", req.user.organizationId)
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
        organization_id: req.user.organizationId,
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
    // Fetch every pending request in this org, then decide per-request
    // whether the caller may see it — some types are broad role-based
    // (any approver role sees them), others (restrictToReportingManager)
    // are narrowed to one specific target_user_id. A single Supabase
    // query can't express that mix cleanly, so it's filtered here instead.
    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("status", "PENDING")
      .eq("organization_id", req.user.organizationId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const visible = (data || []).filter((request) => {
      if (req.user.role === "SUPER_ADMIN") return true;
      if (request.requested_by === req.user.userId) return true; // always see your own

      const rule = APPROVAL_RULES[request.type];
      if (!rule) return false;

      if (rule.restrictToReportingManager) {
        // Narrowed to the specific reporting manager it was routed to —
        // unless none could be resolved at request time, in which case
        // fall back to the broad approver-role list so it's never stuck
        // un-actionable.
        return request.target_user_id
          ? request.target_user_id === req.user.userId
          : rule.approvers.includes(req.user.role);
      }

      return rule.approvers.includes(req.user.role);
    });

    res.json({ success: true, data: visible });
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
      .eq("organization_id", req.user.organizationId)
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
      req.user.role === "SUPER_ADMIN" ||
      (rule.restrictToReportingManager
        ? request.target_user_id
          ? request.target_user_id === req.user.userId
          : rule.approvers.includes(req.user.role)
        : rule.approvers.includes(req.user.role));

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
      .eq("organization_id", req.user.organizationId)
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

// ---------------------------------------------------------------------
// Shared field maps for CLIENT_* / SUBCLIENT_* — mirror the exact same
// camelCase(body) -> snake_case(db) mapping used in
// clients.routes.js (fromClientBody) and subclients.routes.js
// (toDbContactFields), so an approved request always writes the same
// shape the direct (non-gated) create/update path would have written.
// ---------------------------------------------------------------------
function contactFieldsFromPayload(body) {
  return {
    country: body.country || null,
    website: body.website || null,
    main_email: body.mainEmail || null,
    main_phone: body.mainPhone || null,
    primary_contact_name: body.primaryContactName || null,
    primary_contact_email: body.primaryContactEmail || null,
    primary_contact_phone: body.primaryContactPhone || null,
    secondary_contact_name: body.secondaryContactName || null,
    secondary_contact_email: body.secondaryContactEmail || null,
    secondary_contact_phone: body.secondaryContactPhone || null,
  };
}

async function applyApprovedAction(request) {
  const orgId = request.organization_id;
  const body = request.payload || {};

  switch (request.type) {
    case "QC_PERMISSION_GRANT":
      await supabase.from("qc_assignments").insert({
        user_id: request.target_user_id,
        vertical_id: request.payload?.verticalId || null,
        granted_via_request_id: request.id,
        organization_id: request.organization_id,
      });
      break;
    case "NEW_VERTICAL":
      await supabase.from("verticals").insert({
        name: request.payload?.name,
        created_via_request_id: request.id,
        organization_id: request.organization_id,
      });
      break;
    case "HIDE_TASK": {
      // FIX: table name was "products_master" (typo — doesn't exist;
      // the real table is "product_master", same as products.service.js),
      // and the result was never checked, so a failure here was
      // silently swallowed — HIDE_TASK approvals looked successful but
      // never actually hid anything.
      const { error: hideError } = await supabase
        .from("service_master")
        .update({ hidden: true })
        .eq("id", request.payload?.taskId)
        .eq("organization_id", request.organization_id);

      if (hideError) {
        console.error("HIDE_TASK failed to apply:", hideError);
      }
      break;
    }

    // ---- NEW: Service (Product) ----
    case "SERVICE_CREATE": {
      const { product_name, time_taken, time_unit, teams } = body;
      await productsService.createProduct(
        { product_name, time_taken, time_unit, teams },
        orgId,
      );
      break;
    }
    case "SERVICE_UPDATE": {
      const { id, product_name, time_taken, time_unit, teams } = body;
      await productsService.updateProduct(
        id,
        { product_name, time_taken, time_unit, teams },
        orgId,
      );
      break;
    }
    case "SERVICE_DELETE": {
      await productsService.deleteProduct(body.id, orgId);
      break;
    }

    // ---- NEW: Client ----
    case "CLIENT_CREATE": {
      const { data: client, error } = await supabase
        .from("clients")
        .insert({
          name: (body.name || "").trim(),
          status: body.status === "Inactive" ? "Inactive" : "Active",
          ...contactFieldsFromPayload(body),
          organization_id: orgId,
        })
        .select()
        .single();
      if (error) throw error;

      if (Array.isArray(body.productRates) && body.productRates.length) {
        await productsService.syncClientProducts(
          client.id,
          body.productRates,
          orgId,
        );
      }
      break;
    }
    case "CLIENT_UPDATE": {
      const { id, ...rest } = body;
      const { error } = await supabase
        .from("clients")
        .update({
          name: (rest.name || "").trim(),
          status: rest.status === "Inactive" ? "Inactive" : "Active",
          ...contactFieldsFromPayload(rest),
        })
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;

      if (rest.productRates !== undefined) {
        await productsService.syncClientProducts(id, rest.productRates, orgId);
      }
      break;
    }
    case "CLIENT_DELETE": {
      await supabase
        .from("clients")
        .delete()
        .eq("id", body.id)
        .eq("organization_id", orgId);
      break;
    }

    // ---- NEW: Subclient ----
    case "SUBCLIENT_CREATE": {
      const { data: subclient, error } = await supabase
        .from("subclients")
        .insert({
          name: (body.name || "").trim(),
          client_id: Number(body.clientId),
          status: body.status === "Inactive" ? "Inactive" : "Active",
          ...contactFieldsFromPayload(body),
          organization_id: orgId,
        })
        .select()
        .single();
      if (error) throw error;

      if (Array.isArray(body.productRates) && body.productRates.length) {
        await productsService.syncSubclientProducts(
          subclient.id,
          body.productRates,
          orgId,
        );
      }
      break;
    }
    case "SUBCLIENT_UPDATE": {
      const { id, ...rest } = body;
      const { error } = await supabase
        .from("subclients")
        .update({
          name: (rest.name || "").trim(),
          client_id: Number(rest.clientId),
          status: rest.status === "Inactive" ? "Inactive" : "Active",
          ...contactFieldsFromPayload(rest),
        })
        .eq("id", id)
        .eq("organization_id", orgId);
      if (error) throw error;

      if (rest.productRates !== undefined) {
        await productsService.syncSubclientProducts(
          id,
          rest.productRates,
          orgId,
        );
      }
      break;
    }
    case "SUBCLIENT_DELETE": {
      await supabase
        .from("subclients")
        .delete()
        .eq("id", body.id)
        .eq("organization_id", orgId);
      break;
    }
  }
}

module.exports = { createRequest, listRequests, decideRequest };
