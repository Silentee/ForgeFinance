"""Data integrity + multi-user schema prep.

- Deduplicates budgets, then enforces one budget per (category, year, month).
- Adds nullable user_id FKs to institutions/accounts/categories/budgets,
  backfilled to the sole existing user. Endpoint scoping is deferred; the
  columns exist so future multi-user support is a filter change, not a
  data migration.
- Recomputes transaction dedup hashes to include the transaction type (a
  same-day charge + refund of equal amount previously collided) and
  backfills hashes for manually created transactions that never had one.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-04

"""
import hashlib

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_USER_SCOPED_TABLES = ("institutions", "accounts", "categories", "budgets")


def upgrade() -> None:
    conn = op.get_bind()

    # --- budgets: dedupe (keep newest row) then unique constraint ---------
    conn.execute(
        sa.text(
            "DELETE FROM budgets WHERE id NOT IN ("
            "  SELECT MAX(id) FROM budgets GROUP BY category_id, year, month"
            ")"
        )
    )
    with op.batch_alter_table("budgets") as batch:
        batch.add_column(
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", name="fk_budgets_user_id_users"),
                nullable=True,
            )
        )
        batch.create_unique_constraint(
            "uq_budgets_category_period", ["category_id", "year", "month"]
        )

    # --- user_id columns on the remaining top-level tables ----------------
    for table in ("institutions", "accounts", "categories"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(
                sa.Column(
                    "user_id",
                    sa.Integer(),
                    sa.ForeignKey("users.id", name=f"fk_{table}_user_id_users"),
                    nullable=True,
                )
            )
    for table in _USER_SCOPED_TABLES:
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])

    first_user = conn.execute(sa.text("SELECT MIN(id) FROM users")).scalar()
    if first_user is not None:
        for table in _USER_SCOPED_TABLES:
            conn.execute(
                sa.text(f"UPDATE {table} SET user_id = :u WHERE user_id IS NULL"),  # noqa: S608
                {"u": first_user},
            )

    # --- recompute dedup hashes with transaction type in the key ----------
    rows = conn.execute(
        sa.text(
            "SELECT id, account_id, date, amount, transaction_type, original_description "
            "FROM transactions"
        )
    ).fetchall()
    for row in rows:
        # SAEnum stores the enum NAME ("DEBIT"/"CREDIT"); the hash uses the
        # lowercase value to match services/csv_import._compute_dedup_hash.
        type_value = (row.transaction_type or "").lower()
        desc = (row.original_description or "").strip().lower()
        key = f"{row.account_id}|{row.date}|{float(row.amount):.2f}|{type_value}|{desc}"
        digest = hashlib.sha256(key.encode()).hexdigest()
        conn.execute(
            sa.text("UPDATE transactions SET dedup_hash = :h WHERE id = :i"),
            {"h": digest, "i": row.id},
        )


def downgrade() -> None:
    for table in _USER_SCOPED_TABLES:
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            if table == "budgets":
                batch.drop_constraint("uq_budgets_category_period", type_="unique")
            batch.drop_column("user_id")
