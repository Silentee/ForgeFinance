---
name: verify
description: How to launch and drive Forge Finance for end-to-end verification without touching the real dev database.
---

# Verifying Forge Finance changes

The user's dev servers are usually already running (backend :8000 with
`--reload`, frontend :5173). Their real DB is `backend/app.db` and the API
needs their login — don't drive against it.

## Isolated backend instance (API surface)

```powershell
cd backend
$env:DATABASE_URL = 'sqlite:///<scratchpad>/verify.db'   # env var beats .env
uv run uvicorn app.main:app --port 8001    # run in background
```

- `init_db()` runs on startup: creates schema, applies/stamps Alembic head,
  seeds account types and demo data (assert on your own merchants/records,
  not on counts).
- Bootstrap auth on the fresh DB: `POST /api/v1/auth/setup
  {"username", "password" (min 6)}` → `access_token`; send as
  `Authorization: Bearer`.
- All routes live under `/api/v1`. Fixtures via `POST /accounts`
  (`{name, account_type: "checking"}`) then `POST /transactions`
  (`{account_id, date, amount (positive), transaction_type: "debit",
  original_description}`).
- Drive with a stdlib-urllib Python script via `uv run python <script>`
  from `backend/` (requests/httpx not guaranteed).

## Gotchas

- The user's :8000 server auto-reloads on backend edits, so migrations
  apply to the real `app.db` as soon as you save a new revision.
- No Playwright/puppeteer in `frontend/node_modules` — the React UI can't
  be pixel-driven here; verify UI changes via `npx tsc --noEmit` +
  `npm run build` and exercise the API the components call.
- Windows PowerShell: no `&&`; use `;` or separate calls.
