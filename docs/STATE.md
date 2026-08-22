# Project State — Nightline

> The handoff file. Read this first; update it before ending a session.
> If it is accurate you can `/clear` freely and lose nothing.

**Live:** https://sweetjalapenos.vercel.app · **Repo:** electricwhitener/hack11 · branch `main`
Every push to `main` auto-deploys to Vercel.

---

## Where things stand

**Round 1 passed. Round 2 closes 00:00, 23 Aug 2026.**

| Deliverable | Status |
|---|---|
| Working prototype | Done and deployed |
| Publicly testable URL | Done — no login required |
| **3-minute demo video** | **NOT STARTED — this is the gap** |

The owner is surveying campus on foot from ~19:00 on 22 Aug: gates, fences, then
lighting. Structural data (blocks/gates) comes first because it changes what the
model thinks people walk; lighting is surveyed onto the corrected map afterwards.

---

## What the product is

**Problem statement 17 — Smart Cities.** Street-light repair queues run on
complaint order, so busy night-walking routes stay dark while quiet lanes get
fixed. Nightline computes which paths students actually walk after dark —
derived, because no official footfall data exists anywhere — multiplies that by
how likely each path is to be unlit, and uses the result to:

1. route walkers around dark busy paths, honouring gate closures, and
2. rank repairs by how much risk each fix removes.

**The computation carries the product; the agent explains it.** Turn the AI off
and the map, routing and queue still work. That is the whole thesis — protect it.

Area: **Manipal University Jaipur, Dehmi Kalan**. All 32 landmarks (B1–B7,
G2–G4, AB1, AB2, Central Library, zanak, BABA, Bluedove Mess, TMA Pai
Auditorium, Subway) come from OpenStreetMap, mapped by MUJ students. Nothing
about the campus is invented.

---

## The computation layer — `web/src/lib/nightsafety.ts`

Everything below is deterministic. Read this file before changing behaviour.

**Exposure (foot traffic).** Every hostel block routed to every destination —
1,430 modelled night trips. This is an *estimate*, never a measurement. Say so.

**Darkness is a probability, not a flag.** Beta posterior:
`darkness = (alpha + darkReports) / (alpha + beta + total)`.
Prior strength by source: `survey` 8, `osm` 4, `simulated` 1.5. One citizen
report moves a seeded path to ~0.52, two to ~0.66, three to ~0.73; a dissenting
report pulls it back. A path stays badged **unconfirmed** until two people agree
— this is the anti-gaming answer, and it is visible in the UI, not just claimed.

**Light bleed.** A lamp lights the far side of a road too. Darkness falls off
with distance from the nearest lit segment: lit within 3 m, interpolated to dim
by 7 m, dark beyond. Only ever *reduces* darkness, and never overrides a survey.
Distance is **segment-to-segment**, not midpoint-to-midpoint — the midpoint
shortcut made parallel sides of one road read as distant, which was the original
B3-to-zanak bug. Neighbours are indexed once at module load with latitude
bucketing; per-request would be 3.5M distance tests per page view.

**Risk = effectiveExposure × darkness.** Drives routing weight and the queue.

**Routing returns one of three outcomes** (`RouteStatus`):
- `ok` — a fully legal route exists
- `permission` — the only way needs a permit (outpass). Route IS drawn, with the
  requirement stated: a student holding one really can walk it
- `closed` — nothing legal exists. **No route is drawn.** Telling somebody they
  cannot get there beats sending them 2.5 km to a locked gate

**The hostel gate is the only permission barrier**, 21:00–06:00, and it is the
only thing that should ever produce an outpass alert. Its note is
direction-aware: a portal may carry `enterNote`, used when the walk ENDS in the
first zone it connects, because "leaving needs an outpass" is the wrong sentence
for somebody trying to get back into their own block at midnight.

**A shut gate stops you passing through it; it does not make the pavement beside
it disappear.** The university-entrance rule used to match `/university
entrance/` against 18 segments, including footpaths and walkways that run PAST
the gate and never leave campus. Shutting those at 11pm cut a corner of campus
in half and made late walks read `closed` when the real obstacle was nowhere
near the hostel. It matches carriageways only now. Anything that governs
crossing BETWEEN zones belongs in `PORTALS`, not in a label rule.

**Zones and portals** decide reachability *before* any graph search:
`hostel <-> campus` via subway + hostel gate; `campus <-> outside` via the three
university entrances. Graph-only routing kept finding perimeter geometry no
matter how many gates were shut, so zone reachability is checked first.
A `hard` door past its hour is shut to everyone; a `permission` door is not.

`ACCESS_RULES` and `PORTALS` live in **code, matched on path label** — NOT baked
into `graph.json`. Regenerating the graph renumbers segments, and surveys are
keyed by index, so rules in the graph could not be edited mid-survey.

**Placed gates** (added 22 Aug) are the third source of legality, and the only
one editable from the phone. A checkpoint carries `barrier` / `closes` / `opens`
/ `permit` and is resolved to the segments it physically controls **by lat/lng
at load time** — never by segment index, so a graph rebuild re-finds it rather
than pointing at whatever segment inherited the number.

A barrier with **no hours is shut at every hour, including when no time is
selected** — that is what "authorised personnel only, always closed" means on
the ground: a wall, not a schedule. Set it in the point editor under *Can this
be walked through?*. The note field is prose for walkers and is read by nobody.

---

## Data — Postgres (Supabase project `ljuyjziswmocgxslplfk`)

| Table | Holds |
|---|---|
| `path_reports` | citizen reports: `segment_idx`, `dark_count`, `lit_count` |
| `path_surveys` | surveyed truth: `lighting` (lit/dim/dark), `traffic`, `blocked`, `note` |
| `checkpoints` | surveyor-placed points: gates, security, shops, and gate hours |
| `place_overrides` | corrections to imported landmarks: `hidden`, `display_name` |

Migrations applied: `docs/sql/002_survey.sql`, `docs/sql/003_blocked.sql`.
**Must be run:** `004_gates.sql` (gate hours) and `005_places.sql` (landmark
corrections). Both degrade rather than fail until then — PostgREST 400s a whole
select over one unknown column, so reads fall back to the base columns and
gates simply stay unarmed instead of every checkpoint vanishing from the map.
**Not yet applied:** a `route_demand` table — see Pending.

**Imported landmarks cannot be deleted at source.** The 32 OSM landmarks live in
`graph.json`, which is frozen. `place_overrides` overlays hidden/renamed on top,
keyed by the original name; `findPlace` still resolves the imported name after a
rename so saved routes do not break. `zoneOfNode` deliberately still reads the
FULL list — zones decide whether a journey is possible at all, and re-deriving
them from a shrinking set of landmarks would let hiding a shop silently
reclassify the ground around it. Hiding also cannot un-bake exposure: the
modelled trips to that landmark are already in `graph.json`.

Postgres is the source of truth; the in-memory maps are per-instance caches
refilled by `loadAll()` at the start of every request that reads them.
**Any new read of report or survey state must `await loadAll()` first.**

---

## Traps that have already cost time

**Vercel runs multiple lambdas.** Module-level state does not persist or share —
measured: 1 read in 20 saw zero reports before persistence landed.

**Next gives route handlers and server components separate module registries.**
A plain module-level Map is invisible across them. Report state lives on
`globalThis` with a version counter; `sync()` folds in changes from elsewhere.

**Deleting routes leaves stale `.next/dev/types`** and `tsc` fails with parse
errors inside generated files. `rm -rf .next` and rebuild.

**`.env.local` is invisible to Vercel.** Keys added locally look fine while
production runs on one. Check `GET /api/health` — it reports counts only, never
values, so it is safe to leave public.

**Segment indices shift if `precompute.py` is re-run.** Surveys are keyed by
index. Do NOT regenerate the graph once surveying has begun. Structural changes
must land before, or be expressed as code rules / DB rows instead.

**The map subtree must stay `isolate`d** in `page.tsx`. Leaflet paints panes up
to z-800, map overlays sit at z-1000+, and without a stacking context the agent
Sheet (portaled to body at z-50) opens *underneath* the map.

**Auth is optional — do not re-add the gate.** `/` was redirecting signed-out
visitors to `/login`, so anyone opening the link hit a signup form before seeing
anything. Nothing requires auth; signing in only saves conversations.

**Do not touch `web/src/lib/ai/provider.ts`.** Model choice and the fallback
chain were tuned against measured quota data. 3 keys × 5 models = ~300 req/day.
One agent message costs roughly 4 requests.

---

## Design system

**Theme** (`globals.css`): warm-neutral tokens, UI accent **teal** (hue 195) —
deliberately off the warm axis so it never competes with the map. Chrome
*recedes*: cards and header sit darker than the page so the map is the brightest
thing on screen.

**The lit layer recedes** (22 Aug). 1,500 of 1,883 segments are lit; drawing
them at 0.85 opacity meant four fifths of the map was bright reassurance and the
0.2 km of unlit-and-busy had to compete with it. Lit now sits at 0.26 and draws
thin, and foot traffic thickens a dark path far more than a lit one — a busy lit
path is the best case on the map. **Problems only** drops everything lit to a
faint ghost; drawn, not hidden, because 19 red segments on an empty canvas say
nothing about where they are. That toggle is the map moment for the video.

**Foot traffic is shown as words, never as a number.** Exposure is a unitless
modelled index and its distribution is severely skewed — median 0.011, p95 0.22
— so printing `0.234` claimed precision we do not have, and fixed cutoffs put
99% of the network in one bucket (every row of the repair queue read "Quiet",
including the top-ranked one). `exposureBand()` derives Busy/Some/Quiet from
**percentiles of the graph at load time**, so "busy" means busy *for this
campus* and survives a rebuild. Used by the queue and the path inspector.

**The chat card is deliberately bare** — a heading, one line, nothing to click.
The starter prompts were removed: half demonstrated nothing, and a canned prompt
frames the agent as the product when the thesis is the opposite. The "Try a
proactive alert" button was removed too — it pushed a *fabricated* notification,
which is the one thing this product must never be caught doing on camera.

**Map controls are one panel**, fixed width, stable labels, view control
separated from survey tools. They were four free-floating buttons whose active
labels changed length, so the stack reflowed on every click.

**Map palette** — one continuous saturated ramp, no mint:

| | | |
|---|---|---|
| lit | `#13A34B` | Dartmouth green lifted for a dark canvas |
| dim | `#F8B324` | xanthous |
| dark | `#EB442C` | cinnabar |
| dark + busy | `#BC2023` | fire-brick bloom in the blurred glow pane |
| underpass | `#5B9DFF` | a different KIND of path, not a darkness |
| not walkable | `#4A4A52` | deliberately recessive |

Colour says exactly one thing: **how lit a path is**. It used to encode risk,
which folded in modelled foot traffic and claimed precision we do not have.
**Foot traffic is line WEIGHT instead** — emphasis, not a claim, and a bad
estimate makes a line slightly too thick rather than the wrong colour.

Hierarchy comes from hue temperature (cool recedes, warm advances), opacity and
weight — never from desaturation. Basemap: `brightness(1.55) saturate(0.25)`.

---

## Surveyor mode

Passcode-gated via `SURVEY_PASSCODE` (set in Vercel Production). Entered once,
kept on the device — surveying happens on a phone on a dark path, where a
sign-in form is how a survey does not get done. It protects data quality, not
secrets.

Unlock: map → top right → **Surveyor**. Then:
- **Report a path** → tap → *Lit / Dim / Unlit*, an optional traffic correction,
  and **"Not walkable — block it"** for fences and walls
- **Map a point** → tap → name + kind. **Gate goes both ways**; Entry only /
  Exit only exist for genuinely one-way cases

Reports are capped at **50 m** per action — a long path is rarely dark end to
end. `spanAt()` exists in both `nightsafety.ts` and `DarkZoneMap.tsx` and the
two MUST stay in step; the client sends the exact indices it highlighted.

**Correcting a mistake made in the field** (fixed 22 Aug, after the first pass
found none of it worked):
- **A point** — in *Map a point* mode, tap the pin itself. Edit or delete it,
  delete asks twice. Tapping the pin used to open a blank *New point* form
  instead, because the marker's own click was immediately overwritten by the
  map's; there was no way to reach delete at all.
- **A path** — *Not walkable → tap to unblock* now works; it returned 400 every
  single time. Fixing lighting, traffic, a note or a block no longer wipes the
  others: `/api/survey` takes a **patch**, and only what you send is written.
- **Withdraw a survey** — *Undo this survey* in the inspector, or
  `DELETE /api/survey?span=…`. Overwriting a wrong survey with a different value
  still reads as prior-strength-8 ground truth; retracting is the honest fix.

`npx tsx scripts/survey-check.ts` drives every surveyor endpoint against a fake
Postgres — no network, safe to run mid-survey. Run it after touching any of this.

---

## Current figures (regenerate, never retype)

`cd web && npx tsx scripts/facts.ts` writes `docs/facts.json`.

| | |
|---|---|
| Area | 49.7 km, 1,883 segments |
| Lighting | 1,500 lit · 46 dim · 337 dark |
| Unlit | 7.5 km (15%) |
| Unlit AND busy | 19 segments, 0.2 km |
| Model | 10 hostels → 22 destinations, 1,430 trips |
| Real OSM lighting tags | 68 segments |
| Repair queue | top 5 remove 13.1% of campus risk |

**These will change once survey data lands. Regenerate before quoting them.**

Time-aware demo sequence (Central Library → B3 Block, walking home):
`20:00 ok 339 m` · `21:00 ok 432 m` · `23:00 permission — outpass to get back in`
`02:00 permission` (the window wraps midnight) · `06:00 ok 339 m`

---

## Pending

1. **The video** — 3 minutes, due midnight. Nothing written yet. Strongest
   sequence is the time progression above, then the repair queue, then the
   agent explaining a ranking.
2. **Route-demand logging** — owner-approved, not built. Log each route search
   per segment so usage becomes observed footfall, correcting the estimate the
   same way surveys correct seeded lighting. Needs a `route_demand` table.
3. **Survey data** — arrives ~19:00. Blocking the perimeter is the highest-value
   item: until the fence line is marked, midnight routes still find a 2.5 km
   perimeter loop (the status is correct, the distance is not).
4. **Multiple entrances per block** — once AB1 North / AB1 South exist as
   checkpoints, the destination picker should offer them separately.

---

## Verify before claiming done

```
cd web && npx tsc --noEmit && npm run build
curl -s https://sweetjalapenos.vercel.app/api/health | python -m json.tool
```

Never report a feature complete without the first line. Check production with
the second — local success says nothing about the deployment.
