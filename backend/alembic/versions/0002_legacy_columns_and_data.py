"""Legacy hand-rolled migrations, ported from app/db/init_db.py.

Column additions are inspector-guarded because pre-Alembic databases applied
them silently at startup — most already have them, very old ones don't.
Data fix-ups are idempotent by construction (they only touch rows that still
match the legacy shape).

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-04

"""
from datetime import datetime

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


# Legacy SAEnum columns persisted the enum *name* (e.g. "CHECKING"); account
# types are now DB-backed rows keyed by the lowercase value. Frozen copy of
# the mapping that existed at port time.
_ACCOUNT_TYPE_NAME_TO_KEY = {
    n: n.lower()
    for n in (
        "CHECKING", "SAVINGS", "HYSA", "CASH", "PRECIOUS_METAL", "INVESTMENT",
        "RETIREMENT", "HSA", "REAL_ESTATE", "VEHICLE", "OTHER_ASSET",
        "CREDIT_CARD", "MORTGAGE", "CAR_LOAN", "STUDENT_LOAN", "PERSONAL_LOAN",
        "OTHER_LIABILITY",
    )
}

# Frozen copy of the default sort orders (see models/category.py) used to
# backfill rows created before the sort_order column existed.
_DEFAULT_SORT_ORDER = {
    "Income": 0, "Essential": 1, "Utilities": 2, "Lifestyle": 3,
    "Financial": 4, "Other": 5, "Uncategorized": 6,
    "Salary & Wages": 0, "Investment Income": 1, "Refunds & Returns": 2,
    "Other Income": 3,
    "Rent/Mortgage": 0, "Property Tax": 1, "HOA": 2,
    "Home Maintenance & Repairs": 3, "Home Insurance": 4, "Car Insurance": 5,
    "Other Insurance": 6, "Groceries": 7, "Healthcare": 8, "Transportation": 9,
    "Child Care": 10, "Education": 11, "Other Essentials": 12,
    "Electric": 0, "Gas": 1, "Water": 2, "Internet & TV": 3, "Cell Phone": 4,
    "Trash": 5,
    "Restaurants": 0, "Entertainment": 1, "Shopping": 2, "Subscriptions": 3,
    "Travel": 4, "Personal Care": 5, "Child Expenses": 6, "Home Improvement": 7,
    "Taxes": 0, "Investment Contribution": 1, "Fees & Interest": 2,
    "Gifts & Donations": 3,
    "Other Expense": 0,
}


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)

    tx_cols = {c["name"] for c in insp.get_columns("transactions")}
    if "is_annualized" not in tx_cols:
        op.add_column(
            "transactions",
            sa.Column("is_annualized", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )

    cat_cols = {c["name"] for c in insp.get_columns("categories")}
    if "sort_order" not in cat_cols:
        op.add_column(
            "categories",
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        )
    if "is_hidden" not in cat_cols:
        op.add_column(
            "categories",
            sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )

    _convert_account_type_values(conn)
    _heal_category_taxonomy(conn)
    _backfill_sort_order(conn)


def downgrade() -> None:
    # Data fix-ups are not reversible; column drops are intentionally omitted.
    pass


def _convert_account_type_values(conn) -> None:
    for name, key in _ACCOUNT_TYPE_NAME_TO_KEY.items():
        conn.execute(
            sa.text("UPDATE accounts SET account_type = :key WHERE account_type = :name"),
            {"key": key, "name": name},
        )


# --- category taxonomy healing -------------------------------------------

def _get_parent_id(conn, name: str):
    return conn.execute(
        sa.text(
            "SELECT id FROM categories "
            "WHERE parent_id IS NULL AND name = :n AND is_income = 0"
        ),
        {"n": name},
    ).scalar()


def _ensure_parent(conn, name: str) -> int:
    pid = _get_parent_id(conn, name)
    if pid is None:
        now = datetime.utcnow().isoformat(sep=" ")
        conn.execute(
            sa.text(
                "INSERT INTO categories "
                "(name, is_income, is_system, is_hidden, sort_order, created_at, updated_at) "
                "VALUES (:n, 0, 1, 0, 0, :now, :now)"
            ),
            {"n": name, "now": now},
        )
        pid = _get_parent_id(conn, name)
    return pid


def _get_child_id(conn, parent_id: int, name: str):
    return conn.execute(
        sa.text("SELECT id FROM categories WHERE parent_id = :p AND name = :n"),
        {"p": parent_id, "n": name},
    ).scalar()


def _ensure_child(conn, parent_id: int, name: str) -> int:
    cid = _get_child_id(conn, parent_id, name)
    if cid is None:
        now = datetime.utcnow().isoformat(sep=" ")
        conn.execute(
            sa.text(
                "INSERT INTO categories "
                "(name, is_income, is_system, is_hidden, sort_order, parent_id, created_at, updated_at) "
                "VALUES (:n, 0, 1, 0, 0, :p, :now, :now)"
            ),
            {"n": name, "p": parent_id, "now": now},
        )
        cid = _get_child_id(conn, parent_id, name)
    return cid


def _remap_category(conn, old_id: int, new_id: int) -> None:
    conn.execute(
        sa.text("UPDATE transactions SET category_id = :new WHERE category_id = :old"),
        {"new": new_id, "old": old_id},
    )
    conn.execute(
        sa.text("UPDATE budgets SET category_id = :new WHERE category_id = :old"),
        {"new": new_id, "old": old_id},
    )


def _delete_category(conn, cat_id: int) -> None:
    conn.execute(sa.text("DELETE FROM categories WHERE id = :i"), {"i": cat_id})


def _rename_category(conn, cat_id: int, name: str) -> None:
    conn.execute(
        sa.text("UPDATE categories SET name = :n, is_system = 1 WHERE id = :i"),
        {"n": name, "i": cat_id},
    )


def _heal_category_taxonomy(conn) -> None:
    essential = _ensure_parent(conn, "Essential")
    lifestyle = _ensure_parent(conn, "Lifestyle")
    _ensure_parent(conn, "Financial")
    other = _ensure_parent(conn, "Other")

    _ensure_child(conn, lifestyle, "Home Improvement")
    _ensure_child(conn, essential, "HOA")

    # "Insurance" → "Other Insurance"
    legacy_ins = _get_child_id(conn, essential, "Insurance")
    other_ins = _get_child_id(conn, essential, "Other Insurance")
    if legacy_ins is not None and other_ins is None:
        _rename_category(conn, legacy_ins, "Other Insurance")
    elif legacy_ins is not None and other_ins is not None:
        _remap_category(conn, legacy_ins, other_ins)
        _delete_category(conn, legacy_ins)

    for name in ("Home Insurance", "Car Insurance", "Other Insurance"):
        _ensure_child(conn, essential, name)

    # "Life Insurance" merges into "Other Insurance"
    other_ins = _get_child_id(conn, essential, "Other Insurance")
    life_ins = _get_child_id(conn, essential, "Life Insurance")
    if life_ins is not None:
        if other_ins is not None:
            _remap_category(conn, life_ins, other_ins)
        _delete_category(conn, life_ins)

    # "Electricity" → "Electric"
    utilities = _ensure_parent(conn, "Utilities")
    legacy_elec = _get_child_id(conn, utilities, "Electricity")
    electric = _get_child_id(conn, utilities, "Electric")
    if legacy_elec is not None and electric is None:
        _rename_category(conn, legacy_elec, "Electric")
    elif legacy_elec is not None and electric is not None:
        _remap_category(conn, legacy_elec, electric)
        _delete_category(conn, legacy_elec)
    else:
        _ensure_child(conn, utilities, "Electric")

    # Canonicalize "Other Expense" under the "Other" parent
    candidates = conn.execute(
        sa.text(
            "SELECT id, parent_id FROM categories "
            "WHERE name = 'Other Expense' AND is_income = 0"
        )
    ).fetchall()
    canonical = next((r.id for r in candidates if r.parent_id == other), None)
    if canonical is None and candidates:
        canonical = candidates[0].id
        conn.execute(
            sa.text("UPDATE categories SET parent_id = :p, is_system = 1 WHERE id = :i"),
            {"p": other, "i": canonical},
        )
    if canonical is None:
        canonical = _ensure_child(conn, other, "Other Expense")
    for row in candidates:
        if row.id == canonical:
            continue
        _remap_category(conn, row.id, canonical)
        _delete_category(conn, row.id)


def _backfill_sort_order(conn) -> None:
    for name, order in _DEFAULT_SORT_ORDER.items():
        if order == 0:
            continue  # rows already default to 0
        conn.execute(
            sa.text(
                "UPDATE categories SET sort_order = :o "
                "WHERE name = :n AND sort_order = 0"
            ),
            {"o": order, "n": name},
        )
