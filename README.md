# HACKS 11.0

## First run

```bash
# Web app
cd web
cp .env.example .env.local        # add your Gemini key
npm install
npx prisma generate
npm run dev                       # http://localhost:3000

# Python service (only if the problem needs data work)
cd py-service
./.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
```

Get a free Gemini key at https://aistudio.google.com/apikey — no card needed.
Without a key the app runs in mock mode: the UI works, the agent does not.

## Where things are

| Path | What |
|---|---|
| `web/src/lib/ai/tools.ts` | The agent's capabilities. Most work happens here. |
| `web/src/lib/ai/prompt.ts` | The agent's system prompt. |
| `web/src/app/api/chat/route.ts` | The agent loop. |
| `web/src/components/Chat.tsx` | Chat UI, tool trace, approval buttons. |
| `py-service/main.py` | pandas / sklearn endpoints. |

## Docs

- `docs/WORKFLOW.md` — the 36-hour plan and how to use Claude sessions.
- `docs/IDEA-PLAYBOOK.md` — how to pick and differentiate the idea.
- `docs/STATE.md` — living project state. Read first, update last.
- `docs/PITCH-TEMPLATE.md` — the final five hours.

## Verify

```bash
cd web && npx tsc --noEmit && npm run build
```
