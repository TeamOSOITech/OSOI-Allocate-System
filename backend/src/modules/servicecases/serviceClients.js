// src/modules/servicecases/serviceClients.js
//
// Service <-> Client mapping. A client can only be used on a case/count
// for a service it is mapped to.
//
// SOURCE OF TRUTH: the existing `client_products` table — the same one the
// Clients page writes to when you tick Services on a client. (The old
// `service_clients` table was empty, which is why the dropdown showed
// "No clients mapped to this service".)
//
// Assumed columns on client_products: client_id, product_id.
// Organization scoping is done through the `clients` table (client_products
// itself is not filtered by organization_id, so this works even if that
// column doesn't exist).
//
// NOTE: this file must NOT require("./servicecases.controller") — that
// controller requires THIS file, so it would create a circular import.

const supabase = require("../../config/supabaseClient");

// Ids (as strings) of every client of this organization mapped to a service.
async function getMappedClientIds(productId, organizationId) {
  const { data, error } = await supabase
    .from("client_products")
    .select("client_id")
    .eq("organization_id", organizationId)
    .eq("product_id", productId);
  if (error) throw error;

  const ids = [...new Set((data || []).map((r) => r.client_id))];
  if (ids.length === 0) return [];

  // keep only clients that belong to this organization
  const { data: orgClients, error: cErr } = await supabase
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (cErr) throw cErr;
  return (orgClients || []).map((c) => String(c.id));
}

// { ok: true } when clientId is empty (client is optional) or mapped to
// the service. { ok: false, message } otherwise.
async function assertClientMappedToProduct(
  clientId,
  productId,
  organizationId,
) {
  if (!clientId) return { ok: true };
  const mapped = await getMappedClientIds(productId, organizationId);
  if (!mapped.includes(String(clientId))) {
    return {
      ok: false,
      message: "This client is not mapped to the selected service.",
    };
  }
  return { ok: true };
}

// GET /api/service-cases/product-clients/:productId
// -> { success, data: [{ id, name }] } — only clients mapped to the service.
async function listClientsForProduct(req, res) {
  try {
    const orgId = req.user.organizationId;
    const ids = await getMappedClientIds(req.params.productId, orgId);
    if (ids.length === 0) return res.json({ success: true, data: [] });

    const { data, error } = await supabase
      .from("clients")
      .select("id, name")
      .eq("organization_id", orgId)
      .in("id", ids)
      .order("name", { ascending: true });
    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error("listClientsForProduct error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/service-cases/product-clients/:productId   body: { clientIds: [] }
// Replaces the full set of clients mapped to a service (writes client_products).
async function setProductClients(req, res) {
  try {
    const orgId = req.user.organizationId;
    const { productId } = req.params;
    const clientIds = [
      ...new Set(
        (Array.isArray(req.body?.clientIds) ? req.body.clientIds : [])
          .filter((v) => v !== null && v !== undefined && v !== "")
          .map(String),
      ),
    ];

    const { data: product, error: pErr } = await supabase
      .from("service_master")
      .select("id")
      .eq("id", productId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found" });
    }

    // all clients of this org (used to validate input + scope the delete)
    const { data: orgClients, error: cErr } = await supabase
      .from("clients")
      .select("id")
      .eq("organization_id", orgId);
    if (cErr) throw cErr;
    const orgClientIds = (orgClients || []).map((c) => String(c.id));

    if (clientIds.some((id) => !orgClientIds.includes(id))) {
      return res
        .status(404)
        .json({ success: false, message: "One or more clients not found" });
    }

    // clients currently mapped (this org only)
    const current = await getMappedClientIds(productId, orgId);

    const toAdd = clientIds.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !clientIds.includes(id));

    if (toAdd.length > 0) {
      const { error: iErr } = await supabase.from("client_products").insert(
        toAdd.map((cid) => ({
          organization_id: orgId,
          client_id: cid,
          product_id: productId,
        })),
      );
      if (iErr) throw iErr;
    }
    if (toRemove.length > 0) {
      const { error: dErr } = await supabase
        .from("client_products")
        .delete()
        .eq("organization_id", orgId)
        .eq("product_id", productId)
        .in("client_id", toRemove);
      if (dErr) throw dErr;
    }

    res.json({
      success: true,
      message: "Service clients updated.",
      data: { productId, clientIds },
    });
  } catch (err) {
    console.error("setProductClients error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getMappedClientIds,
  assertClientMappedToProduct,
  listClientsForProduct,
  setProductClients,
};
