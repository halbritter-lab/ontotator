"""Proposal check: tool proposal mode, per-text override, assignment mode.

``projects.tool_proposal_mode`` is the project setting "Texts with tool
proposals" (new projects: from proposals; existing projects keep today's
annotation from scratch). ``work_plan_rows.annotation_mode`` overrides it per
text (NULL = project setting). ``assignments.annotation_mode`` fixes the mode
of an annotate assignment when it is created (spec 2026-10-23 §1 Q3).
"""

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None
SCHEMA = "ontotator"
MODES = "('proposals', 'scratch')"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "tool_proposal_mode",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'scratch'"),
        ),
        schema=SCHEMA,
    )
    op.alter_column(
        "projects",
        "tool_proposal_mode",
        server_default=sa.text("'proposals'"),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_projects_tool_proposal_mode"),
        "projects",
        f"tool_proposal_mode IN {MODES}",
        schema=SCHEMA,
    )
    op.add_column(
        "work_plan_rows",
        sa.Column("annotation_mode", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_work_plan_rows_annotation_mode"),
        "work_plan_rows",
        f"annotation_mode IN {MODES}",
        schema=SCHEMA,
    )
    op.add_column(
        "assignments",
        sa.Column("annotation_mode", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        f"UPDATE {SCHEMA}.assignments SET annotation_mode = 'scratch'"
        " WHERE task = 'annotate'"
    )
    op.create_check_constraint(
        op.f("ck_assignments_annotation_mode"),
        "assignments",
        # IS NOT NULL: a NULL IN (...) would make the check NULL, which passes.
        "(task = 'annotate' AND annotation_mode IS NOT NULL"
        f" AND annotation_mode IN {MODES})"
        " OR (task <> 'annotate' AND annotation_mode IS NULL)",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_assignments_annotation_mode"), "assignments", schema=SCHEMA
    )
    op.drop_column("assignments", "annotation_mode", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_work_plan_rows_annotation_mode"), "work_plan_rows", schema=SCHEMA
    )
    op.drop_column("work_plan_rows", "annotation_mode", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_projects_tool_proposal_mode"), "projects", schema=SCHEMA
    )
    op.drop_column("projects", "tool_proposal_mode", schema=SCHEMA)
