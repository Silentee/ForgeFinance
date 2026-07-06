# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forge Finance is a personal finance tracking application that runs entirely on localhost. It's a full-stack app with a React/TypeScript frontend and FastAPI/Python backend using SQLite for storage.

## Development Commands

### Running the Application (Two Terminals Required)

**Full Stack:**
```bash
cd .
.\bin\start.bat  # Windows Only
```

**Backend:**
```bash
cd backend
start.bat       # Windows
./start.sh      # Mac/Linux
```
Backend runs at http://localhost:8000, API docs at http://localhost:8000/docs

**Frontend:**
```bash
cd frontend
start.bat       # Windows
./start.sh      # Mac/Linux
```
Frontend runs at http://localhost:5173

### Package Management

- **Backend:** Uses `uv` (not pip). Run `uv sync` in `backend/` to install dependencies.
- **Frontend:** Uses npm. Run `npm install` in `frontend/` to install dependencies.

### Testing & Migrations

- **Backend tests:** `pytest` from `backend/` (in-memory SQLite fixtures in `tests/`). Cover CSV parsing/dedup, the balance service, and budget-report sign conventions.
- **Migrations:** Alembic (`backend/alembic/`). `init_db()` runs `alembic upgrade head` on existing databases and stamps fresh ones at head, so you rarely call Alembic by hand. To change the schema: edit the models, then add a numbered revision under `alembic/versions/` with a hand-written `upgrade()` (autogenerate is not wired up).

## Architecture

### Backend (FastAPI + SQLAlchemy)

```
backend/app/
├── api/endpoints/    # Route handlers (one file per resource)
├── models/           # SQLAlchemy ORM models
├── schemas/          # Pydantic request/response schemas
├── services/         # Business logic (CSV import, reporting)
├── db/               # Database session and initialization
└── core/config.py    # Settings loaded from .env
```

**API Base:** `/api/v1`. Routes: `/auth`, `/institutions`, `/accounts`, `/account-types`, `/transactions`, `/categories`, `/budgets`, `/imports`, `/balances`, `/reports`, `/export`, `/demo`. Everything except `/auth` requires a Bearer token (see Auth below).

**Key Models:**
- `Institution` → `Account` → `Transaction` (main hierarchy)
- `Category` (two-level parent/child hierarchy for income/expense)
- `BalanceSnapshot` (point-in-time values; **all** account balances are snapshot-driven — see Balance tracking)
- `Budget` (monthly targets per category; unique on category+year+month)
- `AccountTypeDef` (DB-backed, user-editable account types; replaces the old hardcoded enum)
- `User` (single admin login; nullable `user_id` FKs exist on core tables for future multi-user but are not yet enforced in endpoints)

**Auth:** First run has no user — `POST /auth/setup` creates the admin. Thereafter `POST /auth/login` returns a JWT (HS256, `SECRET_KEY` auto-generated into `.env` on first boot). The frontend stores it in localStorage and sends it as `Authorization: Bearer`.

**Account Types:** Stored as `AccountTypeDef` rows keyed by a slug (`checking`, `credit_card`, …). Built-ins are seeded on first run and can be renamed/hidden but not deleted; users can add custom types. `Account.account_type` stores the key. Manage them via the Account Types dialog (Sidebar → settings).

### Frontend (React + Vite + TanStack Query)

```
frontend/src/
├── pages/            # Dashboard, Accounts, Transactions, Budget, Reports, Import
├── components/       # Layout (RootLayout, Sidebar) and UI primitives
├── hooks/            # TanStack Query hooks for data fetching
├── lib/
│   ├── api.ts        # Axios client configuration
│   ├── services.ts   # API call functions
│   └── format.ts     # Formatting utilities
└── types/            # TypeScript interfaces matching backend schemas
```

**Path Alias:** `@/` maps to `src/` (configured in tsconfig.json and vite.config.ts)

**Data Flow:** React Query manages server state. The Vite dev server proxies `/api` requests to the backend, eliminating CORS issues during development.

### Database

SQLite stored at `backend/app.db`. Created automatically on first backend startup with default categories seeded.

**Duplicate Prevention:** Transactions have a `dedup_hash` field computed from account + date + amount + **type** + description. Re-importing the same CSV safely skips duplicates, and manually-created transactions are hashed too (so a later CSV import recognizes them). Computed by `services/csv_import.py::compute_dedup_hash`.

## Key Patterns

- **Pydantic-first API design:** All request/response shapes defined in `schemas/`, matching frontend `types/`
- **Plaid-ready architecture:** Models have nullable Plaid fields (plaid_account_id, plaid_transaction_id) for future live bank syncing
- **Balance tracking:** All account balances are snapshot-driven. `Account.current_balance` is a denormalized cache of the latest-dated `BalanceSnapshot`. Every snapshot write goes through `services/balances.py::record_snapshot`, which recomputes the cache from the newest snapshot — so a backdated entry never overwrites the current balance. CSV transaction imports do **not** recompute balances; enter balances directly (Accounts page) or import balance-history CSVs.
- **Net worth calculation:** Sum of all account balances (credit cards and liabilities subtract from total)
- **Reporting:** Lives in `services/reporting.py`; endpoints in `api/endpoints/reports.py` are thin wrappers. Per-month aggregation with annualized-expense spreading is centralized in `_aggregate_monthly`.
- **Demo data:** Seeded on first-ever startup when no real accounts exist. "End Demo" (Sidebar) clears it. Demo-seeded budgets carry `is_demo=True` (like demo accounts) and are always removed on clear, so leaving demo never leaves demo targets on the budget page even after the user has added a real account. User-created budgets (`is_demo=False`) survive; if no real account remains, the clear also wipes any stray budgets so the sandbox starts fresh.

## Configuration

Backend settings in `backend/.env` (copy from `.env.template`):
- `DATABASE_URL` - SQLite path (default: `sqlite:///./app.db`)
- `MAX_CSV_FILE_SIZE_MB` - Upload limit (default: 50)
- `CORS_ORIGINS` - Allowed frontend origins

Frontend settings in `frontend/.env.local` (optional):
- `VITE_API_BASE_URL` - Override API base for non-localhost deployment (e.g., Raspberry Pi)
