import { NextResponse } from 'next/server';
import { spanAt, trimSpan, saveSurvey, loadAll, surveyCount } from '@/lib/nightsafety';
import { isSurveyor, refuse, surveyEnabled } from '@/lib/surveyAuth';

/**
 * Record surveyed ground truth for one stretch of path.
 *
 * Unlike /api/report this REPLACES what we believed rather than adding evidence
 * to it — the difference between "somebody thinks this is dark" and "somebody
 * walked it at 11pm and looked".
 */
export async function POST(req: Request) {
  if (!isSurveyor(req)) return refuse();

  const body = (await req.json()) as {
    lat?: number;
    lng?: number;
    span?: number[];
    lighting?: 'lit' | 'dim' | 'dark' | null;
    blocked?: boolean;
    traffic?: 'high' | 'medium' | 'low' | null;
    note?: string | null;
    surveyor?: string | null;
  };

  // A structural block carries no lighting claim, so lighting may be omitted —
  // but one of the two has to be present or there is nothing to record.
  if (!body.blocked && (!body.lighting || !['lit', 'dim', 'dark'].includes(body.lighting))) {
    return NextResponse.json(
      { error: 'Send lighting (lit/dim/dark), or blocked: true.' },
      { status: 400 },
    );
  }

  await loadAll();

  let indices = Array.isArray(body.span) ? body.span.filter(Number.isInteger) : undefined;
  if (!indices?.length) {
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
      return NextResponse.json({ error: 'Pass {span} or {lat, lng}.' }, { status: 400 });
    }
    indices = spanAt({ lat: body.lat, lng: body.lng }).indices;
  }
  indices = trimSpan(indices);

  const result = await saveSurvey(
    indices,
    body.lighting ?? null,
    body.traffic ?? null,
    body.note ?? null,
    body.surveyor ?? null,
    Boolean(body.blocked),
  );
  if (!result) return NextResponse.json({ error: 'No path there.' }, { status: 404 });

  return NextResponse.json({ ...result, totalSurveyed: surveyCount() });
}

/** Lets the client discover whether surveying is available and its key valid. */
export async function GET(req: Request) {
  return NextResponse.json({ enabled: surveyEnabled, authorised: isSurveyor(req) });
}
