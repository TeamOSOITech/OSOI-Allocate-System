const express = require("express");
const multer = require("multer");
const router = express.Router();
const productController = require("./products.controller");

const upload = multer({ dest: "uploads/" });

router.get("/", productController.getAllProducts);
router.get("/:id", productController.getProductById);
router.post("/", productController.createProduct);
router.post(
  "/bulk/upload",
  upload.single("file"),
  productController.bulkUploadProducts,
);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;
