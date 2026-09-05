from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter()


class AppMeta(BaseModel):
    app: str
    version: str


@router.get("", response_model=AppMeta)
def get_meta():
    """App name and version. Public — the sidebar renders this before/without auth."""
    return AppMeta(app=settings.app_name, version=settings.app_version)
