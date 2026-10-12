"""
schemas/income.py

Earners, their gross-income entries, and the income report.
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

IncomeKind = Literal["salary", "bonus", "other"]


def _clean_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("name must not be blank")
    return v


# ---------------------------------------------------------------------------
# Earners
# ---------------------------------------------------------------------------

class EarnerCreate(BaseModel):
    name: str = Field(max_length=120)
    color: Optional[str] = Field(None, max_length=7)
    sort_order: Optional[int] = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, v):
        return _clean_name(v)


class EarnerUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    color: Optional[str] = Field(None, max_length=7)
    sort_order: Optional[int] = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, v):
        return _clean_name(v) if v is not None else v


class EarnerRead(BaseModel):
    id: int
    name: str
    color: Optional[str]
    sort_order: int
    is_demo: bool

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Income entries
# ---------------------------------------------------------------------------

class IncomeEntryCreate(BaseModel):
    earner_id: int
    kind: IncomeKind
    effective_date: date
    # salary: annual gross rate; bonus/other: one-time gross amount
    amount: float = Field(ge=0)
    employer: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class IncomeEntryUpdate(BaseModel):
    earner_id: Optional[int] = None
    kind: Optional[IncomeKind] = None
    effective_date: Optional[date] = None
    amount: Optional[float] = Field(None, ge=0)
    employer: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class IncomeEntryRead(BaseModel):
    id: int
    earner_id: int
    earner_name: Optional[str] = None   # denormalized for convenience
    kind: IncomeKind
    effective_date: date
    amount: float
    employer: Optional[str]
    notes: Optional[str]


# ---------------------------------------------------------------------------
# Income report
# ---------------------------------------------------------------------------

class IncomeEarnerSeries(BaseModel):
    earner_id: int
    name: str
    color: Optional[str]
    # Annual base salary in effect at each month's end; None before the
    # earner's first salary entry.
    monthly_salary_rate: list[Optional[float]]
    # Prorated salary plus one-time items paid that month.
    monthly_gross: list[float]
    # The one-time (bonus/other) part of monthly_gross.
    monthly_one_time: list[float]
    current_salary: float   # annual rate in effect today


class IncomeReport(BaseModel):
    months: list[str]                 # "YYYY-MM"
    month_labels: list[str]           # "Jan 2026"
    earners: list[IncomeEarnerSeries]
    household_monthly_gross: list[float]
    # Net of the take-home categories (credits - debits) from transactions,
    # using the same selection as the budget and cash flow reports.
    monthly_take_home: list[float]
    take_home_category_ids: list[int]
    current_household_salary: float
