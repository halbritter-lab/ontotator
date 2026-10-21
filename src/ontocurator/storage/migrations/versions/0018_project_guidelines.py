"""Versioned project guidelines and the version stamp on results (spec G18).

Creates ``guideline_versions`` and ``guideline_withdrawals`` (append-only),
``guideline_contents`` (deletable by a withdrawal) and ``guideline_reads``
(mutable), adds the nullable ``guideline_version`` stamp to ``submissions``
and ``translation_reviews`` and drops ``projects.guideline_url`` and
``projects.guideline_version`` without converting them (no data exists).
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"
APPEND_ONLY = ("guideline_versions", "guideline_withdrawals")
STAMPED = ("submissions", "translation_reviews")


def _project_fk() -> sa.Column[Any]:
    return sa.Column(
        "project_id",
        sa.BigInteger(),
        sa.ForeignKey(f"{SCHEMA}.projects.id"),
        primary_key=True,
    )


def _user_fk(name: str, *, primary_key: bool = False) -> sa.Column[Any]:
    return sa.Column(
        name,
        sa.BigInteger(),
        sa.ForeignKey(f"{SCHEMA}.users.id"),
        nullable=False,
        primary_key=primary_key,
    )


def _now(name: str) -> sa.Column[Any]:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _version_key() -> tuple[sa.Column[Any], sa.Column[Any]]:
    return (
        sa.Column("project_id", sa.BigInteger(), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
    )


def _version_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["project_id", "version"],
        [
            f"{SCHEMA}.guideline_versions.project_id",
            f"{SCHEMA}.guideline_versions.version",
        ],
    )


def upgrade() -> None:
    op.create_table(
        "guideline_versions",
        _project_fk(),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("body_sha256", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        _user_fk("created_by"),
        sa.Column("created_by_label", sa.Text(), nullable=False),
        _now("created_at"),
        sa.CheckConstraint("version >= 1", name="version"),
        sa.CheckConstraint("kind IN ('markdown', 'text')", name="kind"),
        sa.CheckConstraint("size_bytes <= 262144", name="size_bytes"),
        schema=SCHEMA,
    )
    op.create_table(
        "guideline_contents",
        *_version_key(),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("change_note", sa.Text(), nullable=True),
        _version_fk(),
        sa.CheckConstraint("char_length(change_note) <= 280", name="change_note"),
        schema=SCHEMA,
    )
    op.create_table(
        "guideline_withdrawals",
        *_version_key(),
        sa.Column("reason", sa.Text(), nullable=True),
        _user_fk("withdrawn_by"),
        sa.Column("withdrawn_by_label", sa.Text(), nullable=False),
        _now("withdrawn_at"),
        _version_fk(),
        sa.CheckConstraint("char_length(reason) <= 280", name="reason"),
        schema=SCHEMA,
    )
    op.create_table(
        "guideline_reads",
        *_version_key(),
        _user_fk("user_id", primary_key=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        _version_fk(),
        schema=SCHEMA,
    )

    # History: the same triggers and grants as the other append-only tables.
    for name in APPEND_ONLY:
        op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.{name} TO {APP_ROLE}")
        op.execute(
            f"CREATE TRIGGER {name}_append_only BEFORE UPDATE OR DELETE"
            f" ON {SCHEMA}.{name}"
            f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
        op.execute(
            f"CREATE TRIGGER {name}_no_truncate BEFORE TRUNCATE"
            f" ON {SCHEMA}.{name}"
            f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
        )
    # Contents are never updated; a withdrawal deletes them.
    op.execute(
        f"GRANT SELECT, INSERT, DELETE ON {SCHEMA}.guideline_contents TO {APP_ROLE}"
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.guideline_reads TO {APP_ROLE}"
    )

    # Nullable columns added by the owner; the append-only triggers of these
    # tables fire on row changes only.
    for table in STAMPED:
        op.add_column(
            table,
            sa.Column("guideline_version", sa.Integer(), nullable=True),
            schema=SCHEMA,
        )
        op.create_foreign_key(
            f"fk_{table}_project_id_guideline_version",
            table,
            "guideline_versions",
            ["project_id", "guideline_version"],
            ["project_id", "version"],
            source_schema=SCHEMA,
            referent_schema=SCHEMA,
        )

    op.drop_column("projects", "guideline_url", schema=SCHEMA)
    op.drop_column("projects", "guideline_version", schema=SCHEMA)


def downgrade() -> None:
    """Re-add the old project fields empty and drop the guideline schema.

    Every uploaded guideline text, withdrawal and read record is lost, and the
    version stamps of submissions and translation reviews are dropped.
    """
    op.add_column(
        "projects",
        sa.Column("guideline_url", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "projects",
        sa.Column("guideline_version", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    for table in STAMPED:
        op.drop_constraint(
            f"fk_{table}_project_id_guideline_version",
            table,
            type_="foreignkey",
            schema=SCHEMA,
        )
        op.drop_column(table, "guideline_version", schema=SCHEMA)
    for name in (
        "guideline_reads",
        "guideline_withdrawals",
        "guideline_contents",
        "guideline_versions",
    ):
        op.drop_table(name, schema=SCHEMA)
