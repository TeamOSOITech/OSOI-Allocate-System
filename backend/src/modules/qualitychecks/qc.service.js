// src/modules/qualitychecks/qc.service.js
//
// All Supabase/DB access for the Quality Checks module. Pulled out of
// qc.controller.js so the controller only handles req/res + response
// shaping — this file is the only place that talks to the `qc_checks` /
// `user_master` / `service_master` tables for QC.
//
// Every query is scoped to organizationId, same multi-tenant pattern as
// every other module in this codebase.

const supabase = require("../../config/supabaseClient");

// ------------------------------------------------------------
// Shared helper: given a list of employee/product ids, fetch their
// display names in one query each — manual-join pattern (no FK
// embedding, since PostgREST needs an actual DB constraint for that,
// and these tables don't have one defined).
// ------------------------------------------------------------
async function getEmployeeNameMap(employeeIds) {
  const uniqueIds = [...new Set(employeeIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id", "First Name", "Last Name", "Employee ID"')
    .in('"Auth User Id"', uniqueIds);
  if (error) {
    console.error("Failed to fetch employee names for QC:", error);
    return {};
  }

  return (data || []).reduce((acc, row) => {
    const name = [row["First Name"], row["Last Name"]]
      .filter(Boolean)
      .join(" ")
      .trim();
    acc[row["Auth User Id"]] = {
      name: name || null,
      employeeCode: row["Employee ID"] || null,
    };
    return acc;
  }, {});
}

async function getProductNameMap(productIds) {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return {};

  const { data, error } = await supabase
    .from("service_master")
    .select("id, product_name")
    .in("id", uniqueIds);
  if (error) {
    console.error("Failed to fetch product names for QC:", error);
    return {};
  }

  return (data || []).reduce((acc, p) => {
    acc[p.id] = p.product_name;
    return acc;
  }, {});
}

// ------------------------------------------------------------
// Recent QC checks for an organization, newest first. Optional
// employeeId/productId filters.
// ------------------------------------------------------------
async function fetchQcChecks(orgId, { employeeId, productId } = {}) {
  let query = supabase
    .from("qc_checks")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (productId) query = query.eq("product_id", productId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function insertQcCheck(payload) {
  const { data, error } = await supabase
    .from("qc_checks")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  getEmployeeNameMap,
  getProductNameMap,
  fetchQcChecks,
  insertQcCheck,
};
