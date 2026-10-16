// src/modules/clientportal/clientportal.routes.js
const router = require("express").Router();
const { authenticate } = require("../../middlewares/auth");
const { authorize, requirePermission } = require("../../middlewares/rbac");
const c = require("./clientportal.controller");

router.use(authenticate);

// What a client login sees — CLIENT role only.
router.get("/dashboard", authorize("CLIENT"), c.getDashboard);

// Staff side — sharing cases with a client.
const canManage = requirePermission("client_portal.manage");
router.get("/clients/:clientId/cases", canManage, c.listClientCases);
router.get("/clients/:clientId/contacts", canManage, c.getClientContacts);
router.post("/share", canManage, c.shareCases);
router.post("/unshare", canManage, c.unshareCases);

// Page sharing (Google-Docs style): staff share a page with a client login.
router.get("/page-shares", canManage, c.listPageShares);
router.post("/page-shares", canManage, c.addPageShare);
router.post("/page-shares/remove", canManage, c.removePageShare);

// Pages shared with the caller (any login, any org) — read-only, scoped by the grant.
router.get("/my-pages", c.listMyPages);
router.post("/my-pages/seen", c.markMySharesSeen);
router.get("/shared/production-reports", c.getSharedProductionReport);

// Linking a login to a client is narrower: Super Admin / Ops Manager only.
router.post("/link-user", authorize("SUPER_ADMIN", "OPS_MANAGER"), c.linkUser);

module.exports = router;
