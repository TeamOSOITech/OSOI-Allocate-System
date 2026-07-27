// src/modules/attendance/attendance.controller.js
//
// PAGE 6 (Attendance). Present/Absent/Leave grid for a given day.
// This is a hard dependency of Smart Auto Allocation — allocations.controller.js
// reads `attendance` rows (status = "PRESENT") for the daily_work's work_date
// before it can compute base_qty = floor(total_qty / present_count). Without
// this module, auto-allocate always fails with "No employees marked PRESENT".
//
// Table (assumed, same one allocations.controller.js already reads):
//   attendance(id, organization_id, employee_id, attendance_date, status,
//              marked_by, created_at)
// status is one of: PRESENT | ABSENT | LEAVE
// Unique on (employee_id, attendance_date) so marking twice for the same
// day updates the same row instead of creating duplicates.
//
// Every query scoped to req.user.organizationId — same tenant pattern as
// every other module in this codebase.

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

// ------------------------------------------------------------
// GET /api/attendance?date=YYYY-MM-DD
// ------------------------------------------------------------
async function listAttendance(req, res) {
  try {
    const { date } = req.query;
    if (!date) {
      return res
        .status(400)
        .json({ success: false, message: "date query param is required" });
    }

    const { data, error } = await supabase
      .from("attendance")
      .select("*")
      .eq("organization_id", req.user.organizationId)
      .eq("attendance_date", date);

    if (error) throw error;

    res.json({ success: true, data: (data || []).map(mapRow) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

// ------------------------------------------------------------
// POST /api/attendance/bulk
// body: { date, records: [{ employeeId, status }, ...] }
//
// Bulk mark for the whole grid in one call instead of one request per
// employee row. Upserts on (employee_id, attendance_date) so re-marking
// a day just overwrites the previous status.
// ------------------------------------------------------------
async function bulkMarkAttendance(req, res) {
  try {
    const { date, records } = req.body;
    const validStatuses = ["PRESENT", "ABSENT", "LEAVE"];

    if (!date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "date and a non-empty records[] array are required",
      });
    }

    for (const r of records) {
      if (!r.employeeId || !validStatuses.includes(r.status)) {
        return res.status(400).json({
          success: false,
          message: `Each record needs a valid employeeId and status (${validStatuses.join(", ")})`,
        });
      }
    }

    const rows = records.map((r) => ({
      organization_id: req.user.organizationId,
      employee_id: r.employeeId,
      attendance_date: date,
      status: r.status,
      marked_by: req.user.userId,
    }));

    const { data, error } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "employee_id,attendance_date" })
      .select();

    if (error) throw error;

    res.status(201).json({ success: true, data: (data || []).map(mapRow) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

module.exports = { listAttendance, bulkMarkAttendance };