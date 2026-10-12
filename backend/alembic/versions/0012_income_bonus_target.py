"""Add target bonus % and performance year to income entries.

Annual bonuses are set as a target % of base, so the target travels with
the salary entry (target_bonus_pct) and steps with it. Each annual bonus
payment records the performance year it pays out for (bonus_year), so it can
be compared against that year's target even though it's paid the next year.

Existing bonus rows are backfilled to the year before they were paid, which
is when annual bonuses are normally paid out.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-12

"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # init_db() runs create_all() before upgrading, so a database that
    # predates income_entries gets it created in the new shape already;
    # only databases holding the 0011 shape need altering.
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("income_entries")}
    new_columns = [
        sa.Column("target_bonus_pct", sa.Numeric(6, 2), nullable=True),
        sa.Column("bonus_year", sa.Integer(), nullable=True),
    ]
    missing = [c for c in new_columns if c.name not in columns]

    if missing:
        with op.batch_alter_table("income_entries") as batch:
            for column in missing:
                batch.add_column(column)

    op.execute(
        "UPDATE income_entries "
        "SET bonus_year = CAST(strftime('%Y', effective_date) AS INTEGER) - 1 "
        "WHERE kind = 'bonus' AND bonus_year IS NULL"
    )


def downgrade() -> None:
    with op.batch_alter_table("income_entries") as batch:
        batch.drop_column("bonus_year")
        batch.drop_column("target_bonus_pct")
