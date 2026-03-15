"""
init_db.py — Run once to create all tables and seed default data.

Usage:
    python -m app.db.init_db
"""

import random
from datetime import date, datetime, timedelta
from decimal import Decimal

from app.db.session import engine, SessionLocal, Base
from app.models import Category, Account, Transaction, BalanceSnapshot, Budget, DEFAULT_CATEGORIES
from app.models.enums import AccountType, TransactionType, BalanceType

# Import all models so they're registered with Base.metadata
import app.models  # noqa: F401


def create_tables():
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("  Tables created.")


def _get_or_create_parent(db, name: str, *, is_income: bool = False) -> Category:
    parent = (
        db.query(Category)
        .filter(Category.parent_id == None, Category.name == name, Category.is_income == is_income)
        .first()
    )
    if parent:
        return parent
    parent = Category(name=name, is_income=is_income, is_system=True)
    db.add(parent)
    db.flush()
    return parent


def _get_child(db, parent_id: int, name: str):
    return (
        db.query(Category)
        .filter(Category.parent_id == parent_id, Category.name == name)
        .first()
    )


def _get_or_create_child(db, parent_id: int, name: str, *, is_income: bool = False) -> Category:
    child = _get_child(db, parent_id, name)
    if child:
        return child
    child = Category(name=name, is_income=is_income, is_system=True, parent_id=parent_id)
    db.add(child)
    db.flush()
    return child


def migrate_category_taxonomy(db):
    """Align existing category trees with current system defaults."""
    changed = False

    essential = _get_or_create_parent(db, "Essential")
    lifestyle = _get_or_create_parent(db, "Lifestyle")
    _get_or_create_parent(db, "Financial")
    other = _get_or_create_parent(db, "Other")

    if _get_child(db, lifestyle.id, "Home Improvement") is None:
        _get_or_create_child(db, lifestyle.id, "Home Improvement")
        changed = True

    if _get_child(db, essential.id, "HOA") is None:
        _get_or_create_child(db, essential.id, "HOA")
        changed = True

    legacy_insurance = _get_child(db, essential.id, "Insurance")
    other_insurance = _get_child(db, essential.id, "Other Insurance")

    if legacy_insurance and other_insurance is None:
        legacy_insurance.name = "Other Insurance"
        legacy_insurance.is_system = True
        other_insurance = legacy_insurance
        changed = True
    elif legacy_insurance and other_insurance:
        db.query(Transaction).filter(Transaction.category_id == legacy_insurance.id).update(
            {Transaction.category_id: other_insurance.id}, synchronize_session=False
        )
        db.query(Budget).filter(Budget.category_id == legacy_insurance.id).update(
            {Budget.category_id: other_insurance.id}, synchronize_session=False
        )
        db.delete(legacy_insurance)
        changed = True

    for insurance_name in ["Home Insurance", "Car Insurance", "Other Insurance"]:
        if _get_child(db, essential.id, insurance_name) is None:
            _get_or_create_child(db, essential.id, insurance_name)
            changed = True
    other_insurance = _get_child(db, essential.id, "Other Insurance")
    life_insurance = _get_child(db, essential.id, "Life Insurance")
    if life_insurance:
        if other_insurance:
            db.query(Transaction).filter(Transaction.category_id == life_insurance.id).update(
                {Transaction.category_id: other_insurance.id}, synchronize_session=False
            )
            db.query(Budget).filter(Budget.category_id == life_insurance.id).update(
                {Budget.category_id: other_insurance.id}, synchronize_session=False
            )
        db.delete(life_insurance)
        changed = True

    utilities = _get_or_create_parent(db, "Utilities")
    legacy_electricity = _get_child(db, utilities.id, "Electricity")
    electric = _get_child(db, utilities.id, "Electric")
    if legacy_electricity and electric is None:
        legacy_electricity.name = "Electric"
        legacy_electricity.is_system = True
        changed = True
    elif legacy_electricity and electric:
        db.query(Transaction).filter(Transaction.category_id == legacy_electricity.id).update(
            {Transaction.category_id: electric.id}, synchronize_session=False
        )
        db.query(Budget).filter(Budget.category_id == legacy_electricity.id).update(
            {Budget.category_id: electric.id}, synchronize_session=False
        )
        db.delete(legacy_electricity)
        changed = True
    elif electric is None:
        _get_or_create_child(db, utilities.id, "Electric")
        changed = True

    other_expense_candidates = (
        db.query(Category)
        .filter(Category.name == "Other Expense", Category.is_income == False)
        .all()
    )
    canonical_other_expense = next((c for c in other_expense_candidates if c.parent_id == other.id), None)

    if canonical_other_expense is None and other_expense_candidates:
        canonical_other_expense = other_expense_candidates[0]
        if canonical_other_expense.parent_id != other.id:
            canonical_other_expense.parent_id = other.id
            canonical_other_expense.is_system = True
            changed = True

    if canonical_other_expense is None:
        canonical_other_expense = _get_or_create_child(db, other.id, "Other Expense")
        changed = True

    for candidate in other_expense_candidates:
        if candidate.id == canonical_other_expense.id:
            continue
        db.query(Transaction).filter(Transaction.category_id == candidate.id).update(
            {Transaction.category_id: canonical_other_expense.id}, synchronize_session=False
        )
        db.query(Budget).filter(Budget.category_id == candidate.id).update(
            {Budget.category_id: canonical_other_expense.id}, synchronize_session=False
        )
        db.delete(candidate)
        changed = True

    if changed:
        db.commit()
        print("  Category taxonomy migration applied.")


def run_migrations():
    """Apply incremental schema changes to existing databases."""
    from sqlalchemy import text

    migrations = [
        "ALTER TABLE transactions ADD COLUMN is_annualized BOOLEAN NOT NULL DEFAULT 0",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # Column already exists

    db = SessionLocal()
    try:
        migrate_category_taxonomy(db)
    finally:
        db.close()


def seed_categories(db):
    """Insert default category hierarchy, creating any that are missing."""
    print("  Checking default categories...")
    created = 0
    for parent_data in DEFAULT_CATEGORIES:
        children_data = parent_data.get("children", [])
        is_income = parent_data.get("is_income", False)

        # Find or create the parent
        parent = (
            db.query(Category)
            .filter(Category.parent_id == None, Category.name == parent_data["name"],
                    Category.is_income == is_income)
            .first()
        )
        if parent is None:
            parent = Category(**{k: v for k, v in parent_data.items() if k != "children"})
            db.add(parent)
            db.flush()
            created += 1

        # Find or create each child
        for child_data in children_data:
            existing_child = (
                db.query(Category)
                .filter(Category.parent_id == parent.id, Category.name == child_data["name"])
                .first()
            )
            if existing_child is None:
                child = Category(**child_data, parent_id=parent.id)
                db.add(child)
                created += 1

    db.commit()
    if created > 0:
        print(f"  Done: Created {created} new categories.")
    else:
        print("  Done: All default categories already present.")


def seed_demo_data(db):
    """Create demo accounts and transactions for showcasing the app."""
    # Check if demo data already exists
    existing_demo = db.query(Account).filter(Account.is_demo == True).count()
    if existing_demo > 0:
        print(f"  Done: Demo data already exists ({existing_demo} demo accounts found).")
        return

    # Check if any real accounts exist - don't seed demo if user has real data
    existing_accounts = db.query(Account).filter(Account.is_demo == False).count()
    if existing_accounts > 0:
        print(f"  Done: Real accounts exist, skipping demo data.")
        return

    print("  Seeding demo data...")

    # Get category IDs for transactions
    categories = {c.name: c.id for c in db.query(Category).all()}

    today = date.today()
    one_year_ago = today - timedelta(days=365)

    # === Create Demo Accounts ===

    # 1. Checking Account
    checking = Account(
        name="Demo Checking",
        account_type=AccountType.CHECKING,
        currency="USD",
        is_active=True,
        include_in_net_worth=True,
        is_liquid=True,
        is_demo=True,
        current_balance=4250.00,
        balance_updated_at=datetime.utcnow(),
    )
    db.add(checking)

    # 2. Credit Card
    credit_card = Account(
        name="Demo Credit Card",
        account_type=AccountType.CREDIT_CARD,
        currency="USD",
        is_active=True,
        include_in_net_worth=True,
        is_demo=True,
        current_balance=1850.00,
        balance_updated_at=datetime.utcnow(),
    )
    db.add(credit_card)

    # 3. Real Estate
    real_estate = Account(
        name="Demo Home",
        account_type=AccountType.REAL_ESTATE,
        currency="USD",
        is_active=True,
        include_in_net_worth=True,
        is_demo=True,
        current_balance=425000.00,
        balance_updated_at=datetime.utcnow(),
    )
    db.add(real_estate)

    # 4. Mortgage
    mortgage = Account(
        name="Demo Mortgage",
        account_type=AccountType.MORTGAGE,
        currency="USD",
        is_active=True,
        include_in_net_worth=True,
        is_demo=True,
        current_balance=320000.00,
        balance_updated_at=datetime.utcnow(),
    )
    db.add(mortgage)

    # 5. Retirement Account
    retirement = Account(
        name="Demo 401(k)",
        account_type=AccountType.RETIREMENT,
        currency="USD",
        is_active=True,
        include_in_net_worth=True,
        is_demo=True,
        current_balance=85000.00,
        balance_updated_at=datetime.utcnow(),
    )
    db.add(retirement)

    # 6. Investment/Brokerage Account
    investment = Account(
        name="Demo Brokerage",
        account_type=AccountType.INVESTMENT,
        currency="USD",
        is_active=True,
        include_in_net_worth=True,
        is_liquid=True,
        is_demo=True,
        current_balance=32000.00,
        balance_updated_at=datetime.utcnow(),
    )
    db.add(investment)

    db.flush()  # Get account IDs

    # Link the home to the mortgage for equity tracking
    real_estate.linked_liability_id = mortgage.id

    # === Generate Transactions for Checking Account ===

    checking_txns = []
    current_date = one_year_ago

    # Recurring monthly transactions
    while current_date <= today:
        month_start = current_date.replace(day=1)

        # Salary (1st and 15th of each month)
        if current_date.day == 1:
            checking_txns.append({
                "date": current_date,
                "amount": 3200.00,
                "type": TransactionType.CREDIT,
                "description": "Direct Deposit - Salary",
                "category": "Salary & Wages",
            })
        if current_date.day == 15:
            checking_txns.append({
                "date": current_date,
                "amount": 3200.00,
                "type": TransactionType.CREDIT,
                "description": "Direct Deposit - Salary",
                "category": "Salary & Wages",
            })

        # Monthly bills (around the 1st-5th)
        if current_date.day == 1:
            checking_txns.append({
                "date": current_date,
                "amount": 1800.00,
                "type": TransactionType.DEBIT,
                "description": "Rent Payment",
                "category": "Rent/Mortgage",
            })
        if current_date.day == 3:
            checking_txns.append({
                "date": current_date,
                "amount": 120.00,
                "type": TransactionType.DEBIT,
                "description": "Electric Company",
                "category": "Electric",
            })
            checking_txns.append({
                "date": current_date,
                "amount": 85.00,
                "type": TransactionType.DEBIT,
                "description": "Internet Service",
                "category": "Internet & TV",
            })
        if current_date.day == 5:
            checking_txns.append({
                "date": current_date,
                "amount": 150.00,
                "type": TransactionType.DEBIT,
                "description": "Auto Insurance",
                "category": "Car Insurance",
            })

        # Groceries (weekly, roughly)
        if current_date.weekday() == 5:  # Saturdays
            amount = random.uniform(80, 180)
            checking_txns.append({
                "date": current_date,
                "amount": round(amount, 2),
                "type": TransactionType.DEBIT,
                "description": random.choice(["Whole Foods", "Trader Joe's", "Kroger", "Safeway"]),
                "category": "Groceries",
            })

        # Gas (every ~10 days)
        if current_date.day in [5, 15, 25]:
            amount = random.uniform(35, 55)
            checking_txns.append({
                "date": current_date,
                "amount": round(amount, 2),
                "type": TransactionType.DEBIT,
                "description": random.choice(["Shell", "Chevron", "BP", "Exxon"]),
                "category": "Transportation",
            })

        current_date += timedelta(days=1)

    # Add checking transactions to DB
    for txn in checking_txns:
        t = Transaction(
            account_id=checking.id,
            date=txn["date"],
            amount=Decimal(str(txn["amount"])),
            transaction_type=txn["type"],
            original_description=txn["description"],
            description=txn["description"],
            category_id=categories.get(txn["category"]),
            is_pending=False,
        )
        db.add(t)

    # === Generate Transactions for Credit Card ===

    cc_txns = []
    current_date = one_year_ago

    while current_date <= today:
        # Random dining out (2-3 times per week)
        if random.random() < 0.35:
            amount = random.uniform(15, 75)
            cc_txns.append({
                "date": current_date,
                "amount": round(amount, 2),
                "type": TransactionType.DEBIT,
                "description": random.choice([
                    "Chipotle", "Olive Garden", "Starbucks", "McDonald's",
                    "Thai Kitchen", "Pizza Hut", "Panera Bread", "Five Guys"
                ]),
                "category": "Restaurants",
            })

        # Random shopping (1-2 times per week)
        if random.random() < 0.2:
            amount = random.uniform(20, 150)
            cc_txns.append({
                "date": current_date,
                "amount": round(amount, 2),
                "type": TransactionType.DEBIT,
                "description": random.choice([
                    "Amazon", "Target", "Walmart", "Best Buy", "Home Depot"
                ]),
                "category": "Shopping",
            })

        # Subscriptions (monthly)
        if current_date.day == 10:
            cc_txns.append({
                "date": current_date,
                "amount": 15.99,
                "type": TransactionType.DEBIT,
                "description": "Netflix",
                "category": "Subscriptions",
            })
            cc_txns.append({
                "date": current_date,
                "amount": 10.99,
                "type": TransactionType.DEBIT,
                "description": "Spotify",
                "category": "Subscriptions",
            })

        # Entertainment (occasional)
        if random.random() < 0.1:
            amount = random.uniform(15, 80)
            cc_txns.append({
                "date": current_date,
                "amount": round(amount, 2),
                "type": TransactionType.DEBIT,
                "description": random.choice([
                    "AMC Theaters", "Concert Tickets", "Bowling Alley", "Mini Golf"
                ]),
                "category": "Entertainment",
            })

        # Credit card payment (monthly) — marked as transfer
        if current_date.day == 20:
            cc_txns.append({
                "date": current_date,
                "amount": random.uniform(800, 1500),
                "type": TransactionType.CREDIT,
                "description": "Payment - Thank You",
                "category": None,
                "is_transfer": True,
            })

        current_date += timedelta(days=1)

    # Add credit card transactions to DB
    for txn in cc_txns:
        t = Transaction(
            account_id=credit_card.id,
            date=txn["date"],
            amount=Decimal(str(round(txn["amount"], 2))),
            transaction_type=txn["type"],
            original_description=txn["description"],
            description=txn["description"],
            category_id=categories.get(txn["category"]) if txn["category"] else None,
            is_pending=False,
            is_transfer=txn.get("is_transfer", False),
        )
        db.add(t)

    # === Create Balance Snapshots for Checking Account ===

    checking_balance = 3500.00  # Starting balance a year ago
    current_date = one_year_ago.replace(day=1)
    while current_date <= today:
        # Simulate monthly balance fluctuation (salary in, bills out)
        checking_balance += random.uniform(-200, 400)
        checking_balance = max(checking_balance, 1000)  # Keep minimum balance
        snapshot = BalanceSnapshot(
            account_id=checking.id,
            snapshot_date=current_date,
            balance=Decimal(str(round(checking_balance, 2))),
            balance_type=BalanceType.SNAPSHOT,
        )
        db.add(snapshot)
        if current_date.month == 12:
            current_date = current_date.replace(year=current_date.year + 1, month=1)
        else:
            current_date = current_date.replace(month=current_date.month + 1)

    checking.current_balance = round(checking_balance, 2)

    # === Create Balance Snapshots for Credit Card ===

    cc_balance = 1200.00  # Starting balance a year ago
    current_date = one_year_ago.replace(day=1)
    while current_date <= today:
        # Credit card balance fluctuates (spending vs payments)
        cc_balance += random.uniform(-300, 400)
        cc_balance = max(cc_balance, 500)  # Minimum carried balance
        cc_balance = min(cc_balance, 3000)  # Max balance
        snapshot = BalanceSnapshot(
            account_id=credit_card.id,
            snapshot_date=current_date,
            balance=Decimal(str(round(cc_balance, 2))),
            balance_type=BalanceType.SNAPSHOT,
        )
        db.add(snapshot)
        if current_date.month == 12:
            current_date = current_date.replace(year=current_date.year + 1, month=1)
        else:
            current_date = current_date.replace(month=current_date.month + 1)

    credit_card.current_balance = round(cc_balance, 2)

    # === Create Balance Snapshots for Real Estate ===

    home_value = 410000.00
    current_date = one_year_ago.replace(day=1)
    while current_date <= today:
        # Home appreciates ~3-5% per year, with monthly fluctuation
        home_value *= (1 + random.uniform(0.002, 0.005))
        snapshot = BalanceSnapshot(
            account_id=real_estate.id,
            snapshot_date=current_date,
            balance=Decimal(str(round(home_value, 2))),
            balance_type=BalanceType.SNAPSHOT,
        )
        db.add(snapshot)
        # Move to next month
        if current_date.month == 12:
            current_date = current_date.replace(year=current_date.year + 1, month=1)
        else:
            current_date = current_date.replace(month=current_date.month + 1)

    # Update real estate current balance
    real_estate.current_balance = round(home_value, 2)

    # === Create Balance Snapshots for Mortgage ===

    mortgage_balance = 328000.00
    current_date = one_year_ago.replace(day=1)
    while current_date <= today:
        # Mortgage decreases monthly (principal payment ~$600-800/month)
        mortgage_balance -= random.uniform(600, 800)
        snapshot = BalanceSnapshot(
            account_id=mortgage.id,
            snapshot_date=current_date,
            balance=Decimal(str(round(mortgage_balance, 2))),
            balance_type=BalanceType.SNAPSHOT,
        )
        db.add(snapshot)
        if current_date.month == 12:
            current_date = current_date.replace(year=current_date.year + 1, month=1)
        else:
            current_date = current_date.replace(month=current_date.month + 1)

    mortgage.current_balance = round(mortgage_balance, 2)

    # === Create Balance Snapshots for Retirement (401k) ===

    retirement_balance = 72000.00
    current_date = one_year_ago.replace(day=1)
    while current_date <= today:
        # 401k grows with contributions (~$500/month) plus market returns
        retirement_balance += 500  # Monthly contribution
        retirement_balance *= (1 + random.uniform(-0.02, 0.04))  # Market fluctuation
        snapshot = BalanceSnapshot(
            account_id=retirement.id,
            snapshot_date=current_date,
            balance=Decimal(str(round(retirement_balance, 2))),
            balance_type=BalanceType.SNAPSHOT,
        )
        db.add(snapshot)
        if current_date.month == 12:
            current_date = current_date.replace(year=current_date.year + 1, month=1)
        else:
            current_date = current_date.replace(month=current_date.month + 1)

    retirement.current_balance = round(retirement_balance, 2)

    # === Create Balance Snapshots for Investment (Brokerage) ===

    investment_balance = 25000.00
    current_date = one_year_ago.replace(day=1)
    while current_date <= today:
        # Brokerage grows with occasional contributions plus market returns
        if random.random() < 0.3:  # ~30% chance of contribution each month
            investment_balance += random.uniform(200, 800)
        investment_balance *= (1 + random.uniform(-0.03, 0.05))  # Market fluctuation
        snapshot = BalanceSnapshot(
            account_id=investment.id,
            snapshot_date=current_date,
            balance=Decimal(str(round(investment_balance, 2))),
            balance_type=BalanceType.SNAPSHOT,
        )
        db.add(snapshot)
        if current_date.month == 12:
            current_date = current_date.replace(year=current_date.year + 1, month=1)
        else:
            current_date = current_date.replace(month=current_date.month + 1)

    investment.current_balance = round(investment_balance, 2)

    # === Create Budget Entries ===
    # Create budgets for the current month and a few previous months
    # Leave some categories without budgets so they fall into "Other"

    # Only budget key categories - the rest roll up into "Other" on the budget page
    # This keeps the demo budget page clean and realistic
    budget_categories = {
        "Salary & Wages": 6400.00,
        "Rent/Mortgage": 1800.00,
        "Groceries": 600.00,
        "Car Insurance": 150.00,
        "Restaurants": 300.00,
        "Entertainment": 100.00,
    }

    # Create budgets for current month and previous 3 months
    for month_offset in range(4):
        budget_date = today.replace(day=1)
        for _ in range(month_offset):
            if budget_date.month == 1:
                budget_date = budget_date.replace(year=budget_date.year - 1, month=12)
            else:
                budget_date = budget_date.replace(month=budget_date.month - 1)

        for cat_name, amount in budget_categories.items():
            cat_id = categories.get(cat_name)
            if cat_id:
                budget = Budget(
                    category_id=cat_id,
                    year=budget_date.year,
                    month=budget_date.month,
                    amount=Decimal(str(amount)),
                )
                db.add(budget)

    db.commit()

    txn_count = len(checking_txns) + len(cc_txns)
    budget_count = len(budget_categories) * 4
    print(f"  Done: Created 6 demo accounts with {txn_count} transactions and {budget_count} budget entries.")


def ensure_secret_key():
    """Generate a SECRET_KEY and persist it to .env if not already set."""
    import os
    import secrets
    from app.core.config import settings

    if settings.secret_key:
        return

    new_key = secrets.token_urlsafe(32)

    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            content = f.read()
        if "SECRET_KEY=" in content:
            content = content.replace("SECRET_KEY=", f"SECRET_KEY={new_key}", 1)
        else:
            content += f"\nSECRET_KEY={new_key}\n"
        with open(env_path, "w") as f:
            f.write(content)
    else:
        with open(env_path, "w") as f:
            f.write(f"SECRET_KEY={new_key}\n")

    settings.secret_key = new_key
    print(f"  Generated SECRET_KEY and saved to .env")


def init_db():
    create_tables()
    run_migrations()
    ensure_secret_key()
    db = SessionLocal()
    try:
        seed_categories(db)
        seed_demo_data(db)
    finally:
        db.close()
    print("\nDatabase initialized successfully.")


if __name__ == "__main__":
    init_db()



