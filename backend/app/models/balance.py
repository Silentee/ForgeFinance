from datetime import datetime, date
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Date, Numeric, Text, ForeignKey, Enum as SAEnum, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import BalanceType, ImportSourceType


class BalanceSnapshot(Base):
    """
    Point-in-time balance record for an account.

    Used in two ways:
    1. For investment/real estate accounts: the primary way balances are tracked,
       since there's no reliable transaction-by-transaction ledger.
    2. For checking/credit accounts: periodic reconciliation snapshots that allow
       the app to detect discrepancies with the computed-from-transactions balance.

    Having a time series of balance snapshots is what powers the "Net Worth Over Time"
    chart and monthly net worth reports.
    """
    __tablename__ = "balance_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id"), nullable=False, index=True
    )
    import_source_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("import_sources.id"), nullable=True
    )

    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    balance: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    balance_type: Mapped[BalanceType] = mapped_column(
        SAEnum(BalanceType), nullable=False, default=BalanceType.SNAPSHOT
    )
    currency: Mapped[str] = mapped_column(String(3), default="USD")

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    account: Mapped["Account"] = relationship("Account", back_populates="balance_history")
    import_source: Mapped[Optional["ImportSource"]] = relationship(
        "ImportSource", back_populates="balance_snapshots"
    )

    def __repr__(self):
        return (
            f"<BalanceSnapshot account_id={self.account_id} "
            f"date={self.snapshot_date} balance={self.balance}>"
        )


class ImportSource(Base):
    """
    Tracks the origin of imported data.

    Every batch of transactions or balances imported into the system is linked
    to an ImportSource record. This gives you:
    - Audit trail (when was this data imported, from where)
    - Deduplication (don't re-import the same CSV file)
    - Future Plaid support: a PLAID type ImportSource links to a Plaid Item,
      and the sync cursor/webhook state lives here.

    For CSV imports: file_name and file_hash are populated.
    For Plaid imports (future): plaid_item_id, plaid_cursor are populated.
    """
    __tablename__ = "import_sources"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id"), nullable=False, index=True
    )

    source_type: Mapped[ImportSourceType] = mapped_column(
        SAEnum(ImportSourceType), nullable=False, index=True
    )

    # --- CSV fields ---
    file_name: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    file_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, index=True
    )  # SHA256 of file contents — used to detect duplicate uploads

    # Date range of data contained in this import
    date_range_start: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    date_range_end: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Counts for display / debugging
    transactions_imported: Mapped[int] = mapped_column(Integer, default=0)
    transactions_skipped: Mapped[int] = mapped_column(Integer, default=0)  # duplicates

    # Status
    is_successful: Mapped[bool] = mapped_column(Boolean, default=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- Plaid fields (future) ---
    plaid_item_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    plaid_cursor: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True
    )  # Plaid transaction sync cursor for incremental updates

    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    account: Mapped["Account"] = relationship("Account", back_populates="import_sources")
    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="import_source"
    )
    balance_snapshots: Mapped[list["BalanceSnapshot"]] = relationship(
        "BalanceSnapshot", back_populates="import_source"
    )

    def __repr__(self):
        return (
            f"<ImportSource id={self.id} type={self.source_type} "
            f"file={self.file_name!r} imported_at={self.imported_at}>"
        )
