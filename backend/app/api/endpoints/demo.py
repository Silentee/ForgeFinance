from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.session import get_db
from app.models import Account, Transaction, BalanceSnapshot, Budget

router = APIRouter()


class DemoStatus(BaseModel):
    has_demo_data: bool
    demo_account_count: int
    has_real_data: bool


@router.get("/status", response_model=DemoStatus)
def get_demo_status(db: Session = Depends(get_db)):
    """Check if demo data exists in the database."""
    demo_accounts = db.query(Account).filter(Account.is_demo == True).count()
    real_accounts = db.query(Account).filter(Account.is_demo == False).count()
    return DemoStatus(
        has_demo_data=demo_accounts > 0,
        demo_account_count=demo_accounts,
        has_real_data=real_accounts > 0,
    )


@router.post("/seed", status_code=status.HTTP_204_NO_CONTENT)
def seed_demo(db: Session = Depends(get_db)):
    """Seed demo accounts and transactions."""
    if db.query(Account).filter(Account.is_demo == True).count() > 0:
        raise HTTPException(status_code=409, detail="Demo data already exists")
    if db.query(Account).filter(Account.is_demo == False).count() > 0:
        raise HTTPException(status_code=409, detail="Cannot load demo: real accounts exist")
    from app.db.init_db import seed_demo_data
    seed_demo_data(db)


@router.delete("/clear", status_code=status.HTTP_204_NO_CONTENT)
def clear_demo_data(db: Session = Depends(get_db)):
    """
    Delete all demo accounts and their associated data.
    This is called when the user clicks "End Demo" to start fresh.
    """
    # Get all demo accounts
    demo_accounts = db.query(Account).filter(Account.is_demo == True).all()

    if not demo_accounts:
        return

    demo_account_ids = [a.id for a in demo_accounts]

    # Delete transactions for demo accounts
    db.query(Transaction).filter(Transaction.account_id.in_(demo_account_ids)).delete(
        synchronize_session=False
    )

    # Delete balance snapshots for demo accounts
    db.query(BalanceSnapshot).filter(BalanceSnapshot.account_id.in_(demo_account_ids)).delete(
        synchronize_session=False
    )

    # Delete all budget entries (demo creates budgets for categories)
    db.query(Budget).delete(synchronize_session=False)

    # Delete the demo accounts themselves
    db.query(Account).filter(Account.is_demo == True).delete(
        synchronize_session=False
    )

    db.commit()
