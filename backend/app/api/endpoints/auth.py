from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import hash_password, verify_password, create_access_token
from app.models.user import User
from app.api.deps import get_current_user

router = APIRouter()


class AuthCredentials(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=6)


class AuthResponse(BaseModel):
    access_token: str
    user: dict


class AuthStatus(BaseModel):
    setup_required: bool


def _user_dict(user: User) -> dict:
    return {"id": user.id, "username": user.username}


def _create_token(user: User) -> str:
    from app.core.config import settings
    return create_access_token(user.id, settings.secret_key, settings.access_token_expire_minutes)


@router.get("/status", response_model=AuthStatus)
def auth_status(db: Session = Depends(get_db)):
    user_count = db.query(User).count()
    return AuthStatus(setup_required=user_count == 0)


@router.post("/setup", response_model=AuthResponse)
def setup_admin(creds: AuthCredentials, db: Session = Depends(get_db)):
    if db.query(User).count() > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account already exists")
    user = User(username=creds.username, password_hash=hash_password(creds.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(access_token=_create_token(user), user=_user_dict(user))


@router.post("/login", response_model=AuthResponse)
def login(creds: AuthCredentials, db: Session = Depends(get_db)):
    user = db.query(User).filter(func.lower(User.username) == func.lower(creds.username)).first()
    if user is None or not verify_password(creds.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    return AuthResponse(access_token=_create_token(user), user=_user_dict(user))


class ChangePassword(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


@router.put("/password")
def change_password(body: ChangePassword, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"message": "Password updated"}


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return _user_dict(user)

