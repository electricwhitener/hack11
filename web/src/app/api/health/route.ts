import { NextResponse } from 'next/server';
import { API_KEYS, MODEL_CHAIN, MODEL_ATTEMPTS, MODEL_ID } from '@/lib/ai/provider';
import { areaStats, meta, loadReports } from '@/lib/nightsafety';
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
  await loadReports();
  const s = areaStats();

  return NextResponse.json({
    ok: API_KEYS.length > 0,
    ai: {
      keys: API_KEYS.length,
      models: MODEL_CHAIN.length,
      attempts: MODEL_ATTEMPTS.length,
      approxRequestsPerDay: MODEL_ATTEMPTS.length * 20,
      primaryModel: MODEL_ID,
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
