"""Baseline — marks the schema as it existed before Alembic adoption.

This revision is intentionally empty. Fresh databases are created with
Base.metadata.create_all() and stamped at head; pre-Alembic databases are
stamped at this revision and then upgraded so the later revisions apply.

Revision ID: 0001
Revises:
Create Date: 2026-07-04

"""

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
