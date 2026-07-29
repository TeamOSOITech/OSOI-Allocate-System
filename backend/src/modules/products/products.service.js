const supabase = require("../../config/supabaseClient");

const TABLE = "product_master";

// MULTI-TENANCY FIX: every function below previously had NO organization
// scoping at all — any logged-in user, from ANY organization, could see,
// edit, or delete every other organization's products. orgId now comes
// from req.user.organizationId (resolved server-side by the authenticate
// middleware) and is required for every query.

const getAllProducts = async (orgId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("organization_id", orgId)
    .eq("hidden", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
};

const getProductById = async (id, orgId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error) throw error;
  return data;
};

const createProduct = async (payload, orgId) => {
  const { product_name, time_taken, time_unit, client, subclient } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .insert([
      {
        product_name,
        time_taken,
        time_unit,
        client,
        subclient,
        organization_id: orgId,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
};

const bulkCreateProducts = async (productsArray, orgId) => {
  const stamped = productsArray.map((p) => ({ ...p, organization_id: orgId }));

  const { data, error } = await supabase.from(TABLE).insert(stamped).select();

  if (error) throw error;
  return data;
};

const updateProduct = async (id, payload, orgId) => {
  const { product_name, time_taken, time_unit, client, subclient } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      product_name,
      time_taken,
      time_unit,
      client,
      subclient,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const deleteProduct = async (id, orgId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  bulkCreateProducts,
  updateProduct,
  deleteProduct,
};
