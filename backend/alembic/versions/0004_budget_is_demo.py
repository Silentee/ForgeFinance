"""Add is_demo flag to budgets.

Demo-seeded budgets are now tagged like demo accounts so that leaving demo
mode can delete them deterministically. Previously the demo clear could only
fall back to wiping *all* budgets when no real account existed, which left the
demo budget targets behind as soon as the user had added a real account.

Existing rows are backfilled to is_demo = 0 (false).

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-06

"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("budgets") as batch:
        batch.add_column(
            sa.Column(
                "is_demo",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("budgets") as batch:
        batch.drop_column("is_demo")
