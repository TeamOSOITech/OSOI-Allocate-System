// src/utils/fetchAll.js
//
// Supabase / PostgREST returns at most "Max Rows" (default 1000) per request,
// no matter what .limit() says — anything past that is silently dropped.
// fetchAll() walks the result set in pages so nothing is cut off.
//
// Usage — pass a FUNCTION that builds a fresh query (a query builder can't be
// reused after .range()), and give it a deterministic order (end it with .order("id")):
//
//   const { data, error } = await fetchAll(() =>
//     supabase.from("x").select("*").eq("organization_id", orgId)
//       .order("created_at").order("id"));
//
// maxRows is a safety stop so a runaway table can never exhaust memory.
async function fetchAll(makeQuery, { pageSize = 1000, maxRows = 50000 } = {}) {
  const out = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (data && data.length) out.push(...data);
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}

module.exports = { fetchAll };
