# Nightline

**Street-light repairs run first-come, first-served. That is a queue with no priority — so the path most students walk home on waits behind a lane nobody uses.**

Nightline computes which paths people actually walk after dark, multiplies that by how likely each path is to be unlit, and uses the result to do two things: route walkers around dark busy paths, and rank repairs by how much risk each fix removes.

**Live:** https://sweetjalapenos.vercel.app — no login required
**Area:** Manipal University Jaipur, Dehmi Kalan · 49.7 km of paths, 1,883 segments
**Problem statement:** 17 — Smart Cities

---

## The one idea

There is no footfall data for a campus at night. Nobody counts it, and no public dataset has it. Without it, "which dark path matters?" cannot be answered, so repair queues fall back on complaint order — which measures who complains, not who is at risk.

So we derive it. Every hostel block is routed to every night destination — the library, the mess, the academic blocks, the food courts — producing **1,430 modelled night trips**. How often a path appears across those trips is its *exposure*. Multiply exposure by the probability that the path is unlit and you get **risk**, which is the number the whole product ranks on.

```
risk = effectiveExposure × darkness
```

Both halves are estimates, and the app says so everywhere it shows one.

---

## The computation carries the product; the agent explains it

This is the design rule the codebase is built around. **Turn the AI off and the map, the routing and the repair queue still work.** Every agent tool is a thin wrapper over a deterministic function in `web/src/lib/nightsafety.ts` — the model chooses *which* computation to run and puts the answer in words, but never produces a number itself.

That is why the AI is a feature and not the foundation: a judge can unplug it and the product is still there.

---

## How it works

### 1. The graph is baked offline

`py-service/precompute.py` pulls the campus from OpenStreetMap, builds the walking graph, runs the exposure model (hundreds of Dijkstras), and writes a single static `graph.json`.

**Why offline:** the exposure model is the expensive part and only changes when the map area changes. Baking it means **the live app needs no Python at all** — no sidecar to keep alive, nothing to fall over during a demo.

The campus is mapped in unusual detail by its own students, so the trip model is literal rather than statistical: a night trip here really is somebody walking from their hostel block to the library or the mess. We route exactly those, rather than assuming a distribution.

### 2. Darkness is a probability, not a flag

A path is not simply "lit" or "unlit" — we mostly do not know. Only **68 segments** on this campus carry a real lighting tag in OpenStreetMap. So darkness is a Beta posterior:

```
darkness = (α + darkReports) / (α + β + totalReports)
```

The prior is centred on the best belief available, with strength by source:

| Source | Prior strength | Meaning |
|---|---|---|
| `survey` | 8 | somebody stood there and looked |
| `osm` | 4 | a mapper recorded a lighting tag |
| `simulated` | 1.5 | our own guess from the road class |

One citizen report moves a seeded path to ~0.52, two to ~0.66, three to ~0.73. A dissenting report pulls it back.

**Why Bayesian rather than a counter:** it is the anti-gaming answer. A single person tapping "this is dark" is a claim, not a fact — treating it as truth would let one student push their own street to the top of the repair queue. A path stays badged **unconfirmed** until two people agree, and that badge is visible in the UI, not merely claimed in a pitch.

### 3. Light bleed

A lamp lights the far side of a road too. Darkness falls off with distance from the nearest lit segment — lit within 3 m, interpolated to dim by 7 m, dark beyond. It only ever *reduces* darkness, and never overrides a survey.

Distance is measured **segment-to-segment, not midpoint-to-midpoint**. The midpoint shortcut made the two parallel sides of one road read as distant from each other, which is wrong in exactly the case that matters most. Neighbours are indexed once at module load with latitude bucketing; doing it per request would be 3.5 million distance tests per page view.

### 4. Routing answers one of four ways

`RouteStatus` is deliberately not a boolean:

| Status | Meaning | Is a line drawn? |
|---|---|---|
| `ok` | a fully legal route exists | yes |
| `permission` | the only way needs a permit — an outpass | **yes**, with the requirement stated |
| `partial` | nothing reaches the destination, so this is the closest it gets | yes, with the shortfall stated |
| `closed` | nothing legal exists at this hour | **no** |

**Why `permission` draws a route:** a student holding an outpass really can walk it. Refusing would be wrong. **Why `closed` draws nothing:** telling somebody they cannot get there beats sending them 2.5 km to a locked gate.

**Why `partial` exists:** a shop set back from the road is not *shut*, it is simply not joined up to the path network. Refusing to draw anything there is the wrong kind of honesty, so the route goes as close as the network allows and says how far short it stopped — the way a maps app behaves with a pin up a private drive.

### 5. Zones and portals are checked before any graph search

Graph-only routing kept discovering perimeter geometry no matter how many gates were shut — paths that exist in OpenStreetMap but are a fence line in reality. So reachability between **zones** (`hostel`, `campus`, `outside`) is decided *first*, through **portals** (the subway underpass, the hostel gate, the university entrances). If every door between two zones is locked, no amount of clever routing changes that, and the honest answer is returned without touching the graph.

A `hard` door past its hour is shut to everyone. A `permission` door is not.

**A shut gate stops you passing through it; it does not make the pavement beside it impassable.** An earlier version matched the university entrance against every segment whose *label* mentioned it — including footpaths that run past the gate and never leave campus — which severed a corner of campus at 11pm and blamed a gate nowhere near the walk. Rules that govern crossing between zones belong in `PORTALS`, not in a label match.

---

## Where the truth comes from

Three layers, in increasing authority:

1. **Simulated** — a guess from the road class. The weakest, and the default.
2. **OpenStreetMap** — an actual lighting tag. 68 segments have one.
3. **Surveyed** — somebody walked it at night and recorded what they saw.

On top of all three sit **citizen reports** as Bayesian evidence.

### Surveyor mode

Passcode-gated, entered once and kept on the device. **Not** a Supabase login, deliberately: surveying happens on a phone on a dark path, and asking for an email and password there is how a survey does not get done. It protects data quality, not secrets — the worst a leak allows is somebody mislabelling paths, which the survey history makes visible and reversible.

A surveyor can:

- **Report a path** — lit / dim / unlit, capped at **50 m per action**, because a 200 m path is rarely dark end to end and letting one tap cover the whole way would overstate the problem badly.
- **Correct foot traffic** — pin a path into a Busy / Some / Quiet band when the model is visibly wrong on the ground. This says nothing about lighting.
- **Mark not walkable** — a fence, a wall, a lawn OpenStreetMap thinks is a path. Removed from routing entirely, which is what stops illegal shortcuts.
- **Withdraw a survey** — because overwriting a mistake with a different claim still carries survey-strength authority. Retraction has to be possible, or the strongest evidence in the model is the one thing that cannot be taken back.
- **Map a point** — shops, security posts, gates. Each becomes a searchable, routable destination.
- **Correct imported landmarks** — hide or rename an OpenStreetMap landmark that has closed or moved, without touching the frozen graph.

### Gates that actually gate

A placed point can carry `barrier` / `closes` / `opens` / `permit`, and is resolved to the segments it physically controls **by coordinate at load time — never by segment index**. Regenerating the graph renumbers every segment, so an index-keyed rule would silently point at the wrong path after a rebuild; a coordinate-keyed one re-finds itself.

A barrier with **no hours is shut at every hour**, including when no time is selected. That is what "authorised personnel only, always closed" means on the ground: a wall, not a schedule.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16** (App Router), **React 19**, TypeScript | Server components for the data-heavy pages, route handlers for the API, one deployable |
| Styling | **Tailwind v4** (CSS-first config), **shadcn/ui** on **Base UI** | No `tailwind.config.js`; theme tokens mean dark mode is handled once, not per component |
| Map | **Leaflet 1.9** with the canvas renderer | 1,883 polylines; SVG crawls, canvas does not |
| AI | **Vercel AI SDK v7** + **Google Gemini** | Streaming tool calls with a visible trace |
| Data | **Supabase Postgres** via PostgREST | Surveys, reports, checkpoints, landmark corrections |
| Auth | **Supabase Auth** (Google OAuth + email/password) | Optional — see below |
| Offline | **Python** — FastAPI, pandas, scikit-learn, OSMnx-style graph build | Runs once, ships a JSON |
| Hosting | **Vercel** | Every push to `main` deploys |

### Decisions worth explaining

**Auth is optional and the app is not gated.** `/` used to redirect signed-out visitors to `/login`, which meant anyone opening the link — a judge, someone handed the URL — hit a signup form before seeing a single thing the product does. Signing in only adds saved conversations. Auth is an upgrade, not a gate.

**Google OAuth is the primary sign-in path** because it sends no email, so it cannot be throttled by Supabase's free-tier email rate limit. Email + password is the fallback for when a venue network blocks the OAuth redirect.

**Postgres is the source of truth; module memory is only a cache.** Vercel runs multiple lambdas and module-level state neither persists nor is shared — measured: 1 read in 20 saw zero reports before persistence landed. Next also gives route handlers and server components separate module registries, so report state lives on `globalThis` with a version counter.

**The graph is frozen.** Surveys are keyed by segment index, so re-running `precompute.py` mid-survey would silently point tonight's fieldwork at the wrong paths. Everything that could have been baked into the graph — access rules, gates, landmark corrections — lives in code or in Postgres instead, so it can be edited without a rebuild.

**Colour on the map says exactly one thing: how lit a path is.** It used to encode risk, which folded in modelled foot traffic and claimed a precision we do not have. Foot traffic is **line weight** instead — emphasis rather than a claim. A bad estimate makes a line slightly too thick, not the wrong colour.

**Foot traffic is shown as words, never as a number.** Exposure is a unitless index whose distribution is severely skewed (median 0.011, p95 0.22), so printing `0.234` claims precision that does not exist. Busy / Some / Quiet are derived from **percentiles of this network at load time**, so "busy" means busy *for this campus* and keeps meaning that if the graph is ever rebuilt.

---

## The AI agent

Six tools, all thin wrappers over the computation layer:

| Tool | Does |
|---|---|
| `getAreaStats` | headline figures for the mapped area |
| `planSafeRoute` | the shortest/safest comparison, same call the map makes |
| `rankRepairQueue` | the priority-ordered repair list |
| `explainRanking` | why a given path sits where it does |
| `fileRepairRequest` | files a request — **human-in-the-loop approval required** |
| `showChart` | generative UI: returns chart data the client renders as a real chart |

The chat UI renders a **visible tool trace** — each step, its state, and its raw result behind a disclosure — so the agent is not a black box. `fileRepairRequest` pauses for explicit approval before it acts.

Model access walks **3 API keys × 5 models**, because Google's free quota is per project per model per day: an exhausted combination is normal, not exceptional, so it moves to the next one rather than failing.

---

## Small things that took real work

- **Report spans are capped at 50 m** and the client sends the exact indices it highlighted, so what you saw highlighted is what gets recorded.
- **Pins are DOM elements, not canvas shapes.** Sharing a canvas with 1,883 polylines meant the segments won hit-testing after every repaint and the pins became unclickable. Their tap target also grows to 34 px only while placing points, so it never becomes a dead zone over paths you still need to report.
- **`/api/health`** reports counts and never values, so it is safe to leave public and answers "is production actually configured?" in one request.
- **The map subtree is `isolate`d.** Leaflet paints panes up to z-800; without a stacking context the agent sheet opened *underneath* the map.
- **A ResizeObserver drives `invalidateSize`.** Collapsing the agent dock widens the map by 330 px, and without it the newly exposed strip never got tiles.
- **Zoom controls move to the top-left on phones**, where the "Ask" button and the bottom panels would otherwise sit on top of them.
- **`scripts/survey-check.ts`** runs 74 checks against a stubbed Postgres — no network, safe to run mid-survey.
- **`scripts/facts.ts`** regenerates every figure the pitch quotes into `docs/facts.json`, so slides cannot drift from what the product computes.

---

## Scope

**What it is:** a working decision tool for one real campus, with real OpenStreetMap geometry, real surveyed ground truth, and a deterministic model whose every number can be traced to an input.

**What it is not:**

- Not a measurement. Exposure is *modelled* foot traffic, never observed. The app says so wherever it shows a number.
- Not a lighting census. 68 of 1,883 segments have real lighting data; the rest is prior plus evidence, and the confidence is shown.
- Not city-scale yet. The trip model is literal because this campus is mapped in unusual detail. A general city needs a statistical origin-destination model in place of enumerated trips.

**Honest limits:** hiding an imported landmark removes it from the map and the pickers but cannot un-bake the exposure already computed through it. Zone inference reads the full landmark list on purpose, so hiding a shop cannot silently reclassify the ground around it.

---

## Practical applications

**Municipal maintenance scheduling.** The repair queue is the product for a corporation: a priority-ordered list where each row states the risk removed, replacing first-come-first-served with a scheduler that optimises for exposure to harm. On this campus, **the top five repairs remove 17.2% of all night-time pedestrian risk**.

**Campus and estate safety.** Universities, hospital campuses, industrial parks — anywhere with a private path network, gates with hours, and a night population whose movement is predictable from where they sleep and where they eat.

**Route guidance for individuals.** Walk-home routing that knows lighting *and* legality, including which gates are shut and what a permit gets you through.

**Evidence for budget requests.** "Fix these five and remove a sixth of the risk" is a fundable sentence. "Residents keep complaining" is not.

**Participatory data collection.** The survey and reporting tools are a template for gathering ground truth where no dataset exists, with the consensus rule as the defence against a single motivated actor.

---

## Running it

```bash
cd web
npm install
cp .env.example .env.local     # add Supabase + Google AI keys
npm run dev
```

The app builds and runs **without any credentials** — missing keys degrade to a visible warning rather than a failed deploy. Without an AI key the agent runs in mock mode; without Supabase, reports simply are not persisted.

Verify before claiming anything works:

```bash
cd web && npx tsc --noEmit && npm run build
npx tsx scripts/survey-check.ts        # 74 checks, no network
curl -s https://sweetjalapenos.vercel.app/api/health
```

Database migrations live in `docs/sql/` and are applied in order through the Supabase SQL editor.

### Layout

```
web/                     Next.js app — the product
  src/lib/nightsafety.ts the entire computation layer
  src/lib/ai/tools.ts    the agent's tool registry
  src/data/graph.json    the baked campus graph (frozen)
  scripts/               facts + the check suite
py-service/              offline graph build; not needed at runtime
docs/sql/                migrations, in order
docs/STATE.md            living project state
```

`web/src/lib/nightsafety.ts` is where the product lives. Read it before changing behaviour.
---
Made with lovee
Andaa & Tindaa