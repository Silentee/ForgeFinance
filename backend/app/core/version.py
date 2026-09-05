"""
version.py — the app version, read from the single source of truth.

``backend/pyproject.toml`` holds the only hand-maintained version number in the
repo; bump it there and nothing else needs touching. This module parses it once
at import so no other Python file has to repeat the literal, and
``installer/build.ps1`` reads the same field to stamp the installer.

The file is resolved through ``paths.resource_dir()``, so this works in a dev
checkout (``backend/``), in Docker (``/app``), and in the packaged desktop app
(PyInstaller's unpack dir — see the ``datas`` entry in
``installer/forge-finance.spec``).
"""

import tomllib

from app.core.paths import resource_dir

# Only reached if pyproject.toml is missing or malformed — a broken build,
# never a normal run. Deliberately obvious rather than a plausible version.
FALLBACK_VERSION = "0.0.0"


def _read_version() -> str:
    try:
        with (resource_dir() / "pyproject.toml").open("rb") as f:
            return tomllib.load(f)["project"]["version"]
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return FALLBACK_VERSION


APP_VERSION = _read_version()
