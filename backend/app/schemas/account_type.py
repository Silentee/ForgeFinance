from typing import Optional
from pydantic import BaseModel


class AccountTypeCreate(BaseModel):
    label: str
    is_liability: bool = False
    is_liquid_default: bool = False
    key: Optional[str] = None  # auto-derived from label if omitted
    sort_order: Optional[int] = None


class AccountTypeUpdate(BaseModel):
    label: Optional[str] = None
    is_liability: Optional[bool] = None
    is_liquid_default: Optional[bool] = None
    is_hidden: Optional[bool] = None
    sort_order: Optional[int] = None


class AccountTypeRead(BaseModel):
    id: int
    key: str
    label: str
    is_liability: bool
    is_liquid_default: bool
    is_system: bool
    is_hidden: bool
    sort_order: int

    model_config = {"from_attributes": True}
