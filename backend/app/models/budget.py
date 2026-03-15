from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, Numeric, Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Budget(Base):
    """
    A monthly spending target for a category.

    Budgets are defined per-category per-month. The budget report
    compares actual spending in that category against this target.

    month and year together identify the budget period.
    A budget with rollover=True carries unspent amount forward (future feature).
    """
    __tablename__ = "budgets"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), nullable=False, index=True
    )

    month: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-12
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    # Target spending amount for this category this month
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    category: Mapped["Category"] = relationship("Category")

    def __repr__(self):
        return (
            f"<Budget category_id={self.category_id} "
            f"{self.year}-{self.month:02d} amount={self.amount}>"
        )
