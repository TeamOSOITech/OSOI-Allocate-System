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

// This client uses the service_role key and is meant ONLY for
// server-side table queries (it bypasses Row Level Security).
//
// FIX (RLS bug): this used to ALSO be reused for auth.getUser(token) /
// signInWithPassword() / refreshSession() in auth.js and auth.service.js.
// Those calls mutate a client's internal GoTrue session state — doing
// that on this same shared instance let a caller's "authenticated"
// session leak into OTHER in-flight service-role queries on this client,
// silently downgrading them from service_role to authenticated and
// causing intermittent, hard-to-reproduce "new row violates row-level
// security policy" errors under real traffic — even though the service
// role key itself was correct. All auth/session calls now run on a
// separate, isolated client instead — see supabaseAuthClient.js. This
// client should only ever be used for .from(...) table queries.
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

module.exports = supabase;
