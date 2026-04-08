/**
 * supabaseAdmin.js
 * Learnove — Supabase server-side (service-role) client.
 *
 * The SERVICE ROLE key bypasses Row Level Security — never expose it to
 * the browser. It lives only here in the backend environment.
 *
 * Set these in your .env file (local) or hosting environment variables:
 *   SUPABASE_URL=https://your-project-ref.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
    'Check your .env file.'
  );
}

// Admin client — service role, no RLS restrictions
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = { supabaseAdmin, SUPABASE_URL };