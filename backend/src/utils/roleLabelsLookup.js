// src/utils/roleLabelsLookup.js
//
// Single place the backend reads an org's custom role names from
// (the same `role_labels` table the Add User page's Role dropdown reads
// via GET /api/role-labels). Used by the Bulk Add Users Excel template
// (so its Role dropdown shows the SAME names the page shows) and by the
// bulk upload (so a custom name typed/picked in Excel maps back to the
// real role code).
//
// Role CODES (TEAM_MEMBER ...) never change; only the label does.

const supabase = require("../config/supabaseClient");

const DEFAULT_ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Ops Manager",
  AUDIT_MANAGER: "Audit Manager",
  PROCESS_LEAD: "Process Lead",
  VERTICAL_HEAD: "Vertical Head",
  TEAM_MEMBER: "Team Member",
};

// { TEAM_MEMBER: "Employee", ... } - org overrides on top of defaults.
// Fails soft to defaults (same behaviour as GET /api/role-labels).
async function getOrgRoleLabels(orgId) {
  const merged = { ...DEFAULT_ROLE_LABELS };
  try {
    const { data, error } = await supabase
      .from("role_labels")
      .select("role, label")
      .eq("organization_id", orgId);
    if (error) throw error;
    for (const row of data || []) {
      if (
        row.role !== "SUPER_ADMIN" &&
        DEFAULT_ROLE_LABELS[row.role] &&
        row.label
      ) {
        merged[row.role] = row.label;
      }
    }
  } catch (err) {
    console.error("getOrgRoleLabels failed, using defaults:", err.message);
  }
  return merged;
}

const key = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, " ");

// Turns whatever is in the Excel Role cell into a role CODE:
//   "Employee" (custom label) | "Team Member" | "team-member" | "TEAM_MEMBER"
//   -> "TEAM_MEMBER".  Unknown text is returned upper-snake-cased so the
// normal "not allowed to create role X" check still reports it.
function resolveRoleCode(value, labels) {
  const k = key(value);
  if (!k) return "";
  for (const [code, label] of Object.entries(labels || {})) {
    if (key(label) === k) return code;
  }
  for (const code of Object.keys(DEFAULT_ROLE_LABELS)) {
    if (key(code) === k || key(DEFAULT_ROLE_LABELS[code]) === k) return code;
  }
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s\-]+/g, "_");
}

module.exports = { DEFAULT_ROLE_LABELS, getOrgRoleLabels, resolveRoleCode };
