import { NextResponse } from 'next/server';
import { routePair, findPlace, checkpointPlaces, loadAll, type LatLng } from '@/lib/nightsafety';

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

  await loadAll();

  /*
   * A landmark resolves to its exact graph node. A surveyor-placed point
   * resolves to its COORDINATE instead, because the nearest node may be some
   * way off it — passing the coordinate is what lets routePair report how far
   * short of the actual shop the route stops.
   */
  const placed = new Map(checkpointPlaces().map((p) => [p.name.toLowerCase(), p]));
  const resolve = (v: string | LatLng | undefined): number | LatLng | undefined => {
    if (!v) return undefined;
    if (typeof v !== 'string') return v;
    const hit = findPlace(v);
    if (!hit) return undefined;
    return placed.has(hit.name.toLowerCase()) ? hit.at : hit.node;
  };

  const from = resolve(body.from);
  const to = resolve(body.to);

  // `from === undefined`, not `!from`: node 0 is a perfectly good graph node
  // and `!0` would reject it as unresolved.
  if (from === undefined || to === undefined) {
    return NextResponse.json(
      { error: 'Could not resolve both endpoints. Pass a known landmark or {lat,lng}.' },
      { status: 400 },
    );
  }

  return NextResponse.json(
    routePair(from, to, body.alpha ?? 4, typeof body.atMinutes === 'number' ? body.atMinutes : null),
  );
}
