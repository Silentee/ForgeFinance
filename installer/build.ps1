<#
    build.ps1 — Build the Forge Finance Windows installer end to end.

    DEVELOPER-ONLY. End users never run this; they just run the resulting
    ForgeFinanceSetup-x.y.z.exe.

    Prerequisites on the build machine:
      * Node.js 20+           (frontend build)
      * uv                    (backend + PyInstaller)
      * Inno Setup 6          (installer compile; provides ISCC.exe)
      * installer\forge.ico   (app icon; see README "Building the installer")

    Usage (from anywhere):
      powershell -ExecutionPolicy Bypass -File installer\build.ps1
      # skip the installer compile (just produce the onedir exe):
      powershell -ExecutionPolicy Bypass -File installer\build.ps1 -SkipInstaller
#>
param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"

$Here     = $PSScriptRoot
$Root     = Split-Path -Parent $Here
$Backend  = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Staging  = Join-Path $Here "staging\frontend_dist"
$DistDir  = Join-Path $Here "dist"
$WorkDir  = Join-Path $Here "build"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- Version (single source of truth: backend/pyproject.toml) ---------------
$pyproject = Get-Content (Join-Path $Backend "pyproject.toml") -Raw
$m = [regex]::Match($pyproject, '(?m)^\s*version\s*=\s*"([^"]+)"')
if (-not $m.Success) { Fail "Could not read version from backend/pyproject.toml" }
$Version = $m.Groups[1].Value
Write-Host "Building Forge Finance $Version" -ForegroundColor Green

# --- 1. Frontend build ------------------------------------------------------
Write-Step "Building frontend (npm ci + npm run build)"
Push-Location $Frontend
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { Fail "npm ci failed" }
    npm run build          # runs `tsc && vite build`; type errors fail here
    if ($LASTEXITCODE -ne 0) { Fail "npm run build failed (check tsc errors)" }
} finally { Pop-Location }

# --- 2. Stage the built SPA -------------------------------------------------
Write-Step "Staging frontend build"
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Staging | Out-Null
Copy-Item (Join-Path $Frontend "dist\*") $Staging -Recurse -Force

# --- 3. PyInstaller onedir --------------------------------------------------
Write-Step "Freezing backend (PyInstaller)"
Push-Location $Backend
try {
    uv sync --group desktop
    if ($LASTEXITCODE -ne 0) { Fail "uv sync --group desktop failed" }
    uv run pyinstaller (Join-Path $Here "forge-finance.spec") `
        --noconfirm --clean --distpath $DistDir --workpath $WorkDir
    if ($LASTEXITCODE -ne 0) { Fail "PyInstaller failed" }
} finally { Pop-Location }

$ExePath = Join-Path $DistDir "ForgeFinance\ForgeFinance.exe"
if (-not (Test-Path $ExePath)) { Fail "Expected exe not found at $ExePath" }
Write-Host "Onedir build ready: $ExePath" -ForegroundColor Green

if ($SkipInstaller) {
    Write-Host "`n-SkipInstaller set; stopping before Inno Setup." -ForegroundColor Yellow
    exit 0
}

# --- 4. Inno Setup compile --------------------------------------------------
Write-Step "Compiling installer (Inno Setup)"
$iscc = @(
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { Fail "ISCC.exe not found. Install Inno Setup 6." }

& $iscc "/DAppVersion=$Version" (Join-Path $Here "setup.iss")
if ($LASTEXITCODE -ne 0) { Fail "Inno Setup compile failed" }

$Setup = Join-Path $Here "Output\ForgeFinanceSetup-$Version.exe"
Write-Host "`nDone. Installer: $Setup" -ForegroundColor Green
