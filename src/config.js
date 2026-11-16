// Supabase connection. The "anon" key is designed to be public: it only works
// together with the database's row-level security rules (see supabase/01_schema.sql).
// Values in a local .env file (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) win over these.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'PASTE_SUPABASE_URL_HERE'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'PASTE_SUPABASE_ANON_KEY_HERE'
