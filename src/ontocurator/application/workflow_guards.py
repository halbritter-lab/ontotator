"""Mutation gates shared by annotation and translation-review task paths."""

from sqlalchemy import Connection, select

from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import AssignmentRow


def require_task_writable(conn: Connection, assignment_id: int) -> None:
    row = conn.execute(
        select(AssignmentRow.held, AssignmentRow.hold_reason).where(
            AssignmentRow.id == assignment_id
        )
    ).one()
    if row.held:
        raise DomainError(
            "TASK_HELD", {"reason": row.hold_reason, "assignment_id": assignment_id}
        )
