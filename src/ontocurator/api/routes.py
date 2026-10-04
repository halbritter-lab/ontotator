"""FastAPI API routes for workspaces, editing, reviews, and search."""

from __future__ import annotations

import base64
import io
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.application.editing import EditorService
from ontocurator.application.exports import ExportService
from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.workspaces import (
    DocumentSummary,
    WorkspaceService,
    WorkspaceView,
)
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.errors import DomainError
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
from ontocurator.packages.models import PackageManifest, SearchEventRecord
from ontocurator.packages.reader import PackageReader
from ontocurator.packages.writer import PackageWriter
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

    package_id: str
    document_id: str
    annotator_id: str
    mode: Literal["review"]


class OpenWorkspaceRequest(BaseModel):
    """Request payload for opening a workspace draft."""

    model_config = ConfigDict(extra="forbid")

    package_id: str
    document_id: str
    annotator_id: str
    mode: WorkspaceMode = "independent"
    targets: ReviewTargetSet | None = None


class OpenWorkspaceResponse(BaseModel):
    """Response returned upon opening a workspace."""

    model_config = ConfigDict(extra="forbid")

    workspace_id: str
    view: WorkspaceView


class TermLookup(BaseModel):
    layer_id: str
    term_id: str


class TermLabelsRequest(BaseModel):
    package_id: str
    terms: list[TermLookup] = Field(max_length=200)


class TermLabel(TermLookup):
    label: str | None


# --- Dependencies ------------------------------------------------------------- #


def get_repo(request: Request) -> Repository:
    return request.app.state.repo  # type: ignore[no-any-return]


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
) -> SubmissionService:
    return SubmissionService(repo)


def get_export_service(
    repo: RepoDep,
) -> ExportService:
    return ExportService(repo)


WorkspaceSvcDep = Annotated[WorkspaceService, Depends(get_workspace_service)]
EditorSvcDep = Annotated[EditorService, Depends(get_editor_service)]
ReviewSvcDep = Annotated[ReviewService, Depends(get_review_service)]
SubmissionSvcDep = Annotated[SubmissionService, Depends(get_submission_service)]
ExportSvcDep = Annotated[ExportService, Depends(get_export_service)]


# --- Routes ------------------------------------------------------------------- #


@router.post("/packages")
async def upload_package(
    file: UploadFile,
    repo: RepoDep,
    request: Request,
) -> dict[str, str | dict[str, object]]:
    """Upload and atomically import a work package archive."""
    registry = request.app.state.ontology_registry
    content = await file.read()
    stream = io.BytesIO(content)
    pkg = PackageReader.read_from_stream(stream, registry=registry)
    assert pkg.manifest.task_profile is not None
    services = registry.prepare_package(pkg.manifest.task_profile, pkg.embedded_files)
    package_id = repo.import_package(pkg)
    for service in services:
        registry.register_service(service)
    return {"package_id": package_id, "manifest": pkg.manifest.model_dump()}


@router.get("/packages")
def list_packages(repo: RepoDep) -> list[PackageManifest]:
    """List installed packages with metadata and ontology reference."""
    conn = repo.db.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT manifest_json FROM packages ORDER BY created_at DESC;")
    return [PackageManifest.model_validate_json(r[0]) for r in cursor.fetchall()]


@router.get("/packages/{package_id}/documents")
def list_package_documents(
    package_id: str,
    ws_svc: WorkspaceSvcDep,
    annotator_id: str | None = None,
    mode: WorkspaceMode | None = None,
) -> list[DocumentSummary]:
    """List documents showing metadata only, without proposal counts."""
    return ws_svc.list_documents(package_id, annotator_id, mode)


@router.post("/terms/labels")
def resolve_term_labels(
    payload: TermLabelsRequest,
    repo: RepoDep,
    ontology: OntologyDep,
) -> list[TermLabel]:
    """Resolve display names against the ontology pinned to each package layer."""
    profile = repo.get_task_profile(payload.package_id)
    return [
        TermLabel(
            layer_id=term.layer_id,
            term_id=term.term_id,
            label=ontology.for_layer(profile, term.layer_id)
            .validate_term(term.term_id)
            .label,
        )
        for term in payload.terms
    ]


@router.post("/workspaces/review-inputs")
def get_review_inputs(
    req: ReviewInputsRequest,
    ws_svc: WorkspaceSvcDep,
) -> list[AnnotationSnapshot]:
    """Get selectable proposal versions for setting up a review round."""
    if req.mode != "review":
        raise DomainError(
            "REVIEW_MODE_REQUIRED",
            "Review inputs can only be queried in review mode",
        )
    return ws_svc.get_review_inputs(req.package_id, req.document_id)


@router.post("/workspaces/open")
def open_workspace(
    req: OpenWorkspaceRequest,
    ws_svc: WorkspaceSvcDep,
) -> OpenWorkspaceResponse:
    """Open or initialize a workspace view."""
    targets = req.targets
    if targets is not None and not targets.target_set_id:
        targets = ReviewTargetSet.create(targets.targets)
    target_set_id = targets.target_set_id if targets else "targets-0"
    key = WorkspaceKey(
        package_id=req.package_id,
        document_id=req.document_id,
        annotator_id=req.annotator_id,
        mode=req.mode,
        target_set_id=target_set_id,
    )
    view = ws_svc.open(key, targets)
    return OpenWorkspaceResponse(
        workspace_id=encode_workspace_id(view.key),
        view=view,
    )


@router.post("/workspaces/{workspace_id}/commands")
def apply_command(
    workspace_id: str,
    envelope: MutationEnvelope,
    edit_svc: EditorSvcDep,
) -> Draft:
    """Execute an edit command against a workspace draft."""
    key = decode_workspace_id(workspace_id)
    return edit_svc.apply(key, envelope)


@router.post("/workspaces/{workspace_id}/decisions")
def record_decision(
    workspace_id: str,
    envelope: MutationEnvelope,
    rev_svc: ReviewSvcDep,
) -> Draft:
    """Record a reviewer decision against a targeted proposal."""
    key = decode_workspace_id(workspace_id)
    return rev_svc.decide(key, envelope)


@router.post("/workspaces/{workspace_id}/submit")
def submit_workspace(
    workspace_id: str,
    envelope: MutationEnvelope,
    sub_svc: SubmissionSvcDep,
) -> Submission:
    """Commit workspace submission upon verification."""
    key = decode_workspace_id(workspace_id)
    return sub_svc.submit(key, envelope)


@router.get("/workspaces/{workspace_id}/submissions/{submission_id}")
def read_submission(
    workspace_id: str,
    submission_id: str,
    sub_svc: SubmissionSvcDep,
) -> Submission:
    """Read back historical submission."""
    key = decode_workspace_id(workspace_id)
    return sub_svc.read(key, submission_id)


@router.post("/search")
def search_ontology(
    req: SearchRequest,
    request: Request,
    repo: RepoDep,
    ws_svc: WorkspaceSvcDep,
) -> SearchResult:
    """Execute ontology search with deterministic provenance shuffling and layer scoping."""
    ws_svc.get_document(req.workspace_key.package_id, req.workspace_key.document_id)
    profile = repo.get_task_profile(req.workspace_key.package_id)
    scope = build_scope(profile, req.workspace_key.mode)
    profile_layer_ids = [layer.layer_id for layer in profile.layers]
    if req.layer_id not in profile_layer_ids:
        raise DomainError(
            "UNKNOWN_LAYER",
            f"Layer '{req.layer_id}' is not defined in task profile",
        )
    accessible = scope.editable_layer_ids + scope.reference_layer_ids
    if req.layer_id not in accessible:
        raise DomainError(
            "INVALID_LAYER",
            f"Layer '{req.layer_id}' is not accessible in workspace scope '{scope.scope_id}'",
        )

    # If annotation exists in draft, verify layer matches
    try:
        draft = repo.open_draft(req.workspace_key)
        for snap in draft.annotations:
            if snap.annotation.annotation_id == req.annotation_id:
                if snap.annotation.layer_id != req.layer_id:
                    raise DomainError(
                        "LAYER_MISMATCH",
                        f"Annotation '{req.annotation_id}' belongs to layer '{snap.annotation.layer_id}', not '{req.layer_id}'",
                    )
                break
    except DomainError:
        raise
    except Exception:
        pass

    ontology = request.app.state.ontology_registry.for_layer(profile, req.layer_id)

    result = cast(SearchResult, ontology.search(req))
    result.search_id = str(uuid4())
    result.index_identity = ontology.index_identity
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
        ontology_release=ontology.ref.release,
        index_identity=result.index_identity,
        timestamp=datetime.now(UTC).isoformat(),
    )
    repo.save_search_event(event)
    return result


@router.get("/workspaces/{workspace_id}/export")
def export_workspace(
    workspace_id: str,
    exp_svc: ExportSvcDep,
) -> Response:
    """Export scoped workspace package as downloadable ZIP."""
    key = decode_workspace_id(workspace_id)
    pkg = exp_svc.for_workspace(key)
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf)
    zip_bytes = buf.getvalue()

    filename = f"{pkg.manifest.package_id}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class OntologyInfo(BaseModel):
    ontology_id: str
    release: str
    sha256: str
    term_count: int
    path: str | None = None


@router.get("/ontologies")
def list_ontologies(request: Request) -> list[OntologyInfo]:
    """List loaded ontologies in memory registry."""
    registry = request.app.state.ontology_registry
    results: list[OntologyInfo] = []
    for sha, svc in registry._services.items():
        ont_id = (svc.ontology.dominant_prefix or "unknown").lower()
        results.append(
            OntologyInfo(
                ontology_id=ont_id,
                release=svc.ontology.release or svc.ref.release,
                sha256=sha,
                term_count=len(svc.ontology.terms),
            )
        )
    return results


@router.post("/ontologies")
async def upload_ontology(
    file: UploadFile,
    request: Request,
) -> OntologyInfo:
    """Upload and register an ontology file into the active workspace."""
    content = await file.read()
    registry = request.app.state.ontology_registry
    config = getattr(request.app.state, "config", None)

    workspace_ont_dir = (
        (config.workspace_dir / "ontologies")
        if config
        else Path("./workspace/ontologies")
    )
    workspace_ont_dir.mkdir(parents=True, exist_ok=True)

    filename = file.filename or "ontology.json"
    dest_path = workspace_ont_dir / filename
    dest_path.write_bytes(content)

    try:
        from ontocurator.domain.documents import OntologyRef
        from ontocurator.ontology.service import OntologyService

        digest = registry.register_path(dest_path)
        if registry.get_service(digest) is None:
            svc = OntologyService.load(
                dest_path, OntologyRef(release="uploaded", sha256=digest)
            )
            registry.register_service(svc)
        else:
            svc = registry.get_service(digest)
            assert svc is not None
    except Exception as exc:
        if dest_path.is_file():
            dest_path.unlink()
        raise HTTPException(
            status_code=400, detail=f"Failed to register ontology: {exc}"
        ) from exc

    from ontocurator.config_store import (
        load_persistent_config,
        save_persistent_config,
    )

    p_cfg = load_persistent_config()
    if dest_path.resolve() not in [p.resolve() for p in p_cfg.ontology_paths]:
        p_cfg.ontology_paths.append(dest_path.resolve())
        save_persistent_config(p_cfg)

    ont_id = (svc.ontology.dominant_prefix or "unknown").lower()
    return OntologyInfo(
        ontology_id=ont_id,
        release=svc.ontology.release or svc.ref.release,
        sha256=digest,
        term_count=len(svc.ontology.terms),
        path=str(dest_path),
    )
