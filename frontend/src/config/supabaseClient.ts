import { createClient } from "@supabase/supabase-js";

// SECURITY: removed leftover debug console.logs that were printing the
// Supabase URL + anon key to the browser console on every page load.
// The anon key is safe to ship to the client (it's meant to be public,
// protected by Supabase RLS) — but logging it was unnecessary noise
// and info exposure with no upside, so it's gone.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
