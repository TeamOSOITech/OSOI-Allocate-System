// src/modules/employeeleaves/employeeleaves.controller.js
//
// Leave PERIODS (from date -> to date) for an employee.
//   GET    /api/employee-leaves?date=YYYY-MM-DD   leaves covering that date
//   GET    /api/employee-leaves                    current + upcoming leaves
//   POST   /api/employee-leaves                    { employeeIds[], fromDate, toDate, reason? }
//   DELETE /api/employee-leaves/:id

const supabase = require("../../config/supabaseClient");

const orgIdOf = (req) => req.user.organizationId;
const userIdOf = (req) => req.user.userId;

const MAX_RANGE_DAYS = 366;
const validYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const todayYmd = () => new Date().toISOString().slice(0, 10);

const shape = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  fromDate: r.from_date,
  toDate: r.to_date,
  reason: r.reason || "",
  createdAt: r.created_at,
});

// Exported so attendance / allocation code can reuse the same rule:
// returns a Set of employee ids that are on a leave period on `date`.
async function getLeaveEmployeeIdsForDate(orgId, date) {
  const { data, error } = await supabase
    .from("employee_leaves")
    .select("employee_id")
    .eq("organization_id", orgId)
    .lte("from_date", date)
    .gte("to_date", date);
  if (error) throw error;
  return new Set((data || []).map((r) => r.employee_id));
}

async function listLeaves(req, res) {
  try {
    const orgId = orgIdOf(req);
    let q = supabase
      .from("employee_leaves")
      .select("*")
      .eq("organization_id", orgId);

    if (req.query.date) {
      if (!validYmd(req.query.date))
        return res
          .status(400)
          .json({ success: false, message: "date must be YYYY-MM-DD" });
      q = q.lte("from_date", req.query.date).gte("to_date", req.query.date);
    } else {
      // current + upcoming (not yet over)
      q = q.gte("to_date", todayYmd());
    }

    const { data, error } = await q
      .order("from_date", { ascending: true })
      .limit(1000);
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(shape) });
  } catch (err) {
    console.error("listLeaves error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createLeaves(req, res) {
  try {
    const orgId = orgIdOf(req);
    const employeeIds = Array.isArray(req.body?.employeeIds)
      ? [...new Set(req.body.employeeIds.filter(Boolean))]
      : [];
    const { fromDate, toDate } = req.body || {};
    const reason = (req.body?.reason || "").toString().trim().slice(0, 200);

    if (employeeIds.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "Select at least one employee." });
    if (!validYmd(fromDate) || !validYmd(toDate))
      return res.status(400).json({
        success: false,
        message: "Valid From and To dates are required.",
      });
    if (toDate < fromDate)
      return res.status(400).json({
        success: false,
        message: "To date can't be before From date.",
      });
    const days =
      (new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) /
        86400000 +
      1;
    if (days > MAX_RANGE_DAYS)
      return res.status(400).json({
        success: false,
        message: `Leave period can't be longer than ${MAX_RANGE_DAYS} days.`,
      });

    // every employee must belong to this organization
    const { data: emps, error: empErr } = await supabase
      .from("user_master")
      .select('"Auth User Id"')
      .eq("organization_id", orgId)
      .in("Auth User Id", employeeIds);
    if (empErr) throw empErr;
    if ((emps || []).length !== employeeIds.length)
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });

    const rows = employeeIds.map((employeeId) => ({
      organization_id: orgId,
      employee_id: employeeId,
      from_date: fromDate,
      to_date: toDate,
      reason: reason || null,
      created_by: userIdOf(req),
    }));
    const { data, error } = await supabase
      .from("employee_leaves")
      .insert(rows)
      .select();
    if (error) throw error;

    res.status(201).json({
      success: true,
      message: `Leave marked for ${rows.length} employee(s) (${fromDate} to ${toDate}).`,
      data: (data || []).map(shape),
    });
  } catch (err) {
    console.error("createLeaves error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteLeave(req, res) {
  try {
    const { data, error } = await supabase
      .from("employee_leaves")
      .delete()
      .eq("id", req.params.id)
      .eq("organization_id", orgIdOf(req))
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return res
        .status(404)
        .json({ success: false, message: "Leave period not found" });
    res.json({ success: true, message: "Leave period removed." });
  } catch (err) {
    console.error("deleteLeave error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listLeaves,
  createLeaves,
  deleteLeave,
  getLeaveEmployeeIdsForDate,
};
