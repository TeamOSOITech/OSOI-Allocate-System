const express = require("express");
const router = express.Router();
const multer = require("multer");

// MULTI-TENANCY + SECURITY FIX: this file previously had NO auth
// middleware at all — every endpoint below was reachable by anyone,
// logged in or not. `authenticate` also resolves req.user.organizationId,
// which every query below now filters on.
const { authenticate } = require("../../middlewares/auth");

// PERMISSIONS FIX: POST/PUT/DELETE here used to be gated with
// `authorize("SUPER_ADMIN")` — a hardcoded role check that completely
// blocked Process Lead, Ops Manager, and Audit Manager even though
// permissions.js already grants all three the "clients.manage"
// permission. Switched to requireAnyPermission("clients.manage") so the
// route-level gate actually matches the permission matrix. Process Lead
// still doesn't get to act immediately, though — see approvalGate below.
const { requireAnyPermission } = require("../../middlewares/rbac");

// APPROVAL: intercepts Process Lead's create/update/delete here and
// files it as a pending approval instead of letting it reach the route
// handler — see src/middlewares/approvalGate.js and the CLIENT_CREATE /
// CLIENT_UPDATE / CLIENT_DELETE rules in src/config/permissions.js. Ops
// Manager / Audit Manager / Super Admin are unaffected (act immediately).
const { approvalGate } = require("../../middlewares/approvalGate");

const clientsController = require("./clients.controller");

const upload = multer({ storage: multer.memoryStorage() });

// Require a valid session for every route in this file, and make
// req.user (incl. organizationId) available to every handler below.
router.use(authenticate);

// Prevent browser caching
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- GET /api/clients ----------
router.get("/", clientsController.listClients);

// ---------- POST /api/clients ----------
router.post(
  "/",
  requireAnyPermission("clients.manage"),
  approvalGate("CLIENT_CREATE"),
  clientsController.createClient,
);

// ---------- Excel template download ----------
// MUST be declared above "/:id" so it isn't shadowed by the param route.
router.get("/bulk/template", clientsController.downloadTemplate);

// ---------- Excel bulk upload ----------
// MUST be declared above "/:id" so it isn't shadowed by the param route.
// NOTE: bulk upload is NOT approval-gated (same reasoning as products'
// bulk upload) — it always creates directly regardless of caller's role.
router.post(
  "/bulk/upload",
  requireAnyPermission("clients.manage"),
  upload.single("file"),
  clientsController.bulkUpload,
);

// ---------- GET /api/clients/:id ----------
// Declared below the /bulk/* routes since this is a param route.
router.get("/:id", clientsController.getClientById);

// ---------- PUT /api/clients/:id ----------
router.put(
  "/:id",
  requireAnyPermission("clients.manage"),
  approvalGate("CLIENT_UPDATE", { includeParamsId: true }),
  clientsController.updateClient,
);

// ---------- DELETE /api/clients/:id ----------
router.delete(
  "/:id",
  requireAnyPermission("clients.manage"),
  approvalGate("CLIENT_DELETE", { includeParamsId: true }),
  clientsController.deleteClient,
);

module.exports = router;
