from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class SubscriptionRule(Base):
    """
    Per-merchant override for the subscription report.

    Auto-detection groups transactions by a normalized merchant key; a rule
    row overrides what the detector decided for that merchant:
    - rule='exclude': a detected merchant the user dismissed (false positive).
    - rule='include': a merchant the user wants tracked even though its
      cadence/amounts don't pass the detection heuristics.
    - nickname: user-chosen display name for the merchant.
    - alias_of: canonical merchant_key this key is linked into, so charge
      series from drifting descriptors merge into one subscription. Kept
      flat at write time (never chains), and a linked key's own
      include/exclude is cleared since the canonical key's rule governs
      the merged group.
    - cadence_override: user-forced billing cadence for the merchant,
      replacing the inferred one in the report's math; NULL means infer.
    - status_override: 'active' or 'inactive' pins the reported status;
      NULL means derive it from the last charge date.

    A manual entry is a row whose merchant_key is synthetic
    ('manual:<hex>' — see MANUAL_KEY_PREFIX in services/subscriptions.py):
    a subscription the user declared outright rather than one detected from
    charges. It carries its own amount and start date, uses
    cadence_override as its cadence, and real merchants attach to it through
    alias_of like any other linked descriptor.
    - manual_amount: per-charge amount, used while no charges are linked.
    - manual_start_date: anchor the next-expected date is rolled forward from.

    A row may carry only a nickname, alias, cadence, status, or manual
    detail (rule=NULL); rows that end up with none of them are deleted.
    """
    __tablename__ = "subscription_rules"
    __table_args__ = (
        UniqueConstraint("user_id", "merchant_key", name="uq_subscription_rules_user_merchant"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    merchant_key: Mapped[str] = mapped_column(String(255), nullable=False)
    rule: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 'include' | 'exclude' | NULL
    nickname: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    alias_of: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cadence_override: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # cadence name | NULL
    status_override: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 'active' | 'inactive' | NULL

    # Manual-entry detail; NULL on rows that only override a detected merchant.
    manual_amount: Mapped[Optional[float]] = mapped_column(Numeric(14, 2), nullable=True)
    manual_start_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship("User")
