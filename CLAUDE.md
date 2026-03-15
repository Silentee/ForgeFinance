# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forge Finance is a personal finance tracking application that runs entirely on localhost. It's a full-stack app with a React/TypeScript frontend and FastAPI/Python backend using SQLite for storage.

## Development Commands

### Running the Application (Two Terminals Required)

**Full Stack:**
```bash
cd .
start.bat       # Windows Only
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

**API Base:** `/api/v1` with routes for: `/institutions`, `/accounts`, `/transactions`, `/categories`, `/budgets`, `/imports`, `/balances`, `/reports`

**Key Models:**
- `Institution` → `Account` → `Transaction` (main hierarchy)
- `Category` (two-level parent/child hierarchy for income/expense)
- `BalanceSnapshot` (point-in-time values for investments/real estate)
- `Budget` (monthly targets per category)

**Account Types:** checking, savings, cash, credit_card, investment, real_estate, vehicle, other_asset, other_liability

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

**Duplicate Prevention:** Transactions have a `dedup_hash` field computed from date + amount + description + account. Re-importing the same CSV safely skips duplicates.

## Key Patterns

- **Pydantic-first API design:** All request/response shapes defined in `schemas/`, matching frontend `types/`
- **Plaid-ready architecture:** Models have nullable Plaid fields (plaid_account_id, plaid_transaction_id) for future live bank syncing
- **Balance tracking:** Transaction-based accounts compute balances; investment/real estate accounts use manual BalanceSnapshots
- **Net worth calculation:** Sum of all account balances (credit cards and liabilities subtract from total)

## Configuration

Backend settings in `backend/.env` (copy from `.env.template`):
- `DATABASE_URL` - SQLite path (default: `sqlite:///./app.db`)
- `MAX_CSV_FILE_SIZE_MB` - Upload limit (default: 50)
- `CORS_ORIGINS` - Allowed frontend origins

Frontend settings in `frontend/.env.local` (optional):
- `VITE_API_BASE_URL` - Override API base for non-localhost deployment (e.g., Raspberry Pi)
