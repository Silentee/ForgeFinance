from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BudgetVisibleCategoriesRead(BaseModel):
    year: int
    month: int
    category_ids: list[int] | None = None
    updated_at: datetime | None = None


class BudgetVisibleCategoriesUpsert(BaseModel):
    year: int
    month: int = Field(..., ge=1, le=12)
    category_ids: list[int]

