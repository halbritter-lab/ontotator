"""Account erasure (GDPR Art. 17): an anonymised marker and audit redaction.

``users.anonymised_at`` marks an erased account. ``audit_events`` gains
``target_user_id``, backfilled from the current usernames (accounts were
never renamed or deleted before this revision, so the match is exact): a
person's history follows the account, not a reusable name. The audit trail stays
append-only, except that an UPDATE is let through inside a transaction that
set ``SET LOCAL ontocurator.erasure = on``: the erasure rewrites the erased
person's username in their audit rows to ``anonymised-<id>``. DELETE and
TRUNCATE stay forbidden. The username prefix ``anonymised-`` is reserved; an
installation with such a user is refused, so an operator renames it first.
"""

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None
SCHEMA = "ontocurator"
APP_ROLE = "ontocurator_app"


def upgrade() -> None:
    taken = (
        op.get_bind()
        .execute(
            sa.text(
                f"SELECT username FROM {SCHEMA}.users"
                " WHERE username LIKE 'anonymised-%' ORDER BY username"
            )
        )
        .scalars()
        .all()
    )
    if taken:
        raise RuntimeError(
            "Usernames starting with 'anonymised-' are reserved for erased accounts."
            f" Rename these users before upgrading: {', '.join(taken)}"
        )
    op.add_column(
        "users",
        sa.Column("anonymised_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "audit_events",
        sa.Column("target_user_id", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_audit_events_target_user_id",
        "audit_events",
        "users",
        ["target_user_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
    )
    op.create_index(
        "ix_audit_events_target_user_id",
        "audit_events",
        ["target_user_id"],
        schema=SCHEMA,
    )
    # The backfill runs before the trigger allows any update: disable it briefly.
    op.execute(
        f"ALTER TABLE {SCHEMA}.audit_events DISABLE TRIGGER audit_events_append_only"
    )
    op.execute(
        f"UPDATE {SCHEMA}.audit_events a SET target_user_id = u.id"
        f" FROM {SCHEMA}.users u"
        f" WHERE a.target_type = 'user' AND a.target_id = u.username"
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.audit_events ENABLE TRIGGER audit_events_append_only"
    )
    op.execute(
        f"""
        CREATE FUNCTION {SCHEMA}.forbid_audit_change() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'UPDATE'
             AND current_setting('ontocurator.erasure', true) = 'on' THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'ontocurator: % on %.% is not allowed, the table is append-only',
            TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
            USING ERRCODE = '42501';
        END
        $$
        """
    )
    op.execute(f"DROP TRIGGER audit_events_append_only ON {SCHEMA}.audit_events")
    op.execute(
        f"CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE"
        f" ON {SCHEMA}.audit_events"
        f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_audit_change()"
    )
    op.execute(
        f"GRANT UPDATE (actor_label, target_id, details)"
        f" ON {SCHEMA}.audit_events TO {APP_ROLE}"
    )


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
