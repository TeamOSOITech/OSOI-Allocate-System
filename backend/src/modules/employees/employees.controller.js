// src/modules/employees/employees.controller.js
//
// Uses your existing Supabase client from src/config/supabaseClient.js
//
// ASSUMED table: "user_master"
// ACTUAL primary key column: "Auth User Id" (uuid)

const supabase = require("../../config/supabaseClient");
const { canAssignRole } = require("../../config/permissions");

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

async function listEmployees(req, res) {
  const orgId = req.user.organizationId;

  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .eq("organization_id", orgId)
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
  const orgId = req.user.organizationId;

  const { data, error } = await supabase
    .from("user_master")
    .select("*")
    .eq("Auth User Id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) {
    console.error("Failed to fetch employee:", error);
    return res.status(404).json({ error: "Employee not found" });
  }

  res.json(mapRow(data));
}

async function updateEmployee(req, res) {
  const { id } = req.params;
  const orgId = req.user.organizationId;
  const body = req.body || {};

  // NEW: reporting manager, if being changed, must be a real user in
  // the same organization. Checked before building updatePayload so a
  // bad value never reaches the DB write.
  if (body.reportingManager !== undefined && body.reportingManager) {
    const rmCheck = await validateReportingManager(
      body.reportingManager,
      orgId,
    );
    if (!rmCheck.valid) {
      return res.status(400).json({ error: rmCheck.message });
    }
  }

  const updatePayload = {};

  // FIX (Finding #03): there was previously no way to change a user's
  // role after creation — req.body.role was never read, so a demoted
  // SUPER_ADMIN kept full access until someone edited user_master.Role
  // directly in Supabase. Role changes are allowed here, but ONLY if the
  // acting user is permitted to assign the target role (same matrix used
  // at user-creation time), so e.g. an OPS_MANAGER still cannot promote
  // anyone to SUPER_ADMIN just because they hold "employees.manage".
  // FIX (Finding #03 + tester feedback): Role changes must be restricted
  // to Super Admin ONLY, regardless of who the target user is or what
  // role is being requested. The old check (canAssignRole) only looked
  // at "is this role in the requester's assignable list" — that let an
  // Ops Manager legally set body.role to e.g. "TEAM_MEMBER" on ANY
  // user's record, including silently demoting a Super Admin, since
  // TEAM_MEMBER is in Ops Manager's assignable list. Role edits are
  // sensitive enough that only Super Admin should ever be allowed to
  // change them via this endpoint — every other field (Department,
  // Designation, Reporting Manager, Team, etc.) remains editable by
  // anyone holding "employees.manage" (Ops Manager, Process Lead),
  // including on a Super Admin's own record.
  if (body.role !== undefined) {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        error: "Only a Super Admin can change a user's role.",
      });
    }
    if (!canAssignRole(req.user.role, body.role)) {
      return res.status(403).json({
        error: `You are not permitted to assign the role "${body.role}"`,
      });
    }
    updatePayload["Role"] = body.role;
  }

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
  // FIX: frontend sends this field as "team" (see employees.tsx —
  // updateEditField("team", ...) / drawerData.team), not "workedInTeams".
  // The old check (`body.workedInTeams !== undefined`) never matched
  // anything the frontend actually sends, so the "Worked In Teams" column
  // was silently never included in the update — Team appeared to save in
  // the UI (optimistic local state) but nothing was ever written to the
  // database, so it came back empty on every refresh.
  if (body.team !== undefined) updatePayload["Worked In Teams"] = body.team;

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const { data, error } = await supabase
    .from("user_master")
    .update(updatePayload)
    .eq("Auth User Id", id)
    .eq("organization_id", orgId)
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
  const orgId = req.user.organizationId;

  const { error } = await supabase
    .from("user_master")
    .delete()
    .eq("Auth User Id", id)
    .eq("organization_id", orgId);

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
