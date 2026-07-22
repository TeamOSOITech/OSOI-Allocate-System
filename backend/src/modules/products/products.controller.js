const fs = require("fs");
const xlsx = require("xlsx");
const productService = require("./products.service");

const getAllProducts = async (req, res) => {
  try {
    const products = await productService.getAllProducts();
    return res.status(200).json({ success: true, data: products });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productService.getProductById(id);

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const { product_name, time_taken, time_unit, client, subclient } = req.body;

    if (!product_name) {
      return res
        .status(400)
        .json({ success: false, message: "product_name is required" });
    }

    if (!time_unit || !["minutes", "hours"].includes(time_unit)) {
      return res.status(400).json({
        success: false,
        message: "time_unit is required and must be 'minutes' or 'hours'",
      });
    }

    const product = await productService.createProduct({
      product_name,
      time_taken,
      time_unit,
      client,
      subclient,
    });

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Extracts { value, unit } from strings like "2 hours", "1.5 hrs", "30 mins".
// Bare numbers default to "minutes".
const parseTimeTaken = (raw) => {
  if (raw === null || raw === undefined || raw === "") {
    return { value: null, unit: null };
  }

  if (typeof raw === "number") {
    return { value: raw, unit: "minutes" };
  }

  const str = raw.toString().trim().toLowerCase();
  const match = str.match(/[\d.]+/);
  if (!match) return { value: null, unit: null };

  const value = parseFloat(match[0]);
  if (isNaN(value)) return { value: null, unit: null };

  if (str.includes("hr") || str.includes("hour")) {
    return { value, unit: "hours" };
  }
  return { value, unit: "minutes" };
};

const bulkUploadProducts = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    fs.unlink(req.file.path, () => {});

    if (!rows.length) {
      return res
        .status(400)
        .json({ success: false, message: "Excel file is empty" });
    }

    const results = [];
    let createdCount = 0;
    let failedCount = 0;

    // Process one row at a time so a single bad row doesn't sink the
    // whole batch, and so we can report exactly which row failed and why.
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNumber = index + 2; // +2 accounts for header row + 1-indexing

      const product_name = row["Product Name"]?.toString().trim() || null;
      const client = row["Client"]?.toString().trim() || null;
      const subclient = row["Subclient"]?.toString().trim() || null;
      const { value: time_taken, unit: time_unit } = parseTimeTaken(
        row["Time Taken"],
      );

      const identifier = product_name || `Row ${rowNumber}`;

      if (!product_name) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: "Missing Product Name",
        });
        failedCount++;
        continue;
      }

      if (time_taken === null || !time_unit) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: `Could not parse "Time Taken" value: "${row["Time Taken"]}"`,
        });
        failedCount++;
        continue;
      }

      try {
        await productService.createProduct({
          product_name,
          time_taken,
          time_unit,
          client,
          subclient,
        });
        results.push({ identifier, row: rowNumber, success: true });
        createdCount++;
      } catch (err) {
        results.push({
          identifier,
          row: rowNumber,
          success: false,
          message: err.message,
        });
        failedCount++;
      }
    }

    return res.status(201).json({
      success: true,
      data: {
        totalRows: rows.length,
        createdCount,
        failedCount,
        results,
      },
    });
  } catch (error) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { product_name, time_taken, time_unit, client, subclient } = req.body;

    if (time_unit && !["minutes", "hours"].includes(time_unit)) {
      return res.status(400).json({
        success: false,
        message: "time_unit must be 'minutes' or 'hours'",
      });
    }

    const product = await productService.updateProduct(id, {
      product_name,
      time_taken,
      time_unit,
      client,
      subclient,
    });

    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productService.deleteProduct(id);

    return res.status(200).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  bulkUploadProducts,
  updateProduct,
  deleteProduct,
};
