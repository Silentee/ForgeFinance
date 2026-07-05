import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Account, AccountTypeDef
from app.schemas.account_type import AccountTypeCreate, AccountTypeUpdate, AccountTypeRead

router = APIRouter()


def _slugify(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return slug or "type"


@router.get("", response_model=list[AccountTypeRead])
def list_account_types(
    include_hidden: bool = Query(False, description="Include hidden types (for the manager UI)"),
    db: Session = Depends(get_db),
):
    q = db.query(AccountTypeDef)
    if not include_hidden:
        q = q.filter(AccountTypeDef.is_hidden == False)
    return q.order_by(AccountTypeDef.sort_order, AccountTypeDef.label).all()


@router.post("", response_model=AccountTypeRead, status_code=status.HTTP_201_CREATED)
def create_account_type(payload: AccountTypeCreate, db: Session = Depends(get_db)):
    """Create a custom (non-system) account type."""
    key = payload.key or _slugify(payload.label)
    if db.query(AccountTypeDef).filter(AccountTypeDef.key == key).first():
        raise HTTPException(status_code=400, detail=f"An account type with key {key!r} already exists.")

    if payload.sort_order is None:
        max_order = db.query(AccountTypeDef).count()
        sort_order = max_order
    else:
        sort_order = payload.sort_order

    type_def = AccountTypeDef(
        key=key,
        label=payload.label,
        is_liability=payload.is_liability,
        is_liquid_default=payload.is_liquid_default,
        is_system=False,
        is_hidden=False,
        sort_order=sort_order,
    )
    db.add(type_def)
    db.commit()
    db.refresh(type_def)
    return type_def


@router.patch("/{type_id}", response_model=AccountTypeRead)
def update_account_type(type_id: int, payload: AccountTypeUpdate, db: Session = Depends(get_db)):
    type_def = db.get(AccountTypeDef, type_id)
    if not type_def:
        raise HTTPException(status_code=404, detail="Account type not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(type_def, field, value)

    db.commit()
    db.refresh(type_def)
    return type_def


@router.delete("/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account_type(type_id: int, db: Session = Depends(get_db)):
    type_def = db.get(AccountTypeDef, type_id)
    if not type_def:
        raise HTTPException(status_code=404, detail="Account type not found")

    if type_def.is_system:
        raise HTTPException(
            status_code=400,
            detail="Built-in account types cannot be deleted. You can hide them instead.",
        )

    in_use = db.query(Account).filter(Account.account_type == type_def.key).count()
    if in_use:
        raise HTTPException(
            status_code=400,
            detail=f"{in_use} account(s) use this type. Reassign or delete them first.",
        )

    db.delete(type_def)
    db.commit()
