from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from app.db.session import get_db
from app.models import Account, Transaction, Category
from app.models.enums import TransactionType
from app.schemas import TransactionCreate, TransactionUpdate, TransactionRead
from app.services.csv_import import compute_dedup_hash

router = APIRouter()


def _get_transaction_or_404(tx_id: int, db: Session) -> Transaction:
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


_TAG_COLUMNS = {
    "is_transfer": Transaction.is_transfer,
    "exclude_from_budget": Transaction.exclude_from_budget,
    "is_annualized": Transaction.is_annualized,
    "is_pending": Transaction.is_pending,
}


def _parse_id_list(value: Optional[str], param: str) -> Optional[list[int]]:
    if not value:
        return None
    try:
        return [int(x.strip()) for x in value.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"{param} must be a comma-separated list of integers, e.g. '1,2,3'",
        )


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    account_id: Optional[int] = Query(None),
    account_ids: Optional[str] = Query(None, description="Comma-separated account IDs (takes precedence over account_id)"),
    category_id: Optional[int] = Query(None),
    category_ids: Optional[str] = Query(None, description="Comma-separated category IDs (takes precedence over category_id)"),
    uncategorized: Optional[bool] = Query(None, description="If true, include transactions with no category (combines with category_ids)"),
    tags: Optional[str] = Query(None, description="Comma-separated tag filters, matched with OR: is_transfer, exclude_from_budget, is_annualized, is_pending"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    transaction_type: Optional[TransactionType] = Query(None),
    is_transfer: Optional[bool] = Query(None),
    exclude_from_budget: Optional[bool] = Query(None),
    is_pending: Optional[bool] = Query(None),
    is_annualized: Optional[bool] = Query(None),
    search: Optional[str] = Query(None, description="Search in description and merchant name"),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    List transactions with rich filtering. All parameters are optional and combinable.
    Ordered by date descending (newest first) by default.
    """
    # Eager-load account/category — the response includes their names, and
    # lazy loading them per row is an N+1 (2 extra queries per transaction).
    q = db.query(Transaction).options(
        joinedload(Transaction.account), joinedload(Transaction.category)
    )

    account_id_list = _parse_id_list(account_ids, "account_ids")
    if account_id_list:
        q = q.filter(Transaction.account_id.in_(account_id_list))
    elif account_id is not None:
        q = q.filter(Transaction.account_id == account_id)

    category_id_list = _parse_id_list(category_ids, "category_ids")
    if category_id_list or uncategorized:
        conds = []
        if category_id_list:
            conds.append(Transaction.category_id.in_(category_id_list))
        if uncategorized:
            conds.append(Transaction.category_id.is_(None))
        q = q.filter(or_(*conds))
    elif category_id is not None:
        q = q.filter(Transaction.category_id == category_id)

    if tags:
        tag_conds = []
        for tag in (t.strip() for t in tags.split(",")):
            if not tag:
                continue
            col = _TAG_COLUMNS.get(tag)
            if col is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Unknown tag {tag!r}. Valid tags: {', '.join(_TAG_COLUMNS)}",
                )
            tag_conds.append(col == True)
        if tag_conds:
            q = q.filter(or_(*tag_conds))

    if date_from is not None:
        q = q.filter(Transaction.date >= date_from)
    if date_to is not None:
        q = q.filter(Transaction.date <= date_to)
    if transaction_type is not None:
        q = q.filter(Transaction.transaction_type == transaction_type)
    if is_transfer is not None:
        q = q.filter(Transaction.is_transfer == is_transfer)
    if exclude_from_budget is not None:
        q = q.filter(Transaction.exclude_from_budget == exclude_from_budget)
    if is_pending is not None:
        q = q.filter(Transaction.is_pending == is_pending)
    if is_annualized is not None:
        q = q.filter(Transaction.is_annualized == is_annualized)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                Transaction.description.ilike(pattern),
                Transaction.original_description.ilike(pattern),
                Transaction.merchant_name.ilike(pattern),
            )
        )
    if min_amount is not None:
        q = q.filter(Transaction.amount >= min_amount)
    if max_amount is not None:
        q = q.filter(Transaction.amount <= max_amount)

    transactions = (
        q.order_by(Transaction.date.desc(), Transaction.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Enrich with denormalized account/category names
    result = []
    for tx in transactions:
        tx_dict = {
            **tx.__dict__,
            "signed_amount": tx.signed_amount,
            "account_name": tx.account.name if tx.account else None,
            "category_name": tx.category.name if tx.category else None,
        }
        result.append(TransactionRead.model_validate(tx_dict))
    return result


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    """Manually create a single transaction."""
    # Validate foreign keys
    account = db.get(Account, payload.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

    tx = Transaction(**payload.model_dump())
    # Hash manual transactions too, so a later CSV import containing the same
    # transaction is recognized as a duplicate instead of re-inserted.
    tx.dedup_hash = compute_dedup_hash(
        tx.account_id, tx.date, float(tx.amount), tx.transaction_type, tx.original_description
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    return TransactionRead.model_validate({
        **tx.__dict__,
        "signed_amount": tx.signed_amount,
        "account_name": account.name,
        "category_name": tx.category.name if tx.category else None,
    })


@router.get("/{transaction_id}", response_model=TransactionRead)
def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    tx = _get_transaction_or_404(transaction_id, db)
    return TransactionRead.model_validate({
        **tx.__dict__,
        "signed_amount": tx.signed_amount,
        "account_name": tx.account.name if tx.account else None,
        "category_name": tx.category.name if tx.category else None,
    })


@router.patch("/{transaction_id}", response_model=TransactionRead)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: Session = Depends(get_db),
):
    """
    Partial update. Primarily used to:
    - Assign or change a category
    - Mark a transaction as a transfer / excluded from budget
    - Correct a description
    """
    tx = _get_transaction_or_404(transaction_id, db)

    if payload.category_id is not None:
        category = db.get(Category, payload.category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

    changed = payload.model_dump(exclude_unset=True)
    for field, value in changed.items():
        setattr(tx, field, value)

    # Keep the dedup hash in sync when any of its inputs change.
    if {"date", "amount", "transaction_type"} & changed.keys():
        tx.dedup_hash = compute_dedup_hash(
            tx.account_id, tx.date, float(tx.amount), tx.transaction_type, tx.original_description
        )

    db.commit()
    db.refresh(tx)

    return TransactionRead.model_validate({
        **tx.__dict__,
        "signed_amount": tx.signed_amount,
        "account_name": tx.account.name if tx.account else None,
        "category_name": tx.category.name if tx.category else None,
    })


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    tx = _get_transaction_or_404(transaction_id, db)
    db.delete(tx)
    db.commit()

