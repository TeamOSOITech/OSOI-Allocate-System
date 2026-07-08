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
    "Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

module.exports = supabase;