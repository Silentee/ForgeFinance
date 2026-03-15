from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import TransactionType


class Transaction(Base):
    """
    A single financial transaction on an account.

    Design notes:
    - amount is always positive; transaction_type (DEBIT/CREDIT) carries the sign.
    - original_description is the raw merchant string from the CSV/bank.
    - description is user-editable (cleaned up name).
    - is_transfer marks inter-account moves (e.g., credit card payment from checking)
      so they can be excluded from budget reports to avoid double-counting.
    - is_pending mirrors how banks report pending vs. posted transactions.
    - The import_source_id links back to which CSV file or Plaid sync created this row.
    - category_id is nullable — uncategorized transactions are valid.
    - exclude_from_budget lets users hide one-off transactions (e.g., large asset purchase).
    """
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id"), nullable=False, index=True
    )
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id"), nullable=True, index=True
    )
    import_source_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("import_sources.id"), nullable=True, index=True
    )

    # Core transaction fields
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    transaction_type: Mapped[TransactionType] = mapped_column(
        SAEnum(TransactionType), nullable=False
    )

    # Descriptions
    original_description: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # user-edited
    merchant_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Flags
    is_pending: Mapped[bool] = mapped_column(Boolean, default=False)
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False)
    exclude_from_budget: Mapped[bool] = mapped_column(Boolean, default=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    is_annualized: Mapped[bool] = mapped_column(Boolean, default=False)

    # User notes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Duplicate detection — hash of (account_id, date, amount, original_description)
    # Used to avoid importing the same transaction twice from overlapping CSV exports.
    dedup_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )

    # Plaid stub — populated only if transaction came via Plaid
    plaid_transaction_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, unique=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    account: Mapped["Account"] = relationship("Account", back_populates="transactions")
    category: Mapped[Optional["Category"]] = relationship(
        "Category", back_populates="transactions"
    )
    import_source: Mapped[Optional["ImportSource"]] = relationship(
        "ImportSource", back_populates="transactions"
    )

    @property
    def signed_amount(self) -> float:
        """
        Signed amount from the perspective of your net cash flow.
        Credits (income, refunds) are positive. Debits (expenses) are negative.
        For credit cards, a DEBIT means you spent money (negative net flow).
        """
        if self.transaction_type == TransactionType.CREDIT:
            return float(self.amount)
        return -float(self.amount)

    def __repr__(self):
        return (
            f"<Transaction id={self.id} date={self.date} "
            f"amount={self.amount} type={self.transaction_type}>"
        )
