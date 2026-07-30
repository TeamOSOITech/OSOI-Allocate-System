const supabase = require("../../config/supabaseClient");

const TABLE = "product_master";
const CLIENT_LINK_TABLE = "client_products";
const SUBCLIENT_LINK_TABLE = "subclient_products";

// FIX: existing rows can have `hidden = NULL` (column added later, or
// created before this default existed) — `.eq("hidden", false)` in SQL
// never matches NULL, even though NULL effectively means "not hidden".
// That's why products existed in the DB but this query returned an empty
// array. `.or("hidden.is.null,hidden.eq.false")` treats both NULL and
// false as visible, only `true` counts as actually hidden.
//
// REVERSED MAPPING: a product is no longer created "inside" a client/
// subclient — it's a standalone catalog entry now. Clients/Subclients pick
// which products they use via the client_products / subclient_products
// junction tables (see clients.routes.js / subclients.routes.js). This
// service also now scopes everything to organizationId, since the old
// version never filtered by org at all (pre-existing multi-tenancy gap).
const getAllProducts = async (organizationId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("organization_id", organizationId)
    .or("hidden.is.null,hidden.eq.false")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
};

const getProductById = async (id, organizationId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

// FIX: explicitly set hidden: false on every new product, so future rows
// never land back in that ambiguous NULL state that caused the bug above.
//
// Products no longer accept `client` / `subclient` on create — that link
// now lives on the Client/Subclient side (see syncClientProducts /
// syncSubclientProducts below).
const createProduct = async (payload, organizationId) => {
  const { product_name, time_taken, time_unit } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .insert([
      {
        product_name,
        time_taken,
        time_unit,
        organization_id: organizationId,
        hidden: false,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
};

// FIX: same hidden default applied here for consistency, in case this
// function gets wired up to a bulk-insert path later.
const bulkCreateProducts = async (productsArray, organizationId) => {
  const withHidden = productsArray.map((p) => ({
    product_name: p.product_name,
    time_taken: p.time_taken,
    time_unit: p.time_unit,
    organization_id: organizationId,
    hidden: p.hidden ?? false,
  }));

  const { data, error } = await supabase
    .from(TABLE)
    .insert(withHidden)
    .select();

  if (error) throw error;
  return data;
};

const updateProduct = async (id, payload, organizationId) => {
  const { product_name, time_taken, time_unit } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      product_name,
      time_taken,
      time_unit,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const deleteProduct = async (id, organizationId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

// ---------------------------------------------------------------------
// Client <-> Product linking (used by modules/clients/clients.routes.js)
// ---------------------------------------------------------------------

// Returns [{ id, product_name, ... }] for every product currently linked
// to this client, via the client_products junction table.
const getProductsForClient = async (clientId, organizationId) => {
  const { data, error } = await supabase
    .from(CLIENT_LINK_TABLE)
    .select("product_id, product_master(*)")
    .eq("client_id", clientId)
    .eq("organization_id", organizationId);

  if (error) throw error;
  return (data || []).map((row) => row.product_master).filter(Boolean);
};

// Replaces the full set of products linked to a client with `productIds`
// (an array of product_master ids). Pass an empty array / undefined to
// clear all links. Diffs against the current links so we only insert/
// delete what actually changed.
const syncClientProducts = async (clientId, productIds, organizationId) => {
  const desired = Array.from(new Set((productIds || []).map(Number))).filter(
    (n) => !Number.isNaN(n),
  );

  const { data: existing, error: existingErr } = await supabase
    .from(CLIENT_LINK_TABLE)
    .select("product_id")
    .eq("client_id", clientId)
    .eq("organization_id", organizationId);

  if (existingErr) throw existingErr;

  const existingIds = (existing || []).map((r) => r.product_id);
  const toAdd = desired.filter((id) => !existingIds.includes(id));
  const toRemove = existingIds.filter((id) => !desired.includes(id));

  if (toRemove.length) {
    const { error } = await supabase
      .from(CLIENT_LINK_TABLE)
      .delete()
      .eq("client_id", clientId)
      .eq("organization_id", organizationId)
      .in("product_id", toRemove);
    if (error) throw error;
  }

  if (toAdd.length) {
    const { error } = await supabase.from(CLIENT_LINK_TABLE).insert(
      toAdd.map((productId) => ({
        client_id: clientId,
        product_id: productId,
        organization_id: organizationId,
      })),
    );
    if (error) throw error;
  }
};

// ---------------------------------------------------------------------
// Subclient <-> Product linking (used by modules/clients/subclients.routes.js)
// ---------------------------------------------------------------------

const getProductsForSubclient = async (subclientId, organizationId) => {
  const { data, error } = await supabase
    .from(SUBCLIENT_LINK_TABLE)
    .select("product_id, product_master(*)")
    .eq("subclient_id", subclientId)
    .eq("organization_id", organizationId);

  if (error) throw error;
  return (data || []).map((row) => row.product_master).filter(Boolean);
};

const syncSubclientProducts = async (
  subclientId,
  productIds,
  organizationId,
) => {
  const desired = Array.from(new Set((productIds || []).map(Number))).filter(
    (n) => !Number.isNaN(n),
  );

  const { data: existing, error: existingErr } = await supabase
    .from(SUBCLIENT_LINK_TABLE)
    .select("product_id")
    .eq("subclient_id", subclientId)
    .eq("organization_id", organizationId);

  if (existingErr) throw existingErr;

  const existingIds = (existing || []).map((r) => r.product_id);
  const toAdd = desired.filter((id) => !existingIds.includes(id));
  const toRemove = existingIds.filter((id) => !desired.includes(id));

  if (toRemove.length) {
    const { error } = await supabase
      .from(SUBCLIENT_LINK_TABLE)
      .delete()
      .eq("subclient_id", subclientId)
      .eq("organization_id", organizationId)
      .in("product_id", toRemove);
    if (error) throw error;
  }

  if (toAdd.length) {
    const { error } = await supabase.from(SUBCLIENT_LINK_TABLE).insert(
      toAdd.map((productId) => ({
        subclient_id: subclientId,
        product_id: productId,
        organization_id: organizationId,
      })),
    );
    if (error) throw error;
  }
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  bulkCreateProducts,
  updateProduct,
  deleteProduct,
  getProductsForClient,
  syncClientProducts,
  getProductsForSubclient,
  syncSubclientProducts,
};
