from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.deps import get_current_user
from app.models import Budget, Category, BudgetVisibleCategories
from app.models.user import User
from app.schemas.reports import BudgetCreate, BudgetUpdate, BudgetRead
from app.schemas.budget_visibility import BudgetVisibleCategoriesRead, BudgetVisibleCategoriesUpsert

router = APIRouter()


def _to_budget_read(budget: Budget, category_name: Optional[str] = None) -> BudgetRead:
    return BudgetRead(
        id=budget.id,
        category_id=budget.category_id,
        month=budget.month,
        year=budget.year,
        amount=float(budget.amount),
        notes=budget.notes,
        category_name=category_name
        if category_name is not None
        else (budget.category.name if budget.category else None),
    )


@router.get("/visible-categories", response_model=BudgetVisibleCategoriesRead)
def get_visible_categories(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (
        db.query(BudgetVisibleCategories)
        .filter(
            BudgetVisibleCategories.user_id == user.id,
            BudgetVisibleCategories.year == year,
            BudgetVisibleCategories.month == month,
        )
        .first()
    )
    if not row:
        return BudgetVisibleCategoriesRead(year=year, month=month, category_ids=None, updated_at=None)

    try:
        category_ids = json.loads(row.category_ids_json or "[]")
        if not isinstance(category_ids, list):
            category_ids = []
        category_ids = [int(x) for x in category_ids]
    except Exception:
        category_ids = []

    return BudgetVisibleCategoriesRead(
        year=year,
        month=month,
        category_ids=category_ids,
        updated_at=row.updated_at,
    )


@router.put("/visible-categories", response_model=BudgetVisibleCategoriesRead)
def upsert_visible_categories(
    payload: BudgetVisibleCategoriesUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = (
        db.query(BudgetVisibleCategories)
        .filter(
            BudgetVisibleCategories.user_id == user.id,
            BudgetVisibleCategories.year == payload.year,
            BudgetVisibleCategories.month == payload.month,
        )
        .first()
    )

    if row is None:
        row = BudgetVisibleCategories(
            user_id=user.id,
            year=payload.year,
            month=payload.month,
            category_ids_json=json.dumps([int(x) for x in payload.category_ids]),
            updated_at=datetime.utcnow(),
        )
        db.add(row)
    else:
        row.category_ids_json = json.dumps([int(x) for x in payload.category_ids])
        row.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(row)

    return BudgetVisibleCategoriesRead(
        year=row.year,
        month=row.month,
        category_ids=[int(x) for x in payload.category_ids],
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[BudgetRead])
def list_budgets(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """List budgets, optionally filtered by year and/or month."""
    q = db.query(Budget)
    if year is not None:
        q = q.filter(Budget.year == year)
    if month is not None:
        q = q.filter(Budget.month == month)

    budgets = q.order_by(Budget.year.desc(), Budget.month.desc()).all()
    return [_to_budget_read(b) for b in budgets]


@router.post("", response_model=BudgetRead, status_code=status.HTTP_201_CREATED)
def create_budget(payload: BudgetCreate, db: Session = Depends(get_db)):
    """
    Set a monthly budget target for a category.
    Returns 409 if a budget for that category/month/year already exists —
    use PATCH to update an existing budget.
    """
    category = db.get(Category, payload.category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    existing = (
        db.query(Budget)
        .filter(
            Budget.category_id == payload.category_id,
            Budget.month == payload.month,
            Budget.year == payload.year,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A budget for category '{category.name}' in "
                f"{payload.year}-{payload.month:02d} already exists (id={existing.id}). "
                f"Use PATCH /budgets/{existing.id} to update it."
            ),
        )

    budget = Budget(**payload.model_dump())
    db.add(budget)
    db.commit()
    db.refresh(budget)
    return _to_budget_read(budget, category.name)


@router.post("/bulk", response_model=list[BudgetRead], status_code=status.HTTP_201_CREATED)
def create_budgets_bulk(
    payloads: list[BudgetCreate],
    db: Session = Depends(get_db),
):
    """
    Create or update multiple budget entries in one call.
    Useful for setting up a full month's budget at once, or copying
    last month's budgets to a new month.

    Unlike POST /, this endpoint uses upsert semantics:
    if a budget already exists for that category/month/year, it's updated.
    """
    # Batch-load categories instead of one query per payload
    categories = {
        c.id: c
        for c in db.query(Category)
        .filter(Category.id.in_({p.category_id for p in payloads}))
        .all()
    }

    result = []
    for payload in payloads:
        category = categories.get(payload.category_id)
        if not category:
            raise HTTPException(
                status_code=404,
                detail=f"Category {payload.category_id} not found",
            )

        existing = (
            db.query(Budget)
            .filter(
                Budget.category_id == payload.category_id,
                Budget.month == payload.month,
                Budget.year == payload.year,
            )
            .first()
        )

        if existing:
            existing.amount = payload.amount
            if payload.notes is not None:
                existing.notes = payload.notes
            budget = existing
        else:
            budget = Budget(**payload.model_dump())
            db.add(budget)

        db.flush()
        result.append(_to_budget_read(budget, category.name))

    db.commit()
    return result


@router.get("/{budget_id}", response_model=BudgetRead)
def get_budget(budget_id: int, db: Session = Depends(get_db)):
    budget = db.get(Budget, budget_id)
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    return _to_budget_read(budget)


@router.patch("/{budget_id}", response_model=BudgetRead)
def update_budget(
    budget_id: int,
    payload: BudgetUpdate,
    db: Session = Depends(get_db),
):
    budget = db.get(Budget, budget_id)
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(budget, field, value)

    db.commit()
    db.refresh(budget)
    return _to_budget_read(budget)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    budget = db.get(Budget, budget_id)
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    db.delete(budget)
    db.commit()


@router.post("/copy-month", response_model=list[BudgetRead])
def copy_month_budgets(
    from_year: int = Query(...),
    from_month: int = Query(...),
    to_year: int = Query(...),
    to_month: int = Query(...),
    overwrite: bool = Query(False, description="Overwrite existing budgets in target month"),
    db: Session = Depends(get_db),
):
    """
    Copy all budget entries from one month to another.
    Useful for months where spending targets don't change much.
    Pass overwrite=true to replace any existing budgets in the target month.
    """
    source_budgets = (
        db.query(Budget)
        .filter(Budget.year == from_year, Budget.month == from_month)
        .all()
    )
    if not source_budgets:
        raise HTTPException(
            status_code=404,
            detail=f"No budgets found for {from_year}-{from_month:02d}",
        )

    result = []
    for src in source_budgets:
        existing = (
            db.query(Budget)
            .filter(
                Budget.category_id == src.category_id,
                Budget.year == to_year,
                Budget.month == to_month,
            )
            .first()
        )
        if existing:
            if overwrite:
                existing.amount = src.amount
                existing.notes = src.notes
                budget = existing
            else:
                result.append(_to_budget_read(existing))
                continue
        else:
            budget = Budget(
                category_id=src.category_id,
                year=to_year,
                month=to_month,
                amount=src.amount,
                notes=src.notes,
            )
            db.add(budget)

        db.flush()
        result.append(_to_budget_read(budget))

    db.commit()
    return result
