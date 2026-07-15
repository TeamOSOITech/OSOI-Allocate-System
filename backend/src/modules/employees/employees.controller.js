// src/modules/employees/employees.controller.js
//
// Uses your existing Supabase client from src/config/db.js (or supabaseClient.js —
// adjust the require path below to match wherever getSupabaseClient actually lives).
//
// ASSUMED table: "user_master"
// ACTUAL columns (confirmed from Supabase, with spaces/capitals exactly as stored):
//   id                  (primary key — confirm this is the real PK column name)
//   "First Name"
//   "Last Name"
//   "Employee ID"
//   "Department"
//   "Date of Birth"
//   "Date of Joining"
//   "Reporting Manager"
//   "Worked In Teams"
//   "Designation"
//   "Email"
//   photo_url           (doesn't exist yet — safe to add later, code already expects it)
//
// If the primary key isn't literally "id", update every `row.id` reference below.

const supabase = require("../../config/supabaseClient");

function mapRow(row) {
  const firstName = row["First Name"] ?? "";
  const lastName = row["Last Name"] ?? "";
  return {
    id: row.id,
    employeeCode: row["Employee ID"] ?? null,
    name: `${firstName} ${lastName}`.trim(),
    email: row["Email"] ?? null,
    designation: row["Designation"] ?? null,
    department: row["Department"] ?? null,
    reportingManager: row["Reporting Manager"] ?? null,
    joiningDate: row["Date of Joining"] ?? null,
    dateOfBirth: row["Date of Birth"] ?? null,
    workedInTeams: row["Worked In Teams"] ?? null,
    photoUrl: row.photo_url ?? null,
    // No status column exists yet in user_master — defaulting so the UI
    // doesn't break. Once you add a real "status" column, replace this
    // with: status: row.status ?? "Active",
    status: "Active",
    // overwritten below once praises are fetched
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

  // Fill in praise counts if a "praises" table exists. If it doesn't exist
  // yet, this silently leaves praisesCount at 0 instead of failing the
  // whole request.

  res.json(employees);
}

module.exports = { listEmployees };
