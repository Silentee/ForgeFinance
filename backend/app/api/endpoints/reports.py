"""
reports.py — Read-only reporting endpoints.

All computation lives in services/reporting.py. These endpoints are
thin wrappers that handle HTTP concerns (validation, query params, errors)
and delegate to the service layer.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.reports import (
    BudgetReport,
    EquityHistoryReport,
    MonthlyTotalsReport,
    NetWorthHistory,
    SpendingAveragesReport,
    SpendingTrendsReport,
)
from app.schemas.subscriptions import SubscriptionsReport
from app.services.reporting import (
    build_budget_report,
    build_equity_history,
    build_monthly_totals,
    build_net_worth_history,
    build_spending_averages,
    build_spending_trends,
)
from app.services.subscriptions import build_subscriptions_report

router = APIRouter()


@router.get("/budget/{year}/{month}", response_model=BudgetReport)
def get_budget_report(
    year: int,
    month: int,
    account_ids: Optional[str] = Query(
        None,
        description="Comma-separated list of account IDs to limit the report to. "
                    "Leave blank to include all accounts.",
    ),
    db: Session = Depends(get_db),
):
    """
    Budget vs. actual spending report for a given calendar month.

    Returns every category that either has a budget set OR had transactions
    in that month. Categories are split into income and expense sections.

    Each line item includes:
    - budgeted: the target amount (0 if no budget was set)
    - actual: real spending/income from transactions
    - remaining: budget - actual (negative = over budget)
    - percent_used: how much of the budget has been consumed
    """
    _validate_year_month(year, month)
    account_id_list = _parse_account_ids(account_ids)
    return build_budget_report(db, year, month, account_id_list)


@router.get("/net-worth/history", response_model=NetWorthHistory)
def get_net_worth_history(
    months: int = Query(
        24,
        ge=1,
        le=600,
        description="Number of months of history to return (max 600 = 50 years)",
    ),
    db: Session = Depends(get_db),
):
    """
    Monthly net worth time series for trend charts.

    For each month in the range, finds the most recent balance snapshot
    for each account and aggregates into total assets, total liabilities,
    and net worth. Accounts without snapshots for a given month are excluded
    from that month's calculation.

    Also returns period-over-period changes (1 month, 3 months, 1 year).
    """
    return build_net_worth_history(db, months)


@router.get("/spending-trends", response_model=SpendingTrendsReport)
def get_spending_trends(
    months: int = Query(6, ge=1, le=120, description="Rolling window in months (1-120)"),
    year: Optional[int] = Query(None, ge=2000, le=2100, description="End year (defaults to current)"),
    month: Optional[int] = Query(None, ge=1, le=12, description="End month (defaults to current)"),
    account_ids: Optional[str] = Query(None, description="Comma-separated account IDs"),
    top_n: int = Query(
        10,
        ge=1,
        le=50,
        description="Number of top expense categories to show individually. "
                    "Remaining categories are aggregated into 'Other'.",
    ),
    db: Session = Depends(get_db),
):
    """
    Multi-month spending breakdown by category.

    Returns a series per category suitable for a stacked bar chart or
    multi-line trend chart. Only the top N expense categories by total
    spend appear as individual series — the rest are collapsed into 'Other'.

    Income categories are always shown as individual series.

    Optionally specify year/month to anchor the end of the range to a specific
    month instead of the current month.
    """
    account_id_list = _parse_account_ids(account_ids)
    return build_spending_trends(db, months, account_id_list, top_n, year, month)


@router.get("/spending-averages/{year}/{month}", response_model=SpendingAveragesReport)
def get_spending_averages(
    year: int,
    month: int,
    account_ids: Optional[str] = Query(None, description="Comma-separated account IDs"),
    db: Session = Depends(get_db),
):
    """
    Per-category average monthly spend over trailing 1M/3M/6M/12M windows,
    anchored to a budget month.

    Windows include the selected month, except when it is the current calendar
    month — then they end at the previous complete month. Each category's
    monthly value uses budget-report sign conventions so the averages are
    directly comparable to budget amounts.
    """
    _validate_year_month(year, month)
    account_id_list = _parse_account_ids(account_ids)
    return build_spending_averages(db, year, month, account_id_list)


@router.get("/monthly-totals", response_model=MonthlyTotalsReport)
def get_monthly_totals(
    months: int = Query(12, ge=1, le=120),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    account_ids: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Per-month income/expense totals using budget-report logic."""
    account_id_list = _parse_account_ids(account_ids)
    return build_monthly_totals(db, months, year, month, account_id_list)


@router.get("/equity/history", response_model=EquityHistoryReport)
def get_equity_history(
    months: int = Query(
        24,
        ge=1,
        le=600,
        description="Number of months of history to return (max 600 = 50 years)",
    ),
    db: Session = Depends(get_db),
):
    """
    Equity history for all linked asset/liability pairs.

    For assets that have a linked liability (e.g., home -> mortgage),
    computes the equity (asset value - liability balance) over time.
    Useful for tracking home equity, car equity, etc.
    """
    return build_equity_history(db, months)


@router.get("/subscriptions", response_model=SubscriptionsReport)
def get_subscriptions_report(
    months: int = Query(24, ge=6, le=60, description="Lookback window in months"),
    account_ids: Optional[str] = Query(None, description="Comma-separated account IDs"),
    tagged_only: bool = Query(
        False, description="Only transactions categorized as 'Subscriptions'"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Recurring charges detected from transaction history.

    Groups debits by a normalized merchant key and looks for a regular
    cadence (weekly through annual) with similar amounts. Returns detected
    subscriptions with cadence, status (active/lapsed), price-increase flags,
    and monthly-equivalent cost, plus dismissed merchants and near-miss
    candidates the user can choose to track. Per-merchant overrides are
    managed via /subscriptions/rules.

    Transactions categorized as 'Subscriptions' are always included (even a
    single one-off charge); tagged_only restricts the report to just those.
    """
    account_id_list = _parse_account_ids(account_ids)
    return build_subscriptions_report(db, user.id, months, account_id_list, tagged_only)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_year_month(year: int, month: int):
    if not 2000 <= year <= 2100:
        raise HTTPException(status_code=422, detail="year must be between 2000 and 2100")
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="month must be between 1 and 12")


def _parse_account_ids(account_ids_str: Optional[str]) -> Optional[list[int]]:
    """Parse a comma-separated string of account IDs into a list of ints."""
    if not account_ids_str:
        return None
    try:
        return [int(x.strip()) for x in account_ids_str.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="account_ids must be a comma-separated list of integers, e.g. '1,2,3'",
        )
