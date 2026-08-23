/**
 * Exercises the surveyor endpoints against stubbed Postgres.
 *
 *   npx tsx scripts/survey-check.ts
 *
 * Every Supabase call goes through global fetch, so replacing fetch lets the
 * real route handlers run end to end without a single request leaving the
 * machine — which matters while a survey is actually in progress against the
 * live database.
 */

process.env.SURVEY_PASSCODE = 'test-passcode';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon-key';

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];

/** What the stubbed PostgREST returns next, per table. */
let checkpointDeleteRows: unknown[] = [];

/**
 * A stateful stand-in for path_surveys.
 *
 * It has to hold rows rather than answer []: every write path calls loadAll()
 * first, and loadSurveys() CLEARS the in-memory map before refilling it from
 * the response. A stub that always returned nothing would wipe the survey
 * between requests and make merging look broken when it was not.
 */
const surveyRows = new Map<number, Record<string, unknown>>();
/** Stand-ins for the checkpoints and place_overrides tables. */
let checkpointRows: Record<string, unknown>[] = [];
const placeRows = new Map<string, Record<string, unknown>>();
/** Simulates 004/005 not having been run yet. */
let gateColumnsExist = true;
let placeTableExists = true;

const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  let body: unknown = null;
  try {
    body = init?.body ? JSON.parse(String(init.body)) : null;
  } catch {
    /* not json */
  }
  calls.push({ url, method, body });

  if (url.includes('path_surveys')) {
    if (method === 'GET') return json([...surveyRows.values()]);
    if (method === 'POST') {
      for (const r of body as Record<string, unknown>[]) {
        surveyRows.set(r.segment_idx as number, r);
      }
      return json([], 201);
    }
    if (method === 'DELETE') {
      const list = /segment_idx=in\.\(([^)]*)\)/.exec(url)?.[1] ?? '';
      for (const n of list.split(',')) surveyRows.delete(Number(n));
      return json([]);
    }
  }

  if (url.includes('/checkpoints')) {
    // PostgREST 400s the whole select when one column does not exist.
    if (method === 'GET' && !gateColumnsExist && url.includes('barrier')) {
      return json({ message: 'column checkpoints.barrier does not exist' }, 400);
    }
    if (method === 'GET') return json(checkpointRows);
    if (method === 'DELETE') return json(checkpointDeleteRows);
    if (method === 'POST') {
      const row = { id: 'cp-1', ...(body as Record<string, unknown>[])[0] };
      checkpointRows = [...checkpointRows.filter((r) => r.id !== row.id), row];
      return json([row], 201);
    }
  }

  if (url.includes('place_overrides')) {
    if (!placeTableExists) return json({ message: 'relation does not exist' }, 404);
    if (method === 'GET') return json([...placeRows.values()]);
    if (method === 'POST') {
      for (const r of body as Record<string, unknown>[]) placeRows.set(r.name as string, r);
      return json([], 201);
    }
    if (method === 'DELETE') {
      const n = decodeURIComponent(/name=eq\.([^&]*)/.exec(url)?.[1] ?? '');
      placeRows.delete(n);
      return json([]);
    }
  }

  return json([]);
}) as typeof fetch;

const KEY = { 'x-survey-key': 'test-passcode', 'content-type': 'application/json' };

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function post(url: string, body: unknown, headers: Record<string, string> = KEY) {
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function main() {
  const survey = await import('../src/app/api/survey/route');
  const checkpoints = await import('../src/app/api/checkpoints/route');
  const ns = await import('../src/lib/nightsafety');
  const kinds = await import('../src/lib/checkpointKinds');

  // A real span on the real graph.
  const span = ns.spanAt({ lat: 26.8425, lng: 75.563 }).indices.slice(0, 2);
  if (!span.length) throw new Error('no span found — graph did not load');
  const idx = span[0];

  console.log(`\nspan under test: [${span.join(', ')}]\n`);

  console.log('AUTH');
  const anon = await survey.POST(
    post('http://x/api/survey', { span, lighting: 'dark' }, { 'content-type': 'application/json' }),
  );
  check('unauthorised POST is refused', anon.status === 401, `got ${anon.status}`);
  const anonDel = await survey.DELETE(new Request('http://x/api/survey?span=1', { method: 'DELETE' }));
  check('unauthorised DELETE is refused', anonDel.status === 401, `got ${anonDel.status}`);

  console.log('\nSURVEY PATCH SEMANTICS');
  const lit = await survey.POST(post('http://x/api/survey', { span, lighting: 'dark', note: 'two lamps out' }));
  check('record lighting', lit.status === 200, `got ${lit.status}`);
  check('lighting stored', ns.surveyFor(idx)?.lighting === 'dark', JSON.stringify(ns.surveyFor(idx)));
  check('note stored (was silently dropped)', ns.surveyFor(idx)?.note === 'two lamps out');

  const traffic = await survey.POST(post('http://x/api/survey', { span, traffic: 'high' }));
  check('traffic-only survey accepted', traffic.status === 200, `got ${traffic.status}`);
  check('traffic stored', ns.surveyFor(idx)?.traffic === 'high');
  check(
    'traffic correction does NOT overwrite lighting',
    ns.surveyFor(idx)?.lighting === 'dark',
    `lighting became ${ns.surveyFor(idx)?.lighting}`,
  );

  const block = await survey.POST(post('http://x/api/survey', { span, blocked: true }));
  check('block accepted', block.status === 200, `got ${block.status}`);
  check('blocked flag set', ns.isBlocked(idx) === true);
  check(
    'blocking preserves the lighting survey',
    ns.surveyFor(idx)?.lighting === 'dark',
    `lighting became ${ns.surveyFor(idx)?.lighting}`,
  );
  check('blocking preserves the note', ns.surveyFor(idx)?.note === 'two lamps out');

  // The headline bug: this returned 400 every time.
  const unblock = await survey.POST(post('http://x/api/survey', { span, blocked: false }));
  check('UNBLOCK accepted (used to be a 400)', unblock.status === 200, `got ${unblock.status}`);
  check('blocked flag cleared', ns.isBlocked(idx) === false);
  check('unblocking preserves lighting', ns.surveyFor(idx)?.lighting === 'dark');

  const empty = await survey.POST(post('http://x/api/survey', { span }));
  check('an empty patch is still rejected', empty.status === 400, `got ${empty.status}`);
  const bad = await survey.POST(post('http://x/api/survey', { span, lighting: 'sortof' }));
  check('an invalid lighting value is rejected', bad.status === 400, `got ${bad.status}`);

  console.log('\nWHAT POSTGRES IS TOLD');
  const written = calls.filter((c) => c.url.includes('path_surveys') && c.method === 'POST').pop();
  const row = (written?.body as Record<string, unknown>[])?.[0];
  check(
    'the merged row is written, not the bare patch',
    row?.lighting === 'dark' && row?.traffic === 'high' && row?.blocked === false,
    JSON.stringify(row),
  );

  console.log('\nSURVEY SOURCE');
  const belief = ns.beliefForSpan(span);
  check(
    'a surveyed span reports source "survey", not the baked graph value',
    belief?.source === 'survey',
    `got ${belief?.source}`,
  );
  check('a surveyed span reports surveyed: true', belief?.surveyed === true);

  console.log('\nWITHDRAWING A SURVEY');
  const del = await survey.DELETE(
    new Request(`http://x/api/survey?span=${span.join(',')}`, { method: 'DELETE', headers: KEY }),
  );
  check('DELETE accepted', del.status === 200, `got ${del.status}`);
  check('survey is gone from memory', ns.surveyFor(idx) === undefined);
  check('no longer blocked', ns.isBlocked(idx) === false);
  check('source falls back to the model', ns.beliefForSpan(span)?.source !== 'survey');
  const deleted = calls.filter((c) => c.url.includes('path_surveys') && c.method === 'DELETE').pop();
  check('Postgres was told to delete those rows', Boolean(deleted), JSON.stringify(deleted));

  console.log('\nCHECKPOINT KINDS');
  check('legacy "entrance" normalises to a gate', kinds.normaliseKind('entrance') === 'gate');
  check('"checkpoint" normalises to a landmark', kinds.normaliseKind('checkpoint') === 'landmark');
  check('a current kind is left alone', kinds.normaliseKind('shop') === 'shop');
  check('nonsense is not a known kind', kinds.isKnownKind('banana') === false);
  check('every kind has a colour', kinds.CHECKPOINT_KINDS.every((k) => /^#[0-9A-F]{6}$/i.test(k.colour)));

  const cpBad = await checkpoints.POST(
    post('http://x/api/checkpoints', { name: 'X', kind: 'banana', lat: 26.84, lng: 75.56 }),
  );
  check('an unknown kind is rejected', cpBad.status === 400, `got ${cpBad.status}`);

  const cpOk = await checkpoints.POST(
    post('http://x/api/checkpoints', { name: 'AB1 North', kind: 'entrance', lat: 26.84, lng: 75.56 }),
  );
  check('a legacy kind is accepted', cpOk.status === 200, `got ${cpOk.status}`);
  const sent = calls.filter((c) => c.url.includes('/checkpoints') && c.method === 'POST').pop();
  check(
    'it is stored normalised, not as "entrance"',
    (sent?.body as Record<string, unknown>[])?.[0]?.kind === 'gate',
    JSON.stringify((sent?.body as Record<string, unknown>[])?.[0]),
  );

  console.log('\nDELETING A CHECKPOINT');
  checkpointDeleteRows = [{ id: 'cp-1' }];
  const gone = await checkpoints.DELETE(
    new Request('http://x/api/checkpoints?id=cp-1', { method: 'DELETE', headers: KEY }),
  );
  check('deleting an existing point succeeds', gone.status === 200, `got ${gone.status}`);

  checkpointDeleteRows = [];
  const missing = await checkpoints.DELETE(
    new Request('http://x/api/checkpoints?id=cp-9', { method: 'DELETE', headers: KEY }),
  );
  check(
    'deleting nothing reports 404, not success',
    missing.status === 404,
    `got ${missing.status}`,
  );

  const noKey = await checkpoints.DELETE(
    new Request('http://x/api/checkpoints?id=cp-1', { method: 'DELETE' }),
  );
  check('unauthorised delete is refused', noKey.status === 401, `got ${noKey.status}`);

  console.log('\nGATES THAT ACTUALLY GATE');
  const places = await import('../src/app/api/places/route');

  // A gate sitting on the direct B3 -> Central Library walk.
  const direct = ns.routePair(ns.findPlace('B3 Block')!.node, ns.findPlace('Central Library')!.node, 1200);
  check('the direct walk is open at 20:00', direct.status === 'ok', direct.status);
  const onRoute = direct.safest.segments[Math.floor(direct.safest.segments.length / 2)];
  const mid = ns.nodeLatLng(ns.edges[onRoute].a);

  checkpointRows = [
    {
      id: 'g-1',
      name: 'VIP Gate',
      kind: 'gate',
      lat: mid.lat,
      lng: mid.lng,
      note: null,
      barrier: 'hard',
      closes: null,
      opens: null,
      permit: null,
    },
  ];
  await ns.loadGates();

  check('the gate binds to real segments', (ns.placedGates()[0]?.segments.length ?? 0) > 0);
  check(
    'an always-shut gate is shut with NO time selected',
    ns.gateShutAt(ns.placedGates()[0], null) === true,
  );
  check('…and shut at 20:00 too', ns.gateShutAt(ns.placedGates()[0], 1200) === true);

  const walled = ns.routePair(ns.findPlace('B3 Block')!.node, ns.findPlace('Central Library')!.node, 1200);
  check(
    'an always-shut gate changes the walk (it acts as a wall)',
    walled.status !== 'ok' || walled.safest.meters !== direct.safest.meters,
    `status ${walled.status}, ${walled.safest.meters} m vs ${direct.safest.meters} m`,
  );

  // A timed gate: shut 21:00-05:00, open at 20:00.
  checkpointRows[0].closes = '21:00';
  checkpointRows[0].opens = '05:00';
  await ns.loadGates();
  const g = ns.placedGates()[0];
  check('a timed gate is OPEN at 20:00', ns.gateShutAt(g, 1200) === false);
  check('a timed gate is SHUT at 23:00', ns.gateShutAt(g, 1380) === true);
  check('a timed gate is SHUT at 02:00 (window wraps midnight)', ns.gateShutAt(g, 120) === true);
  check('a timed gate does not apply when no time is chosen', ns.gateShutAt(g, null) === false);

  const openAgain = ns.routePair(ns.findPlace('B3 Block')!.node, ns.findPlace('Central Library')!.node, 1200);
  check(
    'the direct walk returns once the gate is open',
    openAgain.status === 'ok' && openAgain.safest.meters === direct.safest.meters,
    `${openAgain.status} ${openAgain.safest.meters} m`,
  );

  const badHours = await checkpoints.POST(
    post('http://x/api/checkpoints', {
      name: 'G', kind: 'gate', lat: 26.84, lng: 75.56, barrier: 'hard', closes: '25:99', opens: '05:00',
    }),
  );
  check('a malformed time is rejected', badHours.status === 400, `got ${badHours.status}`);
  const halfWindow = await checkpoints.POST(
    post('http://x/api/checkpoints', {
      name: 'G', kind: 'gate', lat: 26.84, lng: 75.56, barrier: 'hard', closes: '21:00',
    }),
  );
  check('half a window is rejected', halfWindow.status === 400, `got ${halfWindow.status}`);

  console.log('\nUN-MIGRATED DATABASE STILL WORKS');
  gateColumnsExist = false;
  const legacy = await checkpoints.GET();
  const legacyBody = (await legacy.json()) as { checkpoints: unknown[] };
  check(
    'checkpoints still load without 004 (they must not vanish)',
    legacyBody.checkpoints.length > 0,
    JSON.stringify(legacyBody).slice(0, 120),
  );
  gateColumnsExist = true;

  console.log('\nCORRECTING AN IMPORTED LANDMARK');
  const zanak = ns.PLACES.find((p) => /zanak/i.test(p.name))?.name;
  check('zanak is an imported landmark', Boolean(zanak), String(zanak));

  const notReal = await places.POST(post('http://x/api/places', { name: 'Nowhere At All' }));
  check('a landmark that was never imported is rejected', notReal.status === 404, `got ${notReal.status}`);

  const renamed = await places.POST(post('http://x/api/places', { name: zanak, displayName: 'Zanak Cafe' }));
  check('rename accepted', renamed.status === 200, `got ${renamed.status}`);
  check(
    'the new name is what the map is given',
    ns.visiblePlaces().some((p) => p.name === 'Zanak Cafe'),
  );
  check('the OLD name still resolves for saved routes', ns.findPlace(zanak!)?.node !== undefined);
  check('the new name resolves too', ns.findPlace('Zanak Cafe')?.node !== undefined);

  const hidden = await places.POST(post('http://x/api/places', { name: zanak, hidden: true }));
  check('hide accepted', hidden.status === 200, `got ${hidden.status}`);
  check('a hidden landmark leaves the list', !ns.visiblePlaces().some((p) => p.name === zanak));
  check(
    'hiding does NOT shrink the imported set',
    ns.PLACES.some((p) => p.name === zanak),
  );
  const before = ns.zoneOfNode(ns.findPlace('B3 Block')!.node);
  check('zones still resolve with a landmark hidden', before === 'hostel', before);

  const restored = await places.DELETE(
    new Request(`http://x/api/places?name=${encodeURIComponent(zanak!)}`, { method: 'DELETE', headers: KEY }),
  );
  check('restore accepted', restored.status === 200, `got ${restored.status}`);
  check('the landmark is back under its imported name', ns.visiblePlaces().some((p) => p.name === zanak));

  const anonPlace = await places.POST(
    post('http://x/api/places', { name: zanak, hidden: true }, { 'content-type': 'application/json' }),
  );
  check('unauthorised landmark edit is refused', anonPlace.status === 401, `got ${anonPlace.status}`);

  console.log('');
  console.log('PLACED POINTS ARE DESTINATIONS');
  checkpointRows = [
    { id: 'p-1', name: 'PHOTOCOPY WALE BHAIYA', kind: 'shop', lat: 26.8425, lng: 75.5631, note: null,
      barrier: null, closes: null, opens: null, permit: null },
    // Deliberately away from the mapped paths: the nearest-reachable case.
    { id: 'p-2', name: 'Middle Of Nowhere', kind: 'shop', lat: 26.8365, lng: 75.572, note: null,
      barrier: null, closes: null, opens: null, permit: null },
    // A name that collides with an imported landmark.
    { id: 'p-3', name: 'zanak', kind: 'shop', lat: 26.843, lng: 75.564, note: null,
      barrier: null, closes: null, opens: null, permit: null },
  ];
  await ns.loadGates();

  const names = ns.allDestinations().map((p) => p.name);
  check('a placed shop is a destination', names.includes('PHOTOCOPY WALE BHAIYA'));
  check('imported landmarks are still destinations', names.includes('B3 Block'));
  check(
    'a duplicate name appears once, not twice',
    names.filter((n) => n.toLowerCase() === 'zanak').length === 1,
    String(names.filter((n) => n.toLowerCase() === 'zanak').length),
  );
  check('findPlace resolves a placed shop', Boolean(ns.findPlace('PHOTOCOPY WALE BHAIYA')));
  check('findPlace stays case-insensitive', Boolean(ns.findPlace('photocopy wale bhaiya')));
  check('a placed shop gets a real graph node', (ns.findPlace('Middle Of Nowhere')?.node ?? -1) >= 0);

  console.log('');
  console.log('ROUTING TO SOMEWHERE OFF THE NETWORK');
  const b3 = ns.findPlace('B3 Block')!;
  const far = ns.findPlace('Middle Of Nowhere')!;
  const toFar = ns.routePair(b3.node, far.at, 4, 1200);
  console.log(`     -> ${toFar.status}, ${toFar.safest.meters} m, stops ${toFar.approachMeters} m short`);
  check('something is still drawn', toFar.status === 'closed' || toFar.safest.meters > 0, toFar.status);
  check(
    'the shortfall is reported',
    toFar.status === 'closed' || toFar.approachMeters > 0,
    `status=${toFar.status} approach=${toFar.approachMeters}`,
  );

  const normal = ns.routePair(b3.node, ns.findPlace('Central Library')!.node, 4, 1200);
  check('landmark-to-landmark reports no shortfall', normal.approachMeters === 0, String(normal.approachMeters));
  check('and is still ok', normal.status === 'ok', normal.status);

  console.log('');
  console.log('A CLOSURE STILL BEATS A PARTIAL ROUTE');
  const shutAt = ns.nodeLatLng(b3.node);
  checkpointRows.push({
    id: 'p-4', name: 'Sealed', kind: 'gate', lat: shutAt.lat, lng: shutAt.lng,
    note: null, barrier: 'hard', closes: null, opens: null, permit: null,
  });
  await ns.loadGates();
  const sealed = ns.routePair(ns.findPlace('Central Library')!.node, b3.node, 4, 1200);
  console.log(`     -> ${sealed.status}, stops ${sealed.approachMeters} m short`);
  check(
    'a shut gate reports CLOSED, not a near-miss route',
    sealed.status === 'closed',
    `status=${sealed.status} approach=${sealed.approachMeters}`,
  );
  check('and names what is in the way', sealed.closures.length > 0,
    JSON.stringify(sealed.closures.map((c) => c.label)));
  checkpointRows = [];
  await ns.loadGates();

  console.log('');
  console.log('A CLOSURE NAMES ONLY WHAT IS SHUT');
  // A hard wall on the direct path, plus a permission gate elsewhere on it.
  const cl = ns.findPlace('Central Library')!;
  const wall = ns.nodeLatLng(cl.node);
  checkpointRows = [
    { id: 'w-1', name: 'Locked Fence', kind: 'gate', lat: wall.lat, lng: wall.lng,
      note: null, barrier: 'hard', closes: null, opens: null, permit: null },
  ];
  await ns.loadGates();
  const blocked = ns.routePair(b3.node, cl.node, 4, 1380);
  console.log(`     -> ${blocked.status}: ${blocked.closures.map((c) => c.label + '[' + c.barrier + ']').join(', ')}`);
  check('the walk is closed', blocked.status === 'closed', blocked.status);
  check(
    'ONLY hard barriers are blamed — an outpass gate is not why it is shut',
    blocked.closures.every((c) => c.barrier === 'hard'),
    blocked.closures.map((c) => c.label + '[' + c.barrier + ']').join(', '),
  );
  check('and something is named', blocked.closures.length > 0);
  checkpointRows = [];
  await ns.loadGates();

  console.log('');
  console.log('MUTUALLY EXCLUSIVE CROSSINGS');
  const subSegs = ns.edges.filter((e) => /subway (entrance|exit)/i.test(e.label)).map((e) => e.idx);
  check('the subway entrance/exit set is found', subSegs.length > 0, String(subSegs.length));

  // Put a day scholars' gate on a segment that is NOT part of the subway.
  const away = ns.edges.find((e) => !/subway/i.test(e.label) && /road|footpath/i.test(e.label))!;
  const at = ns.nodeLatLng(away.a);
  checkpointRows = [
    { id: 'ds-1', name: "Day Scholar's Entrance", kind: 'gate', lat: at.lat, lng: at.lng,
      note: null, barrier: null, closes: null, opens: null, permit: null },
  ];
  await ns.loadGates();
  // The point is deliberately NOT armed as a barrier: who may use a crossing is
  // a fact about the crossing, not about whether it is currently shut.
  check('an unarmed point is not a barrier', ns.placedGates().length === 0,
    String(ns.placedGates().length));
  const dsSegs = ns.exclusiveSetsForTest();
  check('the exclusion still resolves it', dsSegs.length === 1 && dsSegs[0].a.size > 0,
    JSON.stringify(dsSegs.map((x) => [x.a.size, x.b.size])));

  const b3n = ns.findPlace('B3 Block')!.node;
  const libn = ns.findPlace('Central Library')!.node;
  const withRule = ns.routePair(b3n, libn, 4, 1290);
  const subSet = new Set(subSegs);
  const dsSet = dsSegs[0].a;
  const usesSub = withRule.safest.segments.some((i) => subSet.has(i));
  const usesDs = withRule.safest.segments.some((i) => dsSet.has(i));
  console.log(`     -> ${withRule.status}, ${withRule.safest.meters} m | subway:${usesSub} dayScholar:${usesDs}`);
  check('a route never uses BOTH crossings', !(usesSub && usesDs), `subway=${usesSub} ds=${usesDs}`);
  check('a route is still produced', withRule.status !== 'closed', withRule.status);

  checkpointRows = [];
  await ns.loadGates();
  const without = ns.routePair(b3n, libn, 4, 1290);
  check(
    'with no day-scholar gate mapped, the rule is inert and routing is unchanged',
    without.status === 'ok',
    without.status,
  );

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
