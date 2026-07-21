const supabase = require("../../config/supabaseClient"); // adjust path to your supabase client

const TABLE = "product_master";

const getAllProducts = async () => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
};

const getProductById = async (id) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
};

const createProduct = async (payload) => {
  const { product_name, time_taken, client, subclient } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .insert([{ product_name, time_taken, client, subclient }])
    .select()
    .single();

  if (error) throw error;
  return data;
};

const updateProduct = async (id, payload) => {
  const { product_name, time_taken, client, subclient } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      product_name,
      time_taken,
      client,
      subclient,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const deleteProduct = async (id) => {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
