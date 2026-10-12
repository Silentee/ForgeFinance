"""
schemas/income.py

Earners, their gross-income entries, and the income report.
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

IncomeKind = Literal["salary", "bonus", "award", "other"]


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
    # salary: annual gross rate; bonus/award/other: one-time gross amount
    amount: float = Field(ge=0)
    employer: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    # salary only: target annual bonus, % of base
    target_bonus_pct: Optional[float] = Field(None, ge=0, le=1000)
    # bonus only: performance year (defaults to the year before it was paid)
    bonus_year: Optional[int] = Field(None, ge=1900, le=2200)


class IncomeEntryUpdate(BaseModel):
    earner_id: Optional[int] = None
    kind: Optional[IncomeKind] = None
    effective_date: Optional[date] = None
    amount: Optional[float] = Field(None, ge=0)
    employer: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    target_bonus_pct: Optional[float] = Field(None, ge=0, le=1000)
    bonus_year: Optional[int] = Field(None, ge=1900, le=2200)


class IncomeEntryRead(BaseModel):
    id: int
    earner_id: int
    earner_name: Optional[str] = None   # denormalized for convenience
    kind: IncomeKind
    effective_date: date
    amount: float
    employer: Optional[str]
    notes: Optional[str]
    target_bonus_pct: Optional[float]
    bonus_year: Optional[int]


# ---------------------------------------------------------------------------
# Income report
# ---------------------------------------------------------------------------

class IncomeBonusYear(BaseModel):
    """One performance year's annual bonus: target vs what was paid for it."""
    year: int
    # Base and target % in effect on Dec 31 of the year (None: no salary yet).
    base_salary: Optional[float]
    target_pct: Optional[float]
    target_amount: Optional[float]
    # Sum of annual bonuses paid for this year, whenever paid; None if none yet.
    actual_amount: Optional[float]
    attainment_pct: Optional[float]   # actual / target * 100
    in_progress: bool                 # the year hasn't ended yet


class IncomeEarnerSeries(BaseModel):
    earner_id: int
    name: str
    color: Optional[str]
    # Annual base salary in effect at each month's end; None before the
    # earner's first salary entry.
    monthly_salary_rate: list[Optional[float]]
    # Target bonus % in effect at each month's end, aligned with
    # monthly_salary_rate (0 when the salary carries no target).
    monthly_target_bonus_pct: list[Optional[float]]
    # Prorated salary plus one-time items paid that month.
    monthly_gross: list[float]
    # The one-time (bonus/award/other) part of monthly_gross.
    monthly_one_time: list[float]
    current_salary: float          # annual rate in effect today
    current_target_bonus: float    # target bonus on today's rate and %
    # Performance years in the window with a target or a paid bonus, newest first.
    bonus_years: list[IncomeBonusYear]


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
    current_household_target_bonus: float
