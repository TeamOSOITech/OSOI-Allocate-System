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
const productsController = require("../products/products.controller");
const clientsController = require("../clients/clients.controller");
const userService = require("../users/user.service");

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

// Shared by listRequests (PENDING) and listHistory (APPROVED/REJECTED):
// fetches every request in this org matching `statuses`, narrows to
// whichever ones this caller is allowed to see (SUPER_ADMIN sees all,
// everyone sees their own, approvers see whatever they're eligible to
// decide — same rule whether it's still pending or already decided),
// then attaches human names for both the requester and (if decided)
// whoever approved/rejected it, instead of leaving the frontend with
// raw UUIDs.
async function visibleRequestsFor(req, statuses) {
  const { data, error } = await supabase
    .from("approval_requests")
    .select("*")
    .in("status", statuses)
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

  // One batched lookup for every distinct requester/decider in this
  // page of results, instead of an N+1 query.
  const userIds = Array.from(
    new Set([
      ...visible.map((r) => r.requested_by),
      ...visible.map((r) => r.approved_by),
    ]),
  ).filter(Boolean);

  let infoById = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("user_master")
      .select('"Auth User Id", "First Name", "Last Name", "Role"')
      .in("Auth User Id", userIds);

    infoById = (users || []).reduce((acc, u) => {
      const name = [u["First Name"], u["Last Name"]]
        .filter(Boolean)
        .join(" ")
        .trim();
      acc[u["Auth User Id"]] = {
        name: name || null,
        role: u["Role"] || null,
      };
      return acc;
    }, {});
  }

  return visible.map((r) => ({
    ...r,
    requestedByName: infoById[r.requested_by]?.name || null,
    requestedByRole: infoById[r.requested_by]?.role || null,
    decidedByName: infoById[r.approved_by]?.name || null,
  }));
}

async function listRequests(req, res) {
  try {
    const enriched = await visibleRequestsFor(req, ["PENDING"]);
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// NEW: GET /api/approvals/history — everything this caller is eligible
// to see that's already been decided (APPROVED or REJECTED), newest
// first. Same visibility rule as the pending list above, just without
// the status=PENDING filter. `counts` is a quick total/approved/rejected
// breakdown over exactly what's returned, so the frontend doesn't have
// to recompute it (or refetch) just to show a summary strip.
async function listHistory(req, res) {
  try {
    const enriched = await visibleRequestsFor(req, ["APPROVED", "REJECTED"]);
    const counts = enriched.reduce(
      (acc, r) => {
        acc.total += 1;
        if (r.status === "APPROVED") acc.approved += 1;
        else if (r.status === "REJECTED") acc.rejected += 1;
        return acc;
      },
      { total: 0, approved: 0, rejected: 0 },
    );
    res.json({ success: true, data: enriched, counts });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

async function decideRequest(req, res) {
  try {
    const { id } = req.params;
    const { decision, remarks } = req.body; // remarks: optional on APPROVE, required on REJECT

    if (!["APPROVE", "REJECT"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "decision must be APPROVE or REJECT",
      });
    }

    // NEW: remarks are mandatory on REJECT (so there's always a reason
    // on record for whoever requested it), optional on APPROVE. Mirrors
    // the same rule enforced in the frontend's reject modal — checked
    // here too so a direct API call can't skip it.
    if (decision === "REJECT" && (!remarks || !remarks.trim())) {
      return res.status(400).json({
        success: false,
        message: "Remarks are required when rejecting a request.",
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
        // FIX: this used to always send `remarks` (even null) on every
        // decision, including APPROVE — which broke Approve entirely on
        // any org that hasn't run the "ALTER TABLE approval_requests ADD
        // COLUMN remarks text" migration yet (Postgrest errors on an
        // unknown column in the update body). Only touch the column when
        // there's an actual remark to store — Approve never sends one, so
        // it no longer depends on that column existing at all.
        ...(typeof remarks === "string" && remarks.trim()
          ? { remarks: remarks.trim() }
          : {}),
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

    // ---- NEW: User (Add User) ----
    // Re-runs the FULL add-user validation (professional email, tenant
    // domain lock, assignable-role, phone format, reporting manager,
    // duplicate email, seat limit) against the original Process Lead
    // requester's identity — not the approving Ops Manager's — then
    // creates the account. See userService.processAddUserRequest() for
    // why this re-checks rather than trusting whatever passed when the
    // request was first filed.
    case "USER_CREATE": {
      const requesterCtx = await userService.getRequesterContext(
        request.requested_by,
        orgId,
      );
      if (!requesterCtx) {
        console.error(
          `USER_CREATE approval ${request.id}: could not resolve original requester ${request.requested_by} — user not created.`,
        );
        break;
      }

      const result = await userService.processAddUserRequest(body, {
        role: requesterCtx.role,
        email: requesterCtx.email,
        organizationId: orgId,
      });

      // The approval decision itself has already been recorded as
      // APPROVED at this point — a validation failure here (e.g. seat
      // limit filled up, or the email got taken while this sat PENDING)
      // means the account was never actually created. Logged loudly
      // rather than thrown, same pattern as HIDE_TASK above, so one bad
      // request doesn't fail the whole decideRequest() call.
      if (result.statusCode >= 400) {
        console.error(
          `USER_CREATE approval ${request.id} failed to apply:`,
          result.body,
        );
      }
      break;
    }

    // ---- NEW: bulk-upload counterparts of the CREATE cases above ----
    // Each replays the SAME row-processing function the direct
    // (non-gated) bulk-upload path uses, against the `rows` array that
    // bulkApprovalGate() (or, for users, approvalGate()) parsed and
    // stored at request time. Per-row results aren't surfaced anywhere
    // (there's no requester-facing response at approval time), so
    // failures are just logged — same pattern as HIDE_TASK/USER_CREATE
    // above, so one bad row/request doesn't fail the whole decision.
    case "CLIENT_BULK_CREATE": {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const { failedCount, results } =
        await clientsController.processClientBulkRows(rows, orgId);
      if (failedCount > 0) {
        console.error(
          `CLIENT_BULK_CREATE approval ${request.id}: ${failedCount}/${rows.length} row(s) failed:`,
          results.filter((r) => r.status === "failed"),
        );
      }
      break;
    }
    case "SERVICE_BULK_CREATE": {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const { failedCount, results } =
        await productsController.processProductBulkRows(rows, orgId);
      if (failedCount > 0) {
        console.error(
          `SERVICE_BULK_CREATE approval ${request.id}: ${failedCount}/${rows.length} row(s) failed:`,
          results.filter((r) => !r.success),
        );
      }
      break;
    }
    case "USER_BULK_CREATE": {
      const users = Array.isArray(body.users) ? body.users : [];
      const requesterCtx = await userService.getRequesterContext(
        request.requested_by,
        orgId,
      );
      if (!requesterCtx) {
        console.error(
          `USER_BULK_CREATE approval ${request.id}: could not resolve original requester ${request.requested_by} — no users created.`,
        );
        break;
      }

      const results = await userService.processBulkAddUserRequest(users, {
        role: requesterCtx.role,
        email: requesterCtx.email,
        organizationId: orgId,
      });
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        console.error(
          `USER_BULK_CREATE approval ${request.id}: ${failed.length}/${results.length} row(s) failed:`,
          failed,
        );
      }
      break;
    }
  }
}

module.exports = { createRequest, listRequests, listHistory, decideRequest };
