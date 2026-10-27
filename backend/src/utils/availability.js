// src/utils/availability.js
//
// Who can NOT get work on a given date: employees whose attendance is LEAVE /
// ABSENT, plus employees inside an employee_leaves period. A status saved
// manually for the day wins over a leave period (same rule as
// attendance.service.js). Lives in utils with its own queries so any
// controller can use it without circular imports.

const supabase = require("../config/supabaseClient");

const TTL_MS = 5000; // bulk allocation sends many requests in a row
const cache = new Map();

async function getUnavailableEmployeeIds(orgId, date) {
  const key = `${orgId}|${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.set;

  const out = new Set();

  const { data: rows, error } = await supabase
    .from("attendance")
    .select("employee_id, status")
    .eq("organization_id", orgId)
    .eq("attendance_date", date);
  if (error) throw error;

  const saved = new Set();
  (rows || []).forEach((r) => {
    saved.add(String(r.employee_id));
    if (r.status === "LEAVE" || r.status === "ABSENT")
      out.add(String(r.employee_id));
  });

  // leave periods (a missing table must never break allocation)
  try {
    const { data: leaves, error: lErr } = await supabase
      .from("employee_leaves")
      .select("employee_id")
      .eq("organization_id", orgId)
      .lte("from_date", date)
      .gte("to_date", date);
    if (lErr) throw lErr;
    (leaves || []).forEach((l) => {
      const id = String(l.employee_id);
      if (!saved.has(id)) out.add(id); // manual row wins
    });
  } catch (err) {
    console.error(
      "getUnavailableEmployeeIds: leave periods:",
      err?.message || err,
    );
  }

  cache.set(key, { at: Date.now(), set: out });
  return out;
}

// keeps only employees who are available on `date`
async function filterAvailableEmployees(orgId, date, employeeIds) {
  const unavailable = await getUnavailableEmployeeIds(orgId, date);
  return employeeIds.filter((id) => !unavailable.has(String(id)));
}

module.exports = { getUnavailableEmployeeIds, filterAvailableEmployees };
