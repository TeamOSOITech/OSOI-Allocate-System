// src/modules/employees/employees.controller.js
//
// Req/res handling for the employees module. All Supabase/DB work and
// row-mapping live in employees.service.js — this file orchestrates:
// read the request, run permission checks, call the service, shape the
// response.

const {
  canEditTargetRole,
  canDeleteTargetRole,
} = require("../../config/permissions");
const employeesService = require("./employees.service");

// CHANGED: which roles may change another user's role at all, and which
// roles each of them may ASSIGN. Mirrors ASSIGNABLE_ROLES in employees.tsx.
//   Super Admin -> any of the six roles
//   Ops Manager -> only Process Lead / Vertical Head / Team Member
// Every other role has no entry = cannot change roles.
// (Who can be edited at all is still decided by canEditTargetRole below,
// so an Ops Manager can never touch a Super Admin / Audit Manager /
// another Ops Manager record.)
const ROLE_CHANGE_ASSIGNABLE = {
  SUPER_ADMIN: [
    "SUPER_ADMIN",
    "OPS_MANAGER",
    "AUDIT_MANAGER",
    "PROCESS_LEAD",
    "VERTICAL_HEAD",
    "TEAM_MEMBER",
  ],
  OPS_MANAGER: ["PROCESS_LEAD", "VERTICAL_HEAD", "TEAM_MEMBER"],
};

async function listEmployees(req, res) {
  const orgId = req.user.organizationId;

  try {
    let employees = await employeesService.fetchAllEmployees(orgId);

    // Vertical Head only ever sees their OWN team's employees. Self is
    // always kept in the list even if their own Team field happens to be
    // blank/mismatched. Every other role gets the full org list.
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

  // Enforce the full org hierarchy for WHO can edit WHOM:
  //   Super Admin  -> can edit anyone (incl. other Super Admins)
  //   Ops Manager  -> Process Lead, Vertical Head, Team Member
  //   Process Lead -> Vertical Head, Team Member
  // See EDITABLE_TARGET_ROLES in src/config/permissions.js.
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

  // Reporting manager, if being changed, must be a real user in the
  // same organization. Checked before building updatePayload so a bad
  // value never reaches the DB write.
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

  // CHANGED: Role edits are now allowed for Super Admin AND Ops Manager.
  //   * Super Admin -> any employee, any of the six roles.
  //   * Ops Manager -> only employees they may edit (checked above), and
  //     only to Process Lead / Vertical Head / Team Member.
  //   * Everyone else -> 403.
  // The frontend sends the employee's current role back on every save,
  // so we only enforce this when the role is actually CHANGING. An
  // unchanged role is silently ignored instead of causing a 403.
  if (body.role !== undefined && body.role !== targetRole) {
    const allowed = ROLE_CHANGE_ASSIGNABLE[req.user.role];
    if (!allowed) {
      return res.status(403).json({
        error: "Only a Super Admin or Ops Manager can change a user's role.",
      });
    }
    if (!allowed.includes(body.role)) {
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
  // Frontend sends this field as "team" (not "workedInTeams").
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

  // requirePermission("employees.manage") on the route alone isn't
  // enough — Process Lead also holds that permission, but delete is
  // Super Admin / Ops Manager ONLY. See DELETABLE_TARGET_ROLES in
  // src/config/permissions.js.
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

// ------------------------------------------------------------
// POST /api/employees/:id/reset-password   body: { newPassword }
//
// Admin-side password reset that sets the password straight away (no
// email / recovery link).
//
// Who: ONLY Super Admin and Ops Manager. On top of that the target must
// be someone the caller is allowed to edit (EDITABLE_TARGET_ROLES).
// ------------------------------------------------------------
const RESET_PASSWORD_ROLES = ["SUPER_ADMIN", "OPS_MANAGER"];
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt only uses the first 72 bytes

async function resetEmployeePassword(req, res) {
  const { id } = req.params;
  const orgId = req.user.organizationId;

  if (!RESET_PASSWORD_ROLES.includes(req.user.role)) {
    return res.status(403).json({
      error: "Only a Super Admin or Ops Manager can reset a password.",
    });
  }

  const newPassword =
    typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password can be at most ${MAX_PASSWORD_LENGTH} characters.`,
    });
  }

  let targetRole;
  try {
    targetRole = await employeesService.fetchTargetRole(id, orgId);
  } catch (error) {
    console.error("Failed to look up target employee role:", error);
    return res.status(500).json({ error: "Failed to reset password" });
  }
  if (targetRole === undefined) {
    return res.status(404).json({ error: "Employee not found" });
  }
  if (!canEditTargetRole(req.user.role, targetRole)) {
    return res.status(403).json({
      error: "You don't have permission to reset this employee's password.",
    });
  }

  const result = await employeesService.setEmployeePassword(id, newPassword);
  if (!result.ok) {
    return res
      .status(400)
      .json({ error: result.message || "Failed to reset password" });
  }

  // audit trail — who reset whose password (never the password itself)
  console.log(
    `[resetEmployeePassword] ${req.user.userId} (${req.user.role}) reset the password of ${id}`,
  );
  res.json({ success: true, message: "Password updated." });
}

module.exports = {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  resetEmployeePassword,
};
