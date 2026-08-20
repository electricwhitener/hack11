# 36-Hour Workflow

Starts Fri 21 Aug 18:00. Ends Sun 23 Aug 06:00.

---

## Part 1 — Why sessions matter, and what actually fixes what

Two different problems get confused constantly. They have different fixes.

**Context window filling up** → causes drift, forgetting, contradicting earlier
work. Fixed by: short sessions, `/clear`, `CLAUDE.md`, and subagents.

**Session / rate limits** → you stop being able to prompt. Fixed by: fewer and
better prompts, cheaper models for mechanical work, and prepared boilerplate.

Subagents help the first and *cost you more of* the second — each spawn re-reads
context from cold. So use them deliberately, not by default.

### The rule for this hackathon

**One session per phase.** When a phase ends, run `/handoff`, then `/clear`.
`docs/STATE.md` is the memory that survives; `CLAUDE.md` reloads the stack rules
automatically. A fresh session that reads both is *sharper* than a six-hour
session that remembers everything — because half of what it remembers is stale.

Signs you have waited too long to clear: it re-reads files it already read, it
suggests something you rejected two hours ago, it forgets `await
convertToModelMessages`. Clear at the first sign, not the third.

### When to spawn a subagent

Spawn when the work would dump a lot of text into your window that you do not
need to keep:

| Situation | Command |
|---|---|
| "Where is X handled?" | `use scout to find where X is handled` |
| A build error you do not want to debug in-context | `use fixer on this error: <paste>` |
| A self-contained feature | `use feature to add <one capability>` |
| Styling and layout work | `use ui to polish the dashboard` |
| Python analysis endpoints | `use data to add a clustering endpoint` |

Do **not** spawn for a one-line edit, or for anything where you need to see the
code afterwards. The agent's output is summarised, not shown.

`ui` and `scout` are set to Sonnet — mechanical work does not need Opus, and this
meaningfully stretches your shared limit.

---

## Part 2 — Two people, one subscription

You share one rate-limit pool. Two Claude sessions running flat out burn it
roughly twice as fast, so do not simply mirror each other.

**Laptop A — the Builder.** Runs Claude continuously. Owns `web/src/lib/ai/`,
`web/src/app/api/`, the data model. This is where the token budget goes.

**Laptop B — the Integrator.** Runs Claude in short bursts only. Owns
`py-service/`, seed data, deployment, the deck, and testing the app like a judge
would. Much of B's job needs no Claude at all: sourcing a real dataset, writing
the pitch narrative, building slides, finding the bugs for A to fix.

Swap roles when the Builder gets tired. Fatigue causes worse prompting, and worse
prompting burns more budget than anything else.

**Avoiding collisions:** A and B touch different folders by design. Commit and
push every 45 minutes. Pull before starting anything. If you both need the same
file, one of you waits — merge conflicts at 4am are how teams lose.

**Sleep is a strategy, not a weakness.** Stagger it: A sleeps 03:00–07:00, B
sleeps 07:00–11:00. Nobody pulls 36 hours and pitches well. The team that sleeps
in shifts out-executes the team that does not, every single time.

---

## Part 3 — The schedule

Times are the plan, not the law. The buffer block is real and you will need it.

### Hour 0–2 · Fri 18:00–20:00 · Choose and lock
Read every problem statement. Score them with the checklist in
`IDEA-PLAYBOOK.md`. Then:

```
/kickoff <paste the chosen problem statement>
```

Pick a direction and **write the 90-second demo script before writing any code.**
Fill in Product and Demo path in `STATE.md`. Lock the idea. Do not reopen this
decision at hour 12 — that is how teams die.

`/handoff`, `/clear`.

### Hour 2–4 · 20:00–22:00 · Skeleton and deploy
Adapt `prisma/schema.prisma` to the real domain. Rewrite `SYSTEM_PROMPT` for the
actual product. Replace the three sample tools with your real ones. Get one route
rendering real data.

**Deploy to Vercel now, while it is trivial.** `npx vercel --prod`, add the env
vars in the dashboard. A team that first deploys at hour 34 does not deploy.

`/handoff`, `/clear`.

### Hour 4–10 · 22:00–04:00 · Core loop
Build the single workflow the demo depends on, end to end. Nothing else.
One session per feature; `/clear` between. Use `feature` subagents for
self-contained slices while you work on the piece you need to see.

Laptop B: real seed data, plus `py-service` endpoints if the domain needs them.

A sleeps at 03:00.

### Hour 10–14 · 04:00–08:00 · The differentiator
Pick two patterns from `IDEA-PLAYBOOK.md` and implement them properly. This is
the block that decides whether you place. Do not spend it on CRUD.

### Hour 14–20 · 08:00–14:00 · Second feature and depth
Widen only where the demo script requires it. If the script does not mention it,
do not build it.

### Hour 20–26 · 14:00–20:00 · Polish
`use ui to polish <screen>`. Empty states, loading states, mobile at 375px, dark
mode. Then real error handling: nothing may show a raw stack trace or spin
forever.

Laptop B starts the deck now — do not wait for the build to finish.

### Hour 26–31 · 20:00–01:00 · Freeze and harden
**Feature freeze at hour 28.** From here, only bug fixes.

```
/demo-check
```

Run the demo path ten times. Fix what breaks. Record a screen capture of a
successful run as insurance — if the live demo fails, you play the video and keep
talking. Every experienced team has this.

### Hour 31–36 · 01:00–06:00 · Pitch
Code is done. See `PITCH-TEMPLATE.md`. Build the deck, make the infographics,
and **rehearse out loud with a timer at least five times.** Reading slides aloud
for the first time in front of judges is the most common way a good project loses
to a worse one.

---

## Part 4 — Habits that save hours

- **Commit every 45 minutes.** `/ship` does verify-commit-push in one step.
- **Never commit a red build.** A broken `main` at 4am costs more than any feature.
- **Paste real error text**, never "it doesn't work". The error is the prompt.
- **Give one task per message.** Bundled requests get half-done in fragments.
- **When Claude goes in circles twice, stop.** `/clear`, re-read `STATE.md`, and
  re-ask with the actual error. Do not argue with a confused session — a third
  attempt in a poisoned context almost never works.
- **`/handoff` before every break**, including meals. Sessions die unexpectedly.
- **Trust the build, not the claim.** `npx tsc --noEmit && npm run build` is truth.
