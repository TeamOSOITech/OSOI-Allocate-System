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
const OPTION_TABLES = {
  department: "departments",
  designation: "designations",
  teams: "teams",
};

router.use(authenticate);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- GET /api/options ----------
// Returns every option list in one call: { departments: [...], designations: [...], teams: [...] }
// so the Add User form can fetch all three dropdowns on mount with a
// single request instead of three.
router.get("/", async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    const [
      { data: departments, error: deptErr },
      { data: designations, error: desErr },
      { data: teams, error: teamErr },
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
    ]);

    if (deptErr) throw deptErr;
    if (desErr) throw desErr;
    if (teamErr) throw teamErr;

    res.json({
      departments: (departments || []).map((d) => d.name),
      designations: (designations || []).map((d) => d.name),
      teams: (teams || []).map((d) => d.name),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch options" });
  }
});

// ---------- POST /api/options ----------
// Body: { field: "department" | "designation" | "teams", value: string }
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
