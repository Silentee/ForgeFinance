"""
init_db.py — Create/upgrade the schema and seed default data.

Runs automatically on backend startup (see app.main lifespan); can also be
run manually:
    python -m app.db.init_db

Schema changes are managed by Alembic (backend/alembic/). This module only
decides which Alembic action applies (see run_migrations) and seeds data.
"""

import random
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db.session import engine, SessionLocal, Base
from app.models import (
    Category, Account, Transaction, BalanceSnapshot, Budget,
    DEFAULT_CATEGORIES,
    AccountTypeDef, DEFAULT_ACCOUNT_TYPES,
)
from app.models.enums import AccountType, TransactionType, BalanceType

# Import all models so they're registered with Base.metadata
import app.models  # noqa: F401

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def create_tables():
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("  Tables created.")


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return cfg


def run_migrations():
    """Create or upgrade the schema via Alembic.

    - Fresh database: create_all() builds the full current schema, then the
      DB is stamped at head (no revisions need to run).
    - Pre-Alembic database: stamp the baseline revision, then upgrade so the
      later revisions (ported hand-rolled migrations + new changes) apply.
    - Alembic-managed database: plain upgrade to head.

    create_all() runs in every case — it only creates tables that don't
    exist yet, which keeps the old behavior of picking up brand-new tables
    on databases that predate their introduction.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    is_fresh = "accounts" not in existing_tables
    has_version_table = "alembic_version" in existing_tables

    create_tables()

    cfg = _alembic_config()
    if is_fresh:
        command.stamp(cfg, "head")
        print("  Fresh database stamped at Alembic head.")
    else:
        if not has_version_table:
            command.stamp(cfg, "0001")
            print("  Pre-Alembic database stamped at baseline.")
        command.upgrade(cfg, "head")
        print("  Alembic migrations up to date.")


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


def seed_account_types(db):
    """Insert the built-in account types, creating any that are missing."""
    print("  Checking default account types...")
    created = 0
    for sort_order, (key, label, is_liability, is_liquid_default) in enumerate(DEFAULT_ACCOUNT_TYPES):
        existing = db.query(AccountTypeDef).filter(AccountTypeDef.key == key).first()
        if existing is None:
            db.add(AccountTypeDef(
                key=key,
                label=label,
                is_liability=is_liability,
                is_liquid_default=is_liquid_default,
                is_system=True,
                is_hidden=False,
                sort_order=sort_order,
            ))
            created += 1
    db.commit()
    if created > 0:
        print(f"  Done: Created {created} new account types.")
    else:
        print("  Done: All default account types already present.")


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
        account_type=AccountType.CHECKING.value,
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
        account_type=AccountType.CREDIT_CARD.value,
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
        account_type=AccountType.REAL_ESTATE.value,
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
        account_type=AccountType.MORTGAGE.value,
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
        account_type=AccountType.RETIREMENT.value,
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
        account_type=AccountType.INVESTMENT.value,
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
    run_migrations()  # includes create_tables() for missing tables
    ensure_secret_key()
    db = SessionLocal()
    try:
        seed_account_types(db)
        seed_categories(db)
        seed_demo_data(db)
    finally:
        db.close()
    print("\nDatabase initialized successfully.")


if __name__ == "__main__":
    init_db()



