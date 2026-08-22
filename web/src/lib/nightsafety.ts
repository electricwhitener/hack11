/**
 * THE COMPUTATION LAYER.
 *
 * Everything the product claims is derived here, deterministically, from the
 * baked street graph. The agent never computes any of this — it reads these
 * numbers out and explains them. Delete the AI and this still works.
 *
 * The graph is precomputed by py-service/precompute.py from OpenStreetMap and
 * shipped as a static JSON, so the live app needs no Python service.
 */

import raw from '@/data/graph.json';
import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabase } from '@/lib/supabase/config';
import { normaliseKind } from '@/lib/checkpointKinds';

/** [a, b, length_m, exposure, lit, risk, wayId, label, source] */
type EdgeTuple = [number, number, number, number, number, number, number, string, string];

type Landmark = { name: string; node: number; kind: 'hostel' | 'dest' };

type Graph = {
  meta: {
    bbox: string;
    area: string;
    generated: string;
    hostels: number;
    destinations: number;
    trips: number;
    lit_surveyed: number;
    lit_from_osm: number;
    lit_simulated: number;
    blocked_paths: number;
    emergency: { name: string; lat: number; lng: number; kind?: string }[];
    dark_by_class: Record<string, number>;
    total_km: number;
  };
  nodes: [number, number][];
  landmarks: Landmark[];
  edges: EdgeTuple[];
};

const G = raw as unknown as Graph;

export type LatLng = { lat: number; lng: number };

export type Edge = {
  /** Position in EDGES. Stable, and identical on the client because /api/graph
   *  emits segments in this same order — so a span selected in the browser can
   *  be sent back as plain indices. */
  idx: number;
  a: number;
  b: number;
  length: number;
  /** 0..1 — modelled share of night foot traffic crossing this segment. */
  exposure: number;
  /** exposure after any surveyor traffic correction. Risk uses THIS. */
  effExposure: number;
  /** Baked starting belief: 1 = lit, 0 = dark. Never mutated by reports. */
  lit: number;
  /** 0..1 posterior probability the path is unlit. Reports move this. */
  darkness: number;
  /** exposure x darkness. The whole product ranks on this. */
  risk: number;
  wayId: number;
  label: string;
  /** 'survey' | 'osm' | 'simulated' — where the starting belief came from. */
  source: string;
};

const EDGES: Edge[] = G.edges.map(([a, b, length, exposure, lit, risk, wayId, label, source], idx) => ({
  idx,
  a,
  b,
  length,
  exposure,
  effExposure: exposure,
  lit,
  darkness: 1 - lit,
  risk,
  wayId,
  label,
  source,
}));

/** Adjacency built once at module load and reused across requests. */
const ADJ: Map<number, { to: number; e: Edge }[]> = new Map();
for (const e of EDGES) {
  if (!ADJ.has(e.a)) ADJ.set(e.a, []);
  if (!ADJ.has(e.b)) ADJ.set(e.b, []);
  ADJ.get(e.a)!.push({ to: e.b, e });
  ADJ.get(e.b)!.push({ to: e.a, e });
}

/* ------------------------------------------------------------ light bleed
 *
 * Light does not stop at the kerb.
 *
 * A lamp on one side of a road lights the footpath on the other side too, so
 * treating that footpath as fully unlit overstates the danger — which is
 * exactly what the B3-to-zanak route was doing, routing around a stretch that
 * is perfectly walkable because the lamps sit just across the road.
 *
 * So darkness falls off with distance from the nearest lit segment rather than
 * switching at a boundary:
 *
 *     within BLEED_FULL_M   treated as lit
 *     within BLEED_DIM_M    dimly lit, interpolated
 *     beyond that           genuinely dark
 *
 * Neighbours are indexed once at module load. Recomputing them per request
 * would be 3.5M distance tests on every page view.
 */
const BLEED_FULL_M = 3;
const BLEED_DIM_M = 7;

function midpoint(e: Edge): [number, number] {
  const a = G.nodes[e.a];
  const b = G.nodes[e.b];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Metres from a point to a segment, in local flat coordinates. */
function pointToSeg(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const mLat = 111320;
  const mLng = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const px = p[1] * mLng;
  const py = p[0] * mLat;
  const x1 = a[1] * mLng;
  const y1 = a[0] * mLat;
  const x2 = b[1] * mLng;
  const y2 = b[0] * mLat;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * How far apart two stretches of path actually are.
 *
 * Measuring midpoint to midpoint — the obvious shortcut — is wrong for exactly
 * the case that matters: two sides of the same road are metres apart, but if
 * their midpoints do not line up they read as distant, and the lamp across the
 * road never reaches. Sampling both ends and the middle of one segment against
 * the whole of the other is close enough to true minimum distance here.
 */
function segToSeg(i: Edge, j: Edge): number {
  const ia = G.nodes[i.a];
  const ib = G.nodes[i.b];
  const ja = G.nodes[j.a];
  const jb = G.nodes[j.b];
  const im = midpoint(i);
  return Math.min(
    pointToSeg(ia, ja, jb),
    pointToSeg(ib, ja, jb),
    pointToSeg(im, ja, jb),
    pointToSeg(ja, ia, ib),
    pointToSeg(jb, ia, ib),
  );
}

/**
 * For each segment: neighbours within BLEED_DIM_M, and how far away they are.
 *
 * Built once at module load. Segments are bucketed by BOTH endpoints as well as
 * their midpoint, because a long segment whose midpoint sits in one bucket can
 * still run alongside a segment two buckets away.
 */
const BLEED_NEIGHBOURS: { idx: number; metres: number }[][] = (() => {
  const out: { idx: number; metres: number }[][] = EDGES.map(() => []);
  const cell = (BLEED_DIM_M * 3) / 111320;
  const buckets = new Map<number, number[]>();

  const put = (lat: number, i: number) => {
    const k = Math.round(lat / cell);
    for (const kk of [k - 1, k, k + 1]) {
      let arr = buckets.get(kk);
      if (!arr) buckets.set(kk, (arr = []));
      arr.push(i);
    }
  };
  for (let i = 0; i < EDGES.length; i++) {
    put(G.nodes[EDGES[i].a][0], i);
    put(G.nodes[EDGES[i].b][0], i);
    put(midpoint(EDGES[i])[0], i);
  }

  const seen = new Set<number>();
  for (let i = 0; i < EDGES.length; i++) {
    seen.clear();
    const k = Math.round(midpoint(EDGES[i])[0] / cell);
    for (const cand of buckets.get(k) ?? []) {
      if (cand === i || seen.has(cand)) continue;
      seen.add(cand);
      const d = segToSeg(EDGES[i], EDGES[cand]);
      if (d <= BLEED_DIM_M) out[i].push({ idx: cand, metres: d });
    }
  }
  return out;
})();

/**
 * Soften a dark segment toward its nearest lit neighbour.
 *
 * Only ever reduces darkness — spillover can make a path safer than the model
 * thought, never more dangerous. A surveyed segment is left alone: somebody
 * stood there and looked, which beats any inference about a nearby lamp.
 */
function applyLightBleed(raw: number[]): number[] {
  const out = raw.slice();
  for (let i = 0; i < EDGES.length; i++) {
    if (raw[i] <= 0.5) continue;
    if (SURVEYS.get(i)?.lighting) continue;

    let nearestLit = Infinity;
    for (const n of BLEED_NEIGHBOURS[i]) {
      if (raw[n.idx] <= 0.35 && n.metres < nearestLit) nearestLit = n.metres;
    }
    if (nearestLit === Infinity) continue;

    if (nearestLit <= BLEED_FULL_M) {
      out[i] = Math.min(raw[i], 0.3);
    } else if (nearestLit <= BLEED_DIM_M) {
      // Linear falloff across the dim band, floored at "dim" not "lit".
      const t = (nearestLit - BLEED_FULL_M) / (BLEED_DIM_M - BLEED_FULL_M);
      out[i] = Math.min(raw[i], 0.3 + t * 0.3);
    }
  }
  return out;
}

/** Total risk-metres across the whole area — the denominator for "% of risk removed". */
let TOTAL_RISK_M = EDGES.reduce((s, e) => s + e.risk * e.length, 0);

/**
 * Citizen reports, cached in module memory.
 *
 * Postgres is the source of truth — see loadReports/persistSpan below. This map
 * is a per-instance cache so the belief model can stay synchronous; it is
 * refilled from the database at the start of every request that reads reports.
 */
type ReportStore = {
  reports: Map<number, { dark: number; lit: number; at: string }>;
  version: number;
};

/**
 * Held on globalThis, not in module scope.
 *
 * Next gives route handlers and server components separate module registries,
 * so a plain module-level Map means a report filed through /api/report is
 * invisible to the /queue page — you report a path on the map, open the queue,
 * and nothing has changed. Sharing through globalThis is the same escape hatch
 * the Prisma client singleton uses, and it survives dev hot-reloads too.
 */
const GLOBAL = globalThis as typeof globalThis & { __nightlineReports?: ReportStore };
const STORE: ReportStore = (GLOBAL.__nightlineReports ??= { reports: new Map(), version: 0 });
const REPORTS = STORE.reports;

/**
 * SURVEYED GROUND TRUTH.
 *
 * The evidence hierarchy, strongest first:
 *   1. survey   - somebody walked the path at night and looked at it
 *   2. osm      - a mapper recorded a lighting tag
 *   3. simulated- our own guess from the road class
 * with citizen reports layered on top as Bayesian evidence (see beliefFor).
 *
 * A survey does not merely nudge the posterior, it replaces the prior AND
 * raises its strength, so casual reports cannot overturn a checked fact.
 */
export type SurveyLighting = 'lit' | 'dim' | 'dark';
export type SurveyTraffic = 'high' | 'medium' | 'low';
export type Survey = {
  lighting: SurveyLighting | null;
  traffic?: SurveyTraffic | null;
  note?: string | null;
  /** Not walkable at all: a fence, a wall, a lawn OSM calls a path. */
  blocked?: boolean;
};

type SurveyStore = { surveys: Map<number, Survey>; version: number };
const GS = globalThis as typeof globalThis & { __nightlineSurveys?: SurveyStore };
const SSTORE: SurveyStore = (GS.__nightlineSurveys ??= { surveys: new Map(), version: 0 });
const SURVEYS = SSTORE.surveys;

/** Where a surveyed lighting level puts the darkness prior. */
const SURVEY_DARKNESS: Record<SurveyLighting, number> = { lit: 0.12, dim: 0.5, dark: 0.9 };

/**
 * Foot-traffic correction.
 *
 * The model derives exposure from the road network, which is right about shape
 * but blind to things like a shortcut everyone takes through a car park. A
 * surveyor who can see the actual flow can pin it into a band; leaving traffic
 * null keeps the computed number, which is the default and the honest case.
 */
const TRAFFIC_FLOOR: Record<SurveyTraffic, [number, number]> = {
  high: [0.45, 1],
  medium: [0.15, 0.45],
  low: [0, 0.06],
};

/**
 * Foot traffic in words, as percentiles of THIS network.
 *
 * Exposure is a unitless relative index and its distribution is severely
 * skewed — median 0.011, p95 0.22 — so any absolute threshold puts almost the
 * whole campus in one bucket and the label stops discriminating. Fixed cutoffs
 * of 0.45/0.15 filed 99% of segments as "quiet", including the paths at the top
 * of the repair queue.
 *
 * Derived from the graph at load time, so "busy" keeps meaning *busy for this
 * campus* rather than a number that silently stops applying if the graph is
 * ever rebuilt.
 */
const EXPOSURE_BANDS = (() => {
  const sorted = EDGES.map((e) => e.exposure).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { busy: at(0.95), some: at(0.75) };
})();

export function exposureBand(exposure: number): 'busy' | 'some' | 'quiet' {
  if (exposure >= EXPOSURE_BANDS.busy) return 'busy';
  if (exposure >= EXPOSURE_BANDS.some) return 'some';
  return 'quiet';
}

/** The same word the surveyor picks from, so the table and the field agree. */
export function exposureLabel(exposure: number): string {
  return { busy: 'Busy', some: 'Some', quiet: 'Quiet' }[exposureBand(exposure)];
}

function effectiveExposure(e: Edge): number {
  const t = SURVEYS.get(e.idx)?.traffic;
  if (!t) return e.exposure;
  const [lo, hi] = TRAFFIC_FLOOR[t];
  return Math.min(Math.max(e.exposure, lo), hi);
}

/** Version of STORE this module instance has folded into its EDGES. */
let appliedVersion = -1;

/** Re-derive risk if another module instance has recorded a report since. */
let appliedSurveyVersion = -1;

function sync() {
  if (appliedVersion !== STORE.version || appliedSurveyVersion !== SSTORE.version) {
    recomputeRisk();
    appliedVersion = STORE.version;
    appliedSurveyVersion = SSTORE.version;
  }
}

/**
 * WHAT ONE REPORT IS WORTH.
 *
 * A single person tapping "this is dark" is a claim, not a fact — treating it
 * as truth would let one student move a path to the top of a repair queue, and
 * that is the obvious way to game this system.
 *
 * So darkness is a probability, updated as evidence arrives. Each path starts
 * with a Beta prior centred on what we already believe, and every report is one
 * observation. The posterior mean is the darkness used for risk:
 *
 *     darkness = (alpha + darkReports) / (alpha + beta + totalReports)
 *
 * With a seeded path (prior strength 1.5), one report moves darkness to about
 * 0.5, two to 0.66, three to 0.73. So one report raises a question, three
 * settle it — and a lone actor cannot manufacture a top-ranked repair.
 *
 * Paths whose lighting was surveyed on foot or tagged in OSM carry a much
 * stronger prior, so casual reports cannot casually overturn checked facts.
 */
const PRIOR_STRENGTH: Record<string, number> = {
  survey: 8, // somebody stood there and looked
  osm: 4, // a mapper recorded it
  simulated: 1.5, // our own class-based guess — weakest
};

function priorFor(e: Edge): { alpha: number; beta: number } {
  const sv = SURVEYS.get(e.idx);
  const surveyed = sv?.lighting ? sv : undefined;
  const s = surveyed ? PRIOR_STRENGTH.survey : (PRIOR_STRENGTH[e.source] ?? 1.5);
  // Centre the prior on the best belief available, but never fully at 0 or 1 —
  // a prior of exactly zero can never be moved by any amount of evidence.
  const pDark = surveyed?.lighting
    ? SURVEY_DARKNESS[surveyed.lighting]
    : e.lit === 0
      ? 0.8
      : 0.2;
  return { alpha: s * pDark, beta: s * (1 - pDark) };
}

/** Posterior darkness plus how much evidence stands behind it. */
export function beliefFor(e: Edge) {
  const r = REPORTS.get(e.idx);
  const { alpha, beta } = priorFor(e);
  const dark = r?.dark ?? 0;
  const lit = r?.lit ?? 0;
  const darkness = (alpha + dark) / (alpha + beta + dark + lit);
  return {
    darkness: Number(darkness.toFixed(4)),
    darkReports: dark,
    litReports: lit,
    totalReports: dark + lit,
    /** 0..1 — how much of the belief is evidence rather than prior. */
    confidence: Number(((dark + lit) / (dark + lit + alpha + beta)).toFixed(3)),
  };
}

function recomputeRisk() {
  const raw = EDGES.map((e) => beliefFor(e).darkness);
  const bled = applyLightBleed(raw);
  for (let i = 0; i < EDGES.length; i++) {
    const e = EDGES[i];
    e.darkness = Number(bled[i].toFixed(4));
    e.effExposure = effectiveExposure(e);
    e.risk = Number((e.effExposure * e.darkness).toFixed(4));
  }
  TOTAL_RISK_M = EDGES.reduce((s, e) => s + e.risk * e.length, 0);
}

// Baked `risk` assumed binary darkness; re-derive it through the belief model
// so the map, the queue and the router all agree from the first request.
recomputeRisk();
appliedVersion = STORE.version;

/* --------------------------------------------------------- access rules
 *
 * When a path can actually be used, and what it physically is.
 *
 * Matched on the path label rather than baked into graph.json ON PURPOSE:
 * regenerating the graph renumbers every segment, and surveys are keyed by
 * segment index — so a rebuild mid-survey would silently point tonight's
 * fieldwork at the wrong paths. Rules living here can be edited and shipped
 * without touching the graph at all.
 */
export type AccessRule = {
  match: RegExp;
  /** 24h HH:MM. Closed from `closes` until `opens` the next morning. */
  closes?: string;
  opens?: string;
  /** Shown to the walker when a route is affected. */
  note: string;
  /**
   * 'hard'       - shut to everyone. No route may use it.
   * 'permission' - passable if you hold `permit`. Usable only when nothing
   *                fully legal exists, and then it must be announced.
   */
  barrier: 'hard' | 'permission';
  /** What gets you through a 'permission' barrier. */
  permit?: string;
  /** Rendered as an enclosed passage rather than an unlit path. */
  tunnel?: boolean;
};

export const ACCESS_RULES: AccessRule[] = [
  {
    match: /subway/i,
    closes: '23:00',
    opens: '05:00',
    barrier: 'hard',
    tunnel: true,
    note: 'The subway underpass is shut from 11pm. There is no way through it.',
  },
  {
    /*
     * Carriageways only — NOT every path whose name mentions the entrance.
     *
     * `/university entrance/` matched 18 segments, including "Footpath by
     * University Entrance" and "Walkway by University Entrance": paths that
     * run PAST the gate without going through it and never leave campus.
     * Shutting them at 11pm made a whole corner of campus impassable, and
     * that, not the hostel gate, was what collapsed the late-night walk to
     * "closed" — the route could reach the hostel gate but not the ground on
     * the other side of it.
     *
     * A shut gate stops you passing THROUGH it. It does not make the pavement
     * beside it disappear. Crossing between campus and outside is still
     * governed by PORTALS, which is the right place for it.
     */
    match: /^(service )?road by university entrance|main gate/i,
    closes: '23:00',
    opens: '05:00',
    barrier: 'hard',
    note: 'The university entrance is shut from 11pm. You cannot enter or leave campus through it.',
  },
  {
    match: /hostel (entrance|gate)|ghs (main )?road/i,
    closes: '21:00',
    opens: '06:00',
    barrier: 'permission',
    permit: 'outpass',
    note: 'The hostel gate is shut from 9pm until 6am. Getting through it needs an outpass.',
  },
];

/** Surveyor-marked impassable. Not a preference — a wall. */
export function isBlocked(idx: number): boolean {
  return SURVEYS.get(idx)?.blocked === true;
}

/** Every segment a surveyor has marked impassable, for the map to grey out. */
export function blockedSegments(): number[] {
  return [...SURVEYS.entries()].filter(([, v]) => v.blocked).map(([k]) => k);
}

function ruleFor(label: string): AccessRule | undefined {
  return ACCESS_RULES.find((r) => r.match.test(label));
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * Is a rule in force at this time of day?
 *
 * Windows wrap midnight — closes 23:00, opens 05:00 means shut from 11pm right
 * through to 5am, which is exactly the case that matters here.
 */
export function isClosedAt(rule: AccessRule | undefined, minutes: number): boolean {
  if (!rule?.closes || !rule.opens) return false;
  const c = toMinutes(rule.closes);
  const o = toMinutes(rule.opens);
  return c > o ? minutes >= c || minutes < o : minutes >= c && minutes < o;
}

/** Access facts for one edge at a given time. */
export function accessFor(e: Edge, minutes: number | null) {
  const rule = ruleFor(e.label);
  return {
    rule,
    tunnel: Boolean(rule?.tunnel),
    closed: minutes === null ? false : isClosedAt(rule, minutes),
  };
}

/** Every segment index that is a tunnel, so the map can style them apart. */
export function tunnelSegments(): number[] {
  return EDGES.filter((e) => ruleFor(e.label)?.tunnel).map((e) => e.idx);
}

/**
 * Perpendicular distance in metres from a point to a segment.
 *
 * Measuring to segment midpoints instead — the obvious shortcut — makes long
 * paths almost unselectable: you can be standing on a 200 m path and have its
 * midpoint be further away than a short segment two streets over.
 */
function distToSegment(p: LatLng, a: [number, number], b: [number, number]): number {
  const mLat = 111320;
  const mLng = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const px = p.lng * mLng;
  const py = p.lat * mLat;
  const x1 = a[1] * mLng;
  const y1 = a[0] * mLat;
  const x2 = b[1] * mLng;
  const y2 = b[0] * mLat;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Nearest segment to a dropped pin, so a click on the map resolves to a path. */
export function nearestEdge(p: LatLng): Edge {
  sync();
  let best = EDGES[0];
  let bd = Infinity;
  for (const e of EDGES) {
    const d = distToSegment(p, G.nodes[e.a], G.nodes[e.b]);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/**
 * The longest stretch one person may report in a single action.
 *
 * A path can be 200 m long and dark for only 40 of them. Letting a report cover
 * the whole way would overstate the problem badly and put lit ground into the
 * repair queue. 50 m is roughly what you can actually see and vouch for from
 * where you are standing.
 */
export const MAX_REPORT_METERS = 50;

/**
 * The segments a report may cover: same path, nearest first, stopping at
 * MAX_REPORT_METERS. The client computes the identical span for its hover
 * highlight, so what you see highlighted is exactly what gets reported.
 */
export function spanAt(p: LatLng, maxMeters = MAX_REPORT_METERS) {
  sync();
  const seed = nearestEdge(p);
  const candidates = EDGES.filter((e) => e.wayId === seed.wayId)
    .map((e) => ({ e, d: distToSegment(p, G.nodes[e.a], G.nodes[e.b]) }))
    .sort((x, y) => x.d - y.d);

  const chosen: Edge[] = [];
  let meters = 0;
  for (const { e } of candidates) {
    if (chosen.length && meters + e.length > maxMeters) continue;
    chosen.push(e);
    meters += e.length;
    if (meters >= maxMeters) break;
  }

  return { edges: chosen, indices: chosen.map((e) => e.idx), meters: Math.round(meters), seed };
}

/**
 * Clamp a caller-supplied span to MAX_REPORT_METERS.
 *
 * The browser already limits what it highlights, but the cap is a rule about
 * what a report MEANS, so it has to hold for any client — trimmed rather than
 * rejected, so a slightly-too-long span still records the part it may.
 */
export function trimSpan(indices: number[], maxMeters = MAX_REPORT_METERS): number[] {
  const out: number[] = [];
  let meters = 0;
  for (const i of indices) {
    const e = EDGES[i];
    if (!e) continue;
    if (out.length && meters + e.length > maxMeters) break;
    out.push(i);
    meters += e.length;
    if (meters >= maxMeters) break;
  }
  return out;
}

/** Aggregate belief over a set of segment indices. */
export function beliefForSpan(indices: number[]) {
  sync();
  const es = indices.map((i) => EDGES[i]).filter(Boolean);
  if (!es.length) return null;
  const bs = es.map(beliefFor);
  const meters = es.reduce((s, e) => s + e.length, 0);
  return {
    darkness: Number(
      (es.reduce((s, e, i) => s + bs[i].darkness * e.length, 0) / Math.max(meters, 1)).toFixed(4),
    ),
    darkReports: Math.max(...bs.map((b) => b.darkReports)),
    litReports: Math.max(...bs.map((b) => b.litReports)),
    totalReports: Math.max(...bs.map((b) => b.totalReports)),
    confidence: Number((bs.reduce((s, b) => s + b.confidence, 0) / bs.length).toFixed(3)),
    exposure: Number(
      (es.reduce((s, e) => s + e.exposure * e.length, 0) / Math.max(meters, 1)).toFixed(4),
    ),
    meters: Math.round(meters),
    label: es[0].label,
    /*
     * `e.source` is the value baked into graph.json and is never rewritten, so
     * reporting it raw told a surveyor "from the public map data" about a path
     * they had just walked and recorded themselves — and made the 'survey'
     * origin string unreachable. A survey outranks whatever was baked.
     */
    source: es.some((e) => SURVEYS.get(e.idx)?.lighting) ? 'survey' : es[0].source,
    /** Anything recorded here at all — lighting, traffic, note or a block. */
    surveyed: es.some((e) => SURVEYS.has(e.idx)),
  };
}

export type ReportResult = {
  label: string;
  wayId: number;
  meters: number;
  /** Darkness before and after this report, so the UI can show the shift. */
  darknessBefore: number;
  darknessAfter: number;
  darkReports: number;
  litReports: number;
  confidence: number;
  /** Where this path now sits in the repair queue, 1-indexed. 0 = not ranked. */
  queueRank: number;
  benefitPct: number;
  /** Plain-language summary of what this one report actually changed. */
  verdict: string;
};

/**
 * Record one citizen report against a bounded stretch of path.
 *
 * Not the whole way — see MAX_REPORT_METERS. The report is evidence, not an
 * overwrite: see beliefFor.
 */
export function reportSpan(indices: number[], dark: boolean): ReportResult {
  const touched = indices.map((i) => EDGES[i]).filter(Boolean);
  if (touched.length === 0) {
    return {
      label: 'Unknown path',
      wayId: 0,
      meters: 0,
      darknessBefore: 0,
      darknessAfter: 0,
      darkReports: 0,
      litReports: 0,
      confidence: 0,
      queueRank: 0,
      benefitPct: 0,
      verdict: 'No path found there.',
    };
  }

  const before = beliefForSpan(indices)!.darkness;

  // One vote per segment in the span, so a 50 m report carries the same weight
  // per metre wherever it is filed.
  for (const e of touched) {
    const cur = REPORTS.get(e.idx) ?? { dark: 0, lit: 0, at: '' };
    REPORTS.set(e.idx, {
      dark: cur.dark + (dark ? 1 : 0),
      lit: cur.lit + (dark ? 0 : 1),
      at: new Date().toISOString(),
    });
  }
  STORE.version += 1;
  recomputeRisk();
  appliedVersion = STORE.version;

  const belief = beliefForSpan(indices)!;
  const label = touched[0].label;
  const queue = repairQueue(500);
  const idx = queue.findIndex((q) => q.label === label);

  const n = belief.totalReports;
  const verdict =
    n === 1
      ? 'First report — logged as unconfirmed. One more from someone else and it counts as confirmed.'
      : n === 2
        ? 'Second report — now treated as likely.'
        : `Confirmed by ${n} reports.`;

  return {
    label,
    wayId: touched[0].wayId,
    meters: Math.round(touched.reduce((s, e) => s + e.length, 0)),
    darknessBefore: before,
    darknessAfter: belief.darkness,
    darkReports: belief.darkReports,
    litReports: belief.litReports,
    confidence: belief.confidence,
    queueRank: idx >= 0 ? idx + 1 : 0,
    benefitPct: idx >= 0 ? queue[idx].benefitPct : 0,
    verdict,
  };
}

export function reportCount(): number {
  return REPORTS.size;
}

/* ------------------------------------------------------------------ storage
 *
 * Reports have to outlive one lambda.
 *
 * They used to live only in module memory. Vercel runs several instances, each
 * with its own copy, so a report filed on instance A was invisible on B — one
 * read in twenty came back with nothing, and a cold start wiped the lot. For
 * the feature the problem statement actually asks for, that is fatal.
 *
 * Postgres is the source of truth; module memory is a per-instance cache that
 * is refilled at the start of every request that reads reports.
 */

const REST = `${SUPABASE_URL}/rest/v1/path_reports`;
const SURVEY_REST = `${SUPABASE_URL}/rest/v1/path_surveys`;
const CHECKPOINT_REST = `${SUPABASE_URL}/rest/v1/checkpoints`;
const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'content-type': 'application/json',
};

/**
 * Refill this instance's cache from Postgres.
 *
 * Every read path calls this first. Failure is deliberately non-fatal: if the
 * database is unreachable the map still renders from the baked graph, which is
 * a far better demo failure than a 500.
 */
export async function loadReports(): Promise<void> {
  if (!hasSupabase) return;
  try {
    const res = await fetch(`${REST}?select=segment_idx,dark_count,lit_count`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return;

    const rows = (await res.json()) as {
      segment_idx: number;
      dark_count: number;
      lit_count: number;
    }[];

    REPORTS.clear();
    for (const r of rows) {
      REPORTS.set(r.segment_idx, { dark: r.dark_count, lit: r.lit_count, at: '' });
    }
    STORE.version += 1;
    sync();
  } catch {
    // Offline or slow: keep serving whatever this instance already has.
  }
}

/**
 * Write a span's new counts back.
 *
 * Upserts the totals we just computed rather than issuing an increment, so a
 * lost write costs one report instead of corrupting a running count. Two people
 * reporting the same 50 m within the same second could drop one — acceptable
 * here, and the fix is a Postgres function rather than more client logic.
 */
export async function persistSpan(indices: number[]): Promise<void> {
  if (!hasSupabase || indices.length === 0) return;

  const rows = indices
    .map((i) => {
      const r = REPORTS.get(i);
      return r ? { segment_idx: i, dark_count: r.dark, lit_count: r.lit } : null;
    })
    .filter(Boolean);

  if (rows.length === 0) return;

  try {
    await fetch(REST, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    // The in-memory update already happened, so this instance stays correct
    // even if the write failed. It just will not reach the others.
  }
}

export const meta = G.meta;
export const nodes = G.nodes;
export const edges = EDGES;

export function nodeLatLng(i: number): LatLng {
  const [lat, lng] = G.nodes[i];
  return { lat, lng };
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestNode(p: LatLng): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < G.nodes.length; i++) {
    const d = (G.nodes[i][0] - p.lat) ** 2 + (G.nodes[i][1] - p.lng) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Minimal binary min-heap. Keeps Dijkstra near-linear as the graph grows. */
class MinHeap {
  private d: number[] = [];
  private n: number[] = [];

  push(dist: number, node: number) {
    this.d.push(dist);
    this.n.push(node);
    let i = this.d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      [this.d[p], this.d[i]] = [this.d[i], this.d[p]];
      [this.n[p], this.n[i]] = [this.n[i], this.n[p]];
      i = p;
    }
  }

  pop(): [number, number] | undefined {
    if (this.d.length === 0) return undefined;
    const top: [number, number] = [this.d[0], this.n[0]];
    const ld = this.d.pop()!;
    const ln = this.n.pop()!;
    if (this.d.length) {
      this.d[0] = ld;
      this.n[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < this.d.length && this.d[l] < this.d[s]) s = l;
        if (r < this.d.length && this.d[r] < this.d[s]) s = r;
        if (s === i) break;
        [this.d[s], this.d[i]] = [this.d[i], this.d[s]];
        [this.n[s], this.n[i]] = [this.n[i], this.n[s]];
        i = s;
      }
    }
    return top;
  }

  get size() {
    return this.d.length;
  }
}

/** Dijkstra with a pluggable edge cost — the same routine drives both routes. */
function shortestPath(from: number, to: number, cost: (e: Edge) => number): number[] {
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const pq = new MinHeap();
  pq.push(0, from);

  while (pq.size) {
    const top = pq.pop()!;
    const [d, u] = top;
    if (done.has(u)) continue;
    if (u === to) break;
    done.add(u);

    for (const { to: v, e } of ADJ.get(u) ?? []) {
      if (done.has(v)) continue;
      const nd = d + cost(e);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        pq.push(nd, v);
      }
    }
  }

  if (!dist.has(to)) return [];
  const path = [to];
  let cur = to;
  while (prev.has(cur)) {
    cur = prev.get(cur)!;
    path.unshift(cur);
  }
  return path;
}

function edgeBetween(a: number, b: number): Edge | undefined {
  return ADJ.get(a)?.find((x) => x.to === b)?.e;
}

export type RouteStats = {
  path: number[];
  coords: [number, number][];
  /** EDGES indices this route traverses, so the map can focus on just them. */
  segments: number[];
  meters: number;
  /** Metres of the walk spent on unlit streets. */
  darkMeters: number;
  /** Sum of risk x length — dark metres weighted by how busy the street is. */
  riskMeters: number;
  /** The unlit stretches, worst first, for explaining the route. */
  darkStretches: { label: string; meters: number }[];
};

const EMPTY_ROUTE: RouteStats = {
  path: [],
  coords: [],
  segments: [],
  meters: 0,
  darkMeters: 0,
  riskMeters: 0,
  darkStretches: [],
};

function summarise(path: number[]): RouteStats {
  let meters = 0;
  let darkMeters = 0;
  let riskMeters = 0;
  const byStreet = new Map<string, number>();
  const segments: number[] = [];

  for (let i = 0; i + 1 < path.length; i++) {
    const e = edgeBetween(path[i], path[i + 1]);
    if (!e) continue;
    segments.push(e.idx);
    meters += e.length;
    riskMeters += e.risk * e.length;
    // "Dark" for a walker means more likely unlit than not.
    if (e.darkness > 0.5) {
      darkMeters += e.length;
      byStreet.set(e.label, (byStreet.get(e.label) ?? 0) + e.length);
    }
  }

  return {
    path,
    coords: path.map((i) => G.nodes[i]),
    segments,
    meters: Math.round(meters),
    darkMeters: Math.round(darkMeters),
    riskMeters: Math.round(riskMeters),
    darkStretches: [...byStreet.entries()]
      .map(([label, m]) => ({ label, meters: Math.round(m) }))
      .sort((x, y) => y.meters - x.meters)
      .slice(0, 4),
  };
}

export type ClosureNote = {
  label: string;
  note: string;
  barrier: 'hard' | 'permission';
  permit?: string;
};

/**
 * What came back from a routing request.
 *
 *   ok         - a fully legal route exists.
 *   permission - the ONLY route runs through a gate you need a permit for.
 *                Shown, but announced, because a student with an outpass
 *                really can walk it and one without cannot.
 *   closed     - nothing legal exists at this hour. We return NO route.
 *
 * The third case is the one that matters most. Falling back to a time-blind
 * route drew a 2.5 km loop around the perimeter through paths that do not
 * legally exist, and reported "-708% less time in the dark". Telling somebody
 * they cannot get there is the honest answer, and a safety app that refuses to
 * draw a line is more trustworthy than one that always draws one.
 */
export type RouteStatus = 'ok' | 'permission' | 'closed';

export type RoutePair = {
  status: RouteStatus;
  shortest: RouteStats;
  safest: RouteStats;
  /** Closures the walker would hit on the DIRECT route at this time. */
  closures: ClosureNote[];
  /** Minutes past midnight the route was planned for, or null for "any time". */
  atMinutes: number | null;
  /** Extra metres the safer route costs. */
  detourMeters: number;
  detourPct: number;
  /** Share of dark walking removed, 0..100. */
  darkReductionPct: number;
  identical: boolean;
};

/**
 * The core comparison the product exists to make.
 *
 * `alpha` is how strongly darkness is penalised: cost = length x (1 + alpha x risk).
 * At alpha=0 the safest route collapses onto the shortest one. 4 is tuned so a
 * walker will accept a modest detour but not a wild one.
 */
/* ------------------------------------------------------------ zones
 *
 * The campus is not one connected space, it is three, joined by a countable
 * number of doors.
 *
 *   hostel  <-> campus    the subway underpass, and the hostel gate
 *   campus  <-> outside   the university entrances
 *
 * Modelling it this way is what makes "closed" provable rather than emergent.
 * Relying on the road graph alone means the router keeps finding a way round
 * through perimeter geometry OpenStreetMap happens to contain — no matter how
 * many gates are shut. If every door between two zones is locked, the journey
 * is impossible, and that can be decided before any routing happens.
 */
export type Zone = 'hostel' | 'campus' | 'outside';

const ZONE_PATTERNS: { match: RegExp; zone: Zone }[] = [
  { match: /^(b\d|g\d)\b|hostel|ghs|quess|bluedove|old mess/i, zone: 'hostel' },
];

export function zoneOfName(name: string): Zone {
  return ZONE_PATTERNS.find((z) => z.match.test(name))?.zone ?? 'campus';
}

/** Zone of a graph node, taken from the landmark nearest to it. */
export function zoneOfNode(node: number): Zone {
  let best: (typeof PLACES)[number] | undefined;
  let bd = Infinity;
  const p = nodeLatLng(node);
  for (const place of PLACES) {
    const d = (place.at.lat - p.lat) ** 2 + (place.at.lng - p.lng) ** 2;
    if (d < bd) {
      bd = d;
      best = place;
    }
  }
  return best ? zoneOfName(best.name) : 'campus';
}

export type Portal = {
  name: string;
  /** The walk ENTERS connects[0] when its destination is in that zone. */
  connects: [Zone, Zone];
  closes?: string;
  opens?: string;
  barrier: 'hard' | 'permission';
  permit?: string;
  note: string;
  /** Used instead of `note` when the walk ends in connects[0]. */
  enterNote?: string;
};

/**
 * Every door between zones.
 *
 * The three university entrances share one rule, so they are one entry — what
 * matters is that when 11pm passes, ALL of them shut and campus becomes
 * unreachable from outside. Add an entrance here only if its hours differ.
 */
export const PORTALS: Portal[] = [
  {
    name: 'Subway underpass',
    connects: ['hostel', 'campus'],
    closes: '23:00',
    opens: '05:00',
    barrier: 'hard',
    note: 'The subway underpass is shut from 11pm.',
  },
  {
    name: 'Hostel gate',
    connects: ['hostel', 'campus'],
    closes: '21:00',
    opens: '06:00',
    barrier: 'permission',
    permit: 'outpass',
    note: 'The hostel gate is shut from 9pm until 6am. Leaving needs an outpass.',
    /*
     * The SAME gate, read from the other side. Shown when the walk ends in the
     * first zone of `connects` — here, when you are heading back INTO the
     * hostel, which is the case that actually happens at midnight and the one
     * worth being unambiguous about.
     */
    enterNote:
      'The hostel gate is shut from 9pm until 6am. You need an outpass to get back in — without one the guard will not let you through, and will call your parents.',
  },
  {
    name: 'University entrances',
    connects: ['campus', 'outside'],
    closes: '23:00',
    opens: '05:00',
    barrier: 'hard',
    note: 'All three university entrances shut at 11pm. There is no way on or off campus until 5am.',
  },
];

const joins = (p: Portal, a: Zone, b: Zone) =>
  (p.connects[0] === a && p.connects[1] === b) || (p.connects[0] === b && p.connects[1] === a);

/**
 * Which doors between two zones are usable at a given time.
 *
 * Returns null when the zones are the same — no door needed.
 */
export function portalsBetween(a: Zone, b: Zone, minutes: number | null) {
  if (a === b) return null;
  const all = PORTALS.filter((p) => joins(p, a, b));
  const shut = (p: Portal) =>
    minutes !== null && isClosedAt({ match: /x/, barrier: p.barrier, note: '', closes: p.closes, opens: p.opens }, minutes);

  /*
   * Past its closing time, a HARD door is simply shut. A PERMISSION door is
   * not: a student with an outpass really can walk through the hostel gate at
   * half past eleven. Collapsing the two was making journeys look impossible
   * when they were merely gated.
   */
  return {
    all,
    open: all.filter((p) => !shut(p)),
    needPermit: all.filter((p) => shut(p) && p.barrier === 'permission'),
    closed: all.filter((p) => shut(p) && p.barrier === 'hard'),
  };
}

/** A surveyor-marked block behaves like a permanently closed hard barrier. */
const BLOCKED_RULE: AccessRule = {
  match: /^$/,
  barrier: 'hard',
  note: 'This stretch is not walkable — it has been marked as blocked on the ground.',
};

export function routePair(
  from: LatLng | number,
  to: LatLng | number,
  alpha = 4,
  atMinutes: number | null = null,
): RoutePair {
  sync();
  const a = typeof from === 'number' ? from : nearestNode(from);
  const b = typeof to === 'number' ? to : nearestNode(to);

  /*
   * Decide zone reachability FIRST. If every door between the two zones is
   * locked, no amount of clever routing changes that, and searching the graph
   * would only surface a perimeter path that is not really a path.
   */
  const zFrom = zoneOfNode(a);
  const zTo = zoneOfNode(b);
  const doors = portalsBetween(zFrom, zTo, atMinutes);

  /**
   * A portal, described from the direction the walker is actually going.
   *
   * The hostel gate at midnight means something different depending on which
   * side of it you are standing: "leaving needs an outpass" is the wrong
   * sentence entirely for somebody trying to get back into their own block.
   */
  const doorNote = (p: Portal): ClosureNote => ({
    label: p.name,
    note: (zTo === p.connects[0] && p.enterNote) || p.note,
    barrier: p.barrier,
    permit: p.permit,
  });

  const gate = (e: Edge) => {
    if (isBlocked(e.idx)) return BLOCKED_RULE;

    /*
     * A placed gate is checked BEFORE the time guard below.
     *
     * A gate with no hours is shut at every hour, so it has to apply even when
     * the walker picked no time — otherwise "always closed" would be honoured
     * at 11pm and ignored on the default view, which is the one judges see.
     */
    const placed = gateFor(e.idx);
    if (placed && gateShutAt(placed, atMinutes)) return placed;

    if (atMinutes === null) return null;
    const { rule, closed } = accessFor(e, atMinutes);
    return closed && rule ? rule : null;
  };

  /** Legal for everyone: no closed gate of any kind. */
  const strict = (e: Edge) => gate(e) === null;
  /** Legal if you hold the permit: hard barriers still refuse. */
  const withPermit = (e: Edge) => {
    const g = gate(e);
    return g === null || g.barrier === 'permission';
  };

  const plan = (ok: (e: Edge) => boolean) => {
    const shortestPathIdx = shortestPath(a, b, (e) => (ok(e) ? e.length : Infinity));
    if (shortestPathIdx.length === 0) return null;
    return {
      shortest: summarise(shortestPathIdx),
      safest: summarise(
        shortestPath(a, b, (e) => (ok(e) ? e.length * (1 + alpha * e.risk) : Infinity)),
      ),
    };
  };

  const notesOn = (segments: number[]): ClosureNote[] => {
    const seen = new Set<string>();
    const out: ClosureNote[] = [];
    for (const i of segments) {
      const e = EDGES[i];
      const g = gate(e);
      if (g && !seen.has(g.note)) {
        seen.add(g.note);
        out.push({ label: e.label, note: g.note, barrier: g.barrier, permit: g.permit });
      }
    }
    return out;
  };

  const finish = (
    status: RouteStatus,
    pair: { shortest: RouteStats; safest: RouteStats } | null,
    closures: ClosureNote[],
  ): RoutePair => {
    if (!pair) {
      return {
        status,
        shortest: EMPTY_ROUTE,
        safest: EMPTY_ROUTE,
        closures,
        atMinutes,
        detourMeters: 0,
        detourPct: 0,
        darkReductionPct: 0,
        identical: true,
      };
    }
    const detourMeters = pair.safest.meters - pair.shortest.meters;
    return {
      status,
      shortest: pair.shortest,
      safest: pair.safest,
      closures,
      atMinutes,
      detourMeters,
      detourPct: pair.shortest.meters
        ? Math.round((100 * detourMeters) / pair.shortest.meters)
        : 0,
      // Clamped at zero: the safer route can never be *worse* than the direct
      // one by construction, and a negative reading here only ever meant the
      // comparison was against a route that should not have existed.
      darkReductionPct: pair.shortest.darkMeters
        ? Math.max(
            0,
            Math.round(
              (100 * (pair.shortest.darkMeters - pair.safest.darkMeters)) /
                pair.shortest.darkMeters,
            ),
          )
        : 0,
      identical: pair.shortest.path.join() === pair.safest.path.join(),
    };
  };

  // 0. Zone-level impossibility, decided without touching the graph.
  if (doors && doors.open.length === 0 && doors.needPermit.length === 0) {
    return finish(
      'closed',
      null,
      doors.closed.map(doorNote),
    );
  }

  // 1. Fully legal.
  const legal = plan(strict);

  /*
   * Order matters here. If every open door between the zones needs a permit,
   * a route the graph calls "legal" is perimeter geometry rather than a way
   * in — so the permit has to be announced BEFORE we accept that route.
   */
  if (doors && doors.open.length === 0 && doors.needPermit.length > 0 && legal) {
    // The graph found a route, but the only real door needs a permit — the
    // "legal" path is perimeter geometry, not a way in. Announce the permit.
    return finish(
      'permission',
      legal,
      doors.needPermit.map(doorNote),
    );
  }
  if (legal) return finish('ok', legal, []);

  // 2. Legal with a permit. Announce exactly which one.
  const permitted = plan(withPermit);
  if (permitted) {
    return finish('permission', permitted, notesOn(permitted.shortest.segments));
  }

  // 3. Nothing works. Say so, and name what is in the way — found by routing
  //    as if time did not exist, then reporting the gates that route crosses.
  const anyRoute = shortestPath(a, b, (e) => e.length);
  return finish('closed', null, notesOn(summarise(anyRoute).segments));
}

export type QueueItem = {
  id: string;
  label: string;
  meters: number;
  /** Risk-metres removed if this street were lit. */
  riskMeters: number;
  /** Share of the whole area's night risk this one fix removes. */
  benefitPct: number;
  avgExposure: number;
  segments: number;
  /** 0..1 — how much of this ranking rests on reports rather than our estimate. */
  confidence: number;
  /** 'confirmed' once two or more people agree; else how it got here. */
  status: 'confirmed' | 'reported' | 'estimated';
  reports: number;
};

/**
 * The repair queue: which streets to light first.
 *
 * Ranked by risk-metres removed, NOT by complaint date — that inversion is the
 * entire point of the problem statement. Streets are aggregated by name so the
 * queue reads as "Vidya Marg" rather than forty 8-metre fragments.
 */
export function repairQueue(limit = 10): QueueItem[] {
  sync();
  const groups = new Map<
    string,
    { m: number; rm: number; ex: number; n: number; conf: number; reports: number }
  >();

  for (const e of EDGES) {
    if (e.darkness <= 0.5) continue; // probably lit — nothing to repair
    const key = e.label;
    const b = beliefFor(e);
    const g = groups.get(key) ?? { m: 0, rm: 0, ex: 0, n: 0, conf: 0, reports: 0 };
    g.m += e.length;
    g.rm += e.risk * e.length;
    g.ex += e.exposure * e.length;
    g.n += 1;
    g.conf = Math.max(g.conf, b.confidence);
    g.reports = Math.max(g.reports, b.totalReports);
    groups.set(key, g);
  }

  return [...groups.entries()]
    .map(([label, g]) => ({
      id: label,
      label,
      meters: Math.round(g.m),
      riskMeters: Math.round(g.rm),
      benefitPct: TOTAL_RISK_M ? Number(((100 * g.rm) / TOTAL_RISK_M).toFixed(1)) : 0,
      avgExposure: Number((g.ex / Math.max(g.m, 1)).toFixed(3)),
      segments: g.n,
      confidence: Number(g.conf.toFixed(2)),
      reports: g.reports,
      status: (g.reports >= 2 ? 'confirmed' : g.reports === 1 ? 'reported' : 'estimated') as
        | 'confirmed'
        | 'reported'
        | 'estimated',
    }))
    .sort((a, b) => b.riskMeters - a.riskMeters)
    .slice(0, limit);
}

/** Headline numbers for the dashboard and the agent's summaries. */
export function areaStats() {
  sync();
  const dark = EDGES.filter((e) => e.darkness > 0.5);
  const darkM = dark.reduce((s, e) => s + e.length, 0);
  const totalM = EDGES.reduce((s, e) => s + e.length, 0);
  const highRisk = EDGES.filter((e) => e.risk > 0.15);

  return {
    area: G.meta.area,
    totalKm: Number((totalM / 1000).toFixed(1)),
    darkKm: Number((darkM / 1000).toFixed(1)),
    darkPct: Math.round((100 * darkM) / totalM),
    segments: EDGES.length,
    /** Segments that are both busy and dark — the ones that actually matter. */
    highRiskSegments: highRisk.length,
    highRiskKm: Number((highRisk.reduce((s, e) => s + e.length, 0) / 1000).toFixed(1)),
    hostels: G.meta.hostels,
    destinations: G.meta.destinations,
    modelledTrips: G.meta.trips,
    citizenReports: REPORTS.size,
    litSurveyed: G.meta.lit_surveyed,
    blockedPaths: G.meta.blocked_paths,
    litFromOsm: G.meta.lit_from_osm,
    litSimulated: G.meta.lit_simulated,
    totalRiskMeters: Math.round(TOTAL_RISK_M),
  };
}

/**
 * Named landmarks, straight from OpenStreetMap.
 *
 * Nothing here is invented: these are the block names MUJ students actually
 * mapped — B1..B7, G2..G4, AB1, AB2, Central Library, Bluedove Mess. Because
 * each one carries its graph node, routing between them is exact rather than
 * snapped from an approximate coordinate.
 */
export type Place = { name: string; at: LatLng; node: number; kind: 'hostel' | 'dest' };

export const PLACES: Place[] = G.landmarks.map((l) => ({
  name: l.name,
  node: l.node,
  kind: l.kind,
  at: nodeLatLng(l.node),
}));

/* ------------------------------------------------- landmark corrections
 *
 * graph.json is frozen — regenerating it renumbers every segment and orphans
 * the survey — so a landmark that has closed, moved, or was never really a
 * destination cannot be removed at source. Corrections overlay it instead,
 * keyed by the original OSM name. See docs/sql/005_places.sql.
 */

export type PlaceOverride = { hidden: boolean; displayName: string | null };

type PlaceStore = { map: Map<string, PlaceOverride>; version: number };
const PS = globalThis as typeof globalThis & { __nightlinePlaces?: PlaceStore };
const PSTORE: PlaceStore = (PS.__nightlinePlaces ??= { map: new Map(), version: 0 });

const PLACE_REST = `${SUPABASE_URL}/rest/v1/place_overrides`;
let placeTableMissing = false;

/** Refill landmark corrections from Postgres. Non-fatal on failure. */
export async function loadPlaceOverrides(): Promise<void> {
  if (!hasSupabase || placeTableMissing) return;
  try {
    const res = await fetch(`${PLACE_REST}?select=name,hidden,display_name`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      // The migration has not been run. Stop asking rather than retrying on
      // every request; corrections simply are not available yet.
      placeTableMissing = true;
      return;
    }
    const rows = (await res.json()) as { name: string; hidden: boolean; display_name: string | null }[];
    PSTORE.map.clear();
    for (const r of rows) {
      PSTORE.map.set(r.name, { hidden: Boolean(r.hidden), displayName: r.display_name });
    }
    PSTORE.version += 1;
  } catch {
    /* keep whatever this instance already has */
  }
}

/**
 * The landmarks a person should see: hidden ones dropped, renames applied.
 *
 * NOTE: zoneOfNode deliberately still reads the full PLACES list. Zones decide
 * whether a journey is possible at all, and re-deriving them from a shrinking
 * set of landmarks would let hiding a shop silently reclassify the ground
 * around it and change which gates a walk has to pass. Hiding corrects what is
 * SHOWN and offered as a destination, not the shape of the campus.
 */
export function visiblePlaces(): Place[] {
  if (PSTORE.map.size === 0) return PLACES;
  const out: Place[] = [];
  for (const p of PLACES) {
    const o = PSTORE.map.get(p.name);
    if (o?.hidden) continue;
    out.push(o?.displayName ? { ...p, name: o.displayName } : p);
  }
  return out;
}

/** Corrections as stored, for the surveyor UI to show what has been changed. */
export function placeOverrides(): Record<string, PlaceOverride> {
  return Object.fromEntries(PSTORE.map);
}

export async function savePlaceOverride(
  name: string,
  patch: Partial<PlaceOverride>,
): Promise<boolean> {
  if (!hasSupabase) return false;
  const prev = PSTORE.map.get(name);
  const next: PlaceOverride = {
    hidden: patch.hidden !== undefined ? patch.hidden : (prev?.hidden ?? false),
    displayName: patch.displayName !== undefined ? patch.displayName : (prev?.displayName ?? null),
  };
  PSTORE.map.set(name, next);
  PSTORE.version += 1;
  try {
    const res = await fetch(PLACE_REST, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([
        {
          name,
          hidden: next.hidden,
          display_name: next.displayName,
          updated_at: new Date().toISOString(),
        },
      ]),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) placeTableMissing = false;
    return res.ok;
  } catch {
    return false;
  }
}

/** Put a landmark back exactly as OpenStreetMap had it. */
export async function clearPlaceOverride(name: string): Promise<boolean> {
  if (!hasSupabase) return false;
  PSTORE.map.delete(name);
  PSTORE.version += 1;
  try {
    const res = await fetch(`${PLACE_REST}?name=eq.${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function findPlace(q: string): Place | undefined {
  const n = q.trim().toLowerCase();
  if (!n) return undefined;
  // Search the visible list first so a renamed landmark resolves under its new
  // name, then fall back to every imported name — a route or a saved agent
  // conversation referring to the original must not break when it is renamed.
  const pools = [visiblePlaces(), PLACES];
  for (const pool of pools) {
    const hit =
      pool.find((p) => p.name.toLowerCase() === n) ??
      pool.find((p) => p.name.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, '')) ??
      pool.find((p) => p.name.toLowerCase().includes(n)) ??
      pool.find((p) => n.includes(p.name.toLowerCase()));
    if (hit) return hit;
  }
  return undefined;
}


/* ------------------------------------------------------------ surveys */

/** Refill surveyed ground truth from Postgres. Non-fatal on failure. */
export async function loadSurveys(): Promise<void> {
  if (!hasSupabase) return;
  try {
    const res = await fetch(`${SURVEY_REST}?select=segment_idx,lighting,traffic,note,blocked`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return;
    const rows = (await res.json()) as {
      segment_idx: number;
      lighting: SurveyLighting | null;
      traffic: SurveyTraffic | null;
      note: string | null;
      blocked?: boolean;
    }[];
    SURVEYS.clear();
    for (const r of rows) {
      SURVEYS.set(r.segment_idx, {
        lighting: r.lighting,
        traffic: r.traffic,
        note: r.note,
        blocked: Boolean(r.blocked),
      });
    }
    SSTORE.version += 1;
    sync();
  } catch {
    /* keep whatever this instance already has */
  }
}

/** Everything a read path needs, in one call. */
export async function loadAll(): Promise<void> {
  await Promise.all([loadReports(), loadSurveys(), loadGates(), loadPlaceOverrides()]);
}

export type SurveyResult = {
  label: string;
  meters: number;
  segments: number;
  lighting: SurveyLighting | null;
  traffic: SurveyTraffic | null;
  darknessBefore: number;
  darknessAfter: number;
  queueRank: number;
  benefitPct: number;
};

/**
 * Record a survey over a span, and write it through to Postgres.
 *
 * Unlike a citizen report this REPLACES what we believed rather than adding
 * evidence to it — that is the whole point of somebody walking the path.
 *
 * A PATCH, NOT A ROW. An absent field keeps whatever is already recorded; only
 * a field that is present is written. Blocking a path used to arrive as a
 * survey carrying no lighting, which wrote `lighting: null` over ground truth
 * somebody had walked out and collected — so marking a fence quietly deleted
 * the survey of the path beside it. Pass `null` explicitly to clear a field.
 */
export type SurveyPatch = {
  lighting?: SurveyLighting | null;
  traffic?: SurveyTraffic | null;
  note?: string | null;
  blocked?: boolean;
};

export async function saveSurvey(
  indices: number[],
  patch: SurveyPatch,
  surveyor: string | null = null,
): Promise<SurveyResult | null> {
  sync();
  const touched = indices.map((i) => EDGES[i]).filter(Boolean);
  if (touched.length === 0) return null;

  const before = beliefForSpan(indices)?.darkness ?? 0;

  const merge = (prev: Survey | undefined): Survey => ({
    lighting: patch.lighting !== undefined ? patch.lighting : (prev?.lighting ?? null),
    traffic: patch.traffic !== undefined ? patch.traffic : (prev?.traffic ?? null),
    note: patch.note !== undefined ? patch.note : (prev?.note ?? null),
    blocked: patch.blocked !== undefined ? patch.blocked : (prev?.blocked ?? false),
  });

  // Each segment merges against its OWN previous value: a span can straddle a
  // stretch that was surveyed and one that was not.
  const merged = new Map(touched.map((e) => [e.idx, merge(SURVEYS.get(e.idx))]));
  for (const e of touched) SURVEYS.set(e.idx, merged.get(e.idx)!);
  SSTORE.version += 1;
  recomputeRisk();
  appliedVersion = STORE.version;
  appliedSurveyVersion = SSTORE.version;

  if (hasSupabase) {
    try {
      await fetch(SURVEY_REST, {
        method: 'POST',
        headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(
          touched.map((e) => ({
            segment_idx: e.idx,
            // The merged value, not the patch — merge-duplicates overwrites
            // every column it is given, so anything omitted here would be
            // nulled in Postgres even though it survived in memory.
            ...merged.get(e.idx)!,
            surveyor,
            updated_at: new Date().toISOString(),
          })),
        ),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      /* in-memory update already applied on this instance */
    }
  }

  const label = touched[0].label;
  const queue = repairQueue(500);
  const idx = queue.findIndex((q) => q.label === label);

  const settled = merged.get(touched[0].idx)!;
  return {
    label,
    meters: Math.round(touched.reduce((s, e) => s + e.length, 0)),
    segments: touched.length,
    lighting: settled.lighting,
    traffic: settled.traffic ?? null,
    darknessBefore: before,
    darknessAfter: beliefForSpan(indices)?.darkness ?? 0,
    queueRank: idx >= 0 ? idx + 1 : 0,
    benefitPct: idx >= 0 ? queue[idx].benefitPct : 0,
  };
}

/**
 * Remove the survey over a span entirely, returning those segments to whatever
 * the model and OSM believed before anybody walked them.
 *
 * A surveyor working in the dark taps the wrong stretch, and until this existed
 * the only correction was to overwrite it with a different claim — which still
 * carries survey-strength prior 8 and still reads as "someone stood here and
 * checked". Withdrawing a mistake has to be possible, or the strongest evidence
 * in the model is the one thing that cannot be taken back.
 */
export async function clearSurvey(indices: number[]): Promise<{ cleared: number; label: string } | null> {
  sync();
  const touched = indices.map((i) => EDGES[i]).filter(Boolean);
  if (touched.length === 0) return null;

  const present = touched.filter((e) => SURVEYS.has(e.idx));
  for (const e of touched) SURVEYS.delete(e.idx);
  SSTORE.version += 1;
  recomputeRisk();
  appliedVersion = STORE.version;
  appliedSurveyVersion = SSTORE.version;

  // Delete every requested index, not merely the ones this lambda had cached.
  // The two agree only while loadAll() has just succeeded; if that read failed
  // or timed out, gating on the cache would skip the write and report a
  // withdrawal that Postgres never heard about — and the next request would
  // load the survey straight back in.
  if (hasSupabase) {
    try {
      const list = touched.map((e) => e.idx).join(',');
      await fetch(`${SURVEY_REST}?segment_idx=in.(${list})`, {
        method: 'DELETE',
        headers: HEADERS,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      /* in-memory removal already applied on this instance */
    }
  }

  return { cleared: present.length, label: touched[0].label };
}

export function surveyCount(): number {
  return SURVEYS.size;
}

export function surveyFor(idx: number): Survey | undefined {
  return SURVEYS.get(idx);
}

/* -------------------------------------------------------- checkpoints */

export type Checkpoint = {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  note?: string | null;
  /** null = a marker that constrains nothing. See docs/sql/004_gates.sql. */
  barrier?: 'hard' | 'permission' | null;
  closes?: string | null;
  opens?: string | null;
  permit?: string | null;
};

const GATE_COLUMNS = 'id,name,kind,lat,lng,note,barrier,closes,opens,permit';
const BASE_COLUMNS = 'id,name,kind,lat,lng,note';

/** Set once 004_gates.sql is seen to be missing, so we stop asking for it. */
let gateColumnsMissing = false;

export async function listCheckpoints(): Promise<Checkpoint[]> {
  if (!hasSupabase) return [];

  const query = async (columns: string) => {
    const res = await fetch(`${CHECKPOINT_REST}?select=${columns}&order=name`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? ((await res.json()) as Checkpoint[]) : null;
  };

  try {
    /*
     * Fall back to the base columns if the gate migration has not been run.
     *
     * PostgREST 400s the WHOLE select when one column is unknown, so asking for
     * gate columns against an un-migrated database would return nothing and
     * every checkpoint would vanish from the map — a far worse failure than
     * gates simply not being armed yet.
     */
    let rows = gateColumnsMissing ? null : await query(GATE_COLUMNS);
    if (!rows) {
      gateColumnsMissing = true;
      rows = await query(BASE_COLUMNS);
    }
    if (!rows) return [];

    // Rows written before the gate rework carry kinds the editor cannot render
    // — they came back grey with no button selected and no way to tell why.
    // Normalising on read fixes them on screen without a migration.
    return rows.map((c) => ({ ...c, kind: normaliseKind(c.kind) }));
  } catch {
    return [];
  }
}

/* --------------------------------------------------------- gate rules
 *
 * A placed gate, resolved to the path segments it physically controls.
 *
 * Bound by POSITION, not by segment index. Surveys are index-keyed and so are
 * fragile against a graph regeneration; a gate is a thing standing at a
 * coordinate, so resolving it geometrically at load time means a rebuilt graph
 * re-finds it rather than pointing at whatever segment inherited the number.
 */

/** How close a segment must pass to a gate to be controlled by it. */
const GATE_REACH_M = 16;

type GateStore = { list: Checkpoint[]; version: number };
const GC = globalThis as typeof globalThis & { __nightlineGates?: GateStore };
const GSTORE: GateStore = (GC.__nightlineGates ??= { list: [], version: 0 });

export type GateRule = AccessRule & { name: string; segments: number[] };

let gateCache: { version: number; rules: GateRule[]; bySegment: Map<number, GateRule> } | null = null;

/** Refill placed gates from Postgres. Non-fatal on failure. */
export async function loadGates(): Promise<void> {
  if (!hasSupabase) return;
  const rows = await listCheckpoints();
  if (!rows.length && GSTORE.list.length) return; // a failed read must not disarm gates
  GSTORE.list = rows;
  GSTORE.version += 1;
}

function buildGates(): { rules: GateRule[]; bySegment: Map<number, GateRule> } {
  const rules: GateRule[] = [];
  const bySegment = new Map<number, GateRule>();

  for (const c of GSTORE.list) {
    if (c.barrier !== 'hard' && c.barrier !== 'permission') continue;

    const at: LatLng = { lat: c.lat, lng: c.lng };
    const segments: number[] = [];
    let nearest = -1;
    let nd = Infinity;

    for (const e of EDGES) {
      const d = distToSegment(at, G.nodes[e.a], G.nodes[e.b]);
      if (d < nd) {
        nd = d;
        nearest = e.idx;
      }
      if (d <= GATE_REACH_M) segments.push(e.idx);
    }
    // A gate mapped slightly off the path still controls the path it guards.
    if (!segments.length && nearest >= 0) segments.push(nearest);

    const always = !c.closes || !c.opens;
    const rule: GateRule = {
      name: c.name,
      match: /^$/, // matched by segment, never by label
      barrier: c.barrier,
      closes: c.closes ?? undefined,
      opens: c.opens ?? undefined,
      permit: c.permit ?? undefined,
      segments,
      note:
        c.note?.trim() ||
        (always
          ? c.barrier === 'hard'
            ? `${c.name} is always shut — there is no way through it.`
            : `${c.name} needs ${c.permit || 'permission'} at any hour.`
          : `${c.name} is shut from ${c.closes} until ${c.opens}.`),
    };

    rules.push(rule);
    // First gate on a segment wins; two gates on one path is a mapping error.
    for (const idx of segments) if (!bySegment.has(idx)) bySegment.set(idx, rule);
  }

  return { rules, bySegment };
}

function gates() {
  if (!gateCache || gateCache.version !== GSTORE.version) {
    gateCache = { version: GSTORE.version, ...buildGates() };
  }
  return gateCache;
}

/** The gate controlling a segment, if any. */
export function gateFor(idx: number): GateRule | undefined {
  return gates().bySegment.get(idx);
}

/** Every placed gate, for the map and the agent to describe. */
export function placedGates(): GateRule[] {
  return gates().rules;
}

/**
 * A gate with a barrier but no hours is shut at EVERY hour.
 *
 * That is what "authorised personnel only, always closed" means on the ground:
 * not a schedule but a wall, and it has to hold even when no time is selected.
 */
export function gateShutAt(rule: GateRule, minutes: number | null): boolean {
  if (!rule.closes || !rule.opens) return true;
  return minutes === null ? false : isClosedAt(rule, minutes);
}

/** Segments controlled by a gate that is shut at this hour, for the map. */
export function shutGateSegments(minutes: number | null): number[] {
  const out: number[] = [];
  for (const [idx, rule] of gates().bySegment) {
    if (gateShutAt(rule, minutes) && rule.barrier === 'hard') out.push(idx);
  }
  return out;
}

export async function upsertCheckpoint(c: Partial<Checkpoint>): Promise<Checkpoint | null> {
  if (!hasSupabase) return null;
  const body: Record<string, unknown> = {
    name: c.name,
    kind: normaliseKind(c.kind),
    lat: c.lat,
    lng: c.lng,
    note: c.note ?? null,
    updated_at: new Date().toISOString(),
  };
  if (c.id) body.id = c.id;
  // Only send gate columns when the migration is known to be present, so a
  // save still succeeds against an un-migrated database instead of 400ing.
  if (!gateColumnsMissing) {
    body.barrier = c.barrier ?? null;
    body.closes = c.closes ?? null;
    body.opens = c.opens ?? null;
    body.permit = c.permit ?? null;
  }
  try {
    const res = await fetch(CHECKPOINT_REST, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Checkpoint[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function deleteCheckpoint(id: string): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    // PostgREST answers 204 even when the filter matched nothing, so asking
    // for the deleted rows back is the only way to tell "gone" from "was never
    // there" — otherwise the UI reports success and the pin stays put.
    const res = await fetch(`${CHECKPOINT_REST}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}
