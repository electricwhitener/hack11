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
    if (method === 'DELETE') return json(checkpointDeleteRows);
    if (method === 'POST') return json([{ id: 'cp-1', ...(body as object[])[0] }], 201);
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

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
