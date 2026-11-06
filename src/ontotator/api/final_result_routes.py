"""Explicit result selection and final export acknowledgements."""

from datetime import datetime
from typing import Any, Literal

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
    # The file of the final export: the T1 bundle with receipt, or
    # Phenopackets derived from the same frozen results (#308).
    format: Literal["t1", "phenopacket"] = "t1"


class AgreementValues(BaseModel):
    """F1 values (``modifier_agreement`` a share); None without anything to compare."""

    annotation_strict_f1: float | None
    annotation_tolerant_f1: float | None
    mention_strict_f1: float | None
    mention_tolerant_f1: float | None
    term_f1: float | None
    modifier_agreement: float | None


class AgreementCounts(BaseModel):
    findings_a: int
    findings_b: int
    equal: int
    compatible: int
    axis_conflicts: int
    term_conflicts: int
    a_only: int
    b_only: int
    mentions_a: int
    mentions_b: int
    mentions_equal: int
    mentions_compatible: int
    terms_a: int
    terms_b: int
    terms_equal: int
    modifiers_compared: int
    modifiers_agreeing: int


class AgreementMacroMean(AgreementValues):
    """Mean over texts of each text's mean over its pairs."""

    texts: int
    pairs: int


class AgreementPooled(AgreementCounts, AgreementValues):
    """F1 of the counts summed over every pair (micro average)."""

    texts: int
    pairs: int


class AgreementSummary(BaseModel):
    macro_mean: AgreementMacroMean
    pooled: AgreementPooled


class AnnotatorPairAgreement(AgreementSummary):
    """Every text the two people both annotated."""

    pseudonym_a: str
    pseudonym_b: str


class TextAgreement(AgreementSummary):
    """Every pair of annotators of one text."""

    case_id: str
    language: str
    document_id: str
    text_version: str


class PairAgreement(AgreementCounts, AgreementValues):
    """Two people's annotations of one text: a row of agreement.csv."""

    case_id: str
    language: str
    document_id: str
    text_version: str
    submission_a: str
    pseudonym_a: str
    submission_b: str
    pseudonym_b: str


class ProjectAgreement(BaseModel):
    """The agreement a final export would write now (agreement.csv and
    agreement-summary.csv), for the texts with a final result."""

    project: str
    # The preflight's digest: the same selection as a final export with it.
    state_digest: str
    selected_texts: int
    summary: AgreementSummary
    annotator_pairs: list[AnnotatorPairAgreement]
    texts: list[TextAgreement]
    pairs: list[PairAgreement]


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


@router.get("/agreement", response_model=ProjectAgreement)
def project_agreement(
    key: str, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    """Agreement of the annotations behind the final results, project-wide."""
    return _service(request, principal).agreement(key)


@router.post("/exports/final")
def final_export(
    key: str, body: FinalExportRequest, principal: PrincipalDep, request: Request
) -> dict[str, int]:
    # A T1 request is stored without ``format``, as before #308, so that a
    # replayed older request matches its stored one.
    exclude = {"format"} if body.format == "t1" else None
    return _service(request, principal).freeze(
        key, body.model_dump(mode="json", exclude=exclude)
    )
