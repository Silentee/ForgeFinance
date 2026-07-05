import io
import csv as csv_mod
import re
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from sqlalchemy.orm import Session, joinedload

from app.db.session import get_db
from app.models import Account, AccountTypeDef, BalanceSnapshot, Institution
from app.models.enums import BalanceType
from app.schemas import (
    AccountCreate, AccountUpdate, AccountRead, AccountSummary, BalanceUpdate, NetWorthSummary
)
from app.services.balances import record_snapshot, recompute_account_balance

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _get_account_or_404(account_id: int, db: Session) -> Account:
    account = (
        db.query(Account)
        .options(joinedload(Account.institution))
        .filter(Account.id == account_id)
        .first()
    )
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[AccountSummary])
def list_accounts(
    active_only: bool = Query(True, description="Filter to active accounts only"),
    account_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List all accounts, optionally filtered by type or active status."""
    q = db.query(Account)
    if active_only:
        q = q.filter(Account.is_active == True)
    if account_type:
        q = q.filter(Account.account_type == account_type)
    return q.order_by(Account.account_type, Account.name).all()


@router.get("/net-worth", response_model=NetWorthSummary)
def get_net_worth(db: Session = Depends(get_db)):
    """
    Aggregate current balances into a net worth summary.
    Only accounts with include_in_net_worth=True and is_active=True are counted.
    """
    accounts = (
        db.query(Account)
        .filter(Account.is_active == True, Account.include_in_net_worth == True)
        .all()
    )

    total_assets = 0.0
    total_liabilities = 0.0
    by_type: dict[str, float] = {}

    for acct in accounts:
        val = acct.net_worth_value  # already sign-adjusted
        type_key = acct.account_type
        by_type[type_key] = by_type.get(type_key, 0.0) + val

        if acct.is_liability:
            total_liabilities += float(acct.current_balance or 0)
        else:
            total_assets += float(acct.current_balance or 0)

    return NetWorthSummary(
        total_assets=round(total_assets, 2),
        total_liabilities=round(total_liabilities, 2),
        net_worth=round(total_assets - total_liabilities, 2),
        accounts_by_type={k: round(v, 2) for k, v in by_type.items()},
    )


def _get_type_def_or_400(key: str, db: Session) -> AccountTypeDef:
    type_def = db.query(AccountTypeDef).filter(AccountTypeDef.key == key).first()
    if not type_def:
        raise HTTPException(status_code=400, detail=f"Unknown account type: {key!r}")
    return type_def


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: AccountCreate, db: Session = Depends(get_db)):
    """
    Create a new account. If initial_balance is provided, also creates
    the first BalanceSnapshot so the account immediately has a known value.
    """
    # Validate institution exists if provided
    if payload.institution_id:
        institution = db.get(Institution, payload.institution_id)
        if not institution:
            raise HTTPException(status_code=404, detail="Institution not found")

    type_def = _get_type_def_or_400(payload.account_type, db)

    data = payload.model_dump(exclude={"initial_balance"})

    # Default is_liquid based on account type if not explicitly set
    if data.get("is_liquid") is None:
        data["is_liquid"] = type_def.is_liquid_default

    account = Account(**data)
    db.add(account)
    db.flush()  # get account.id before creating snapshot

    if payload.initial_balance is not None:
        record_snapshot(account, payload.initial_balance, db)

    db.commit()
    db.refresh(account)
    return account


@router.get("/{account_id}", response_model=AccountRead)
def get_account(account_id: int, db: Session = Depends(get_db)):
    return _get_account_or_404(account_id, db)


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db),
):
    """Partial update — only fields included in the request body are changed."""
    account = _get_account_or_404(account_id, db)

    if payload.institution_id is not None:
        institution = db.get(Institution, payload.institution_id)
        if not institution:
            raise HTTPException(status_code=404, detail="Institution not found")

    if payload.account_type is not None:
        _get_type_def_or_400(payload.account_type, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)

    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    """
    Delete an account and all its transactions and balance history (cascade).
    This is irreversible — the frontend should confirm before calling this.
    """
    account = _get_account_or_404(account_id, db)
    db.delete(account)
    db.commit()


@router.post("/{account_id}/balance", response_model=AccountRead)
def update_balance(
    account_id: int,
    payload: BalanceUpdate,
    db: Session = Depends(get_db),
):
    """
    Record a balance for an account (optionally backdated).
    Used for investment accounts, real estate, and cash where you enter
    the balance directly rather than importing transactions.
    Always creates a BalanceSnapshot; current_balance is recomputed from the
    latest-dated snapshot, so a backdated entry never overwrites it.
    """
    account = _get_account_or_404(account_id, db)
    record_snapshot(account, payload.balance, db, payload.snapshot_date, payload.notes)
    db.commit()
    db.refresh(account)
    return account


@router.get("/{account_id}/balance-history", response_model=list[dict])
def get_balance_history(
    account_id: int,
    limit: int = Query(24, description="Number of most recent snapshots to return"),
    db: Session = Depends(get_db),
):
    """Return the balance history for an account, most recent first."""
    _get_account_or_404(account_id, db)  # ensure account exists

    snapshots = (
        db.query(BalanceSnapshot)
        .filter(BalanceSnapshot.account_id == account_id)
        .order_by(BalanceSnapshot.snapshot_date.desc(), BalanceSnapshot.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": s.id,
            "date": s.snapshot_date.isoformat(),
            "balance": float(s.balance),
            "balance_type": s.balance_type.value,
        }
        for s in snapshots
    ]


@router.post("/{account_id}/balance-history/import-csv")
def import_balance_history_csv(
    account_id: int,
    file: UploadFile = File(...),
    date_column: str = Form(...),
    balance_column: str = Form(...),
    date_format: str = Form("%m/%d/%Y"),
    skip_rows: int = Form(0),
    db: Session = Depends(get_db),
):
    """
    Import balance history from a CSV file.

    Expects a CSV where each row has at least a date and a balance value.
    Caller specifies which column names map to date and balance, plus the
    date format string (Python strptime syntax) and how many rows to skip
    before the header row.

    Rows whose date already has a snapshot for this account are skipped, so
    re-uploading the same file is safe.

    Returns counts of rows imported/skipped and any per-row parse errors.
    """
    account = _get_account_or_404(account_id, db)

    raw = file.file.read().decode("utf-8-sig")
    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    # Drop pre-header rows then hand to DictReader
    data_lines = lines[skip_rows:]
    reader = csv_mod.DictReader(io.StringIO("\n".join(data_lines)))

    # Validate that requested columns exist in the header
    fieldnames = reader.fieldnames or []
    missing = [c for c in (date_column, balance_column) if c not in fieldnames]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Column(s) not found in CSV: {', '.join(missing)}. "
                   f"Available columns: {', '.join(fieldnames)}",
        )

    # Dates that already have a snapshot — re-importing the same file is a no-op.
    existing_dates: set[date] = {
        d for (d,) in db.query(BalanceSnapshot.snapshot_date)
        .filter(BalanceSnapshot.account_id == account_id)
        .all()
    }

    imported = 0
    skipped = 0
    errors: list[str] = []

    for i, row in enumerate(reader, start=1):
        date_str = (row.get(date_column) or "").strip()
        balance_str = (row.get(balance_column) or "").strip()

        if not date_str and not balance_str:
            continue  # skip blank trailing rows silently

        try:
            snapshot_date = datetime.strptime(date_str, date_format).date()
        except ValueError as e:
            errors.append(f"Row {i}: bad date '{date_str}' — {e}")
            continue

        try:
            # Strip currency symbols, spaces, commas; allow negative values
            cleaned = re.sub(r"[^\d.\-]", "", balance_str)
            balance = float(cleaned)
        except ValueError:
            errors.append(f"Row {i}: could not parse balance '{balance_str}'")
            continue

        if snapshot_date in existing_dates:
            skipped += 1
            continue
        existing_dates.add(snapshot_date)  # also dedup within the file itself

        db.add(BalanceSnapshot(
            account_id=account_id,
            snapshot_date=snapshot_date,
            balance=balance,
            balance_type=BalanceType.SNAPSHOT,
        ))
        imported += 1

    if imported > 0:
        db.flush()
        recompute_account_balance(account, db)
        db.commit()

    return {"imported": imported, "skipped": skipped, "errors": errors}
