// src/modules/dailyWork/dailyWork.service.js
//
// All Supabase/DB access for the Daily Work module. Pulled out of
// dailywork.controller.js so the controller only handles req/res +
// response shaping — this file is the only place that talks to the
// `daily_work` / `allocations` / `service_master` / `attendance` /
// `user_master` tables for Daily Work.
//
// Table: daily_work(id, organization_id, work_date, product_id,
//                    total_qty, status, created_by, created_at)
//
// NOTE: product_id -> products.id ka embedded Supabase select
// (".select('*, products(product_name)')") FAIL hota hai jab tak DB
// me ek actual foreign key constraint na ho — PostgREST apna
// "schema cache" isi constraint se banata hai. Migration se guarantee
// nahi tha ki FK bana hi hoga, isliye yahan product name manually,
// alag query se, application code me hi join kiya ja raha hai —
// isse FK exist kare ya na kare, dono cases me kaam karega.
//
// Har query organizationId se scoped hai — same tenant enforcement
// pattern jo modules/allocations use karta hai.

const supabase = require("../../config/supabaseClient");

// ------------------------------------------------------------
// Given a list of daily_work rows, fetch matching product names in
// ONE extra query and return a { [productId]: productName } map.
// ------------------------------------------------------------
async function getProductNameMap(productIds) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .in("id", uniqueIds);

  if (error) {
    console.error("Failed to fetch product names:", error);
    return {};
  }

  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

function mapRow(row, extra = {}) {
  return {
    id: row.id,
    workDate: row.work_date,
    productId: row.product_id,
    productName: extra.productName ?? null,
    totalQty: row.total_qty,
    status: row.status,
    createdBy: row.created_by,
    createdByName: extra.createdByName ?? null,
    createdAt: row.created_at,
    // NEW: who last edited this batch (Edit button on the Daily Work
    // table) and when — separate from createdBy/createdAt, which never
    // change after the row is first logged.
    updatedBy: row.updated_by ?? null,
    updatedByName: extra.updatedByName ?? null,
    updatedAt: row.updated_at ?? null,
    allocatedQty: extra.allocatedQty,
    pendingQty: extra.pendingQty,
  };
}

// ------------------------------------------------------------
// Given a list of user ids (created_by / updated_by), fetch their
// display names in ONE query — same manual-join pattern as
// getProductNameMap above and servicecases.controller.js's
// getEmployeeNameMap (user_master has no PostgREST FK relationship set
// up here to embed through).
// ------------------------------------------------------------
async function getUserNameMap(userIds) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name"')
    .in("Auth User Id", uniqueIds);

  if (error) {
    console.error("Failed to fetch user names for daily work:", error);
    return {};
  }

  return (data || []).reduce((acc, u) => {
    const firstName = u["First Name"] ?? "";
    const lastName = u["Last Name"] ?? "";
    acc[u["Auth User Id"]] = `${firstName} ${lastName}`.trim() || null;
    return acc;
  }, {});
}

// ---------- list / read ----------

async function fetchDailyWorkBatches(orgId, date) {
  let query = supabase
    .from("daily_work")
    .select("*")
    .eq("organization_id", orgId)
    .order("work_date", { ascending: false });

  if (date) {
    query = query.eq("work_date", date);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchAllocatedByBatch(orgId, batchIds) {
  if (!batchIds || batchIds.length === 0) return {};

  const { data, error } = await supabase
    .from("allocations")
    .select("daily_work_id, allocated_qty")
    .eq("organization_id", orgId)
    .in("daily_work_id", batchIds);
  if (error) throw error;

  return (data || []).reduce((acc, r) => {
    acc[r.daily_work_id] = (acc[r.daily_work_id] || 0) + r.allocated_qty;
    return acc;
  }, {});
}

async function fetchDailyWorkById(id, orgId) {
  const { data, error } = await supabase
    .from("daily_work")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error || !data) return null;
  return data;
}

// ---------- create ----------

async function findDuplicateBatch(orgId, workDate, productId) {
  const { data, error } = await supabase
    .from("daily_work")
    .select("id")
    .eq("organization_id", orgId)
    .eq("work_date", workDate)
    .eq("product_id", productId)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

async function insertDailyWork(payload) {
  const { data, error } = await supabase
    .from("daily_work")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

// ---------- update ----------

async function fetchDailyWorkForUpdate(id, orgId) {
  const { data, error } = await supabase
    .from("daily_work")
    .select("id, total_qty")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error || !data) return null;
  return data;
}

async function fetchAllocatedSum(orgId, dailyWorkId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("allocated_qty")
    .eq("organization_id", orgId)
    .eq("daily_work_id", dailyWorkId);
  if (error) throw error;

  return (data || []).reduce((sum, r) => sum + r.allocated_qty, 0);
}

async function updateDailyWorkRow(id, orgId, payload) {
  const { data, error } = await supabase
    .from("daily_work")
    .update(payload)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

// ---------- delete ----------

async function hasAllocations(orgId, dailyWorkId) {
  const { data, error } = await supabase
    .from("allocations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("daily_work_id", dailyWorkId)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

async function deleteDailyWorkRow(id, orgId) {
  const { error } = await supabase
    .from("daily_work")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw error;
}

// ---------- seed dummy cases ----------

async function fetchServicesForOrg(orgId) {
  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .eq("organization_id", orgId);
  if (error) throw error;
  return data || [];
}

async function fetchExistingBatchProductIds(orgId, workDate) {
  const { data, error } = await supabase
    .from("daily_work")
    .select("product_id")
    .eq("organization_id", orgId)
    .eq("work_date", workDate);
  if (error) throw error;
  return (data || []).map((b) => b.product_id);
}

async function insertDailyWorkRows(rows) {
  if (!rows || rows.length === 0) return [];
  const { data, error } = await supabase
    .from("daily_work")
    .insert(rows)
    .select("*");
  if (error) throw error;
  return data || [];
}

async function hasAttendanceForDate(orgId, workDate) {
  const { data, error } = await supabase
    .from("attendance")
    .select("id")
    .eq("organization_id", orgId)
    .eq("attendance_date", workDate)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

async function fetchEmployeesForOrg(orgId) {
  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .eq("organization_id", orgId);
  if (error) throw error;
  return data || [];
}

async function upsertAttendanceRows(rows) {
  if (!rows || rows.length === 0) return;
  const { error } = await supabase
    .from("attendance")
    .upsert(rows, { onConflict: "employee_id,attendance_date" });
  if (error) throw error;
}

// ---------- bulk create ----------

async function insertSingleDailyWorkRow(payload) {
  const { error } = await supabase.from("daily_work").insert(payload);
  return error || null;
}

module.exports = {
  getProductNameMap,
  getUserNameMap,
  mapRow,
  fetchDailyWorkBatches,
  fetchAllocatedByBatch,
  fetchDailyWorkById,
  findDuplicateBatch,
  insertDailyWork,
  fetchDailyWorkForUpdate,
  fetchAllocatedSum,
  updateDailyWorkRow,
  hasAllocations,
  deleteDailyWorkRow,
  fetchServicesForOrg,
  fetchExistingBatchProductIds,
  insertDailyWorkRows,
  hasAttendanceForDate,
  fetchEmployeesForOrg,
  upsertAttendanceRows,
  insertSingleDailyWorkRow,
};
