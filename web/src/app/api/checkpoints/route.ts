import { NextResponse } from 'next/server';
import { listCheckpoints, upsertCheckpoint, deleteCheckpoint } from '@/lib/nightsafety';
import { isSurveyor, refuse } from '@/lib/surveyAuth';
import { isKnownKind, normaliseKind } from '@/lib/checkpointKinds';

export const dynamic = 'force-dynamic';

/** Public: everyone should see where help is. */
export async function GET() {
  return NextResponse.json({ checkpoints: await listCheckpoints() });
}

/** Create or edit. Passing an existing id edits it; omitting one creates. */
export async function POST(req: Request) {
  if (!isSurveyor(req)) return refuse();
  const body = (await req.json()) as {
    id?: string;
    name?: string;
    kind?: string;
    lat?: number;
    lng?: number;
    note?: string;
    barrier?: 'hard' | 'permission' | null;
    closes?: string | null;
    opens?: string | null;
    permit?: string | null;
  };

  if (!body.name?.trim()) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return NextResponse.json({ error: 'lat and lng are required.' }, { status: 400 });
  }
  // Reject a kind nothing can draw rather than storing it. The old default was
  // the literal string 'checkpoint', which is not one of the kinds either.
  if (body.kind && !isKnownKind(body.kind)) {
    return NextResponse.json({ error: `Unknown kind: ${body.kind}` }, { status: 400 });
  }
  if (body.barrier && body.barrier !== 'hard' && body.barrier !== 'permission') {
    return NextResponse.json({ error: `Unknown barrier: ${body.barrier}` }, { status: 400 });
  }
  // A half-specified window is worse than none: it would silently mean "always
  // shut", which is the opposite of what somebody typing one time intends.
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const [field, v] of [['closes', body.closes], ['opens', body.opens]] as const) {
    if (v && !HHMM.test(v)) {
      return NextResponse.json({ error: `${field} must be HH:MM, got ${v}` }, { status: 400 });
    }
  }
  if (Boolean(body.closes) !== Boolean(body.opens)) {
    return NextResponse.json(
      { error: 'Give both closes and opens, or neither (neither = always shut).' },
      { status: 400 },
    );
  }

  const saved = await upsertCheckpoint({
    id: body.id,
    name: body.name.trim(),
    kind: normaliseKind(body.kind),
    lat: body.lat,
    lng: body.lng,
    note: body.note ?? null,
    barrier: body.barrier ?? null,
    closes: body.closes ?? null,
    opens: body.opens ?? null,
    permit: body.permit ?? null,
  });
  if (!saved) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ checkpoint: saved });
}

export async function DELETE(req: Request) {
  if (!isSurveyor(req)) return refuse();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  const ok = await deleteCheckpoint(id);
  // Nothing removed means the id was already gone, not that the server broke.
  if (!ok) return NextResponse.json({ error: 'No such point.' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
