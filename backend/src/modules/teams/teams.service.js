const supabase = require("../../config/supabaseClient");

const TABLE = "teams";

// Mirrors products.service.js's hidden-column handling: rows can have
// `hidden = NULL` (older rows / column defaults), and `.eq("hidden", false)`
// never matches NULL even though NULL should mean "not hidden". Treat both
// NULL and false as visible; only `true` counts as actually hidden.
const getAllTeams = async (organizationId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("organization_id", organizationId)
    .or("hidden.is.null,hidden.eq.false")
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
};

const getTeamById = async (id, organizationId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const createTeam = async (payload, organizationId) => {
  const { name } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .insert([
      {
        name,
        organization_id: organizationId,
        hidden: false,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
};

const updateTeam = async (id, payload, organizationId) => {
  const { name } = payload;

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

const deleteTeam = async (id, organizationId) => {
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

module.exports = {
  getAllTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
};
