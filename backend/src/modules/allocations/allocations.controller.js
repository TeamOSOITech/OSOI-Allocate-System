// src/modules/allocations/allocations.controller.js
//
// PAGE 3 (Smart Auto Allocation) + PAGE 4 (Manual Allocation).
//
// Formula (per spec): base_qty = floor(total / present)
//                      pending  = total - (base_qty * present_count)
//
// Every query is scoped to req.user.organizationId — this is the
// actual multi-tenant enforcement point. daily_work rows, employees,
// and attendance are all checked against the caller's own org before
// anything is read or written, so one company can never allocate
// against (or see) another company's daily_work batch.

const supabase = require("../../config/supabaseClient");

// ------------------------------------------------------------
// Shared helper: load a daily_work row, but ONLY if it belongs to the
// caller's organization. Returns null if missing OR cross-tenant.
// ------------------------------------------------------------
async function getOwnedDailyWork(dailyWorkId, organizationId) {
  const { data, error } = await supabase
    .from("daily_work")
    .select("*")
    .eq("id", dailyWorkId)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) return null;
  return data;
}

// ------------------------------------------------------------
// Given a list of daily_work IDs, fetch their work_date/product_id/
// total_qty in ONE extra query, plus product names in another —
// same manual-join pattern used in dailywork.controller.js (no FK
// embedding, since PostgREST needs an actual DB constraint for that).
// ------------------------------------------------------------
async function getDailyWorkMap(dailyWorkIds) {
  const uniqueIds = [...new Set(dailyWorkIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("daily_work")
    .select("id, work_date, product_id, total_qty")
    .in("id", uniqueIds);
  if (error) {
    console.error("Failed to fetch daily_work for allocations:", error);
    return {};
  }

  const productIds = [
    ...new Set(data.map((d) => d.product_id).filter(Boolean)),
  ];
  let productNames = {};
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("service_master")
      .select("id, product_name")
      .in("id", productIds);
    productNames = (products || []).reduce((acc, p) => {
      acc[p.id] = p.product_name;
      return acc;
    }, {});
  }

  return data.reduce((acc, d) => {
    acc[d.id] = {
      workDate: d.work_date,
      productId: d.product_id,
      productName: productNames[d.product_id] || null,
      totalQty: d.total_qty,
    };
    return acc;
  }, {});
}

// ------------------------------------------------------------
// Given a list of user_master IDs (employee_id and/or created_by from
// allocations rows), fetch each one's team ("Worked In Teams") and
// display name in ONE query — used to fill in the Profile page's
// "Team" and "Allocated By" columns, which the allocations table
// itself doesn't store (same manual-join pattern as getDailyWorkMap,
// since there's no DB-level FK for PostgREST to embed through).
// ------------------------------------------------------------
async function getUserInfoMap(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name", "Worked In Teams"')
    .in("Auth User Id", uniqueIds);
  if (error) {
    console.error("Failed to fetch user_master for allocations:", error);
    return {};
  }

  return data.reduce((acc, u) => {
    const firstName = u["First Name"] ?? "";
    const lastName = u["Last Name"] ?? "";
    acc[u["Auth User Id"]] = {
      name: `${firstName} ${lastName}`.trim() || null,
      team: u["Worked In Teams"] ?? null,
    };
    return acc;
  }, {});
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
      const { hasPermission } = require("../../config/permissions");
      const canViewOthers =
        hasPermission(req.user.role, "tasks.allocate.team") ||
        hasPermission(req.user.role, "tasks.allocate.org");
      if (!canViewOthers) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied" });
      }
    }

    let query = supabase
      .from("allocations")
      .select("*")
      .eq("organization_id", req.user.organizationId)
      .order("created_at", { ascending: false });

    if (dailyWorkId) query = query.eq("daily_work_id", dailyWorkId);
    if (employeeId) query = query.eq("employee_id", employeeId);

    const { data, error } = await query;
    if (error) throw error;

    const dailyWorkMap = await getDailyWorkMap(
      (data || []).map((a) => a.daily_work_id),
    );
    // Team comes from the allocated employee's own profile; "Allocated
    // By" comes from whoever's user_master row matches created_by —
    // both looked up together in one batched query.
    const userInfoMap = await getUserInfoMap(
      (data || []).flatMap((a) => [a.employee_id, a.created_by]),
    );
    const enriched = (data || []).map((a) => ({
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

    const dailyWork = await getOwnedDailyWork(
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
    const { data: existing, error: existingError } = await supabase
      .from("allocations")
      .select("id")
      .eq("daily_work_id", dailyWorkId)
      .limit(1);
    if (existingError) throw existingError;
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "This batch already has allocations. Clear them first before re-running auto-allocate.",
      });
    }

    // Deterministic order (employee #1, #2, #3...) — by employee_id so
    // re-running against the same attendance list always gives the
    // same people the +1, rather than depending on DB row order.
    const { data: presentRows, error: attendanceError } = await supabase
      .from("attendance")
      .select("employee_id")
      .eq("organization_id", req.user.organizationId)
      .eq("attendance_date", dailyWork.work_date)
      .eq("status", "PRESENT")
      .order("employee_id", { ascending: true });
    if (attendanceError) throw attendanceError;

    const presentCount = presentRows?.length || 0;
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
      const { data: pastBatches, error: pastBatchError } = await supabase
        .from("daily_work")
        .select("id")
        .eq("organization_id", req.user.organizationId)
        .eq("product_id", dailyWork.product_id)
        .lt("work_date", dailyWork.work_date);
      if (pastBatchError) throw pastBatchError;

      const pastBatchIds = (pastBatches || []).map((b) => b.id);
      if (pastBatchIds.length > 0) {
        const { data: pastAllocations, error: pastAllocError } = await supabase
          .from("allocations")
          .select("id, employee_id, allocated_qty, submitted_qty")
          .in("daily_work_id", pastBatchIds)
          .in("employee_id", presentIds)
          .eq("carried_forward", false);
        if (pastAllocError) throw pastAllocError;

        for (const row of pastAllocations || []) {
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

    const { data: inserted, error: insertError } = await supabase
      .from("allocations")
      .insert(rows)
      .select();
    if (insertError) throw insertError;

    // Now that the backlog has a new home, mark the old rows so a
    // later batch of this product doesn't carry the same shortfall
    // forward again.
    if (carriedAllocationIds.length > 0) {
      const { error: carryUpdateError } = await supabase
        .from("allocations")
        .update({ carried_forward: true })
        .in("id", carriedAllocationIds);
      if (carryUpdateError) throw carryUpdateError;
    }

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

    const dailyWork = await getOwnedDailyWork(
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

    const { data: existingRows, error: existingError } = await supabase
      .from("allocations")
      .select("allocated_qty")
      .eq("daily_work_id", dailyWorkId);
    if (existingError) throw existingError;

    const alreadyAllocated = (existingRows || []).reduce(
      (sum, r) => sum + r.allocated_qty,
      0,
    );
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

    const { data: inserted, error: insertError } = await supabase
      .from("allocations")
      .insert(rows)
      .select();
    if (insertError) throw insertError;

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

    const { data: existing, error: fetchError } = await supabase
      .from("allocations")
      .select("employee_id")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .single();
    if (fetchError || !existing) {
      return res
        .status(404)
        .json({ success: false, message: "Allocation not found" });
    }

    const { hasPermission } = require("../../config/permissions");
    const isOwner = existing.employee_id === req.user.userId;
    const canManageOthers =
      hasPermission(req.user.role, "tasks.allocate.team") ||
      hasPermission(req.user.role, "tasks.allocate.org");

    if (!isOwner && !canManageOthers) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { data, error } = await supabase
      .from("allocations")
      .update({ status })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId) // tenant check on the WRITE too
      .select();
    if (error) throw error;

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
    const { error } = await supabase
      .from("allocations")
      .delete()
      .eq("daily_work_id", dailyWorkId)
      .eq("organization_id", req.user.organizationId);
    if (error) throw error;

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

    const { data: rows, error: fetchError } = await supabase
      .from("allocations")
      .select("*")
      .in("id", [fromAllocationId, toAllocationId])
      .eq("organization_id", req.user.organizationId);
    if (fetchError) throw fetchError;

    const from = rows?.find((r) => r.id === fromAllocationId);
    const to = rows?.find((r) => r.id === toAllocationId);

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

    const { error: decError } = await supabase
      .from("allocations")
      .update({ allocated_qty: from.allocated_qty - qty })
      .eq("id", fromAllocationId)
      .eq("organization_id", req.user.organizationId);
    if (decError) throw decError;

    const { error: incError } = await supabase
      .from("allocations")
      .update({ allocated_qty: to.allocated_qty + qty })
      .eq("id", toAllocationId)
      .eq("organization_id", req.user.organizationId);
    if (incError) throw incError;

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

    const dailyWork = await getOwnedDailyWork(
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
    const { error: deleteError } = await supabase
      .from("allocations")
      .delete()
      .eq("daily_work_id", dailyWorkId)
      .eq("organization_id", req.user.organizationId);
    if (deleteError) throw deleteError;

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

    const { data: inserted, error: insertError } = await supabase
      .from("allocations")
      .insert(insertRows)
      .select();
    if (insertError) throw insertError;

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

    const { data: existing, error: fetchError } = await supabase
      .from("allocations")
      .select("employee_id, allocated_qty")
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .single();
    if (fetchError || !existing) {
      return res
        .status(404)
        .json({ success: false, message: "Allocation not found" });
    }

    const { hasPermission } = require("../../config/permissions");
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

    const { data, error } = await supabase
      .from("allocations")
      .update({
        submitted_qty: submittedQty,
        submission_reason: differs ? reason.trim() : null,
        submitted_at: new Date().toISOString(),
        status: "COMPLETED",
      })
      .eq("id", id)
      .eq("organization_id", req.user.organizationId)
      .select();
    if (error) throw error;

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
    const { data: existingRows, error: fetchError } = await supabase
      .from("allocations")
      .select("id, employee_id, allocated_qty")
      .in("id", ids)
      .eq("organization_id", req.user.organizationId);
    if (fetchError) throw fetchError;

    const existingById = new Map((existingRows || []).map((r) => [r.id, r]));

    const { hasPermission } = require("../../config/permissions");
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

      const { error: updateError } = await supabase
        .from("allocations")
        .update({
          submitted_qty: submittedQty,
          submission_reason: differs ? itemReason : null,
          submitted_at: new Date().toISOString(),
          status: "COMPLETED",
        })
        .eq("id", item.id)
        .eq("organization_id", req.user.organizationId);

      if (updateError) {
        results.push({
          id: item.id,
          success: false,
          message: updateError.message,
        });
      } else {
        results.push({ id: item.id, success: true });
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

    const dailyWork = await getOwnedDailyWork(
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
    const { data: allocRows, error: allocError } = await supabase
      .from("allocations")
      .select("id, employee_id, allocated_qty")
      .eq("daily_work_id", dailyWorkId)
      .eq("organization_id", req.user.organizationId);
    if (allocError) throw allocError;

    const alreadyAllocated = (allocRows || []).reduce(
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
    const existingOwn = (allocRows || []).find(
      (r) => r.employee_id === req.user.userId,
    );

    let allocation;
    if (existingOwn) {
      const { data, error } = await supabase
        .from("allocations")
        .update({ allocated_qty: existingOwn.allocated_qty + qty })
        .eq("id", existingOwn.id)
        .eq("organization_id", req.user.organizationId)
        .select()
        .single();
      if (error) throw error;
      allocation = data;
    } else {
      const { data, error } = await supabase
        .from("allocations")
        .insert({
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
        })
        .select()
        .single();
      if (error) throw error;
      allocation = data;
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
