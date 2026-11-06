"""Record the proposal set a proposal-check round works on (issue 337).

Purely additive: ``work_rounds.proposal_set_id`` (nullable, no default), a
foreign key to ``proposal_sets.id``. PostgreSQL adds a nullable column
without rewriting the table; the foreign key is created ``NOT VALID`` and
then validated, which only scans existing rows (all NULL) under a light
lock. Existing rounds keep NULL: which set they started with was never
recorded. A round on seed proposals without an imported set also has NULL.

Follows 0036 (API tokens).
"""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "work_rounds",
        sa.Column("proposal_set_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_work_rounds_proposal_set_id",
        "work_rounds",
        "proposal_sets",
        ["proposal_set_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        postgresql_not_valid=True,
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.work_rounds"
        " VALIDATE CONSTRAINT fk_work_rounds_proposal_set_id"
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_work_rounds_proposal_set_id",
        "work_rounds",
        schema=SCHEMA,
        type_="foreignkey",
    )
    op.drop_column("work_rounds", "proposal_set_id", schema=SCHEMA)
