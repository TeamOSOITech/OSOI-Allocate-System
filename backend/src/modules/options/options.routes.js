const express = require("express");
const router = express.Router();
const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");

// Every dropdown-option table this route serves. Adding a new addable
// dropdown later (e.g. "Location") = add one line here + one table in the
// DB — nothing else in this file needs to change.
//
// `field` is what the frontend sends/expects (matches formData keys like
// "department", "designation", "Teams" today — kept lowercase here and
// mapped case-insensitively below so the frontend doesn't need to change
// how it calls saveCustomOption).
//
// FIX: "reportingManager" was completely missing from this map — every
// custom Reporting Manager added via the "+" control on Add User was
// silently 400'ing (caught non-fatally on the frontend, so nothing
// visibly broke, but nothing was ever actually saved). Added the missing
// entry + a dedicated `reporting_managers` table for it below.
const OPTION_TABLES = {
  department: "departments",
  designation: "designations",
  teams: "teams",
  reportingmanager: "reporting_managers",
};

router.use(authenticate);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Small helper: merge the curated options-table names with whatever
// distinct values already exist on user_master for the same org, so a
// department/designation/team that was typed directly on a user (e.g. via
// bulk upload, or before the options table existed) still shows up in the
// dropdown even though it was never explicitly added via the "+" control.
// Case-insensitive de-dupe (keeps the options-table casing when both exist),
// alphabetically sorted, blanks/nulls dropped.
function mergeDistinct(curatedNames, userValues) {
  const seenLower = new Set();
  const merged = [];

  for (const name of curatedNames || []) {
    const trimmed = (name || "").toString().trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    merged.push(trimmed);
  }

  for (const value of userValues || []) {
    const trimmed = (value || "").toString().trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    merged.push(trimmed);
  }

  return merged.sort((a, b) => a.localeCompare(b));
}

// ---------- GET /api/options ----------
// Returns every option list in one call: { departments: [...], designations: [...], teams: [...], reportingManagers: [...] }
// so the Add User form can fetch all dropdowns on mount with a single
// request instead of several.
//
// FIX: department/designation/team values that already exist on employee
// records (typed directly at creation time or via bulk upload) were never
// being inserted into the departments/designations/teams options tables —
// only values added through the "+" control on Add User were. So a
// Super Admin looking at an employee with e.g. Department = "Finance"
// would NOT see "Finance" in the dropdown unless someone had separately
// added it via "+". Now we also pull the distinct values already in use
// on user_master (scoped to the same org) and merge them in, so the
// dropdown always reflects what's actually already "filled" for real users.
router.get("/", async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    const [
      { data: departments, error: deptErr },
      { data: designations, error: desErr },
      { data: teams, error: teamErr },
      { data: reportingManagers, error: rmErr },
      { data: userValues, error: userValuesErr },
    ] = await Promise.all([
      supabase
        .from("departments")
        .select("id,name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
      supabase
        .from("designations")
        .select("id,name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
      supabase
        .from("teams")
        .select("id,name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
      supabase
        .from("reporting_managers")
        .select("id,name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
      // Read-only, same org_id scope as everything else here — just used
      // to backfill the dropdowns, never written to from this route.
      supabase
        .from("user_master")
        .select('"Department","Designation","Worked In Teams"')
        .eq("organization_id", orgId),
    ]);

    if (deptErr) throw deptErr;
    if (desErr) throw desErr;
    if (teamErr) throw teamErr;
    if (rmErr) throw rmErr;
    if (userValuesErr) throw userValuesErr;

    const rows = userValues || [];
    const usedDepartments = rows.map((r) => r["Department"]);
    const usedDesignations = rows.map((r) => r["Designation"]);
    const usedTeams = rows.map((r) => r["Worked In Teams"]);

    res.json({
      departments: mergeDistinct(
        (departments || []).map((d) => d.name),
        usedDepartments,
      ),
      designations: mergeDistinct(
        (designations || []).map((d) => d.name),
        usedDesignations,
      ),
      teams: mergeDistinct(
        (teams || []).map((d) => d.name),
        usedTeams,
      ),
      // Reporting manager is intentionally left as-is (curated list only) —
      // it's tied to actual manager emails elsewhere in the app, so
      // auto-merging free-text user values here isn't safe/meaningful.
      reportingManagers: (reportingManagers || []).map((d) => d.name),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch options" });
  }
});

// ---------- POST /api/options ----------
// Body: { field: "department" | "designation" | "teams" | "reportingManager", value: string }
// Adds a new option, scoped to the caller's org. If it already exists for
// this org (case-sensitive unique constraint), that's treated as success —
// the frontend just wants "this value now exists and is selectable".
router.post("/", async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const { field, value } = req.body || {};

    const table = OPTION_TABLES[(field || "").toString().toLowerCase()];
    if (!table) {
      return res
        .status(400)
        .json({ message: `Unknown option field "${field}"` });
    }

    const trimmed = (value || "").toString().trim();
    if (!trimmed) {
      return res.status(400).json({ message: "Value is required" });
    }

    const { data, error } = await supabase
      .from(table)
      .insert({ name: trimmed, organization_id: orgId })
      .select()
      .single();

    if (error) {
      // 23505 = unique_violation -> this org already has this value.
      // Not an error from the frontend's point of view — return it as-is.
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from(table)
          .select("id,name")
          .eq("organization_id", orgId)
          .eq("name", trimmed)
          .maybeSingle();
        return res
          .status(200)
          .json({ id: existing?.id, name: trimmed, alreadyExisted: true });
      }
      throw error;
    }

    res.status(201).json({ id: data.id, name: data.name });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to add option", detail: err.message });
  }
});

module.exports = router;
