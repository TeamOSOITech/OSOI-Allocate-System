// src/utils/orgGuards.js
//
// Tenant-isolation helpers. The backend talks to Supabase with the
// service-role key (RLS is bypassed), so every id that arrives from a
// request body must be checked against the caller's organization before
// it is written anywhere.

const supabase = require("../config/supabaseClient");

/**
 * Returns true only if EVERY id in `employeeIds` is a user_master
 * "Auth User Id" that belongs to `organizationId`.
 */
async function allEmployeesInOrg(employeeIds, organizationId) {
  const unique = [...new Set((employeeIds || []).filter(Boolean))];
  if (unique.length === 0) return true;

  const { data, error } = await supabase
    .from("user_master")
    .select('"Auth User Id"')
    .eq("organization_id", organizationId)
    .in("Auth User Id", unique);
  if (error) throw error;

  const found = new Set((data || []).map((r) => r["Auth User Id"]));
  return unique.every((id) => found.has(id));
}

// YYYY-MM-DD, and a real calendar date.
function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Escape % _ \ so user text is matched literally inside ilike patterns.
function escapeLikeWildcards(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

module.exports = { allEmployeesInOrg, isIsoDate, escapeLikeWildcards };
