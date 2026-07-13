"""Add cadence_override column to subscription_rules.

Lets the user force a subscription's billing cadence when the detector
infers the wrong one (e.g. two charges a month misread as biweekly).
NULL keeps the inferred cadence.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-12

"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so a database that
    # predates the subscription_rules table gets it created in the new
    # shape already; only databases holding the 0006 shape need altering.
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("subscription_rules")}
    if "cadence_override" in columns:
        return

    with op.batch_alter_table("subscription_rules") as batch:
        batch.add_column(sa.Column("cadence_override", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("subscription_rules") as batch:
        batch.drop_column("cadence_override")
