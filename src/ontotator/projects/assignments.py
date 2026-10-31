"""The transactional revocation seam shared with assignment management."""

from datetime import datetime

from sqlalchemy import ColumnElement, Connection, and_, or_, select, update

from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Role
from ontotator.storage.tables import AssignmentRow, DocumentRow


def unsupported_assignments(
    conn: Connection, project_id: int, user_id: int, removed_roles: frozenset[Role]
) -> list[dict[str, object]]:
    """Lock active unsubmitted work whose task role is being removed.

    A translation review rests on the annotator role, a lead correction (FD1,
    FD2) on the lead role alone.
    """
    tasks = [
        task
        for task, role in [("annotate", "annotator"), ("review", "adjudicator")]
        if role in removed_roles
    ]
    supported: ColumnElement[bool] = AssignmentRow.task.in_(tasks)
    for role, lead_correction in (("annotator", False), ("lead", True)):
        if role in removed_roles:
            supported = or_(
                supported,
                and_(
                    AssignmentRow.task == "translation_review",
                    AssignmentRow.lead_correction.is_(lead_correction),
                ),
            )
    rows = conn.execute(
        select(
            AssignmentRow.id,
            AssignmentRow.document_id,
            AssignmentRow.task,
            DocumentRow.case_id,
            DocumentRow.language,
        )
        .join(
            DocumentRow,
            and_(
                DocumentRow.project_id == AssignmentRow.project_id,
                DocumentRow.document_id == AssignmentRow.document_id,
            ),
        )
        .where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.user_id == user_id,
            AssignmentRow.revoked_at.is_(None),
            AssignmentRow.status.in_(["open", "in_progress", "reopened"]),
            supported,
        )
        .order_by(AssignmentRow.id)
        .with_for_update(key_share=True, of=AssignmentRow)
    ).mappings()
    return [dict(row) for row in rows]


def revoke_assignments(
    conn: Connection,
    actor: Actor,
    project_id: int,
    assignments: list[dict[str, object]],
    now: datetime,
    *,
    reason: str | None = "membership",
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
                "reason": reason,
                "document_id": assignment["document_id"],
                "task": assignment["task"],
            },
            at=now,
        )
