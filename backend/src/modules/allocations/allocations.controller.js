// src/modules/allocations/allocations.controller.js
//
// PAGE 3 (Smart Auto Allocation) + PAGE 4 (Manual Allocation).
//
// Formula (per spec): base_qty = floor(total / present)
//                      pending  = total - (base_qty * present_count)
//
// Req/res handling, permission checks, and the allocation math live
// here. All raw Supabase/DB access lives in allocations.service.js.
// Every operation is still scoped to req.user.organizationId — this is
// the actual multi-tenant enforcement point, enforced inside the
// service's queries.

const { hasPermission } = require("../../config/permissions");
const allocationsService = require("./allocations.service");

// ------------------------------------------------------------
// GET /api/allocations/history
// query: ?dateFrom&dateTo&employeeId&productId&clientId&subclientId&status
//
// NEW: powers the History page — one filterable view across every
// allocation (employee-wise, service-wise, client-wise, subclient-
// wise, date-wise, completed/pending). Manager/admin-only (same
// permission as the Reports "team" endpoint), unlike listAllocations
// below which any employee can call for their own rows.
//
// Client/subclient are NOT columns on daily_work or allocations —
// a service (service_master row) is linked to clients/subclients via
// the client_products / subclient_products join tables (and a single
// service CAN be linked to more than one client, per the reversed-
// rate-mapping design in products.service.js). So filtering by
// client/subclient here means "this row's service is linked to that
// client/subclient", resolved via those join tables rather than a
// direct foreign key on the allocation itself.
// ------------------------------------------------------------
async function getAllocationHistory(req, res) {
  try {
    const orgId = req.user.organizationId;
    const {
      dateFrom,
      dateTo,
      employeeId,
      productId,
      clientId,
      subclientId,
      status,
    } = req.query;

    // ---- daily_work rows in range (date + service filters apply here) ----
    const dwRows = await allocationsService.fetchDailyWorkInRange(orgId, {
      dateFrom,
      dateTo,
      productId,
    });

    const dailyWorkIds = dwRows.map((d) => d.id);
    if (dailyWorkIds.length === 0) {
      return res.json({ success: true, data: [], meta: { truncated: false } });
    }

    // ---- allocations for those batches (employee filter applies here) ----
    const allocations = await allocationsService.fetchAllocationsForBatches(
      orgId,
      dailyWorkIds,
      employeeId,
    );

    let rows = allocations;
    if (status === "completed") {
      rows = rows.filter(
        (a) => a.submitted_qty !== null && a.submitted_qty !== undefined,
      );
    } else if (status === "pending") {
      rows = rows.filter(
        (a) => a.submitted_qty === null || a.submitted_qty === undefined,
      );
    }

    // Safety cap — this is a history/export view, not a live dashboard,
    // so a wide/unfiltered date range shouldn't be able to pull an
    // unbounded number of rows into memory in one request. The frontend
    // shows a "showing latest N of M — narrow your filters" note when
    // this trips.
    const HISTORY_ROW_CAP = 5000;
    const totalMatched = rows.length;
    const truncated = totalMatched > HISTORY_ROW_CAP;
    rows = rows.slice(0, HISTORY_ROW_CAP);

    // ---- enrichment: product/date, employee/team, allocated-by ----
    const dailyWorkMap = await allocationsService.getDailyWorkMap(
      rows.map((a) => a.daily_work_id),
    );
    const userInfoMap = await allocationsService.getUserInfoMap(
      rows.flatMap((a) => [a.employee_id, a.created_by]),
    );

    // ---- client/subclient linkage per service ----
    const { clientLinks, clientRows, subclientLinks, subclientRows } =
      await allocationsService.fetchClientSubclientLinkage(orgId);

    const clientNameById = new Map(clientRows.map((c) => [c.id, c.name]));
    const subclientNameById = new Map(subclientRows.map((s) => [s.id, s.name]));

    const clientsByProduct = new Map();
    clientLinks.forEach((l) => {
      const name = clientNameById.get(l.client_id);
      if (!name) return;
      const list = clientsByProduct.get(l.product_id) || [];
      list.push({ id: l.client_id, name });
      clientsByProduct.set(l.product_id, list);
    });

    const subclientsByProduct = new Map();
    subclientLinks.forEach((l) => {
      const name = subclientNameById.get(l.subclient_id);
      if (!name) return;
      const list = subclientsByProduct.get(l.product_id) || [];
      list.push({ id: l.subclient_id, name });
      subclientsByProduct.set(l.product_id, list);
    });

    let enriched = rows.map((a) => {
      const dw = dailyWorkMap[a.daily_work_id];
      const svcId = dw?.productId ?? null;
      const isCompleted =
        a.submitted_qty !== null && a.submitted_qty !== undefined;
      return {
        id: a.id,
        workDate: dw?.workDate || null,
        serviceId: svcId,
        serviceName: dw?.productName || null,
        employeeId: a.employee_id,
        employeeName: userInfoMap[a.employee_id]?.name || null,
        team: userInfoMap[a.employee_id]?.team || null,
        allocatedByName: userInfoMap[a.created_by]?.name || null,
        allocatedQty: a.allocated_qty,
        submittedQty: a.submitted_qty,
        status: isCompleted ? "COMPLETED" : "PENDING",
        submissionReason: a.submission_reason || null,
        submittedAt: a.submitted_at || null,
        clients: clientsByProduct.get(svcId) || [],
        subclients: subclientsByProduct.get(svcId) || [],
      };
    });

    if (clientId) {
      enriched = enriched.filter((r) =>
        r.clients.some((c) => String(c.id) === String(clientId)),
      );
    }
    if (subclientId) {
      enriched = enriched.filter((r) =>
        r.subclients.some((s) => String(s.id) === String(subclientId)),
      );
    }

    return res.json({
      success: true,
      data: enriched,
      meta: { truncated, totalMatched },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// GET /api/allocations?dailyWorkId=...&employeeId=...
//
// employeeId lets the Profile page pull "my allocations" (today's +
// history). Anyone can pass their own userId; seeing someone ELSE's
// allocations still requires an allocate/manage permission — same
// self-or-manager rule already used by PATCH /:id/status below.
// ------------------------------------------------------------
async function listAllocations(req, res) {
  try {
    const { dailyWorkId, employeeId } = req.query;

    if (employeeId && employeeId !== req.user.userId) {
      const canViewOthers =
        hasPermission(req.user.role, "tasks.allocate.team") ||
        hasPermission(req.user.role, "tasks.allocate.org");
      if (!canViewOthers) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied" });
      }
    }

    const data = await allocationsService.fetchAllocations(
      req.user.organizationId,
      { dailyWorkId, employeeId },
    );

    const dailyWorkMap = await allocationsService.getDailyWorkMap(
      data.map((a) => a.daily_work_id),
    );
    // Team comes from the allocated employee's own profile; "Allocated
    // By" comes from whoever's user_master row matches created_by —
    // both looked up together in one batched query.
    const userInfoMap = await allocationsService.getUserInfoMap(
      data.flatMap((a) => [a.employee_id, a.created_by]),
    );
    const enriched = data.map((a) => ({
      ...a,
      workDate: dailyWorkMap[a.daily_work_id]?.workDate || null,
      productName: dailyWorkMap[a.daily_work_id]?.productName || null,
      batchTotalQty: dailyWorkMap[a.daily_work_id]?.totalQty ?? null,
      team: userInfoMap[a.employee_id]?.team || null,
      allocatedByName: userInfoMap[a.created_by]?.name || null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/allocations/auto
// body: { dailyWorkId }
//
// Everyone marked PRESENT gets base_qty = floor(total / present).
// The leftover remainder (always < present, by definition of floor
// division) is NOT left unassigned — it's handed out one extra unit
// at a time starting from employee #1 in the list, then #2, #3...
// until the remainder runs out. So the full total_qty is always
// allocated; nothing sits as "pending" after auto-allocate.
//
// Example: total=499, present=100 -> base=4, remainder=99.
// Employees 1-99 get 5 (4+1), employee 100 gets 4. Sum = 499. ✓
// ------------------------------------------------------------
async function autoAllocate(req, res) {
  try {
    const { dailyWorkId } = req.body;
    if (!dailyWorkId) {
      return res
        .status(400)
        .json({ success: false, message: "dailyWorkId is required" });
    }

    const dailyWork = await allocationsService.getOwnedDailyWork(
      dailyWorkId,
      req.user.organizationId,
    );
    if (!dailyWork) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    // Don't allow re-running auto-allocate on a batch that's already
    // been allocated (auto or manual) — would silently double-allocate
    // the same total_qty. Caller should clear first if they really
    // want to redo it.
    const alreadyHasAllocations =
      await allocationsService.hasAnyAllocations(dailyWorkId);
    if (alreadyHasAllocations) {
      return res.status(409).json({
        success: false,
        message:
          "This batch already has allocations. Clear them first before re-running auto-allocate.",
      });
    }

    const presentRows = await allocationsService.fetchPresentEmployees(
      req.user.organizationId,
      dailyWork.work_date,
    );

    const presentCount = presentRows.length;
    if (presentCount === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No employees marked PRESENT for this date — mark attendance first.",
      });
    }

    const baseQty = Math.floor(dailyWork.total_qty / presentCount);
    const remainder = dailyWork.total_qty - baseQty * presentCount;

    // ---- Carry forward yesterday's (or any earlier day's) leftover
    // pending qty for the SAME product, for whichever of today's
    // present employees still have it. An employee's backlog on this
    // product is: allocated_qty - (submitted_qty || 0), summed across
    // every earlier allocation of theirs on this product that (a) is
    // still short and (b) hasn't already been rolled into a later
    // allocation (carried_forward = false) — that flag is what stops
    // the same backlog being added a second time on day 3, 4, etc.
    // Only earlier batches of THIS product count; a different product
    // does not bleed its backlog into this one.
    const presentIds = presentRows.map((p) => p.employee_id);
    const backlogByEmployee = {};
    const carriedAllocationIds = [];

    if (dailyWork.product_id) {
      const pastBatchIds = await allocationsService.fetchPastBatchIds(
        req.user.organizationId,
        dailyWork.product_id,
        dailyWork.work_date,
      );

      if (pastBatchIds.length > 0) {
        const pastAllocations =
          await allocationsService.fetchCarryForwardAllocations(
            pastBatchIds,
            presentIds,
          );

        for (const row of pastAllocations) {
          const shortfall = row.allocated_qty - (row.submitted_qty ?? 0);
          if (shortfall > 0) {
            backlogByEmployee[row.employee_id] =
              (backlogByEmployee[row.employee_id] || 0) + shortfall;
            carriedAllocationIds.push(row.id);
          }
        }
      }
    }

    const rows = presentRows.map((p, index) => {
      const carriedInQty = backlogByEmployee[p.employee_id] || 0;
      return {
        organization_id: req.user.organizationId,
        daily_work_id: dailyWorkId,
        employee_id: p.employee_id,
        // First `remainder` employees (index 0, 1, 2...) get +1, plus
        // any backlog they're still owed on this product.
        allocated_qty: baseQty + (index < remainder ? 1 : 0) + carriedInQty,
        allocation_type: "AUTO",
        status: "ASSIGNED",
        created_by: req.user.userId,
        carried_in_qty: carriedInQty,
      };
    });

    const inserted = await allocationsService.insertAllocations(rows);

    // Now that the backlog has a new home, mark the old rows so a
    // later batch of this product doesn't carry the same shortfall
    // forward again.
    await allocationsService.markAllocationsCarriedForward(
      carriedAllocationIds,
    );

    const totalCarriedIn = Object.values(backlogByEmployee).reduce(
      (s, v) => s + v,
      0,
    );

    res.status(201).json({
      success: true,
      data: {
        allocations: inserted,
        summary: {
          totalQty: dailyWork.total_qty,
          presentCount,
          baseQtyPerEmployee: baseQty,
          employeesWithExtraUnit: remainder,
          allocatedQty: dailyWork.total_qty, // always fully allocated now
          pendingQty: 0,
          carriedInQty: totalCarriedIn,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/allocations/manual
// body: { dailyWorkId, allocations: [{ employeeId, qty }, ...] }
//
// Lets a manager hand out exact quantities per employee instead of
// the equal auto-split. Validates the sum never exceeds total_qty —
// remaining "pending" is total_qty minus whatever's been allocated
// so far (across BOTH auto and manual rows for this batch, so the
// two flows can be combined — e.g. auto-split most of it, then
// manually hand out the auto-allocate's leftover remainder).
// ------------------------------------------------------------
async function manualAllocate(req, res) {
  try {
    const { dailyWorkId, allocations } = req.body;
    if (
      !dailyWorkId ||
      !Array.isArray(allocations) ||
      allocations.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "dailyWorkId and a non-empty allocations[] array are required",
      });
    }

    const dailyWork = await allocationsService.getOwnedDailyWork(
      dailyWorkId,
      req.user.organizationId,
    );
    if (!dailyWork) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    for (const a of allocations) {
      if (!a.employeeId || typeof a.qty !== "number" || a.qty < 0) {
        return res.status(400).json({
          success: false,
          message:
            "Each allocation needs a valid employeeId and a non-negative qty",
        });
      }
    }

    const alreadyAllocated =
      await allocationsService.fetchAllocatedSumForBatch(dailyWorkId);
    const newTotal = allocations.reduce((sum, a) => sum + a.qty, 0);

    if (alreadyAllocated + newTotal > dailyWork.total_qty) {
      return res.status(409).json({
        success: false,
        message: `Cannot allocate ${newTotal} more — only ${dailyWork.total_qty - alreadyAllocated} remaining pending out of ${dailyWork.total_qty} total.`,
      });
    }

    const rows = allocations.map((a) => ({
      organization_id: req.user.organizationId,
      daily_work_id: dailyWorkId,
      employee_id: a.employeeId,
      allocated_qty: a.qty,
      allocation_type: "MANUAL",
      status: "ASSIGNED",
      created_by: req.user.userId,
    }));

    const inserted = await allocationsService.insertAllocations(rows);

    const pendingQty = dailyWork.total_qty - (alreadyAllocated + newTotal);

    res.status(201).json({
      success: true,
      data: {
        allocations: inserted,
        summary: {
          totalQty: dailyWork.total_qty,
          allocatedQty: alreadyAllocated + newTotal,
          pendingQty,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/allocations/:id/status
// body: { status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" }
// ------------------------------------------------------------
async function updateAllocationStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const existing = await allocationsService.fetchAllocationOwner(
      id,
      req.user.organizationId,
    );
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Allocation not found" });
    }

    const isOwner = existing.employee_id === req.user.userId;
    const canManageOthers =
      hasPermission(req.user.role, "tasks.allocate.team") ||
      hasPermission(req.user.role, "tasks.allocate.org");

    if (!isOwner && !canManageOthers) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const data = await allocationsService.updateAllocationStatusRow(
      id,
      req.user.organizationId,
      status,
    );

    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// DELETE /api/allocations/by-daily-work/:dailyWorkId
// Clears all allocations for a batch so auto-allocate can be re-run,
// or a manual re-do started fresh.
// ------------------------------------------------------------
async function clearAllocationsForBatch(req, res) {
  try {
    const { dailyWorkId } = req.params;
    await allocationsService.deleteAllocationsForBatch(
      dailyWorkId,
      req.user.organizationId,
    );

    res.json({ success: true, message: "Allocations cleared for this batch" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/allocations/transfer
// body: { fromAllocationId, toAllocationId, qty }
//
// Moves `qty` units from one employee's allocation to another's,
// within the same daily_work batch. This is how "give someone extra"
// works once a batch is fully allocated (auto-allocate always fully
// allocates now) — you can't just add more to one person, you move
// it from someone else, so the total_qty for the batch never changes.
// ------------------------------------------------------------
async function transferAllocation(req, res) {
  try {
    const { fromAllocationId, toAllocationId, qty } = req.body;

    if (
      !fromAllocationId ||
      !toAllocationId ||
      typeof qty !== "number" ||
      qty <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "fromAllocationId, toAllocationId, and a positive qty are required",
      });
    }
    if (fromAllocationId === toAllocationId) {
      return res.status(400).json({
        success: false,
        message: "Cannot transfer to the same allocation",
      });
    }

    const rows = await allocationsService.fetchAllocationsByIds(
      [fromAllocationId, toAllocationId],
      req.user.organizationId,
    );

    const from = rows.find((r) => r.id === fromAllocationId);
    const to = rows.find((r) => r.id === toAllocationId);

    if (!from || !to) {
      return res
        .status(404)
        .json({ success: false, message: "One or both allocations not found" });
    }
    if (from.daily_work_id !== to.daily_work_id) {
      return res.status(400).json({
        success: false,
        message: "Both allocations must belong to the same daily work batch",
      });
    }
    if (from.allocated_qty < qty) {
      return res.status(409).json({
        success: false,
        message: `Cannot move ${qty} — this employee only has ${from.allocated_qty} allocated.`,
      });
    }

    await allocationsService.updateAllocatedQty(
      fromAllocationId,
      req.user.organizationId,
      from.allocated_qty - qty,
    );
    await allocationsService.updateAllocatedQty(
      toAllocationId,
      req.user.organizationId,
      to.allocated_qty + qty,
    );

    res.json({
      success: true,
      message: `Moved ${qty} unit(s) from ${fromAllocationId} to ${toAllocationId}`,
      data: {
        from: { id: fromAllocationId, allocatedQty: from.allocated_qty - qty },
        to: { id: toAllocationId, allocatedQty: to.allocated_qty + qty },
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/allocations/bulk-upsert
// body: { dailyWorkId, rows: [{ employeeId, status, allocatedQty }, ...] }
//
// Used by the Manual Allocation page's "Allocate & Save" button, which
// saves the ENTIRE visible table in one shot — every row's Present/
// Half/Leave status and its allocated qty — rather than adding to
// whatever's already there (that's what /manual does). This route
// was missing entirely, which is why the frontend's fetch got back
// an HTML 404 page instead of JSON ("Unexpected token '<'").
//
// Implemented as replace-all-for-this-batch: any existing allocation
// rows for dailyWorkId are cleared first, then the submitted rows are
// inserted fresh. That keeps re-saving idempotent (no duplicate rows,
// no need for a DB-level unique constraint on daily_work_id+employee_id).
// ------------------------------------------------------------
const VALID_ROW_STATUSES = ["PRESENT", "HALF", "LEAVE"];

async function bulkUpsertAllocations(req, res) {
  try {
    const { dailyWorkId, rows } = req.body;
    if (!dailyWorkId || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "dailyWorkId and a non-empty rows[] array are required",
      });
    }

    for (const r of rows) {
      if (
        !r.employeeId ||
        !VALID_ROW_STATUSES.includes(r.status) ||
        typeof r.allocatedQty !== "number" ||
        r.allocatedQty < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Each row needs employeeId, status (PRESENT/HALF/LEAVE), and a non-negative allocatedQty",
        });
      }
    }

    const dailyWork = await allocationsService.getOwnedDailyWork(
      dailyWorkId,
      req.user.organizationId,
    );
    if (!dailyWork) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    const allocatedQty = rows.reduce((sum, r) => sum + r.allocatedQty, 0);
    if (allocatedQty > dailyWork.total_qty) {
      return res.status(409).json({
        success: false,
        message: `Total allocated (${allocatedQty}) cannot exceed this batch's total qty (${dailyWork.total_qty}).`,
      });
    }

    // Replace-all: clear whatever was saved for this batch before, then
    // insert the current table state fresh.
    await allocationsService.deleteAllocationsForBatch(
      dailyWorkId,
      req.user.organizationId,
    );

    const insertRows = rows.map((r) => ({
      organization_id: req.user.organizationId,
      daily_work_id: dailyWorkId,
      employee_id: r.employeeId,
      allocated_qty: r.allocatedQty,
      allocation_type: "MANUAL",
      // NOTE: the "allocations" table's status column is a workflow
      // status (ASSIGNED/IN_PROGRESS/COMPLETED — enforced by a DB CHECK
      // constraint), not the Present/Half/Leave value picked in the UI.
      // Writing r.status ("PRESENT"/"HALF"/"LEAVE") straight into this
      // column violates that constraint. Every allocation created here
      // starts life as ASSIGNED, same as auto/manual allocate.
      status: "ASSIGNED",
      created_by: req.user.userId,
    }));

    const inserted = await allocationsService.insertAllocations(insertRows);

    res.status(201).json({
      success: true,
      data: {
        allocations: inserted,
        summary: {
          totalQty: dailyWork.total_qty,
          allocatedQty,
          pendingQty: dailyWork.total_qty - allocatedQty,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/allocations/:id/submit
// body: { submittedQty, reason? }
//
// Used from the Profile page: an employee submits how much of their
// allocated qty they actually completed. If submittedQty differs
// from the allocated qty (either less OR more), a reason is
// mandatory — this is the "why did you do less/more" requirement.
// Same self-or-manager ownership rule as updateAllocationStatus.
// ------------------------------------------------------------
async function submitAllocationWork(req, res) {
  try {
    const { id } = req.params;
    const { submittedQty, reason } = req.body;

    if (typeof submittedQty !== "number" || submittedQty < 0) {
      return res.status(400).json({
        success: false,
        message: "submittedQty must be a non-negative number",
      });
    }

    const existing = await allocationsService.fetchAllocationForSubmit(
      id,
      req.user.organizationId,
    );
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Allocation not found" });
    }

    const isOwner = existing.employee_id === req.user.userId;
    const canManageOthers =
      hasPermission(req.user.role, "tasks.allocate.team") ||
      hasPermission(req.user.role, "tasks.allocate.org");
    if (!isOwner && !canManageOthers) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const differs = submittedQty !== existing.allocated_qty;
    if (differs && !(reason || "").trim()) {
      return res.status(400).json({
        success: false,
        message:
          submittedQty < existing.allocated_qty
            ? "Please give a reason for submitting less than what was allocated."
            : "Please give a reason for submitting more than what was allocated.",
      });
    }

    const data = await allocationsService.updateAllocationSubmission(
      id,
      req.user.organizationId,
      {
        submitted_qty: submittedQty,
        submission_reason: differs ? reason.trim() : null,
        submitted_at: new Date().toISOString(),
        status: "COMPLETED",
      },
    );

    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// PATCH /api/allocations/bulk-submit
// body: { items: [{ id, submittedQty, reason }, ...] }
//
// NEW: profile.tsx's "Bulk Submit" panel — lets an employee submit
// several still-pending allocations in one go instead of opening the
// single-item panel per row. Same ownership-or-manager permission
// check as submitAllocationWork above, just applied per item so one
// bad/foreign id in the batch can't block the rest — each item
// succeeds or fails independently and the caller gets a per-item
// result list back (same tolerant-batch shape as the bulk-upload
// endpoints elsewhere in this app).
//
// Each item carries its own reason — different tasks can have
// different reasons. A reason is required only for an item whose
// submittedQty differs from its own allocated_qty; items that match
// their allocated_qty exactly are stored with no reason, same as the
// single-item endpoint. For backward compatibility, a legacy
// top-level `reason` is used as a fallback for any item that didn't
// send its own.
// ------------------------------------------------------------
async function bulkSubmitAllocationWork(req, res) {
  try {
    const { items, reason: legacyBatchReason } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "items must be a non-empty array" });
    }

    const ids = items.map((it) => it.id).filter(Boolean);
    const existingRows = await allocationsService.fetchAllocationsByIds(
      ids,
      req.user.organizationId,
    );

    const existingById = new Map(existingRows.map((r) => [r.id, r]));

    const canManageOthers =
      hasPermission(req.user.role, "tasks.allocate.team") ||
      hasPermission(req.user.role, "tasks.allocate.org");

    const results = [];

    for (const item of items) {
      const existing = existingById.get(item.id);
      if (!existing) {
        results.push({
          id: item.id,
          success: false,
          message: "Allocation not found",
        });
        continue;
      }

      const isOwner = existing.employee_id === req.user.userId;
      if (!isOwner && !canManageOthers) {
        results.push({ id: item.id, success: false, message: "Access denied" });
        continue;
      }

      const submittedQty = Number(item.submittedQty);
      if (!Number.isFinite(submittedQty) || submittedQty < 0) {
        results.push({
          id: item.id,
          success: false,
          message: "submittedQty must be a non-negative number",
        });
        continue;
      }

      const itemReason = (item.reason ?? legacyBatchReason ?? "").trim();

      const differs = submittedQty !== existing.allocated_qty;
      if (differs && !itemReason) {
        results.push({
          id: item.id,
          success: false,
          message:
            "A reason is required — quantity differs from what was allocated.",
        });
        continue;
      }

      try {
        await allocationsService.updateAllocationSubmission(
          item.id,
          req.user.organizationId,
          {
            submitted_qty: submittedQty,
            submission_reason: differs ? itemReason : null,
            submitted_at: new Date().toISOString(),
            status: "COMPLETED",
          },
        );
        results.push({ id: item.id, success: true });
      } catch (updateErr) {
        results.push({
          id: item.id,
          success: false,
          message: updateErr.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return res.status(200).json({
      success: true,
      data: {
        totalItems: items.length,
        successCount,
        failedCount: items.length - successCount,
        results,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/allocations/self
// body: { dailyWorkId, qty }
//
// NEW: lets a Team Member or Vertical Head pick up PENDING work for
// THEMSELVES on the redesigned Today's Allocation page — never for
// anyone else. Two things make this safe:
//   1. employee_id is always req.user.userId — taken from the auth
//      token, never from the request body — so there is no field a
//      caller could set to allocate to someone else.
//   2. qty is capped at whatever is still pending on the batch
//      (total_qty - everything already allocated, by ANY employee).
//      If nothing is pending, the request is rejected outright.
//
// Route-level permission is "tasks.allocate.self" (see
// config/permissions.js) — deliberately a different code from
// tasks.allocate.team/org, which mean "allocate to other people" and
// must stay unreachable from here.
// ------------------------------------------------------------
async function selfAllocate(req, res) {
  try {
    const { dailyWorkId, qty } = req.body;

    if (!dailyWorkId || typeof qty !== "number" || qty <= 0) {
      return res.status(400).json({
        success: false,
        message: "dailyWorkId and a positive qty are required",
      });
    }

    const dailyWork = await allocationsService.getOwnedDailyWork(
      dailyWorkId,
      req.user.organizationId,
    );
    if (!dailyWork) {
      return res
        .status(404)
        .json({ success: false, message: "Daily work batch not found" });
    }

    // Everything already allocated on this batch, by anyone — the same
    // pending formula used everywhere else (total_qty - allocated).
    const allocRows = await allocationsService.fetchAllocationsForBatch(
      dailyWorkId,
      req.user.organizationId,
    );

    const alreadyAllocated = allocRows.reduce(
      (sum, r) => sum + r.allocated_qty,
      0,
    );
    const pending = dailyWork.total_qty - alreadyAllocated;

    // No pending work left on this task at all — nothing to self-allocate.
    if (pending <= 0) {
      return res.status(409).json({
        success: false,
        message: "No pending quantity left on this task.",
      });
    }
    if (qty > pending) {
      return res.status(409).json({
        success: false,
        message: `Only ${pending} unit(s) are pending on this task — you can't take ${qty}.`,
      });
    }

    // If this employee already has a row on this batch (e.g. they took
    // some earlier today), add to it instead of creating a second row
    // for the same employee+batch.
    const existingOwn = allocRows.find(
      (r) => r.employee_id === req.user.userId,
    );

    let allocation;
    if (existingOwn) {
      await allocationsService.updateAllocatedQty(
        existingOwn.id,
        req.user.organizationId,
        existingOwn.allocated_qty + qty,
      );
      allocation = {
        ...existingOwn,
        allocated_qty: existingOwn.allocated_qty + qty,
      };
    } else {
      allocation = await allocationsService.insertSingleAllocation({
        organization_id: req.user.organizationId,
        daily_work_id: dailyWorkId,
        employee_id: req.user.userId,
        allocated_qty: qty,
        // Reuses the "MANUAL" allocation_type value (same as
        // manualAllocate/bulkUpsertAllocations) rather than inventing a
        // new one, since we don't have a guarantee the DB's CHECK
        // constraint (if any) permits anything beyond AUTO/MANUAL.
        // Self-allocated rows are still distinguishable from a
        // manager's manual entries: employee_id === created_by here,
        // which is never true when a manager allocates to someone else.
        allocation_type: "MANUAL",
        status: "ASSIGNED",
        created_by: req.user.userId,
      });
    }

    res.status(201).json({
      success: true,
      message: `You've allocated ${qty} unit(s) to yourself.`,
      data: {
        allocation,
        summary: {
          totalQty: dailyWork.total_qty,
          allocatedQty: alreadyAllocated + qty,
          pendingQty: pending - qty,
        },
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

module.exports = {
  listAllocations,
  getAllocationHistory,
  autoAllocate,
  manualAllocate,
  selfAllocate,
  bulkUpsertAllocations,
  transferAllocation,
  updateAllocationStatus,
  submitAllocationWork,
  bulkSubmitAllocationWork,
  clearAllocationsForBatch,
};
