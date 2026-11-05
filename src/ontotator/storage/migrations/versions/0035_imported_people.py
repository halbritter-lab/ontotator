"""Pseudonym-only people of project archive imports (#306).

Purely additive: one new, empty table. A project archive import creates an
anonymised account for every person of the archive without a matching
account on this server and records it here, with the project and the
archive digest and the person's id on the source server (with that server's
instance id, kept in ``instance_state``), so a later archive of the same
server maps the person to the same record. An administrator can later link such a person to a real
account (``linked_user_id``); only the link columns are ever updated. No
existing table, column or row changes.
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def _user(name: str, *, nullable: bool = False) -> sa.Column[Any]:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=nullable
    )


def upgrade() -> None:
    op.create_table(
        "imported_people",
        _user("user_id"),
        sa.Column(
            "project_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.projects.id"),
            nullable=False,
        ),
        sa.Column("archive_sha256", sa.Text(), nullable=False),
        sa.Column("source_instance", sa.Text(), nullable=False),
        sa.Column("source_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        _user("linked_user_id", nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        _user("linked_by", nullable=True),
        sa.PrimaryKeyConstraint("user_id", name="pk_imported_people"),
        sa.UniqueConstraint(
            "source_instance", "source_user_id", name="uq_imported_people_source"
        ),
        schema=SCHEMA,
    )
    # The import inserts; the link sets the link columns.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.imported_people TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.drop_table("imported_people", schema=SCHEMA)
