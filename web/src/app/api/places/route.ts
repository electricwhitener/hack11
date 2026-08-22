import { NextResponse } from 'next/server';
import {
  PLACES,
  visiblePlaces,
  placeOverrides,
  savePlaceOverride,
  clearPlaceOverride,
  loadAll,
} from '@/lib/nightsafety';
import { isSurveyor, refuse } from '@/lib/surveyAuth';

export const dynamic = 'force-dynamic';

/**
 * Corrections to the imported OpenStreetMap landmarks.
 *
 * graph.json is frozen — regenerating it renumbers every segment and orphans
 * the survey — so a landmark that has closed or was never really a destination
 * is corrected here rather than at source.
 */
export async function GET() {
  await loadAll();
  return NextResponse.json({
    places: visiblePlaces(),
    imported: PLACES.map((p) => p.name),
    overrides: placeOverrides(),
  });
}

/** Hide or rename one imported landmark. */
export async function POST(req: Request) {
  if (!isSurveyor(req)) return refuse();
  const body = (await req.json()) as { name?: string; hidden?: boolean; displayName?: string | null };

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  // Keyed on the imported name, so it must be one that was actually imported.
  if (!PLACES.some((p) => p.name === name)) {
    return NextResponse.json({ error: `Not an imported landmark: ${name}` }, { status: 404 });
  }

  await loadAll();
  const ok = await savePlaceOverride(name, {
    ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    ...(body.displayName !== undefined
      ? { displayName: body.displayName?.trim() || null }
      : {}),
  });
  if (!ok) {
    return NextResponse.json(
      { error: 'Could not save. Has docs/sql/005_places.sql been run?' },
      { status: 500 },
    );
  }
  return NextResponse.json({ places: visiblePlaces(), overrides: placeOverrides() });
}

/** Restore a landmark to exactly what OpenStreetMap had. */
export async function DELETE(req: Request) {
  if (!isSurveyor(req)) return refuse();
  const name = new URL(req.url).searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });

  await loadAll();
  const ok = await clearPlaceOverride(name);
  if (!ok) return NextResponse.json({ error: 'Could not restore.' }, { status: 500 });
  return NextResponse.json({ places: visiblePlaces(), overrides: placeOverrides() });
}
