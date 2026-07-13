"""
paths.py — Desktop-mode detection and filesystem locations.

"Desktop mode" is active only when Forge Finance runs as the packaged Windows
app (a PyInstaller build) or when FORGE_DESKTOP=1 is set to exercise that
behavior from a dev checkout. In every other case (normal dev, Docker, the
Raspberry Pi) these helpers return the current, unchanged locations, so the
rest of the app is byte-for-byte identical outside desktop mode.
"""

import os
import sys
from pathlib import Path


def is_desktop() -> bool:
    """True when running as the packaged Windows desktop app.

    ``sys.frozen`` is set by PyInstaller. ``FORGE_DESKTOP=1`` lets us exercise
    the packaged code paths from a dev checkout; ``desktop.py`` also sets it
    before importing anything under ``app``.
    """
    return bool(getattr(sys, "frozen", False)) or os.environ.get("FORGE_DESKTOP") == "1"


def data_dir() -> Path:
    """Writable per-user data directory (%LOCALAPPDATA%\\ForgeFinance).

    Holds the SQLite database, the generated ``.env`` (SECRET_KEY), and the
    log file. Created on demand so an installed app never has to write inside
    its (potentially read-only) program directory.
    """
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    d = Path(base) / "ForgeFinance"
    d.mkdir(parents=True, exist_ok=True)
    return d


def resource_dir() -> Path:
    """Root of read-only bundled resources (alembic/, alembic.ini, frontend_dist/).

    Frozen: ``sys._MEIPASS`` — where PyInstaller unpacks bundled data files.
    Dev/Docker: the ``backend/`` directory, i.e. the same paths used today.
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[2]  # backend/
