"""Practice projects without their owner's name (issue 280).

Practice projects were named ``Practice · <display name>``, and the
``project.create`` audit entry kept that name in ``details.name``. The
entry outlives the project and the anonymisation of the account, so the name
stayed in the audit trail. New practice projects are all called
``Practice project``. This revision gives existing practice projects that
name and rewrites ``details.name`` of the ``project.create`` entries marked
``practice`` (live practice projects and deleted ones alike) to it.

The audit trail stays append-only: the rewrite runs inside the erasure window
of migration 0022 (``ontotator.erasure = on`` for this transaction only),
which lets an UPDATE through and nothing else. No other column and no entry
of a real project changes. Forward-only: the old names are gone.
"""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
NAME = "Practice project"


def upgrade() -> None:
    op.execute(
        f"UPDATE {SCHEMA}.projects SET name = '{NAME}'"
        f" WHERE practice AND name <> '{NAME}'"
    )
    op.execute("SELECT set_config('ontotator.erasure', 'on', true)")
    op.execute(
        f"UPDATE {SCHEMA}.audit_events"
        f" SET details = details || jsonb_build_object('name', '{NAME}')"
        " WHERE action = 'project.create'"
        " AND details ->> 'practice' = 'true'"
        " AND details ? 'name'"
        f" AND details ->> 'name' IS DISTINCT FROM '{NAME}'"
    )
    op.execute("SELECT set_config('ontotator.erasure', '', true)")


def downgrade() -> None:
    raise NotImplementedError("Migrations are forward-only (T2 index D-d)")
