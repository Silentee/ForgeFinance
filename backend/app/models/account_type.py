from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AccountTypeDef(Base):
    """
    User-editable definition of an account type (checking, credit_card, …).

    Replaces the old hardcoded AccountType enum. Each row carries the business
    rules that used to be baked into code:
      - is_liability drives net-worth math (liabilities subtract).
      - is_liquid_default seeds an account's is_liquid flag on creation.

    Built-in types are seeded with is_system=True and can be renamed/hidden but
    not deleted. Custom types (is_system=False) can be deleted when unused.
    Account.account_type stores this row's `key`.
    """
    __tablename__ = "account_types"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Stable slug stored on accounts (e.g. "checking", "credit_card").
    key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)

    is_liability: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_liquid_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def __repr__(self):
        return f"<AccountTypeDef key={self.key!r} liability={self.is_liability}>"


# Built-in account types seeded on first run. Mirrors the legacy AccountType
# enum + LIQUID_ACCOUNT_TYPES + is_liability sets + frontend ACCOUNT_TYPE_LABELS.
# (key, label, is_liability, is_liquid_default)
DEFAULT_ACCOUNT_TYPES = [
    # Assets
    ("checking", "Checking", False, True),
    ("savings", "Savings", False, True),
    ("hysa", "HYSA", False, True),
    ("cash", "Cash", False, True),
    ("precious_metal", "Precious Metal", False, True),
    ("investment", "Investment", False, True),
    ("retirement", "Retirement", False, False),
    ("hsa", "HSA", False, False),
    ("real_estate", "Real Estate", False, False),
    ("vehicle", "Vehicle", False, False),
    ("other_asset", "Other Asset", False, False),
    # Liabilities
    ("credit_card", "Credit Card", True, False),
    ("mortgage", "Mortgage", True, False),
    ("car_loan", "Car Loan", True, False),
    ("student_loan", "Student Loan", True, False),
    ("personal_loan", "Personal Loan", True, False),
    ("other_liability", "Other Liability", True, False),
]
