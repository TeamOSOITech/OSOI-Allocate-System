const supabase = require("../../config/supabaseClient");

const TABLE = "service_master";
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
//
// `teams` is a plain jsonb array of team names (e.g. ["Tech", "SD"]) — a
// tag on the service, not a relational link, so it's just passed straight
// through. Defaults to [] when omitted so the column never ends up NULL.
const createProduct = async (payload, organizationId) => {
  const { product_name, time_taken, time_unit, teams } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .insert([
      {
        product_name,
        time_taken,
        time_unit,
        teams: teams || [],
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
    teams: p.teams || [],
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

// `teams` is only overwritten when the caller actually sends the key —
// letting it stay `undefined` here would otherwise wipe existing teams to
// NULL on every plain field-only update (Supabase's `.update()` only
// touches keys present in the object, so we build the patch conditionally
// rather than always including `teams: teams || []`).
const updateProduct = async (id, payload, organizationId) => {
  const { product_name, time_taken, time_unit, teams } = payload;

  const patch = {
    product_name,
    time_taken,
    time_unit,
    updated_at: new Date().toISOString(),
  };

  if (teams !== undefined) {
    patch.teams = teams || [];
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
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

// Returns [{ id, product_name, ..., amount, currency }] for every product
// currently linked to this client — amount/currency come from the
// client_products link itself (the rate is per client, not per product).
const getProductsForClient = async (clientId, organizationId) => {
  const { data, error } = await supabase
    .from(CLIENT_LINK_TABLE)
    .select("product_id, amount, currency, service_master(*)")
    .eq("client_id", clientId)
    .eq("organization_id", organizationId);

  if (error) throw error;
  return (data || [])
    .filter((row) => row.service_master)
    .map((row) => ({
      ...row.service_master,
      amount: row.amount,
      currency: row.currency,
    }));
};

// Replaces the full set of products linked to a client with `productRates`
// — an array of { productId, amount, currency }. Pass an empty array /
// undefined to clear all links. Diffs against the current links: removes
// what's no longer selected, inserts what's new, and updates the
// amount/currency for links that stayed but whose rate changed.
const syncClientProducts = async (clientId, productRates, organizationId) => {
  const desired = (productRates || [])
    .map((r) => ({
      productId: Number(r.productId),
      amount:
        r.amount === "" || r.amount === undefined ? null : Number(r.amount),
      currency: r.currency || "USD",
    }))
    .filter((r) => !Number.isNaN(r.productId));

  const { data: existing, error: existingErr } = await supabase
    .from(CLIENT_LINK_TABLE)
    .select("product_id")
    .eq("client_id", clientId)
    .eq("organization_id", organizationId);

  if (existingErr) throw existingErr;

  const existingIds = (existing || []).map((r) => r.product_id);
  const desiredIds = desired.map((r) => r.productId);
  const toRemove = existingIds.filter((id) => !desiredIds.includes(id));

  if (toRemove.length) {
    const { error } = await supabase
      .from(CLIENT_LINK_TABLE)
      .delete()
      .eq("client_id", clientId)
      .eq("organization_id", organizationId)
      .in("product_id", toRemove);
    if (error) throw error;
  }

  if (desired.length) {
    const { error } = await supabase.from(CLIENT_LINK_TABLE).upsert(
      desired.map((r) => ({
        client_id: clientId,
        product_id: r.productId,
        organization_id: organizationId,
        amount: r.amount,
        currency: r.currency,
      })),
      { onConflict: "client_id,product_id" },
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
    .select("product_id, amount, currency, ser_master(*)")
    .eq("subclient_id", subclientId)
    .eq("organization_id", organizationId);

  if (error) throw error;
  return (data || [])
    .filter((row) => row.service_master)
    .map((row) => ({
      ...row.service_master,
      amount: row.amount,
      currency: row.currency,
    }));
};

const syncSubclientProducts = async (
  subclientId,
  productRates,
  organizationId,
) => {
  const desired = (productRates || [])
    .map((r) => ({
      productId: Number(r.productId),
      amount:
        r.amount === "" || r.amount === undefined ? null : Number(r.amount),
      currency: r.currency || "USD",
    }))
    .filter((r) => !Number.isNaN(r.productId));

  const { data: existing, error: existingErr } = await supabase
    .from(SUBCLIENT_LINK_TABLE)
    .select("product_id")
    .eq("subclient_id", subclientId)
    .eq("organization_id", organizationId);

  if (existingErr) throw existingErr;

  const existingIds = (existing || []).map((r) => r.product_id);
  const desiredIds = desired.map((r) => r.productId);
  const toRemove = existingIds.filter((id) => !desiredIds.includes(id));

  if (toRemove.length) {
    const { error } = await supabase
      .from(SUBCLIENT_LINK_TABLE)
      .delete()
      .eq("subclient_id", subclientId)
      .eq("organization_id", organizationId)
      .in("product_id", toRemove);
    if (error) throw error;
  }

  if (desired.length) {
    const { error } = await supabase.from(SUBCLIENT_LINK_TABLE).upsert(
      desired.map((r) => ({
        subclient_id: subclientId,
        product_id: r.productId,
        organization_id: organizationId,
        amount: r.amount,
        currency: r.currency,
      })),
      { onConflict: "subclient_id,product_id" },
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
