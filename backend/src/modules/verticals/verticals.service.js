const getSupabaseClient = require("../../config/db");

async function getVerticalCaseCounts() {
  const supabase = getSupabaseClient(); // fresh client each time
  const { data, error } = await supabase
    .from("vertical_master")
    .select("Title, vertical_TotalCases")
    .order("Title", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch vertical_master: ${error.message}`);
  }

  return data.map((row) => ({
    name: row.Title,
    count: row.vertical_TotalCases,
  }));
}

module.exports = { getVerticalCaseCounts };