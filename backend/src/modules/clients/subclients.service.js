// src/modules/clients/subclients.service.js
//
// All Supabase/DB access for the subclients module. Pulled out of
// subclients.routes.js so routes only wire up HTTP + middleware and the
// controller only handles req/res + response shaping — this file is the
// only place that talks to the `subclients` / `clients` / `branches` /
// `subclient_products` tables for subclients.

const supabase = require("../../config/supabaseClient");

// ---------- list ----------

async function getAllSubclients(orgId) {
  const { data, error } = await supabase
    .from("subclients")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

async function getClientNamesForOrg(orgId) {
  const { data } = await supabase
    .from("clients")
    .select("id,name")
    .eq("organization_id", orgId);

  return data || [];
}

async function getBranchesForOrg(orgId) {
  const { data } = await supabase
    .from("branches")
    .select("*")
    .eq("organization_id", orgId);

  return data || [];
}

// One query for every subclient->product link in this org, then group in
// memory — avoids an N+1 query per subclient in the list view.
async function getSubclientProductLinksForOrg(orgId) {
  const { data } = await supabase
    .from("subclient_products")
    .select("subclient_id, amount, currency, service_master(*)")
    .eq("organization_id", orgId);

  return data || [];
}

// ---------- client ownership check ----------
// Make sure a client actually belongs to the caller's org — otherwise
// someone could attach a subclient to another organization's client id.

async function clientBelongsToOrg(clientId, orgId) {
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return !!data;
}

// ---------- single subclient ----------

async function createSubclient(payload) {
  const { data, error } = await supabase
    .from("subclients")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getSubclientById(id, orgId) {
  const { data, error } = await supabase
    .from("subclients")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .single();

  if (error || !data) return null;
  return data;
}

async function getClientForSubclient(clientId, orgId) {
  const { data } = await supabase
    .from("clients")
    .select("id,name")
    .eq("id", clientId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return data || null;
}

async function getBranchesForSubclient(id, orgId) {
  const { data } = await supabase
    .from("branches")
    .select("id")
    .eq("organization_id", orgId)
    .eq("subclient_id", id);

  return data || [];
}

async function updateSubclient(id, orgId, payload) {
  const { data, error } = await supabase
    .from("subclients")
    .update(payload)
    .eq("id", id)
    .eq("organization_id", orgId) // can't update another org's subclient
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function subclientExists(id, orgId) {
  const { data, error } = await supabase
    .from("subclients")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

// Throws on any error, including 23503 (FK violation — still has
// branches) so the controller can branch on err.code.
async function deleteSubclient(id, orgId) {
  const { error } = await supabase
    .from("subclients")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) throw error;
}

// ---------- bulk upload helpers ----------
// Both scoped to organizationId (and client_id, where relevant) so a
// same-named client/subclient in another org is never matched or reused.

async function findClientByName(orgId, name) {
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("organization_id", orgId)
    .ilike("name", name)
    .maybeSingle();

  return data || null;
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
  const { error } = await supabase.from("subclients").insert(fields);
  if (error) throw error;
}

module.exports = {
  getAllSubclients,
  getClientNamesForOrg,
  getBranchesForOrg,
  getSubclientProductLinksForOrg,
  clientBelongsToOrg,
  createSubclient,
  getSubclientById,
  getClientForSubclient,
  getBranchesForSubclient,
  updateSubclient,
  subclientExists,
  deleteSubclient,
  findClientByName,
  findSubclientByName,
  insertSubclientRow,
};
