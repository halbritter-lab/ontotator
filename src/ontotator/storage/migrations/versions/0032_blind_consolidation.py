"""Hide annotator names during consolidation (issue 302).

Purely additive: ``projects.blind_consolidation`` (``NOT NULL DEFAULT
false``; a constant default, so PostgreSQL adds it without rewriting the
table and every existing project keeps showing names). No existing row
changes. The downgrade drops the column.

Follows 0031 (working time).
"""

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "blind_consolidation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("projects", "blind_consolidation", schema=SCHEMA)
