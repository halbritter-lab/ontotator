"""Batch assignment and the Documents selection summary (lead only, D21)."""

from __future__ import annotations

from typing import Any, Literal, Self

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontotator.api.assignment_routes import AssignmentView, _guard, _views
from ontotator.api.document_projection import AssignmentFilter
from ontotator.api.identity import PrincipalDep
from ontotator.api.person_views import PersonRefView
from ontotator.api.routes import get_access
from ontotator.api.work_plan_routes import (
    MAX_SELECTED_CASES,
    MAX_SELECTED_ROWS,
    RowRefView,
    require_one_selection,
)
from ontotator.application.document_row_facets import FlagFilter
from ontotator.application.document_rows import (
    Decision,
    FinalFilter,
    Paused,
    PlanFilter,
    ProposalFilter,
    RowQuery,
    Segment,
    Sort,
)
from ontotator.application.work_plans import MAX_CASE_IDS
from ontotator.assignments.batch import BatchAssignmentService, BatchSpec
from ontotator.auth.audit import Actor
from ontotator.domain.next_steps import Stage, StepCode
from ontotator.domain.stage_cells import AnnotationState, FinalState, ReviewState
from ontotator.domain.variants import TranslationStatus, VariantOrigin
from ontotator.domain.work_plans import RowKey

router = APIRouter(prefix="/api/v1/projects/{key}", tags=["assignments"])

BatchTask = Literal["translation_review", "annotate"]


class DocumentRowFilters(BaseModel):
    """The Documents filters, same names and values as its query parameters
    (``document_row_routes._filters`` without ``sort``).

    ``language``, ``origin``, ``step``, ``stage``, ``plan``, the stage states
    and ``waiting_on`` take one value or a list (OR within one filter, AND
    across filters). Filters never change batch targets, their order,
    ``steps``, ``common`` or ``skipped``; they drive ``not_shown``.
    """

    model_config = ConfigDict(extra="forbid")
    language: str | list[str] | None = None
    status: AssignmentFilter | None = None
    q: str | None = None
    origin: VariantOrigin | list[VariantOrigin] | None = None
    translation_status: (
        TranslationStatus | Literal["accepted_without_review"] | None
    ) = None
    decision: Decision | None = None
    final: FinalFilter | None = None
    case: str | None = None
    segment: Segment | None = None
    step: StepCode | list[StepCode] | None = None
    stage: Stage | list[Stage] | None = None
    owner: str | None = None
    assignee: str | None = None
    plan: PlanFilter | list[PlanFilter] | None = None
    paused: Paused | None = None
    review_state: ReviewState | list[ReviewState] | None = None
    annotation_state: AnnotationState | list[AnnotationState] | None = None
    final_state: FinalState | list[FinalState] | None = None
    # "me" or a pseudonym.
    waiting_on: str | list[str] | None = None
    flags: FlagFilter | list[FlagFilter] | None = None
    proposals: ProposalFilter | list[ProposalFilter] | None = None

    @model_validator(mode="after")
    def _exclusive(self) -> Self:
        # As on the rows endpoint (``document_row_routes._filters``).
        if self.decision is not None and self.final is not None:
            raise ValueError("decision and final are mutually exclusive")
        if self.decision is not None and self.segment is not None:
            raise ValueError("decision and segment are mutually exclusive")
        return self

    def query(self, sort: str = "case") -> RowQuery:
        return RowQuery(**self.model_dump(), sort=sort)  # type: ignore[arg-type]


class BatchAssignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: BatchTask
    language: str
    # The selection, whole cases or single texts (VD21; exactly one is sent);
    # the server orders it by ``sort`` (Documents order). With ``rows`` only
    # the selected texts in ``language`` are targeted.
    case_ids: list[str] = Field(default_factory=list, max_length=MAX_SELECTED_CASES)
    rows: list[RowRefView] = Field(default_factory=list, max_length=MAX_SELECTED_ROWS)
    sort: Literal["case", "import", "activity"] = "case"
    # The Documents filters of the dialog; the case order depends on ``sort``
    # only, and every selected case keeps its place whatever the filters hide.
    filters: DocumentRowFilters = Field(default_factory=DocumentRowFilters)
    mode: Literal["one", "split", "each"]
    usernames: list[str] = Field(default_factory=list, max_length=50)
    # D25: translation review of an externally accepted version.
    review_accepted_translation: bool = False
    # VD14: translation reviews of versions whose source text changed.
    review_reason: Literal["source_changed"] | None = None

    @model_validator(mode="after")
    def _valid(self) -> Self:
        require_one_selection(self.case_ids, self.rows)
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
            review_reason=self.review_reason,
            rows=tuple(RowKey(row.case_id, row.language) for row in self.rows),
        )


class BatchAssignBody(BatchAssignRequest):
    expected_preview_digest: str
    confirm_language: bool = False
    # Spec 2026-10-25 §2: annotate translations whose review is not accepted.
    confirm_unreviewed_translation: bool = False

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
        "no_proposals_on_version",
        "other_root_in_review",
    ]
    # Set when only this root of a text with parallel roots is skipped.
    document_id: str | None = None


class BatchTargetView(BaseModel):
    case_id: str
    language: str
    document_id: str
    version: int
    remaining: int
    usernames: list[str]
    # Annotate: the rule is off and the translation is not accepted (the
    # dialog's acknowledgement, spec 2026-10-25 §2).
    unreviewed_translation: bool = False
    # Annotate: the rule is on and the review is underway: the task opens
    # once the review is accepted (issue 213).
    waiting_for_translation_review: bool = False


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
    # A system administrator: the dialog marks them (#177).
    system_admin: bool = False


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
    # Whole cases or single texts (VD21); exactly one is sent.
    case_ids: list[str] = Field(default_factory=list, max_length=MAX_SELECTED_CASES)
    rows: list[RowRefView] = Field(default_factory=list, max_length=MAX_SELECTED_ROWS)
    filters: DocumentRowFilters = Field(default_factory=DocumentRowFilters)

    @model_validator(mode="after")
    def _one_selection(self) -> Self:
        require_one_selection(self.case_ids, self.rows)
        return self

    def keys(self) -> tuple[RowKey, ...]:
        return tuple(RowKey(row.case_id, row.language) for row in self.rows)


class DocumentRowKeysRequest(BaseModel):
    """Texts matching the filters; with ``case_ids`` only texts of these cases
    (Select by case IDs, VD4)."""

    model_config = ConfigDict(extra="forbid")
    filters: DocumentRowFilters = Field(default_factory=DocumentRowFilters)
    case_ids: list[str] = Field(default_factory=list, max_length=MAX_CASE_IDS)
    sort: Sort = "case"


class DocumentRowKeys(BaseModel):
    """Text keys in list order, of at most 2000 cases (``truncated``);
    ``cases`` and ``total`` count every matching case and text."""

    keys: list[RowRefView]
    cases: int
    total: int
    truncated: bool


class AssignableStepView(BaseModel):
    task: str
    language: str
    versions: int
    cases: int


class SelectionSummary(BaseModel):
    """Assignable steps of the selected cases or texts (D21, VD21).

    ``steps``: per (task, language) the versions and cases whose row has that
    task's assign step, most versions first (then most cases, then task and
    language). ``common`` is the first of ``steps`` (None when nothing is
    assignable), the step the dialog preselects; ``skipped`` counts the
    selected cases that ``common`` does not reach, by skip reason.
    ``not_shown`` counts selected cases the current filters hide; filters
    never change ``steps``, ``common`` or ``skipped``.

    With ``rows`` only the selected texts count: ``steps`` count those texts,
    ``skipped`` counts the selected texts in the language of ``common`` that
    it does not reach, ``skipped_rows`` names them and ``not_shown`` counts
    selected texts the filters hide. ``cases`` counts the cases with at
    least one selected text the project knows. Selected texts outside the
    language of ``common`` are not counted in ``skipped``.
    """

    cases: int
    steps: list[AssignableStepView]
    skipped: dict[str, int]
    common: AssignableStepView | None
    not_shown: int = 0
    skipped_rows: list[RowRefView] = Field(default_factory=list)


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
        confirm_unreviewed_translation=body.confirm_unreviewed_translation,
    )
    return BatchAssignResult(created=_views(request, created))


@router.post("/document-rows/selection-summary", response_model=SelectionSummary)
def selection_summary(
    key: str, body: SelectionSummaryRequest, request: Request, principal: PrincipalDep
) -> dict[str, Any]:
    """Assignable steps of the selected cases and the common one."""
    _guard(request, key)
    return _service(request, principal).selection_summary(
        key, body.case_ids, body.filters.query(), body.keys()
    )


@router.post("/document-rows/keys", response_model=DocumentRowKeys)
def document_row_keys(
    key: str, body: DocumentRowKeysRequest, request: Request, principal: PrincipalDep
) -> dict[str, Any]:
    """Text keys matching the filters in list order, of at most 2000 cases."""
    _guard(request, key)
    return _service(request, principal).row_keys(
        key, body.filters.query(body.sort), body.case_ids
    )
