"""Read-only case texts and exact, currently offered annotation versions."""

from dataclasses import asdict

from fastapi import APIRouter, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
)
from sqlalchemy import select

from ontocurator.api.encoded_routes import EncodedParameterRoute
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.authz.versions import (
    TextLayerEntry,
    VersionRef,
    text_layers,
    visible_annotation_versions,
)
from ontocurator.authz.visibility import qualifying_assignment
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.errors import DomainError
from ontocurator.domain.reanchor_resolution import ReanchorItem as ReanchorItem
from ontocurator.domain.variants import TranslationStatus, VariantOrigin
from ontocurator.storage.tables import AssignmentRow

router = APIRouter(
    prefix="/api/v1/projects/{key}",
    tags=["variants"],
    route_class=EncodedParameterRoute,
)


class TranslationCheckView(BaseModel):
    code: str
    passed: bool
    detail: str | None = None


class TranslationRunView(BaseModel):
    provider: str
    model: str | None = None
    run_id: str | None = None
    recipe: str | None = None
    checks: list[TranslationCheckView] = Field(default_factory=list)


class VariantSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    case_id: str
    external_id: str
    language: str
    version: int
    origin: VariantOrigin
    derived_from: str | None
    translation: TranslationRunView | None
    translation_status: TranslationStatus | None
    status_reason: str | None
    text_sha256: str
    assigned_to_me: bool


class CaseSummary(BaseModel):
    case_id: str
    variants: list[VariantSummary]


class CaseDetail(CaseSummary):
    pass


class VariantText(BaseModel):
    document_id: str
    text: str
    text_sha256: str


class AnnotationVersion(BaseModel):
    ref: VersionRef
    annotations: list[AnnotationSnapshot]
    evidence: list[EvidenceSnapshot]


def _repo(request: Request) -> ScopedRepository:
    return ScopedRepository(request.app.state.repo.db, get_access(request))


def _cases(
    request: Request,
    key: str,
    *,
    case_id: str | None = None,
    language: str | None = None,
    origin: VariantOrigin | None = None,
    status: TranslationStatus | None = None,
) -> list[CaseSummary]:
    repo = _repo(request)
    with repo.db.snapshot() as conn:
        variants = repo.list_variants(key, case_id=case_id)
        pid = repo._require_project(conn, key)
        assigned = set(
            conn.execute(
                select(AssignmentRow.document_id).where(
                    AssignmentRow.project_id == pid,
                    qualifying_assignment(repo.access.user_id),
                )
            ).scalars()
        )
        grouped: dict[str, list[VariantSummary]] = {}
        for variant in variants:
            if (
                (language is not None and variant.language != language)
                or (origin is not None and variant.origin != origin)
                or (status is not None and variant.translation_status != status)
            ):
                continue
            grouped.setdefault(variant.case_id, []).append(
                VariantSummary.model_validate(
                    {
                        **asdict(variant),
                        "assigned_to_me": variant.document_id in assigned,
                    }
                )
            )
        return [
            CaseSummary(case_id=case, variants=items) for case, items in grouped.items()
        ]


@router.get("/cases")
def list_cases(
    key: str,
    request: Request,
    principal: PrincipalDep,
    language: str | None = None,
    origin: VariantOrigin | None = None,
    status: TranslationStatus | None = None,
) -> list[CaseSummary]:
    return _cases(request, key, language=language, origin=origin, status=status)


@router.get("/cases/{case_id:path}")
def get_case(
    key: str, case_id: str, request: Request, principal: PrincipalDep
) -> CaseDetail:
    cases = _cases(request, key, case_id=case_id)
    if not cases:
        raise DomainError("CASE_NOT_FOUND")
    return CaseDetail(**cases[0].model_dump())


@router.get("/documents/{doc:path}/annotation-versions/{kind}/{version_id:path}")
def get_version(
    key: str,
    doc: str,
    kind: str,
    version_id: str,
    request: Request,
    principal: PrincipalDep,
) -> AnnotationVersion:
    repo = _repo(request)
    with repo.db.snapshot():
        return AnnotationVersion(
            **repo.get_annotation_version(key, doc, kind, version_id)
        )


@router.get("/documents/{doc:path}/annotation-versions")
def list_versions(
    key: str,
    doc: str,
    request: Request,
    principal: PrincipalDep,
    assignment: int | None = None,
) -> list[VersionRef]:
    repo = _repo(request)
    with repo.db.snapshot() as conn:
        return visible_annotation_versions(
            conn,
            repo.access,
            repo._require_project(conn, key),
            key,
            doc,
            assignment=assignment,
        )


class TextLayers(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entries: list[TextLayerEntry]


@router.get("/documents/{doc:path}/layers")
def list_layers(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> TextLayers:
    repo = _repo(request)
    with repo.db.snapshot() as conn:
        return TextLayers(
            entries=text_layers(
                conn, repo.access, repo._require_project(conn, key), key, doc
            )
        )


@router.get("/documents/{doc:path}/reanchor-items")
def reanchor_items(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> list[ReanchorItem]:
    repo = _repo(request)
    with repo.db.snapshot():
        items = repo.get_reanchor_items(key, doc)
        try:
            return [ReanchorItem.model_validate(item) for item in items]
        except ValidationError as exc:
            raise DomainError("VERSION_NOT_FOUND") from exc


@router.get("/documents/{doc:path}/text")
def variant_text(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> VariantText:
    repo = _repo(request)
    with repo.db.snapshot():
        document = repo.get_variant_text(key, doc)
        if document is None:
            raise DomainError("DOCUMENT_NOT_FOUND")
        return VariantText(
            document_id=document.document_id,
            text=document.text,
            text_sha256=document.text_sha256,
        )


@router.get("/documents/{doc:path}/variant")
def variant_metadata(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> VariantSummary:
    """Resolve a deep-linked document's case without loading the project catalog."""
    repo = _repo(request)
    with repo.db.snapshot() as conn:
        variant = repo.get_variant(key, doc)
        pid = repo._require_project(conn, key)
        assigned = (
            conn.execute(
                select(AssignmentRow.id)
                .where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.document_id == doc,
                    qualifying_assignment(repo.access.user_id),
                )
                .limit(1)
            ).first()
            is not None
        )
        return VariantSummary.model_validate(
            {**asdict(variant), "assigned_to_me": assigned}
        )
