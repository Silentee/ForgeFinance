@echo off
REM start.bat — Start the Forge Finance frontend on Windows
REM Run from the frontend\ directory: start.bat
REM
REM Requires: Node.js 18+ (https://nodejs.org/)

setlocal

node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js was not found on your PATH.
    echo Install it from https://nodejs.org/ ^(LTS version recommended^)
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
)

if not exist ".env.local" (
    if exist ".env.template" (
        echo Creating .env.local from template...
        copy ".env.template" ".env.local" >nul
    )
)

echo.
echo ============================================================
echo   Forge Finance frontend starting...
echo   Local:  http://localhost:5173
echo.
echo   Make sure the backend is also running:
echo     cd ..\backend ^&^& start.bat
echo ============================================================
echo.

npm run dev

if errorlevel 1 (
    echo.
    echo Frontend stopped with an error.
    pause
)

endlocal

