from pydantic_settings import BaseSettings


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
    csv_upload_dir: str = "./uploads"

    # Authentication
    secret_key: str = ""  # auto-generated on first run if empty
    access_token_expire_minutes: int = 1440  # 24 hours

    # Future: Plaid credentials (leave empty until needed)
    plaid_client_id: str = ""
    plaid_secret: str = ""
    plaid_env: str = "sandbox"   # sandbox | development | production

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
