"""Deliberate correction allocation and displayed source-obligation resolution."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ontocurator.api.assignment_routes import AssignmentView, _views
from ontocurator.api.encoded_routes import EncodedParameterRoute
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.routes import get_access
from ontocurator.application.translation_reviews import TranslationReviewRecord
from ontocurator.application.translation_workflow import TranslationWorkflowService
from ontocurator.auth.audit import Actor
from ontocurator.domain.work_rounds import SourceReviewObligation

router = APIRouter(
    prefix="/api/v1", tags=["translation-workflow"], route_class=EncodedParameterRoute
)


class CorrectionAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: str = Field(min_length=1)
    confirm_language: bool = False


class LeadCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirm_language: bool = False


class SourceObligationView(SourceReviewObligation):
    old_source_text: str
    new_source_text: str


class ResolveSourceObligationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    translation_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    old_source_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    new_source_text_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


def _service(request: Request) -> TranslationWorkflowService:
    return TranslationWorkflowService(request.app.state.repo.db, request.app.state.jobs)


@router.post("/projects/{key}/documents/{doc:path}/translation-correction-assignment")
def assign_correction(
    key: str,
    doc: str,
    body: CorrectionAssignmentRequest,
    request: Request,
    principal: PrincipalDep,
) -> AssignmentView:
    row = _service(request).assign_correction(
        Actor.user(principal.user_id, principal.username), key, doc, **body.model_dump()
    )
    return _views(request, [row])[0]


@router.post("/projects/{key}/documents/{doc:path}/lead-correction")
def start_lead_correction(
    key: str,
    doc: str,
    body: LeadCorrectionRequest,
    request: Request,
    principal: PrincipalDep,
) -> AssignmentView:
    """F1: the lead reviews a rejected or queried version themselves."""
    row = _service(request).start_lead_correction(
        Actor.user(principal.user_id, principal.username), key, doc, **body.model_dump()
    )
    return _views(request, [row])[0]


@router.get("/translation-reviews/{assignment_id}/source-obligations")
def obligations(
    assignment_id: int, request: Request, principal: PrincipalDep
) -> list[SourceObligationView]:
    return [
        SourceObligationView.model_validate(item)
        for item in _service(request).obligations(get_access(request), assignment_id)
    ]


@router.post(
    "/translation-reviews/{assignment_id}/source-obligations/{cause_id}/resolve"
)
def resolve(
    assignment_id: int,
    cause_id: str,
    body: ResolveSourceObligationRequest,
    request: Request,
    principal: PrincipalDep,
) -> TranslationReviewRecord:
    return _service(request).resolve(
        get_access(request), assignment_id, cause_id, **body.model_dump()
    )
