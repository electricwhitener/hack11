import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { safeUrl, safeKey } from './config';

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 *
 * Reads the session from cookies, so it knows who the logged-in user is.
 * Always `await` this — cookies() is async in Next 15+.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(safeUrl, safeKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // The middleware refreshes the session instead, so this is safe
          // to swallow.
        }
      },
    },
  });
}
