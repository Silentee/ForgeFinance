@echo off
REM start.bat — Launch Forge Finance (backend + frontend together)
REM Run from the finance-app\ root directory: start.bat
REM
REM The backend opens in a new terminal window.
REM The frontend runs in this window.
REM Close both windows to stop the app.

setlocal

REM ── Verify we're in the right place ──────────────────────────────────────────
if not exist "backend\pyproject.toml" (
    echo ERROR: Could not find backend\pyproject.toml
    echo Make sure you are running this script from the finance-app root directory,
    echo not from inside the backend\ or frontend\ folder.
    pause
    exit /b 1
)
if not exist "frontend\package.json" (
    echo ERROR: Could not find frontend\package.json
    echo Make sure you are running this script from the finance-app root directory.
    pause
    exit /b 1
)

REM ── Check dependencies ────────────────────────────────────────────────────────
uv --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: uv is not installed or not on PATH.
    echo Install it in PowerShell:
    echo   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not on PATH.
    echo Install it from https://nodejs.org/
    pause
    exit /b 1
)

REM ── Backend — launch in a new titled terminal window ─────────────────────────
echo Starting backend in a new window...
start "Forge Finance - Backend" cmd /k "cd /d %~dp0backend && start.bat"

REM Give the backend a few seconds to come up before the frontend proxy hits it.
timeout /t 3 /nobreak >nul

REM ── Open browser — after a short delay to let Vite finish starting ────────────
REM Runs in a hidden background cmd so it doesn't block the frontend window.
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173"

REM ── Frontend — run in this window ────────────────────────────────────────────
echo Starting frontend...
cd /d %~dp0frontend
call start.bat

endlocal