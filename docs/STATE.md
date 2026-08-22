# Project State

> The handoff file. Every session reads this first and updates it before ending.
> If this file is accurate, you can `/clear` freely and lose nothing.

## Product
**Problem statement 17 — Smart Cities: Night-Safety Dark-Zone Mapper.**
Street-light repair queues run on first-come complaint logs, so busy night-walking
routes stay dark while quiet lanes get fixed. We compute which streets night
pedestrians actually use — derived from the road network and night destinations,
because no official footfall data exists — multiply that by darkness, and use the
result to (a) route walkers around dark high-exposure streets and (b) rank repairs
by how much risk each fix removes. The computation carries the product; the agent
explains the numbers and drafts the municipal complaint. Delete the AI and a
working night-safety map remains.

## Deadline
**06:00, Sat 22 Aug 2026.** Mandatory deliverable is a **PPT**. A working demo is
**bonus points** toward the next round. Locked in at 01:15 with 4.8 hours left —
this is a ~5-hour sprint, NOT the 36 hours the docs elsewhere assume.

Priority: the map is built first because its screenshots are what the PPT needs.
PPT must be finished by 05:30 regardless of demo state.

## Now
**DEPLOYED at 05:10 to https://sweetjalapenos.vercel.app** — verified in
production, not just locally: `/api/graph` 1,883 segments, `/api/route-plan`
99% cut for +1 m, `/api/inspect` 48 m span, `/queue` 200.

Remaining: screenshot into `docs/shots/map.png`, then regenerate the deck
(`npx tsx scripts/facts.ts` then `python build_deck.py`) — its numbers still
predate the belief model and the 50 m cap.

## Auth is OPTIONAL — do not re-add the gate
`/` used to `redirect('/login')` for signed-out visitors, so anyone opening the
deployed link hit a signup form before seeing the product. Nothing required it:
`/api/chat` has no auth check, `/api/graph`, `/api/report` and `/api/inspect`
are open, and `/queue` was already public.

Signing in adds **only** saved conversations. `listChats()` returns `[]` on 401,
so the history list degrades cleanly. `/` is now statically prerendered.

Verified in production, signed out: map loads (1,883 segments), routing works
(99% / +1 m), inspect works, reporting works (darkness 0.2 -> 0.52, queue #2),
queue page 200, agent replies and calls `rankRepairQueue`.

## Gemini keys: adding more is CONFIG, not code
`provider.ts` already folds `GOOGLE_GENERATIVE_AI_API_KEYS` (comma-separated)
in with the single-key var and de-duplicates. Keys x models = the daily budget,
because Google's free quota is 20 req/day **per project per model**, and each
key from a different Google account is a separate project.

Currently 1 key x 5 models = 5 pairs = ~100 req/day. Four keys = ~400.

To add: put `GOOGLE_GENERATIVE_AI_API_KEYS="k1,k2,k3,k4"` in `.env.local` AND in
Vercel -> Settings -> Environment Variables (Production), then redeploy — Vercel
does not read `.env.local`.

Validate before judging with:
    cd web && DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/check-keys.ts
It probes every (key, model) pair against the live API and distinguishes an
invalid key from one that has merely spent today's quota.

## Login: Google account cannot sign in with a password
Not a password bug. **Supabase stores no password for an OAuth signup**, so
`signInWithPassword` on a Google-created account can never match — the Google
password belongs to Google. The fallback `signUp` then reports "already
registered", which read as "wrong password" and stranded people.

Supabase deliberately will not tell the client which case it is (that would
allow account enumeration), so the login page now names both causes and leads
with the Google one. A real fix would be a password-reset flow, deliberately
NOT added: it sends email, and the free tier throttles outbound mail to a few
per hour — it would fail silently mid-demo.

## Progress
- Verified against live OSM: Chandigarh has **0** mapped street lamps and only
  178/29,136 streets tagged `lit`. This finding shapes the whole product — the
  lighting layer must be collected, not downloaded.
- `py-service/precompute.py` — pulls OSM, builds the graph, runs the exposure
  model, bakes `web/src/data/graph.json` (187 KB, 1,713 nodes / 1,883 edges).
  Runs in ~18s. The live app needs no Python because of this.
- `web/src/lib/nightsafety.ts` — the computation layer. Dual-weight Dijkstra,
  repair queue, area stats. All deterministic.
- `/` — Leaflet dark-zone map + docked agent, risk-coloured, dual-route comparison.
- `/queue` — repair queue ranked by risk removed.
- `tools.ts` — 6 real tools; `runAnalysis`/`commitAction` removed.
- `prompt.ts` — rewritten; hard rule that the agent never states an uncomputed number.
- `web/scripts/facts.ts` → `docs/facts.json` → `py-service/build_deck.py` →
  `docs/Nightline.pptx` (12 slides). Every deck figure comes from the running
  code, so slides cannot drift from the product.
- Verified: `tsc --noEmit` clean, `npm run build` clean, all routes 200, agent
  correctly calls `rankRepairQueue` against the live Gemini key.

## Area: MUJ, not Chandigarh
Remapped at 02:20 to **Manipal University Jaipur, Dehmi Kalan** — judges are MUJ
people and know these paths personally. Chandigarh work is fully superseded;
`BBOX` in `precompute.py` is the only line that selects the area.

The campus turned out to be mapped in detail by its own students, so all 32
landmarks (B1–B7, G2–G4, AB1, AB2, Central Library, BABA, zanak, Bluedove Mess,
TMA Pai Auditorium, Subway) come straight from OSM. **Nothing is invented.**
That also let the trip model become literal: hostel block → library/mess/food
court, which is what students actually do at night.

## Key numbers (regenerate with facts.ts, do not retype)
| Figure | Value |
|---|---|
| Headline route | **B3 Block → zanak: 99% less dark walking for +1 m** (382 m dark → 4 m) |
| Routes with a safer alternative | 184 of 220 hostel→destination pairs, median 12% cut for 3% detour |
| Repair queue | Top 5 paths remove **19.9%** of campus night risk |
| Area | 49.7 km mapped, 14.2 km unlit (29%), 42 paths busy AND dark (0.8 km) |
| Real OSM lighting | 68 segments genuinely tagged (Chandigarh had 0) |
| Graph | 1,713 nodes / 1,883 edges / 182 KB / 1,430 modelled trips |

## Done
- **Agent**: Next.js 16 + AI SDK v7 + Gemini. Streaming, multi-step tool loop,
  human-in-the-loop approval, generative-UI charts, live status line, tool trace.
  Works signed out.
- **Quota resilience**: fallback chain across (key x model) pairs.
- **Auth**: Supabase, Google OAuth + email/password. Confirmed working in prod.
- **Chat history**: server-side per user in Postgres, RLS-isolated, behind the
  History icon in the agent dock. The ONLY thing signing in buys.
- **Python sidecar**: FastAPI + pandas/sklearn, upload/analyze/forecast.
  NOT deployed — runs on localhost only.
- **UI**: shadcn/ui (Base UI), AppShell, dark mode, notifications/toasts.

## Decisions
| Decision | Reason |
|---|---|
| Agent tools over bespoke API routes | Every capability becomes something the agent can invoke and a judge can see. |
| LLM interprets, never computes | Ground truth comes from `py-service`; the model explains it. This is what stops demo hallucination. |
| Python kept in a separate service | Lets one teammate work on analysis without touching the frontend. |
| **Pinned `gemini-3.5-flash`, NOT a `-latest` alias** | Aliases track Google's newest model, which carries the tightest free quota (`gemini-3.7-flash` = 20/day). Deprecation takes months; quota exhaustion takes minutes. |
| Fallback chain over a single model | Free tier is 20 requests/DAY/MODEL/PROJECT (verified against the live API). The chain walks every (key, model) pair, so extra keys and models multiply the daily budget. |
| `thinkingLevel: 'low'` | Halves latency (~6.4s -> ~2.6s). Do NOT use `'minimal'` — `gemini-3.7-flash` rejects it outright with INVALID_ARGUMENT, failing the whole request. |
| No LangGraph | AI SDK v7 already covers tool loops and approval. A second orchestration framework costs hours and wins no marks. |
| Supabase for auth + chat storage | One signup gives Postgres AND auth. RLS enforces per-user isolation in the database itself. |
| Google OAuth + email/password, NOT magic links or email OTP | Supabase free tier throttles outbound email to a few per hour — it would silently stop delivering if several judges signed up at once. Neither chosen method sends email. |
| App runs without Supabase configured | Missing env vars degrade to auth-free mode instead of failing the deploy. |
| Prisma client committed to git | Vercel's npm blocks dependency install scripts, so `prisma generate` cannot run there. Regenerate locally via `npm run db:generate`. Prisma is currently UNUSED — Supabase JS handles all data access. |

## App structure (rebuilt 04:30)
One screen. `/` is the map with the agent docked beside it; `/queue` is the only
other route. The 256px sidebar is gone — it spent that space on two links, and on
the map that space matters more than navigation.

- **Agent is not a destination.** It docks right of the map (collapsible, 380px),
  becomes a bottom sheet under `lg`. Questions like "why is this ranked first"
  only occur while looking at the map, so leaving the map to ask was wrong.
- **Everything personal lives in the account menu**: theme (light/dark/system),
  notifications, sign-out. Chat history is behind a History icon in the dock.
- Deleted: `/map`, `/dashboard`, `/data`, `/settings`, `ThemeToggle`,
  `NotificationBell`, `ChatWorkspace`.
- **Deleting routes leaves stale `.next/dev/types` and tsc fails with parse
  errors in generated files. `rm -rf .next` and rebuild.**

The floating "N" bottom-left is **Next.js's dev-tools indicator**, not ours. It
does not appear in production builds.

## Theme tokens — chroma, and borders that exist
Every token was `oklch(x 0 0)`: zero chroma, pure grey, with dark borders at
`oklch(1 0 0 / 10%)`. That is why the app read as one flat brick with no visible
edges. Now: all neutrals carry hue 258 at low chroma, borders are real lightness
steps (`oklch(0.335 0.018 258)` dark / `oklch(0.885 0.012 258)` light), and the
accent is amber hue 72–76 — the same lamplight the map is about.

The **basemap stays dark in both themes** on purpose: it is a night map, and the
yellow/red/violet path palette is unreadable on a light basemap.

## Map palette — separate by HUE, not by shade
An earlier version put danger on one red→maroon ramp; at map scale the two tiers
were indistinguishable and both muddied against the yellow. Categories now
differ in hue:

| Meaning | Colour |
|---|---|
| Lit | `#FFD60A` yellow |
| Dark AND busy | `#FF375F` red |
| Dark, some traffic | `#8B5CF6` violet |
| Dark, quiet | `#3E4A63` slate |
| Off-route (focus mode) | `#232838` |

**Nothing on the network glows.** The glow is spent entirely on the safer route
— two blurred amber passes (16px/0.28, 9px/0.45) under a `#FFF3B0` core — so it
reads as a lit filament and is the only thing on the map drawing the eye. The
shortest route is a thin dashed reference line; its danger is already visible in
red beneath it, which IS the comparison.

`paintSegments` clears the glow pane, so `drawRoutes` must run after it — see
`refreshGraph`, which redraws the live route after a report repaints.

**Two view states, and this matters:** 71% of this campus is lit, so at full
strength the gold drowns everything — including the route the user just asked
for. So:
- **No route planned** — whole network drawn, lit glowing, unlit on the rose axis.
- **Route planned** — every segment NOT on either route drops to a faint 1px
  outline and stops glowing. Only ~32 of 1,883 segments stay bright (1.7%), so
  "which parts of MY walk are lit" becomes the only question on screen. Both
  routes are focused, not just the safer one — the comparison is the point.
  "Show the whole campus" restores the full view.

Route lines are drawn thin (2.5px) as threads down the middle of the thicker
coloured segments beneath: you read lighting from the band, and which route it is
from the thread.

**Darkness is tested before risk in `segColor`.** Risk is exposure × darkness,
so a busy but well-lit path scores a middling risk; checking risk first painted
the busiest lit paths amber-yellow and denied them the glow — backwards. Glow is
on lit paths ONLY: it *is* the lamplight, and putting it on danger too would make
everything look important.

## Reports are capped at 50 m
`MAX_REPORT_METERS = 50`. A path can be 200 m long and dark for 40 of them, so a
report covers a bounded stretch, not the whole way. Reports are therefore keyed
by **segment index**, not way id.

`spanAt()` exists in both `nightsafety.ts` and `DarkZoneMap.tsx` and the two must
stay in step — same path, nearest segments first, stop at the cap. The client
sends the exact indices it highlighted, so what the user sees IS what is
recorded. `/api/graph` emits segments in `EDGES` order, which is what makes
indices portable. `trimSpan()` re-enforces the cap server-side.

Known edge case: a single segment longer than 50 m is still reportable whole
(58 m observed), because the alternative is being unable to report it at all.

## What one report is worth (the anti-gaming answer)
Darkness is a **probability**, not a flag. Each path starts with a Beta prior
centred on what we already believe; every report is one observation:

    darkness = (alpha + darkReports) / (alpha + beta + totalReports)

Prior strength by source: `survey` 8, `osm` 4, `simulated` 1.5 — so casual
reports cannot casually overturn a fact somebody checked on foot. On a seeded
path: 1 report → 0.52, 2 → 0.66, 3 → 0.73. A dissenting "it's lit" pulls it back
(2 dark + 1 lit → 0.51).

A path stays badged **unconfirmed** in the repair queue until two people agree.
One report raises a question; it does not settle it. This is the honest answer
to "can't one student spam it to the top?" — and it is visible in the UI rather
than asserted in the pitch.

`repairQueue()` includes a path when `darkness > 0.5`, and carries
`status: confirmed | reported | estimated` plus `confidence`.

## TRAP: Next gives route handlers and pages separate module instances
Module-level state does **not** flow between `/api/*` and a server component.
A report filed via `/api/report` was invisible to `/queue` — the map changed and
the queue did not. Reports therefore live on `globalThis` (`__nightlineReports`)
with a version counter; every read path calls `sync()` to fold in changes made
by another instance. If you add a new read of report state, call `sync()` first.

## Adding local ground truth
`docs/campus-data.json` is the human-editable file OSM cannot supply. Four lists:
`blocked` (paths that cannot be walked), `lighting` (surveyed lit/unlit),
`landmarks` (places OSM is missing), `emergency` (security posts, medical).
Each entry is located by a lat/lng point, snapped to the nearest path, applied
to the **whole way**, not one segment.

Blocked paths are removed from the graph *before* the exposure model runs, so
foot traffic reroutes the way people really walk rather than through a gate
that is locked at 10pm.

To get coordinates: `/map` → **Inspect** → click a path. It identifies the path
and copies a ready-to-paste JSON line to the clipboard. Then re-run
`python precompute.py` and `npx tsx scripts/facts.ts`.

Precedence for lighting: **survey > OSM tag > class-based seed.**

## Prior art: LumePath (AaravB25/macathon)
Same shape as us — precompute an OSM walk graph, weight edges, Dijkstra twice,
return shortest + safest. Worth knowing what differs:

| | LumePath | Nightline |
|---|---|---|
| Edge weight | road class + `lit` tag only | **exposure × darkness** |
| Foot traffic | not modelled at all | the core of the product |
| Safety score | frontend heuristic, base 58, magic numbers | every figure computed |
| Deps | osmnx, Mapbox, Firebase | raw Overpass, Leaflet, no paid tier |

**Their model cannot tell a dark empty alley from a dark busy shortcut.** That
distinction is exactly what PS17 asks for, and it is our whole differentiator.
They also hit the same wall we did — municipal lighting data has huge gaps — and
pivoted to OSM. That works in Melbourne; in India OSM has near-zero coverage,
which is why we derive exposure and crowdsource lighting instead.

Inherited: the plain-language "why this route" list under the route stats.
Deliberately not inherited: their arbitrary 0–100 score, osmnx, Mapbox, Firebase.

## Blocked / Known broken
- **Screenshots missing from the deck.** Slide 8 has a placeholder. Save PNGs to
  `docs/shots/map.png` (and optionally `queue.png`, `agent.png`), then re-run
  `python build_deck.py`. It picks them up automatically.
- **`py-service` deploy is NO LONGER a blocker.** The graph is precomputed and
  committed, so the live app never calls Python. `precompute.py` and
  `build_deck.py` are offline build tools only.
- **Prisma is dead weight.** Nothing imports `src/lib/db.ts`. Ignore it.
- `/dashboard`, `/data`, `/settings` still exist but are unlinked from the nav.
  Harmless; delete only if there is spare time.

## Do not touch
- `web/src/lib/ai/provider.ts` — model choice and fallback chain are settled and
  were tuned against measured quota/latency data. Changing the model id or
  thinking level will re-break things that took a while to get right.
- Do not add `tailwind.config.js`. Tailwind v4 is CSS-first.
- Do not gitignore `web/src/generated/` — it must stay committed.
- Do not use `DropdownMenuLabel` — it throws and takes down the page. See CLAUDE.md.

## Demo path
90 seconds. Do not deviate — everything else is decoration.
1. **`/map`** — "This is our campus at night. Red is not darkness; red is busy
   *and* dark. The grey lanes are unlit too, but nobody walks them."
2. **B3 Block → zanak** is preloaded. Click *Find the safer walk*. Two routes
   draw: **99% less dark walking for one extra metre.** Everyone in the room has
   made that walk.
3. **Report a dark street** → click a path near Central Library. Toast: it is now
   **#1 in the repair queue, worth 8.7% of campus night risk.** The map re-scores
   live. This is the "reporting system" the statement actually asks for.
4. **`/queue`** — "Same numbers, estates-office view. Five paths carry 32.4% of
   the risk. Nobody knew which five."
5. **Agent** — "Why is that path ranked first?" → calls `explainRanking`, answers
   with computed exposure. Then "File a request for the top three" → Approve.
6. Close on: "Turn the AI off and all of that still works."

**Second report is worth showing if there is time:** click somewhere quiet and it
lands at #25, not #1. Proves the system discriminates instead of accepting
everything — which is the honest answer to "can't people just spam it?"

## First things to change at kickoff
- `APP_NAME` in `web/src/components/layout/nav.ts` — currently "Untitled",
  and it is the first thing a judge reads.
- `SUGGESTIONS` at the top of `web/src/components/Chat.tsx` — the starter
  prompts on the empty screen.
- `SYSTEM_PROMPT` in `web/src/lib/ai/prompt.ts` — rewrite for the real domain.
- `tools.ts` — replace the three sample tools with real ones.
- `NAV` in `nav.ts` — the sidebar links (Dashboard/Data/Settings are placeholders).

## Verified test results (pre-hackathon)
| Check | Result |
|---|---|
| Gemini free-tier quota | **20 requests/day/model/project** — verified from the API's own quota error, NOT per-minute. |
| Simple response time | ~2.6s |
| Tool call (chart) | ~4.4s |
| ~7,200-word prompt | Works, but ~18s. Avoid pasting large text live on stage. |
| 500K-row / 12MB CSV | Uploads and analyses in <1s via py-service. |
| Empty / malformed CSV | Returns a clean 4xx, no crash (was an unhandled 500). |
| Memory within a chat | Works — full history is replayed each turn. |
| Chat history per user | Persists server-side; separate accounts see separate chats. |
| RLS isolation | User B cannot list, read, or delete user A's chats. Verified directly against the API. |
| API key exposure | Gemini key absent from all client bundles. Server-side only. |
| Quota exhausted mid-request | Chain silently switches model; friendly message only when all are spent. |

### Tested but NOT re-verified after later changes
- **Concurrency.** 5 simultaneous users were tested BEFORE the fallback chain
  existed: 4 of 5 failed on quota. The chain should fix this, but it has not
  been re-tested under concurrent load. Worth one run before judging.
- **Interactive browser flows** were verified by the user manually, not by
  automated test: login, sign-out, switching between saved conversations.
