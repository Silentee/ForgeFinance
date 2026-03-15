"""
Import all models here so that:
1. They're registered with SQLAlchemy's metadata (required for create_all)
2. Other modules can do: from app.models import Account, Transaction, etc.
"""

from app.models.enums import (
    AccountType,
    AccountSubtype,
    TransactionType,
    ImportSourceType,
    BalanceType,
)
from app.models.account import Institution, Account
from app.models.category import Category, DEFAULT_CATEGORIES
from app.models.balance import BalanceSnapshot, ImportSource
from app.models.transaction import Transaction
from app.models.budget import Budget
from app.models.budget_visibility import BudgetVisibleCategories
from app.models.user import User

__all__ = [
    "AccountType", "AccountSubtype", "TransactionType", "ImportSourceType", "BalanceType",
    "Institution", "Account", "Category", "DEFAULT_CATEGORIES",
    "BalanceSnapshot", "ImportSource", "Transaction", "Budget",
    "BudgetVisibleCategories",
    "User",
]
