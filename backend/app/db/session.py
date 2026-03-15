from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# Import settings lazily to avoid circular imports during early startup
def _get_database_url() -> str:
    try:
        from app.core.config import settings
        return settings.database_url
    except Exception:
        return "sqlite:///./app.db"

SQLALCHEMY_DATABASE_URL = _get_database_url()

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed for SQLite
    echo=False,  # set to True to log all SQL queries (useful for debugging)
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that provides a DB session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
