from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Account, BalanceSnapshot
from app.schemas import BalanceSnapshotCreate, BalanceSnapshotRead, BalanceSnapshotUpdate
from app.services.balances import record_snapshot, recompute_account_balance

router = APIRouter()


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
    Manually record a balance snapshot. The account's current_balance is
    recomputed from the latest-dated snapshot, so backdated entries are safe.
    """
    account = db.get(Account, payload.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    snapshot = record_snapshot(
        account, payload.balance, db, payload.snapshot_date, payload.notes
    )
    db.commit()
    db.refresh(snapshot)
    return snapshot


@router.delete("/{snapshot_id}", status_code=204)
def delete_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    snapshot = db.get(BalanceSnapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    account = db.get(Account, snapshot.account_id)
    db.delete(snapshot)
    db.flush()
    if account:
        recompute_account_balance(account, db)
    db.commit()


@router.patch("/{snapshot_id}", response_model=BalanceSnapshotRead)
def update_snapshot(
    snapshot_id: int, payload: BalanceSnapshotUpdate, db: Session = Depends(get_db)
):
    snapshot = db.get(BalanceSnapshot, snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(snapshot, field, value)

    db.flush()
    account = db.get(Account, snapshot.account_id)
    if account:
        recompute_account_balance(account, db)
    db.commit()
    db.refresh(snapshot)
    return snapshot
