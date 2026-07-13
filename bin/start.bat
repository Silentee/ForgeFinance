@echo off
REM start.bat - Launch Forge Finance (backend + frontend together)
REM Run from the ForgeFinance root directory: .\bin\start.bat
REM
REM The backend opens in a new terminal window.
REM The frontend runs in this window.
REM Close both windows to stop the app.

setlocal

set "ROOT_DIR=%~dp0.."
for %%I in ("%ROOT_DIR%") do set "ROOT_DIR=%%~fI"

REM ---- Verify repository layout ----
if not exist "%ROOT_DIR%\backend\pyproject.toml" (
    echo ERROR: Could not find %ROOT_DIR%\backend\pyproject.toml
    echo Make sure this repository has backend\ and frontend\ folders.
    pause
    exit /b 1
)
if not exist "%ROOT_DIR%\frontend\package.json" (
    echo ERROR: Could not find %ROOT_DIR%\frontend\package.json
    echo Make sure this repository has backend\ and frontend\ folders.
    pause
    exit /b 1
)

REM ---- Check dependencies ----
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

REM ---- Backend - launch in a new titled terminal window ----
echo Starting backend in a new window...
REM Note: cmd.exe escaping uses doubled quotes inside a quoted /k argument.
start "Forge Finance - Backend" cmd /k "cd /d ""%ROOT_DIR%\backend"" && start.bat"

REM ---- Wait for the backend to actually answer before starting the frontend.
REM The first run builds the Python env (uv sync), which can take minutes, so
REM poll /health instead of guessing with a fixed delay. curl ships with
REM Windows 10 1803+.
echo Waiting for the backend at http://localhost:8000 (first run can take a few minutes)...
set /a TRIES=0
:wait_backend
curl -s -o nul --max-time 2 http://localhost:8000/health && goto backend_ready
set /a TRIES+=1
if %TRIES% GEQ 300 (
    echo WARNING: backend did not respond after ~10 minutes. Starting the frontend anyway.
    goto backend_ready
)
timeout /t 2 /nobreak >nul
goto wait_backend
:backend_ready
echo Backend is up.

REM ---- Open the browser once Vite is answering on 5173 ----
REM Background cmd polls so it doesn't block the frontend window below.
start "" cmd /c "for /l %%i in (1,1,60) do (curl -s -o nul --max-time 2 http://localhost:5173 && (start http://localhost:5173 & exit /b)) & timeout /t 1 /nobreak >nul"

REM ---- Frontend - run in this window ----
echo Starting frontend...
cd /d "%ROOT_DIR%\frontend"
call start.bat

endlocal
