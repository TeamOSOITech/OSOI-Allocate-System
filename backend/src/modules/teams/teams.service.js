const supabase = require("../../config/supabaseClient");

const TABLE = "teams";

// FIX: this only ever returned rows that exist in the curated `teams`
// table. But Add User's Team dropdown (see options.routes.js's
// mergeDistinct) also shows any team name already in use on an existing
// employee's "Worked In Teams" field, even if it was never separately
// added via the "+" control / Team management screen. Those two lists
// drifted apart — e.g. an org with 4-5 teams typed directly on employees
// but only 1 ever added to the `teams` table meant the Services page's
// Team-link dropdown showed just that 1, while Add User showed all 4-5.
// This now does the exact same merge, so every screen that lists "the
// org's teams" agrees.
//
// Merged-in names that don't have a real `teams` row get a synthetic
// string id (`used-<name>`) — callers here only use `id` as a React key /
// row identity, never to write back to the teams table, so a non-numeric
// placeholder is safe.
function mergeTeamNames(curatedRows, usedNames) {
  const seenLower = new Set();
  const merged = [];

  for (const row of curatedRows || []) {
    const trimmed = (row.name || "").toString().trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    merged.push({ id: row.id, name: trimmed, hidden: row.hidden || false });
  }

  for (const raw of usedNames || []) {
    const trimmed = (raw || "").toString().trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    merged.push({ id: `used-${trimmed}`, name: trimmed, hidden: false });
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

// Mirrors products.service.js's hidden-column handling: rows can have
// `hidden = NULL` (older rows / column defaults), and `.eq("hidden", false)`
// never matches NULL even though NULL should mean "not hidden". Treat both
// NULL and false as visible; only `true` counts as actually hidden.
const getAllTeams = async (organizationId) => {
  const [
    { data: curated, error: curatedErr },
    { data: userRows, error: userErr },
  ] = await Promise.all([
    supabase
      .from(TABLE)
      .select("*")
      .eq("organization_id", organizationId)
      .or("hidden.is.null,hidden.eq.false")
      .order("name", { ascending: true }),
    supabase
      .from("user_master")
      .select('"Worked In Teams"')
      .eq("organization_id", organizationId),
  ]);

  if (curatedErr) throw curatedErr;
  if (userErr) throw userErr;

  const usedNames = (userRows || []).map((r) => r["Worked In Teams"]);
  return mergeTeamNames(curated, usedNames);
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
