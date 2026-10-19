"""Round navigation and exact-input transitions."""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from ontocurator.api.identity import PrincipalDep, own_key
from ontocurator.api.routes import (
    OpenWorkspaceResponse,
    WorkspaceSvcDep,
    decode_workspace_id,
    encode_workspace_id,
    get_access,
    get_repo,
)
from ontocurator.application.round_reads import (
    enrich_inputs,
    enrich_rounds,
    enrich_sources,
)
from ontocurator.application.work_rounds import (
    RoundInputResolutionService,
    WorkRoundService,
)
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action, can
from ontocurator.domain.errors import DomainError
from ontocurator.domain.work_rounds import RoundInputView, RoundKind, WorkRoundView
from ontocurator.domain.workspace import Draft, MutationEnvelope
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import ProjectRow
from ontocurator.storage.workflow_tables import WorkRoundRow

router = APIRouter(prefix="/api/v1", tags=["work-rounds"])


class CreateRoundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    expected_workflow_revision: int = Field(ge=0)
    kind: RoundKind = "ordinary"
    source_submission_ids: list[str] = Field(default_factory=list)
    reason: str | None = None


@router.post("/assignments/{assignment_id}/rounds")
def create_round(
    assignment_id: int,
    body: CreateRoundRequest,
    request: Request,
    principal: PrincipalDep,
) -> WorkRoundView:
    created = WorkRoundService(request.app.state.repo.db).create(
        get_access(request),
        Actor.user(principal.user_id, principal.username),
        assignment_id,
        **body.model_dump(),
    )
    # The service authorized the caller for this round; re-read it unscoped and
    # enrich it in one snapshot so the answer shows one committed state.
    repo = get_repo(request)
    with repo.db.snapshot():
        stored = Repository(repo.db).get_work_round(
            created.project_key, created.round_id
        )
        [view] = enrich_rounds(repo, created.project_key, [stored])
    return view


@router.get("/assignments/{assignment_id}/rounds")
def list_rounds(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> list[WorkRoundView]:
    repo = get_repo(request)
    # One snapshot: the round views and their facts show one committed state.
    with repo.db.snapshot() as conn:
        assignment = AssignmentService._get(conn, assignment_id)
        if assignment.user_id != principal.user_id and not can(
            get_access(request), Action.MANAGE_ASSIGNMENTS, assignment.project_key
        ):
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        ids = (
            conn.execute(
                select(WorkRoundRow.round_id)
                .where(WorkRoundRow.assignment_id == assignment_id)
                .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
            )
            .scalars()
            .all()
        )
        views = [repo.get_work_round(assignment.project_key, rid) for rid in ids]
        return enrich_rounds(repo, assignment.project_key, views)


@router.post("/rounds/{round_id}/open")
def open_round(
    round_id: str, request: Request, principal: PrincipalDep, ws_svc: WorkspaceSvcDep
) -> OpenWorkspaceResponse:
    repo = get_repo(request)
    with repo.db.transaction() as conn:
        project = conn.execute(
            select(ProjectRow.project_key)
            .join(WorkRoundRow, WorkRoundRow.project_id == ProjectRow.id)
            .where(WorkRoundRow.round_id == round_id)
        ).scalar_one_or_none()
    if project is None:
        raise DomainError("ROUND_NOT_FOUND")
    item = repo.get_work_round(project, round_id)
    if item.workspace_key is None:
        raise DomainError("ROUND_KIND_INVALID")
    own_key(principal, item.workspace_key)
    view = ws_svc.open(item.workspace_key)
    with repo.db.transaction() as conn:
        assignment = AssignmentService._get(conn, item.assignment_id)
    return OpenWorkspaceResponse(
        workspace_id=encode_workspace_id(view.key),
        view=view,
        read_only=assignment.held or not item.active or item.state != "editable",
    )


@router.get("/rounds/{round_id}/inputs")
def round_inputs(
    round_id: str, request: Request, principal: PrincipalDep
) -> list[RoundInputView]:
    repo = get_repo(request)
    # One snapshot: the inventory and its facts show one committed state.
    with repo.db.snapshot() as conn:
        project = conn.execute(
            select(ProjectRow.project_key)
            .join(WorkRoundRow, WorkRoundRow.project_id == ProjectRow.id)
            .where(WorkRoundRow.round_id == round_id)
        ).scalar_one_or_none()
        if project is None:
            raise DomainError("ROUND_NOT_FOUND")
        # The scoped inventory read runs the owner-or-EXPORT_ALL_WORK check
        # first; enrichment only looks up the submissions these items name.
        return enrich_inputs(
            repo, project, repo.get_round_input_inventory(project, round_id)
        )


@router.post("/workspaces/{workspace_id}/round-input-resolutions")
def resolve_input(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    key = own_key(principal, decode_workspace_id(workspace_id))
    return RoundInputResolutionService(get_repo(request)).resolve(key, envelope)


@router.post("/workspaces/{workspace_id}/round-input-resolutions/clear")
def clear_input(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    """Reset a carried input to unresolved; restores a finding its dismissal removed."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return RoundInputResolutionService(get_repo(request)).clear(key, envelope)


class RoundSourceView(BaseModel):
    submission_id: str
    document_id: str
    language: str
    version: int
    created_at: str  # client-supplied; kept for compatibility, use recorded_at
    round_id: str | None = None
    round_ordinal: int | None = None
    recorded_at: datetime | None = None
    finding_count: int = 0


@router.get("/assignments/{assignment_id}/round-sources")
def round_sources(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> list[RoundSourceView]:
    from ontocurator.authz.visibility import current_access, require_document
    from ontocurator.storage.tables import AssignmentRow

    repo = Repository(request.app.state.repo.db)
    # One snapshot: the sources and their facts show one committed state.
    with repo.db.snapshot() as conn:
        assignment = AssignmentService._get(conn, assignment_id)
        pid = repo._require_project(conn, assignment.project_key)
        fresh = current_access(conn, get_access(request), pid, assignment.project_key)
        require_document(
            conn, fresh, pid, assignment.project_key, assignment.document_id
        )
        if assignment.user_id != principal.user_id and not can(
            fresh, Action.MANAGE_ASSIGNMENTS, assignment.project_key
        ):
            raise DomainError("ASSIGNMENT_NOT_FOUND")
        if assignment.task != "annotate":
            return []
        variants = {
            v.document_id: v for v in repo.list_variants(assignment.project_key)
        }
        current = variants[assignment.document_id]
        allowed = {current.document_id}
        while current.origin == "correction" and current.derived_from in variants:
            previous = variants[current.derived_from]
            if previous.document_id in allowed or (
                previous.case_id,
                previous.external_id,
                previous.language,
                previous.version + 1,
            ) != (
                current.case_id,
                current.external_id,
                current.language,
                current.version,
            ):
                break
            allowed.add(previous.document_id)
            current = previous
        sids = (
            conn.execute(
                select(AssignmentRow.last_submission_id).where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.user_id == assignment.user_id,
                    AssignmentRow.task == "annotate",
                    AssignmentRow.document_id.in_(allowed),
                    AssignmentRow.last_submission_id.is_not(None),
                )
            )
            .scalars()
            .all()
        )
        result = []
        for sid in sids:
            assert sid is not None
            submission = repo.get_submission(sid, assignment.project_key)
            if submission is None or submission.origin_key.mode != "independent":
                continue
            item = repo.get_round_for_submission(assignment.project_key, sid)
            if item and (
                not item.active
                or item.state == "abandoned"
                or item.latest_submission_id != sid
            ):
                continue
            variant = variants[submission.origin_key.document_id]
            result.append(
                RoundSourceView(
                    submission_id=sid,
                    document_id=variant.document_id,
                    language=variant.language,
                    version=variant.version,
                    created_at=submission.created_at,
                    round_id=item.round_id if item else None,
                )
            )
        facts = enrich_sources(
            repo, assignment.project_key, [r.submission_id for r in result]
        )
    result = [
        item.model_copy(update=fact) for item, fact in zip(result, facts, strict=True)
    ]
    return sorted(
        result, key=lambda item: (item.version, item.submission_id), reverse=True
    )


@router.post("/workspaces/{workspace_id}/merge-inputs")
def merge_inputs(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    principal: PrincipalDep,
) -> Draft:
    from ontocurator.application.work_rounds import MergeRoundInputsService

    key = own_key(principal, decode_workspace_id(workspace_id))
    return MergeRoundInputsService(get_repo(request)).merge(key, envelope)
