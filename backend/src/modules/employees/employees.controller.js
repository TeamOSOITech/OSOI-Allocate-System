// src/modules/employees/employees.controller.js
//
// Uses your existing Supabase client from src/config/supabaseClient.js
//
// ASSUMED table: "user_master"
// ACTUAL primary key column: "Auth User Id" (uuid)

const supabase = require("../../config/supabaseClient");

function mapRow(row) {
  const firstName = row["First Name"] ?? "";
  const lastName = row["Last Name"] ?? "";
  return {
    id: row["Auth User Id"],
    employeeCode: row["Employee ID"] ?? null,
    name: `${firstName} ${lastName}`.trim(),
    email: row["Email"] ?? null,
    role: row["Role"] ?? null, // needed so pages can filter by role (e.g. Reporting Manager dropdown = Process Leads)
    designation: row["Designation"] ?? null,
    department: row["Department"] ?? null,
    reportingManager: row["Reporting Manager"] ?? null,
    joiningDate: row["Date of Joining"] ?? null,
    dateOfBirth: row["Date of Birth"] ?? null,
    workedInTeams: row["Worked In Teams"] ?? null,
    photoUrl: row.photo_url ?? null,
    status: "Active",
  };
}

async function listEmployees(req, res) {
  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .order("First Name", { ascending: true });

  if (error) {
    console.error("Failed to fetch user_master:", error);
    return res.status(500).json({ error: "Failed to load employees" });
  }

  const employees = (data || []).map(mapRow);
  res.json(employees);
}

async function getEmployeeById(req, res) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .eq("Auth User Id", id)
    .single();

  if (error) {
    console.error("Failed to fetch employee:", error);
    return res.status(404).json({ error: "Employee not found" });
  }

  res.json(mapRow(data));
}

async function updateEmployee(req, res) {
  const { id } = req.params;
  const body = req.body || {};

  const updatePayload = {};
  if (body.name !== undefined) {
    const [firstName, ...rest] = String(body.name).trim().split(" ");
    updatePayload["First Name"] = firstName ?? "";
    updatePayload["Last Name"] = rest.join(" ");
  }
  if (body.email !== undefined) updatePayload["Email"] = body.email;
  if (body.designation !== undefined)
    updatePayload["Designation"] = body.designation;
  if (body.department !== undefined)
    updatePayload["Department"] = body.department;
  if (body.reportingManager !== undefined)
    updatePayload["Reporting Manager"] = body.reportingManager;
  if (body.joiningDate !== undefined)
    updatePayload["Date of Joining"] = body.joiningDate;
  if (body.dateOfBirth !== undefined)
    updatePayload["Date of Birth"] = body.dateOfBirth;
  if (body.employeeCode !== undefined)
    updatePayload["Employee ID"] = body.employeeCode;
  if (body.workedInTeams !== undefined)
    updatePayload["Worked In Teams"] = body.workedInTeams;

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const { data, error } = await supabase
    .from("user_master")
    .update(updatePayload)
    .eq("Auth User Id", id)
    .select()
    .single();

  if (error) {
    console.error("Failed to update employee:", error);
    return res.status(500).json({ error: "Failed to update employee" });
  }

  if (!data) {
    return res.status(404).json({ error: "Employee not found" });
  }

  res.json(mapRow(data));
}

async function deleteEmployee(req, res) {
  const { id } = req.params;

  const { error } = await supabase
    .from("user_master")
    .delete()
    .eq("Auth User Id", id);

  if (error) {
    console.error("Failed to delete employee:", error);
    return res.status(500).json({ error: "Failed to delete employee" });
  }

  res.json({ success: true });
}

module.exports = {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
};
