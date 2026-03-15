@echo off
REM start.bat — Start the Forge Finance backend on Windows (uv)
REM Run from the backend\ directory: start.bat
REM
REM Requires: uv  (https://docs.astral.sh/uv/getting-started/installation/)
REM   Install (PowerShell): powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
REM   Then open a new terminal so PATH is updated.

setlocal

REM ── Check uv is available ────────────────────────────────────────────────────
uv --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: uv is not installed or not on PATH.
    echo.
    echo Install it by running this in PowerShell:
    echo   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 ^| iex"
    echo.
    echo Then open a new terminal and re-run this script.
    pause
    exit /b 1
)

REM ── Copy .env template if no .env exists ─────────────────────────────────────
if not exist ".env" (
    if exist ".env.template" (
        echo Creating .env from template...
        copy ".env.template" ".env" >nul
    )
)

REM ── Sync dependencies ────────────────────────────────────────────────────────
REM uv sync creates/updates the venv and installs everything from pyproject.toml.
REM On subsequent runs this is near-instant if nothing has changed.
echo Syncing dependencies...
uv sync
if errorlevel 1 (
    echo ERROR: uv sync failed. Check pyproject.toml and your internet connection.
    pause
    exit /b 1
)

REM ── Start the server ─────────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Forge Finance API starting...
echo   Local:    http://localhost:8000
echo   API docs: http://localhost:8000/docs
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================================
echo.

uv run python -m uvicorn app.main:app --reload --port 8000 --host 127.0.0.1

REM ── Pause on error so the window doesn't vanish ──────────────────────────────
if errorlevel 1 (
    echo.
    echo Server stopped with an error. See output above for details.
    pause
)

endlocal

