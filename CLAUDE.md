# Project: HACKS 11.0 entry

Read this before doing anything. It is deliberately short so it costs little context.

## What this is
A Next.js web app with an embedded AI agent, plus a Python sidecar for data work.
The product idea lives in `docs/STATE.md` — read that for current goals and status.

## Layout
- `web/` — Next.js 16, App Router, TypeScript, Tailwind v4. The product.
- `py-service/` — FastAPI + pandas/sklearn. Only for analysis that JS cannot do.
- `docs/` — living project state, pitch material.

## Key files (do not hunt for these)
- `web/src/lib/ai/tools.ts` — the agent's tool registry. **Most feature work happens here.**
- `web/src/lib/ai/prompt.ts` — the agent's system prompt.
- `web/src/lib/ai/provider.ts` — LLM config. The only file that imports a provider.
- `web/src/app/api/chat/route.ts` — the agent loop endpoint.
- `web/src/components/Chat.tsx` — chat UI, tool trace, approval buttons.
- `web/src/components/layout/nav.ts` — sidebar links and app name. Edit to change nav.
- `web/src/components/layout/AppShell.tsx` — page frame. Wrap every page in it.
- `web/src/components/providers/notifications.tsx` — agent notification store.
- `web/src/components/ui/` — shadcn components. Reuse these; do not hand-roll buttons.
- `web/prisma/schema.prisma` — data model.
- `docs/STATE.md` — what we are building and what is done. Update it as you go.

## Stack rules that bite (this codebase is on new majors)
- **AI SDK v7.** `tool()` imports from `@ai-sdk/provider-utils`, NOT from `ai`.
- **AI SDK v7.** `convertToModelMessages()` is async — it must be `await`ed.
- **AI SDK v7.** Multi-step agent loops need `stopWhen: stepCountIs(n)`, else the
  model calls one tool and stops.
- **Prisma 7.** Import `PrismaClient` from `@/generated/prisma/client`, NOT
  `@prisma/client`. The connection URL lives in `prisma.config.ts`, NOT in
  `schema.prisma`. Use the `PrismaPg` driver adapter.
- **Tailwind v4.** Config is CSS-first in `globals.css`. There is no
  `tailwind.config.js` and you should not create one.
- **shadcn/ui is built on Base UI here, NOT Radix.** There is no `asChild` prop.
  Use `render={<Button />}` instead:
  `<DropdownMenuTrigger render={<Button variant="ghost" />}>...</DropdownMenuTrigger>`
- **Colors come from theme tokens**, never hardcoded. Use `bg-background`,
  `text-muted-foreground`, `bg-card`, `border`, `var(--chart-1..5)`. Do not write
  `bg-white dark:bg-neutral-900` — the tokens already handle dark mode.
- **Every page must be wrapped in `<AppShell title="...">`** or it renders with
  no navigation.
- Do not downgrade any of these to match an older tutorial. Fix forward.

## Conventions
- Server-side logic goes in route handlers or `src/lib/`, never in client components.
- Every new agent capability is a tool in `tools.ts`, not a bespoke API route.
- Tool `description` fields are prompt engineering. Write them carefully.
- Keep components under ~150 lines; split when they grow.
- Add new shadcn components with `npx shadcn@latest add <name> --yes`.
- New route at `/foo` requires `src/app/foo/page.tsx` to exist before any
  `<Link href="/foo">` will typecheck — routes are typed in Next 16.

## Verify before claiming done
```
cd web && npx tsc --noEmit && npm run build
```
Never report a feature complete without running this.

## Working agreements
- Prefer editing existing files over creating new ones.
- Do not write README files or docs unless asked.
- When you finish a unit of work, append one line to `docs/STATE.md` under Progress.
