import { NextResponse } from 'next/server';
import { routePair, findPlace, loadAll, type LatLng } from '@/lib/nightsafety';

/**
 * Plans the shortest/safest pair between two named landmarks or raw points.
 * Shared with the agent's planSafeRoute tool so chat and map always agree.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    from?: string | LatLng;
    to?: string | LatLng;
    alpha?: number;
    /** Minutes past midnight. Omit for a time-blind plan. */
    atMinutes?: number | null;
  };

  // Landmarks resolve to their exact graph node; raw coordinates get snapped.
  const resolve = (v: string | LatLng | undefined): number | LatLng | undefined => {
    if (!v) return undefined;
    if (typeof v === 'string') return findPlace(v)?.node;
    return v;
  };

  await loadAll();

  const from = resolve(body.from);
  const to = resolve(body.to);

  if (!from || !to) {
    return NextResponse.json(
      { error: 'Could not resolve both endpoints. Pass a known landmark or {lat,lng}.' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    routePair(from, to, body.alpha ?? 4, typeof body.atMinutes === 'number' ? body.atMinutes : null),
  );
}
