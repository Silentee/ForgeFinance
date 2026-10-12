from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Earner, IncomeEntry
from app.schemas.income import (
    EarnerCreate,
    EarnerRead,
    EarnerUpdate,
    IncomeEntryCreate,
    IncomeEntryRead,
    IncomeEntryUpdate,
)

router = APIRouter()


def _to_entry_read(entry: IncomeEntry) -> IncomeEntryRead:
    return IncomeEntryRead(
        id=entry.id,
        earner_id=entry.earner_id,
        earner_name=entry.earner.name if entry.earner else None,
        kind=entry.kind,
        effective_date=entry.effective_date,
        amount=float(entry.amount),
        employer=entry.employer,
        notes=entry.notes,
    )


def _ensure_unique_salary_date(
    db: Session, earner_id: int, kind: str, effective_date, exclude_id: Optional[int] = None
):
    """Two salary entries on one date would make the rate ambiguous."""
    if kind != "salary":
        return
    q = db.query(IncomeEntry).filter(
        IncomeEntry.earner_id == earner_id,
        IncomeEntry.kind == "salary",
        IncomeEntry.effective_date == effective_date,
    )
    if exclude_id is not None:
        q = q.filter(IncomeEntry.id != exclude_id)
    existing = q.first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A salary entry on {effective_date.isoformat()} already exists for this "
                f"person (id={existing.id}). Edit that entry instead."
            ),
        )


# ---------------------------------------------------------------------------
# Earners
# ---------------------------------------------------------------------------

@router.get("/earners", response_model=list[EarnerRead])
def list_earners(db: Session = Depends(get_db)):
    return db.query(Earner).order_by(Earner.sort_order, Earner.name, Earner.id).all()


@router.post("/earners", response_model=EarnerRead, status_code=status.HTTP_201_CREATED)
def create_earner(payload: EarnerCreate, db: Session = Depends(get_db)):
    sort_order = payload.sort_order if payload.sort_order is not None else db.query(Earner).count()
    earner = Earner(name=payload.name, color=payload.color, sort_order=sort_order)
    db.add(earner)
    db.commit()
    db.refresh(earner)
    return earner


@router.patch("/earners/{earner_id}", response_model=EarnerRead)
def update_earner(earner_id: int, payload: EarnerUpdate, db: Session = Depends(get_db)):
    earner = db.get(Earner, earner_id)
    if not earner:
        raise HTTPException(status_code=404, detail="Person not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is None:
            continue
        setattr(earner, field, value)

    db.commit()
    db.refresh(earner)
    return earner


@router.delete("/earners/{earner_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_earner(earner_id: int, db: Session = Depends(get_db)):
    """Delete a person and all of their income entries."""
    earner = db.get(Earner, earner_id)
    if not earner:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(earner)
    db.commit()


# ---------------------------------------------------------------------------
# Income entries
# ---------------------------------------------------------------------------

@router.get("/entries", response_model=list[IncomeEntryRead])
def list_entries(
    earner_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Income entries, newest first, optionally for one person."""
    q = db.query(IncomeEntry)
    if earner_id is not None:
        q = q.filter(IncomeEntry.earner_id == earner_id)
    entries = q.order_by(IncomeEntry.effective_date.desc(), IncomeEntry.id.desc()).all()
    return [_to_entry_read(e) for e in entries]


@router.post("/entries", response_model=IncomeEntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(payload: IncomeEntryCreate, db: Session = Depends(get_db)):
    if not db.get(Earner, payload.earner_id):
        raise HTTPException(status_code=404, detail="Person not found")
    _ensure_unique_salary_date(db, payload.earner_id, payload.kind, payload.effective_date)

    entry = IncomeEntry(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _to_entry_read(entry)


@router.patch("/entries/{entry_id}", response_model=IncomeEntryRead)
def update_entry(entry_id: int, payload: IncomeEntryUpdate, db: Session = Depends(get_db)):
    entry = db.get(IncomeEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Income entry not found")

    changes = payload.model_dump(exclude_unset=True)
    for required in ("earner_id", "kind", "effective_date", "amount"):
        if required in changes and changes[required] is None:
            raise HTTPException(status_code=422, detail=f"{required} cannot be null")
    if "earner_id" in changes and not db.get(Earner, changes["earner_id"]):
        raise HTTPException(status_code=404, detail="Person not found")

    _ensure_unique_salary_date(
        db,
        changes.get("earner_id", entry.earner_id),
        changes.get("kind", entry.kind),
        changes.get("effective_date", entry.effective_date),
        exclude_id=entry.id,
    )

    for field, value in changes.items():
        setattr(entry, field, value)

    db.commit()
    db.refresh(entry)
    return _to_entry_read(entry)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(IncomeEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Income entry not found")
    db.delete(entry)
    db.commit()
