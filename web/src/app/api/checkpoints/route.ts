import { NextResponse } from 'next/server';
import { listCheckpoints, upsertCheckpoint, deleteCheckpoint } from '@/lib/nightsafety';
import { isSurveyor, refuse } from '@/lib/surveyAuth';

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
  };

  if (!body.name?.trim()) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return NextResponse.json({ error: 'lat and lng are required.' }, { status: 400 });
  }

  const saved = await upsertCheckpoint({
    id: body.id,
    name: body.name.trim(),
    kind: body.kind ?? 'checkpoint',
    lat: body.lat,
    lng: body.lng,
    note: body.note ?? null,
  });
  if (!saved) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
  return NextResponse.json({ checkpoint: saved });
}

export async function DELETE(req: Request) {
  if (!isSurveyor(req)) return refuse();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  const ok = await deleteCheckpoint(id);
  return NextResponse.json({ deleted: ok }, { status: ok ? 200 : 500 });
}
