import { NextResponse } from 'next/server';
import { spanAt, reportSpan, reportCount, trimSpan, loadAll, persistSpan } from '@/lib/nightsafety';

/**
 * A citizen report: "this stretch is dark".
 *
 * The problem statement asks for a *reporting* system, and this is the half no
 * public dataset can supply — OpenStreetMap has almost no lamp coverage here.
 * The exposure model earns its keep by making the reporting tractable: it says
 * which paths are worth walking in the first place.
 *
 * A report covers at most MAX_REPORT_METERS. The client sends the exact span it
 * highlighted so what the user saw is what gets recorded; coordinates are
 * accepted as a fallback for the agent and direct API calls.
 */
export async function POST(req: Request) {
  const { lat, lng, span, dark = true } = (await req.json()) as {
    lat?: number;
    lng?: number;
    span?: number[];
    dark?: boolean;
  };

  // Read-modify-write: start from the shared counts, not this lambda's.
  await loadAll();

  let indices = Array.isArray(span) ? span.filter((n) => Number.isInteger(n)) : undefined;

  if (!indices?.length) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'Pass {span} or {lat, lng}.' }, { status: 400 });
    }
    indices = spanAt({ lat, lng }).indices;
  }

  // Enforce the cap BEFORE recording anything — a hand-rolled span must not be
  // able to mark half the campus in one call.
  indices = trimSpan(indices);

  const result = reportSpan(indices, dark !== false);
  await persistSpan(indices);

  return NextResponse.json({ ...result, totalReports: reportCount() });
}
