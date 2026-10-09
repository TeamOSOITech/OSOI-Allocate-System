// src/modules/servicecases/fairness.js
//
// Shared by BOTH Smart Allocations (case-number cases + count-only entries).
// Extra cases (when work can't split evenly) go to whoever got the LEAST work
// for this service in the last HISTORY_DAYS days.

const supabase = require("../../config/supabaseClient");

const HISTORY_DAYS = 30;
const PAGE = 1000;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function getRecentLoad(
  organizationId,
  productId,
  workDate,
  employeeIds,
  days = HISTORY_DAYS,
) {
  const load = {};
  employeeIds.forEach((id) => (load[id] = 0));
  if (!employeeIds.length) return load;

  const fromDate = new Date(`${workDate}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - days);
  const fromStr = ymd(fromDate);

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("service_cases")
      .select("assigned_employee_id")
      .eq("organization_id", organizationId)
      .eq("product_id", productId)
      .eq("allocation_status", "ALLOCATED")
      .in("assigned_employee_id", employeeIds)
      .gte("work_date", fromStr)
      .lt("work_date", workDate)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    (data || []).forEach((r) => {
      load[r.assigned_employee_id] = (load[r.assigned_employee_id] || 0) + 1;
    });
    if (!data || data.length < PAGE) break;
  }

  const { data: counts, error: cErr } = await supabase
    .from("service_case_counts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("product_id", productId)
    .gte("work_date", fromStr)
    .lt("work_date", workDate);
  if (cErr) throw cErr;
  const countIds = (counts || []).map((c) => c.id);
  for (let i = 0; i < countIds.length; i += 150) {
    const chunk = countIds.slice(i, i + 150);
    const { data: allocs, error: aErr } = await supabase
      .from("service_case_count_allocations")
      .select("employee_id, quantity, fulfilled_quantity")
      .eq("organization_id", organizationId)
      .in("count_id", chunk)
      .in("employee_id", employeeIds);
    if (aErr) throw aErr;
    (allocs || []).forEach((a) => {
      // MODIFIED: units whose real case numbers were already added (by the
      // employee, from the Profile page) now exist as service_cases rows and
      // are counted by the query above — only count the still-unconverted
      // part here so that work isn't counted twice.
      const unconverted = Math.max(0, a.quantity - (a.fulfilled_quantity || 0));
      load[a.employee_id] = (load[a.employee_id] || 0) + unconverted;
    });
  }
  return load;
}

function orderByLeastLoad(employeeIds, load) {
  return [...employeeIds].sort(
    (a, b) =>
      (load[a] || 0) - (load[b] || 0) || String(a).localeCompare(String(b)),
  );
}

function distributeFairly(n, employeeIds, load) {
  const result = {};
  employeeIds.forEach((id) => (result[id] = 0));
  if (n <= 0 || employeeIds.length === 0) return result;
  const base = Math.floor(n / employeeIds.length);
  const extra = n % employeeIds.length;
  employeeIds.forEach((id) => {
    result[id] = base;
    load[id] = (load[id] || 0) + base;
  });
  const order = orderByLeastLoad(employeeIds, load);
  for (let i = 0; i < extra; i++) {
    result[order[i]] += 1;
    load[order[i]] = (load[order[i]] || 0) + 1;
  }
  return result;
}

module.exports = {
  HISTORY_DAYS,
  getRecentLoad,
  orderByLeastLoad,
  distributeFairly,
};
