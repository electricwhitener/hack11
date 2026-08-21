import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasSupabase, safeUrl, safeKey } from '@/lib/supabase/config';

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * Without this, access tokens expire mid-session and Server Components start
 * seeing a logged-out user even though the browser thinks it is logged in.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No credentials: nothing to refresh, and calling Supabase would only add
  // latency to every request.
  if (!hasSupabase) return response;

  const supabase = createServerClient(safeUrl, safeKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Touching getUser() is what actually performs the refresh. Do not remove.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation, which never
     * need a session and would waste a round-trip.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
