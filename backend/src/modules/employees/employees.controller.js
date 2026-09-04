// src/modules/employees/employees.controller.js
//
// Req/res handling for the employees module. All Supabase/DB work and
// row-mapping live in employees.service.js — this file orchestrates:
// read the request, run permission checks, call the service, shape the
// response.

const {
  canAssignRole,
  canEditTargetRole,
  canDeleteTargetRole,
} = require("../../config/permissions");
const employeesService = require("./employees.service");

async function listEmployees(req, res) {
  const orgId = req.user.organizationId;

  try {
    let employees = await employeesService.fetchAllEmployees(orgId);

    // NEW: Vertical Head only ever sees their OWN team's employees —
    // matches the "own team, not the whole org" scope Vertical Head
    // already holds everywhere else (materialisation.view.team,
    // tasks.allocate.team) and is what powers the Employee/Team pickers
    // on Today's Allocation (see manualallocation.tsx). Self is always
    // kept in the list even if their own Team field happens to be
    // blank/mismatched, so a Vertical Head never loses sight of their
    // own row. Every other role is unaffected — full org list as before.
    if (req.user.role === "VERTICAL_HEAD") {
      const self = employees.find((e) => e.id === req.user.userId);
      const ownTeam = (self?.team || "").trim().toLowerCase();
      employees = employees.filter((e) => {
        if (e.id === req.user.userId) return true;
        return ownTeam && (e.team || "").trim().toLowerCase() === ownTeam;
      });
    }

    res.json(employees);
  } catch (error) {
    console.error("Failed to fetch user_master:", error);
    res.status(500).json({ error: "Failed to load employees" });
  }
}

async function getEmployeeById(req, res) {
  const { id } = req.params;
  const orgId = req.user.organizationId;

  const employee = await employeesService.fetchEmployeeById(id, orgId);
  if (!employee) {
    return res.status(404).json({ error: "Employee not found" });
  }

  res.json(employee);
}

async function updateEmployee(req, res) {
  const { id } = req.params;
  const orgId = req.user.organizationId;
  const body = req.body || {};

  // FIX: enforce the full org hierarchy for WHO can edit WHOM, not just
  // a special-case for Super Admin targets:
  //   Super Admin  -> can edit anyone (incl. other Super Admins)
  //   Ops Manager  -> Process Lead, Vertical Head, Team Member
  //   Process Lead -> Vertical Head, Team Member
  // See EDITABLE_TARGET_ROLES in src/config/permissions.js — this is
  // the single source of truth for that matrix, kept in sync with the
  // frontend's mirror in employees.tsx (canEditEmployee).
  let targetRole;
  try {
    targetRole = await employeesService.fetchTargetRole(id, orgId);
  } catch (error) {
    console.error("Failed to look up target employee role:", error);
    return res.status(500).json({ error: "Failed to update employee" });
  }
  if (targetRole === undefined) {
    return res.status(404).json({ error: "Employee not found" });
  }
  if (!canEditTargetRole(req.user.role, targetRole)) {
    return res.status(403).json({
      error: "You don't have permission to edit this employee.",
    });
  }

  // NEW: reporting manager, if being changed, must be a real user in
  // the same organization. Checked before building updatePayload so a
  // bad value never reaches the DB write.
  if (body.reportingManager !== undefined && body.reportingManager) {
    const rmCheck = await employeesService.validateReportingManager(
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
  // at user-creation time).
  //
  // Role edits are restricted to Super Admin ONLY, regardless of target
  // (Ops Manager/Process Lead can edit the other fields per
  // EDITABLE_TARGET_ROLES above, but never Role — granting/removing
  // elevated access stays a Super-Admin-only action).
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

  try {
    const updated = await employeesService.updateEmployeeRow(
      id,
      orgId,
      updatePayload,
    );
    if (!updated) {
      return res.status(404).json({ error: "Employee not found" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Failed to update employee:", error);
    res.status(500).json({ error: "Failed to update employee" });
  }
}

async function deleteEmployee(req, res) {
  const { id } = req.params;
  const orgId = req.user.organizationId;

  // FIX: requirePermission("employees.manage") on the route alone isn't
  // enough — Process Lead also holds that permission (for create/edit),
  // but per the org's flow, delete is Super Admin / Ops Manager ONLY.
  // See DELETABLE_TARGET_ROLES in src/config/permissions.js — Process
  // Lead is intentionally omitted there, so canDeleteTargetRole() always
  // returns false for it, blocking delete regardless of the target's
  // role. Also enforces the target-role hierarchy for Ops Manager
  // (can't delete another Ops Manager / Audit Manager / Super Admin).
  let targetRole;
  try {
    targetRole = await employeesService.fetchTargetRole(id, orgId);
  } catch (error) {
    console.error("Failed to look up target employee role:", error);
    return res.status(500).json({ error: "Failed to delete employee" });
  }
  if (targetRole === undefined) {
    return res.status(404).json({ error: "Employee not found" });
  }
  if (!canDeleteTargetRole(req.user.role, targetRole)) {
    return res.status(403).json({
      error: "You don't have permission to delete this employee.",
    });
  }

  try {
    await employeesService.deleteEmployeeRow(id, orgId);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete employee:", error);
    res.status(500).json({ error: "Failed to delete employee" });
  }
}

module.exports = {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
};
