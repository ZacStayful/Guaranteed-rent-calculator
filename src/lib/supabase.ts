import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Supabase (server-side only) ──────────────────────────────────
// Used for the fire-and-forget storage of completed analyser reports
// (see src/app/api/analyse/route.ts). This is a server-side-only insert
// with no end-user auth involved, so we authenticate with the SERVICE
// ROLE key — never the anon key — and this module must never be imported
// into client components.
//
// Required env vars (set these in Vercel project settings before this
// goes live in production):
//   • SUPABASE_URL
//   • SUPABASE_SERVICE_ROLE_KEY
//
// When either is missing, getSupabase() returns null so callers can
// silently no-op rather than throwing — a missing config must never
// break a lead's live estimate.

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      // No user sessions on the server — don't persist or refresh tokens.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}
