import { NextResponse } from 'next/server';
import {
  spanAt,
  trimSpan,
  saveSurvey,
  clearSurvey,
  loadAll,
  surveyCount,
  type SurveyPatch,
} from '@/lib/nightsafety';
import { isSurveyor, refuse, surveyEnabled } from '@/lib/surveyAuth';

const LIGHTING = ['lit', 'dim', 'dark'];
const TRAFFIC = ['high', 'medium', 'low'];

/** The span to act on, from an explicit list or a tapped coordinate. */
function spanFrom(span: unknown, lat?: number, lng?: number): number[] | null {
  const given = Array.isArray(span) ? span.filter(Number.isInteger) : [];
  if (given.length) return trimSpan(given);
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return trimSpan(spanAt({ lat, lng }).indices);
}

/**
 * Record surveyed ground truth for one stretch of path.
 *
 * Unlike /api/report this REPLACES what we believed rather than adding evidence
 * to it — the difference between "somebody thinks this is dark" and "somebody
 * walked it at 11pm and looked".
 *
 * The body is a PATCH. Send only what you observed: a traffic correction on its
 * own leaves the lighting survey alone, and marking a fence leaves both alone.
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

  const patch: SurveyPatch = {};
  if (body.lighting !== undefined) {
    if (body.lighting !== null && !LIGHTING.includes(body.lighting)) {
      return NextResponse.json({ error: 'lighting must be lit, dim or dark.' }, { status: 400 });
    }
    patch.lighting = body.lighting;
  }
  if (body.traffic !== undefined) {
    if (body.traffic !== null && !TRAFFIC.includes(body.traffic)) {
      return NextResponse.json({ error: 'traffic must be high, medium or low.' }, { status: 400 });
    }
    patch.traffic = body.traffic;
  }
  if (body.note !== undefined) patch.note = body.note;
  if (typeof body.blocked === 'boolean') patch.blocked = body.blocked;

  // Any one observation is a survey. This used to demand a lighting value
  // unless `blocked` was TRUE, which made `{blocked: false}` — the unblock
  // button, the only way to take a mistaken fence back — a 400 every time.
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Send at least one of lighting, traffic, note or blocked.' },
      { status: 400 },
    );
  }

  await loadAll();

  const indices = spanFrom(body.span, body.lat, body.lng);
  if (!indices) return NextResponse.json({ error: 'Pass {span} or {lat, lng}.' }, { status: 400 });

  const result = await saveSurvey(indices, patch, body.surveyor ?? null);
  if (!result) return NextResponse.json({ error: 'No path there.' }, { status: 404 });

  return NextResponse.json({ ...result, totalSurveyed: surveyCount() });
}

/**
 * Withdraw a survey, returning the span to the modelled estimate.
 *
 * A surveyor tapping the wrong stretch in the dark needs to take it back, not
 * paper over it with a second claim that carries the same survey-strength
 * prior. Overwriting is not the same as retracting.
 */
export async function DELETE(req: Request) {
  if (!isSurveyor(req)) return refuse();

  const params = new URL(req.url).searchParams;
  const span = (params.get('span') ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter(Number.isInteger);

  const lat = params.has('lat') ? Number(params.get('lat')) : undefined;
  const lng = params.has('lng') ? Number(params.get('lng')) : undefined;

  await loadAll();

  const indices = spanFrom(span, lat, lng);
  if (!indices) return NextResponse.json({ error: 'Pass ?span= or ?lat=&lng=.' }, { status: 400 });

  const result = await clearSurvey(indices);
  if (!result) return NextResponse.json({ error: 'No path there.' }, { status: 404 });

  return NextResponse.json({ ...result, totalSurveyed: surveyCount() });
}

/** Lets the client discover whether surveying is available and its key valid. */
export async function GET(req: Request) {
  return NextResponse.json({ enabled: surveyEnabled, authorised: isSurveyor(req) });
}
