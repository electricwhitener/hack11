# Project State

> The handoff file. Every session reads this first and updates it before ending.
> If this file is accurate, you can `/clear` freely and lose nothing.

## Product
_One paragraph: what we are building and for whom. Fill in at kickoff._

## Now
Nothing yet — waiting for the problem statement.

**Next step:** run `/kickoff <problem statement>` when it drops.

## Done
- Scaffold ready: Next.js 16 + AI SDK v7 + Gemini, FastAPI sidecar, verified building.

## Decisions
| Decision | Reason |
|---|---|
| Gemini free tier via AI SDK | No card needed, generous quota, one-file provider swap. |
| Agent tools over bespoke API routes | Every capability becomes something the agent can invoke and the judge can see. |
| Python kept in a separate service | Lets one teammate work on analysis without touching the frontend. |

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
