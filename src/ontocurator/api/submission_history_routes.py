"""Authorized immutable human history, independent of proposal-read rights."""

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from ontocurator.api.encoded_routes import EncodedParameterRoute
from ontocurator.api.identity import PrincipalDep
from ontocurator.api.variant_routes import _repo
from ontocurator.application.round_reads import enrich_inputs
from ontocurator.authz.visibility import current_access, require_case_text
from ontocurator.authz.workflow import may_read_human_submission
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.errors import DomainError
from ontocurator.domain.reanchor_resolution import (
    PendingReanchorRef,
    ReanchorResolution,
)
from ontocurator.domain.review import ReviewDecision
from ontocurator.domain.work_rounds import RoundInputView
from ontocurator.domain.workspace import RoundInputResolution, Submission
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import SubmissionRow
from ontocurator.storage.workflow_tables import RoundSubmissionBindingRow

router = APIRouter(
    prefix="/api/v1/projects/{key}",
    tags=["submission-history"],
    route_class=EncodedParameterRoute,
)


class SubmissionHistorySummary(BaseModel):
    submission_id: str
    document_id: str
    author_label: str
    created_at: datetime
    mode: str
    round_id: str | None = None


class SubmissionHistoryDetail(BaseModel):
    summary: SubmissionHistorySummary
    annotations: list[AnnotationSnapshot]
    evidence: list[EvidenceSnapshot]
    decisions: list[ReviewDecision]
    checked_layer_ids: list[str] = []
    document_checked: bool = False
    reanchor_inputs: list[PendingReanchorRef] = []
    reanchor_resolutions: list[ReanchorResolution] = []
    round_inputs: list[RoundInputView] = []
    round_input_resolutions: list[RoundInputResolution] = []


def _carried_inputs(
    repo: Repository, key: str, round_id: str | None
) -> list[RoundInputView]:
    """The carried inputs of a carry-forward round, read through the caller's scope.

    A reader who may see the submission but not its round (no access rule is
    widened here) gets no inputs instead of an error.
    """
    if round_id is None:
        return []
    try:
        if repo.get_work_round(key, round_id).kind != "carry_forward":
            return []
        return enrich_inputs(repo, key, repo.get_round_input_inventory(key, round_id))
    except DomainError:
        return []


def _history(
    request: Request, key: str, doc: str, sid: str | None = None
) -> list[SubmissionHistorySummary] | SubmissionHistoryDetail:
    repo = _repo(request)
    with repo.db.snapshot() as conn:
        pid = repo._require_project(conn, key)
        access = current_access(conn, repo.access, pid, key)
        require_case_text(conn, access, pid, key, doc)
        query = select(SubmissionRow).where(
            SubmissionRow.project_id == pid, SubmissionRow.document_id == doc
        )
        if sid is not None:
            query = query.where(SubmissionRow.submission_id == sid)
        rows = (
            conn.execute(
                query.order_by(
                    SubmissionRow.created_at.desc(), SubmissionRow.submission_id.desc()
                )
            )
            .mappings()
            .all()
        )
        rows = [
            row
            for row in rows
            if may_read_human_submission(conn, access, pid, key, row["submission_id"])
        ]
        bindings = {
            binding.submission_id: binding.round_id
            for binding in conn.execute(
                select(
                    RoundSubmissionBindingRow.submission_id,
                    RoundSubmissionBindingRow.round_id,
                ).where(
                    RoundSubmissionBindingRow.project_id == pid,
                    RoundSubmissionBindingRow.submission_id.in_(
                        [row["submission_id"] for row in rows]
                    ),
                )
            )
        }
        summaries = [
            SubmissionHistorySummary(
                submission_id=row["submission_id"],
                document_id=doc,
                author_label=row["annotator_id"],
                created_at=row["created_at"],
                mode=row["mode"],
                round_id=bindings.get(row["submission_id"])
                or row["payload"].get("origin_key", {}).get("round_id"),
            )
            for row in rows
        ]
        if sid is None:
            return summaries
        if not rows:
            raise DomainError("VERSION_NOT_FOUND")
        submission = Submission.model_validate(rows[0]["payload"])
        evidence = {
            (e.mention.evidence_id, e.version): e
            for s in submission.snapshots
            for e in s.evidence
        }
    summary = summaries[0]
    return SubmissionHistoryDetail(
        summary=summary,
        annotations=submission.snapshots,
        evidence=list(evidence.values()),
        decisions=submission.decisions,
        checked_layer_ids=submission.checked_layer_ids,
        document_checked=submission.document_checked,
        reanchor_inputs=submission.reanchor_inputs,
        reanchor_resolutions=submission.reanchor_resolutions,
        round_inputs=_carried_inputs(repo, key, summary.round_id),
        round_input_resolutions=submission.round_input_resolutions,
    )


@router.get(
    "/documents/{doc:path}/submissions/{submission_id:path}",
    response_model=SubmissionHistoryDetail,
)
def get_submission_history(
    key: str, doc: str, submission_id: str, request: Request, principal: PrincipalDep
) -> SubmissionHistoryDetail:
    result = _history(request, key, doc, submission_id)
    assert isinstance(result, SubmissionHistoryDetail)
    return result


@router.get(
    "/documents/{doc:path}/submissions", response_model=list[SubmissionHistorySummary]
)
def list_submission_history(
    key: str, doc: str, request: Request, principal: PrincipalDep
) -> list[SubmissionHistorySummary]:
    result = _history(request, key, doc)
    assert isinstance(result, list)
    return result
