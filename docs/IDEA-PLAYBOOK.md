# Idea Playbook

The organisers said the idea carries the most weight, and that most teams will be
using coding agents. Read that carefully: **execution quality is about to become
commoditised.** Twenty teams will submit a clean CRUD app with a chatbot in the
corner. Your edge is not code quality. It is choosing something the others did not
think to build.

## The one rule

> Most teams will bolt a chatbot onto an app. Build an app the agent *operates*.

A chatbot answers questions about your product. An agent changes your product's
state. The second one is a different category of demo and judges feel the
difference immediately, even when they cannot articulate why.

## Patterns that separate you

Ranked by impact-per-hour. Pick two. Three is greedy.

**1. Generative UI — the agent returns components, not paragraphs.**
Already wired: `showChart` in `tools.ts` returns structured data and
`Chart.tsx` renders a real chart. Extend the same pattern to forms the agent
pre-fills, tables it builds, maps it pins. Cheap to add, disproportionately
impressive, because it looks like nothing else in the room.

**2. Human-in-the-loop approval.**
Already wired: `commitAction` has `needsApproval: true`, and `Chat.tsx` renders
Approve/Deny buttons. The agent proposes a real action and waits for a click.
This reads as *responsible AI* without you saying the words, and it answers the
"what if it hallucinates?" question before a judge asks it.

**3. A visible reasoning trace.**
Already wired: every tool call renders as a step in the transcript. Do not hide
it behind a spinner. Showing the agent's work is the difference between "it did
something" and "I understand what it did".

**4. Proactive, not reactive.**
Nearly every team's agent waits to be spoken to. Make yours act on an event — a
threshold crossed, a file uploaded, a scheduled sweep — and surface the result
as a notification the user did not ask for. This is the single strongest
differentiator on this list and almost nobody does it.

**5. Multi-agent with visible handoff.**
A router agent that delegates to specialists, with the handoff shown in the UI.
Use only if the domain genuinely has separable roles. Faked, it is obvious.

**6. Memory across sessions.**
The agent remembers a preference from an earlier visit and applies it unprompted.
One table, big perceived intelligence.

## Choosing between problem statements

Score each statement out of 5 before committing. Twenty minutes here saves ten hours.

- **Demoable in 90 seconds?** If the value takes five minutes to explain, it loses
  to a worse idea that shows well. This dominates every other criterion.
- **Is there a real dataset?** A demo on invented data feels hollow. A CSV from
  data.gov.in or Kaggle makes it feel real.
- **Does an agent genuinely help,** or are you attaching one because the theme
  demands it? Judges can tell.
- **Can we cut it in half and still have a product?** If no, the scope is wrong.
- **Do we personally understand the domain?** Student-life problems beat
  enterprise problems you have to imagine.

## Traps

- **Do not build a "platform".** Build one workflow that works completely.
- **Do not start with auth.** It eats four hours and no judge scores it. Hardcode
  a demo user; add real auth only if time remains.
- **Do not chase breadth.** Three features that work beat eight that half-work.
  The half-working eighth is what crashes on stage.
- **Do not skip deploying until the end.** Deploy in hour 3 while it is trivial.
- **Do not demo on empty state.** Seed realistic data early.

## The pitch shapes the build

Write the demo script *before* the feature list. If a feature does not appear in
the 90-second script, it is not a priority. This inverts the instinct to build
first and pitch later, and it is why teams run out of time on the pitch.
