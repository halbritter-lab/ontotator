"""Technical problem reports to the system administrators (#259).

Purely additive: one new, empty table with its indexes and grants. No
existing table, column or row changes, so the upgrade neither rewrites nor
scans existing data. The foreign keys to ``users`` take only a brief lock on
that table while the constraint is created; no row is checked, since the new
table is empty.
"""

from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
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
        "technical_reports",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        _user("reporter_id"),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("app_version", sa.Text(), nullable=False),
        sa.Column("app_revision", sa.Text(), nullable=True),
        sa.Column("route", sa.Text(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("viewport", sa.Text(), nullable=True),
        sa.Column("last_error_status", sa.Integer(), nullable=True),
        sa.Column("last_error_code", sa.Text(), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("crash_message", sa.Text(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        _user("closed_by", nullable=True),
        sa.CheckConstraint("status IN ('open', 'done')", name="status"),
        sa.CheckConstraint(
            "(status = 'done') = (closed_at IS NOT NULL)", name="closed_when_done"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_technical_reports_reporter_id_request_id",
        "technical_reports",
        ["reporter_id", "request_id"],
        unique=True,
        schema=SCHEMA,
    )
    op.create_index(
        "ix_technical_reports_status_created_at",
        "technical_reports",
        ["status", "created_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_technical_reports_reporter_id_created_at",
        "technical_reports",
        ["reporter_id", "created_at"],
        schema=SCHEMA,
    )
    # Close and reopen update the status; erasure clears the browser.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.technical_reports TO {APP_ROLE}"
    )
    op.execute(
        f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.technical_reports_id_seq"
        f" TO {APP_ROLE}"
    )


def downgrade() -> None:
    op.drop_table("technical_reports", schema=SCHEMA)
