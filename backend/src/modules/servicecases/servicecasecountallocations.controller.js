// src/modules/servicecases/servicecasecountallocations.controller.js
//
// Today's Allocation for COUNT-ONLY entries (service_case_counts):
//   GET  /api/service-cases/count-allocations
//   POST /api/service-cases/count-allocations/auto-preview
//   POST /api/service-cases/count-allocations/save
//   POST /api/service-cases/count-allocations/clear

const supabase = require("../../config/supabaseClient");
const { getRecentLoad, distributeFairly } = require("./fairness");
const {
  getProduct,
  assertVerticalHeadCanUseProduct,
  getProductNameMap,
  getClientNameMap,
  getSubclientNameMap,
  getEmployeeNameMap,
} = require("./servicecases.controller");

const orgIdOf = (req) => req.user.organizationId;
const userIdOf = (req) => req.user.userId;

async function guardProduct(req, productId) {
  if (!productId) return null;
  const product = await getProduct(productId, orgIdOf(req));
  if (!product) return { status: 404, message: "Service not found" };
  const scope = await assertVerticalHeadCanUseProduct(req, product);
  if (!scope.ok) return { status: 403, message: scope.message };
  return null;
}

// Count rows still open (fulfilled < quantity), with their allocations.
async function loadCounts(orgId, { productId, workDate }) {
  let q = supabase
    .from("service_case_counts")
    .select("*")
    .eq("organization_id", orgId)
    .order("work_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1000);
  if (productId) q = q.eq("product_id", productId);
  if (workDate) q = q.lte("work_date", workDate); // backlog included
  const { data, error } = await q;
  if (error) throw error;

  const open = (data || []).filter(
    (c) => (c.fulfilled_count || 0) < c.quantity,
  );
  const ids = open.map((c) => c.id);

  let allocs = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: a, error: aErr } = await supabase
      .from("service_case_count_allocations")
      .select("count_id, employee_id, quantity, fulfilled_quantity")
      .eq("organization_id", orgId)
      .in("count_id", ids.slice(i, i + 150));
    if (aErr) throw aErr;
    allocs = allocs.concat(a || []);
  }

  const [productMap, clientMap, subclientMap, employeeMap] = await Promise.all([
    getProductNameMap(
      open.map((c) => c.product_id),
      orgId,
    ),
    getClientNameMap(
      open.map((c) => c.client_id),
      orgId,
    ),
    getSubclientNameMap(
      open.map((c) => c.subclient_id),
      orgId,
    ),
    getEmployeeNameMap(
      allocs.map((a) => a.employee_id),
      orgId,
    ),
  ]);

  return open.map((c) => {
    const mine = allocs.filter((a) => a.count_id === c.id);
    const allocatedTotal = mine.reduce((s, a) => s + a.quantity, 0);
    const fulfilled = c.fulfilled_count || 0;
    return {
      id: c.id,
      productId: String(c.product_id),
      productName: productMap[c.product_id] || null,
      clientName: clientMap[c.client_id] || null,
      subclientName: subclientMap[c.subclient_id] || null,
      workDate: c.work_date,
      quantity: c.quantity,
      fulfilledCount: fulfilled,
      pendingCount: c.quantity - fulfilled,
      allocatedTotal,
      unallocated: c.quantity - allocatedTotal,
      allocations: mine.map((a) => ({
        employeeId: a.employee_id,
        employeeName: employeeMap[a.employee_id] || null,
        quantity: a.quantity,
        fulfilledQuantity: a.fulfilled_quantity || 0,
      })),
    };
  });
}

// GET /count-allocations?productId=&workDate=
async function listCountAllocations(req, res) {
  try {
    const productId = req.query.productId || null;
    const blocked = await guardProduct(req, productId);
    if (blocked)
      return res
        .status(blocked.status)
        .json({ success: false, message: blocked.message });
    const data = await loadCounts(orgIdOf(req), {
      productId,
      workDate: req.query.workDate || null,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error("listCountAllocations error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /count-allocations/auto-preview  (PREVIEW ONLY — nothing is written)
async function autoPreviewCountAllocations(req, res) {
  try {
    const { productId, workDate } = req.body || {};
    const employeeIds = Array.isArray(req.body?.employeeIds)
      ? [...new Set(req.body.employeeIds.filter(Boolean))]
      : [];
    if (!productId || !workDate || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "productId, workDate and employeeIds are required",
      });
    }
    const blocked = await guardProduct(req, productId);
    if (blocked)
      return res
        .status(blocked.status)
        .json({ success: false, message: blocked.message });

    const orgId = orgIdOf(req);
    const rows = (await loadCounts(orgId, { productId, workDate })).filter(
      (c) => c.unallocated > 0,
    );
    const load = await getRecentLoad(orgId, productId, workDate, employeeIds);
    const extra = req.body.extraLoad || {};
    employeeIds.forEach((id) => {
      load[id] = (load[id] || 0) + (Number(extra[id]) || 0);
    });

    const assignments = [];
    const perEmployeeMap = {};
    let allocatedCount = 0;
    rows.forEach((c) => {
      const split = distributeFairly(c.unallocated, employeeIds, load);
      employeeIds.forEach((eid) => {
        const add = split[eid] || 0;
        if (add <= 0) return;
        const existing =
          c.allocations.find((a) => a.employeeId === eid)?.quantity || 0;
        assignments.push({
          countId: c.id,
          employeeId: eid,
          quantity: existing + add,
        });
        perEmployeeMap[eid] = (perEmployeeMap[eid] || 0) + add;
        allocatedCount += add;
      });
    });

    res.json({
      success: true,
      message: `${allocatedCount} count case(s) distributed — review and press Allocate to confirm.`,
      data: {
        allocatedCount,
        assignments,
        perEmployee: Object.entries(perEmployeeMap).map(
          ([employeeId, quantity]) => ({ employeeId, quantity }),
        ),
      },
    });
  } catch (err) {
    console.error("autoPreviewCountAllocations error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /count-allocations/save   body: { items: [{ countId, employeeId, quantity }] }
async function saveCountAllocations(req, res) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Nothing to save." });
    const orgId = orgIdOf(req);

    const countIds = [...new Set(items.map((i) => i.countId))];
    const { data: counts, error } = await supabase
      .from("service_case_counts")
      .select("id, product_id, quantity")
      .eq("organization_id", orgId)
      .in("id", countIds);
    if (error) throw error;
    const countMap = Object.fromEntries((counts || []).map((c) => [c.id, c]));

    for (const pid of new Set((counts || []).map((c) => c.product_id))) {
      const blocked = await guardProduct(req, pid);
      if (blocked)
        return res
          .status(blocked.status)
          .json({ success: false, message: blocked.message });
    }

    const empIds = [...new Set(items.map((i) => i.employeeId))];
    const { data: emps, error: empErr } = await supabase
      .from("user_master")
      .select('"Auth User Id"')
      .eq("organization_id", orgId)
      .in("Auth User Id", empIds);
    if (empErr) throw empErr;
    if ((emps || []).length !== empIds.length)
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });

    const { data: existing, error: exErr } = await supabase
      .from("service_case_count_allocations")
      .select("count_id, employee_id, quantity, fulfilled_quantity")
      .eq("organization_id", orgId)
      .in("count_id", countIds);
    if (exErr) throw exErr;

    const state = {};
    (existing || []).forEach((a) => {
      (state[a.count_id] ||= {})[a.employee_id] = {
        quantity: a.quantity,
        fulfilled: a.fulfilled_quantity || 0,
      };
    });

    for (const it of items) {
      const q = Number(it.quantity);
      if (!countMap[it.countId] || !Number.isInteger(q) || q < 0)
        return res
          .status(400)
          .json({ success: false, message: "Invalid allocation item." });
      const cur = (state[it.countId] ||= {})[it.employeeId] || {
        quantity: 0,
        fulfilled: 0,
      };
      if (q < cur.fulfilled)
        return res.status(400).json({
          success: false,
          message: `An employee has already submitted ${cur.fulfilled} of this count — can't allocate fewer.`,
        });
      state[it.countId][it.employeeId] = {
        quantity: q,
        fulfilled: cur.fulfilled,
      };
    }
    for (const cid of countIds) {
      const total = Object.values(state[cid] || {}).reduce(
        (s, v) => s + v.quantity,
        0,
      );
      if (total > countMap[cid].quantity)
        return res.status(400).json({
          success: false,
          message: `Allocated (${total}) is more than the count (${countMap[cid].quantity}).`,
        });
    }

    const now = new Date().toISOString();
    const upserts = items
      .filter((i) => Number(i.quantity) > 0)
      .map((i) => ({
        organization_id: orgId,
        count_id: i.countId,
        employee_id: i.employeeId,
        quantity: Number(i.quantity),
        allocated_by: userIdOf(req),
        allocated_at: now,
      }));
    if (upserts.length) {
      const { error: uErr } = await supabase
        .from("service_case_count_allocations")
        .upsert(upserts, { onConflict: "count_id,employee_id" });
      if (uErr) throw uErr;
    }

    const deletes = await Promise.all(
      items
        .filter((i) => Number(i.quantity) === 0)
        .map((i) =>
          supabase
            .from("service_case_count_allocations")
            .delete()
            .eq("organization_id", orgId)
            .eq("count_id", i.countId)
            .eq("employee_id", i.employeeId),
        ),
    );
    const delErr = deletes.find((d) => d.error);
    if (delErr) throw delErr.error;

    res.json({
      success: true,
      message: "Count allocations saved.",
      data: { saved: items.length },
    });
  } catch (err) {
    console.error("saveCountAllocations error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /count-allocations/clear   body: { productId, workDate }
// Removes the NOT-yet-submitted part of every allocation (logged first).
async function clearCountAllocations(req, res) {
  try {
    const { productId, workDate } = req.body || {};
    if (!productId || !workDate)
      return res.status(400).json({
        success: false,
        message: "productId and workDate are required",
      });
    const blocked = await guardProduct(req, productId);
    if (blocked)
      return res
        .status(blocked.status)
        .json({ success: false, message: blocked.message });

    const orgId = orgIdOf(req);
    const rows = await loadCounts(orgId, { productId, workDate });
    const logs = [];
    let cleared = 0;
    const table = () => supabase.from("service_case_count_allocations");

    for (const c of rows) {
      for (const a of c.allocations) {
        const unfulfilled = a.quantity - a.fulfilledQuantity;
        if (unfulfilled <= 0) continue;

        const { error: opErr } =
          a.fulfilledQuantity > 0
            ? await table()
                .update({ quantity: a.fulfilledQuantity })
                .eq("organization_id", orgId)
                .eq("count_id", c.id)
                .eq("employee_id", a.employeeId)
            : await table()
                .delete()
                .eq("organization_id", orgId)
                .eq("count_id", c.id)
                .eq("employee_id", a.employeeId);
        if (opErr) throw opErr;

        logs.push({
          organization_id: orgId,
          count_id: c.id,
          employee_id: a.employeeId,
          cleared_quantity: unfulfilled,
          cleared_by: userIdOf(req),
        });
        cleared += unfulfilled;
      }
    }

    // a log failure must not block the clear
    if (logs.length) {
      const { error: logErr } = await supabase
        .from("count_allocation_clear_log")
        .insert(logs);
      if (logErr)
        console.error("Failed to write count_allocation_clear_log:", logErr);
    }
    res.json({
      success: true,
      message: `Cleared ${cleared} count allocation(s).`,
      data: { cleared },
    });
  } catch (err) {
    console.error("clearCountAllocations error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listCountAllocations,
  autoPreviewCountAllocations,
  saveCountAllocations,
  clearCountAllocations,
};
