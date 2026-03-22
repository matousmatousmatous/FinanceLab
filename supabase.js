const { createClient } = require('@supabase/supabase-js');

// Use the service role key on the server — it bypasses RLS and allows storage writes.
// Falls back to anon key for local dev without a service key.
const supabase = process.env.SUPABASE_URL
  ? createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
    )
  : null;

module.exports = supabase;
