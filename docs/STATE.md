# Project State

> The handoff file. Every session reads this first and updates it before ending.
> If this file is accurate, you can `/clear` freely and lose nothing.

## Product
_One paragraph: what we are building and for whom. **Fill in at kickoff.**_

## Now
**Setup phase is COMPLETE.** Nothing is in progress. The scaffold is live at
https://sweetjalapenos.vercel.app/ and everything below has been verified in
production, not just locally.

**Next step:** the problem statements have been released. Run
`/kickoff <paste the chosen problem statement>` in a FRESH session. Pick the
idea and write the 90-second demo script before writing any code.

## Done
- **Agent**: Next.js 16 + AI SDK v7 + Gemini. Streaming, multi-step tool loop,
  human-in-the-loop approval, generative-UI charts, live status line, tool trace.
- **Quota resilience**: fallback chain across (key x model) pairs.
- **Auth**: Supabase, Google OAuth + email/password. Confirmed working in prod.
- **Chat history**: server-side per user in Postgres, RLS-isolated, listed in a
  persistent sidebar.
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

## Blocked / Known broken
- **`py-service` is not deployed.** It runs on localhost only, so the
  `runAnalysis` tool fails on the live site. If the chosen problem statement
  needs Python in the demo, deploy it (Railway/Render, both free) early — do not
  leave this to the last hours.
- **Prisma is dead weight right now.** Configured and committed but nothing
  imports `src/lib/db.ts`. Either use it for domain models or ignore it; do not
  spend time "fixing" it.

## Do not touch
- `web/src/lib/ai/provider.ts` — model choice and fallback chain are settled and
  were tuned against measured quota/latency data. Changing the model id or
  thinking level will re-break things that took a while to get right.
- Do not add `tailwind.config.js`. Tailwind v4 is CSS-first.
- Do not gitignore `web/src/generated/` — it must stay committed.
- Do not use `DropdownMenuLabel` — it throws and takes down the page. See CLAUDE.md.

## Demo path
_The exact click-by-click sequence shown to judges. Write this at kickoff — it
tells you which features matter and which are decoration._
1.
2.
3.

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
