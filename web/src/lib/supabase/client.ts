import { createBrowserClient } from '@supabase/ssr';
import { safeUrl, safeKey } from './config';

/**
 * Supabase client for use in Client Components ('use client').
 *
 * Safe to expose: the anon key is a PUBLIC key. It grants no access on its own
 * — every table is protected by Row Level Security policies (see
 * supabase/schema.sql), so a user can only ever read or write their own rows.
 * Never put the SERVICE ROLE key here; that one bypasses RLS entirely.
 *
 * Falls back to placeholders when unconfigured so the app still builds; guard
 * real usage with `hasSupabase`.
 */
export function createClient() {
  return createBrowserClient(safeUrl, safeKey);
}
