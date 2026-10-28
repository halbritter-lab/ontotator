"""Remember the releases a project pin replaced (#81).

A started project can move to a newer release of its ontology. Annotations
submitted before carry the earlier release's digest, and a review must still
accept them as targets: ``superseded_sha256`` lists the digests this pin
pointed to before, oldest first.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"


def upgrade() -> None:
    op.add_column(
        "project_ontologies",
        sa.Column(
            "superseded_sha256",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("project_ontologies", "superseded_sha256", schema=SCHEMA)
