# Project State

> The handoff file. Every session reads this first and updates it before ending.
> If this file is accurate, you can `/clear` freely and lose nothing.

## Product
_One paragraph: what we are building and for whom. Fill in at kickoff._

## Now
Setup phase complete. Deployed and live at https://sweetjalapenos.vercel.app/
(agent verified responding with real Gemini in production).

**Next step:** run `/kickoff <problem statement>` when it drops.

## Done
- Scaffold ready: Next.js 16 + AI SDK v7 + Gemini, FastAPI sidecar, verified building.
- UI foundation: shadcn/ui (15 components), AppShell with sidebar + mobile sheet,
  dark mode, notification bell + toast store. Build verified, routes render.

## Decisions
| Decision | Reason |
|---|---|
| Gemini free tier via AI SDK | No card needed, generous quota, one-file provider swap. |
| Agent tools over bespoke API routes | Every capability becomes something the agent can invoke and the judge can see. |
| Python kept in a separate service | Lets one teammate work on analysis without touching the frontend. |
| shadcn/ui on Base UI | Came with the CLI. Note: `render=` not `asChild`. |
| Notification store built pre-emptively | Enables the proactive-agent pattern, the top differentiator. |
| Prisma client committed to git | Vercel's npm blocks dependency install scripts, so `prisma generate` cannot run there. Regenerate locally via `npm run db:generate`. |
| Gemini rolling aliases (`gemini-flash-latest`) | A pinned dated model was deprecated mid-setup; aliases track current stable. |
| No LangGraph | AI SDK v7 already covers tool loops and human-in-loop approval. A second orchestration framework costs hours and wins no marks. |
| LLM interprets, never computes | Ground truth comes from `py-service`; the model explains it. This is what stops demo hallucination. |
| Model fallback chain, not a single model | Gemini free tier = 20 requests/DAY/MODEL (verified). Chain of 5 models gives ~100/day and survives concurrent users. |
| Chat history in localStorage | Survives refresh mid-demo with zero backend. Per-browser only; move to Postgres if history must be shared. |

## Blocked / Known broken
None.

## Do not touch
- `web/src/lib/ai/provider.ts` — provider config is settled.
- Do not add `tailwind.config.js`. Tailwind v4 is CSS-first.

## Demo path
_The exact click-by-click sequence shown to judges. Write this early — it tells
you which features actually matter and which are decoration._
1.
2.
3.

## Progress log
- Pre-hackathon: scaffold built and verified.
- Pre-hackathon: UI foundation (component kit, app shell, notifications) added and verified.
- Pre-hackathon: deployed to Vercel. Fixed model deprecation + Prisma/Vercel build failure.
- Pre-hackathon: live agent status line (shimmer + per-tool verbs) and richer tool trace.
- Pre-hackathon: reliability pass. Model fallback chain, chat persistence, scope guard.

## Verified test results (pre-hackathon)
| Check | Result |
|---|---|
| Gemini quota | **20 requests/day/model** (free tier), not per-minute. Per-model, so the chain multiplies it. |
| 5 concurrent users | 5/5 succeed with fallback chain (was 1/5 with a single model). |
| Quota exhausted | No crash. Chain switches models silently; friendly message only if all are spent. |
| Simple response time | ~2.6s |
| Tool call (chart) | ~4.4s |
| 13KB prompt | Works, but ~19s. Avoid pasting large text live on stage. |
| Memory within a chat | Works — full history is replayed each turn. |
| History after refresh | Persists via localStorage. "New chat" button clears it. |
| API key exposure | Not present in any client bundle. Server-side only. |
