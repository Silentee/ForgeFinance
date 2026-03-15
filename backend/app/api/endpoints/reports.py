"""
reports.py — Read-only reporting endpoints.

All computation lives in services/reporting.py. These endpoints are
thin wrappers that handle HTTP concerns (validation, query params, errors)
and delegate to the service layer.
"""

from calendar import monthrange
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Transaction
from app.models.enums import TransactionType
from app.schemas.reports import (
    BudgetReport,
    CashFlowReport,
    EquityHistoryReport,
    MonthlyTotalsReport,
    NetWorthHistory,
    SpendingTrendsReport,
)
from app.services.reporting import (
    build_budget_report,
    build_cash_flow_report,
    build_equity_history,
    build_monthly_totals,
    build_net_worth_history,
    build_spending_trends,
    _get_annualized_contributions,
)

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


@router.get("/cash-flow/{year}/{month}", response_model=CashFlowReport)
def get_cash_flow_report(
    year: int,
    month: int,
    account_ids: Optional[str] = Query(None, description="Comma-separated account IDs"),
    db: Session = Depends(get_db),
):
    """
    High-level income vs. expenses summary for a calendar month.

    Includes:
    - Total income and expenses
    - Net cash flow and savings rate
    - Breakdown by account type (checking vs credit card spend, etc.)
    - Top 5 spending categories
    - 10 largest individual transactions
    """
    _validate_year_month(year, month)
    account_id_list = _parse_account_ids(account_ids)
    return build_cash_flow_report(db, year, month, account_id_list)


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


@router.get("/summary/current-month")
def get_current_month_summary(db: Session = Depends(get_db)):
    """
    Convenience endpoint: returns cash flow + budget report for the current
    calendar month in a single call. Useful for dashboard loading.
    """
    from datetime import date
    today = date.today()
    cash_flow = build_cash_flow_report(db, today.year, today.month)
    budget = build_budget_report(db, today.year, today.month)

    return {
        "cash_flow": cash_flow,
        "budget": budget,
    }


@router.get("/daily-spending")
def get_daily_spending(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    compare_months: int = Query(3, ge=1, le=12),
    db: Session = Depends(get_db),
):
    """
    Daily cumulative spending for the given month vs. an average of the
    preceding compare_months months.

    Returns arrays of length 31 (one slot per possible day-of-month).
    current_month values beyond today are null so the line stops at the
    current day. average_month is fully populated for all 31 slots.
    """
    today = date.today()

    # ── Current month ────────────────────────────────────────────────────────
    first_of_month = date(year, month, 1)
    days_in_month = monthrange(year, month)[1]
    last_of_month = date(year, month, days_in_month)
    cutoff = min(last_of_month, today)

    current_txns = (
        db.query(Transaction)
        .filter(
            Transaction.date >= first_of_month,
            Transaction.date <= cutoff,
            Transaction.is_transfer == False,
            Transaction.exclude_from_budget == False,
            Transaction.is_annualized == False,
        )
        .all()
    )

    current_annualized_total = sum(
        monthly_share for _, monthly_share in _get_annualized_contributions(db, year, month)
    )

    current_daily: dict[int, float] = {}
    for t in current_txns:
        d = t.date.day
        amount = float(t.amount)
        cat_is_income = t.category.is_income if t.category else False
        if t.transaction_type == TransactionType.DEBIT:
            current_daily[d] = current_daily.get(d, 0.0) + amount
        elif not cat_is_income:
            current_daily[d] = current_daily.get(d, 0.0) - amount

    # How far into the month we are (or full month if historical)
    if year == today.year and month == today.month:
        show_days = today.day
    else:
        show_days = days_in_month

    current_cumulative: list = []
    running = current_annualized_total
    for d in range(1, 32):
        if d <= show_days:
            running += current_daily.get(d, 0.0)
            current_cumulative.append(round(running, 2))
        else:
            current_cumulative.append(None)

    # ── Comparison months ────────────────────────────────────────────────────
    comp_cumulatives: list[list[float]] = []
    for i in range(1, compare_months + 1):
        m = month - i
        y = year
        while m <= 0:
            m += 12
            y -= 1

        comp_first = date(y, m, 1)
        comp_last = date(y, m, monthrange(y, m)[1])
        total_days = monthrange(y, m)[1]

        comp_txns = (
            db.query(Transaction)
            .filter(
                Transaction.date >= comp_first,
                Transaction.date <= comp_last,
                Transaction.is_transfer == False,
                Transaction.exclude_from_budget == False,
                Transaction.is_annualized == False,
            )
            .all()
        )

        comp_daily: dict[int, float] = {}
        for t in comp_txns:
            d = t.date.day
            amount = float(t.amount)
            cat_is_income = t.category.is_income if t.category else False
            if t.transaction_type == TransactionType.DEBIT:
                comp_daily[d] = comp_daily.get(d, 0.0) + amount
            elif not cat_is_income:
                comp_daily[d] = comp_daily.get(d, 0.0) - amount

        comp_annualized_total = sum(
            monthly_share for _, monthly_share in _get_annualized_contributions(db, y, m)
        )

        # Build 31-slot cumulative; hold the last value for days past month-end
        cumulative: list[float] = []
        r = comp_annualized_total
        for d in range(1, 32):
            if d <= total_days:
                r += comp_daily.get(d, 0.0)
            cumulative.append(r)
        comp_cumulatives.append(cumulative)

    # Average across comparison months for each day slot
    average_cumulative: list[float] = []
    for idx in range(31):
        vals = [c[idx] for c in comp_cumulatives]
        average_cumulative.append(round(sum(vals) / len(vals), 2) if vals else 0.0)

    return {
        "days": list(range(1, 32)),
        "current_month": current_cumulative,
        "average_month": average_cumulative,
    }


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
