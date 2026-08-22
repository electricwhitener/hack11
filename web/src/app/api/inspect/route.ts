import { NextResponse } from 'next/server';
import {
  spanAt,
  beliefForSpan,
  MAX_REPORT_METERS,
  loadAll,
  isBlocked,
  exposureLabel,
} from '@/lib/nightsafety';

/**
 * Identify the reportable stretch under a click.
 *
 * Returns the span the user is about to act on — capped at MAX_REPORT_METERS —
 * along with what we currently believe about it, plus a JSON line ready to
 * paste into docs/campus-data.json. Making a survey contribution a copy-paste
 * rather than a hunt for way ids is the difference between ground truth being
 * collected and not.
 */
export async function POST(req: Request) {
  const { lat, lng } = (await req.json()) as { lat?: number; lng?: number };
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return NextResponse.json({ error: 'Pass {lat, lng}.' }, { status: 400 });
  }

  await loadAll();
  const span = spanAt({ lat, lng });
  const belief = beliefForSpan(span.indices);
  if (!belief) return NextResponse.json({ error: 'No path there.' }, { status: 404 });

  return NextResponse.json({
    label: belief.label,
    wayId: span.seed.wayId,
    span: span.indices,
    meters: belief.meters,
    segments: span.indices.length,
    maxMeters: MAX_REPORT_METERS,
    lit: belief.darkness <= 0.5,
    blocked: span.indices.some(isBlocked),
    darkness: belief.darkness,
    darkReports: belief.darkReports,
    litReports: belief.litReports,
    confidence: belief.confidence,
    source: belief.source,
    surveyed: belief.surveyed,
    exposure: belief.exposure,
    exposureLabel: exposureLabel(belief.exposure),
    risk: Number((belief.exposure * belief.darkness).toFixed(4)),
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    blockedSnippet: `{ "lat": ${lat.toFixed(5)}, "lng": ${lng.toFixed(5)}, "note": "${belief.label} - why it cannot be walked" }`,
    lightingSnippet: `{ "lat": ${lat.toFixed(5)}, "lng": ${lng.toFixed(5)}, "lit": false, "note": "${belief.label} - surveyed" }`,
  });
}
