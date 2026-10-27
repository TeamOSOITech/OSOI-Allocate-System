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
    exitDate: row["Date of Exit"] ?? null,
    dateOfBirth: row["Date of Birth"] ?? null,
    // FIX: frontend (employees.tsx) sends/reads this field as "team", not
    // "workedInTeams" — that name mismatch is why Team silently failed to
    // save and always came back empty after refresh.
    team: row["Worked In Teams"] ?? null,
    photoUrl: row.photo_url ?? null,
    // Blue Collar mode: "WHITE" (service-based, the default) or "BLUE"
    // (manpower-based), plus the location a Blue Collar employee is at.
    collarType: row.collar_type === "BLUE" ? "BLUE" : "WHITE",
    locationId: row.blue_location_id ?? null,
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

// collar: "WHITE" (default — service-based users, incl. rows that pre-date
// the collar_type column), "BLUE" (manpower-based users) or "ALL".
async function fetchAllEmployees(organizationId, collar = "WHITE") {
  const build = (withFilter) => {
    let q = supabase
      .from("user_master")
      .select("*")
      .eq("organization_id", organizationId);
    if (withFilter && collar === "BLUE") q = q.eq("collar_type", "BLUE");
    if (withFilter && collar === "WHITE")
      q = q.or("collar_type.is.null,collar_type.eq.WHITE");
    return q.order("First Name", { ascending: true });
  };

  let { data, error } = await build(true);

  // collar_type column not created yet (migration not run): behave exactly
  // like before for White Collar instead of breaking every page.
  if (error && /collar_type/i.test(error.message || "") && collar !== "BLUE") {
    ({ data, error } = await build(false));
  }

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

  // The user_master row is gone. Now remove the Supabase Auth account so
  // the same email can be added again.
  const result = await removeAuthAccount(id);
  if (!result.ok) {
    // Never swallow this silently any more — an Auth account left behind
    // is exactly what made "already exists" appear on re-adding.
    throw new Error(
      `Employee was removed, but the login account could not be cleaned up: ${result.message}`,
    );
  }
  return { authCleanup: result.mode }; // "deleted" | "released-email"
}

function isAuthUserGone(authError) {
  return (
    authError &&
    (authError.status === 404 || /not.?found/i.test(authError.message || ""))
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Removes the employee's Supabase Auth account.
//
// 1) Try a real delete (retried — transient network errors happen).
// 2) If Supabase refuses the delete (typically a database error because
//    ANOTHER table still has a foreign key to auth.users, e.g. attendance /
//    service_cases history), the account can't be deleted without losing
//    that history. In that case we RELEASE THE EMAIL instead: rename the Auth
//    user to an unused address and ban it. The old login can no longer be
//    used and the real email is free to be added again.
async function removeAuthAccount(id) {
  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (!error || isAuthUserGone(error)) {
      return { ok: true, mode: "deleted" };
    }
    lastError = error;
    console.error(
      `removeAuthAccount: delete attempt ${attempt}/${MAX_ATTEMPTS} failed for ${id}:`,
      error.status,
      error.message,
    );
    if (attempt < MAX_ATTEMPTS) await sleep(300 * 3 ** (attempt - 1));
  }

  // Real delete is blocked -> release the email instead.
  const { error: renameError } = await supabase.auth.admin.updateUserById(id, {
    email: `deleted_${id}@deleted.invalid`,
    email_confirm: true,
    ban_duration: "876000h", // ~100 years: this login can never be used
    user_metadata: { deleted: true, deletedAt: new Date().toISOString() },
  });

  if (!renameError || isAuthUserGone(renameError)) {
    console.warn(
      `removeAuthAccount: could not delete Auth user ${id} (${lastError?.message}); ` +
        `email released by renaming + banning the account instead.`,
    );
    return { ok: true, mode: "released-email" };
  }

  console.error(
    `removeAuthAccount: could not delete OR rename Auth user ${id}:`,
    renameError.message,
  );
  return {
    ok: false,
    message: `${lastError?.message || "delete failed"} / ${renameError.message}`,
  };
}

// Sets a new password for an employee directly, with NO email involved.
// Used by the admin-side "Reset Password" action on the Employees screen
// (Super Admin / Ops Manager). The employee's id here is their Supabase
// Auth user id ("Auth User Id"), same id used everywhere else in this file.
async function setEmployeePassword(id, newPassword) {
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: newPassword,
  });
  if (error) {
    console.error("Failed to set employee password:", error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true };
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
  removeAuthAccount,
  setEmployeePassword,
};
