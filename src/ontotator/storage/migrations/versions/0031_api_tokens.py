"""API tokens for scripts and integrations (issue 305).

Purely additive: one new, empty table with its indexes and grants. No
existing table, column or row changes, so the upgrade neither rewrites nor
scans existing data. The foreign keys to ``users`` and ``projects`` take
only a brief lock on those tables while the constraints are created; no row
is checked, since the new table is empty.

Only the SHA-256 of a token is stored. The application role may revoke a
token and record its last use (UPDATE) but never delete one: the audit
trail names tokens by their id.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("token_sha256", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("owner_id", sa.BigInteger(), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("last_used_at", _ts(), nullable=True),
        sa.Column("revoked_at", _ts(), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_api_tokens"),
        sa.UniqueConstraint("token_sha256", name="uq_api_tokens_token_sha256"),
        sa.ForeignKeyConstraint(
            ["owner_id"], [f"{SCHEMA}.users.id"], name="fk_api_tokens_owner_id"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name="fk_api_tokens_project_id",
        ),
        sa.CheckConstraint(
            "kind IN ('personal', 'project', 'system')", name="ck_api_tokens_kind"
        ),
        sa.CheckConstraint(
            "(kind = 'project') = (project_id IS NOT NULL)",
            name="ck_api_tokens_project_kind",
        ),
        sa.CheckConstraint(
            "cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'import',"
            " 'export', 'project-admin', 'admin']::text[]",
            name="ck_api_tokens_scopes",
        ),
        sa.CheckConstraint(
            "kind = 'system' OR NOT ('admin' = ANY (scopes))",
            name="ck_api_tokens_admin_scope",
        ),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 100", name="ck_api_tokens_name"
        ),
        sa.CheckConstraint(
            "expires_at > created_at"
            " AND expires_at <= created_at + interval '366 days'",
            name="ck_api_tokens_lifetime",
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoked_reason IS NULL)",
            name="ck_api_tokens_revoked",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_api_tokens_owner_id_revoked_at",
        "api_tokens",
        ["owner_id", "revoked_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_api_tokens_project_id", "api_tokens", ["project_id"], schema=SCHEMA
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE ON {SCHEMA}.api_tokens TO {APP_ROLE}")
    op.execute(
        f"GRANT USAGE, SELECT ON SEQUENCE {SCHEMA}.api_tokens_id_seq TO {APP_ROLE}"
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
