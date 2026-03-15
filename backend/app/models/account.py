from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Numeric, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import AccountType, AccountSubtype


class Institution(Base):
    """
    A financial institution (bank, brokerage, etc.).
    Separating this out makes it easy to group accounts and
    supports Plaid's institution model if we add it later.
    """
    __tablename__ = "institutions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Plaid fields — null until Plaid integration is added
    plaid_institution_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, unique=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    accounts: Mapped[list["Account"]] = relationship("Account", back_populates="institution")

    def __repr__(self):
        return f"<Institution id={self.id} name={self.name!r}>"


class Account(Base):
    """
    Central entity. Every financial account — checking, credit card,
    brokerage, real estate property, etc. — is an Account.

    Design notes:
    - account_type drives business logic (is this an asset or liability?)
    - current_balance is a denormalized cache updated on each import/reconciliation
    - Plaid fields are nullable stubs; populating them is all that's needed
      to connect an account to live Plaid data later.
    """
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(
        SAEnum(AccountType), nullable=False, index=True
    )
    account_subtype: Mapped[Optional[AccountSubtype]] = mapped_column(
        SAEnum(AccountSubtype), nullable=True
    )

    institution_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("institutions.id"), nullable=True, index=True
    )

    # Last 4 digits of account number — useful for matching CSV imports
    mask: Mapped[Optional[str]] = mapped_column(String(4), nullable=True)

    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)

    # Denormalized current balance — kept in sync by the balance service.
    # For assets: positive = value you hold.
    # For liabilities (credit cards, loans): positive = amount you OWE.
    current_balance: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    balance_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Whether to include in net worth and budget calculations
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    include_in_net_worth: Mapped[bool] = mapped_column(Boolean, default=True)

    # Whether this is a liquid asset (can be quickly converted to cash)
    is_liquid: Mapped[bool] = mapped_column(Boolean, default=False)

    # Demo data flag — allows clearing all demo accounts at once
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Default CSV parser preset for imports (e.g. "chase_checking", "generic")
    default_csv_preset: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Link an asset to its associated liability (e.g., home to mortgage, car to car loan)
    # This enables equity tracking: equity = asset_value - liability_balance
    linked_liability_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("accounts.id"), nullable=True, index=True
    )

    # --- Plaid integration stubs (nullable; populated when Plaid is added) ---
    plaid_item_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )
    plaid_account_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, unique=True, index=True
    )
    plaid_access_token: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    # -----------------------------------------------------------------------

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    institution: Mapped[Optional["Institution"]] = relationship(
        "Institution", back_populates="accounts"
    )
    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="account", cascade="all, delete-orphan"
    )
    balance_history: Mapped[list["BalanceSnapshot"]] = relationship(
        "BalanceSnapshot", back_populates="account", cascade="all, delete-orphan"
    )
    import_sources: Mapped[list["ImportSource"]] = relationship(
        "ImportSource", back_populates="account"
    )
    # Asset -> Liability link (e.g., home -> mortgage)
    linked_liability: Mapped[Optional["Account"]] = relationship(
        "Account",
        foreign_keys=[linked_liability_id],
        remote_side="Account.id",
        backref="linked_assets",
    )

    @property
    def is_liability(self) -> bool:
        return self.account_type in (
            AccountType.CREDIT_CARD,
            AccountType.MORTGAGE,
            AccountType.CAR_LOAN,
            AccountType.STUDENT_LOAN,
            AccountType.PERSONAL_LOAN,
            AccountType.OTHER_LIABILITY,
        )

    @property
    def net_worth_value(self) -> float:
        """Value as it contributes to net worth (liabilities are negative)."""
        if self.current_balance is None:
            return 0.0
        return -float(self.current_balance) if self.is_liability else float(self.current_balance)

    def __repr__(self):
        return f"<Account id={self.id} name={self.name!r} type={self.account_type}>"
