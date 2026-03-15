"""
validate_models.py — Smoke test that all models import and tables can be created.
Run from the backend/ directory: python validate_models.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

def main():
    print("Validating models...")

    # 1. Import check
    try:
        from app.models import (
            AccountType, AccountSubtype, TransactionType, ImportSourceType, BalanceType,
            Institution, Account, Category, BalanceSnapshot, ImportSource, Transaction, Budget
        )
        print("  ✓ All models import successfully")
    except Exception as e:
        print(f"  ✗ Import error: {e}")
        return False

    # 2. In-memory SQLite table creation
    try:
        from sqlalchemy import create_engine
        from app.db.session import Base
        import app.models  # noqa

        test_engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=test_engine)
        tables = list(Base.metadata.tables.keys())
        print(f"  ✓ Tables created: {tables}")
    except Exception as e:
        print(f"  ✗ Table creation error: {e}")
        return False

    # 3. Check expected tables exist
    expected = {"institutions", "accounts", "categories", "transactions",
                "balance_snapshots", "import_sources", "budgets"}
    missing = expected - set(tables)
    if missing:
        print(f"  ✗ Missing tables: {missing}")
        return False
    print(f"  ✓ All {len(expected)} expected tables present")

    # 4. Verify enum values
    assert AccountType.CHECKING == "checking"
    assert ImportSourceType.PLAID == "plaid"
    print("  ✓ Enums look correct")

    print("\n✅ All validations passed.")
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
