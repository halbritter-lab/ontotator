"""FastAPI API routes for workspaces, editing, reviews, and search."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.document_projection import (
    AssignmentFilter,
    ProjectDocumentSummary,
    project_documents,
)
from ontocurator.api.identity import (
    PrincipalDep,
    own_annotator,
    own_key,
    principal_of,
)
from ontocurator.application.editing import EditorService
from ontocurator.application.preferences import Preferences, PreferencesUpdate
from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.workspaces import (
    EditorProposal,
    WorkspaceService,
    WorkspaceView,
)
from ontocurator.auth.audit import Actor
from ontocurator.auth.preferences import UserPreferencesStore
from ontocurator.authz.memberships import MembershipService
from ontocurator.authz.policy import (
    MODE_ACTIONS,
    Access,
    Action,
    Role,
    allowed_modes,
    can,
)
from ontocurator.authz.scoped import ScopedRepository, project_not_found
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
    WorkspaceMode,
)
from ontocurator.ontology.provenance import SearchRequest, SearchResult
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.packages.models import (
    SearchEventRecord,
)
from ontocurator.storage.repository import Repository

router = APIRouter(prefix="/api/v1")


def encode_workspace_id(key: WorkspaceKey) -> str:
    """Encode WorkspaceKey as URL-safe base64 string."""
    raw = json.dumps(key.model_dump()).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_workspace_id(token: str) -> WorkspaceKey:
    """Decode WorkspaceKey from URL-safe base64 string."""
    try:
        padding = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + padding)
        return WorkspaceKey.model_validate_json(raw)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid workspace ID format: {exc}"
        ) from exc


class ReviewInputsRequest(BaseModel):
    """Request payload for fetching targeted review inputs."""

    model_config = ConfigDict(extra="forbid")

    project_key: str
    document_id: str
    # Only the logged-in user's own pseudonym; omitted means the same.
    annotator_id: str | None = None
    mode: Literal["review"]


class OpenWorkspaceRequest(BaseModel):
    """Request payload for opening a workspace draft."""

    model_config = ConfigDict(extra="forbid")

    project_key: str
    document_id: str
    # Only the logged-in user's own pseudonym; omitted means the same.
    annotator_id: str | None = None
    mode: WorkspaceMode = "independent"
    targets: ReviewTargetSet | None = None
    review_round_target_set_id: str | None = None


class OpenWorkspaceResponse(BaseModel):
    """Response returned upon opening a workspace."""

    model_config = ConfigDict(extra="forbid")

    workspace_id: str
    view: WorkspaceView
    read_only: bool = False


class TermLookup(BaseModel):
    layer_id: str
    term_id: str


class TermLabelsRequest(BaseModel):
    project_key: str
    terms: list[TermLookup] = Field(max_length=200)


class TermLabel(TermLookup):
    """Display data for a term, resolved against the layer's pinned ontology.

    ``primary_term_id`` differs from ``term_id`` when the requested id is an
    alternative (merged) id or differs in case. For obsolete terms,
    ``replaced_by`` names the designated successor and ``consider`` lists
    looser suggestions, so the UI can offer a replacement.
    """

    label: str | None
    status: Literal["valid", "obsolete", "unknown"] = "unknown"
    primary_term_id: str | None = None
    replaced_by: str | None = None
    consider: list[str] = Field(default_factory=list)
    alt_ids: list[str] = Field(default_factory=list)


# --- Dependencies ------------------------------------------------------------- #


def get_access(request: Request) -> Access:
    """The logged-in user's access, read once per request."""
    access = getattr(request.state, "access", None)
    if not isinstance(access, Access):
        memberships = cast(MembershipService, request.app.state.memberships)
        access = memberships.access_for(principal_of(request))
        request.state.access = access
    return access


def get_repo(request: Request) -> Repository:
    """The repository of this request: only the projects the user can see (E3).

    ``app.state.repo`` stays unscoped for start-up work and the CLI.
    """
    repo = getattr(request.state, "repo", None)
    if not isinstance(repo, ScopedRepository):
        principal = principal_of(request)
        repo = ScopedRepository(
            cast(Repository, request.app.state.repo).db,
            get_access(request),
            Actor.user(principal.user_id, principal.username),
        )
        request.state.repo = repo
    return repo


def get_ontology(request: Request) -> OntologyRegistry:
    return request.app.state.ontology_registry  # type: ignore[no-any-return]


RepoDep = Annotated[Repository, Depends(get_repo)]
OntologyDep = Annotated[OntologyRegistry, Depends(get_ontology)]


def get_workspace_service(
    repo: RepoDep,
    ontology: OntologyDep,
) -> WorkspaceService:
    return WorkspaceService(repo, ontology)


def get_editor_service(
    repo: RepoDep,
    ontology: OntologyDep,
) -> EditorService:
    return EditorService(repo, ontology)


def get_review_service(
    repo: RepoDep,
    ontology: OntologyDep,
) -> ReviewService:
    return ReviewService(repo, registry=ontology)


def get_submission_service(
    repo: RepoDep,
    ontology: OntologyDep,
) -> SubmissionService:
    return SubmissionService(repo, ontology)


WorkspaceSvcDep = Annotated[WorkspaceService, Depends(get_workspace_service)]
EditorSvcDep = Annotated[EditorService, Depends(get_editor_service)]
ReviewSvcDep = Annotated[ReviewService, Depends(get_review_service)]
SubmissionSvcDep = Annotated[SubmissionService, Depends(get_submission_service)]


# --- Routes ------------------------------------------------------------------- #


def _preferences_store(request: Request) -> UserPreferencesStore:
    return cast(UserPreferencesStore, request.app.state.preferences)


def require_mode(request: Request, project_key: str, mode: WorkspaceMode) -> None:
    """Refuse a working mode the user's roles in the project do not give.

    A project the user cannot see is not found, as everywhere (E3).

    Raises:
        AccessDenied: ``MODE_NOT_ALLOWED`` (403).
    """
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, project_key):
        raise project_not_found(project_key)
    if not can(access, MODE_ACTIONS[mode], project_key):
        raise AccessDenied(
            "MODE_NOT_ALLOWED",
            f"Your roles in this project do not include the working mode '{mode}'.",
        )


def may_read_others(request: Request, project_key: str) -> bool:
    """Whether the user may read other annotators' work in the project (Q5)."""
    return can(get_access(request), Action.EXPORT_ALL_WORK, project_key)


class ProjectSummary(BaseModel):
    """A project on the dashboard, with what the user may do in it."""

    model_config = ConfigDict(extra="forbid")

    project_key: str
    name: str
    description: str | None
    roles: list[Role]
    allowed_modes: list[WorkspaceMode]
    document_count: int
    can_manage: bool


@router.get("/projects")
def list_projects(request: Request, repo: RepoDep) -> list[ProjectSummary]:
    """The projects the logged-in user can see, newest first."""
    access = get_access(request)
    return [
        ProjectSummary(
            project_key=project.project_key,
            name=project.name,
            description=project.description,
            roles=sorted(access.roles_in(project.project_key)),
            allowed_modes=allowed_modes(access, project.project_key),
            document_count=project.document_count,
            can_manage=can(access, Action.MANAGE_PROJECT_SETTINGS, project.project_key),
        )
        for project in repo.list_projects()
    ]


@router.get("/preferences")
def get_preferences(request: Request, principal: PrincipalDep) -> Preferences:
    """The logged-in user's preferences (working mode per package, ...)."""
    return _preferences_store(request).load(principal.user_id)


@router.put("/preferences")
def update_preferences(
    change: PreferencesUpdate, request: Request, principal: PrincipalDep
) -> Preferences:
    """Update preferences; omitted fields are kept, modes merge per package."""
    return _preferences_store(request).update(principal.user_id, change)


@router.get("/projects/{project_key}/documents", response_model_exclude_unset=True)
def list_package_documents(
    project_key: str,
    request: Request,
    principal: PrincipalDep,
    annotator_id: str | None = None,
    mode: WorkspaceMode | None = None,
    language: str | None = None,
    status: AssignmentFilter | None = None,
    q: str | None = None,
) -> list[ProjectDocumentSummary]:
    """List documents showing metadata only, without proposal counts.

    The status is the logged-in user's; a system admin or a lead of the
    project may ask for another annotator's. Review mode is refused to a user
    whose roles do not give it; in it each document says whether it has
    proposals, so review navigation can skip documents there is nothing to
    review in.

    Raises:
        AccessDenied: ``MODE_NOT_ALLOWED`` (403) for review mode without it.
    """
    return project_documents(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        get_access(request),
        project_key,
        annotator_id=annotator_id,
        mode=mode,
        language=language,
        status=status,
        q=q,
    )


@router.post("/terms/labels")
def resolve_term_labels(
    payload: TermLabelsRequest,
    repo: RepoDep,
    ontology: OntologyDep,
) -> list[TermLabel]:
    """Resolve display names against the ontology pinned to each package layer."""
    labels: list[TermLabel] = []
    for term in payload.terms:
        status = ontology.for_package_layer(
            repo, payload.project_key, term.layer_id
        ).validate_term(term.term_id)
        labels.append(
            TermLabel(
                layer_id=term.layer_id,
                term_id=term.term_id,
                label=status.label,
                status=status.status,
                primary_term_id=status.term_id if status.status != "unknown" else None,
                replaced_by=status.replaced_by,
                consider=status.consider,
                alt_ids=status.alt_ids,
            )
        )
    return labels


@router.post("/workspaces/review-inputs")
def get_review_inputs(
    req: ReviewInputsRequest,
    request: Request,
    ws_svc: WorkspaceSvcDep,
    principal: PrincipalDep,
) -> list[EditorProposal]:
    """Get selectable proposal versions for setting up a review round."""
    own_annotator(principal, req.annotator_id)
    require_mode(request, req.project_key, req.mode)
    if req.mode != "review":
        raise DomainError(
            "REVIEW_MODE_REQUIRED",
            "Review inputs can only be queried in review mode",
        )
    return ws_svc.get_review_inputs(req.project_key, req.document_id)


@router.post("/workspaces/open")
def open_workspace(
    req: OpenWorkspaceRequest,
    request: Request,
    ws_svc: WorkspaceSvcDep,
    principal: PrincipalDep,
) -> OpenWorkspaceResponse:
    """Open or initialize a workspace view of the logged-in user."""
    annotator_id = own_annotator(principal, req.annotator_id)
    require_mode(request, req.project_key, req.mode)
    targets = req.targets
    if req.review_round_target_set_id is not None and (
        req.mode != "review" or targets is not None
    ):
        raise DomainError(
            "INVALID_REVIEW_ROUND",
            "Round selection requires review mode without explicit targets",
        )
    if targets is not None and not targets.target_set_id:
        targets = ReviewTargetSet.create(targets.targets)
    target_set_id = (
        targets.target_set_id
        if targets
        else (req.review_round_target_set_id or "targets-0")
    )
    key = WorkspaceKey(
        project_key=req.project_key,
        document_id=req.document_id,
        annotator_id=annotator_id,
        mode=req.mode,
        target_set_id=target_set_id,
    )
    view = ws_svc.open(key, targets)
    assert isinstance(ws_svc.repo, ScopedRepository)
    assignment = ws_svc.repo.workspace_assignment(view.key)
    return OpenWorkspaceResponse(
        workspace_id=encode_workspace_id(view.key),
        view=view,
        read_only=assignment.status == "submitted",
    )


@router.post("/workspaces/{workspace_id}/commands")
def apply_command(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    edit_svc: EditorSvcDep,
    principal: PrincipalDep,
) -> Draft:
    """Execute an edit command against a workspace draft."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    require_mode(request, key.project_key, key.mode)
    return edit_svc.apply(key, envelope)


@router.post("/workspaces/{workspace_id}/decisions")
def record_decision(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    rev_svc: ReviewSvcDep,
    principal: PrincipalDep,
) -> Draft:
    """Record a reviewer decision against a targeted proposal."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    require_mode(request, key.project_key, key.mode)
    return rev_svc.decide(key, envelope)


@router.post("/workspaces/{workspace_id}/submit")
def submit_workspace(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    sub_svc: SubmissionSvcDep,
    principal: PrincipalDep,
) -> Submission:
    """Commit workspace submission upon verification."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    require_mode(request, key.project_key, key.mode)
    return sub_svc.submit(key, envelope)


@router.get("/workspaces/{workspace_id}/submissions/{submission_id}")
def read_submission(
    workspace_id: str,
    submission_id: str,
    sub_svc: SubmissionSvcDep,
    principal: PrincipalDep,
) -> Submission:
    """Read back historical submission."""
    key = own_key(principal, decode_workspace_id(workspace_id))
    return sub_svc.read(key, submission_id)


def layer_ontology(
    request: Request,
    repo: Repository,
    ws_svc: WorkspaceService,
    workspace_key: WorkspaceKey,
    layer_id: str,
    annotation_id: str,
) -> OntologyService:
    """The ontology a search or a tree request may use for this layer.

    Checks the working mode, the document, that the layer exists and is
    accessible in the workspace's scope, and that an annotation already in the
    draft belongs to that layer. The workspace must be the logged-in user's.
    """
    own_key(principal_of(request), workspace_key)
    require_mode(request, workspace_key.project_key, workspace_key.mode)
    ws_svc.get_document(workspace_key.project_key, workspace_key.document_id)
    profile = repo.get_task_profile(workspace_key.project_key)
    scope = build_scope(profile, workspace_key.mode)
    profile_layer_ids = [layer.layer_id for layer in profile.layers]
    if layer_id not in profile_layer_ids:
        raise DomainError(
            "UNKNOWN_LAYER",
            f"Layer '{layer_id}' is not defined in task profile",
        )
    accessible = scope.editable_layer_ids + scope.reference_layer_ids
    if layer_id not in accessible:
        raise DomainError(
            "INVALID_LAYER",
            f"Layer '{layer_id}' is not accessible in workspace scope '{scope.scope_id}'",
        )

    # If the annotation exists in the draft, its layer must be the one asked
    # for. A workspace that has no draft yet gets an empty one from
    # ``open_draft``, so "not yet in the draft" raises nothing; a draft that
    # cannot be read is an error, never a reason to skip this check.
    draft = repo.open_draft(workspace_key)
    for snap in draft.annotations:
        if snap.annotation.annotation_id == annotation_id:
            if snap.annotation.layer_id != layer_id:
                raise DomainError(
                    "LAYER_MISMATCH",
                    f"Annotation '{annotation_id}' belongs to layer '{snap.annotation.layer_id}', not '{layer_id}'",
                )
            break

    return get_ontology(request).for_package_layer(
        repo, workspace_key.project_key, layer_id
    )


@router.post("/search")
def search_ontology(
    req: SearchRequest,
    request: Request,
    repo: RepoDep,
    ws_svc: WorkspaceSvcDep,
) -> SearchResult:
    """Execute ontology search with deterministic provenance shuffling and layer scoping."""
    ontology = layer_ontology(
        request, repo, ws_svc, req.workspace_key, req.layer_id, req.annotation_id
    )

    result = ontology.search(req)
    result.search_id = str(uuid4())
    result.index_identity = ontology.identity_for_languages(result.languages)
    result.search_condition_id = (
        ontology.search_condition.condition_id if ontology.search_condition else None
    )
    result.execution = ontology.execution(result.languages, req.k)
    result.runtime_drift = ontology.runtime_drift()
    result.layer_id = req.layer_id
    result.ontology_sha256 = ontology.ref.sha256

    event = SearchEventRecord(
        event_id=result.search_id,
        workspace_key=req.workspace_key,
        annotation_id=req.annotation_id,
        layer_id=req.layer_id,
        ontology_sha256=ontology.ref.sha256,
        query=req.query,
        route=req.route,
        candidates=result.displayed_ids,
        ranked_ids=result.ranked_ids,
        candidate_scores={
            c.term_id: c.score for c in result.candidates if c.score is not None
        },
        candidate_routes={c.term_id: c.route for c in result.candidates if c.route},
        languages=result.languages,
        ontology_release=ontology.ref.release,
        index_identity=result.index_identity,
        search_condition_id=result.search_condition_id,
        execution=result.execution,
        runtime_drift=result.runtime_drift,
        timestamp=datetime.now(UTC).isoformat(),
    )
    repo.save_search_event(event)
    return result


class OntologyTranslation(BaseModel):
    """One language an ontology can be searched in besides English."""

    language: str
    # The files that contributed names in this language.
    filenames: list[str]
    # Terms with at least one name in this language.
    term_count: int


class OntologyInfo(BaseModel):
    ontology_id: str
    release: str
    sha256: str
    term_count: int
    path: str | None = None
    status: Literal["loaded", "failed"] = "loaded"
    error: str | None = None
    translations: list[OntologyTranslation] = Field(default_factory=list)


def _ontology_info(sha: str, svc: OntologyService, path: Path | None) -> OntologyInfo:
    return OntologyInfo(
        ontology_id=(svc.ontology.dominant_prefix or "unknown").lower(),
        release=svc.ontology.release or svc.ref.release,
        sha256=sha,
        term_count=len(svc.ontology.terms),
        path=str(path) if path is not None else None,
        translations=[
            OntologyTranslation(
                language=language,
                filenames=sorted(
                    item.filename
                    for item in svc.translations
                    if language in item.languages
                ),
                term_count=count,
            )
            for language, count in svc.translation_counts.items()
        ],
    )


@router.get("/projects/{project_key}/ontologies")
def package_ontologies(
    project_key: str, repo: RepoDep, ontology: OntologyDep
) -> list[OntologyInfo]:
    """Search languages from the package's immutable first-use resource capture."""
    profile = repo.get_task_profile(project_key)
    results = []
    for definition in profile.ontologies:
        service = ontology.for_package_ontology(
            repo, project_key, definition.ontology_id
        )
        results.append(_ontology_info(definition.sha256, service, None))
    return results


@router.get("/ontologies")
def list_ontologies(ontology: OntologyDep) -> list[OntologyInfo]:
    """List loaded ontologies plus registered files that failed to load."""
    ontology.load_registered()
    results = [
        _ontology_info(sha, svc, ontology.registered_path(sha))
        for sha, svc in ontology.services()
    ]
    results.extend(
        OntologyInfo(
            ontology_id="unknown",
            release="",
            sha256=failure.sha256,
            term_count=0,
            path=str(failure.path),
            status="failed",
            error=failure.error,
        )
        for failure in ontology.failures()
    )
    return results
