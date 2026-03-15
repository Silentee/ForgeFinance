from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Institution
from app.schemas import InstitutionCreate, InstitutionUpdate, InstitutionRead

router = APIRouter()


@router.get("", response_model=list[InstitutionRead])
def list_institutions(db: Session = Depends(get_db)):
    return db.query(Institution).order_by(Institution.name).all()


@router.post("", response_model=InstitutionRead, status_code=status.HTTP_201_CREATED)
def create_institution(payload: InstitutionCreate, db: Session = Depends(get_db)):
    institution = Institution(**payload.model_dump())
    db.add(institution)
    db.commit()
    db.refresh(institution)
    return institution


@router.get("/{institution_id}", response_model=InstitutionRead)
def get_institution(institution_id: int, db: Session = Depends(get_db)):
    institution = db.query(Institution).get(institution_id)
    if not institution:
        raise HTTPException(status_code=404, detail="Institution not found")
    return institution


@router.patch("/{institution_id}", response_model=InstitutionRead)
def update_institution(
    institution_id: int,
    payload: InstitutionUpdate,
    db: Session = Depends(get_db),
):
    institution = db.query(Institution).get(institution_id)
    if not institution:
        raise HTTPException(status_code=404, detail="Institution not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(institution, field, value)

    db.commit()
    db.refresh(institution)
    return institution


@router.delete("/{institution_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_institution(institution_id: int, db: Session = Depends(get_db)):
    institution = db.query(Institution).get(institution_id)
    if not institution:
        raise HTTPException(status_code=404, detail="Institution not found")

    if institution.accounts:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete institution with {len(institution.accounts)} linked account(s). "
                "Reassign or delete those accounts first."
            ),
        )

    db.delete(institution)
    db.commit()
