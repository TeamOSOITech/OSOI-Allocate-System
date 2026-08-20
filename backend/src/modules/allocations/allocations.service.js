// src/modules/allocations/allocations.service.js
//
// All Supabase/DB access for the allocations module (PAGE 3 Smart Auto
// Allocation + PAGE 4 Manual Allocation). Pulled out of
// allocations.controller.js so the controller only handles req/res,
// permission checks, and the allocation math — this file is the only
// place that talks to the `allocations` / `daily_work` / `attendance` /
// `service_master` / `user_master` / `clients` / `subclients` /
// `client_products` / `subclient_products` tables for allocations.
//
// Every query is scoped to organizationId — this is the actual
// multi-tenant enforcement point. daily_work rows, employees, and
// attendance are all checked against the caller's own org before
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
// manual-join pattern (no FK embedding, since PostgREST needs an
// actual DB constraint for that).
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
// display name in ONE query — manual-join pattern, same reasoning as
// getDailyWorkMap above.
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

// ---------- history ----------

async function fetchDailyWorkInRange(orgId, { dateFrom, dateTo, productId }) {
  let query = supabase
    .from("daily_work")
    .select("id, work_date, product_id")
    .eq("organization_id", orgId);
  if (dateFrom) query = query.gte("work_date", dateFrom);
  if (dateTo) query = query.lte("work_date", dateTo);
  if (productId) query = query.eq("product_id", productId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchAllocationsForBatches(orgId, dailyWorkIds, employeeId) {
  let query = supabase
    .from("allocations")
    .select("*")
    .eq("organization_id", orgId)
    .in("daily_work_id", dailyWorkIds)
    .order("created_at", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Client/subclient linkage per service — manual join, avoids relying on
// an untested PostgREST embedded-select relationship name.
async function fetchClientSubclientLinkage(orgId) {
  const [
    { data: clientLinks },
    { data: clientRows },
    { data: subclientLinks },
    { data: subclientRows },
  ] = await Promise.all([
    supabase
      .from("client_products")
      .select("product_id, client_id")
      .eq("organization_id", orgId),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
    supabase
      .from("subclient_products")
      .select("product_id, subclient_id")
      .eq("organization_id", orgId),
    supabase.from("subclients").select("id, name").eq("organization_id", orgId),
  ]);

  return {
    clientLinks: clientLinks || [],
    clientRows: clientRows || [],
    subclientLinks: subclientLinks || [],
    subclientRows: subclientRows || [],
  };
}

// ---------- list ----------

async function fetchAllocations(orgId, { dailyWorkId, employeeId }) {
  let query = supabase
    .from("allocations")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (dailyWorkId) query = query.eq("daily_work_id", dailyWorkId);
  if (employeeId) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ---------- auto allocate ----------

async function hasAnyAllocations(dailyWorkId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("id")
    .eq("daily_work_id", dailyWorkId)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

// Deterministic order (employee #1, #2, #3...) — by employee_id so
// re-running against the same attendance list always gives the same
// people the +1, rather than depending on DB row order.
async function fetchPresentEmployees(orgId, workDate) {
  const { data, error } = await supabase
    .from("attendance")
    .select("employee_id")
    .eq("organization_id", orgId)
    .eq("attendance_date", workDate)
    .eq("status", "PRESENT")
    .order("employee_id", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchPastBatchIds(orgId, productId, beforeWorkDate) {
  const { data, error } = await supabase
    .from("daily_work")
    .select("id")
    .eq("organization_id", orgId)
    .eq("product_id", productId)
    .lt("work_date", beforeWorkDate);
  if (error) throw error;
  return (data || []).map((b) => b.id);
}

// Backlog carry-forward — any earlier allocation on this product for a
// present employee that's still short (allocated > submitted) and
// hasn't already been rolled forward (carried_forward = false).
async function fetchCarryForwardAllocations(pastBatchIds, presentIds) {
  const { data, error } = await supabase
    .from("allocations")
    .select("id, employee_id, allocated_qty, submitted_qty")
    .in("daily_work_id", pastBatchIds)
    .in("employee_id", presentIds)
    .eq("carried_forward", false);
  if (error) throw error;
  return data || [];
}

async function markAllocationsCarriedForward(ids) {
  if (!ids || ids.length === 0) return;
  const { error } = await supabase
    .from("allocations")
    .update({ carried_forward: true })
    .in("id", ids);
  if (error) throw error;
}

async function insertAllocations(rows) {
  const { data, error } = await supabase
    .from("allocations")
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

// ---------- manual allocate ----------

async function fetchAllocatedSumForBatch(dailyWorkId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("allocated_qty")
    .eq("daily_work_id", dailyWorkId);
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + r.allocated_qty, 0);
}

// ---------- status update ----------

async function fetchAllocationOwner(id, orgId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("employee_id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();
  if (error || !data) return null;
  return data;
}

async function updateAllocationStatusRow(id, orgId, status) {
  const { data, error } = await supabase
    .from("allocations")
    .update({ status })
    .eq("id", id)
    .eq("organization_id", orgId) // tenant check on the WRITE too
    .select();
  if (error) throw error;
  return data;
}

// ---------- clear batch ----------

async function deleteAllocationsForBatch(dailyWorkId, orgId) {
  const { error } = await supabase
    .from("allocations")
    .delete()
    .eq("daily_work_id", dailyWorkId)
    .eq("organization_id", orgId);
  if (error) throw error;
}

// ---------- transfer ----------

async function fetchAllocationsByIds(ids, orgId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("*")
    .in("id", ids)
    .eq("organization_id", orgId);
  if (error) throw error;
  return data || [];
}

async function updateAllocatedQty(id, orgId, newQty) {
  const { error } = await supabase
    .from("allocations")
    .update({ allocated_qty: newQty })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw error;
}

// ---------- submit work ----------

async function fetchAllocationForSubmit(id, orgId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("employee_id, allocated_qty")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();
  if (error || !data) return null;
  return data;
}

async function updateAllocationSubmission(id, orgId, payload) {
  const { data, error } = await supabase
    .from("allocations")
    .update(payload)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select();
  if (error) throw error;
  return data;
}

// ---------- self allocate ----------

async function fetchAllocationsForBatch(dailyWorkId, orgId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("id, employee_id, allocated_qty")
    .eq("daily_work_id", dailyWorkId)
    .eq("organization_id", orgId);
  if (error) throw error;
  return data || [];
}

async function insertSingleAllocation(payload) {
  const { data, error } = await supabase
    .from("allocations")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  getOwnedDailyWork,
  getDailyWorkMap,
  getUserInfoMap,
  fetchDailyWorkInRange,
  fetchAllocationsForBatches,
  fetchClientSubclientLinkage,
  fetchAllocations,
  hasAnyAllocations,
  fetchPresentEmployees,
  fetchPastBatchIds,
  fetchCarryForwardAllocations,
  markAllocationsCarriedForward,
  insertAllocations,
  fetchAllocatedSumForBatch,
  fetchAllocationOwner,
  updateAllocationStatusRow,
  deleteAllocationsForBatch,
  fetchAllocationsByIds,
  updateAllocatedQty,
  fetchAllocationForSubmit,
  updateAllocationSubmission,
  fetchAllocationsForBatch,
  insertSingleAllocation,
};
