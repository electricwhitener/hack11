'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LMap, LayerGroup, Canvas } from 'leaflet';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { RouteStats } from './RouteStats';
import { PathInspector, type PathInfo, type SurveyPatch } from './PathInspector';
import { SurveyorBar } from './SurveyorBar';
import { CheckpointEditor, type Checkpoint } from './CheckpointEditor';
import { kindColour, DEFAULT_KIND } from '@/lib/checkpointKinds';
import { useSurveyor } from '@/lib/useSurveyor';

/** [aLat, aLng, bLat, bLng, risk, darkness, exposure, wayId] */
type Segment = [number, number, number, number, number, number, number, number];
type MapMode = 'none' | 'select' | 'place';
type Place = { name: string; at: { lat: number; lng: number }; node: number; kind: 'hostel' | 'dest' };

export type Stats = {
  totalKm: number;
  darkKm: number;
  darkPct: number;
  highRiskSegments: number;
  highRiskKm: number;
  hostels: number;
  destinations: number;
  citizenReports: number;
};

type RouteLeg = {
  coords: [number, number][];
  segments: number[];
  meters: number;
  darkMeters: number;
  darkStretches: { label: string; meters: number }[];
};

export type ClosureNote = {
  label: string;
  note: string;
  barrier: 'hard' | 'permission';
  permit?: string;
};

export type RoutePair = {
  status: 'ok' | 'permission' | 'closed';
  shortest: RouteLeg;
  safest: RouteLeg;
  closures: ClosureNote[];
  atMinutes: number | null;
  detourMeters: number;
  detourPct: number;
  darkReductionPct: number;
  identical: boolean;
};

/** A user reports a stretch they can actually see, not a whole path. */
const MAX_REPORT_M = 50;

/**
 * Colour says ONE thing: how lit the path is.
 *
 * It used to encode risk, which folded in modelled foot traffic — so a path's
 * colour claimed a precision we do not have. Foot traffic is an estimate until
 * people actually use this, and three shades of "dark but how busy" was noise
 * on the map rather than information. Lighting is the thing we can observe,
 * report and survey, so lighting is what gets a colour.
 *
 * Foot traffic survives as line WEIGHT — a busier path is drawn thicker. That
 * reads as emphasis rather than a claim, and it degrades honestly: if the
 * estimate is off, a line is slightly too thick, not the wrong colour.
 */
const C = {
  /*
   * Built from a true green -> xanthous -> cinnabar ramp. Saturated, warm-
   * shifting, no mint anywhere.
   *
   * Dartmouth green (#0C6B37) is the reference for "lit", but at L~23% it
   * disappears against a dark basemap, so the line colour is that hue lifted to
   * carry on a night map. Amber and red are used exactly as given — they sit at
   * high lightness already and need no help.
   *
   * The hierarchy no longer leans on desaturation at all. It comes from hue
   * temperature (green recedes, red advances), from opacity, and from line
   * weight — three cues, all pointing at the dark stretches.
   */
  lit: '#13A34B', // Dartmouth green, lifted for a dark canvas
  dim: '#F8B324', // xanthous
  dark: '#EB442C', // cinnabar
  darkDeep: '#BC2023', // fire brick — the glow beneath the worst stretches
  tunnel: '#5B9DFF', // clear blue: a different KIND of path
  blocked: '#4A4A52', // near-invisible on purpose; it is not a route
  muted: '#2C2C31', // off-route, when a walk is being shown
  bulbCore: '#FFE9B8', // the safer route itself
  bulbGlow: '#FF9E1B',
} as const;

/** Opacity carries hierarchy too: the common case sits back, danger sits forward. */
const OPACITY = { lit: 0.85, dim: 1, dark: 1 } as const;

/** Thresholds shared with the inspector's wording, so they never disagree. */
const DIM_AT = 0.35;
const DARK_AT = 0.6;

function segColor(darkness: number): string {
  if (darkness <= DIM_AT) return C.lit;
  if (darkness <= DARK_AT) return C.dim;
  return C.dark;
}

function segOpacity(darkness: number): number {
  if (darkness <= DIM_AT) return OPACITY.lit;
  if (darkness <= DARK_AT) return OPACITY.dim;
  return OPACITY.dark;
}

/** Busier paths draw thicker. The only place foot traffic shows on the map. */
function segWeight(exposure: number, darkness: number): number {
  // Weight is the third cue: dark sits thickest, lit thinnest, regardless of
  // how busy the path is. A quiet dark stretch still has to be findable.
  const base = darkness > DARK_AT ? 2.1 : darkness > DIM_AT ? 1.6 : 1.1;
  return base + Math.min(exposure, 1) * 2.3;
}

/** Perpendicular distance in metres from a point to a segment. */
function distToSeg(lat: number, lng: number, s: Segment): number {
  const mLat = 111320;
  const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const px = lng * mLng;
  const py = lat * mLat;
  const x1 = s[1] * mLng;
  const y1 = s[0] * mLat;
  const x2 = s[3] * mLng;
  const y2 = s[2] * mLat;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function DarkZoneMap() {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const routeLayer = useRef<LayerGroup | null>(null);
  const baseLayer = useRef<LayerGroup | null>(null);
  const glowLayer = useRef<LayerGroup | null>(null);
  const hoverLayer = useRef<LayerGroup | null>(null);
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const glowRenderer = useRef<Canvas | null>(null);
  const segRef = useRef<Segment[]>([]);
  // Leaflet binds handlers once, so they must read modes through refs.
  const modeRef = useRef<MapMode>('none');
  const hoverRef = useRef<string | null>(null);
  const focusRef = useRef<Set<number> | null>(null);
  const planRef = useRef<RoutePair | null>(null);
  const resizeObs = useRef<ResizeObserver | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [plan, setPlan] = useState<RoutePair | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<MapMode>('none');
  const [reports, setReports] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<PathInfo | null>(null);
  const surveyor = useSurveyor();
  const [atMinutes, setAtMinutes] = useState<number | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [draft, setDraft] = useState<Checkpoint | null>(null);
  const cpLayer = useRef<LayerGroup | null>(null);
  const tunnelsRef = useRef<Set<number>>(new Set());
  const blockedRef = useRef<Set<number>>(new Set());

  // Losing surveyor rights must leave surveyor mode. The "Map a point" button
  // disappears on sign-out but `mode` did not change, so the map kept opening a
  // New point form on every tap — a form whose save could only ever 401.
  useEffect(() => {
    if (!surveyor.authorised && modeRef.current === 'place') {
      modeRef.current = 'none';
      setMode('none');
      setDraft(null);
    }
  }, [surveyor.authorised]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !holder.current || map.current) return;
      LRef.current = L;

      const m = L.map(holder.current, {
        zoomControl: false,
        preferCanvas: true, // ~1.9k polylines: SVG would crawl, canvas does not
      }).setView([26.8425, 75.563], 16);
      L.control.zoom({ position: 'bottomright' }).addTo(m);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(m);

      // A blurred pane under the streets turns the lit paths into lamplight
      // rather than just another colour. One extra draw pass, no image work.
      m.createPane('glow');
      const gp = m.getPane('glow')!;
      gp.style.zIndex = '350';
      gp.style.filter = 'blur(5px)';
      gp.style.pointerEvents = 'none';
      glowRenderer.current = L.canvas({ pane: 'glow' });

      map.current = m;
      glowLayer.current = L.layerGroup().addTo(m);
      baseLayer.current = L.layerGroup().addTo(m);
      hoverLayer.current = L.layerGroup().addTo(m);
      routeLayer.current = L.layerGroup().addTo(m);
      cpLayer.current = L.layerGroup().addTo(m);
      void refreshCheckpoints();

      const data: {
        segments: Segment[];
        places: Place[];
        stats: Stats;
        tunnels?: number[];
        blocked?: number[];
      } = await fetch('/api/graph').then((r) => r.json());
      if (cancelled) return;

      tunnelsRef.current = new Set(data.tunnels ?? []);
      blockedRef.current = new Set(data.blocked ?? []);
      segRef.current = data.segments;
      setStats(data.stats);
      paintSegments(data.segments, null);

      for (const p of data.places) {
        L.circleMarker([p.at.lat, p.at.lng], {
          radius: p.kind === 'hostel' ? 5 : 4,
          color: p.kind === 'hostel' ? '#93c5fd' : '#cbd5e1',
          fillColor: p.kind === 'hostel' ? '#3b82f6' : '#94a3b8',
          fillOpacity: 0.9,
          weight: 1.5,
        })
          .bindTooltip(p.name, { direction: 'top' })
          .addTo(m);
      }

      // Hover preview: highlight the whole path the cursor is over, so you can
      // see what you are about to pick before committing to it.
      m.on('mousemove', (ev: L.LeafletMouseEvent) => {
        if (modeRef.current === 'none') return;
        const span = spanAt(ev.latlng.lat, ev.latlng.lng);
        const key = span?.indices.join(',') ?? null;
        if (key === hoverRef.current) return;
        hoverRef.current = key;
        drawHover(span?.indices ?? null);
      });

      m.on('click', (ev: L.LeafletMouseEvent) => {
        if (modeRef.current === 'place') {
          setDraft({ name: '', kind: DEFAULT_KIND, lat: ev.latlng.lat, lng: ev.latlng.lng });
          return;
        }
        if (modeRef.current === 'none') return;
        const span = spanAt(ev.latlng.lat, ev.latlng.lng);
        if (!span) return;
        // Touch devices never fire mousemove, so without this a tap selects a
        // path with no visual confirmation of WHICH path was hit.
        hoverRef.current = span.indices.join(',');
        drawHover(span.indices);
        void openPath(ev.latlng.lat, ev.latlng.lng);
      });

      /*
       * Leaflet caches its container size and only recomputes it when told.
       * Collapsing the agent dock widens the map by 330px, and without this the
       * newly exposed strip never gets tiles — it just sits blank white against
       * an otherwise dark map. A ResizeObserver covers every cause: the dock,
       * the mobile sheet, and the window itself.
       */
      const ro = new ResizeObserver(() => m.invalidateSize({ animate: false }));
      if (holder.current) ro.observe(holder.current);
      resizeObs.current = ro;

      setPlaces(data.places);
      const pick = (want: string, kind: Place['kind']) =>
        data.places.find((p) => p.name.toLowerCase().includes(want))?.name ??
        data.places.find((p) => p.kind === kind)?.name ??
        '';
      setFrom(pick('b3 block', 'hostel'));
      setTo(pick('zanak', 'dest'));
      setReady(true);
    })();

    return () => {
      cancelled = true;
      resizeObs.current?.disconnect();
      resizeObs.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  /**
   * The stretch under the cursor that a report would cover.
   *
   * Mirrors spanAt() on the server exactly — same path, nearest segments first,
   * stopping at MAX_REPORT_M — so the highlight the user sees IS what gets
   * recorded. Segment order matches /api/graph, so indices are sent as-is.
   */
  function spanAt(lat: number, lng: number): { indices: number[]; meters: number } | null {
    const z = map.current?.getZoom() ?? 16;
    // ~25 m at z16, tightening as you zoom in so dense areas stay selectable.
    const grab = 25 * Math.pow(2, 16 - z);

    let seed = -1;
    let bd = Infinity;
    const segs = segRef.current;
    for (let i = 0; i < segs.length; i++) {
      const d = distToSeg(lat, lng, segs[i]);
      if (d < bd) {
        bd = d;
        seed = i;
      }
    }
    if (seed < 0 || bd > grab) return null;

    const wayId = segs[seed][7];
    const ranked: { i: number; d: number }[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (segs[i][7] !== wayId) continue;
      ranked.push({ i, d: distToSeg(lat, lng, segs[i]) });
    }
    ranked.sort((a, b) => a.d - b.d);

    const indices: number[] = [];
    let meters = 0;
    for (const { i } of ranked) {
      const s = segs[i];
      const len = Math.hypot(
        (s[2] - s[0]) * 111320,
        (s[3] - s[1]) * 111320 * Math.cos((s[0] * Math.PI) / 180),
      );
      if (indices.length && meters + len > MAX_REPORT_M) continue;
      indices.push(i);
      meters += len;
      if (meters >= MAX_REPORT_M) break;
    }
    return { indices, meters: Math.round(meters) };
  }

  function drawHover(indices: number[] | null) {
    const L = LRef.current;
    const layer = hoverLayer.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (!indices?.length) return;
    for (const i of indices) {
      const s = segRef.current[i];
      if (!s) continue;
      L.polyline(
        [
          [s[0], s[1]],
          [s[2], s[3]],
        ],
        { color: '#ffffff', weight: 9, opacity: 0.45, lineCap: 'round' },
      ).addTo(layer);
    }
  }

  /**
   * Draw the network.
   *
   * `focus` is the set of segment indices on the planned route. When it is set,
   * everything else drops to a faint outline and stops glowing — 71% of this
   * campus is lit, so at full strength the gold drowns the very route the user
   * just asked for. Focused, the question becomes readable: which parts of MY
   * walk are lit, and which are not.
   */
  function paintSegments(segments: Segment[], focus: Set<number> | null) {
    const L = LRef.current;
    if (!L || !baseLayer.current || !glowLayer.current) return;
    baseLayer.current.clearLayers();
    glowLayer.current.clearLayers();

    for (let i = 0; i < segments.length; i++) {
      const [aLat, aLng, bLat, bLng, risk, darkness, exposure] = segments[i];
      const line: [number, number][] = [
        [aLat, aLng],
        [bLat, bLng],
      ];

      // Off-route while a walk is being shown: present, but out of the way.
      if (focus !== null && !focus.has(i)) {
        L.polyline(line, { color: C.muted, weight: 1, opacity: 0.55 }).addTo(baseLayer.current);
        continue;
      }

      /*
       * A tunnel is not a dark path, it is a different KIND of path. The
       * subway underpass is enclosed and artificially lit; colouring it by
       * darkness said something false about it. Dashed cyan reads as
       * "structure", not "hazard".
       */
      // Marked impassable on the ground: drawn, but visibly struck out, so a
      // surveyor can see their own work and nobody mistakes it for a route.
      if (blockedRef.current.has(i)) {
        L.polyline(line, {
          color: C.blocked,
          weight: 1.6,
          opacity: 0.5,
          dashArray: '2 5',
        }).addTo(baseLayer.current);
        continue;
      }

      if (tunnelsRef.current.has(i)) {
        L.polyline(line, {
          color: C.tunnel,
          weight: (focus ? 2 : 0) + 2.6,
          opacity: 0.85,
          dashArray: '6 4',
        }).addTo(baseLayer.current);
        continue;
      }

      // Flat colour everywhere. Nothing on the network glows — the glow is
      // reserved for the safer route, where it means "take this one".
      /*
       * Dark AND busy is the one combination the product exists to surface, so
       * it gets a fire-brick bloom in the blurred pane. Not another colour to
       * decode — just weight of presence, so the eye lands there first.
       */
      if (darkness > DARK_AT && exposure > 0.12) {
        L.polyline(line, {
          color: C.darkDeep,
          weight: 9,
          opacity: 0.5,
          renderer: glowRenderer.current ?? undefined,
          pane: 'glow',
        }).addTo(glowLayer.current);
      }

      L.polyline(line, {
        color: segColor(darkness),
        weight: (focus ? 1.6 : 0) + segWeight(exposure, darkness),
        opacity: focus ? 1 : segOpacity(darkness),
      }).addTo(baseLayer.current);
    }
  }

  /**
   * The safer route, drawn as a filament: a wide amber bloom in the blurred
   * pane with a near-white core on top. This is the ONLY thing on the map that
   * glows, so "the lit way home" is the single thing the eye is drawn to.
   */
  function drawRoutes(p: RoutePair) {
    const L = LRef.current;
    const layer = routeLayer.current;
    if (!L || !layer || !glowLayer.current) return;
    layer.clearLayers();

    // Shortest route: a thin dashed reference line. Its danger is already
    // visible underneath in red, which is the comparison being made.
    layer.addLayer(
      L.polyline(p.shortest.coords, {
        color: '#E8ECF4',
        weight: 2,
        opacity: 0.85,
        dashArray: '2 6',
        lineCap: 'round',
      }),
    );

    for (const [w, o] of [
      [16, 0.28],
      [9, 0.45],
    ] as const) {
      L.polyline(p.safest.coords, {
        color: C.bulbGlow,
        weight: w,
        opacity: o,
        lineCap: 'round',
        renderer: glowRenderer.current ?? undefined,
        pane: 'glow',
      }).addTo(glowLayer.current);
    }

    layer.addLayer(
      L.polyline(p.safest.coords, {
        color: C.bulbCore,
        weight: 3,
        opacity: 1,
        lineCap: 'round',
      }),
    );
  }

  async function refreshGraph() {
    const fresh: { segments: Segment[]; stats: Stats; tunnels?: number[]; blocked?: number[] } =
      await fetch('/api/graph').then((r) => r.json());
    tunnelsRef.current = new Set(fresh.tunnels ?? []);
    blockedRef.current = new Set(fresh.blocked ?? []);
    segRef.current = fresh.segments;
    setStats(fresh.stats);
    // Repainting clears the glow pane, so any live route must be redrawn.
    paintSegments(fresh.segments, focusRef.current);
    if (planRef.current) drawRoutes(planRef.current);
  }

  /** Resolve the clicked path and show it for confirmation — never fire blind. */
  async function openPath(lat: number, lng: number) {
    try {
      const d: PathInfo = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      }).then((r) => r.json());
      setSelected(d);
    } catch {
      toast.error('Could not identify that path.');
    }
  }

  async function submitReport(span: number[], dark: boolean) {
    try {
      const r = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ span, dark }),
      }).then((x) => x.json());

      setReports(r.totalReports);
      await refreshGraph();
      setSelected(null);
      hoverRef.current = null;
      drawHover(null);

      toast.success(`${r.label} · ${r.meters} m — ${dark ? 'reported unlit' : 'reported lit'}`, {
        description:
          `${r.verdict} Darkness ${Math.round(r.darknessBefore * 100)}% → ${Math.round(r.darknessAfter * 100)}%.` +
          (r.queueRank > 0
            ? ` Repair queue #${r.queueRank}${r.darkReports + r.litReports < 2 ? ', unconfirmed' : ''} — ${r.benefitPct}% of campus risk.`
            : ' Too little foot traffic to enter the repair queue.'),
        duration: 7000,
      });
    } catch {
      toast.error('Could not file that report.');
    }
  }

  async function submitSurvey(span: number[], patch: SurveyPatch) {
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...surveyor.headers() },
        body: JSON.stringify({ span, ...patch }),
      });
      if (!res.ok) {
        toast.error('Could not save that survey.');
        return;
      }
      const r = await res.json();
      await refreshGraph();
      setSelected(null);
      hoverRef.current = null;
      drawHover(null);

      const word = patch.lighting === 'dark' ? 'unlit' : patch.lighting === 'dim' ? 'dim' : 'lit';
      toast.success(
        patch.lighting
          ? `${r.label} · ${r.meters} m marked ${word}`
          : `${r.label} · ${r.meters} m updated`,
        {
          description:
            (patch.traffic ? `Foot traffic set to ${patch.traffic}. ` : '') +
            (patch.note ? 'Note saved. ' : '') +
            (r.queueRank > 0
              ? `Repair queue #${r.queueRank} — ${r.benefitPct}% of campus risk.`
              : 'Not enough foot traffic to enter the repair queue.'),
        },
      );
    } catch {
      toast.error('Could not save that survey.');
    }
  }

  /** Withdraw a survey over a span, back to the modelled estimate. */
  async function submitClearSurvey(span: number[]) {
    try {
      const res = await fetch(`/api/survey?span=${span.join(',')}`, {
        method: 'DELETE',
        headers: surveyor.headers(),
      });
      if (!res.ok) {
        toast.error('Could not undo that survey.');
        return;
      }
      const r = await res.json();
      await refreshGraph();
      setSelected(null);
      hoverRef.current = null;
      drawHover(null);
      toast.success(`${r.label} — survey withdrawn`, {
        description: 'That stretch is back on the modelled estimate.',
      });
    } catch {
      toast.error('Could not undo that survey.');
    }
  }

  async function submitBlock(span: number[], blocked: boolean) {
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...surveyor.headers() },
        body: JSON.stringify({ span, blocked }),
      });
      if (!res.ok) {
        toast.error('Could not save that.');
        return;
      }
      await refreshGraph();
      setSelected(null);
      hoverRef.current = null;
      drawHover(null);
      toast.success(blocked ? 'Marked as not walkable' : 'Unblocked');
    } catch {
      toast.error('Could not save that.');
    }
  }

  function toggleMode(next: MapMode) {
    const value = mode === next ? 'none' : next;
    setMode(value);
    modeRef.current = value;
    setSelected(null);
    setDraft(null);
    hoverRef.current = null;
    drawHover(null);
  }

  async function refreshCheckpoints() {
    try {
      const d = await fetch('/api/checkpoints').then((r) => r.json());
      setCheckpoints(d.checkpoints ?? []);
      drawCheckpoints(d.checkpoints ?? []);
    } catch {
      /* map still works without them */
    }
  }

  /** Checkpoints are always visible; only editing them needs surveyor rights. */
  function drawCheckpoints(list: Checkpoint[]) {
    const L = LRef.current;
    const layer = cpLayer.current;
    if (!L || !layer) return;
    layer.clearLayers();

    for (const c of list) {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 6,
        color: '#0b0f14',
        fillColor: kindColour(c.kind),
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(`${c.name}${c.note ? ` — ${c.note}` : ''}`, { direction: 'top' });

      marker.on('click', (ev: L.LeafletMouseEvent) => {
        // MUST be the Leaflet event, not ev.originalEvent. Leaflet decides
        // whether to keep propagating by checking `originalEvent._stopped`, a
        // flag only L.DomEvent sets — calling the native stopPropagation on the
        // raw DOM event leaves it unset. So the map's own click handler still
        // ran afterwards, and in 'place' mode it replaced the point we had just
        // opened with a blank new one. That is why an existing point could
        // never be edited or deleted, only duplicated.
        L.DomEvent.stopPropagation(ev);
        if (modeRef.current === 'place') setDraft(c);
      });
      marker.addTo(layer);
    }
  }

  async function saveCheckpoint(c: Checkpoint) {
    try {
      const res = await fetch('/api/checkpoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...surveyor.headers() },
        body: JSON.stringify(c),
      });
      if (!res.ok) {
        toast.error('Could not save that point.');
        return;
      }
      setDraft(null);
      await refreshCheckpoints();
      toast.success(`${c.name} saved`);
    } catch {
      toast.error('Could not save that point.');
    }
  }

  async function removeCheckpoint(id: string) {
    try {
      const res = await fetch(`/api/checkpoints?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: surveyor.headers(),
      });
      if (!res.ok) {
        toast.error('Could not delete that point.');
        return;
      }
      setDraft(null);
      await refreshCheckpoints();
      toast.success('Point deleted');
    } catch {
      toast.error('Could not delete that point.');
    }
  }

  function clearRoute() {
    setPlan(null);
    focusRef.current = null;
    planRef.current = null;
    routeLayer.current?.clearLayers();
    paintSegments(segRef.current, null);
  }

  async function findRoute() {
    if (!from || !to || from === to) return;
    setLoading(true);
    try {
      const p: RoutePair = await fetch('/api/route-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, atMinutes }),
      }).then((r) => r.json());
      setPlan(p);

      const L = LRef.current;
      if (!L || !map.current) return;

      // Nothing legal exists: show the whole campus and draw no line at all.
      // Drawing one would be the app insisting on a walk that cannot be made.
      if (p.status === 'closed') {
        focusRef.current = null;
        planRef.current = null;
        routeLayer.current?.clearLayers();
        paintSegments(segRef.current, null);
        return;
      }

      // Focus on both routes together: the comparison is the whole point, so
      // muting the shortest one would hide what the safer route is avoiding.
      // paintSegments clears the glow pane, so it must run before drawRoutes.
      focusRef.current = new Set([...p.shortest.segments, ...p.safest.segments]);
      planRef.current = p;
      paintSegments(segRef.current, focusRef.current);
      drawRoutes(p);

      map.current.fitBounds(
        L.polyline(p.safest.coords).getBounds().pad(0.18),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative h-full ${mode === 'none' ? '' : '[&_.leaflet-container]:cursor-crosshair'}`}
    >
      <div ref={holder} className="absolute inset-0" />

      {/* Desktop: a column down the left. Phone: a sheet along the bottom that
          never covers more than half the map, because the map is the point. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex max-h-[48dvh] flex-col gap-3 overflow-y-auto p-3 pr-[4.75rem] sm:inset-y-0 sm:right-auto sm:max-h-none sm:w-full sm:max-w-sm sm:p-4 sm:pr-4">
        <div className="pointer-events-auto rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <PlaceSelect places={places} value={from} onChange={setFrom} />
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            <PlaceSelect places={places} value={to} onChange={setTo} />
          </div>
          <div className="mt-2 space-y-2">
            <select
              value={atMinutes === null ? '' : String(atMinutes)}
              onChange={(e) => setAtMinutes(e.target.value === '' ? null : Number(e.target.value))}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
              aria-label="Time of walk"
            >
              <option value="">Any time — ignore gate closures</option>
              {[
                [20 * 60, '8:00 pm'],
                [21 * 60, '9:00 pm'],
                [21 * 60 + 30, '9:30 pm — hostel gate shut'],
                [22 * 60, '10:00 pm'],
                [23 * 60, '11:00 pm'],
                [23 * 60 + 30, '11:30 pm — subway shut too'],
                [0, 'Midnight'],
              ].map(([v, label]) => (
                <option key={String(label)} value={String(v)}>
                  {label}
                </option>
              ))}
            </select>
            <Button className="w-full" onClick={findRoute} disabled={!ready || loading || from === to}>
              {loading ? 'Routing…' : 'Find the safer walk'}
            </Button>
            {plan ? (
              <Button variant="ghost" size="sm" className="w-full" onClick={clearRoute}>
                Show the whole campus
              </Button>
            ) : null}
          </div>
        </div>

        {draft ? (
          <div className="pointer-events-auto">
            <CheckpointEditor
              /* Remount per point: the editor seeds its fields from `draft` in
                 useState, so without this, tapping a second pin kept the first
                 pin's name in the form and saving wrote it onto the second. */
              key={draft.id ?? `new:${draft.lat},${draft.lng}`}
              draft={draft}
              onSave={saveCheckpoint}
              onDelete={removeCheckpoint}
              onCancel={() => setDraft(null)}
            />
          </div>
        ) : null}

        {selected ? (
          <div className="panel-in pointer-events-auto">
            <PathInspector
              info={selected}
              canSurvey={surveyor.authorised}
              onReport={submitReport}
              onSurvey={submitSurvey}
              onBlock={submitBlock}
              onClearSurvey={submitClearSurvey}
              onClose={() => setSelected(null)}
            />
          </div>
        ) : null}

        {plan ? (
          <div className="panel-in pointer-events-auto rounded-xl border bg-card/95 shadow-lg backdrop-blur">
            <RouteStats plan={plan} />
          </div>
        ) : null}

        {stats && !selected ? (
          <div className="panel-in pointer-events-auto rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
            <dl className="space-y-1.5 text-xs">
              <Row label="Unlit" value={`${stats.darkKm} km`} tone="amber" />
              <Row
                label="Unlit and busy"
                value={`${stats.highRiskKm} km`}
                tone="red"
              />
              {reports > 0 ? <Row label="Your reports" value={`${reports}`} tone="green" /> : null}
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Only the second line is a safety problem — the rest is unlit ground nobody walks.
            </p>
          </div>
        ) : null}
      </div>

      <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <Button
          size="sm"
          variant={mode === 'select' ? 'default' : 'secondary'}
          disabled={!ready}
          onClick={() => toggleMode('select')}
        >
          {mode === 'select' ? 'Tap a path' : 'Report a path'}
          {reports > 0 ? ` (${reports})` : ''}
        </Button>
        {surveyor.authorised ? (
          <Button
            size="sm"
            variant={mode === 'place' ? 'default' : 'secondary'}
            disabled={!ready}
            onClick={() => toggleMode('place')}
          >
            {mode === 'place' ? 'Tap map to add · pin to edit' : 'Map a point'}
            {checkpoints.length > 0 ? ` (${checkpoints.length})` : ''}
          </Button>
        ) : null}
        <SurveyorBar surveyor={surveyor} />
      </div>

      <div className="absolute bottom-4 right-16 z-[1000] hidden flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card/95 px-3 py-2 text-[11px] text-muted-foreground shadow-lg backdrop-blur sm:flex">
        <Legend color={C.lit} label="lit" />
        <Legend color={C.dim} label="dim" />
        <Legend color={C.dark} label="dark" />
        <Legend color={C.tunnel} label="underpass" dashed />
        <Legend color={C.blocked} label="not walkable" dashed />
        {plan ? <Legend color={C.bulbCore} label="safer route" glow /> : null}
        {plan ? <Legend color="#E8ECF4" label="shortest" dashed /> : null}
      </div>

      {!ready ? (
        <div className="absolute inset-0 z-[1100] grid place-items-center bg-background/80 text-sm text-muted-foreground">
          Loading the campus network…
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'red' | 'green' }) {
  const color =
    tone === 'red'
      ? 'text-red-400'
      : tone === 'amber'
        ? 'text-amber-400'
        : tone === 'green'
          ? 'text-emerald-400'
          : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}

/** Hostels and destinations grouped, because that is how a student thinks about it. */
function PlaceSelect({
  places,
  value,
  onChange,
}: {
  places: Place[];
  value: string;
  onChange: (v: string) => void;
}) {
  const hostels = places.filter((p) => p.kind === 'hostel');
  const dests = places.filter((p) => p.kind === 'dest');
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground"
    >
      <optgroup label="Hostel blocks">
        {hostels.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Campus destinations">
        {dests.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function Legend({
  color,
  label,
  dashed,
  glow,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  glow?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-4 rounded"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 4px)` }
            : { backgroundColor: color, boxShadow: glow ? `0 0 8px 2px ${C.bulbGlow}` : undefined }
        }
      />
      {label}
    </span>
  );
}
