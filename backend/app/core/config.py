import os

from pydantic_settings import BaseSettings

from app.core import paths


class Settings(BaseSettings):
    app_name: str = "Forge Finance"
    app_version: str = "1.0"
    debug: bool = True

    # Database — SQLite by default, easily swappable
    database_url: str = "sqlite:///./app.db"

    # CORS — localhost origins only (this is a local app)
    cors_origins: list[str] = [
        "http://localhost:5173",   # Vite dev server
        "http://localhost:3000",   # alternate React port
        "http://localhost:8080",
        "http://192.168.20.20:5173",  # Server's own IP
    ]

    # CSV import settings
    max_csv_file_size_mb: int = 50

    # Authentication
    secret_key: str = ""  # auto-generated on first run if empty
    access_token_expire_minutes: int = 1440  # 24 hours

    # Future: Plaid credentials (leave empty until needed)
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"   # sandbox | development | production

    model_config = {
        # Desktop mode keeps all persistent config (notably the generated
        # SECRET_KEY) in the per-user data dir, ignoring any stray .env next
        # to the executable or CWD. Dev/Docker read backend/.env as before.
        "env_file": (
            str(paths.data_dir() / ".env")
            if paths.is_desktop()
            else ".env"
        ),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()

# In the packaged desktop app the process CWD is not writable (Program Files
# style install), so redirect the default CWD-relative SQLite path into the
# per-user data dir. An explicit DATABASE_URL (e.g. Docker's) always wins, and
# non-desktop runs are untouched. Must happen here, before app.db.session
# builds the engine from settings.database_url at import time.
if (
    paths.is_desktop()
    and not os.environ.get("DATABASE_URL")
    and settings.database_url == "sqlite:///./app.db"
):
    settings.database_url = "sqlite:///" + (paths.data_dir() / "app.db").as_posix()
