// src/config/permissions.js
//
// Single source of truth for roles + permissions, built directly from
// "Approval Flow for Allocation App.docx".
//
// Why a static matrix instead of a DB table (role_permissions)?
// - No extra DB round-trip on every request (fast, cache-free).
// - The doc's matrix is not a simple "higher role = superset" ladder
//   (e.g. Audit Manager cannot allocate tasks, Ops Manager cannot touch
//   QC assignments) — so we encode the real matrix instead of relying
//   on a rank number.
// - If you later want tenants to customise roles, migrate this into a
//   `role_permissions` table and keep the same `hasPermission()` shape
//   so nothing else in the app has to change.

const ROLES = {
  TEAM_MEMBER: "TEAM_MEMBER",
  VERTICAL_HEAD: "VERTICAL_HEAD",
  PROCESS_LEAD: "PROCESS_LEAD",
  OPS_MANAGER: "OPS_MANAGER",
  AUDIT_MANAGER: "AUDIT_MANAGER",
  SUPER_ADMIN: "SUPER_ADMIN",
};

// Rank is ONLY used for simple "at least this senior" checks
// (e.g. UI gating). Real authorization must use PERMISSIONS below,
// because seniority here is not a strict inheritance ladder.
const ROLE_RANK = {
  [ROLES.TEAM_MEMBER]: 1,
  [ROLES.VERTICAL_HEAD]: 2,
  [ROLES.PROCESS_LEAD]: 3,
  [ROLES.OPS_MANAGER]: 4,
  [ROLES.AUDIT_MANAGER]: 4, // parallel to Ops Manager, not senior/junior to it
  [ROLES.SUPER_ADMIN]: 5,
};

// Every permission code used anywhere in the API, mapped to the roles
// allowed to perform it. Matches section-by-section from the doc.
const ROLE_PERMISSIONS = {
  [ROLES.TEAM_MEMBER]: [
    "materialisation.update.own",
    "materialisation.view.own",
  ],

  [ROLES.VERTICAL_HEAD]: [
    "materialisation.update.own",
    "materialisation.view.own",
    "tasks.allocate.team",
    "tasks.qc_allocate.team",
    "materialisation.view.team",
  ],

  [ROLES.PROCESS_LEAD]: [
    "materialisation.update.own",
    "materialisation.view.own",
    "tasks.allocate.org",
    "users.onboard",
    "verticals.start_for_existing_user",
    "qc_permission.request", // still needs approval — see APPROVAL_RULES
    "reports.materialisation.view.org",
    // NEW: Process Lead HOLDS these permissions (so it can reach the
    // routes at all) but every create/update/delete it attempts is
    // intercepted by approvalGate() and routed through APPROVAL_RULES
    // below instead of taking effect immediately — see
    // src/middlewares/approvalGate.js.
    "clients.manage",
    "products.manage",
    // NEW (tester feedback): Process Lead should be able to edit an
    // employee's Reporting Manager / Department / Designation / Team —
    // just never their Role (that's enforced separately in
    // employees.controller.js's updateEmployee(), which now hard-blocks
    // role changes to Super-Admin-only regardless of this permission).
    "employees.manage",
  ],

  [ROLES.OPS_MANAGER]: [
    "materialisation.view.own",
    "tasks.reassign_user",
    "teams.reassign",
    "verticals.add", // requires Super Admin approval
    "verticals.amend",
    "tasks.amend",
    "tasks.amend_time",
    "tasks.map_to_team",
    "users.deactivate",
    "employees.manage", // edit employee master records (designation, dept, reporting manager, etc.)
    "tasks.hide", // requires Super Admin approval
    "reports.qc.view.org",
    "reports.materialisation.view.org",
    "qc_permission.approve", // one of the 3 possible approvers
    // NEW: Ops Manager can also use Add User — same as Process Lead,
    // but scoped to a narrower set of assignable roles (see
    // ASSIGNABLE_ROLES below): can't hand out Super Admin, Ops Manager,
    // or Audit Manager access, only the roles below Process Lead.
    "users.onboard",
    // NEW: Client / Subclient / Product (Service) create-edit-delete access
    // — Ops Manager acts directly (no approval needed) AND is the
    // approver for Process Lead's requests (see APPROVAL_RULES below).
    "clients.manage",
    "products.manage",
  ],

  [ROLES.AUDIT_MANAGER]: [
    "materialisation.view.own",
    "qc.oversee",
    "qc_permission.approve", // one of the 3 possible approvers
    "qc.assignments.modify",
    "users.deactivate_qc",
    "reports.qc.view.org",
    // NEW: Client / Subclient / Product (Service) create-edit-delete access
    "clients.manage",
    "products.manage",
  ],

  [ROLES.SUPER_ADMIN]: [
    // Super Admin: full control, including override of any approval.
    "*",
  ],
};

// Actions that exist in ROLE_PERMISSIONS as "requested" but only take
// effect once approved. requestedBy = who can raise the request,
// approvers = any ONE of these roles can approve/reject.
const APPROVAL_RULES = {
  QC_PERMISSION_GRANT: {
    description:
      "Grant QC task permission to a user not already doing QC in any vertical",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER, ROLES.AUDIT_MANAGER, ROLES.SUPER_ADMIN],
  },
  NEW_VERTICAL: {
    description: "Add a new vertical",
    requestedBy: [ROLES.OPS_MANAGER],
    approvers: [ROLES.SUPER_ADMIN],
  },
  HIDE_TASK: {
    description: "Hide a task from allocation",
    requestedBy: [ROLES.OPS_MANAGER],
    approvers: [ROLES.SUPER_ADMIN],
  },

  // NEW: Process Lead's Service (Product) / Client / Subclient
  // create-update-delete actions all require Ops Manager approval before
  // taking effect. See src/middlewares/approvalGate.js for how a
  // matching request gets intercepted before reaching the real
  // controller, and approvals.controller.js's applyApprovedAction() for
  // what actually happens on APPROVE.
  //
  // restrictToReportingManager: true — narrows `approvers` (any Ops
  // Manager) down to specifically the requester's OWN reporting manager.
  // approvalGate.js resolves that at request-creation time and stores it
  // as target_user_id; approvals.controller.js's listRequests/
  // decideRequest then only let that specific user act on it (falling
  // back to the broad `approvers` role check if no reporting manager
  // could be resolved, so a request never gets stuck un-actionable).
  SERVICE_CREATE: {
    description: "Create a new service (product)",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  SERVICE_UPDATE: {
    description: "Edit an existing service (product)",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  SERVICE_DELETE: {
    description: "Delete a service (product)",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  CLIENT_CREATE: {
    description: "Create a new client",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  CLIENT_UPDATE: {
    description: "Edit an existing client",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  CLIENT_DELETE: {
    description: "Delete a client",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  SUBCLIENT_CREATE: {
    description: "Create a new subclient",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  SUBCLIENT_UPDATE: {
    description: "Edit an existing subclient",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
  SUBCLIENT_DELETE: {
    description: "Delete a subclient",
    requestedBy: [ROLES.PROCESS_LEAD],
    approvers: [ROLES.OPS_MANAGER],
    restrictToReportingManager: true,
  },
};

// SECURITY: which roles a given role is allowed to CREATE via
// users.onboard (add-user / bulk-add-user). Without this, any role
// holding "users.onboard" (currently PROCESS_LEAD) could set
// `role: "SUPER_ADMIN"` in the request body and hand themselves —
// or anyone — full admin access. This must be enforced server-side
// on every user-creation path, never inferred from the permission
// check alone.
const ASSIGNABLE_ROLES = {
  [ROLES.PROCESS_LEAD]: [ROLES.TEAM_MEMBER, ROLES.VERTICAL_HEAD],
  // NEW: matches Add User being opened up to Ops Manager above. Ops
  // Manager sits above Process Lead, so it can create everything
  // Process Lead can plus Process Lead itself — but still not Super
  // Admin, Ops Manager, or Audit Manager (Super Admin only, below).
  [ROLES.OPS_MANAGER]: [
    ROLES.TEAM_MEMBER,
    ROLES.VERTICAL_HEAD,
    ROLES.PROCESS_LEAD,
  ],
  [ROLES.SUPER_ADMIN]: [
    ROLES.TEAM_MEMBER,
    ROLES.VERTICAL_HEAD,
    ROLES.PROCESS_LEAD,
    ROLES.OPS_MANAGER,
    ROLES.AUDIT_MANAGER,
    ROLES.SUPER_ADMIN,
  ],
};

function canAssignRole(creatorRole, targetRole) {
  if (!ROLES[targetRole]) return false; // reject unknown/garbage role strings
  const allowed = ASSIGNABLE_ROLES[creatorRole];
  return Array.isArray(allowed) && allowed.includes(targetRole);
}

// Who can EDIT (Department, Designation, Reporting Manager, Team, name,
// email, etc. — everything except the Role field itself, which is
// handled separately below) an employee record whose current role is
// `targetRole`. Mirrors the org hierarchy:
//   Super Admin  -> everyone (including other Super Admins)
//   Ops Manager  -> Process Lead, Vertical Head, Team Member
//   Process Lead -> Vertical Head, Team Member
// Anyone not listed here (Team Member, Vertical Head, Audit Manager) has
// no edit access at all — enforced upstream by requirePermission
// ("employees.manage"), which only Super Admin/Ops Manager/Process Lead
// hold.
const EDITABLE_TARGET_ROLES = {
  [ROLES.SUPER_ADMIN]: [
    ROLES.TEAM_MEMBER,
    ROLES.VERTICAL_HEAD,
    ROLES.PROCESS_LEAD,
    ROLES.OPS_MANAGER,
    ROLES.AUDIT_MANAGER,
    ROLES.SUPER_ADMIN,
  ],
  [ROLES.OPS_MANAGER]: [
    ROLES.PROCESS_LEAD,
    ROLES.VERTICAL_HEAD,
    ROLES.TEAM_MEMBER,
  ],
  [ROLES.PROCESS_LEAD]: [ROLES.VERTICAL_HEAD, ROLES.TEAM_MEMBER],
};

// Who can DELETE an employee record whose current role is `targetRole`.
// Narrower than EDITABLE_TARGET_ROLES on purpose — Process Lead can edit
// Vertical Head / Team Member records but has NO delete access at all,
// per the org's requested flow ("delete ka option bas super admin and
// ops manager ke pass hoga").
const DELETABLE_TARGET_ROLES = {
  [ROLES.SUPER_ADMIN]: [
    ROLES.TEAM_MEMBER,
    ROLES.VERTICAL_HEAD,
    ROLES.PROCESS_LEAD,
    ROLES.OPS_MANAGER,
    ROLES.AUDIT_MANAGER,
    ROLES.SUPER_ADMIN,
  ],
  [ROLES.OPS_MANAGER]: [
    ROLES.PROCESS_LEAD,
    ROLES.VERTICAL_HEAD,
    ROLES.TEAM_MEMBER,
  ],
  // PROCESS_LEAD intentionally omitted — no delete access for any target role.
};

function canEditTargetRole(actorRole, targetRole) {
  const allowed = EDITABLE_TARGET_ROLES[actorRole];
  return Array.isArray(allowed) && allowed.includes(targetRole);
}

function canDeleteTargetRole(actorRole, targetRole) {
  const allowed = DELETABLE_TARGET_ROLES[actorRole];
  return Array.isArray(allowed) && allowed.includes(targetRole);
}

function hasPermission(role, permissionCode) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes("*") || perms.includes(permissionCode);
}

function isAtLeast(role, minRole) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minRole] || 0);
}

module.exports = {
  ROLES,
  ROLE_RANK,
  ROLE_PERMISSIONS,
  ASSIGNABLE_ROLES,
  EDITABLE_TARGET_ROLES,
  DELETABLE_TARGET_ROLES,
  APPROVAL_RULES,
  hasPermission,
  isAtLeast,
  canAssignRole,
  canEditTargetRole,
  canDeleteTargetRole,
};
