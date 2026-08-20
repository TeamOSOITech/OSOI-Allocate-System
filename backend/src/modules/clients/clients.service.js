// src/modules/clients/clients.service.js
//
// All Supabase/DB access for the clients module. Pulled out of
// clients.routes.js so routes only wire up HTTP + middleware and the
// controller only handles req/res + response shaping — this file is the
// only place that talks to the `clients` / `subclients` /
// `client_products` / `approval_requests` tables for clients.

const supabase = require("../../config/supabaseClient");

// ---------- list ----------

async function getAllClients(orgId) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

async function getAllSubclientsForOrg(orgId) {
  const { data, error } = await supabase
    .from("subclients")
    .select("*")
    .eq("organization_id", orgId);

  if (error) throw error;
  return data || [];
}

// One query for every client->product link in this org, then group in
// memory — avoids an N+1 query per client in the list view.
async function getClientProductLinksForOrg(orgId) {
  const { data, error } = await supabase
    .from("client_products")
    .select("client_id, amount, currency, service_master(*)")
    .eq("organization_id", orgId);

  if (error) throw error;
  return data || [];
}

// ---------- approvals ----------

async function getPendingClientApprovals(orgId) {
  const { data } = await supabase
    .from("approval_requests")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "PENDING")
    .in("type", ["CLIENT_CREATE", "CLIENT_UPDATE", "CLIENT_DELETE"]);

  return data || [];
}

// ---------- single client ----------

async function createClient(payload) {
  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getClientById(id, orgId) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId) // cross-org requests get a 404, not a 403 —
    .single(); // don't reveal that the id exists elsewhere

  if (error || !data) return null;
  return data;
}

async function getSubclientsForClient(id, orgId) {
  const { data, error } = await supabase
    .from("subclients")
    .select("*")
    .eq("organization_id", orgId)
    .eq("client_id", id);

  if (error) throw error;
  return data || [];
}

async function updateClient(id, orgId, payload) {
  const { data, error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", id)
    .eq("organization_id", orgId) // can't update a row belonging to another org
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function clientExists(id, orgId) {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

// Throws on any error, including 23503 (FK violation — still has
// subclients) so the controller can branch on err.code.
async function deleteClient(id, orgId) {
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw error;
}

// ---------- bulk upload helpers ----------
// Both scoped to organizationId so a same-named client/subclient in
// another org is never matched or reused.

async function findClientByName(orgId, name) {
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("organization_id", orgId)
    .ilike("name", name)
    .maybeSingle();

  return data || null;
}

async function insertClientRow(fields) {
  const { data, error } = await supabase
    .from("clients")
    .insert(fields)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function findSubclientByName(orgId, clientId, name) {
  const { data } = await supabase
    .from("subclients")
    .select("*")
    .eq("organization_id", orgId)
    .eq("client_id", clientId)
    .ilike("name", name)
    .maybeSingle();

  return data || null;
}

async function insertSubclientRow(fields) {
  const { data, error } = await supabase
    .from("subclients")
    .insert(fields)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  getAllClients,
  getAllSubclientsForOrg,
  getClientProductLinksForOrg,
  getPendingClientApprovals,
  createClient,
  getClientById,
  getSubclientsForClient,
  updateClient,
  clientExists,
  deleteClient,
  findClientByName,
  insertClientRow,
  findSubclientByName,
  insertSubclientRow,
};
