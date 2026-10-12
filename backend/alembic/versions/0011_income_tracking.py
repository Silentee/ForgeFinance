"""Add earners and income_entries tables.

Gross income never appears in transactions (paychecks land as take-home
deposits), so it's recorded separately: an earner is a person in the
household, and each income entry is either a salary change (annual rate in
effect from its date until the next one) or a one-time bonus/other payment.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-12

"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so on app-managed
    # databases these tables already exist by the time the revision runs.
    # The guards keep the revision valid for standalone `alembic upgrade` too.
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "earners" not in tables:
        op.create_table(
            "earners",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("color", sa.String(length=7), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_earners_user_id_users"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_earners_id", "earners", ["id"])
        op.create_index("ix_earners_user_id", "earners", ["user_id"])

    if "income_entries" not in tables:
        op.create_table(
            "income_entries",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("earner_id", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(length=20), nullable=False),
            sa.Column("effective_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Numeric(14, 2), nullable=False),
            sa.Column("employer", sa.String(length=255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_income_entries_user_id_users"),
            sa.ForeignKeyConstraint(
                ["earner_id"], ["earners.id"],
                name="fk_income_entries_earner_id_earners", ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_income_entries_id", "income_entries", ["id"])
        op.create_index("ix_income_entries_user_id", "income_entries", ["user_id"])
        op.create_index("ix_income_entries_earner_id", "income_entries", ["earner_id"])
        op.create_index("ix_income_entries_effective_date", "income_entries", ["effective_date"])


def downgrade() -> None:
    op.drop_index("ix_income_entries_effective_date", table_name="income_entries")
    op.drop_index("ix_income_entries_earner_id", table_name="income_entries")
    op.drop_index("ix_income_entries_user_id", table_name="income_entries")
    op.drop_index("ix_income_entries_id", table_name="income_entries")
    op.drop_table("income_entries")
    op.drop_index("ix_earners_user_id", table_name="earners")
    op.drop_index("ix_earners_id", table_name="earners")
    op.drop_table("earners")
