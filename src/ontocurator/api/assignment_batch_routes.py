"""Batch assignment and the Documents selection summary (lead only, D21)."""

from __future__ import annotations

from typing import Any, Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator.api.assignment_routes import AssignmentView, _guard, _views
from ontocurator.api.document_projection import AssignmentFilter
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.person_views import PersonRefView
from ontocurator.api.routes import get_access
from ontocurator.application.document_rows import PlanFilter, RowQuery
from ontocurator.assignments.batch import BatchAssignmentService, BatchSpec
from ontocurator.auth.audit import Actor
from ontocurator.domain.next_steps import Segment, Stage, StepCode
from ontocurator.domain.variants import TranslationStatus, VariantOrigin

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["assignments"])

BatchTask = Literal["translation_review", "annotate", "review"]


class DocumentRowFilters(BaseModel):
    """The Documents filters, same names and values as its query parameters."""

    model_config = ConfigDict(extra="forbid")
    language: str | None = None
    case: str | None = None
    segment: Segment | None = None
    step: StepCode | None = None
    stage: Stage | None = None
    owner: str | None = None
    plan: PlanFilter | None = None
    final: Literal["missing", "none"] | None = None
    origin: VariantOrigin | None = None
    translation_status: (
        TranslationStatus | Literal["accepted_without_review"] | None
    ) = None
    status: AssignmentFilter | None = None

    def query(self, sort: str = "case") -> RowQuery:
        return RowQuery(**self.model_dump(), sort=sort)  # type: ignore[arg-type]


class BatchAssignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: BatchTask
    language: str
    # The selection; the server orders it by ``sort`` (Documents order).
    case_ids: list[str] = Field(min_length=1, max_length=2000)
    sort: Literal["case", "import", "activity"] = "case"
    # The Documents filters of the dialog; the case order depends on ``sort``
    # only, and every selected case keeps its place whatever the filters hide.
    filters: DocumentRowFilters = Field(default_factory=DocumentRowFilters)
    mode: Literal["one", "split"]
    usernames: list[str] = Field(default_factory=list, max_length=50)
    # D25: translation review of an externally accepted version.
    review_accepted_translation: bool = False

    @model_validator(mode="after")
    def _one_person(self) -> Self:
        if self.mode == "one" and len(self.usernames) > 1:
            raise ValueError("mode 'one' takes at most one username")
        return self

    def spec(self) -> BatchSpec:
        return BatchSpec(
            task=self.task,
            language=self.language,
            case_ids=tuple(self.case_ids),
            mode=self.mode,
            usernames=tuple(self.usernames),
            sort=self.sort,
            review_accepted_translation=self.review_accepted_translation,
        )


class BatchAssignBody(BatchAssignRequest):
    expected_preview_digest: str
    confirm_language: bool = False

    @model_validator(mode="after")
    def _someone(self) -> Self:
        if not self.usernames:
            raise ValueError("choose at least one person")
        return self


class BatchSkipView(BaseModel):
    case_id: str
    language: str
    reason: Literal[
        "waiting_for_review",
        "not_in_plan",
        "already_assigned",
        "step_differs",
        "discarded",
    ]


class BatchTargetView(BaseModel):
    case_id: str
    language: str
    document_id: str
    version: int
    remaining: int
    usernames: list[str]


class BatchPersonView(BaseModel):
    username: str
    person: PersonRefView
    reads: list[str]
    open_before: int
    open_after: int
    gets: int
    first_case: str | None
    last_case: str | None
    language_mismatch: bool
    unavailable: Literal["does_not_read", "role_missing", "inactive"] | None
    already_assigned: int


class BatchPreview(BaseModel):
    task: str
    language: str
    versions: int
    targets: list[BatchTargetView]
    skipped: list[BatchSkipView]
    people: list[BatchPersonView]
    per_text: int
    digest: str
    # "Split evenly" with too few people: the most open slots of one target
    # ("Choose at least n annotators for n annotations per text"); no usernames.
    needs_people: int | None = None


class BatchAssignResult(BaseModel):
    created: list[AssignmentView]


class SelectionSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_ids: list[str] = Field(min_length=1, max_length=2000)
    filters: DocumentRowFilters = Field(default_factory=DocumentRowFilters)


class AssignableStepView(BaseModel):
    task: str
    language: str
    versions: int
    cases: int


class SelectionSummary(BaseModel):
    """Assignable steps of the selected cases (D21).

    ``steps``: per (task, language) the versions and cases whose row has that
    task's assign step, most versions first (then most cases, then task and
    language). ``common`` is the first of ``steps`` (None when nothing is
    assignable), the step the dialog preselects; ``skipped`` counts the
    selected cases that ``common`` does not reach, by skip reason.
    ``not_shown`` counts selected cases the current filters hide; filters
    never change ``steps``, ``common`` or ``skipped``.
    """

    cases: int
    steps: list[AssignableStepView]
    skipped: dict[str, int]
    common: AssignableStepView | None
    not_shown: int = 0


def _service(request: Request, principal: Any) -> BatchAssignmentService:
    return BatchAssignmentService(
        request.app.state.repo.db,
        Actor.user(principal.user_id, principal.username),
        get_access(request),
    )


@router.post("/assignments/batch/preview", response_model=BatchPreview)
def preview_assignment_batch(
    key: str, body: BatchAssignRequest, request: Request, principal: PrincipalDep
) -> dict[str, Any]:
    """Targets, skipped cases and people of a batch; nothing is written."""
    _guard(request, key)
    return _service(request, principal).preview(key, body.spec())


@router.post("/assignments/batch")
def commit_assignment_batch(
    key: str, body: BatchAssignBody, request: Request, principal: PrincipalDep
) -> BatchAssignResult:
    """Every assignment of the preview in one transaction, or none (409)."""
    _guard(request, key)
    created = _service(request, principal).commit(
        key,
        body.spec(),
        expected_digest=body.expected_preview_digest,
        confirm_language=body.confirm_language,
    )
    return BatchAssignResult(created=_views(request, created))


@router.post("/document-rows/selection-summary", response_model=SelectionSummary)
def selection_summary(
    key: str, body: SelectionSummaryRequest, request: Request, principal: PrincipalDep
) -> dict[str, Any]:
    """Assignable steps of the selected cases and the common one."""
    _guard(request, key)
    return _service(request, principal).selection_summary(
        key, body.case_ids, body.filters.query()
    )
