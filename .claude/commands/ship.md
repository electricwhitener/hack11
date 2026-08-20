---
description: Verify, commit, and push the current work
allowed-tools: Bash, Read
---

1. `cd web && npx tsc --noEmit && npm run build` — if this fails, stop and fix it
   before anything else. Never commit a broken build during a hackathon; a broken
   `main` at 4am costs more than the feature is worth.
2. `git status` and `git diff --stat` to see what actually changed.
3. Stage and commit with a clear message describing the user-visible change.
4. Push to the current branch.
5. Append the commit line to `docs/STATE.md` under Progress.

Report the commit hash and what shipped.
