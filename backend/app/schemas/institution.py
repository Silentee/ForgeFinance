from datetime import datetime
from typing import Optional
from pydantic import BaseModel, HttpUrl, field_validator


class InstitutionBase(BaseModel):
    name: str
    url: Optional[str] = None
    notes: Optional[str] = None


class InstitutionCreate(InstitutionBase):
    pass


class InstitutionUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None


class InstitutionRead(InstitutionBase):
    id: int
    plaid_institution_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
