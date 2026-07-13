"""
main.py — FastAPI application entry point.

Run with:
    uvicorn app.main:app --reload --port 8000

Interactive API docs available at:
    http://localhost:8000/docs     (Swagger UI)
    http://localhost:8000/redoc   (ReDoc)
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.paths import resource_dir
from app.api.router import api_router


def _frontend_dist() -> Path | None:
    """The bundled React build, present only in the packaged desktop app.

    Returns None in dev and Docker, where the frontend is served separately
    (Vite dev server / nginx), so those code paths are unchanged.
    """
    dist = resource_dir() / "frontend_dist"
    return dist if (dist / "index.html").is_file() else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Runs on startup: creates tables and seeds default categories if needed.
    This means you don't have to run init_db.py manually — just start the server.
    """
    from app.db.init_db import init_db
    init_db()
    yield
    # (nothing needed on shutdown for SQLite)


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        debug=settings.debug,
        lifespan=lifespan,
        redirect_slashes=False,
        description=(
            "Personal finance tracking API. "
            "Supports CSV import, account management, transaction tracking, "
            "and net worth / budget reporting."
        ),
    )

    # CORS — allow the React frontend running on localhost
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount all API routes under /api/v1
    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["health"])
    def health():
        return {"status": "ok"}

    dist = _frontend_dist()
    if dist is None:
        # Dev / Docker: API-only, JSON root exactly as before.
        @app.get("/", tags=["health"])
        def root():
            return {
                "app": settings.app_name,
                "version": settings.app_version,
                "docs": "/docs",
            }
    else:
        # Packaged desktop app: serve the bundled React build same-origin.
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/favicon.svg", include_in_schema=False)
        def favicon():
            return FileResponse(dist / "favicon.svg")

        # Registered LAST so it only catches paths no real route claimed.
        # Serves index.html for "/" and every React Router (history-mode) path;
        # the api/ guard keeps unknown API paths returning 404 JSON, not HTML.
        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
