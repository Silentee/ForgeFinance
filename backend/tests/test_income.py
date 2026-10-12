from datetime import date

import pytest

from app.models import Account, Category, Earner, IncomeEntry, Transaction
from app.models.enums import TransactionType
from app.services.income import build_income_report, resolve_take_home_category_ids
from app.services.reporting import build_monthly_totals


def _earner(db, name="Me"):
    earner = Earner(name=name)
    db.add(earner)
    db.flush()
    return earner


def _entry(db, earner, kind, when, amount):
    db.add(IncomeEntry(earner_id=earner.id, kind=kind, effective_date=when, amount=amount))


def _year_report(db, year, **kwargs):
    return build_income_report(db, months=12, end_year=year, end_month=12, **kwargs)


def test_raise_steps_monthly_gross_and_sums_to_prorated_year(db):
    me = _earner(db)
    _entry(db, me, "salary", date(2024, 1, 1), 120000)
    _entry(db, me, "salary", date(2024, 7, 1), 132000)
    db.commit()

    report = _year_report(db, 2024)
    series = report.earners[0]

    assert series.monthly_gross[:6] == [10000.0] * 6
    assert series.monthly_gross[6:] == [11000.0] * 6
    assert sum(series.monthly_gross) == pytest.approx(126000.0)
    assert series.monthly_salary_rate[5] == 120000.0
    assert series.monthly_salary_rate[6] == 132000.0


def test_mid_month_raise_is_prorated_by_day(db):
    me = _earner(db)
    _entry(db, me, "salary", date(2024, 1, 1), 120000)
    # June has 30 days: 15 at the old rate, 15 at the new one.
    _entry(db, me, "salary", date(2024, 6, 16), 144000)
    db.commit()

    june = _year_report(db, 2024).earners[0].monthly_gross[5]
    assert june == pytest.approx(10000 / 2 + 12000 / 2)


def test_zero_salary_ends_income(db):
    me = _earner(db)
    _entry(db, me, "salary", date(2024, 1, 1), 120000)
    _entry(db, me, "salary", date(2024, 4, 1), 0)
    db.commit()

    series = _year_report(db, 2024).earners[0]
    assert series.monthly_gross[:3] == [10000.0] * 3
    assert series.monthly_gross[3:] == [0.0] * 9
    assert series.monthly_salary_rate[3] == 0.0


def test_bonus_counts_in_its_month_only_and_not_in_salary_rate(db):
    me = _earner(db)
    _entry(db, me, "salary", date(2024, 1, 1), 120000)
    _entry(db, me, "bonus", date(2024, 3, 20), 7500)
    db.commit()

    series = _year_report(db, 2024).earners[0]
    assert series.monthly_gross[2] == 17500.0
    assert series.monthly_one_time[2] == 7500.0
    assert series.monthly_gross[3] == 10000.0
    assert set(series.monthly_salary_rate) == {120000.0}


def test_household_sums_earners_and_months_before_first_entry_are_empty(db):
    me = _earner(db, "Me")
    spouse = _earner(db, "Spouse")
    _entry(db, me, "salary", date(2024, 1, 1), 120000)
    _entry(db, spouse, "salary", date(2024, 4, 1), 96000)
    db.commit()

    report = _year_report(db, 2024)
    me_series, spouse_series = report.earners

    assert spouse_series.monthly_salary_rate[:3] == [None, None, None]
    assert spouse_series.monthly_gross[:3] == [0.0, 0.0, 0.0]
    assert report.household_monthly_gross[0] == 10000.0
    assert report.household_monthly_gross[3] == 18000.0
    assert report.household_monthly_gross == [
        round(a + b, 2) for a, b in zip(me_series.monthly_gross, spouse_series.monthly_gross)
    ]


def test_take_home_matches_cash_flow_income_for_salary_category(db):
    acct = Account(name="Checking", account_type="checking")
    income_parent = Category(name="Income", is_income=True)
    db.add_all([acct, income_parent])
    db.flush()
    salary = Category(name="Salary & Wages", is_income=True, parent_id=income_parent.id)
    db.add(salary)
    db.flush()

    def tx(amount, tx_type, when, **flags):
        db.add(Transaction(
            account_id=acct.id, category_id=salary.id, date=when, amount=amount,
            transaction_type=tx_type, original_description="payroll", **flags,
        ))

    tx(3000.0, TransactionType.CREDIT, date(2024, 5, 1))
    tx(3000.0, TransactionType.CREDIT, date(2024, 5, 15))
    tx(200.0, TransactionType.DEBIT, date(2024, 5, 20))  # payroll correction
    # Transfers and excluded rows never count
    tx(9999.0, TransactionType.CREDIT, date(2024, 5, 21), is_transfer=True)
    tx(500.0, TransactionType.CREDIT, date(2024, 5, 22), exclude_from_budget=True)
    db.commit()

    report = _year_report(db, 2024)
    totals = build_monthly_totals(db, months=12, end_year=2024, end_month=12)

    assert report.take_home_category_ids == [salary.id]
    assert report.monthly_take_home[4] == 5800.0
    assert report.monthly_take_home == totals.monthly_income_totals

    # An explicit empty pick means no take-home at all.
    assert _year_report(db, 2024, take_home_category_ids=[]).monthly_take_home == [0.0] * 12


def test_default_take_home_category_is_salary_and_wages(db):
    income_parent = Category(name="Income", is_income=True)
    db.add(income_parent)
    db.flush()
    salary = Category(name="Salary & Wages", is_income=True, parent_id=income_parent.id)
    other = Category(name="Other Income", is_income=True, parent_id=income_parent.id)
    db.add_all([salary, other])
    db.commit()

    assert resolve_take_home_category_ids(db, None) == [salary.id]
    assert resolve_take_home_category_ids(db, [other.id]) == [other.id]


def test_window_defaults_to_earliest_entry(db):
    me = _earner(db)
    _entry(db, me, "salary", date(2023, 11, 10), 60000)
    db.commit()

    report = build_income_report(db, end_year=2024, end_month=2)
    assert report.months == ["2023-11", "2023-12", "2024-01", "2024-02"]
