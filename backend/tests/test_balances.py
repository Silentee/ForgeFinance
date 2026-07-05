from datetime import date

from app.models import Account, BalanceSnapshot
from app.services.balances import record_snapshot, recompute_account_balance


def _account(db) -> Account:
    acct = Account(name="Brokerage", account_type="investment")
    db.add(acct)
    db.flush()
    return acct


def test_record_snapshot_sets_current_balance(db):
    acct = _account(db)
    record_snapshot(acct, 1000.0, db, date(2026, 6, 30))
    db.commit()

    assert float(acct.current_balance) == 1000.0
    assert acct.balance_updated_at.date() == date(2026, 6, 30)
    assert db.query(BalanceSnapshot).count() == 1


def test_backdated_snapshot_does_not_overwrite_current_balance(db):
    acct = _account(db)
    record_snapshot(acct, 1000.0, db, date(2026, 6, 30))
    record_snapshot(acct, 250.0, db, date(2026, 1, 31))  # backdated entry
    db.commit()

    assert float(acct.current_balance) == 1000.0
    assert acct.balance_updated_at.date() == date(2026, 6, 30)


def test_recompute_after_deleting_latest_snapshot(db):
    acct = _account(db)
    record_snapshot(acct, 500.0, db, date(2026, 5, 31))
    latest = record_snapshot(acct, 1000.0, db, date(2026, 6, 30))
    db.commit()

    db.delete(latest)
    db.flush()
    recompute_account_balance(acct, db)
    db.commit()

    assert float(acct.current_balance) == 500.0
    assert acct.balance_updated_at.date() == date(2026, 5, 31)


def test_recompute_with_no_snapshots_clears_balance(db):
    acct = _account(db)
    snap = record_snapshot(acct, 500.0, db, date(2026, 5, 31))
    db.commit()

    db.delete(snap)
    db.flush()
    recompute_account_balance(acct, db)
    db.commit()

    assert acct.current_balance is None
    assert acct.balance_updated_at is None


def test_same_date_tie_goes_to_most_recent_entry(db):
    acct = _account(db)
    record_snapshot(acct, 100.0, db, date(2026, 6, 30))
    record_snapshot(acct, 200.0, db, date(2026, 6, 30))  # correction, same day
    db.commit()

    assert float(acct.current_balance) == 200.0
