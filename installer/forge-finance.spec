# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Forge Finance Windows desktop app.

Build via installer/build.ps1 (which stages the frontend first). Manual run:

    cd backend
    uv run pyinstaller ../installer/forge-finance.spec --noconfirm --clean \
        --distpath ../installer/dist --workpath ../installer/build

Onedir + windowed: onefile would extract the ~200 MB pandas/uvicorn payload to
a temp dir on every launch (slow, more antivirus heuristics); the installer
hides the onedir folder from users anyway.
"""

import os

from PyInstaller.utils.hooks import collect_submodules

# SPECPATH is injected by PyInstaller and is this file's directory (installer/),
# so paths below are independent of the current working directory.
HERE = SPECPATH
ROOT = os.path.dirname(HERE)
BACKEND = os.path.join(ROOT, "backend")
STAGING_DIST = os.path.join(HERE, "staging", "frontend_dist")
ICON = os.path.join(HERE, "forge.ico")

a = Analysis(
    [os.path.join(BACKEND, "desktop.py")],
    pathex=[BACKEND],
    binaries=[],
    datas=[
        # Alembic reads env.py + versions/*.py from disk at runtime, so they
        # must ship as data files; init_db resolves them via resource_dir().
        (os.path.join(BACKEND, "alembic"), "alembic"),
        (os.path.join(BACKEND, "alembic.ini"), "."),
        # The built React SPA, served same-origin by FastAPI (see main.py).
        (STAGING_DIST, "frontend_dist"),
    ],
    hiddenimports=[
        # uvicorn loads its loop/protocol implementations by string name.
        *collect_submodules("uvicorn"),
        # pywebview's Windows (WebView2) backend, in case the pywebview hook
        # doesn't pull them (belt-and-suspenders — it usually does).
        "webview.platforms.winforms",
        "webview.platforms.edgechromium",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "matplotlib"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ForgeFinance",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed: no console flash on launch
    disable_windowed_traceback=False,
    icon=ICON if os.path.exists(ICON) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="ForgeFinance",
)
