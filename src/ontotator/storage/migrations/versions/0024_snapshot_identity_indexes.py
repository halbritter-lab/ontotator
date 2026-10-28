"""Index snapshot identities across projects.

Import verification looks up ``(annotation_id, version)`` and
``(evidence_id, version)`` of every project; the primary keys start with
``project_id``, so without these indexes each lookup scans the whole table.
"""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
INDEXES = (
    ("annotation_snapshots", "annotation_id"),
    ("evidence_snapshots", "evidence_id"),
)


def upgrade() -> None:
    for table, column in INDEXES:
        op.create_index(
            f"ix_{table}_{column}_version", table, [column, "version"], schema=SCHEMA
        )


def downgrade() -> None:
    for table, column in INDEXES:
        op.drop_index(f"ix_{table}_{column}_version", table, schema=SCHEMA)
