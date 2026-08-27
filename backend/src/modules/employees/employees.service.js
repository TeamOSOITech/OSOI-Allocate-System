// src/modules/employees/employees.service.js
//
// All Supabase/DB work + row-mapping for the employees module, pulled
// out of employees.controller.js so the controller only handles
// req/res + permission orchestration.
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
    // FIX: frontend (employees.tsx) sends/reads this field as "team", not
    // "workedInTeams" — that name mismatch is why Team silently failed to
    // save and always came back empty after refresh.
    team: row["Worked In Teams"] ?? null,
    photoUrl: row.photo_url ?? null,
    status: "Active",
  };
}

function normalizeEmail(email) {
  return (email || "").toString().trim().toLowerCase();
}

// NEW: Reporting Manager must be a real, existing user's email — and
// that user must belong to the SAME organization as the employee being
// edited. Mirrors the same check used at user-creation time
// (userRoutes.js's validateReportingManager) so the rule holds
// consistently whether a manager is set at signup or via later edit.
async function validateReportingManager(email, organizationId) {
  if (!email) return { valid: true }; // optional field

  const normalized = normalizeEmail(email);
  const { data, error } = await supabase
    .from("user_master")
    .select("Email")
    .eq("Email", normalized)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error("validateReportingManager lookup failed:", error);
    return { valid: false, message: "Could not verify reporting manager." };
  }

  if (!data) {
    return {
      valid: false,
      message: `Reporting manager "${email}" was not found in your organization.`,
    };
  }

  return { valid: true };
}

async function fetchAllEmployees(organizationId) {
  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .eq("organization_id", organizationId)
    .order("First Name", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapRow);
}

async function fetchEmployeeById(id, organizationId) {
  // FIX: .single() (and even .maybeSingle()) throw a PGRST116 error
  // whenever the query returns more than one row — including the known
  // user_master duplicate-row scenario documented elsewhere in this
  // codebase — which would otherwise turn into a false "employee not
  // found" / 500 here instead of just fetching the employee. Fetching
  // as a plain array and taking the first row tolerates duplicates
  // instead of crashing on them.
  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .eq("Auth User Id", id)
    .eq("organization_id", organizationId)
    .limit(2);

  if (error) {
    console.error("Failed to fetch employee:", error);
    return null;
  }
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    console.warn(
      `fetchEmployeeById: duplicate user_master rows found for Auth User Id ${id}. Using the first row.`,
    );
  }
  return mapRow(data[0]);
}

// Used by both updateEmployee and deleteEmployee to check the target's
// current role before allowing the action (edit/delete hierarchy).
async function fetchTargetRole(id, organizationId) {
  const { data, error } = await supabase
    .from("user_master")
    .select('"Role"')
    .eq("Auth User Id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw error;
  return data ? data["Role"] : undefined; // undefined = not found
}

async function updateEmployeeRow(id, organizationId, updatePayload) {
  // FIX: same .single() crash risk as fetchEmployeeById — if a
  // duplicate user_master row exists for this Auth User Id, Supabase
  // updates all matching rows but .select().single() throws because
  // more than one updated row came back, turning a successful update
  // into a 500 for the caller.
  const { data, error } = await supabase
    .from("user_master")
    .update(updatePayload)
    .eq("Auth User Id", id)
    .eq("organization_id", organizationId)
    .select();

  if (error) throw error;
  if (!data || data.length === 0) return null;
  if (data.length > 1) {
    console.warn(
      `updateEmployeeRow: duplicate user_master rows updated for Auth User Id ${id}. Returning the first row.`,
    );
  }
  return mapRow(data[0]);
}

async function deleteEmployeeRow(id, organizationId) {
  const { error } = await supabase
    .from("user_master")
    .delete()
    .eq("Auth User Id", id)
    .eq("organization_id", organizationId);

  if (error) throw error;
}

module.exports = {
  mapRow,
  normalizeEmail,
  validateReportingManager,
  fetchAllEmployees,
  fetchEmployeeById,
  fetchTargetRole,
  updateEmployeeRow,
  deleteEmployeeRow,
};
