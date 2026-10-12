"""
services/income.py

Gross-income report: each earner's salary history and gross income over
time, compared against take-home pay deposited into tracked accounts.

Salary is a step function, like balance snapshots: the annual rate in effect
on a date is the earner's latest salary entry on or before it. A month's
gross salary is prorated by day, so a raise mid-month splits that month and
a full year at a constant rate sums to exactly that rate.
"""

from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Category, Earner, IncomeEntry
from app.schemas.income import IncomeEarnerSeries, IncomeReport
from app.services.reporting import (
    _add_months,
    _aggregate_monthly,
    _first_day_of_month,
    _last_day_of_month,
    _month_key,
    _short_month_label,
)

# Seeded system category that paycheck deposits are filed under; the
# default take-home source when the caller doesn't pick categories.
DEFAULT_TAKE_HOME_CATEGORY = "Salary & Wages"

MAX_MONTHS = 600


def _salary_rate_on(salary_entries: list[IncomeEntry], cutoff: date) -> Optional[float]:
    """Annual salary in effect on cutoff (latest entry on or before it), or
    None before the first entry. salary_entries must be date-sorted."""
    rate = None
    for entry in salary_entries:
        if entry.effective_date > cutoff:
            break
        rate = float(entry.amount)
    return rate


def _prorated_month_salary(salary_entries: list[IncomeEntry], year: int, month: int) -> float:
    """Gross salary earned in one month. Each salary segment overlapping the
    month contributes rate/12 weighted by the share of the month's days it
    covers. salary_entries must be date-sorted."""
    first = _first_day_of_month(year, month)
    last = _last_day_of_month(year, month)
    total = 0.0
    for i, entry in enumerate(salary_entries):
        seg_end = (
            salary_entries[i + 1].effective_date - timedelta(days=1)
            if i + 1 < len(salary_entries)
            else last
        )
        start = max(entry.effective_date, first)
        end = min(seg_end, last)
        if start > end:
            continue
        overlap_days = (end - start).days + 1
        total += float(entry.amount) / 12.0 * overlap_days / last.day
    return total


def resolve_take_home_category_ids(db: Session, ids: Optional[list[int]]) -> list[int]:
    """The categories whose net deposits count as take-home pay: the caller's
    pick if given (possibly empty), else the 'Salary & Wages' category."""
    if ids is not None:
        return ids
    rows = (
        db.query(Category.id)
        .filter(Category.is_income == True, Category.name == DEFAULT_TAKE_HOME_CATEGORY)
        .all()
    )
    return [r.id for r in rows]


def build_income_report(
    db: Session,
    months: Optional[int] = None,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
    take_home_category_ids: Optional[list[int]] = None,
) -> IncomeReport:
    """Per-month gross income by earner plus household take-home, over the
    `months` ending at end_year/end_month (default: current month). With no
    `months`, the window starts at the earliest income entry."""
    today = date.today()
    anchor_year = end_year if end_year is not None else today.year
    anchor_month = end_month if end_month is not None else today.month

    earners: list[Earner] = (
        db.query(Earner).order_by(Earner.sort_order, Earner.name, Earner.id).all()
    )
    entries: list[IncomeEntry] = (
        db.query(IncomeEntry).order_by(IncomeEntry.effective_date, IncomeEntry.id).all()
    )

    if months is None:
        if entries:
            first = entries[0].effective_date
            months = (anchor_year * 12 + anchor_month) - (first.year * 12 + first.month) + 1
        else:
            months = 12
    months = max(1, min(months, MAX_MONTHS))

    periods: list[tuple[int, int]] = [
        _add_months(anchor_year, anchor_month, -i) for i in range(months - 1, -1, -1)
    ]
    month_keys = [_month_key(y, m) for y, m in periods]

    salaries_by_earner: dict[int, list[IncomeEntry]] = defaultdict(list)
    one_time_by_earner: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for entry in entries:
        if entry.kind == "salary":
            salaries_by_earner[entry.earner_id].append(entry)
        else:
            mk = _month_key(entry.effective_date.year, entry.effective_date.month)
            one_time_by_earner[entry.earner_id][mk] += float(entry.amount)

    household_gross = [0.0] * len(periods)
    series: list[IncomeEarnerSeries] = []
    for earner in earners:
        salaries = salaries_by_earner.get(earner.id, [])
        one_time = one_time_by_earner.get(earner.id, {})
        rates: list[Optional[float]] = []
        gross: list[float] = []
        one_time_totals: list[float] = []
        for i, ((y, m), mk) in enumerate(zip(periods, month_keys)):
            rate = _salary_rate_on(salaries, _last_day_of_month(y, m))
            extra = one_time.get(mk, 0.0)
            month_gross = _prorated_month_salary(salaries, y, m) + extra
            household_gross[i] += month_gross
            rates.append(round(rate, 2) if rate is not None else None)
            gross.append(round(month_gross, 2))
            one_time_totals.append(round(extra, 2))

        series.append(IncomeEarnerSeries(
            earner_id=earner.id,
            name=earner.name,
            color=earner.color,
            monthly_salary_rate=rates,
            monthly_gross=gross,
            monthly_one_time=one_time_totals,
            current_salary=round(_salary_rate_on(salaries, today) or 0.0, 2),
        ))

    # Take-home: net deposits on the take-home categories, aggregated exactly
    # like the budget and cash flow reports (transfers/excluded rows skipped).
    take_home_ids = resolve_take_home_category_ids(db, take_home_category_ids)
    take_home = [0.0] * len(periods)
    if take_home_ids:
        agg = _aggregate_monthly(db, periods)
        for cat_id in take_home_ids:
            if cat_id not in agg:
                continue
            for i, mk in enumerate(month_keys):
                vals = agg[cat_id][mk]
                take_home[i] += vals["credits"] - vals["debits"]

    return IncomeReport(
        months=month_keys,
        month_labels=[_short_month_label(y, m) for y, m in periods],
        earners=series,
        household_monthly_gross=[round(v, 2) for v in household_gross],
        monthly_take_home=[round(v, 2) for v in take_home],
        take_home_category_ids=take_home_ids,
        current_household_salary=round(sum(s.current_salary for s in series), 2),
    )
