from datetime import datetime
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Category(Base):
    """
    Hierarchical transaction category.

    Examples:
        Parent: "Food & Dining"
            Child: "Groceries"
            Child: "Restaurants"
            Child: "Coffee Shops"
        Parent: "Income"
            Child: "Salary"
            Child: "Freelance"
            Child: "Investment Income"

    is_income: True for income categories, False for expense categories.
    This drives budget report sign conventions.

    system_category: True for built-in categories that shouldn't be deleted.
    Users can still add their own categories alongside system ones.
    """
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_income: Mapped[bool] = mapped_column(Boolean, default=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # hex color e.g. "#FF5733"
    icon: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # icon name for UI

    # Self-referential for parent/child hierarchy (max 2 levels for simplicity)
    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id"), nullable=True, index=True
    )

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    # Relationships
    parent: Mapped[Optional["Category"]] = relationship(
        "Category", back_populates="children", remote_side="Category.id"
    )
    children: Mapped[list["Category"]] = relationship(
        "Category", back_populates="parent"
    )
    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="category"
    )

    def __repr__(self):
        return f"<Category id={self.id} name={self.name!r} income={self.is_income}>"


# Default system categories seeded on first run
# Organized into sections: Income, Essential, Utilities, Lifestyle, Financial, Other
DEFAULT_CATEGORIES = [
    # --- Income ---------------------------------------------------------------
    {"name": "Income", "is_income": True, "is_system": True, "children": [
        {"name": "Salary & Wages", "is_income": True, "is_system": True},
        {"name": "Investment Income", "is_income": True, "is_system": True},
        {"name": "Refunds & Returns", "is_income": True, "is_system": True},
        {"name": "Other Income", "is_income": True, "is_system": True},
    ]},

    # --- Essential Expenses ---------------------------------------------------
    {"name": "Essential", "is_income": False, "is_system": True, "children": [
        {"name": "Rent/Mortgage", "is_income": False, "is_system": True},
        {"name": "Property Tax", "is_income": False, "is_system": True},
        {"name": "HOA", "is_income": False, "is_system": True},
        {"name": "Home Maintenance & Repairs", "is_income": False, "is_system": True},
        {"name": "Home Insurance", "is_income": False, "is_system": True},
        {"name": "Car Insurance", "is_income": False, "is_system": True},
        {"name": "Other Insurance", "is_income": False, "is_system": True},
        {"name": "Groceries", "is_income": False, "is_system": True},
        {"name": "Healthcare", "is_income": False, "is_system": True},
        {"name": "Transportation", "is_income": False, "is_system": True},
        {"name": "Child Care", "is_income": False, "is_system": True},
        {"name": "Education", "is_income": False, "is_system": True},
        {"name": "Other Essentials", "is_income": False, "is_system": True},
    ]},

    # --- Utilities ------------------------------------------------------------
    {"name": "Utilities", "is_income": False, "is_system": True, "children": [
        {"name": "Electric", "is_income": False, "is_system": True},
        {"name": "Gas", "is_income": False, "is_system": True},
        {"name": "Water", "is_income": False, "is_system": True},
        {"name": "Internet & TV", "is_income": False, "is_system": True},
        {"name": "Cell Phone", "is_income": False, "is_system": True},
        {"name": "Trash", "is_income": False, "is_system": True},
    ]},

    # --- Lifestyle ------------------------------------------------------------
    {"name": "Lifestyle", "is_income": False, "is_system": True, "children": [
        {"name": "Restaurants", "is_income": False, "is_system": True},
        {"name": "Entertainment", "is_income": False, "is_system": True},
        {"name": "Shopping", "is_income": False, "is_system": True},
        {"name": "Subscriptions", "is_income": False, "is_system": True},
        {"name": "Travel", "is_income": False, "is_system": True},
        {"name": "Personal Care", "is_income": False, "is_system": True},
        {"name": "Child Expenses", "is_income": False, "is_system": True},
        {"name": "Home Improvement", "is_income": False, "is_system": True},
    ]},

    # --- Financial ------------------------------------------------------------
    {"name": "Financial", "is_income": False, "is_system": True, "children": [
        {"name": "Taxes", "is_income": False, "is_system": True},
        {"name": "Investment Contribution", "is_income": False, "is_system": True},
        {"name": "Fees & Interest", "is_income": False, "is_system": True},
        {"name": "Gifts & Donations", "is_income": False, "is_system": True},
    ]},

    # --- Other ----------------------------------------------------------------
    {"name": "Other", "is_income": False, "is_system": True, "children": [
        {"name": "Other Expense", "is_income": False, "is_system": True},
    ]},

    # --- Uncategorized --------------------------------------------------------
    {"name": "Uncategorized", "is_income": False, "is_system": True},
]



