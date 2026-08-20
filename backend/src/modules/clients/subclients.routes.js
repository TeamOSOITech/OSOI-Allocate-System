const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const { authenticate } = require("../../middlewares/auth");

// PERMISSIONS: writes are now gated by the "clients.manage" permission
// code (see src/config/permissions.js) instead of a hardcoded
// SUPER_ADMIN-only check. Process Lead, Ops Manager, Audit Manager, and
// Super Admin all hold this permission — Team Member and Vertical Head
// do not. (Subclients share the same "clients.manage" permission as
// Clients — there's no separate subclients-only code.)
const { requireAnyPermission } = require("../../middlewares/rbac");
const { approvalGate } = require("../../middlewares/approvalGate");

const subclientsController = require("./subclients.controller");

// SECURITY FIX (Finding #16): no fileFilter or size limit previously —
// restricted to the spreadsheet types this endpoint actually parses,
// with a 10MB cap (mirrors clients.routes.js).
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = [".xlsx", ".xls", ".csv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx, .xls, .csv files are allowed"));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// FIX: this entire router previously had ZERO authentication.
router.use(authenticate);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// ---------- GET /api/subclients ----------
router.get("/", subclientsController.listSubclients);

// ---------- POST /api/subclients ----------
// Body: { name, clientId, status, country, website, mainEmail, mainPhone,
//         primaryContactName, primaryContactEmail, primaryContactPhone,
//         secondaryContactName, secondaryContactEmail, secondaryContactPhone }
router.post(
  "/",
  requireAnyPermission("clients.manage"),
  approvalGate("SUBCLIENT_CREATE"),
  subclientsController.createSubclient,
);

// ---------- Excel template download ----------
// GET /api/subclients/bulk/template
router.get("/bulk/template", subclientsController.downloadTemplate);

// ---------- Excel bulk upload ----------
// POST /api/subclients/bulk/upload
router.post(
  "/bulk/upload",
  requireAnyPermission("clients.manage"),
  upload.single("file"),
  subclientsController.bulkUpload,
);

// ---------- GET /api/subclients/:id ----------
// Single-record fetch, always current — used by the Edit modal so it
// never edits against stale list-state (e.g. right after a product link
// was just added/changed elsewhere).
router.get("/:id", subclientsController.getSubclientById);

// ---------- PUT /api/subclients/:id ----------
// Body: { name, clientId, status, country, website, mainEmail, mainPhone,
//         primaryContactName, primaryContactEmail, primaryContactPhone,
//         secondaryContactName, secondaryContactEmail, secondaryContactPhone }
router.put(
  "/:id",
  requireAnyPermission("clients.manage"),
  approvalGate("SUBCLIENT_UPDATE", { includeParamsId: true }),
  subclientsController.updateSubclient,
);

// ---------- DELETE /api/subclients/:id ----------
router.delete(
  "/:id",
  requireAnyPermission("clients.manage"),
  approvalGate("SUBCLIENT_DELETE", { includeParamsId: true }),
  subclientsController.deleteSubclient,
);

module.exports = router;
