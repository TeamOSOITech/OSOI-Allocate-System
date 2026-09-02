// src/modules/externalmembers/externalmembers.service.js
//
// All Supabase/DB access for "External Members" — employees an admin
// borrows onto a service for a single work date on the Employees tab
// (Today's Allocation page) even though their own Team isn't linked to
// that service. Previously this only lived in frontend component state
// (a Set that got wiped on every reload / service switch), so it never
// survived a page refresh or a new visit. Persisting it here means the
// same external picks come back automatically the next time that
// service+date combination is opened.
//
// Table: external_service_members(id, organization_id, product_id,
//        employee_id, work_date, created_at)
// Unique on (organization_id, product_id, employee_id, work_date) so
// re-adding the same person for the same service/date is a no-op, not
// a duplicate row.

const supabase = require("../../config/supabaseClient");

const TABLE = "external_service_members";

async function fetchExternalMembers(organizationId, productId, workDate) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("employee_id")
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .eq("work_date", workDate);

  if (error) throw error;
  return (data || []).map((row) => row.employee_id);
}

// Replaces the FULL external-member set for this org+service+date in one
// call — matches the frontend's Set<string> model (the whole picker
// state is sent every time it changes), so there's no need for
// separate add/remove endpoints or to diff against what's already saved.
async function replaceExternalMembers(
  organizationId,
  productId,
  workDate,
  employeeIds,
) {
  const { error: deleteError } = await supabase
    .from(TABLE)
    .delete()
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .eq("work_date", workDate);

  if (deleteError) throw deleteError;

  if (!employeeIds || employeeIds.length === 0) return [];

  const rows = employeeIds.map((employeeId) => ({
    organization_id: organizationId,
    product_id: productId,
    employee_id: employeeId,
    work_date: workDate,
  }));

  const { data, error } = await supabase.from(TABLE).insert(rows).select();
  if (error) throw error;
  return (data || []).map((row) => row.employee_id);
}

module.exports = { fetchExternalMembers, replaceExternalMembers };
