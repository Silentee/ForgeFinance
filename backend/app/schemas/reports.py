"""
schemas/reports.py

All Pydantic response models for the budget and reporting endpoints.
Keeping these in one file makes it easy to see the full data contract
for the frontend at a glance.
"""

from datetime import date
from typing import Optional
from pydantic import BaseModel, field_validator

from app.models.enums import AccountType


# ---------------------------------------------------------------------------
# Budget schemas
# ---------------------------------------------------------------------------

class BudgetBase(BaseModel):
    category_id: int
    month: int
    year: int
    amount: float
    notes: Optional[str] = None

    @field_validator("month")
    @classmethod
    def valid_month(cls, v):
        if not 1 <= v <= 12:
            raise ValueError("month must be between 1 and 12")
        return v

    @field_validator("year")
    @classmethod
    def valid_year(cls, v):
        if not 2000 <= v <= 2100:
            raise ValueError("year must be between 2000 and 2100")
        return v

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, v):
        if v < 0:
            raise ValueError("budget amount must be non-negative")
        return v


class BudgetCreate(BudgetBase):
    pass


class BudgetUpdate(BaseModel):
    amount: Optional[float] = None
    notes: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, v):
        if v is not None and v < 0:
            raise ValueError("budget amount must be non-negative")
        return v


class BudgetRead(BudgetBase):
    id: int
    category_name: Optional[str] = None   # denormalized for convenience

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Category schemas  (exposed here since categories support budgets/reports)
# ---------------------------------------------------------------------------

class CategoryBase(BaseModel):
    name: str
    is_income: bool = False
    color: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    notes: Optional[str] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    is_income: Optional[bool] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    notes: Optional[str] = None


class CategoryRead(CategoryBase):
    id: int
    is_system: bool
    children: list["CategoryRead"] = []

    model_config = {"from_attributes": True}

CategoryRead.model_rebuild()  # needed for self-referential model


# ---------------------------------------------------------------------------
# Budget report — actual vs. budgeted per category for one month
# ---------------------------------------------------------------------------

class BudgetLineItem(BaseModel):
    """One row in the budget report — one category."""
    category_id: Optional[int]
    category_name: str
    parent_category_name: Optional[str]   # None if this IS a top-level category
    is_income: bool

    budgeted: float          # 0.0 if no budget set for this category this month
    actual: float            # total debits (expenses) or credits (income) this month
    remaining: float         # budgeted - actual  (negative = over budget)
    percent_used: Optional[float]   # actual / budgeted * 100; None if budgeted == 0

    transaction_count: int


class BudgetReport(BaseModel):
    """Full budget report for one calendar month."""
    year: int
    month: int
    month_label: str         # e.g. "February 2026"

    # Income section
    total_income_budgeted: float
    total_income_actual: float

    # Expense section
    total_expenses_budgeted: float
    total_expenses_actual: float

    # Bottom line
    net_actual: float        # income_actual - expenses_actual
    net_budgeted: float      # income_budgeted - expenses_budgeted

    income_lines: list[BudgetLineItem]
    expense_lines: list[BudgetLineItem]


# ---------------------------------------------------------------------------
# Cash flow report — income vs. expenses summary for one month
# ---------------------------------------------------------------------------

class CashFlowReport(BaseModel):
    """High-level income/expense summary for a calendar month."""
    year: int
    month: int
    month_label: str

    total_income: float
    total_expenses: float
    net_cash_flow: float     # income - expenses
    savings_rate: Optional[float]  # net / income * 100; None if income == 0

    # Breakdown by account type (useful for seeing credit card vs checking spend)
    income_by_account_type: dict[str, float]
    expenses_by_account_type: dict[str, float]

    # Top 5 expense categories by amount
    top_expense_categories: list[dict]

    # Largest individual transactions (non-transfer)
    largest_transactions: list[dict]


# ---------------------------------------------------------------------------
# Net worth history — monthly snapshots for the trend chart
# ---------------------------------------------------------------------------

class NetWorthDataPoint(BaseModel):
    """One month's net worth breakdown."""
    date: str                # ISO date string, always the last day of the month
    total_assets: float
    total_liabilities: float
    net_worth: float

    # Per account-type breakdown
    by_type: dict[str, float]


class NetWorthHistory(BaseModel):
    """Time series of monthly net worth snapshots."""
    data_points: list[NetWorthDataPoint]
    current_net_worth: float
    change_1m: Optional[float]    # $ change: last month vs 2 months ago
    change_3m: Optional[float]    # $ change: last month vs 4 months ago
    change_period: Optional[float]  # $ change: last month vs start of selected period


# ---------------------------------------------------------------------------
# Spending trends — rolling N-month breakdown by category
# ---------------------------------------------------------------------------

class CategoryTrendSeries(BaseModel):
    """One category's spending across multiple months."""
    category_id: Optional[int]
    category_name: str
    is_income: bool
    monthly_totals: list[float]    # one entry per month in the requested range
    average: float
    total: float


class SpendingTrendsReport(BaseModel):
    """Multi-month spending breakdown, suitable for a stacked bar or line chart."""
    months: list[str]              # e.g. ["2025-11", "2025-12", "2026-01"]
    month_labels: list[str]        # e.g. ["Nov 2025", "Dec 2025", "Jan 2026"]
    series: list[CategoryTrendSeries]

    # Month-level totals (for the summary row)
    monthly_income_totals: list[float]
    monthly_expense_totals: list[float]
    monthly_net_totals: list[float]


# ---------------------------------------------------------------------------
# Equity history — asset value minus linked liability for equity tracking
# ---------------------------------------------------------------------------

class MonthlyTotalsReport(BaseModel):
    """Per-month income/expense totals using budget-report logic."""
    months: list[str]
    month_labels: list[str]
    monthly_income_totals: list[float]
    monthly_expense_totals: list[float]
    monthly_net_totals: list[float]


class EquityDataPoint(BaseModel):
    """One month's equity breakdown for a linked asset/liability pair."""
    date: str                # ISO date string
    asset_value: float
    liability_balance: float
    equity: float            # asset_value - liability_balance


class LinkedEquityPair(BaseModel):
    """Equity history for one asset linked to a liability."""
    asset_id: int
    asset_name: str
    asset_type: str
    liability_id: int
    liability_name: str
    liability_type: str
    current_equity: float
    equity_change_1m: Optional[float]
    equity_change_1y: Optional[float]
    data_points: list[EquityDataPoint]


class EquityHistoryReport(BaseModel):
    """All linked asset/liability pairs with their equity histories."""
    pairs: list[LinkedEquityPair]
    total_linked_equity: float
