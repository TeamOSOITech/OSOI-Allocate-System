// src/modules/attendance/attendance.service.js
//
// All Supabase/DB access for the attendance module. Pulled out of
// attendance.controller.js so the controller only handles req/res +
// response shaping — this file is the only place that talks to the
// `attendance` table.
//
// Table:
//   attendance(id, organization_id, employee_id, attendance_date, status,
//              marked_by, created_at)
// status is one of: PRESENT | ABSENT | LEAVE
// Unique on (employee_id, attendance_date) so marking twice for the same
// day updates the same row instead of creating duplicates.

const supabase = require("../../config/supabaseClient");

function mapRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    attendanceDate: row.attendance_date,
    status: row.status,
    markedBy: row.marked_by,
    createdAt: row.created_at,
  };
}

async function fetchAttendanceForDate(orgId, date) {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("organization_id", orgId)
    .eq("attendance_date", date);

  if (error) throw error;
  return data || [];
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
