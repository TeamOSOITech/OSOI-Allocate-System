// src/modules/roleLabels/roleLabels.routes.js
//
// Lets a Super Admin give the app's 5 assignable system roles a custom
// DISPLAY NAME for their own organization only — e.g. renaming
// "Team Member" to "Employee". This is purely a label swap: the
// underlying role value stored on user_master (TEAM_MEMBER, etc.) never
// changes, so every permission check in src/config/permissions.js /
// middlewares/rbac.js keeps working exactly as before. Only what the
// frontend PRINTS for that role changes, org by org.
//
// SUPER_ADMIN itself is intentionally NOT customizable here — it's the
// account-owner role, and letting it be renamed/hidden could make an
// org's own admin unable to recognize their own role in the UI.
//
// Requires a `role_labels` table:
//   create table role_labels (
//     id uuid primary key default gen_random_uuid(),
//     organization_id uuid not null,
//     role text not null,
//     label text not null,
//     updated_at timestamptz not null default now(),
//     unique (organization_id, role)
//   );

const express = require("express");
const router = express.Router();
const supabase = require("../../config/supabaseClient");
const { authenticate } = require("../../middlewares/auth");
const { authorize } = require("../../middlewares/rbac");
const { cached, delByPrefix } = require("../../utils/cache");

// Same 6-tier role list as backend src/config/permissions.js and the
// frontend's ROLE_OPTIONS (employees.tsx / adduser.tsx) — kept as a
// literal list here too rather than importing permissions.js, since that
// file's ASSIGNABLE_ROLES_BY_CREATOR is about WHO CAN ASSIGN a role, not
// which roles exist; this is a smaller, more stable list to depend on.
const DEFAULT_ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin",
  OPS_MANAGER: "Ops Manager",
  AUDIT_MANAGER: "Audit Manager",
  PROCESS_LEAD: "Process Lead",
  VERTICAL_HEAD: "Vertical Head",
  TEAM_MEMBER: "Team Member",
};

// Every role in DEFAULT_ROLE_LABELS EXCEPT SUPER_ADMIN — the only roles a
// Super Admin is allowed to rename for their org.
const CUSTOMIZABLE_ROLES = Object.keys(DEFAULT_ROLE_LABELS).filter(
  (r) => r !== "SUPER_ADMIN",
);

// Role labels change rarely (an admin sets them once, maybe revisits
// occasionally) but GET / is meant to be called by every page that
// displays a role name, potentially on every load — cache like options.js.
const ROLE_LABELS_CACHE_TTL_SECONDS = 60;
const roleLabelsCacheKey = (orgId) => `role-labels:${orgId}`;

router.use(authenticate);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- GET /api/role-labels ----------
// Any authenticated user can read this (every role-displaying page needs
// it, not just Super Admins) — returns the FULL 6-role map, with org
// overrides merged on top of the defaults, e.g.:
//   { SUPER_ADMIN: "Super Admin", TEAM_MEMBER: "Employee", ... }
router.get("/", async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    const payload = await cached(
      roleLabelsCacheKey(orgId),
      ROLE_LABELS_CACHE_TTL_SECONDS,
      async () => {
        const { data, error } = await supabase
          .from("role_labels")
          .select("role, label")
          .eq("organization_id", orgId);
        if (error) throw error;

        const merged = { ...DEFAULT_ROLE_LABELS };
        for (const row of data || []) {
          // Defensive: ignore any stray row for a role that isn't
          // customizable (e.g. if SUPER_ADMIN ever got saved by an older
          // buggy client) — never let it override the fixed label.
          if (CUSTOMIZABLE_ROLES.includes(row.role) && row.label) {
            merged[row.role] = row.label;
          }
        }
        return merged;
      },
    );

    res.json(payload);
  } catch (err) {
    console.error("GET /api/role-labels failed:", err);
    // Fail soft: every caller falls back to DEFAULT_ROLE_LABELS on
    // error anyway, so a working default UI matters more than a 500 here.
    res.status(200).json(DEFAULT_ROLE_LABELS);
  }
});

// ---------- POST /api/role-labels ----------
// Body: { role: "TEAM_MEMBER", label: "Employee" }
// Super Admin only. An empty/whitespace-only label RESETS that role back
// to its default (deletes the override row) — lets an admin undo a
// custom label without a separate "reset" endpoint.
router.post("/", authorize("SUPER_ADMIN"), async (req, res) => {
  try {
    const orgId = req.user.organizationId;
    const { role, label } = req.body || {};

    const roleCode = (role || "").toString().trim().toUpperCase();
    if (!CUSTOMIZABLE_ROLES.includes(roleCode)) {
      return res.status(400).json({
        message:
          roleCode === "SUPER_ADMIN"
            ? "Super Admin's role name can't be changed."
            : `Unknown role "${role}"`,
      });
    }

    const trimmedLabel = (label || "").toString().trim();

    if (!trimmedLabel) {
      // Reset to default.
      const { error } = await supabase
        .from("role_labels")
        .delete()
        .eq("organization_id", orgId)
        .eq("role", roleCode);
      if (error) throw error;

      await delByPrefix(roleLabelsCacheKey(orgId));
      return res.json({
        role: roleCode,
        label: DEFAULT_ROLE_LABELS[roleCode],
        reset: true,
      });
    }

    // Upsert on the (organization_id, role) unique constraint.
    const { data, error } = await supabase
      .from("role_labels")
      .upsert(
        {
          organization_id: orgId,
          role: roleCode,
          label: trimmedLabel,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,role" },
      )
      .select()
      .single();
    if (error) throw error;

    await delByPrefix(roleLabelsCacheKey(orgId));

    res.status(200).json({ role: data.role, label: data.label });
  } catch (err) {
    console.error("POST /api/role-labels failed:", err);
    res
      .status(500)
      .json({ message: "Failed to save role label", detail: err.message });
  }
});

module.exports = router;
