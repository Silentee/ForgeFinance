"""Add a category override to subscription rules.

A subscription's category is derived from the dominant category of its
charges, so a manually added subscription with no transactions attached had
no category at all — it could only ever match the report's "Uncategorized"
filter bucket. category_id lets the user pin one explicitly.

Nullable with no backfill: every existing row keeps deriving its category
from charges, which is its current behavior. The override wins over the
derived value wherever it is set, so it also applies to a manual entry that
later collects charges.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-05

"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so a database that
    # predates the subscription_rules table gets it created in the new
    # shape already; only databases holding the 0009 shape need altering.
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("subscription_rules")}
    if "category_id" in columns:
        return

    with op.batch_alter_table("subscription_rules") as batch:
        batch.add_column(sa.Column("category_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_subscription_rules_category_id", "categories", ["category_id"], ["id"]
        )
    op.create_index(
        "ix_subscription_rules_category_id", "subscription_rules", ["category_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_subscription_rules_category_id", table_name="subscription_rules")
    with op.batch_alter_table("subscription_rules") as batch:
        batch.drop_constraint("fk_subscription_rules_category_id", type_="foreignkey")
        batch.drop_column("category_id")
