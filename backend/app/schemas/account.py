from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator, model_validator

from app.models.enums import AccountType, AccountSubtype
from app.schemas.institution import InstitutionRead


class AccountBase(BaseModel):
    name: str
    account_type: AccountType
    account_subtype: Optional[AccountSubtype] = None
    institution_id: Optional[int] = None
    mask: Optional[str] = None
    currency: str = "USD"
    is_active: bool = True
    include_in_net_worth: bool = True
    is_liquid: Optional[bool] = None  # If None, defaults based on account_type
    notes: Optional[str] = None
    default_csv_preset: Optional[str] = None
    linked_liability_id: Optional[int] = None

    @field_validator("mask")
    @classmethod
    def mask_must_be_4_digits(cls, v):
        if v is not None and (len(v) != 4 or not v.isdigit()):
            raise ValueError("mask must be exactly 4 digits")
        return v

    @field_validator("currency")
    @classmethod
    def currency_uppercase(cls, v):
        return v.upper()


class AccountCreate(AccountBase):
    # Optionally provide an initial balance when creating the account.
    # This creates the first BalanceSnapshot automatically.
    initial_balance: Optional[float] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    account_type: Optional[AccountType] = None
    account_subtype: Optional[AccountSubtype] = None
    institution_id: Optional[int] = None
    mask: Optional[str] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None
    include_in_net_worth: Optional[bool] = None
    is_liquid: Optional[bool] = None
    notes: Optional[str] = None
    default_csv_preset: Optional[str] = None
    linked_liability_id: Optional[int] = None

    @field_validator("mask")
    @classmethod
    def mask_must_be_4_digits(cls, v):
        if v is not None and (len(v) != 4 or not v.isdigit()):
            raise ValueError("mask must be exactly 4 digits")
        return v


class LinkedAccountInfo(BaseModel):
    """Minimal info about a linked account."""
    id: int
    name: str
    account_type: AccountType
    current_balance: Optional[float] = None

    model_config = {"from_attributes": True}


class AccountRead(AccountBase):
    id: int
    current_balance: Optional[float] = None
    balance_updated_at: Optional[datetime] = None
    is_liability: bool
    is_liquid: bool
    net_worth_value: float
    created_at: datetime
    updated_at: datetime

    # Nested institution info when available
    institution: Optional[InstitutionRead] = None

    # Linked account info (for equity tracking)
    linked_liability: Optional[LinkedAccountInfo] = None
    linked_assets: Optional[list[LinkedAccountInfo]] = None

    model_config = {"from_attributes": True}


class AccountSummary(BaseModel):
    """Lightweight version for list views — no nested relations."""
    id: int
    name: str
    account_type: AccountType
    account_subtype: Optional[AccountSubtype] = None
    institution_id: Optional[int] = None
    mask: Optional[str] = None
    current_balance: Optional[float] = None
    balance_updated_at: Optional[datetime] = None
    is_active: bool
    include_in_net_worth: bool
    is_liability: bool
    is_liquid: bool
    net_worth_value: float
    notes: Optional[str] = None
    default_csv_preset: Optional[str] = None
    linked_liability_id: Optional[int] = None
    linked_liability: Optional[LinkedAccountInfo] = None
    linked_assets: Optional[list[LinkedAccountInfo]] = None

    model_config = {"from_attributes": True}


class NetWorthSummary(BaseModel):
    """Aggregated net worth breakdown."""
    total_assets: float
    total_liabilities: float
    net_worth: float
    accounts_by_type: dict[str, float]  # AccountType -> total value
