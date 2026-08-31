// src/modules/qcaudit/qcaudit.routes.js
//
// QC + Audit workflow — mounted at /api/qc-audit (NOT /api/qc, which is
// already taken by the older, separate standalone Quality Scores log
// at src/modules/qualitychecks/qc.routes.js — that page/table is
// untouched by this).

const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middlewares/auth");
const { requirePermission } = require("../../middlewares/rbac");
const {
  listQcTeam,
  listAuditManagers,
  listQcQueue,
  assignQc,
  recordQcResult,
  listAuditQueue,
  assignAudit,
  recordAuditResult,
  getSummary,
} = require("./Qcaudit.controller");

router.use(authenticate);

// Quality Manager Dashboard aggregate counts — Audit Manager (and Super
// Admin, via the "*" wildcard) only, same as the audit-queue endpoints.
router.get("/summary", requirePermission("qc.assignments.modify"), getSummary);

// ---- QC stage ----
// Who can be assigned as a QC reviewer / who's viewing the queue at all
// — any authenticated user can READ these lists (needed just to render
// names in the table); the actual assign/decide actions below are the
// permission-gated ones.
router.get("/qc-team", listQcTeam);
// SECURITY FIX: this had no permission check beyond "logged in" — any
// Team Member could call this directly (not just through the UI, which
// hid nothing at the API level) and see the ENTIRE org's QC queue,
// including remarks written about other people's work. The controller
// now scopes results itself: full org queue for anyone eligible to
// manage QC (Vertical Head/Process Lead/QC-team member), otherwise only
// the cases specifically assigned to that caller.
router.get("/qc-queue", listQcQueue);
// Push a submitted case into the QC queue — QC-team member, Vertical
// Head, or Process Lead only (checked inside the controller, since a
// QC-team member's eligibility depends on qc_assignments membership,
// not just their role). A plain Team Member is never eligible.
router.post("/:id/qc-assign", assignQc);
// Recording the QC PASS/FAIL itself is self-service (the assigned QC
// person) or a Vertical Head override — that finer-grained check lives
// inside the controller since it depends on the specific case's
// qc_employee_id, not just the caller's role. Route-level gate here
// only requires being logged in.
router.patch("/:id/qc-result", recordQcResult);

// ---- Audit stage ----
// SECURITY FIX: these two also had no permission check — any Team
// Member could call them directly and see the full Audit queue and the
// list of Audit Managers, even though the frontend only shows that tab
// to Audit Managers. Audit Queue visibility is Audit Manager territory
// end to end (unlike QC, there's no "assigned-to-me" carve-out here
// since audit_employee_id is always an AUDIT_MANAGER-role user anyway).
router.get(
  "/audit-managers",
  requirePermission("qc.assignments.modify"),
  listAuditManagers,
);
router.get(
  "/audit-queue",
  requirePermission("qc.assignments.modify"),
  listAuditQueue,
);
router.post(
  "/:id/audit-assign",
  requirePermission("qc.assignments.modify"),
  assignAudit,
);
router.patch(
  "/:id/audit-result",
  requirePermission("qc.assignments.modify"),
  recordAuditResult,
);

module.exports = router;
