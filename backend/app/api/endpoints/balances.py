from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Account, BalanceSnapshot
from app.models.enums import BalanceType
from app.schemas import BalanceSnapshotCreate, BalanceSnapshotRead, BalanceSnapshotUpdate

router = APIRouter()


def _recompute_account_balance(account_id: int, db: Session) -> None:
    """
    Recalculate an account's current_balance and balance_updated_at based on
    the most recent balance snapshot, or clear them if no snapshots remain.
    """
    account = db.query(Account).get(account_id)
    if not account:
        return

    latest = (
        db.query(BalanceSnapshot)
        .filter(BalanceSnapshot.account_id == account_id)
        .order_by(BalanceSnapshot.snapshot_date.desc())
        .first()
    )

    if latest:
        account.current_balance = latest.balance
        # Use the snapshot date as the "updated at" marker for display purposes.
        account.balance_updated_at = datetime.combine(
            latest.snapshot_date, datetime.min.time()
        )
    else:
        account.current_balance = None
        account.balance_updated_at = None


@router.get("", response_model=list[BalanceSnapshotRead])
def list_snapshots(
    account_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(BalanceSnapshot)
    if account_id:
        q = q.filter(BalanceSnapshot.account_id == account_id)
    if date_from:
        q = q.filter(BalanceSnapshot.snapshot_date >= date_from)
    if date_to:
        q = q.filter(BalanceSnapshot.snapshot_date <= date_to)
    return q.order_by(BalanceSnapshot.snapshot_date.desc(), BalanceSnapshot.id.desc()).limit(limit).all()


@router.post("", response_model=BalanceSnapshotRead, status_code=201)
def create_snapshot(payload: BalanceSnapshotCreate, db: Session = Depends(get_db)):
    """
    Manually record a balance snapshot.
    Also updates the account's current_balance if this is the most recent snapshot.
    """
    account = db.query(Account).get(payload.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    snapshot = BalanceSnapshot(
        account_id=payload.account_id,
        snapshot_date=payload.snapshot_date,
        balance=payload.balance,
        balance_type=BalanceType.SNAPSHOT,
        notes=payload.notes,
    )
    db.add(snapshot)

    # Update current_balance if this snapshot is the most recent
    if (
        account.balance_updated_at is None
        or payload.snapshot_date >= (account.balance_updated_at.date() if account.balance_updated_at else date.min)
    ):
        from datetime import datetime
        account.current_balance = payload.balance
        account.balance_updated_at = datetime.utcnow()

    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.delete("/{snapshot_id}", status_code=204)
def delete_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    snapshot = db.query(BalanceSnapshot).get(snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    account_id = snapshot.account_id
    db.delete(snapshot)
    db.flush()
    _recompute_account_balance(account_id, db)
    db.commit()


@router.patch("/{snapshot_id}", response_model=BalanceSnapshotRead)
def update_snapshot(
    snapshot_id: int, payload: BalanceSnapshotUpdate, db: Session = Depends(get_db)
):
    snapshot = db.query(BalanceSnapshot).get(snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(snapshot, field, value)

    db.flush()
    _recompute_account_balance(snapshot.account_id, db)
    db.commit()
    db.refresh(snapshot)
    return snapshot
