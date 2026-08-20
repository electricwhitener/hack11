---
description: Rehearse and harden the demo path before judging
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

Judging is close. Make the demo unbreakable.

1. Build clean: `cd web && npx tsc --noEmit && npm run build`. Report the result.
2. Walk the demo path in `docs/STATE.md` and list every external dependency it
   touches — LLM API, Python service, database, network.
3. For each one, answer: what does the user see if it fails mid-demo? If the
   answer is "a crash" or "an infinite spinner", fix it now. Every failure must
   degrade to a visible, calm message.
4. Check empty states. A judge will click things in the wrong order.
5. Confirm the first screen explains what the product is without narration.
6. Seed realistic demo data. Do not demo on empty tables or `test test test`.

Report a checklist of what you verified and what you fixed. Flag anything still
risky that I should avoid touching on stage.
