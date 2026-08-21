/**
 * Whether Supabase is configured at all.
 *
 * The app must BUILD and RUN without credentials — otherwise a missing env var
 * on Vercel turns into a failed deploy rather than a visible warning. When this
 * is false the app runs without auth: the agent still works, chat history just
 * is not persisted.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Placeholders keep the SDK constructor from throwing when unconfigured. */
export const safeUrl = SUPABASE_URL || 'https://placeholder.supabase.co';
export const safeKey = SUPABASE_ANON_KEY || 'placeholder-anon-key';
