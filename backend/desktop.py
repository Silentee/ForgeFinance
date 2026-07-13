"""
desktop.py — Forge Finance packaged Windows desktop launcher.

This is the PyInstaller entry point. It is NOT used in normal dev or Docker;
those run uvicorn directly. Here we:

  1. Enforce a single running instance (named Windows mutex).
  2. Redirect stdout/stderr to a log file (a windowed exe has no console).
  3. Start uvicorn on a free localhost port in a background thread.
  4. Wait for the server to answer /health.
  5. Open a native pywebview window (Edge WebView2) pointed at the app.
  6. Shut the server down cleanly when the window closes.

Run from a dev checkout for testing (needs the `desktop` dependency group and
a staged backend/frontend_dist):

    uv run --group desktop python desktop.py
"""

import ctypes
import os
import socket
import sys
import threading
import time

# Must be set BEFORE anything under `app` is imported so config/init_db resolve
# the per-user data dir and the bundled frontend instead of dev defaults.
os.environ.setdefault("FORGE_DESKTOP", "1")

_ERROR_ALREADY_EXISTS = 183
_MUTEX_NAME = "Local\\ForgeFinanceDesktop"
# Edge WebView2 Runtime product GUID under EdgeUpdate\Clients.
_WEBVIEW2_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
_WEBVIEW2_DOWNLOAD = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
# MessageBox icon flags.
_MB_INFO = 0x40
_MB_ERROR = 0x10


def _message_box(text: str, flags: int = _MB_INFO) -> None:
    ctypes.windll.user32.MessageBoxW(None, text, "Forge Finance", flags)


def _acquire_single_instance() -> bool:
    """Return True if this is the only instance. The mutex is released
    automatically by Windows when the process exits (even on a crash), so a
    stale lock can never wedge future launches."""
    ctypes.windll.kernel32.CreateMutexW(None, False, _MUTEX_NAME)
    return ctypes.windll.kernel32.GetLastError() != _ERROR_ALREADY_EXISTS


def _webview2_installed() -> bool:
    """True if the Edge WebView2 Runtime is present (any per-user or
    machine-wide install). All Win11 and patched Win10 ship it."""
    import winreg

    subkey = r"SOFTWARE\Microsoft\EdgeUpdate\Clients\%s" % _WEBVIEW2_GUID
    candidates = [
        (winreg.HKEY_CURRENT_USER, subkey),
        (winreg.HKEY_LOCAL_MACHINE, subkey),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\%s" % _WEBVIEW2_GUID),
    ]
    for root, path in candidates:
        try:
            with winreg.OpenKey(root, path) as key:
                version, _ = winreg.QueryValueEx(key, "pv")
                if version and version != "0.0.0.0":
                    return True
        except OSError:
            continue
    return False


def _find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    if not _acquire_single_instance():
        _message_box("Forge Finance is already running.")
        return

    # Windowed build: stdout/stderr are unusable. Route prints (init_db logs
    # its progress) and uvicorn output to a log the user can share on failure.
    from app.core.paths import data_dir  # only touches filesystem paths

    log_path = data_dir() / "forge-finance.log"
    log = open(log_path, "a", buffering=1, encoding="utf-8")
    sys.stdout = log
    sys.stderr = log

    if not _webview2_installed():
        _message_box(
            "Forge Finance needs the Microsoft Edge WebView2 Runtime, which "
            "is not installed on this PC.\n\n"
            "Click OK to open the download page, install it, then relaunch "
            "Forge Finance.",
            _MB_INFO,
        )
        os.startfile(_WEBVIEW2_DOWNLOAD)  # noqa: S606 (trusted MS URL)
        return

    import uvicorn

    from app.main import app  # settings already resolved with FORGE_DESKTOP=1

    port = _find_free_port()
    url = f"http://127.0.0.1:{port}"

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
    )
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    # First launch runs migrations + demo seeding, so allow a generous window.
    import urllib.error
    import urllib.request

    deadline = time.time() + 120
    ready = False
    while time.time() < deadline:
        if not server_thread.is_alive():
            break  # server crashed during startup
        try:
            with urllib.request.urlopen(url + "/health", timeout=1) as resp:
                if resp.status == 200:
                    ready = True
                    break
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)

    if not ready:
        _message_box(
            "Forge Finance failed to start.\n\nSee the log file at:\n"
            f"{log_path}",
            _MB_ERROR,
        )
        server.should_exit = True
        return

    # Headless build smoke test: verify the frozen server starts and serves,
    # then exit without opening a window. Used to validate PyInstaller builds
    # in a script. Exit code reflects success.
    if os.environ.get("FORGE_DESKTOP_SMOKE") == "1":
        ok = False
        try:
            with urllib.request.urlopen(url + "/", timeout=5) as resp:
                ok = resp.status == 200 and b"<div id=\"root\"" in resp.read()
        except (urllib.error.URLError, OSError):
            ok = False
        print(f"SMOKE: served index.html = {ok}")
        server.should_exit = True
        server_thread.join(timeout=10)
        sys.exit(0 if ok else 1)

    import webview

    webview.create_window(
        "Forge Finance",
        url,
        width=1280,
        height=850,
        min_size=(960, 640),
    )
    webview.start()  # blocks until the window is closed

    # Clean shutdown: uvicorn drains the lifespan (SQLite closes tidily).
    server.should_exit = True
    server_thread.join(timeout=10)


if __name__ == "__main__":
    main()
