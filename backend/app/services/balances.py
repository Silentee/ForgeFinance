"""
services/balances.py — the single write path for account balance snapshots.

Account.current_balance is a denormalized cache of the latest-dated
BalanceSnapshot. Every snapshot mutation must go through record_snapshot /
recompute_account_balance so a backdated entry can never overwrite the
cache with a stale value.
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Account, BalanceSnapshot
from app.models.enums import BalanceType


def recompute_account_balance(account: Account, db: Session) -> None:
    """Sync current_balance/balance_updated_at to the latest snapshot.

    Ties on snapshot_date are broken by id (most recently created wins),
    matching the ordering used by the balance-history endpoints.
    """
    latest = (
        db.query(BalanceSnapshot)
        .filter(BalanceSnapshot.account_id == account.id)
        .order_by(BalanceSnapshot.snapshot_date.desc(), BalanceSnapshot.id.desc())
        .first()
    )
    if latest:
        account.current_balance = latest.balance
        account.balance_updated_at = datetime.combine(
            latest.snapshot_date, datetime.min.time()
        )
    else:
        account.current_balance = None
        account.balance_updated_at = None


def record_snapshot(
    account: Account,
    balance: float,
    db: Session,
    snapshot_date: Optional[date] = None,
    notes: Optional[str] = None,
) -> BalanceSnapshot:
    """Insert a snapshot and resync the account's cached balance.

    The caller is responsible for committing.
    """
    snapshot = BalanceSnapshot(
        account_id=account.id,
        snapshot_date=snapshot_date or date.today(),
        balance=balance,
        balance_type=BalanceType.SNAPSHOT,
        notes=notes,
    )
    db.add(snapshot)
    db.flush()  # snapshot must be visible to the recompute query below
    recompute_account_balance(account, db)
    return snapshot
