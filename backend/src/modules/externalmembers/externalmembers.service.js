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
// PERMANENT UNTIL REMOVED: an external member added to a service stays on
// that service for EVERY date until someone removes them. The work_date
// column is still stored (the date it was last saved) but is NOT used to
// filter — reads return everyone saved for the service, and a save replaces
// the whole set for the service whatever date it was originally added on.
//
// Table: external_service_members(id, organization_id, product_id,
//        employee_id, work_date, created_at)
// Unique on (organization_id, product_id, employee_id, work_date).

const supabase = require("../../config/supabaseClient");

const TABLE = "external_service_members";

// `_workDate` is accepted for backwards compatibility with the frontend but
// deliberately ignored: externals are not tied to a single date any more.
async function fetchExternalMembers(organizationId, productId, _workDate) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("employee_id")
    .eq("organization_id", organizationId)
    .eq("product_id", productId);

  if (error) throw error;
  // de-duplicate: older rows may hold the same person on several dates
  return [...new Set((data || []).map((row) => row.employee_id))];
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
  // Delete EVERY row for this service (any date), so people added on older
  // dates are replaced too and a removal really removes them.
  const { error: deleteError } = await supabase
    .from(TABLE)
    .delete()
    .eq("organization_id", organizationId)
    .eq("product_id", productId);

  if (deleteError) throw deleteError;

  if (!employeeIds || employeeIds.length === 0) return [];

  const rows = [...new Set(employeeIds)].map((employeeId) => ({
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
