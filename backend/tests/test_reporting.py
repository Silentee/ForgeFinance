from datetime import date

from app.models import Account, Budget, Category, Transaction
from app.models.enums import TransactionType
from app.services.reporting import (
    build_budget_report,
    build_category_transactions,
    build_monthly_totals,
    build_spending_averages,
    build_spending_trends,
)


def _setup(db):
    acct = Account(name="Checking", account_type="checking")
    income_parent = Category(name="Income", is_income=True)
    expense_parent = Category(name="Essential", is_income=False)
    db.add_all([acct, income_parent, expense_parent])
    db.flush()
    salary = Category(name="Salary", is_income=True, parent_id=income_parent.id)
    groceries = Category(name="Groceries", is_income=False, parent_id=expense_parent.id)
    db.add_all([salary, groceries])
    db.flush()
    return acct, salary, groceries


def _tx(db, acct, cat, amount, tx_type, when, **flags):
    tx = Transaction(
        account_id=acct.id,
        category_id=cat.id if cat else None,
        date=when,
        amount=amount,
        transaction_type=tx_type,
        original_description="test",
        **flags,
    )
    db.add(tx)
    return tx


def test_budget_report_sign_conventions(db):
    acct, salary, groceries = _setup(db)
    june = date(2026, 6, 15)

    _tx(db, acct, salary, 1000.0, TransactionType.CREDIT, june)
    _tx(db, acct, groceries, 200.0, TransactionType.DEBIT, june)
    # Refund on an expense category reduces the actual
    _tx(db, acct, groceries, 50.0, TransactionType.CREDIT, june)
    # Transfers and excluded transactions never count
    _tx(db, acct, groceries, 500.0, TransactionType.DEBIT, june, is_transfer=True)
    _tx(db, acct, groceries, 75.0, TransactionType.DEBIT, june, exclude_from_budget=True)
    db.add(Budget(category_id=groceries.id, year=2026, month=6, amount=300.0))
    db.commit()

    report = build_budget_report(db, 2026, 6)

    assert report.total_income_actual == 1000.0
    assert report.total_expenses_actual == 150.0
    assert report.net_actual == 850.0

    groceries_line = next(l for l in report.expense_lines if l.category_name == "Groceries")
    assert groceries_line.actual == 150.0
    assert groceries_line.budgeted == 300.0
    assert groceries_line.remaining == 150.0
    assert groceries_line.percent_used == 50.0


def test_annualized_transaction_spreads_over_12_months(db):
    acct, _salary, groceries = _setup(db)
    _tx(db, acct, groceries, 1200.0, TransactionType.DEBIT, date(2026, 1, 15), is_annualized=True)
    db.commit()

    # Months 1..12 after the purchase each carry 1/12 of the amount
    in_window = build_budget_report(db, 2026, 6)
    line = next(l for l in in_window.expense_lines if l.category_name == "Groceries")
    assert line.actual == 100.0

    # The purchase month itself carries only the monthly share, not the total
    purchase_month = build_budget_report(db, 2026, 1)
    line = next(l for l in purchase_month.expense_lines if l.category_name == "Groceries")
    assert line.actual == 100.0

    # 12+ months out the spread has ended
    after_window = build_budget_report(db, 2027, 1)
    assert all(l.category_name != "Groceries" or l.actual == 0.0 for l in after_window.expense_lines)


def test_uncategorized_transactions_count_as_expenses(db):
    acct, _salary, _groceries = _setup(db)
    _tx(db, acct, None, 40.0, TransactionType.DEBIT, date(2026, 6, 10))
    db.commit()

    report = build_budget_report(db, 2026, 6)
    uncat = next(l for l in report.expense_lines if l.category_name == "Uncategorized")
    assert uncat.actual == 40.0
    assert report.total_expenses_actual == 40.0


def test_shared_aggregation_builders_agree(db):
    """build_monthly_totals / build_spending_trends / build_spending_averages
    all share _aggregate_monthly — verify they produce consistent totals for the
    same month with an income, an expense, and an expense refund."""
    acct, salary, groceries = _setup(db)
    june = date(2026, 6, 15)
    _tx(db, acct, salary, 1000.0, TransactionType.CREDIT, june)
    _tx(db, acct, groceries, 200.0, TransactionType.DEBIT, june)
    _tx(db, acct, groceries, 50.0, TransactionType.CREDIT, june)   # refund reduces expense
    db.commit()

    totals = build_monthly_totals(db, months=1, end_year=2026, end_month=6)
    assert totals.monthly_income_totals[-1] == 1000.0
    assert totals.monthly_expense_totals[-1] == 150.0
    assert totals.monthly_net_totals[-1] == 850.0

    trends = build_spending_trends(db, months=1, end_year=2026, end_month=6)
    assert trends.monthly_income_totals[-1] == 1000.0
    assert trends.monthly_expense_totals[-1] == 150.0
    groceries_series = next(s for s in trends.series if s.category_name == "Groceries")
    assert groceries_series.monthly_totals[-1] == 150.0

    # Spending averages anchored to a complete (non-current) month: the 1-month
    # window equals that month's figures.
    avgs = build_spending_averages(db, 2026, 6)
    groceries_avg = next(l for l in avgs.expense_lines if l.category_name == "Groceries")
    assert groceries_avg.avg_1m == 150.0
    salary_avg = next(l for l in avgs.income_lines if l.category_name == "Salary")
    assert salary_avg.avg_1m == 1000.0


def test_spending_trends_budgets_per_month(db):
    acct, salary, groceries = _setup(db)
    _tx(db, acct, salary, 1000.0, TransactionType.CREDIT, date(2026, 5, 1))
    _tx(db, acct, groceries, 200.0, TransactionType.DEBIT, date(2026, 4, 10))
    _tx(db, acct, groceries, 300.0, TransactionType.DEBIT, date(2026, 6, 10))
    db.add(Budget(category_id=groceries.id, year=2026, month=4, amount=250.0))
    db.add(Budget(category_id=groceries.id, year=2026, month=6, amount=275.0))
    db.add(Budget(category_id=groceries.id, year=2026, month=7, amount=999.0))  # outside window
    db.add(Budget(category_id=salary.id, year=2026, month=5, amount=1200.0))
    db.commit()

    report = build_spending_trends(db, months=3, end_year=2026, end_month=6)
    by_name = {s.category_name: s for s in report.series}

    assert report.months == ["2026-04", "2026-05", "2026-06"]
    # May has no groceries budget row → 0
    assert by_name["Groceries"].monthly_budgets == [250.0, 0.0, 275.0]
    assert by_name["Salary"].monthly_budgets == [0.0, 1200.0, 0.0]
    assert report.monthly_expense_budgets == [250.0, 0.0, 275.0]
    assert report.monthly_income_budgets == [0.0, 1200.0, 0.0]


def test_spending_trends_budget_without_spending_counts_in_totals(db):
    acct, _salary, groceries = _setup(db)
    dining = Category(name="Dining", is_income=False, parent_id=groceries.parent_id)
    db.add(dining)
    db.flush()
    _tx(db, acct, groceries, 100.0, TransactionType.DEBIT, date(2026, 2, 3))
    db.add(Budget(category_id=groceries.id, year=2026, month=2, amount=150.0))
    # A budgeted category with no spending has no series but still counts
    db.add(Budget(category_id=dining.id, year=2026, month=2, amount=80.0))
    db.commit()

    report = build_spending_trends(db, months=2, end_year=2026, end_month=2)

    assert [s.category_name for s in report.series] == ["Groceries"]
    assert report.monthly_expense_budgets == [0.0, 230.0]
    assert report.monthly_income_budgets == [0.0, 0.0]


def test_spending_trends_other_bucket_sums_budgets(db):
    acct, _salary, groceries = _setup(db)
    dining = Category(name="Dining", is_income=False, parent_id=groceries.parent_id)
    db.add(dining)
    db.flush()
    _tx(db, acct, groceries, 300.0, TransactionType.DEBIT, date(2026, 6, 3))
    _tx(db, acct, dining, 50.0, TransactionType.DEBIT, date(2026, 6, 4))
    db.add(Budget(category_id=groceries.id, year=2026, month=6, amount=250.0))
    db.add(Budget(category_id=dining.id, year=2026, month=6, amount=60.0))
    db.commit()

    report = build_spending_trends(db, months=1, end_year=2026, end_month=6, top_n_categories=1)
    by_name = {s.category_name: s for s in report.series}

    assert by_name["Groceries"].monthly_budgets == [250.0]
    assert by_name["Other"].monthly_budgets == [60.0]


def test_category_transactions_match_budget_actual(db):
    acct, salary, groceries = _setup(db)
    dining = Category(name="Dining", is_income=False, parent_id=groceries.parent_id)
    db.add(dining)
    db.flush()
    june = date(2026, 6, 15)
    big = _tx(db, acct, groceries, 200.0, TransactionType.DEBIT, june, notes="party supplies")
    small = _tx(db, acct, groceries, 30.0, TransactionType.DEBIT, date(2026, 6, 2))
    refund = _tx(db, acct, groceries, 50.0, TransactionType.CREDIT, june)
    # None of these count toward Groceries' June actual
    _tx(db, acct, groceries, 500.0, TransactionType.DEBIT, june, is_transfer=True)
    _tx(db, acct, groceries, 75.0, TransactionType.DEBIT, june, exclude_from_budget=True)
    _tx(db, acct, groceries, 60.0, TransactionType.DEBIT, date(2026, 5, 31))
    _tx(db, acct, dining, 25.0, TransactionType.DEBIT, june)
    _tx(db, acct, salary, 1000.0, TransactionType.CREDIT, june)
    db.commit()

    report = build_category_transactions(db, 2026, 6, [groceries.id])
    budget = build_budget_report(db, 2026, 6)
    groceries_line = next(l for l in budget.expense_lines if l.category_name == "Groceries")

    # Highest contribution first; the refund counts negative and sorts last
    assert [l.transaction_id for l in report.lines] == [big.id, small.id, refund.id]
    assert [l.contribution for l in report.lines] == [200.0, 30.0, -50.0]
    assert [l.notes for l in report.lines] == ["party supplies", None, None]
    assert report.total == groceries_line.actual == 180.0
    assert report.month_label == "June 2026"

    # A whole group is just several ids at once
    group = build_category_transactions(db, 2026, 6, [groceries.id, dining.id])
    assert group.total == 205.0
    assert len(group.lines) == 4


def test_category_transactions_include_annualized_share(db):
    acct, _salary, groceries = _setup(db)
    annual = _tx(db, acct, groceries, 1200.0, TransactionType.DEBIT, date(2026, 1, 15), is_annualized=True)
    # 13 months before June — its spread ended in May
    _tx(db, acct, groceries, 2400.0, TransactionType.DEBIT, date(2025, 5, 10), is_annualized=True)
    _tx(db, acct, groceries, 40.0, TransactionType.DEBIT, date(2026, 6, 3))
    db.commit()

    report = build_category_transactions(db, 2026, 6, [groceries.id])

    assert [l.contribution for l in report.lines] == [100.0, 40.0]
    annual_line = report.lines[0]
    assert annual_line.transaction_id == annual.id
    assert annual_line.is_annualized
    assert annual_line.amount == 1200.0
    assert annual_line.annualized_month == 6
    assert annual_line.date == "2026-01-15"
    assert report.lines[1].annualized_month is None

    budget = build_budget_report(db, 2026, 6)
    groceries_line = next(l for l in budget.expense_lines if l.category_name == "Groceries")
    assert report.total == groceries_line.actual == 140.0


def test_category_transactions_uncategorized(db):
    acct, _salary, groceries = _setup(db)
    uncat = _tx(db, acct, None, 40.0, TransactionType.DEBIT, date(2026, 6, 10))
    _tx(db, acct, groceries, 90.0, TransactionType.DEBIT, date(2026, 6, 11))
    db.commit()

    report = build_category_transactions(db, 2026, 6, [], include_uncategorized=True)
    assert [l.transaction_id for l in report.lines] == [uncat.id]
    assert report.lines[0].category_name is None
    assert report.total == 40.0

    # Uncategorized rows are left out unless asked for
    assert build_category_transactions(db, 2026, 6, [groceries.id]).total == 90.0
