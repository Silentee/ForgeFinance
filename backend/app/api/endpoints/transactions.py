from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from app.db.session import get_db
from app.models import Account, Transaction, Category
from app.models.enums import TransactionType
from app.schemas import TransactionCreate, TransactionUpdate, TransactionRead

router = APIRouter()


def _get_transaction_or_404(tx_id: int, db: Session) -> Transaction:
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    account_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    uncategorized: Optional[bool] = Query(None, description="If true, return only transactions with no category"),
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
    q = db.query(Transaction)

    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if uncategorized:
        q = q.filter(Transaction.category_id.is_(None))
    elif category_id is not None:
        q = q.filter(Transaction.category_id == category_id)
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
    account = db.query(Account).get(payload.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if payload.category_id:
        category = db.query(Category).get(payload.category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

    tx = Transaction(**payload.model_dump())
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
        category = db.query(Category).get(payload.category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(tx, field, value)

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


@router.get("/summary/by-category")
def spending_by_category(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    account_id: Optional[int] = Query(None),
    exclude_transfers: bool = Query(True),
    db: Session = Depends(get_db),
):
    """
    Aggregate spending grouped by top-level category.
    Used by the budget report and spending breakdown charts.
    Returns category name, total debits, total credits, and net amount.
    """
    q = db.query(Transaction)
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
    if account_id:
        q = q.filter(Transaction.account_id == account_id)
    if exclude_transfers:
        q = q.filter(Transaction.is_transfer == False)
    q = q.filter(Transaction.exclude_from_budget == False)

    transactions = q.all()

    summary: dict[str, dict] = {}
    uncategorized_key = "Uncategorized"

    for tx in transactions:
        cat_name = tx.category.name if tx.category else uncategorized_key
        if cat_name not in summary:
            summary[cat_name] = {
                "category_name": cat_name,
                "category_id": tx.category_id,
                "total_debits": 0.0,
                "total_credits": 0.0,
                "transaction_count": 0,
            }
        entry = summary[cat_name]
        entry["transaction_count"] += 1
        if tx.transaction_type == TransactionType.DEBIT:
            entry["total_debits"] += float(tx.amount)
        else:
            entry["total_credits"] += float(tx.amount)

    for entry in summary.values():
        entry["net"] = round(entry["total_credits"] - entry["total_debits"], 2)
        entry["total_debits"] = round(entry["total_debits"], 2)
        entry["total_credits"] = round(entry["total_credits"], 2)

    return sorted(summary.values(), key=lambda x: x["total_debits"], reverse=True)

