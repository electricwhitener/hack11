# Pitch Template

Reserve hours 31–36 for this. Do not compress it — the pitch is scored, and a
well-pitched good project beats a badly-pitched great one routinely.

## Structure (assume 5 minutes; verify the real limit on the day)

**0:00 — The problem, as a specific person's bad day.**
Not "students face challenges with attendance management". Instead: "Priya finds
out she is at 74% attendance the day before the exam, when it is too late to do
anything." Specific beats abstract. One sentence, no statistics yet.

**0:30 — Why the obvious fix fails.**
One sentence on why existing tools do not solve this. Earns the right to your idea.

**1:00 — The demo. Live, and rehearsed.**
Ninety seconds, no narration of the obvious. Do not say "now I'm clicking the
button". Say what it *means*: "it noticed the shortfall on its own and suggested
which lectures to attend."

Show, in this order:
1. The agent doing something a chatbot cannot — changing real state.
2. The approval step. Say: *the agent proposes, the human decides.*
3. The reasoning trace. Say: *you can always see why it did that.*

**2:30 — How it works.** One architecture slide. Thirty seconds. Judges want to
know it is real, not how the tools registry is typed.

**3:00 — What is genuinely different.** Name your two differentiator patterns
explicitly. Judges have seen twenty chatbots today. Tell them plainly why this is
not one.

**3:45 — What is next.** Two or three bullets. Shows you know what is unfinished,
which reads as maturity rather than as a gap.

**4:15 — Close on the person from slide one.** "Priya finds out in week three,
not the night before." Then stop talking.

## Slides

Eight to ten maximum. Rules: one idea per slide, a real screenshot on every slide
that has one, no paragraphs, font large enough to read from the back of the room.
Dark background photographs badly on most projectors — test it if you can.

Worth making as infographics:
- The before/after of the user's workflow.
- The agent loop: user intent → tools → action → approval → result.
- One honest number (rows processed, seconds saved, steps eliminated).

## Q&A: prepare these five

They get asked almost every time.

1. *What if the AI hallucinates?* → Point at the approval gate and at the Python
   service returning ground-truth numbers rather than model-invented ones.
2. *What did you build versus what did the AI build?* → Answer straight. You
   designed the agent's tools and decided what it is allowed to do. That is the
   engineering. Do not be defensive; everyone used agents.
3. *How does this scale?* → Name the real bottleneck honestly.
4. *Who pays for the API calls?* → Have a number, even a rough one.
5. *Why an agent and not a form?* → Because the task needs judgement across
   several steps. If you cannot answer this one convincingly, fix the product.

## Delivery

- One person demos, one person talks. Decide who and rehearse the handover.
- Rehearse aloud with a timer at least five times. Silent reading is not rehearsal.
- Have the backup video open in a tab, ready to play.
- If the live demo fails, do not debug on stage. Switch to the video, keep the
  narration going, and never apologise more than once.
