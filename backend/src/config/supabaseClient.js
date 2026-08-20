const { createClient } = require("@supabase/supabase-js");

// npm install @supabase/supabase-js
// Add to your backend .env (NOT the frontend one):
//   SUPABASE_URL=https://your-project-ref.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   (Project Settings -> API)
//
// IMPORTANT: the service role key bypasses Row Level Security and must
// only ever be used on the server, never shipped to the browser/frontend.

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

// IMPORTANT: this client is a shared singleton used both for admin-level
// table queries (as service_role) AND for per-request token verification
// in auth.js (supabase.auth.getUser(token)). Without disabling session
// persistence/auto-refresh, calling auth.getUser(token) with a given
// user's JWT can mutate this client's internal GoTrue session state —
// under concurrent requests, that leaks a caller's "authenticated" role
// session into OTHER in-flight service-role queries on the same client,
// silently downgrading them from service_role (which bypasses RLS) to
// authenticated (which is subject to RLS) and causing intermittent,
// hard-to-reproduce "new row violates row-level security policy" errors
// under real traffic — even though the service_role key itself is correct.
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

module.exports = supabase;
