// src/modules/qualitychecks/qc.routes.js
//
// FIX: this router previously had no authentication, no permission
// checks, and wasn't even wired to the real controller (GET just
// returned a static "QC module working" message; there was no POST
// route at all). Now matches the pattern used by every other module —
// authenticate first, then a permission check per route.

const express = require("express");
const router = express.Router();
const { authenticate } = require("../../middlewares/auth");
const { requireAnyPermission } = require("../../middlewares/rbac");
const { listQcChecks, createQcCheck } = require("./qc.controller");

router.use(authenticate);

// Same "qc.record" permission gates both viewing and recording QC
// checks — this matches the page-level access already enforced on the
// frontend (/quality-scores is only reachable by Super Admin, Ops
// Manager, Audit Manager, Process Lead, and Vertical Head; see App.jsx
// and config/permissions.js ROLE_PERMISSIONS for the exact grant list).
router.get("/", requireAnyPermission("qc.record"), listQcChecks);
router.post("/", requireAnyPermission("qc.record"), createQcCheck);

module.exports = router;
