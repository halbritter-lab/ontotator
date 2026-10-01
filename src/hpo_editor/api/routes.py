"""FastAPI API routes for workspaces, editing, reviews, and search."""

from __future__ import annotations

import base64
import io
import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from hpo_editor.application.editing import EditorService
from hpo_editor.application.exports import ExportService
from hpo_editor.application.reviews import ReviewService
from hpo_editor.application.submissions import SubmissionService
from hpo_editor.application.workspaces import (
    DocumentSummary,
    WorkspaceService,
    WorkspaceView,
)
from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.errors import DomainError
from hpo_editor.domain.review import ReviewTargetSet
from hpo_editor.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
    WorkspaceMode,
)
from hpo_editor.ontology.provenance import SearchRequest, SearchResult
from hpo_editor.ontology.service import OntologyService
from hpo_editor.packages.models import PackageManifest
from hpo_editor.packages.reader import PackageReader
from hpo_editor.packages.writer import PackageWriter
from hpo_editor.storage.repository import Repository

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


# --- Dependencies ------------------------------------------------------------- #


def get_repo(request: Request) -> Repository:
    return request.app.state.repo  # type: ignore[no-any-return]


def get_ontology(request: Request) -> OntologyService:
    return request.app.state.ontology  # type: ignore[no-any-return]


RepoDep = Annotated[Repository, Depends(get_repo)]
OntologyDep = Annotated[OntologyService, Depends(get_ontology)]


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
    return ReviewService(repo, ontology)


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
    ontology: OntologyDep,
) -> dict[str, str | dict[str, object]]:
    """Upload and atomically import a work package archive."""
    content = await file.read()
    stream = io.BytesIO(content)
    pkg = PackageReader.read_from_stream(stream, ontology.ref)
    package_id = repo.import_package(pkg)
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
) -> list[DocumentSummary]:
    """List documents showing metadata only, without proposal counts."""
    return ws_svc.list_documents(package_id)


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
    target_set_id = req.targets.target_set_id if req.targets else "targets-0"
    key = WorkspaceKey(
        package_id=req.package_id,
        document_id=req.document_id,
        annotator_id=req.annotator_id,
        mode=req.mode,
        target_set_id=target_set_id,
    )
    view = ws_svc.open(key, req.targets)
    return OpenWorkspaceResponse(
        workspace_id=encode_workspace_id(key),
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
    ontology: OntologyDep,
) -> SearchResult:
    """Execute HPO search with deterministic provenance shuffling."""
    return ontology.search(req)


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
