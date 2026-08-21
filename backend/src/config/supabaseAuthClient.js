const { createClient } = require("@supabase/supabase-js");

// This client exists ONLY for calls that mutate a Supabase client's
// internal session state: auth.getUser(token), auth.signInWithPassword(),
// and auth.refreshSession().
//
// WHY A SEPARATE CLIENT: supabaseClient.js's main `supabase` export is
// shared across every module for plain .from(...) table queries and is
// relied on to always act as the service_role (bypassing RLS). The
// supabase-js client keeps auth/session state as internal, mutable
// instance state. If any of the three calls above run on that SAME
// shared instance, they overwrite its internal session with whichever
// end-user just logged in / refreshed / was verified — silently
// downgrading every OTHER in-flight query on that shared client from
// service_role to that user's own (RLS-restricted) session. That's what
// caused intermittent "new row violates row-level security policy for
// table ..." errors under real traffic, even though the service role key
// itself was always correct.
//
// Using its own isolated instance (still created with the service role
// key, since no anon key is configured for this project) means its
// session mutations only ever affect ITSELF, never the shared query
// client.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

const supabaseAuthClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

module.exports = supabaseAuthClient;
