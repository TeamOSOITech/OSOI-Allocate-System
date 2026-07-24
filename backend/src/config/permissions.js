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
  ],

  [ROLES.AUDIT_MANAGER]: [
    "materialisation.view.own",
    "qc.oversee",
    "qc_permission.approve", // one of the 3 possible approvers
    "qc.assignments.modify",
    "users.deactivate_qc",
    "reports.qc.view.org",
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
};

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
  APPROVAL_RULES,
  hasPermission,
  isAtLeast,
};
