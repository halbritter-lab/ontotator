"""Read-only case texts and exact, currently offered annotation versions."""

from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    computed_field,
    model_validator,
)
from sqlalchemy import select

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.authz.versions import VersionRef, visible_annotation_versions
from ontocurator.authz.visibility import qualifying_assignment
from ontocurator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontocurator.domain.documents import EvidenceRef, EvidenceSnapshot
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import TranslationStatus, VariantOrigin
from ontocurator.storage.tables import AssignmentRow

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["variants"])


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


class TextWindowView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str

    @model_validator(mode="after")
    def valid_window(self) -> "TextWindowView":
        if self.end < self.start or len(self.text) != self.end - self.start:
            raise ValueError("Invalid absolute text window")
        return self


class OldMentionView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_ref: EvidenceRef
    segments: list[TextWindowView]
    cue_segments: list[TextWindowView]


class WindowOpcodeView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal["equal", "replace", "insert", "delete"]
    old_start: int = Field(ge=0)
    old_end: int = Field(ge=0)
    new_start: int = Field(ge=0)
    new_end: int = Field(ge=0)
    old_text: str
    new_text: str

    @model_validator(mode="after")
    def valid_ranges(self) -> "WindowOpcodeView":
        if self.old_end - self.old_start != len(
            self.old_text
        ) or self.new_end - self.new_start != len(self.new_text):
            raise ValueError("Invalid absolute opcode ranges")
        return self


class ReanchorItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposal_set_id: int
    source_ref: AnnotationRef
    term_id: str
    layer_id: str
    reason: Literal[
        "source_text_mismatch",
        "missing_evidence",
        "evidence_version_mismatch",
        "ambiguous_evidence",
        "evidence_source_mismatch",
        "invalid_bounds",
        "changed_segment",
        "changed_cue",
    ]
    old_mentions: list[OldMentionView]
    old_context: TextWindowView
    new_context: TextWindowView
    diff: list[WindowOpcodeView]

    @computed_field
    def old_segments(self) -> list[TextWindowView]:
        return [
            segment
            for mention in self.old_mentions
            for segment in [*mention.segments, *mention.cue_segments]
        ]


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
