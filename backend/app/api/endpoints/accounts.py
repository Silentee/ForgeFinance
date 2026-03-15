import io
import csv as csv_mod
import re
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from sqlalchemy.orm import Session, joinedload

from app.db.session import get_db
from app.models import Account, BalanceSnapshot, Institution
from app.models.enums import AccountType, BalanceType
from app.schemas import (
    AccountCreate, AccountUpdate, AccountRead, AccountSummary, NetWorthSummary
)

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


def _update_account_balance(
    account: Account, balance: float, db: Session, snapshot_date: date | None = None
) -> None:
    """
    Update current_balance on the Account and create a BalanceSnapshot row.
    Centralizing this here ensures the two are always kept in sync.
    """
    snapshot_date = snapshot_date or date.today()
    account.current_balance = balance
    account.balance_updated_at = datetime(snapshot_date.year, snapshot_date.month, snapshot_date.day)

    snapshot = BalanceSnapshot(
        account_id=account.id,
        snapshot_date=snapshot_date,
        balance=balance,
        balance_type=BalanceType.SNAPSHOT,
    )
    db.add(snapshot)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[AccountSummary])
def list_accounts(
    active_only: bool = Query(True, description="Filter to active accounts only"),
    account_type: Optional[AccountType] = Query(None),
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
        type_key = acct.account_type.value
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


# Account types that default to liquid
LIQUID_ACCOUNT_TYPES = {
    AccountType.CHECKING,
    AccountType.SAVINGS,
    AccountType.HYSA,
    AccountType.CASH,
    AccountType.PRECIOUS_METAL,
    AccountType.INVESTMENT,
}


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: AccountCreate, db: Session = Depends(get_db)):
    """
    Create a new account. If initial_balance is provided, also creates
    the first BalanceSnapshot so the account immediately has a known value.
    """
    # Validate institution exists if provided
    if payload.institution_id:
        institution = db.query(Institution).get(payload.institution_id)
        if not institution:
            raise HTTPException(status_code=404, detail="Institution not found")

    data = payload.model_dump(exclude={"initial_balance"})

    # Default is_liquid based on account type if not explicitly set
    if data.get("is_liquid") is None:
        data["is_liquid"] = payload.account_type in LIQUID_ACCOUNT_TYPES

    account = Account(**data)
    db.add(account)
    db.flush()  # get account.id before creating snapshot

    if payload.initial_balance is not None:
        _update_account_balance(account, payload.initial_balance, db)

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
        institution = db.query(Institution).get(payload.institution_id)
        if not institution:
            raise HTTPException(status_code=404, detail="Institution not found")

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
    balance: float,
    snapshot_date: Optional[date] = Query(None, description="Defaults to today"),
    notes: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Manually set the current balance for an account.
    Used for investment accounts, real estate, and cash where you enter
    the balance directly rather than importing transactions.
    Always creates a BalanceSnapshot for historical tracking.
    """
    account = _get_account_or_404(account_id, db)
    _update_account_balance(account, balance, db, snapshot_date)
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

    Returns a count of rows imported and any per-row parse errors.
    """
    _get_account_or_404(account_id, db)

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

    imported = 0
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

        db.add(BalanceSnapshot(
            account_id=account_id,
            snapshot_date=snapshot_date,
            balance=balance,
            balance_type=BalanceType.SNAPSHOT,
        ))
        imported += 1

    if imported > 0:
        db.commit()
        # Recompute account's current_balance from most recent snapshot
        latest = (
            db.query(BalanceSnapshot)
            .filter(BalanceSnapshot.account_id == account_id)
            .order_by(BalanceSnapshot.snapshot_date.desc(), BalanceSnapshot.id.desc())
            .first()
        )
        if latest:
            account = db.query(Account).get(account_id)
            account.current_balance = latest.balance
            account.balance_updated_at = datetime(latest.snapshot_date.year, latest.snapshot_date.month, latest.snapshot_date.day)
            db.commit()

    return {"imported": imported, "errors": errors}
