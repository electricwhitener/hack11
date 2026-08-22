import { NextResponse } from 'next/server';
import {
  edges,
  nodeLatLng,
  areaStats,
  meta,
  visiblePlaces,
  loadAll,
  tunnelSegments,
  blockedSegments,
} from '@/lib/nightsafety';

/**
 * Slim drawing payload for the map.
 *
 * The full graph JSON carries labels and way ids the renderer never needs.
 * Stripping them roughly halves what crosses the wire, and the client only
 * fetches this once.
 */
export async function GET() {
  // Reports may have been filed against a different lambda, so pull the shared
  // state from Postgres before reading anything derived from it.
  await loadAll();
  const stats = areaStats();

  // wayId travels with each segment so the client can highlight a whole path
  // under the cursor without a round trip.
  const segments = edges.map((e) => {
    const a = nodeLatLng(e.a);
    const b = nodeLatLng(e.b);
    return [a.lat, a.lng, b.lat, b.lng, e.risk, e.darkness, e.exposure, e.wayId];
  });

  return NextResponse.json({
    segments,
    stats,
    area: meta.area,
    // Hidden and renamed landmarks are corrected here, not in graph.json.
    places: visiblePlaces(),
    tunnels: tunnelSegments(),
    blocked: blockedSegments(),
  });
}
