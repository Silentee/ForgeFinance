from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, field_validator

# Alias prevents Pydantic v2 from resolving the 'date' field-name as its own
# default (None) when get_type_hints() uses the class namespace as localns.
_Date = date

from app.models.enums import TransactionType


class TransactionBase(BaseModel):
    account_id: int
    category_id: Optional[int] = None
    date: date
    amount: float
    transaction_type: TransactionType
    original_description: str
    description: Optional[str] = None
    merchant_name: Optional[str] = None
    is_pending: bool = False
    is_transfer: bool = False
    exclude_from_budget: bool = False
    is_annualized: bool = False
    notes: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("amount must be a positive number; use transaction_type for direction")
        return v


class TransactionCreate(TransactionBase):
    pass


class TransactionUpdate(BaseModel):
    category_id: Optional[int] = None
    date: Optional[_Date] = None
    amount: Optional[float] = None
    transaction_type: Optional[TransactionType] = None
    description: Optional[str] = None
    merchant_name: Optional[str] = None
    is_pending: Optional[bool] = None
    is_transfer: Optional[bool] = None
    exclude_from_budget: Optional[bool] = None
    is_annualized: Optional[bool] = None
    notes: Optional[str] = None


class TransactionRead(TransactionBase):
    id: int
    import_source_id: Optional[int] = None
    dedup_hash: Optional[str] = None
    signed_amount: float
    created_at: datetime
    updated_at: datetime

    # Denormalized for convenience in list views
    account_name: Optional[str] = None
    category_name: Optional[str] = None

    model_config = {"from_attributes": True}


class TransactionFilter(BaseModel):
    """Query parameters for filtering transaction lists."""
    account_id: Optional[int] = None
    category_id: Optional[int] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    transaction_type: Optional[TransactionType] = None
    is_transfer: Optional[bool] = None
    exclude_from_budget: Optional[bool] = None
    is_pending: Optional[bool] = None
    is_annualized: Optional[bool] = None
    search: Optional[str] = None   # fuzzy search on description/merchant
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    limit: int = 100
    offset: int = 0

