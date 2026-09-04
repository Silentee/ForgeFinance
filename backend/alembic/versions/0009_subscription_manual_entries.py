"""Add status override and manual-entry detail to subscription rules.

The subscriptions report derives everything from charges, so a subscription
with no transactions could not be tracked and its active/lapsed status could
not be corrected. Three nullable columns fix both:

- status_override pins the reported status to 'active' or 'inactive';
  NULL keeps the existing last-charge-date heuristic.
- manual_amount and manual_start_date carry a manually entered
  subscription's cost and billing anchor. They are only populated on manual
  entries — rows whose merchant_key is the synthetic 'manual:<hex>' — and
  stay NULL on rules that merely override a detected merchant.

All three are nullable with no backfill: every existing row keeps auto
status and carries no manual detail, which is its current behavior.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-03

"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so a database that
    # predates the subscription_rules table gets it created in the new
    # shape already; only databases holding the 0007 shape need altering.
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("subscription_rules")}
    if "status_override" in columns:
        return

    with op.batch_alter_table("subscription_rules") as batch:
        batch.add_column(sa.Column("status_override", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("manual_amount", sa.Numeric(14, 2), nullable=True))
        batch.add_column(sa.Column("manual_start_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("subscription_rules") as batch:
        batch.drop_column("manual_start_date")
        batch.drop_column("manual_amount")
        batch.drop_column("status_override")
