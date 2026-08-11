const express = require("express");
const multer = require("multer");
const router = express.Router();
const productController = require("./products.controller");
const { authenticate } = require("../../middlewares/auth");
const { authorize, requireAnyPermission } = require("../../middlewares/rbac");
const { approvalGate } = require("../../middlewares/approvalGate");

// SECURITY FIX (Finding #16): no fileFilter or size limit previously —
// restricted to the spreadsheet types this endpoint actually parses,
// with a 10MB cap (mirrors clients.routes.js / subclients.routes.js).
// Kept as disk storage (dest) rather than memoryStorage since
// products.controller.js's bulkUploadProducts reads req.file.path.
const path = require("path");
const upload = multer({
  dest: "uploads/",
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

// "Products" here = task catalog per client — everyone needs to read
// this to allocate/report against it.
router.get("/", productController.getAllProducts);
router.get("/:id", productController.getProductById);

// PERMISSIONS: create/bulk-upload/delete now use the "products.manage"
// permission code (see src/config/permissions.js) instead of a
// hardcoded SUPER_ADMIN-only check — Process Lead, Ops Manager, Audit
// Manager, and Super Admin all hold this permission.
//
// APPROVAL: approvalGate("SERVICE_CREATE") sits right after the
// permission check. Process Lead holds "products.manage" (so it passes
// requireAnyPermission above) but every one of ITS create/update/delete
// calls gets intercepted here and filed as a pending approval instead of
// reaching productController — see src/middlewares/approvalGate.js and
// APPROVAL_RULES in permissions.js. Ops Manager / Audit Manager / Super
// Admin are not in SERVICE_CREATE's requestedBy list, so the gate is a
// no-op for them and they act immediately, same as before.
router.post(
  "/",
  requireAnyPermission("products.manage"),
  approvalGate("SERVICE_CREATE"),
  productController.createProduct,
);
router.post(
  "/bulk/upload",
  requireAnyPermission("products.manage"),
  upload.single("file"),
  productController.bulkUploadProducts,
);

// "Can amend existing verticals and tasks" / "amend time taken for a task"
// — Ops Manager or Super Admin already had this via tasks.amend /
// tasks.amend_time. products.manage is added alongside so Process Lead
// and Audit Manager (who don't hold tasks.amend) can edit too.
router.put(
  "/:id",
  requireAnyPermission("tasks.amend", "tasks.amend_time", "products.manage"),
  approvalGate("SERVICE_UPDATE", { includeParamsId: true }),
  productController.updateProduct,
);

// Delete now uses "products.manage" instead of a hardcoded
// SUPER_ADMIN-only check.
router.delete(
  "/:id",
  requireAnyPermission("products.manage"),
  approvalGate("SERVICE_DELETE", { includeParamsId: true }),
  productController.deleteProduct,
);

module.exports = router;
