"""Identity: users, credentials, sessions, codes, login attempts and audit events.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SCHEMA = "ontotator"
APP_ROLE = "ontotator_app"
MUTABLE = (
    "users",
    "password_credentials",
    "sessions",
    "one_time_codes",
    "login_attempts",
    "user_preferences",
    "instance_state",
)


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(astext_type=sa.Text())


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def _id() -> sa.Column[int]:
    return sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False)


def _user_fk(table: str, column: str = "user_id") -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], [f"{SCHEMA}.users.id"], name=f"fk_{table}_{column}"
    )


def upgrade() -> None:
    # Pseudonyms ann-0001, ann-0002, ... (one per user, used in every project).
    op.execute(f"CREATE SEQUENCE {SCHEMA}.pseudonym_seq")

    op.create_table(
        "users",
        _id(),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("pseudonym", sa.Text(), nullable=False),
        sa.Column("orcid", sa.Text(), nullable=True),
        sa.Column(
            "orcid_consent",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "is_system_admin",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "credential_generation",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_users_username"),
        sa.UniqueConstraint("pseudonym", name="uq_users_pseudonym"),
        schema=SCHEMA,
    )
    op.create_table(
        "password_credentials",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("changed_at", _ts(), server_default=sa.func.now(), nullable=False),
        _user_fk("password_credentials"),
        sa.PrimaryKeyConstraint("user_id", name="pk_password_credentials"),
        schema=SCHEMA,
    )
    op.create_table(
        "sessions",
        _id(),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_sha256", sa.Text(), nullable=False),
        sa.Column("csrf_token", sa.Text(), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", _ts(), nullable=False),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("revoked_at", _ts(), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.Column("client_ip", sa.Text(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        _user_fk("sessions"),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.UniqueConstraint("token_sha256", name="uq_sessions_token_sha256"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_sessions_user_id_revoked_at",
        "sessions",
        ["user_id", "revoked_at"],
        schema=SCHEMA,
    )
    op.create_table(
        "one_time_codes",
        _id(),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("code_sha256", sa.Text(), nullable=False),
        sa.Column("issued_by", sa.BigInteger(), nullable=True),
        sa.Column("credential_generation", sa.Integer(), nullable=False),
        sa.Column("created_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("used_at", _ts(), nullable=True),
        _user_fk("one_time_codes"),
        _user_fk("one_time_codes", "issued_by"),
        sa.PrimaryKeyConstraint("id", name="pk_one_time_codes"),
        sa.UniqueConstraint("code_sha256", name="uq_one_time_codes_code_sha256"),
        sa.CheckConstraint(
            "purpose IN ('setup', 'reset')", name="ck_one_time_codes_purpose"
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "login_attempts",
        _id(),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("client_ip", sa.Text(), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        # Refused because of a lock: recorded, but not counted towards one.
        sa.Column(
            "throttled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("at", _ts(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_login_attempts"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_login_attempts_username_at",
        "login_attempts",
        ["username", "at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_login_attempts_client_ip_at",
        "login_attempts",
        ["client_ip", "at"],
        schema=SCHEMA,
    )
    op.create_table(
        "audit_events",
        _id(),
        sa.Column("at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_label", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("target_type", sa.Text(), nullable=False),
        sa.Column("target_id", sa.Text(), nullable=False),
        sa.Column("project_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "details",
            _jsonb(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        _user_fk("audit_events", "actor_user_id"),
        sa.ForeignKeyConstraint(
            ["project_id"],
            [f"{SCHEMA}.projects.id"],
            name="fk_audit_events_project_id",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_audit_events_project_id_at",
        "audit_events",
        ["project_id", "at"],
        schema=SCHEMA,
    )
    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("preferences", _jsonb(), nullable=False),
        _user_fk("user_preferences"),
        sa.PrimaryKeyConstraint("user_id", name="pk_user_preferences"),
        schema=SCHEMA,
    )
    op.create_table(
        "instance_state",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", _jsonb(), nullable=False),
        sa.Column("updated_at", _ts(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("key", name="pk_instance_state"),
        schema=SCHEMA,
    )

    # The audit trail is history: the same triggers as in 0001.
    op.execute(
        f"CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE"
        f" ON {SCHEMA}.audit_events"
        f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )
    op.execute(
        f"CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE"
        f" ON {SCHEMA}.audit_events"
        f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()"
    )

    for table in MUTABLE:
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{table} TO {APP_ROLE}"
        )
    op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.audit_events TO {APP_ROLE}")
    # New sequences (pseudonym_seq and the identity sequences) need the grant again.
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
