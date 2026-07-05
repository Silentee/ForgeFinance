import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Budget, BudgetVisibleCategories, Category
from app.schemas.reports import CategoryCreate, CategoryUpdate, CategoryRead

router = APIRouter()


@router.get("", response_model=list[CategoryRead])
def list_categories(
    flat: bool = Query(False, description="If True, return a flat list instead of tree"),
    income_only: bool = Query(False),
    expense_only: bool = Query(False),
    include_hidden: bool = Query(False, description="Include hidden categories (for the manager UI)"),
    db: Session = Depends(get_db),
):
    """
    Return all categories.

    By default returns a nested tree (parent categories with children embedded)
    and excludes hidden categories. Pass flat=true for a simple list (useful for
    dropdowns) or include_hidden=true for the category manager.
    """
    q = db.query(Category)

    if income_only:
        q = q.filter(Category.is_income == True)
    if expense_only:
        q = q.filter(Category.is_income == False)
    if not include_hidden:
        q = q.filter(Category.is_hidden == False)

    all_cats = q.order_by(Category.is_income.desc(), Category.sort_order, Category.name).all()

    # Build children from the already-filtered list so hidden children don't
    # leak in via the (unfiltered) ORM relationship. This applies to BOTH
    # modes: returning ORM objects directly would let response serialization
    # walk the raw relationship and re-include hidden rows.
    by_parent: dict = {}
    for c in all_cats:
        by_parent.setdefault(c.parent_id, []).append(c)

    def to_read(cat: Category) -> CategoryRead:
        node = CategoryRead.model_validate(cat)
        node.children = [to_read(ch) for ch in by_parent.get(cat.id, [])]
        return node

    if flat:
        return [to_read(c) for c in all_cats]
    return [to_read(c) for c in all_cats if c.parent_id is None]


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    """Create a custom (non-system) category."""
    if payload.parent_id:
        parent = db.get(Category, payload.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent category not found")
        if parent.parent_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Categories are limited to 2 levels (parent/child). Cannot nest further.",
            )

    cat = Category(**payload.model_dump(), is_system=False)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.get("/{category_id}", response_model=CategoryRead)
def get_category(category_id: int, db: Session = Depends(get_db)):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


@router.patch("/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if payload.parent_id is not None:
        if payload.parent_id == category_id:
            raise HTTPException(status_code=400, detail="A category cannot be its own parent.")
        if cat.children:
            raise HTTPException(
                status_code=400,
                detail="Category has child categories and must stay top-level. Move its children first.",
            )
        parent = db.get(Category, payload.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent category not found")
        if parent.parent_id is not None:
            raise HTTPException(status_code=400, detail="Cannot nest categories more than 2 levels.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)

    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)):
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    if cat.is_system:
        raise HTTPException(
            status_code=400,
            detail="System categories cannot be deleted. You can rename them or create custom ones instead.",
        )
    if cat.children:
        raise HTTPException(
            status_code=400,
            detail=f"Category has {len(cat.children)} child categories. Delete or reassign them first.",
        )
    if cat.transactions:
        # Rather than blocking deletion, uncategorize the transactions
        for tx in cat.transactions:
            tx.category_id = None

    # Budgets referencing this category would be orphaned — remove them, and
    # drop the id from any saved per-month budget-visibility lists.
    db.query(Budget).filter(Budget.category_id == category_id).delete(
        synchronize_session=False
    )
    for row in db.query(BudgetVisibleCategories).all():
        try:
            ids = json.loads(row.category_ids_json or "[]")
        except ValueError:
            continue
        if isinstance(ids, list) and category_id in ids:
            row.category_ids_json = json.dumps([i for i in ids if i != category_id])

    db.delete(cat)
    db.commit()
