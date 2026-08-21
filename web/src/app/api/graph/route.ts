import { NextResponse } from 'next/server';
import { edges, nodeLatLng, areaStats, meta, PLACES } from '@/lib/nightsafety';

/**
 * Slim drawing payload for the map.
 *
 * The full graph JSON carries labels and way ids the renderer never needs.
 * Stripping them roughly halves what crosses the wire, and the client only
 * fetches this once.
 */
export async function GET() {
  // Call this FIRST: reports may have been recorded by another module instance,
  // and areaStats() folds them into `edges` before the segments are read.
  const stats = areaStats();

  // wayId travels with each segment so the client can highlight a whole path
  // under the cursor without a round trip.
  const segments = edges.map((e) => {
    const a = nodeLatLng(e.a);
    const b = nodeLatLng(e.b);
    return [a.lat, a.lng, b.lat, b.lng, e.risk, e.darkness, e.exposure, e.wayId];
  });

  return NextResponse.json({ segments, stats, area: meta.area, places: PLACES });
}
