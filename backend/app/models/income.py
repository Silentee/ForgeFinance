from datetime import date, datetime
from typing import Optional
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Earner(Base):
    """
    A person in the household whose gross income is tracked.

    Gross income never appears in transactions (paychecks land as take-home
    deposits), so it's recorded separately as IncomeEntry rows per earner.
    """
    __tablename__ = "earners"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Owner. Nullable multi-user prep: endpoints don't scope by user yet.
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # hex color e.g. "#FF5733"
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Demo data flag — mirrors Account.is_demo so leaving demo mode can clear
    # the demo earner without touching people the user added.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    entries: Mapped[list["IncomeEntry"]] = relationship(
        "IncomeEntry", back_populates="earner", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Earner id={self.id} name={self.name!r}>"


class IncomeEntry(Base):
    """
    One gross-income fact for an earner.

    kind='salary': amount is the ANNUAL gross base rate, in effect from
    effective_date until the earner's next salary entry (a step function, like
    balance snapshots). An amount of 0 means income stopped (left a job, leave).

    kind='bonus' | 'other': a one-time gross amount paid on effective_date.
    """
    __tablename__ = "income_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    # Owner. Nullable multi-user prep: endpoints don't scope by user yet.
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )

    earner_id: Mapped[int] = mapped_column(
        ForeignKey("earners.id", ondelete="CASCADE"), nullable=False, index=True
    )

    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # 'salary' | 'bonus' | 'other'
    effective_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    employer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    earner: Mapped["Earner"] = relationship("Earner", back_populates="entries")

    def __repr__(self):
        return (
            f"<IncomeEntry earner_id={self.earner_id} kind={self.kind} "
            f"date={self.effective_date} amount={self.amount}>"
        )
