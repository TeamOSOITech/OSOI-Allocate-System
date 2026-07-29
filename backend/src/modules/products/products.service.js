const supabase = require("../../config/supabaseClient");

const TABLE = "product_master";

// FIX: existing rows can have `hidden = NULL` (column added later, or
// created before this default existed) — `.eq("hidden", false)` in SQL
// never matches NULL, even though NULL effectively means "not hidden".
// That's why products existed in the DB but this query returned an empty
// array. `.or("hidden.is.null,hidden.eq.false")` treats both NULL and
// false as visible, only `true` counts as actually hidden.
const getAllProducts = async () => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .or("hidden.is.null,hidden.eq.false")
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

// FIX: explicitly set hidden: false on every new product, so future rows
// never land back in that ambiguous NULL state that caused the bug above.
const createProduct = async (payload) => {
  const { product_name, time_taken, time_unit, client, subclient } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .insert([
      { product_name, time_taken, time_unit, client, subclient, hidden: false },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
};

// FIX: same hidden default applied here for consistency, in case this
// function gets wired up to a bulk-insert path later.
const bulkCreateProducts = async (productsArray) => {
  const withHidden = productsArray.map((p) => ({
    ...p,
    hidden: p.hidden ?? false,
  }));

  const { data, error } = await supabase
    .from(TABLE)
    .insert(withHidden)
    .select();

  if (error) throw error;
  return data;
};

const updateProduct = async (id, payload) => {
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
  bulkCreateProducts,
  updateProduct,
  deleteProduct,
};
