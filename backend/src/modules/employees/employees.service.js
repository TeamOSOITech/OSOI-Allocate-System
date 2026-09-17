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
  // FIX: this used to only delete the user_master row, leaving the
  // Supabase Auth account behind untouched. user.service.js's
  // emailExists() checks Supabase Auth (not user_master) before letting
  // someone be re-added, so a "deleted" employee's email stayed
  // permanently blocked from re-onboarding with an "already exists"
  // error — even though they no longer showed up anywhere in the app.
  //
  // ORDER MATTERS: user_master."Auth User Id" is FK-referenced against
  // auth.users, so the user_master row must be deleted FIRST. Deleting
  // the Auth user while that row still exists trips the FK constraint
  // and Supabase's admin API surfaces that as a generic 500 from
  // GoTrueAdminApi.deleteUser (confirmed in testing) — not a clean,
  // catchable error. Once the referencing row is gone, deleting the
  // Auth account is safe.
  const { error: dbError } = await supabase
    .from("user_master")
    .delete()
    .eq("Auth User Id", id)
    .eq("organization_id", organizationId);

  if (dbError) throw dbError;

  // RETRY: the Auth delete call can fail on a purely transient network
  // hiccup (seen in testing as AuthRetryableFetchError — the request
  // never even reached Supabase, nothing to do with FKs/data). Since
  // this is the actual account removal that unblocks re-adding the same
  // email, we don't want one dropped packet to leave it permanently
  // orphaned. Retry a few times with a short backoff before giving up.
  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { error: authError } = await supabase.auth.admin.deleteUser(id);

    if (!authError) {
      lastError = null;
      break;
    }

    // "User not found" just means it was already removed from Auth in a
    // previous attempt (or never had a real Auth account) — not a real
    // failure, since the goal (email free to re-add) is already met.
    // No point retrying this one.
    const alreadyGone =
      authError.status === 404 || /not.?found/i.test(authError.message || "");
    if (alreadyGone) {
      lastError = null;
      break;
    }

    lastError = authError;
    if (attempt < MAX_ATTEMPTS) {
      // Short exponential backoff: 300ms, 900ms.
      await new Promise((resolve) =>
        setTimeout(resolve, 300 * 3 ** (attempt - 1)),
      );
    }
  }

  if (lastError) {
    // The user_master row is already gone at this point — the employee
    // has disappeared from the app either way. We only log here (not
    // throw) so the caller still sees delete as successful; an Auth
    // account stuck behind after all retries needs manual cleanup in
    // the Supabase dashboard, but it no longer blocks anything else in
    // the app itself.
    console.error(
      `deleteEmployeeRow: user_master row ${id} was deleted, but the ` +
        `Supabase Auth account could not be removed after ${MAX_ATTEMPTS} ` +
        `attempts. It needs manual cleanup in the Supabase dashboard:`,
      lastError,
    );
  }
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
