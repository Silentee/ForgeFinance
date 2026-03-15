"""
services/reporting.py

Reporting service functions used by /reports endpoints.
"""

import calendar
from collections import defaultdict
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Account, BalanceSnapshot, Budget, Category, Transaction
from app.models.enums import TransactionType
from app.schemas.reports import (
    BudgetLineItem,
    BudgetReport,
    CashFlowReport,
    CategoryTrendSeries,
    EquityDataPoint,
    EquityHistoryReport,
    LinkedEquityPair,
    MonthlyTotalsReport,
    NetWorthDataPoint,
    NetWorthHistory,
    SpendingTrendsReport,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _month_label(year: int, month: int) -> str:
    return date(year, month, 1).strftime("%B %Y")


def _short_month_label(year: int, month: int) -> str:
    return date(year, month, 1).strftime("%b %Y")


def _month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _last_day_of_month(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _first_day_of_month(year: int, month: int) -> date:
    return date(year, month, 1)


def _add_months(year: int, month: int, n: int) -> tuple[int, int]:
    total = (year * 12 + month - 1) + n
    return total // 12, total % 12 + 1


def _get_budget_transactions(
    db: Session,
    date_from: date,
    date_to: date,
    account_ids: Optional[list[int]] = None,
) -> list[Transaction]:
    q = (
        db.query(Transaction)
        .filter(
            Transaction.date >= date_from,
            Transaction.date <= date_to,
            Transaction.is_transfer == False,
            Transaction.exclude_from_budget == False,
            Transaction.is_annualized == False,
        )
    )
    if account_ids:
        q = q.filter(Transaction.account_id.in_(account_ids))
    return q.all()


def _get_annualized_contributions(
    db: Session,
    year: int,
    month: int,
    account_ids: Optional[list[int]] = None,
) -> list[tuple[Transaction, float]]:
    window_start_year, window_start_month = _add_months(year, month, -11)
    window_start = _first_day_of_month(window_start_year, window_start_month)
    window_end = _last_day_of_month(year, month)

    q = db.query(Transaction).filter(
        Transaction.is_annualized == True,
        Transaction.transaction_type == TransactionType.DEBIT,
        Transaction.is_transfer == False,
        Transaction.exclude_from_budget == False,
        Transaction.date >= window_start,
        Transaction.date <= window_end,
    )
    if account_ids:
        q = q.filter(Transaction.account_id.in_(account_ids))
    return [(tx, float(tx.amount) / 12.0) for tx in q.all()]


def _latest_balance_on_or_before(snapshots: list[BalanceSnapshot], cutoff: date) -> Optional[float]:
    for snap in reversed(snapshots):
        if snap.snapshot_date <= cutoff:
            return float(snap.balance)
    return None


# ---------------------------------------------------------------------------
# Budget report
# ---------------------------------------------------------------------------

def build_budget_report(
    db: Session,
    year: int,
    month: int,
    account_ids: Optional[list[int]] = None,
) -> BudgetReport:
    date_from = _first_day_of_month(year, month)
    date_to = _last_day_of_month(year, month)

    budgets: list[Budget] = (
        db.query(Budget)
        .filter(Budget.year == year, Budget.month == month)
        .all()
    )
    budget_by_cat: dict[int, float] = {b.category_id: float(b.amount) for b in budgets}

    transactions = _get_budget_transactions(db, date_from, date_to, account_ids)

    actuals: dict[Optional[int], dict] = defaultdict(
        lambda: {"debits": 0.0, "credits": 0.0, "count": 0}
    )
    for tx in transactions:
        key = tx.category_id
        actuals[key]["count"] += 1
        if tx.transaction_type == TransactionType.DEBIT:
            actuals[key]["debits"] += float(tx.amount)
        else:
            actuals[key]["credits"] += float(tx.amount)

    for tx, monthly_share in _get_annualized_contributions(db, year, month, account_ids):
        actuals[tx.category_id]["debits"] += monthly_share

    cat_ids_needed = set(budget_by_cat.keys()) | {k for k in actuals if k is not None}
    categories: dict[int, Category] = {}
    if cat_ids_needed:
        for cat in db.query(Category).filter(Category.id.in_(cat_ids_needed)).all():
            categories[cat.id] = cat

    parent_ids = {c.parent_id for c in categories.values() if c.parent_id}
    parents: dict[int, Category] = {}
    if parent_ids:
        for cat in db.query(Category).filter(Category.id.in_(parent_ids)).all():
            parents[cat.id] = cat

    all_cat_ids: set[Optional[int]] = set(budget_by_cat.keys()) | set(actuals.keys())
    income_lines: list[BudgetLineItem] = []
    expense_lines: list[BudgetLineItem] = []

    for cat_id in sorted(all_cat_ids, key=lambda x: (x is None, x)):
        cat = categories.get(cat_id) if cat_id is not None else None
        is_income = cat.is_income if cat else False
        cat_name = cat.name if cat else "Uncategorized"
        parent_name = (
            parents[cat.parent_id].name
            if (cat and cat.parent_id and cat.parent_id in parents)
            else None
        )

        budgeted = float(budget_by_cat.get(cat_id, 0.0))
        a = actuals.get(cat_id, {"debits": 0.0, "credits": 0.0, "count": 0})
        actual = (a["credits"] - a["debits"]) if is_income else (a["debits"] - a["credits"])
        remaining = budgeted - actual
        percent_used = round((actual / budgeted) * 100, 2) if budgeted > 0 else None

        line = BudgetLineItem(
            category_id=cat_id,
            category_name=cat_name,
            parent_category_name=parent_name,
            is_income=is_income,
            budgeted=round(budgeted, 2),
            actual=round(actual, 2),
            remaining=round(remaining, 2),
            percent_used=percent_used,
            transaction_count=int(a["count"]),
        )
        if is_income:
            income_lines.append(line)
        else:
            expense_lines.append(line)

    income_lines.sort(key=lambda l: l.category_name.lower())
    expense_lines.sort(key=lambda l: (l.parent_category_name or "", l.category_name.lower()))

    total_income_budgeted = round(sum(l.budgeted for l in income_lines), 2)
    total_income_actual = round(sum(l.actual for l in income_lines), 2)
    total_expenses_budgeted = round(sum(l.budgeted for l in expense_lines), 2)
    total_expenses_actual = round(sum(l.actual for l in expense_lines), 2)

    return BudgetReport(
        year=year,
        month=month,
        month_label=_month_label(year, month),
        total_income_budgeted=total_income_budgeted,
        total_income_actual=total_income_actual,
        total_expenses_budgeted=total_expenses_budgeted,
        total_expenses_actual=total_expenses_actual,
        net_actual=round(total_income_actual - total_expenses_actual, 2),
        net_budgeted=round(total_income_budgeted - total_expenses_budgeted, 2),
        income_lines=income_lines,
        expense_lines=expense_lines,
    )


# ---------------------------------------------------------------------------
# Monthly totals (budget-report-style per-month income/expense)
# ---------------------------------------------------------------------------

def build_monthly_totals(
    db: Session,
    months: int = 12,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
    account_ids: Optional[list[int]] = None,
) -> MonthlyTotalsReport:
    """Return per-month income/expense totals using the same logic as build_budget_report."""
    today = date.today()
    anchor_year = end_year if end_year is not None else today.year
    anchor_month = end_month if end_month is not None else today.month

    periods: list[tuple[int, int]] = []
    for i in range(months - 1, -1, -1):
        y, m = _add_months(anchor_year, anchor_month, -i)
        periods.append((y, m))

    month_keys = [_month_key(y, m) for y, m in periods]
    month_labels = [_short_month_label(y, m) for y, m in periods]

    # Fetch all non-annualized transactions for the full range
    overall_date_from = _first_day_of_month(*periods[0])
    overall_date_to = _last_day_of_month(*periods[-1])
    transactions = _get_budget_transactions(db, overall_date_from, overall_date_to, account_ids)

    # Pre-load categories
    cat_ids = {tx.category_id for tx in transactions if tx.category_id}
    category_map: dict[int, Category] = {}
    if cat_ids:
        for cat in db.query(Category).filter(Category.id.in_(cat_ids)).all():
            category_map[cat.id] = cat

    # Accumulate per-month, per-category debits/credits
    agg: dict[str, dict[Optional[int], dict]] = {
        mk: defaultdict(lambda: {"debits": 0.0, "credits": 0.0}) for mk in month_keys
    }
    for tx in transactions:
        mk = _month_key(tx.date.year, tx.date.month)
        if mk not in agg:
            continue
        amount = float(tx.amount)
        if tx.transaction_type == TransactionType.DEBIT:
            agg[mk][tx.category_id]["debits"] += amount
        else:
            agg[mk][tx.category_id]["credits"] += amount

    # Pre-fetch annualized contributions for all periods and collect their categories
    annualized_by_month: dict[str, list[tuple[Transaction, float]]] = {}
    for (y, m), mk in zip(periods, month_keys):
        pairs = _get_annualized_contributions(db, y, m, account_ids)
        annualized_by_month[mk] = pairs
        for tx, _ in pairs:
            if tx.category_id and tx.category_id not in category_map:
                cat_ids.add(tx.category_id)
    # Load any missing categories from annualized transactions
    missing_cat_ids = cat_ids - set(category_map.keys())
    if missing_cat_ids:
        for cat in db.query(Category).filter(Category.id.in_(missing_cat_ids)).all():
            category_map[cat.id] = cat

    income_totals: list[float] = []
    expense_totals: list[float] = []

    for (y, m), mk in zip(periods, month_keys):
        # Add annualized contributions for this specific month
        for tx, monthly_share in annualized_by_month[mk]:
            agg[mk][tx.category_id]["debits"] += monthly_share

        total_income = 0.0
        total_expenses = 0.0
        for cat_id, vals in agg[mk].items():
            cat = category_map.get(cat_id) if cat_id is not None else None
            is_income = cat.is_income if cat else False
            if is_income:
                total_income += vals["credits"] - vals["debits"]
            else:
                total_expenses += vals["debits"] - vals["credits"]

        income_totals.append(round(total_income, 2))
        expense_totals.append(round(total_expenses, 2))

    net_totals = [round(i - e, 2) for i, e in zip(income_totals, expense_totals)]

    return MonthlyTotalsReport(
        months=month_keys,
        month_labels=month_labels,
        monthly_income_totals=income_totals,
        monthly_expense_totals=expense_totals,
        monthly_net_totals=net_totals,
    )


# ---------------------------------------------------------------------------
# Cash flow report
# ---------------------------------------------------------------------------

def build_cash_flow_report(
    db: Session,
    year: int,
    month: int,
    account_ids: Optional[list[int]] = None,
) -> CashFlowReport:
    date_from = _first_day_of_month(year, month)
    date_to = _last_day_of_month(year, month)

    transactions = _get_budget_transactions(db, date_from, date_to, account_ids)

    total_income = 0.0
    total_expenses = 0.0
    income_by_account_type: dict[str, float] = defaultdict(float)
    expenses_by_account_type: dict[str, float] = defaultdict(float)
    category_expenses: dict[str, float] = defaultdict(float)

    for tx in transactions:
        amount = float(tx.amount)
        acct_type = tx.account.account_type.value if tx.account else "unknown"
        cat_name = tx.category.name if tx.category else "Uncategorized"
        cat_is_income = tx.category.is_income if tx.category else False

        if tx.transaction_type == TransactionType.DEBIT:
            total_expenses += amount
            expenses_by_account_type[acct_type] += amount
            category_expenses[cat_name] += amount
        else:
            if cat_is_income:
                total_income += amount
                income_by_account_type[acct_type] += amount
            else:
                total_expenses -= amount
                expenses_by_account_type[acct_type] -= amount
                category_expenses[cat_name] -= amount

    annualized_pairs = _get_annualized_contributions(db, year, month, account_ids)
    for tx, monthly_share in annualized_pairs:
        acct_type = tx.account.account_type.value if tx.account else "unknown"
        cat_name = tx.category.name if tx.category else "Uncategorized"
        total_expenses += monthly_share
        expenses_by_account_type[acct_type] += monthly_share
        category_expenses[cat_name] += monthly_share

    top_expense_categories = [
        {"category_name": k, "total": round(v, 2)}
        for k, v in sorted(category_expenses.items(), key=lambda x: x[1], reverse=True)
        if v > 0
    ][:5]

    largest_q = (
        db.query(Transaction)
        .filter(
            Transaction.date >= date_from,
            Transaction.date <= date_to,
            Transaction.is_transfer == False,
        )
    )
    if account_ids:
        largest_q = largest_q.filter(Transaction.account_id.in_(account_ids))

    largest_transactions = []
    for tx in largest_q.order_by(Transaction.amount.desc()).limit(10).all():
        largest_transactions.append({
            "id": tx.id,
            "date": tx.date.isoformat(),
            "description": tx.description or tx.original_description,
            "amount": float(tx.amount),
            "transaction_type": tx.transaction_type.value,
            "account_name": tx.account.name if tx.account else None,
        })

    net_cash_flow = total_income - total_expenses
    savings_rate = (net_cash_flow / total_income * 100.0) if total_income > 0 else None

    return CashFlowReport(
        year=year,
        month=month,
        month_label=_month_label(year, month),
        total_income=round(total_income, 2),
        total_expenses=round(total_expenses, 2),
        net_cash_flow=round(net_cash_flow, 2),
        savings_rate=round(savings_rate, 2) if savings_rate is not None else None,
        income_by_account_type={k: round(v, 2) for k, v in income_by_account_type.items()},
        expenses_by_account_type={k: round(v, 2) for k, v in expenses_by_account_type.items()},
        top_expense_categories=top_expense_categories,
        largest_transactions=largest_transactions,
    )


# ---------------------------------------------------------------------------
# Net worth history
# ---------------------------------------------------------------------------

def build_net_worth_history(db: Session, months: int = 24) -> NetWorthHistory:
    today = date.today()
    periods: list[tuple[int, int]] = []
    for i in range(months - 1, -1, -1):
        y, m = _add_months(today.year, today.month, -i)
        periods.append((y, m))

    accounts: list[Account] = (
        db.query(Account)
        .filter(
            Account.is_active == True,
            Account.include_in_net_worth == True,
        )
        .all()
    )

    if not accounts:
        return NetWorthHistory(data_points=[], current_net_worth=0.0, change_1m=None, change_3m=None, change_period=None)

    account_ids = [a.id for a in accounts]
    last_date = _last_day_of_month(*periods[-1])
    snapshots: list[BalanceSnapshot] = (
        db.query(BalanceSnapshot)
        .filter(
            BalanceSnapshot.account_id.in_(account_ids),
            BalanceSnapshot.snapshot_date <= last_date,
        )
        .order_by(BalanceSnapshot.account_id, BalanceSnapshot.snapshot_date)
        .all()
    )

    snaps_by_account: dict[int, list[BalanceSnapshot]] = defaultdict(list)
    for snap in snapshots:
        snaps_by_account[snap.account_id].append(snap)

    data_points: list[NetWorthDataPoint] = []

    for y, m in periods:
        cutoff = _last_day_of_month(y, m)
        total_assets = 0.0
        total_liabilities = 0.0
        by_type: dict[str, float] = defaultdict(float)

        for acc in accounts:
            bal = _latest_balance_on_or_before(snaps_by_account.get(acc.id, []), cutoff)
            if bal is None:
                continue
            if acc.is_liability:
                total_liabilities += bal
                by_type[acc.account_type.value] += -bal
            else:
                total_assets += bal
                by_type[acc.account_type.value] += bal

        net = total_assets - total_liabilities
        data_points.append(NetWorthDataPoint(
            date=cutoff.isoformat(),
            total_assets=round(total_assets, 2),
            total_liabilities=round(total_liabilities, 2),
            net_worth=round(net, 2),
            by_type={k: round(v, 2) for k, v in by_type.items()},
        ))

    # Find first data point with actual balance data (non-zero assets or liabilities)
    first_real = 0
    for i, dp in enumerate(data_points):
        if dp.total_assets != 0 or dp.total_liabilities != 0:
            first_real = i
            break

    def _change(idx_a: int, idx_b: int) -> Optional[float]:
        if idx_a < 0 or idx_a >= len(data_points):
            return None
        # Clamp idx_b to oldest data point with real data
        idx_b = max(first_real, idx_b)
        if idx_b >= len(data_points):
            return None
        return round(data_points[idx_a].net_worth - data_points[idx_b].net_worth, 2)

    n = len(data_points)
    current_nw = data_points[-1].net_worth if data_points else 0.0

    # Anchor all deltas to last month (n-2) instead of current partial month
    last = n - 2  # last complete month
    return NetWorthHistory(
        data_points=data_points,
        current_net_worth=current_nw,
        change_1m=_change(last, last - 1),
        change_3m=_change(last, last - 3),
        change_period=_change(last, first_real),  # vs oldest real data point
    )


# ---------------------------------------------------------------------------
# Spending trends
# ---------------------------------------------------------------------------

def build_spending_trends(
    db: Session,
    months: int = 6,
    account_ids: Optional[list[int]] = None,
    top_n_categories: int = 10,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
) -> SpendingTrendsReport:
    today = date.today()

    anchor_year = end_year if end_year is not None else today.year
    anchor_month = end_month if end_month is not None else today.month

    periods: list[tuple[int, int]] = []
    for i in range(months - 1, -1, -1):
        y, m = _add_months(anchor_year, anchor_month, -i)
        periods.append((y, m))

    month_keys = [_month_key(y, m) for y, m in periods]
    month_labels = [_short_month_label(y, m) for y, m in periods]

    overall_date_from = _first_day_of_month(*periods[0])
    overall_date_to = _last_day_of_month(*periods[-1])

    transactions = _get_budget_transactions(db, overall_date_from, overall_date_to, account_ids)

    # Pre-fetch annualized transactions that could contribute to ANY period
    # month.  Each transaction spreads forward 12 months from its date, so for
    # the earliest period we need transactions from up to 11 months before it.
    first_year, first_month = periods[0]
    annualized_window_start = _first_day_of_month(*_add_months(first_year, first_month, -11))
    annualized_window_end = _last_day_of_month(anchor_year, anchor_month)
    annualized_txns_raw = db.query(Transaction).filter(
        Transaction.is_annualized == True,
        Transaction.transaction_type == TransactionType.DEBIT,
        Transaction.is_transfer == False,
        Transaction.exclude_from_budget == False,
        Transaction.date >= annualized_window_start,
        Transaction.date <= annualized_window_end,
    )
    if account_ids:
        annualized_txns_raw = annualized_txns_raw.filter(Transaction.account_id.in_(account_ids))
    annualized_txns = annualized_txns_raw.all()

    cat_ids = {tx.category_id for tx in transactions if tx.category_id}
    cat_ids.update({tx.category_id for tx in annualized_txns if tx.category_id})
    category_map: dict[int, Category] = {}
    if cat_ids:
        for cat in db.query(Category).filter(Category.id.in_(cat_ids)).all():
            category_map[cat.id] = cat

    agg: dict[Optional[int], dict[str, dict]] = defaultdict(
        lambda: {mk: {"debits": 0.0, "credits": 0.0} for mk in month_keys}
    )

    monthly_income: dict[str, float] = {mk: 0.0 for mk in month_keys}
    monthly_expenses: dict[str, float] = {mk: 0.0 for mk in month_keys}

    for tx in transactions:
        mk = _month_key(tx.date.year, tx.date.month)
        if mk not in agg[tx.category_id]:
            continue

        amount = float(tx.amount)
        cat_is_income = tx.category.is_income if tx.category else False

        # Inclusion rule:
        # - debits always increase expenses
        # - credits on income categories increase income
        # - all other credits (refunds, uncategorized) reduce expenses
        if tx.transaction_type == TransactionType.DEBIT:
            agg[tx.category_id][mk]["debits"] += amount
            monthly_expenses[mk] += amount
        else:
            if cat_is_income:
                agg[tx.category_id][mk]["credits"] += amount
                monthly_income[mk] += amount
            else:
                agg[tx.category_id][mk]["debits"] -= amount
                monthly_expenses[mk] -= amount

    # Annualized expenses: each transaction is spread forward from its date
    # for 12 consecutive months.  A period month receives the monthly share
    # (amount / 12) only if it falls within that forward span.
    for tx in annualized_txns:
        tx_offset = tx.date.year * 12 + tx.date.month
        monthly_share = float(tx.amount) / 12.0
        for period_year, period_month in periods:
            period_offset = period_year * 12 + period_month
            if tx_offset <= period_offset <= tx_offset + 11:
                mk = _month_key(period_year, period_month)
                agg[tx.category_id][mk]["debits"] += monthly_share
                monthly_expenses[mk] += monthly_share

    def cat_is_income_fn(cat_id: Optional[int]) -> bool:
        if cat_id is None:
            return False
        cat = category_map.get(cat_id)
        return cat.is_income if cat else False

    def cat_name(cat_id: Optional[int]) -> str:
        if cat_id is None:
            return "Uncategorized"
        cat = category_map.get(cat_id)
        return cat.name if cat else f"Category {cat_id}"

    cat_expense_totals: dict[Optional[int], float] = {}
    for cat_id, month_data in agg.items():
        if not cat_is_income_fn(cat_id):
            cat_expense_totals[cat_id] = sum(d["debits"] for d in month_data.values())

    sorted_expense_cats = sorted(cat_expense_totals.items(), key=lambda x: x[1], reverse=True)
    top_cats = {cat_id for cat_id, _ in sorted_expense_cats[:top_n_categories]}
    other_cat_ids = {cat_id for cat_id, _ in sorted_expense_cats[top_n_categories:]}

    series: list[CategoryTrendSeries] = []

    income_cat_ids = [cid for cid in agg if cat_is_income_fn(cid)]
    for cat_id in income_cat_ids:
        month_data = agg[cat_id]
        monthly_totals = [round(month_data[mk]["credits"], 2) for mk in month_keys]
        total = sum(monthly_totals)
        if total == 0:
            continue
        series.append(CategoryTrendSeries(
            category_id=cat_id,
            category_name=cat_name(cat_id),
            is_income=True,
            monthly_totals=monthly_totals,
            average=round(total / months, 2),
            total=round(total, 2),
        ))

    for cat_id in [cid for cid in top_cats]:
        month_data = agg[cat_id]
        monthly_totals = [round(month_data[mk]["debits"], 2) for mk in month_keys]
        total = sum(monthly_totals)
        if total == 0:
            continue
        series.append(CategoryTrendSeries(
            category_id=cat_id,
            category_name=cat_name(cat_id),
            is_income=False,
            monthly_totals=monthly_totals,
            average=round(total / months, 2),
            total=round(total, 2),
        ))

    if other_cat_ids:
        other_totals_by_month: dict[str, float] = {mk: 0.0 for mk in month_keys}
        for cat_id in other_cat_ids:
            for mk in month_keys:
                other_totals_by_month[mk] += agg[cat_id][mk]["debits"]
        other_monthly = [round(other_totals_by_month[mk], 2) for mk in month_keys]
        other_total = sum(other_monthly)
        if other_total > 0:
            series.append(CategoryTrendSeries(
                category_id=None,
                category_name="Other",
                is_income=False,
                monthly_totals=other_monthly,
                average=round(other_total / months, 2),
                total=round(other_total, 2),
            ))

    series.sort(key=lambda s: (not s.is_income, -s.total))

    return SpendingTrendsReport(
        months=month_keys,
        month_labels=month_labels,
        series=series,
        monthly_income_totals=[round(monthly_income[mk], 2) for mk in month_keys],
        monthly_expense_totals=[round(monthly_expenses[mk], 2) for mk in month_keys],
        monthly_net_totals=[round(monthly_income[mk] - monthly_expenses[mk], 2) for mk in month_keys],
    )


# ---------------------------------------------------------------------------
# Equity history
# ---------------------------------------------------------------------------

def build_equity_history(db: Session, months: int = 24) -> EquityHistoryReport:
    today = date.today()

    periods: list[tuple[int, int]] = []
    for i in range(months - 1, -1, -1):
        y, m = _add_months(today.year, today.month, -i)
        periods.append((y, m))

    linked_assets: list[Account] = (
        db.query(Account)
        .filter(
            Account.linked_liability_id.isnot(None),
            Account.is_active == True,
        )
        .all()
    )

    if not linked_assets:
        return EquityHistoryReport(pairs=[], total_linked_equity=0.0)

    liability_ids = [a.linked_liability_id for a in linked_assets if a.linked_liability_id is not None]
    liabilities: dict[int, Account] = {
        a.id: a for a in db.query(Account).filter(Account.id.in_(liability_ids)).all()
    }

    all_account_ids = [a.id for a in linked_assets] + liability_ids
    all_snapshots: list[BalanceSnapshot] = (
        db.query(BalanceSnapshot)
        .filter(
            BalanceSnapshot.account_id.in_(all_account_ids),
            BalanceSnapshot.snapshot_date <= _last_day_of_month(*periods[-1]),
        )
        .order_by(BalanceSnapshot.account_id, BalanceSnapshot.snapshot_date)
        .all()
    )

    snapshots_by_account: dict[int, list[BalanceSnapshot]] = defaultdict(list)
    for snap in all_snapshots:
        snapshots_by_account[snap.account_id].append(snap)

    def latest_balance(account: Account, cutoff: date) -> Optional[float]:
        snaps = snapshots_by_account.get(account.id, [])
        snap_bal = _latest_balance_on_or_before(snaps, cutoff)
        return snap_bal  # None if no snapshot exists on or before cutoff

    pairs: list[LinkedEquityPair] = []
    total_linked_equity = 0.0

    for asset in sorted(linked_assets, key=lambda a: a.name.lower()):
        liab = liabilities.get(asset.linked_liability_id)
        if not liab:
            continue

        points: list[EquityDataPoint] = []
        for y, m in periods:
            cutoff = _last_day_of_month(y, m)
            av = latest_balance(asset, cutoff)
            lb = latest_balance(liab, cutoff)
            # If neither account has snapshot data yet, emit zeros
            asset_value = av if av is not None else 0.0
            liability_balance = lb if lb is not None else 0.0
            has_data = av is not None or lb is not None
            equity = asset_value - liability_balance if has_data else 0.0
            points.append(EquityDataPoint(
                date=cutoff.isoformat(),
                asset_value=round(asset_value, 2),
                liability_balance=round(liability_balance, 2),
                equity=round(equity, 2),
            ))

        # Find first point with real snapshot data
        first_real = next(
            (i for i, p in enumerate(points)
             if p.asset_value != 0 or p.liability_balance != 0),
            0,
        )

        current_equity = points[-1].equity if points else 0.0
        n = len(points)
        last = n - 2  # last complete month

        def _eq_change(idx_a: int, idx_b: int) -> Optional[float]:
            if idx_a < 0 or idx_a >= n:
                return None
            idx_b = max(first_real, idx_b)
            if idx_b >= n:
                return None
            return round(points[idx_a].equity - points[idx_b].equity, 2)

        change_1m = _eq_change(last, last - 1)
        change_1y = _eq_change(last, last - 12)

        total_linked_equity += current_equity

        pairs.append(LinkedEquityPair(
            asset_id=asset.id,
            asset_name=asset.name,
            asset_type=asset.account_type.value,
            liability_id=liab.id,
            liability_name=liab.name,
            liability_type=liab.account_type.value,
            current_equity=round(current_equity, 2),
            equity_change_1m=change_1m,
            equity_change_1y=change_1y,
            data_points=points,
        ))

    return EquityHistoryReport(
        pairs=pairs,
        total_linked_equity=round(total_linked_equity, 2),
    )
