"""Add track_transactions flag to accounts.

Accounts that only carry a balance (a house, a 401k, a car loan) never receive
imported or manually filed transactions. This flag lets the user hide those
accounts from the transaction-import picker and the transaction account filter
without deactivating them.

Existing rows are backfilled to track_transactions = 1 (true), preserving the
current behavior where every account appears in those pickers.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-03

"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch:
        batch.add_column(
            sa.Column(
                "track_transactions",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("accounts") as batch:
        batch.drop_column("track_transactions")
