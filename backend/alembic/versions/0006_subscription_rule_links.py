"""Add nickname/alias columns to subscription_rules.

Lets the user rename a subscription (nickname) and link merchant keys
together (alias_of points at the canonical key) so charge series from
drifting descriptors merge into one subscription row. A rule row may now
exist only to carry a nickname or alias, so `rule` becomes nullable.

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-12

"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so a database that
    # predates the subscription_rules table gets it created in the new
    # shape already; only databases holding the 0005 shape need altering.
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("subscription_rules")}
    if "nickname" in columns:
        return

    with op.batch_alter_table("subscription_rules") as batch:
        batch.add_column(sa.Column("nickname", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("alias_of", sa.String(length=255), nullable=True))
        batch.alter_column("rule", existing_type=sa.String(length=20), nullable=True)


def downgrade() -> None:
    # Rows carrying only a nickname/alias can't survive rule NOT NULL.
    op.execute("DELETE FROM subscription_rules WHERE rule IS NULL")
    with op.batch_alter_table("subscription_rules") as batch:
        batch.alter_column("rule", existing_type=sa.String(length=20), nullable=False)
        batch.drop_column("alias_of")
        batch.drop_column("nickname")
