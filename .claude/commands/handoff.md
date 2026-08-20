---
description: Snapshot project state into docs/STATE.md so you can /clear without losing the thread
allowed-tools: Read, Edit, Write, Bash(git log:*), Bash(git status)
---

Update `docs/STATE.md` so a fresh Claude session with zero memory of this
conversation can pick up exactly where we are.

Run `git log --oneline -10` and `git status` first to ground yourself in fact
rather than recollection.

Rewrite these sections in place:
- **Now** — the one thing being worked on right now, and the next concrete step.
- **Done** — append what was completed this session. Keep it to one line each.
- **Decisions** — any choice made this session that a future session must not
  relitigate (library picks, data model, scope cuts). Include the reason.
- **Blocked / Known broken** — anything failing, with the exact error.
- **Do not touch** — files or approaches that are settled.

Be specific and factual. Vague notes like "improved the UI" are worthless to the
next session. Name files. Name functions.

Then tell me it is safe to `/clear`.
