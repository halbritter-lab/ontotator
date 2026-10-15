"""Metadata-only document list and grouped assignment projections."""

from collections import defaultdict
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, exists, func, select

from ontocurator.api.job_routes import authorized_project
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import MODE_ACTIONS, Access, Action, Task, can
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.authz.visibility import (
    current_access,
    qualifying_assignment,
    visible_documents,
)
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.workspace import WorkspaceKey, WorkspaceMode
from ontocurator.storage.database import Database
from ontocurator.storage.repository import (
    Repository,
    _key_str,
    _local_import_key,
    _workspace_aliases,
)
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    DraftAnnotationRow,
    DraftRow,
    ReviewDecisionRow,
    SubmissionRow,
    UserRow,
)

AssignmentStatus = Literal["open", "in_progress", "submitted", "reopened"]
DocumentStatus = Literal["not_started", "in_progress", "completed"]
AssignmentFilter = Literal["unassigned", "open", "in_progress", "submitted", "reopened"]


class Assignee(BaseModel):
    assignment_id: int
    username: str
    pseudonym: str
    task: Task
    status: AssignmentStatus


class ProjectDocumentSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    language: str
    text_length: int
    position: int | None
    status: DocumentStatus = "not_started"
    has_review_inputs: bool | None = None
    assignees: list[Assignee] | None = None


def _legacy_statuses(
    db: Database,
    conn: Connection,
    key: str,
    project_id: int,
    documents: list[str],
    annotator: str,
    mode: WorkspaceMode,
) -> dict[str, DocumentStatus]:
    """Preserve origin/revision and independent-alias semantics without snapshots.

    Submission origin is the only small JSON metadata projection; annotation,
    evidence and decision payloads never cross the database connection here.
    """
    drafts = conn.execute(
        select(
            DraftRow.draft_key,
            DraftRow.document_id,
            DraftRow.scope_id,
            DraftRow.target_set_id,
            DraftRow.revision,
            DraftRow.checked_layer_ids,
            (
                exists().where(DraftAnnotationRow.draft_id == DraftRow.id)
                | exists().where(ReviewDecisionRow.draft_id == DraftRow.id)
            ).label("has_content"),
        ).where(
            DraftRow.project_id == project_id,
            DraftRow.document_id.in_(documents),
            DraftRow.annotator_id == annotator,
            DraftRow.mode == mode,
        )
    ).all()
    submissions = conn.execute(
        select(
            SubmissionRow.local_key,
            SubmissionRow.draft_revision,
            SubmissionRow.payload["origin_key"].label("origin"),
        ).where(
            SubmissionRow.project_id == project_id,
            SubmissionRow.document_id.in_(documents),
            SubmissionRow.annotator_id == annotator,
            SubmissionRow.mode == mode,
        )
    ).all()
    keys: dict[str, WorkspaceKey] = {}
    by_draft = {row.draft_key: row for row in drafts}
    for row in drafts:
        workspace = WorkspaceKey(
            project_key=key,
            document_id=row.document_id,
            annotator_id=annotator,
            mode=mode,
            scope_id=row.scope_id,
            target_set_id=row.target_set_id,
        )
        keys[_key_str(workspace)] = workspace
    # A distinct submission ID at the same full origin/revision is always a
    # conflicting immutable record, including a superseded revision.
    by_local: dict[str, list[tuple[str, int]]] = defaultdict(list)
    profile = None
    for row in submissions:
        origin = WorkspaceKey.model_validate(row.origin)
        identity = origin.model_dump_json()
        by_local[row.local_key].append((identity, row.draft_revision))
        if origin.project_key != key:
            if profile is None:
                profile = Repository(db).get_task_profile(key)
            workspace = _local_import_key(origin, key, profile)
        else:
            workspace = origin
        keys.setdefault(_key_str(workspace), workspace)
    statuses: dict[str, DocumentStatus] = {}
    for workspace in sorted(
        keys.values(),
        key=lambda workspace: (
            workspace.document_id,
            workspace.mode,
            workspace.scope_id,
            workspace.target_set_id,
        ),
    ):
        # Match the existing reader's per-document early exit: later rounds
        # (including conflicting history) are not examined after active work.
        if statuses.get(workspace.document_id) == "in_progress":
            continue
        current: dict[str, int] = {}
        revisions: set[tuple[str, int]] = set()
        for alias in _workspace_aliases(workspace):
            for origin_id, revision in by_local.get(alias, []):
                if (origin_id, revision) in revisions:
                    raise DomainError(
                        "CONFLICTING_SUBMISSION_REVISION",
                        {
                            "origin_key": WorkspaceKey.model_validate_json(
                                origin_id
                            ).model_dump(),
                            "draft_revision": revision,
                        },
                    )
                revisions.add((origin_id, revision))
                current[origin_id] = max(revision, current.get(origin_id, -1))
        draft = by_draft.get(_key_str(workspace))
        status: DocumentStatus = "not_started"
        if current:
            status = "completed"
            if draft is not None and (
                len(current) != 1 or draft.revision > next(iter(current.values()))
            ):
                status = "in_progress"
        elif draft is not None and (
            draft.revision > 0 or draft.checked_layer_ids or draft.has_content
        ):
            status = "in_progress"
        previous = statuses.get(workspace.document_id, "not_started")
        rank = {"not_started": 0, "completed": 1, "in_progress": 2}
        if rank[status] >= rank[previous]:
            statuses[workspace.document_id] = status
    return statuses


def project_documents(
    repo: Repository,
    actor: Actor,
    access: Access,
    key: str,
    *,
    annotator_id: str | None,
    mode: WorkspaceMode | None,
    language: str | None,
    status: AssignmentFilter | None,
    q: str | None,
) -> list[ProjectDocumentSummary]:
    db = repo.db
    with db.transaction() as conn:
        project_id = authorized_project(conn, key, actor, Action.VIEW_PROJECT)
        fresh = current_access(conn, access, project_id, key)
        all_documents = can(fresh, Action.VIEW_ALL_DOCUMENTS, key)
        if mode == "review" and not can(fresh, MODE_ACTIONS[mode], key):
            raise AccessDenied(
                "MODE_NOT_ALLOWED", "This mode is not allowed in this project."
            )
        annotator = fresh.pseudonym if annotator_id is None else annotator_id
        if annotator != fresh.pseudonym and not can(fresh, Action.EXPORT_ALL_WORK, key):
            raise AccessDenied(
                "IDENTITY_MISMATCH", "You can only work under your own pseudonym."
            )
        visibility = visible_documents(conn, fresh, project_id, key)
        query = select(
            DocumentRow.document_id,
            DocumentRow.language,
            DocumentRow.position,
            func.length(DocumentRow.text).label("text_length"),
        ).where(DocumentRow.project_id == project_id)
        if not visibility.all:
            query = query.where(DocumentRow.document_id.in_(visibility.document_ids))
        if language is not None:
            query = query.where(DocumentRow.language == language)
        if q is not None:
            query = query.where(DocumentRow.document_id.startswith(q, autoescape=True))
        if status is not None:
            assignments = exists().where(
                AssignmentRow.project_id == DocumentRow.project_id,
                AssignmentRow.document_id == DocumentRow.document_id,
                AssignmentRow.revoked_at.is_(None),
            )
            if not all_documents:
                assignments = assignments.where(qualifying_assignment(fresh.user_id))
            query = query.where(
                ~assignments
                if status == "unassigned"
                else assignments.where(AssignmentRow.status == status)
            )
        rows = conn.execute(
            query.order_by(DocumentRow.position.nulls_last(), DocumentRow.document_id)
        ).all()
        if not rows:
            return []
        ids = [row.document_id for row in rows]
        assignees: dict[str, list[Assignee]] = defaultdict(list)
        if all_documents:
            for row in conn.execute(
                select(
                    AssignmentRow.document_id,
                    AssignmentRow.id.label("assignment_id"),
                    AssignmentRow.task,
                    AssignmentRow.status,
                    UserRow.username,
                    UserRow.pseudonym,
                )
                .join(UserRow, UserRow.id == AssignmentRow.user_id)
                .where(
                    AssignmentRow.project_id == project_id,
                    AssignmentRow.document_id.in_(ids),
                    AssignmentRow.revoked_at.is_(None),
                )
                .order_by(UserRow.username, AssignmentRow.task, AssignmentRow.id)
            ).mappings():
                assignees[row["document_id"]].append(
                    Assignee.model_validate(
                        {name: row[name] for name in Assignee.model_fields}
                    )
                )
        statuses = (
            _legacy_statuses(db, conn, key, project_id, ids, annotator, mode)
            if mode
            else {}
        )
        review_ids = (
            ScopedRepository(db, fresh, actor).review_input_document_ids(key)
            if mode == "review"
            else set()
        )
        return [
            ProjectDocumentSummary(
                document_id=row.document_id,
                language=row.language,
                position=row.position,
                text_length=row.text_length,
                status=statuses.get(row.document_id, "not_started"),
                has_review_inputs=row.document_id in review_ids
                if mode == "review"
                else None,
                **({"assignees": assignees[row.document_id]} if all_documents else {}),
            )
            for row in rows
        ]
