// src/modules/attendance/attendance.service.js
//
// All Supabase/DB access for the attendance module.
//
// NEW: Leave periods (employee_leaves table). fetchAttendanceForDate also
// returns a virtual LEAVE row (fromLeavePeriod: true, id: null) for every
// employee who is inside a leave period on that date and has NO manually
// saved row for it. A manually saved row always wins over the period.
// Nothing is written to `attendance` for these.

const supabase = require("../../config/supabaseClient");
const {
  getLeaveEmployeeIdsForDate,
} = require("../employeeleaves/employeeleaves.controller");

function mapRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    attendanceDate: row.attendance_date,
    status: row.status,
    markedBy: row.marked_by,
    createdAt: row.created_at,
    // true = not a saved row, it comes from a leave period
    fromLeavePeriod: !!row.from_leave_period,
  };
}

async function fetchAttendanceForDate(orgId, date) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("organization_id", orgId)
    .eq("attendance_date", date);

  if (error) throw error;
  const rows = data || [];

  // Merge leave periods. A failure here (e.g. table not created yet) must
  // never break plain attendance, so it is logged and skipped.
  try {
    const leaveIds = await getLeaveEmployeeIdsForDate(orgId, date);
    const saved = new Set(rows.map((r) => r.employee_id));
    leaveIds.forEach((employeeId) => {
      if (saved.has(employeeId)) return; // manual row wins
      rows.push({
        id: null,
        employee_id: employeeId,
        attendance_date: date,
        status: "LEAVE",
        marked_by: null,
        created_at: null,
        from_leave_period: true,
      });
    });
  } catch (err) {
    console.error("fetchAttendanceForDate: leave merge failed:", err);
  }

  return rows;
}

async function upsertAttendanceRows(rows) {
  const { data, error } = await supabase
    .from("attendance")
    .upsert(rows, { onConflict: "employee_id,attendance_date" })
    .select();

  if (error) throw error;
  return data || [];
}

module.exports = {
  mapRow,
  fetchAttendanceForDate,
  upsertAttendanceRows,
};
