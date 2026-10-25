"""Atomic contextual distribution with independent per-row domain refusals."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import func, or_, select

from ontocurator.assignments.proposals import (
    DistributionContext,
    DistributionService,
    validate_selection,
)
from ontocurator.assignments.service import Assignment, AssignmentService
from ontocurator.auth.accounts import normalize_username
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Action, Task
from ontocurator.authz.project_authority import require_project_management
from ontocurator.domain.errors import DomainError
from ontocurator.storage.database import Database
from ontocurator.storage.repository import _lock_id
from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow, UserRow


@dataclass(frozen=True)
class ConfirmationRow:
    document_id: str
    username: str


@dataclass(frozen=True)
class RefusedRow:
    document_id: str
    username: str
    code: str


@dataclass(frozen=True)
class ConfirmationOutcome:
    created: tuple[Assignment, ...]
    refused: tuple[RefusedRow, ...]


def validate_confirmation_rows(
    rows: Sequence[ConfirmationRow], context: DistributionContext
) -> None:
    """An edited table stays inside the original selection and document cap."""
    pairs = [(row.document_id, row.username.strip().lower()) for row in rows]
    if (
        any(row.document_id not in context.document_ids for row in rows)
        or len(set(pairs)) != len(pairs)
        or any(
            count > context.per_document
            for count in Counter(row.document_id for row in rows).values()
        )
    ):
        raise DomainError("DISTRIBUTION_ROWS_INVALID")


class DistributionConfirmationService:
    def __init__(self, db: Database) -> None:
        self.db = db

    def confirm(
        self,
        actor: Actor,
        key: str,
        rows: Sequence[ConfirmationRow],
        context: DistributionContext,
        *,
        task: Task,
        seed: int | None = None,
        confirm_language: bool = False,
        confirm_unreviewed_translation: bool = False,
    ) -> ConfirmationOutcome:
        if task == "review":
            raise DomainError("TASK_NOT_ASSIGNABLE", {"task": "review"})
        validate_selection(
            context.document_ids, context.task, context.per_document, context.seed
        )
        if task != context.task or (seed is not None and seed != context.seed):
            raise DomainError("DISTRIBUTION_CONTEXT_INVALID")
        validate_confirmation_rows(rows, context)
        names: dict[str, str] = {}
        invalid_names: dict[str, str] = {}
        for row in rows:
            try:
                names[row.username] = normalize_username(row.username)
            except DomainError as error:
                invalid_names[row.username] = error.code
        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
            )
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            project = (
                conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
                .mappings()
                .one_or_none()
            )
            if project is None:
                raise DomainError("PROJECT_NOT_FOUND")
            member_ids = select(ProjectMembershipRow.user_id).where(
                ProjectMembershipRow.project_id == project["id"]
            )
            # FIRST row locks are final-mode locks for the whole sorted union,
            # including self targets and nonmember edited targets. No SHARE
            # prelude, late target acquisition or per-user locking query.
            users = conn.execute(
                select(UserRow.id, UserRow.username)
                .where(
                    or_(
                        UserRow.id.in_(member_ids),
                        UserRow.id == actor.user_id,
                        UserRow.username.in_(set(names.values())),
                    )
                )
                .order_by(UserRow.id)
                .with_for_update(key_share=True)
            ).all()
            targets = {username: user_id for user_id, username in users}
            require_project_management(
                conn, actor, key, project["id"], Action.MANAGE_ASSIGNMENTS
            )
            original = DistributionService(self.db).revalidate_on(
                conn, actor, key, context
            )
            # Everything above is read-only. The server-derived original snapshot
            # and proposal are fixed before the first row can change the load.
            variants = {v.document_id: v for v in original.snapshot.variants}
            assignments = AssignmentService(self.db)
            created: list[Assignment] = []
            refused: list[RefusedRow] = []
            outcomes: list[dict[str, Any]] = []
            for row in rows:
                try:
                    # DomainError exits ONLY this SQL savepoint, never a joined
                    # Database.transaction scope. Unexpected errors abort all.
                    with conn.begin_nested():
                        if row.username in invalid_names:
                            raise DomainError(invalid_names[row.username])
                        target = targets.get(names[row.username])
                        if target is None:
                            raise DomainError("USER_NOT_FOUND")
                        assignment = assignments._assign_locked(
                            conn,
                            actor,
                            project,
                            row.document_id,
                            target,
                            task,
                            confirm_language,
                            variants=variants,
                            confirm_unreviewed_translation=(
                                confirm_unreviewed_translation
                            ),
                        )
                except DomainError as error:
                    refusal = RefusedRow(row.document_id, row.username, error.code)
                    refused.append(refusal)
                    outcomes.append(asdict(refusal))
                else:
                    created.append(assignment)
                    outcomes.append({**asdict(row), "assignment_id": assignment.id})
            record_audit(
                conn,
                actor,
                "assignment.distribute",
                target_type="project",
                target_id=key,
                project_id=project["id"],
                details={
                    "seed": original.context.seed,
                    "per_document": original.context.per_document,
                    "context": asdict(original.context),
                    "input_snapshot": original.snapshot.as_dict(),
                    "original_proposal": asdict(original.proposal),
                    "confirmed_rows": [asdict(row) for row in rows],
                    "confirm_language": confirm_language,
                    "confirm_unreviewed_translation": confirm_unreviewed_translation,
                    "outcomes": outcomes,
                },
            )
            return ConfirmationOutcome(tuple(created), tuple(refused))
