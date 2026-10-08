"""FastAPI API routes for workspaces, editing, reviews, and search."""

from __future__ import annotations

import base64
import io
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ontocurator import file_manager
from ontocurator.application.editing import EditorService
from ontocurator.application.exports import ExportService
from ontocurator.application.legacy_config import (
    LegacyConfigDeleted,
    LegacyConfigNotFound,
    LegacyConfigService,
    LegacyConfigStatus,
    LegacyImportResult,
)
from ontocurator.application.preferences import (
    PREFERENCES_FILENAME,
    Preferences,
    PreferencesStore,
    PreferencesUpdate,
)
from ontocurator.application.provisioning import ProvisioningStatus
from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.uploads import (
    OntologyUploadService,
    PackageImportService,
    TranslationUploadService,
)
from ontocurator.application.workspaces import (
    DocumentSummary,
    WorkspaceService,
    WorkspaceView,
)
from ontocurator.distribution_settings import (
    DistributionSettings,
    EffectiveSettings,
)
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.errors import DomainError, ModeNotAllowed, PayloadTooLarge
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
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
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
    ontology: OntologyDep,
) -> SubmissionService:
    return SubmissionService(repo, ontology)


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


def _preferences_store(request: Request) -> PreferencesStore:
    store = getattr(request.app.state, "preferences", None)
    if store is None:
        config = getattr(request.app.state, "config", None)
        base = config.workspace_dir if config else Path("./workspace")
        store = PreferencesStore(base / PREFERENCES_FILENAME)
        request.app.state.preferences = store
    return cast(PreferencesStore, store)


def _distribution(request: Request) -> DistributionSettings:
    config = getattr(request.app.state, "config", None)
    return config.distribution if config is not None else DistributionSettings()


def require_mode_allowed(request: Request, mode: WorkspaceMode) -> None:
    """Enforce ``allowed_modes`` of the distribution settings (blinding)."""
    allowed = _distribution(request).effective_allowed_modes()
    if mode not in allowed:
        raise ModeNotAllowed(
            f"The working mode '{mode}' is not available in this installation "
            f"(allowed: {', '.join(allowed)})."
        )


@router.get("/settings")
def get_settings(request: Request) -> EffectiveSettings:
    """Effective presets of this installation (ontocurator-settings.json)."""
    return EffectiveSettings.from_settings(_distribution(request))


@router.get("/provisioning")
def get_provisioning(request: Request) -> ProvisioningStatus:
    """Notices from importing the ontologies/ and packages/ folders at start."""
    status = getattr(request.app.state, "provisioning", None)
    return status if isinstance(status, ProvisioningStatus) else ProvisioningStatus()


@router.get("/preferences")
def get_preferences(request: Request) -> Preferences:
    """Workspace-level preferences (last identity, working mode per package)."""
    return _preferences_store(request).load()


@router.put("/preferences")
def update_preferences(change: PreferencesUpdate, request: Request) -> Preferences:
    """Update preferences; omitted fields are kept, modes merge per package."""
    return _preferences_store(request).update(change)


# --- Settings of an earlier installation ------------------------------------- #


class LegacyFolderOpened(BaseModel):
    folder: str


def _legacy_config(request: Request) -> LegacyConfigService:
    service = getattr(request.app.state, "legacy_config", None)
    if service is None:
        raise LegacyConfigNotFound()
    return cast(LegacyConfigService, service)


@router.get("/legacy-config")
def get_legacy_config(request: Request) -> LegacyConfigStatus:
    """Settings of an earlier installation that could be imported (never
    imported automatically). ``found`` is false when there is nothing to show."""
    service = getattr(request.app.state, "legacy_config", None)
    if service is None:
        return LegacyConfigStatus()
    return cast(LegacyConfigService, service).status()


@router.post("/legacy-config/import")
def import_legacy_config(request: Request) -> LegacyImportResult:
    """Copy the old ontology files into the workspace and take over port and
    auto-open-browser (effective at the next start)."""
    return _legacy_config(request).import_settings()


@router.post("/legacy-config/dismiss")
def dismiss_legacy_config(request: Request) -> LegacyConfigStatus:
    """Hide the notice for this version of the old settings file."""
    return _legacy_config(request).dismiss()


@router.post("/legacy-config/open-folder")
def open_legacy_config_folder(request: Request) -> LegacyFolderOpened:
    """Show the old settings file's folder in the file manager (fixed path only)."""
    folder = _legacy_config(request).folder()
    try:
        file_manager.open_folder(folder)
    except OSError as exc:
        raise DomainError(
            "OPEN_FOLDER_FAILED", f"Could not open the folder {folder}: {exc}"
        ) from exc
    return LegacyFolderOpened(folder=str(folder))


@router.delete("/legacy-config")
def delete_legacy_config(request: Request) -> LegacyConfigDeleted:
    """Delete only the old settings file (never workspace or annotation data)."""
    return _legacy_config(request).delete()


@router.post("/packages")
def upload_package(
    file: UploadFile,
    repo: RepoDep,
    ontology: OntologyDep,
) -> dict[str, str | dict[str, object]]:
    """Upload and atomically import a work package archive.

    Runs in the thread pool (plain ``def``); the body is copied with a size cap.
    """
    manifest = PackageImportService(repo, ontology).import_upload(file.file)
    return {"package_id": manifest.package_id, "manifest": manifest.model_dump()}


@router.get("/packages")
def list_packages(repo: RepoDep) -> list[PackageManifest]:
    """List installed packages with metadata and ontology reference."""
    return repo.list_manifests()


@router.get("/packages/{package_id}/documents")
def list_package_documents(
    package_id: str,
    request: Request,
    ws_svc: WorkspaceSvcDep,
    annotator_id: str | None = None,
    mode: WorkspaceMode | None = None,
) -> list[DocumentSummary]:
    """List documents showing metadata only, without proposal counts.

    In review mode (if allowed) each document says whether it has proposals, so
    review navigation can skip documents there is nothing to review in.
    """
    reveal = (
        mode == "review"
        and "review" in _distribution(request).effective_allowed_modes()
    )
    return ws_svc.list_documents(
        package_id, annotator_id, mode, reveal_review_inputs=reveal
    )


@router.post("/terms/labels")
def resolve_term_labels(
    payload: TermLabelsRequest,
    repo: RepoDep,
    ontology: OntologyDep,
) -> list[TermLabel]:
    """Resolve display names against the ontology pinned to each package layer."""
    profile = repo.get_task_profile(payload.package_id)
    labels: list[TermLabel] = []
    for term in payload.terms:
        status = ontology.for_layer(profile, term.layer_id).validate_term(term.term_id)
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
) -> list[AnnotationSnapshot]:
    """Get selectable proposal versions for setting up a review round."""
    require_mode_allowed(request, req.mode)
    if req.mode != "review":
        raise DomainError(
            "REVIEW_MODE_REQUIRED",
            "Review inputs can only be queried in review mode",
        )
    return ws_svc.get_review_inputs(req.package_id, req.document_id)


@router.post("/workspaces/open")
def open_workspace(
    req: OpenWorkspaceRequest,
    request: Request,
    ws_svc: WorkspaceSvcDep,
) -> OpenWorkspaceResponse:
    """Open or initialize a workspace view."""
    require_mode_allowed(request, req.mode)
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
    request: Request,
    edit_svc: EditorSvcDep,
) -> Draft:
    """Execute an edit command against a workspace draft."""
    key = decode_workspace_id(workspace_id)
    require_mode_allowed(request, key.mode)
    return edit_svc.apply(key, envelope)


@router.post("/workspaces/{workspace_id}/decisions")
def record_decision(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    rev_svc: ReviewSvcDep,
) -> Draft:
    """Record a reviewer decision against a targeted proposal."""
    key = decode_workspace_id(workspace_id)
    require_mode_allowed(request, key.mode)
    return rev_svc.decide(key, envelope)


@router.post("/workspaces/{workspace_id}/submit")
def submit_workspace(
    workspace_id: str,
    envelope: MutationEnvelope,
    request: Request,
    sub_svc: SubmissionSvcDep,
) -> Submission:
    """Commit workspace submission upon verification."""
    key = decode_workspace_id(workspace_id)
    require_mode_allowed(request, key.mode)
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
    require_mode_allowed(request, req.workspace_key.mode)
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
        candidate_routes={c.term_id: c.route for c in result.candidates if c.route},
        languages=result.languages,
        ontology_release=ontology.ref.release,
        index_identity=result.index_identity,
        timestamp=datetime.now(UTC).isoformat(),
    )
    repo.save_search_event(event)
    return result


_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]")


def _export_filename(*parts: str) -> str:
    """``part1__part2__..__YYYYMMDD-HHMMSS.zip`` restricted to [A-Za-z0-9._-]."""
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    safe = [_UNSAFE_FILENAME_CHARS.sub("_", part) or "_" for part in parts]
    return "__".join([*safe, stamp]) + ".zip"


def _zip_response(pkg: ValidatedPackage, filename: str) -> Response:
    buf = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buf)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/workspaces/{workspace_id}/export")
def export_workspace(
    workspace_id: str,
    exp_svc: ExportSvcDep,
) -> Response:
    """Export scoped workspace package as downloadable ZIP.

    Filename: ``<package_id>__<annotator_id>__<document_id>__<YYYYMMDD-HHMMSS>.zip``.
    """
    key = decode_workspace_id(workspace_id)
    pkg = exp_svc.for_workspace(key)
    return _zip_response(
        pkg, _export_filename(key.package_id, key.annotator_id, key.document_id)
    )


@router.get(
    "/packages/{package_id}/export",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}}},
)
def export_package_for_annotator(
    package_id: str,
    annotator_id: str,
    exp_svc: ExportSvcDep,
    mode: WorkspaceMode | None = None,
) -> Response:
    """Export all work of one annotator on a package as one v2 work package.

    Includes every document of the package and all of the annotator's
    submissions, submitted annotations and search events in ``mode`` (all
    modes if omitted). Filename:
    ``<package_id>__<annotator_id>__<YYYYMMDD-HHMMSS>.zip``.
    """
    pkg = exp_svc.for_package(package_id, annotator_id, mode)
    return _zip_response(pkg, _export_filename(package_id, annotator_id))


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


class TranslationUploadInfo(BaseModel):
    """Answer to the upload of a translation file (``.tsv``)."""

    filename: str
    language: str
    # False when no loaded ontology has the file's prefix yet.
    assigned: bool
    message: str
    # The ontologies that were reloaded with the file.
    ontologies: list[OntologyInfo] = Field(default_factory=list)


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


@router.post("/ontologies")
def upload_ontology(
    file: UploadFile,
    request: Request,
    ontology: OntologyDep,
) -> OntologyInfo | TranslationUploadInfo:
    """Upload an ontology (``.json``) or a translation file (``.tsv``).

    An ontology is stored immutably as ``<stem>-<sha256[:12]>.json`` and
    remembered in the persistent configuration so it is registered again after
    a restart. A translation file (babelon TSV, e.g. ``hp-de.babelon.tsv``) is
    stored under its own name, replaces a file of that name, and the ontology
    it belongs to is reloaded.
    """
    config = getattr(request.app.state, "config", None)
    directory = (
        (config.workspace_dir / "ontologies")
        if config
        else Path("./workspace/ontologies")
    )
    if (file.filename or "").lower().endswith(".tsv"):
        return _upload_translation(file, ontology, directory)
    uploads = OntologyUploadService(ontology, directory)
    try:
        stored = uploads.store(file.file, file.filename)
    except PayloadTooLarge:
        raise
    except DomainError as exc:
        raise HTTPException(
            status_code=400, detail=f"Failed to register ontology: {exc}"
        ) from exc
    uploads.persist(stored.path)
    return _ontology_info(stored.sha256, stored.service, stored.path)


def _upload_translation(
    file: UploadFile, ontology: OntologyRegistry, directory: Path
) -> TranslationUploadInfo:
    try:
        stored = TranslationUploadService(ontology, directory).store(
            file.file, file.filename
        )
    except PayloadTooLarge:
        raise
    except DomainError as exc:
        # A failed reload, or a file that could not be moved into place, is
        # not the uploader's mistake.
        server_side = ("TRANSLATION_RELOAD_FAILED", "TRANSLATION_STORE_FAILED")
        status = 500 if exc.code in server_side else 400
        raise HTTPException(
            status_code=status, detail=f"Failed to add translation: {exc}"
        ) from exc

    name = stored.path.name
    infos = [
        _ontology_info(sha, svc, ontology.registered_path(sha))
        for sha, svc in stored.services.items()
    ]
    if not infos:
        message = (
            f"{name} was stored, but no loaded ontology has the prefix "
            f"'{stored.prefix.upper()}'. It is used as soon as such an ontology is added."
        )
    else:
        loaded = "; ".join(
            f"{info.ontology_id.upper()} {info.release}: "
            + ", ".join(f"{t.language} {t.term_count} terms" for t in info.translations)
            for info in infos
        )
        message = f"{name} was added. {loaded}."
    return TranslationUploadInfo(
        filename=name,
        language=stored.language,
        assigned=bool(infos),
        message=message,
        ontologies=infos,
    )
