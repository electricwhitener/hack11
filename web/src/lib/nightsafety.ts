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
  for (const e of EDGES) {
    e.darkness = beliefFor(e).darkness;
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
    match: /university entrance|main gate/i,
    closes: '23:00',
    opens: '05:00',
    barrier: 'hard',
    note: 'The university entrance is shut from 11pm. You cannot enter or leave campus through it.',
  },
  {
    match: /hostel (entrance|gate)|ghs (main )?road/i,
    closes: '21:15',
    opens: '05:00',
    barrier: 'permission',
    permit: 'outpass',
    note: 'The hostel gate closes at 9:15pm. Leaving needs an outpass, and returning without one means the guard calls your parents.',
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
    source: es[0].source,
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

  const gate = (e: Edge) => {
    if (isBlocked(e.idx)) return BLOCKED_RULE;
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

  // 1. Fully legal.
  const legal = plan(strict);
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

export function findPlace(q: string): Place | undefined {
  const n = q.trim().toLowerCase();
  if (!n) return undefined;
  return (
    PLACES.find((p) => p.name.toLowerCase() === n) ??
    PLACES.find((p) => p.name.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, '')) ??
    PLACES.find((p) => p.name.toLowerCase().includes(n)) ??
    PLACES.find((p) => n.includes(p.name.toLowerCase()))
  );
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
  await Promise.all([loadReports(), loadSurveys()]);
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
 */
export async function saveSurvey(
  indices: number[],
  lighting: SurveyLighting | null,
  traffic: SurveyTraffic | null,
  note: string | null,
  surveyor: string | null,
  blocked = false,
): Promise<SurveyResult | null> {
  sync();
  const touched = indices.map((i) => EDGES[i]).filter(Boolean);
  if (touched.length === 0) return null;

  const before = beliefForSpan(indices)?.darkness ?? 0;

  for (const e of touched) SURVEYS.set(e.idx, { lighting, traffic, note, blocked });
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
            lighting,
            traffic,
            note,
            surveyor,
            blocked,
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

  return {
    label,
    meters: Math.round(touched.reduce((s, e) => s + e.length, 0)),
    segments: touched.length,
    lighting,
    traffic,
    darknessBefore: before,
    darknessAfter: beliefForSpan(indices)?.darkness ?? 0,
    queueRank: idx >= 0 ? idx + 1 : 0,
    benefitPct: idx >= 0 ? queue[idx].benefitPct : 0,
  };
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
};

export async function listCheckpoints(): Promise<Checkpoint[]> {
  if (!hasSupabase) return [];
  try {
    const res = await fetch(`${CHECKPOINT_REST}?select=id,name,kind,lat,lng,note&order=name`, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? ((await res.json()) as Checkpoint[]) : [];
  } catch {
    return [];
  }
}

export async function upsertCheckpoint(c: Partial<Checkpoint>): Promise<Checkpoint | null> {
  if (!hasSupabase) return null;
  const body: Record<string, unknown> = {
    name: c.name,
    kind: c.kind ?? 'checkpoint',
    lat: c.lat,
    lng: c.lng,
    note: c.note ?? null,
    updated_at: new Date().toISOString(),
  };
  if (c.id) body.id = c.id;
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
    const res = await fetch(`${CHECKPOINT_REST}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
