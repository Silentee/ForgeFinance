"""
main.py — FastAPI application entry point.

Run with:
    uvicorn app.main:app --reload --port 8000

Interactive API docs available at:
    http://localhost:8000/docs     (Swagger UI)
    http://localhost:8000/redoc   (ReDoc)
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.router import api_router


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

    @app.get("/", tags=["health"])
    def root():
        return {
            "app": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
        }

    @app.get("/health", tags=["health"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()
