// Supabase connection. The "anon" key is designed to be public: it only works
// together with the database's row-level security rules (see supabase/01_schema.sql).
// Values in a local .env file (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) win over these.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://rugftwkcxefcayesjrpg.supabase.co'
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1Z2Z0d2tjeGVmY2F5ZXNqcnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4Mzg1NzMsImV4cCI6MjExMDQxNDU3M30.-JnLKqFvriJHeaJjg9Gw3svp9e9r2W0-zABj83o0mp0'
