const express = require("express");
const multer = require("multer");
const router = express.Router();
const productController = require("./products.controller");
const { authenticate } = require("../../middlewares/auth");
const { authorize, requireAnyPermission } = require("../../middlewares/rbac");

const upload = multer({ dest: "uploads/" });

// FIX: this entire router previously had ZERO authentication.
router.use(authenticate);

// "Products" here = task catalog per client — everyone needs to read
// this to allocate/report against it.
router.get("/", productController.getAllProducts);
router.get("/:id", productController.getProductById);

// "Can add new tasks" — Super Admin only per the approval doc.
router.post("/", authorize("SUPER_ADMIN"), productController.createProduct);
router.post(
  "/bulk/upload",
  authorize("SUPER_ADMIN"),
  upload.single("file"),
  productController.bulkUploadProducts,
);

// "Can amend existing verticals and tasks" / "amend time taken for a task"
// — Ops Manager or Super Admin.
router.put(
  "/:id",
  requireAnyPermission("tasks.amend", "tasks.amend_time"),
  productController.updateProduct,
);

// Hard delete is intentionally Super-Admin-only. Routine removal from
// allocation should go through the "hide task" APPROVAL flow instead
// (Ops Manager requests -> Super Admin approves) — see modules/approvals.
router.delete(
  "/:id",
  authorize("SUPER_ADMIN"),
  productController.deleteProduct,
);

module.exports = router;
