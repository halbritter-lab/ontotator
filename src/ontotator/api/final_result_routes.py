"""Explicit result selection and final export acknowledgements."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ontotator.api.identity import PrincipalDep
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import RowRefView
from ontotator.application.final_results import FinalResultService
from ontotator.auth.audit import Actor

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["final-results"])


class FinalSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str
    submission_id: str
    expected_revision: int = Field(ge=0)
    acknowledged_cause_ids: list[str] = Field(default_factory=list)


class FinalSelectionView(BaseModel):
    case_id: str
    language: str
    document_id: str
    submission_id: str
    revision: int
    selected_at: datetime | None = None
    updated_at: datetime | None = None
    selected_by: str | None = None
    adjudicator_not_annotator: bool | None = None


class FinalWarning(BaseModel):
    id: str
    code: str
    cause_revision: int
    cause_id: str | None = None
    case_id: str
    language: str
    document_id: str | None = None
    report_id: str | None = None
    assignment_id: int | None = None
    reason: str
    destination: str


class FinalOmission(BaseModel):
    case_id: str
    language: str


class FinalPreflight(BaseModel):
    project: str
    selections: list[FinalSelectionView]
    warnings: list[FinalWarning]
    omissions: list[FinalOmission]
    state_digest: str
    # Rows with a final result and Annotate off: kept, not exported (information).
    not_in_plan: list[RowRefView] = Field(default_factory=list)


class WarningAcknowledgement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    cause_revision: int


class FinalExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=128)
    state_digest: str = Field(pattern="^[0-9a-f]{64}$")
    acknowledged_warnings: list[WarningAcknowledgement]
    accepted_omissions: list[FinalOmission]


def _service(request: Request, principal: Any) -> FinalResultService:
    return FinalResultService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        get_access(request),
    )


@router.put("/final-selections", response_model=FinalSelectionView)
def select_final(
    key: str, body: FinalSelectionRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, principal).select(
        key,
        body.document_id,
        body.submission_id,
        body.expected_revision,
        body.acknowledged_cause_ids,
    )


@router.get("/workflow-warnings", response_model=FinalPreflight)
@router.post("/exports/final/preflight", response_model=FinalPreflight)
def final_preflight(
    key: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, principal).preflight(key)


@router.post("/exports/final")
def final_export(
    key: str, body: FinalExportRequest, principal: PrincipalDep, request: Request
) -> dict[str, int]:
    return _service(request, principal).freeze(key, body.model_dump(mode="json"))
