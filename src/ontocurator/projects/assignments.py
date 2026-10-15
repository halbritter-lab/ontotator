"""The transactional revocation seam shared with assignment management."""

from datetime import datetime

from sqlalchemy import Connection, select, update

from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Role
from ontocurator.storage.tables import AssignmentRow


def unsupported_assignments(
    conn: Connection, project_id: int, user_id: int, removed_roles: frozenset[Role]
) -> list[dict[str, object]]:
    """Lock active unsubmitted work whose task role is being removed."""
    tasks = [
        task
        for task, role in [("annotate", "annotator"), ("review", "adjudicator")]
        if role in removed_roles
    ]
    rows = conn.execute(
        select(AssignmentRow.id, AssignmentRow.document_id, AssignmentRow.task)
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.user_id == user_id,
            AssignmentRow.revoked_at.is_(None),
            AssignmentRow.status.in_(["open", "in_progress", "reopened"]),
            AssignmentRow.task.in_(tasks),
        )
        .order_by(AssignmentRow.id)
        .with_for_update(key_share=True)
    ).mappings()
    return [dict(row) for row in rows]


def revoke_assignments(
    conn: Connection,
    actor: Actor,
    project_id: int,
    assignments: list[dict[str, object]],
    now: datetime,
) -> None:
    """Revoke rows and audit each, preserving submissions and drafts."""
    for assignment in assignments:
        assignment_id = int(str(assignment["id"]))
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(revoked_at=now, revoked_by=actor.user_id, updated_at=now)
        )
        record_audit(
            conn,
            actor,
            "assignment.revoke",
            target_type="assignment",
            target_id=assignment_id,
            project_id=project_id,
            details={
                "reason": "membership",
                "document_id": assignment["document_id"],
                "task": assignment["task"],
            },
            at=now,
        )
