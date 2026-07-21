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
    const { product_name, time_taken, client, subclient } = req.body;

    if (!product_name) {
      return res
        .status(400)
        .json({ success: false, message: "product_name is required" });
    }

    const product = await productService.createProduct({
      product_name,
      time_taken,
      client,
      subclient,
    });

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { product_name, time_taken, client, subclient } = req.body;

    const product = await productService.updateProduct(id, {
      product_name,
      time_taken,
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
  updateProduct,
  deleteProduct,
};
