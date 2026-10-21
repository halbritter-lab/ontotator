"""Work plan endpoints: chips, plan dialog, Undo, case IDs, discard (lead only)."""

from collections.abc import Sequence
from typing import Any, Self

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.api.identity import PrincipalDep
from ontocurator.api.person_views import PersonRefView
from ontocurator.api.routes import get_access
from ontocurator.application.work_plans import WorkPlanService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action, Task, can
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.work_plans import Preset, TriState

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["work-plans"])


class PlanFlagsView(BaseModel):
    review: bool
    annotate: bool
    review_applicable: bool
    discarded: bool = False
    # False only for undecided rows (documents overview VD3). A factory
    # default keeps the field optional in the generated types (older fixtures
    # and clients omit it; absent means decided).
    decided: bool = Field(default_factory=lambda: True)


class RowRefView(BaseModel):
    case_id: str
    language: str


# A selection holds at most this many cases (lead spec D17), as case IDs or as
# the texts of these cases (documents overview VD21).
MAX_SELECTED_CASES = 2000
MAX_SELECTED_ROWS = 20000


def require_one_selection(case_ids: Sequence[str], rows: Sequence[RowRefView]) -> None:
    """Exactly one of ``case_ids`` and ``rows`` is non-empty; ``rows`` name at
    most ``MAX_SELECTED_CASES`` distinct cases (``CASE_IDS_TOO_MANY``)."""
    if bool(case_ids) == bool(rows):
        raise ValueError("send exactly one of case_ids and rows")
    if len({row.case_id for row in rows}) > MAX_SELECTED_CASES:
        raise DomainError("CASE_IDS_TOO_MANY", {"max": MAX_SELECTED_CASES})


class WithdrawnTaskView(BaseModel):
    assignment_id: int
    case_id: str
    language: str
    task: Task
    person: PersonRefView


class OpenReportView(BaseModel):
    report_id: str
    case_id: str
    language: str
    assignment_id: int | None = None
    held: bool = False


class ConsequencesView(BaseModel):
    withdrawn: list[WithdrawnTaskView]
    finals_leaving: list[RowRefView]
    restored: list[RowRefView]
    open_reports: list[OpenReportView] = Field(default_factory=list)


class UndoRowView(BaseModel):
    case_id: str
    language: str
    review: bool
    annotate: bool
    restored_revision: int | None = None


class UndoView(BaseModel):
    rows: list[UndoRowView]
    revisions: dict[str, int]


class AcceptExternalReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)


class PlanRowPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review: bool | None = None
    annotate: bool | None = None
    expected_revision: int
    confirm: bool = False
    accept_external_review: AcceptExternalReview | None = None


class PlanRowResult(BaseModel):
    case_id: str
    language: str
    flags: PlanFlagsView
    revision: int
    undo: UndoView
    withdrawn: list[WithdrawnTaskView]
    accepted_document_ids: list[str]


class LanguageChangeView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    review: TriState = "keep"
    annotate: TriState = "keep"


class BulkAcceptance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    languages: list[str] = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=2000)


class BulkPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # The selection: whole cases, or single texts (VD21); exactly one is sent.
    case_ids: list[str] = Field(default_factory=list, max_length=MAX_SELECTED_CASES)
    rows: list[RowRefView] = Field(default_factory=list, max_length=MAX_SELECTED_ROWS)
    # "source" = each case's source row(s).
    languages: dict[str, LanguageChangeView] = Field(default_factory=dict)
    preset: Preset | None = None
    accept_external_review: BulkAcceptance | None = None
    expected_revisions: dict[str, int] | None = None
    confirm: bool = False

    @model_validator(mode="after")
    def _one_selection(self) -> Self:
        require_one_selection(self.case_ids, self.rows)
        return self


class MixedCountView(BaseModel):
    on: int
    off: int


class LanguagePreviewView(BaseModel):
    key: str  # "source" or a language code
    source_languages: list[str]  # for key "source", e.g. ["en", "fr"]
    cases_in_selection: int
    review: MixedCountView | None  # None for "source"
    annotate: MixedCountView
    will_change: int  # rows whose flags change
    not_accepted: int  # rule on, Annotate on, Review off, translation not accepted
    not_acceptable: int = 0  # of these: rejected/queried or with an open review
    in_review: int = 0  # subset of not_acceptable with an open translation review
    marked_in_package: int


class BulkPreview(BaseModel):
    cases: int
    languages: list[LanguagePreviewView]
    changes: int
    to_assign: dict[str, int]
    consequences: ConsequencesView
    invalid: list[RowRefView]
    revisions: dict[str, int]
    rule_on: bool
    # With ``rows``: selected texts the change does not reach (unknown, fully
    # discarded, or no change for their language), in (case, language) order.
    skipped_rows: list[RowRefView] = Field(default_factory=list)


class BulkResult(BaseModel):
    changed_rows: int
    revisions: dict[str, int]
    undo: UndoView
    withdrawn: list[WithdrawnTaskView]
    # As ``BulkPreview.skipped_rows`` (bulk saves with ``rows`` only).
    skipped_rows: list[RowRefView] = Field(default_factory=list)


class PlanRowsSet(BaseModel):
    """Exact flags per row (bulk Undo). ``undo`` restores ``restored_revision``,
    never creates PLAN_RESTORED and needs ``confirm`` only when it withdraws
    tasks assigned after the change (D22)."""

    model_config = ConfigDict(extra="forbid")
    rows: list[UndoRowView] = Field(min_length=1, max_length=20000)
    expected_revisions: dict[str, int]
    undo: bool = False
    confirm: bool = False


class AnnotationTargetPreview(BaseModel):
    rows_over_target: int


class CaseIdLookup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(max_length=5000)


class CaseIdLookupResult(BaseModel):
    found: list[str]
    unknown: list[str]


class DiscardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)
    confirm: bool = False


class DiscardResult(BaseModel):
    case_id: str
    language: str
    discarded_document_ids: list[str]
    flags: PlanFlagsView
    revision: int
    withdrawn: list[WithdrawnTaskView]


def _service(request: Request, key: str, principal: Any) -> WorkPlanService:
    access = get_access(request)
    if not can(access, Action.VIEW_PROJECT, key):
        raise DomainError("PROJECT_NOT_FOUND")
    if not can(access, Action.MANAGE_ASSIGNMENTS, key):
        raise AccessDenied("NOT_ALLOWED")
    return WorkPlanService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        access,
    )


@router.get(
    "/work-plans/annotation-target-preview", response_model=AnnotationTargetPreview
)
def annotation_target_preview(
    key: str,
    principal: PrincipalDep,
    request: Request,
    annotations_per_text: int = Query(ge=1, le=5),
) -> dict[str, int]:
    return _service(request, key, principal).annotation_target_preview(
        key, annotations_per_text
    )


@router.post("/work-plans/bulk/preview", response_model=BulkPreview)
def preview_work_plans(
    key: str, body: BulkPlanRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).bulk_preview(key, body)


@router.put("/work-plans/bulk", response_model=BulkResult)
def save_work_plans(
    key: str, body: BulkPlanRequest, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).bulk_save(key, body)


@router.put("/work-plans/rows", response_model=BulkResult)
def set_work_plan_rows(
    key: str, body: PlanRowsSet, principal: PrincipalDep, request: Request
) -> dict[str, Any]:
    return _service(request, key, principal).set_rows(key, body)


@router.patch("/work-plans/{case_id:path}/{language}", response_model=PlanRowResult)
def patch_work_plan(
    key: str,
    case_id: str,
    language: str,
    body: PlanRowPatch,
    principal: PrincipalDep,
    request: Request,
) -> dict[str, Any]:
    return _service(request, key, principal).patch_row(key, case_id, language, body)


@router.post("/case-ids/lookup", response_model=CaseIdLookupResult)
def lookup_case_ids(
    key: str, body: CaseIdLookup, principal: PrincipalDep, request: Request
) -> dict[str, list[str]]:
    return _service(request, key, principal).lookup_case_ids(key, body.ids)


@router.post("/variants/{document_id:path}/discard", response_model=DiscardResult)
def discard_variant(
    key: str,
    document_id: str,
    body: DiscardRequest,
    principal: PrincipalDep,
    request: Request,
) -> dict[str, Any]:
    return _service(request, key, principal).discard(
        key, document_id, body.reason, body.confirm
    )
