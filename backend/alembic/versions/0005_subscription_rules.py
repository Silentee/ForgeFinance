"""Add subscription_rules table.

Per-merchant include/exclude overrides for the subscription report.
Auto-detection groups transactions by a normalized merchant key; a rule row
persists the user's decision to dismiss a detected merchant (exclude) or to
force-track one the heuristics missed (include).

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-12

"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so on app-managed
    # databases this table already exists by the time the revision runs.
    # The guard keeps the revision valid for standalone `alembic upgrade` too.
    inspector = sa.inspect(op.get_bind())
    if "subscription_rules" in inspector.get_table_names():
        return

    op.create_table(
        "subscription_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("merchant_key", sa.String(length=255), nullable=False),
        sa.Column("rule", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_subscription_rules_user_id_users"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "merchant_key", name="uq_subscription_rules_user_merchant"),
    )
    op.create_index("ix_subscription_rules_id", "subscription_rules", ["id"])
    op.create_index("ix_subscription_rules_user_id", "subscription_rules", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_subscription_rules_user_id", table_name="subscription_rules")
    op.drop_index("ix_subscription_rules_id", table_name="subscription_rules")
    op.drop_table("subscription_rules")
