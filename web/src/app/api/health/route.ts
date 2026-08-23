import { NextResponse } from 'next/server';
import { API_KEYS, MODEL_CHAIN, MODEL_ATTEMPTS, MODEL_ID } from '@/lib/ai/provider';
import { areaStats, meta, loadAll } from '@/lib/nightsafety';
import { hasSupabase } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';

/**
 * Pre-demo check: is the deployment actually configured the way you think?
 *
 * Exists because .env.local is invisible to Vercel, so keys added locally look
 * fine while production quietly runs on one — which is exactly how the agent
 * ran out of quota mid-demo. This reports the COUNT of keys and never a key,
 * a prefix, or a length, so it is safe to leave public.
 */
export async function GET() {
  await loadAll();
  const s = areaStats();

  return NextResponse.json({
    ok: API_KEYS.length > 0,
    ai: {
      keys: API_KEYS.length,
      models: MODEL_CHAIN.length,
      /*
       * The ORDER, not just the count. MODEL_CHAIN can be overridden by an env
       * var, so a change committed here can be silently beaten by one set on
       * the host — and the only way to know which is live is to ask production.
       */
      chain: MODEL_CHAIN,
      attempts: MODEL_ATTEMPTS.length,
      approxRequestsPerDay: MODEL_ATTEMPTS.length * 20,
      /*
       * The model actually tried FIRST, which is the head of the chain — not
       * MODEL_ID. The chat route walks MODEL_ATTEMPTS, so reporting MODEL_ID
       * here would quietly name a model the agent never reaches if the two
       * ever drift apart.
       */
      primaryModel: MODEL_CHAIN[0] ?? MODEL_ID,
    },
    auth: { supabaseConfigured: hasSupabase, required: false },
    graph: {
      area: meta.area,
      segments: s.segments,
      totalKm: s.totalKm,
      hostels: s.hostels,
      destinations: s.destinations,
      citizenReports: s.citizenReports,
    },
  });
}
