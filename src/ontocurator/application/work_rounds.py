"""Transactional, exact-input attempts; immutable history stays in place."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, func, insert, select, update

from ontocurator.application.workflow_guards import require_task_writable
from ontocurator.assignments.eligibility import require_annotation_gate
from ontocurator.assignments.service import MODE_FOR_TASK, AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.authority import lock_user_authority
from ontocurator.authz.policy import Access, Action, can, may_take
from ontocurator.authz.visibility import current_access, require_document
from ontocurator.domain.annotations import AnnotationRef, AnnotationSnapshot, snapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.reanchor import (
    Carried,
    NeedsReview,
    reanchor_annotation,
    text_map,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import TaskScope, build_scope
from ontocurator.domain.serialization import encode_snapshot
from ontocurator.domain.work_rounds import (
    CARRY_ROUND_KINDS,
    TEXT_CHANGE_ROUND_KINDS,
    DraftSnapshotPayload,
    RoundKind,
    WorkRoundView,
    is_exact_ancestor,
)
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.storage.database import Database
from ontocurator.storage.overview_tables import DraftSnapshotRow
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import (
    RoundInputRow,
    RoundWorkspaceBindingRow,
    WorkflowCommandReceiptRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


def _input_payload(
    iid: str,
    sid: str | None,
    original: AnnotationSnapshot,
    target: AnnotationSnapshot | None,
    mapped: Carried | NeedsReview,
    *,
    did: int | None = None,
) -> dict[str, Any]:
    """The stored payload of one frozen round input.

    ``review_reason`` names why a carried finding could not be re-anchored; it
    is stored for new rounds only (older payloads have no such key). An input
    of a frozen draft (``did``, kind ``text_change``) has no source submission
    and stores ``source_draft_snapshot_id``; submission inputs keep their
    payload shape (``RoundInputView`` forbids unknown keys).
    """
    payload: dict[str, Any] = {
        "input_id": iid,
        "source_submission_id": sid,
        "source_ref": {
            "annotation_id": original.annotation.annotation_id,
            "version": original.version,
        },
        "source_snapshot": encode_snapshot(original),
        "target_snapshot": encode_snapshot(target) if target else None,
        "mapping_status": "carried" if target else "needs_review",
        "review_reason": (
            mapped.reason
            if target is None and isinstance(mapped, NeedsReview)
            else None
        ),
    }
    if did is not None:
        payload["source_draft_snapshot_id"] = did
    return payload


@dataclass(frozen=True)
class RoundSource:
    """One round source: a submission, or a frozen draft (kind ``text_change``)."""

    snapshots: list[AnnotationSnapshot]
    origin_key: WorkspaceKey
    scope: TaskScope | None
    source_submission_id: str | None
    source_draft_snapshot_id: int | None


def require_independent(
    conn: Connection,
    pid: int,
    *,
    case_id: str,
    language: str,
    user_id: int,
    pseudonym: str,
    excluding: int | None,
) -> None:
    """A handover owner has no own annotation on any version of the row (I3).

    Refused (``HANDOVER_NOT_INDEPENDENT``) when the person holds a non-revoked
    annotate assignment (other than ``excluding``) or an annotation submission
    on any version of ``(case_id, language)``; also with "Annotations per
    text = 1" (spec open question 2).
    """
    row_documents = select(DocumentRow.document_id).where(
        DocumentRow.project_id == pid,
        DocumentRow.case_id == case_id,
        DocumentRow.language == language,
    )
    assigned = select(AssignmentRow.id).where(
        AssignmentRow.project_id == pid,
        AssignmentRow.user_id == user_id,
        AssignmentRow.task == "annotate",
        AssignmentRow.revoked_at.is_(None),
        AssignmentRow.document_id.in_(row_documents),
    )
    if excluding is not None:
        assigned = assigned.where(AssignmentRow.id != excluding)
    submitted = select(SubmissionRow.submission_id).where(
        SubmissionRow.project_id == pid,
        SubmissionRow.annotator_id == pseudonym,
        SubmissionRow.mode.in_(["independent", "assisted"]),
        SubmissionRow.document_id.in_(row_documents),
    )
    if (
        conn.execute(assigned.limit(1)).first() is not None
        or conn.execute(submitted.limit(1)).first() is not None
    ):
        raise DomainError("HANDOVER_NOT_INDEPENDENT")


class WorkRoundService:
    def __init__(self, db: Database):
        self.db = db
        self.repo = Repository(db)

    def bind_legacy(
        self, access: Access, actor: Actor, assignment_id: int, key: WorkspaceKey
    ) -> WorkRoundView:
        """Bind an explicitly opened historical key without rewriting its payloads."""
        from ontocurator.storage.repository import _workspace_aliases
        from ontocurator.storage.tables import SubmissionRow
        from ontocurator.storage.workflow_tables import RoundSubmissionBindingRow

        with self.db.transaction() as conn:
            project = AssignmentService._locate(conn, assignment_id)
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
            )
            conn.execute(
                select(func.pg_advisory_xact_lock(_lock_id("project", project)))
            )
            lock_user_authority(conn, access.user_id)
            pid = self.repo._require_project(conn, project)
            fresh = current_access(conn, access, pid, project)
            assignment = AssignmentService._locked(conn, assignment_id)
            if (
                assignment["user_id"] != fresh.user_id
                or key.annotator_id != fresh.pseudonym
                or key.project_key != project
                or key.document_id != assignment["document_id"]
            ):
                raise AccessDenied("NOT_ALLOWED")
            found = conn.execute(
                select(RoundWorkspaceBindingRow.round_id).where(
                    RoundWorkspaceBindingRow.project_id == pid,
                    RoundWorkspaceBindingRow.workspace_key.in_(_workspace_aliases(key)),
                )
            ).scalar_one_or_none()
            if found:
                return self.repo.get_work_round(project, found)
            if assignment["active_round_id"] is not None or key.round_id is not None:
                raise DomainError("ROUND_KEY_MISMATCH")
            require_document(conn, fresh, pid, project, key.document_id)
            rid = f"round-{uuid4().hex}"
            draft = self.repo._open_draft(conn, key, None)
            now = datetime.now(UTC)
            conn.execute(
                insert(WorkRoundRow).values(
                    round_id=rid,
                    project_id=pid,
                    assignment_id=assignment_id,
                    document_id=key.document_id,
                    annotator_id=key.annotator_id,
                    kind="ordinary",
                    mode=key.mode,
                    input_manifest_sha256=canonical_hash(
                        {
                            "legacy_key": key.model_dump(),
                            "targets": draft.targets.model_dump(),
                        }
                    ),
                    input_submission_ids=[],
                    workspace_key=key.model_dump(mode="json"),
                    created_by=actor.user_id,
                    created_at=now,
                )
            )
            submissions = list(
                conn.execute(
                    select(SubmissionRow.submission_id).where(
                        SubmissionRow.project_id == pid,
                        SubmissionRow.local_key.in_(_workspace_aliases(key)),
                    )
                ).scalars()
            )
            latest = assignment["last_submission_id"]
            if latest is not None and latest not in submissions:
                raise DomainError(
                    "AMBIGUOUS_SUBMISSION_ORIGIN",
                    "Selected workspace is not the assignment's authoritative result",
                )
            conn.execute(
                insert(WorkRoundStateRow).values(
                    round_id=rid,
                    state="submitted"
                    if assignment["status"] == "submitted"
                    else "editable",
                    revision=1,
                    latest_submission_id=latest,
                )
            )
            for alias in _workspace_aliases(key):
                conn.execute(
                    insert(RoundWorkspaceBindingRow).values(
                        project_id=pid, workspace_key=alias, round_id=rid
                    )
                )
            for sid in submissions:
                conn.execute(
                    insert(RoundSubmissionBindingRow).values(
                        project_id=pid, submission_id=sid, round_id=rid
                    )
                )
            conn.execute(
                update(AssignmentRow)
                .where(AssignmentRow.id == assignment_id)
                .values(
                    active_round_id=rid,
                    workflow_revision=AssignmentRow.workflow_revision + 1,
                )
            )
            return self.repo.get_work_round(project, rid)

    def create(
        self,
        access: Access,
        actor: Actor,
        assignment_id: int,
        *,
        request_id: str,
        expected_workflow_revision: int,
        kind: RoundKind = "ordinary",
        source_submission_ids: list[str] | None = None,
        reason: str | None = None,
    ) -> WorkRoundView:
        sources = list(source_submission_ids or [])
        if len(sources) != len(set(sources)):
            raise DomainError("ROUND_INPUT_INVALID", "Repeated source submission")
        request_hash = canonical_hash(
            {
                "assignment_id": assignment_id,
                "kind": kind,
                "sources": sources,
                "revision": expected_workflow_revision,
                "reason": reason,
            }
        )
        with self.db.transaction() as conn:
            project = AssignmentService._locate(conn, assignment_id)
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", project)))
            )
            conn.execute(
                select(func.pg_advisory_xact_lock(_lock_id("project", project)))
            )
            lock_user_authority(conn, access.user_id)
            pid = self.repo._require_project(conn, project)
            fresh = current_access(conn, access, pid, project)
            require_document(
                conn,
                fresh,
                pid,
                project,
                AssignmentService._get(conn, assignment_id).document_id,
            )
            assignment = AssignmentService._locked(conn, assignment_id)
            lead = can(fresh, Action.MANAGE_ASSIGNMENTS, project)
            if actor.user_id != fresh.user_id or not (
                lead
                or (
                    assignment["user_id"] == fresh.user_id
                    and may_take(fresh, project, assignment["task"])
                )
            ):
                raise AccessDenied("NOT_ALLOWED")
            actor_key = str(access.user_id)
            receipt = (
                conn.execute(
                    select(WorkflowCommandReceiptRow).where(
                        WorkflowCommandReceiptRow.project_id == pid,
                        WorkflowCommandReceiptRow.actor_key == actor_key,
                        WorkflowCommandReceiptRow.request_id == request_id,
                    )
                )
                .mappings()
                .one_or_none()
            )
            if receipt:
                if receipt["request_hash"] != request_hash:
                    raise DomainError("WORKFLOW_REQUEST_CONFLICT")
                return WorkRoundView.model_validate(receipt["response"])
            if kind in TEXT_CHANGE_ROUND_KINDS:
                # Only the text-change operations create these rounds; they
                # record the lead's decision with the round (TextChangeService).
                raise DomainError("ROUND_KIND_INVALID")
            owner = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == assignment["user_id"])
            ).scalar_one()
            result = self.create_in(
                conn,
                project=project,
                pid=pid,
                actor=actor,
                assignment=assignment,
                kind=kind,
                sources=sources,
                draft_sources=[],
                reason=reason,
                expected_workflow_revision=expected_workflow_revision,
                lead=lead,
                owner=owner,
            )
            now = datetime.now(UTC)
            conn.execute(
                insert(WorkflowCommandReceiptRow).values(
                    project_id=pid,
                    actor_key=actor_key,
                    request_id=request_id,
                    request_hash=request_hash,
                    response=result.model_dump(mode="json"),
                    created_at=now,
                )
            )
            record_audit(
                conn,
                actor,
                "round.create",
                target_type="work_round",
                target_id=result.round_id,
                project_id=pid,
                details={
                    "kind": kind,
                    "assignment_id": assignment_id,
                    "sources": sources,
                    "reason": reason,
                },
                at=now,
            )
            return result

    def _round_source(
        self, conn: Connection, project: str, pid: int, source: str | int
    ) -> RoundSource:
        """One round source: a submission ID or a ``draft_snapshots`` ID."""
        if isinstance(source, str):
            submission = self.repo.get_submission(source, project)
            if submission is None:
                raise DomainError("SUBMISSION_NOT_FOUND")
            return RoundSource(
                snapshots=list(submission.snapshots),
                origin_key=submission.origin_key,
                scope=submission.scope,
                source_submission_id=source,
                source_draft_snapshot_id=None,
            )
        stored = conn.execute(
            select(DraftSnapshotRow.payload).where(
                DraftSnapshotRow.project_id == pid, DraftSnapshotRow.id == source
            )
        ).scalar_one_or_none()
        if stored is None:
            raise DomainError("ROUND_INPUT_INVALID", "Unknown draft snapshot")
        payload = DraftSnapshotPayload.model_validate(stored)
        return RoundSource(
            snapshots=payload.snapshots,
            origin_key=payload.origin_key,
            scope=payload.scope,
            source_submission_id=None,
            source_draft_snapshot_id=source,
        )

    def create_in(
        self,
        conn: Connection,
        *,
        project: str,
        pid: int,
        actor: Actor,
        assignment: Mapping[Any, Any],
        kind: RoundKind,
        sources: list[str],
        draft_sources: list[int],
        reason: str | None,
        expected_workflow_revision: int,
        lead: bool,
        owner: str,
    ) -> WorkRoundView:
        """Create the round on the caller's transaction (exclusive project lock).

        Writes neither a command receipt nor an audit event: ``create`` and
        the text-change operations record their own. ``owner`` is the
        assignee's pseudonym; ``lead`` whether the actor manages assignments.
        ``draft_sources`` are ``draft_snapshots`` IDs (kind ``text_change``).
        """
        assignment_id = int(assignment["id"])
        if assignment["workflow_revision"] != expected_workflow_revision:
            raise DomainError("WORKFLOW_REVISION_CONFLICT")
        if assignment["task"] not in MODE_FOR_TASK:
            raise DomainError(
                "ROUND_KIND_INVALID", "This endpoint handles annotation rounds"
            )
        mode = MODE_FOR_TASK[assignment["task"]]
        prior_id = assignment["active_round_id"]
        if kind == "consolidation" and (
            (
                prior_id
                and self.repo.get_work_round(project, prior_id).state == "editable"
            )
            or (not prior_id and assignment["status"] in {"in_progress", "reopened"})
        ):
            raise DomainError(
                "ROUND_ACTIVE", "Finish or explicitly restart existing work first"
            )
        require_task_writable(conn, assignment_id)
        if kind == "clean_restart" and not lead:
            raise AccessDenied("RESTART_AGREEMENT_REQUIRED")
        if kind == "ordinary" and (
            prior_id
            or assignment["last_submission_id"]
            or assignment["status"] != "open"
        ):
            raise DomainError("ROUND_ALREADY_EXISTS")
        if kind == "clean_restart" and (not prior_id or not (reason or "").strip()):
            raise DomainError("ROUND_REASON_REQUIRED")
        if kind == "consolidation" and (
            not lead or mode != "review" or len(sources) < 2
        ):
            raise DomainError(
                "ROUND_INPUT_INVALID",
                "Consolidation needs a reviewer and at least two selected submissions",
            )
        if kind == "carry_forward" and (mode != "independent" or len(sources) != 1):
            raise DomainError(
                "ROUND_INPUT_INVALID", "Carry-forward needs one own submission"
            )
        if kind == "text_change" and (
            not lead or mode != "independent" or sources or len(draft_sources) != 1
        ):
            raise DomainError(
                "ROUND_INPUT_INVALID", "A text change carries one frozen draft"
            )
        if kind == "handover" and (
            not lead or mode != "independent" or len(sources) != 1
        ):
            raise DomainError(
                "ROUND_INPUT_INVALID", "A handover is a lead's carry of one submission"
            )
        if kind in {"ordinary", "clean_restart"} and sources:
            raise DomainError("ROUND_INPUT_INVALID")
        if kind != "text_change" and draft_sources:
            raise DomainError("ROUND_INPUT_INVALID")
        require_annotation_gate(conn, pid, assignment["document_id"])
        profile = self.repo.get_task_profile(project)
        separate_contributors = conn.execute(
            select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
        ).scalar_one()
        scope = build_scope(profile, mode)
        document = self.repo.get_document(project, assignment["document_id"])
        assert document is not None
        variants = {v.document_id: v for v in self.repo.list_variants(project)}
        if kind == "handover":
            row_variant = variants[document.document_id]
            require_independent(
                conn,
                pid,
                case_id=row_variant.case_id,
                language=row_variant.language,
                user_id=int(assignment["user_id"]),
                pseudonym=owner,
                excluding=assignment_id,
            )
        rid = f"round-{uuid4().hex}"
        inputs: list[dict[str, Any]] = []
        items: list[str | int] = [*sources, *draft_sources]
        for item in items:
            source = self._round_source(conn, project, pid, item)
            sid = source.source_submission_id
            did = source.source_draft_snapshot_id
            if (
                kind == "consolidation"
                and separate_contributors
                and source.origin_key.annotator_id == owner
            ):
                raise DomainError(
                    "ROUND_INPUT_INVALID",
                    "The reviewer contributed a selected input",
                )
            if (
                source.scope is not None
                and source.scope.scope_id
                != build_scope(profile, source.origin_key.mode).scope_id
            ):
                raise DomainError(
                    "ROUND_INPUT_INVALID",
                    "The source profile differs from this round",
                )
            if sid is not None:
                bound = self.repo.get_round_for_submission(project, sid)
                if bound is None:
                    authoritative = conn.execute(
                        select(AssignmentRow.id)
                        .join(UserRow, UserRow.id == AssignmentRow.user_id)
                        .where(
                            AssignmentRow.project_id == pid,
                            AssignmentRow.document_id == source.origin_key.document_id,
                            UserRow.pseudonym == source.origin_key.annotator_id,
                            AssignmentRow.last_submission_id == sid,
                            AssignmentRow.revoked_at.is_(None),
                        )
                    ).first()
                    if authoritative is None:
                        raise DomainError("ROUND_INPUT_STALE")
                if bound is not None and (
                    bound.state != "submitted"
                    or not bound.active
                    or bound.latest_submission_id != sid
                ):
                    raise DomainError("ROUND_INPUT_STALE")
            if kind in CARRY_ROUND_KINDS:
                own = source.origin_key.annotator_id == owner
                if source.origin_key.mode != "independent" or (
                    own if kind == "handover" else not own
                ):
                    raise DomainError(
                        "ROUND_INPUT_INVALID",
                        "A handover carries the annotation of another author"
                        if kind == "handover"
                        else "Carry-forward is private to its author",
                    )
                if not is_exact_ancestor(
                    variants, document.document_id, source.origin_key.document_id
                ):
                    raise DomainError(
                        "ROUND_INPUT_INVALID",
                        "Source must be an exact correction ancestor",
                    )
            elif source.origin_key.document_id != document.document_id or any(
                s.text_sha256 != document.text_sha256 for s in source.snapshots
            ):
                raise DomainError(
                    "ROUND_INPUT_INVALID",
                    "Consolidation inputs require the exact target text",
                )
            old_document = self.repo.get_document(
                project, source.origin_key.document_id
            )
            assert old_document is not None
            # One map per source text, not per snapshot: this runs under the
            # exclusive project lock.
            mapping = text_map(old_document.text, document.text)
            for original in source.snapshots:
                if original.annotation.layer_id not in scope.editable_layer_ids:
                    raise DomainError(
                        "ROUND_INPUT_INVALID",
                        "A source layer is outside the current scope",
                    )
                iid = canonical_hash(
                    {
                        "round": rid,
                        "submission": sid,
                        "ref": original.version,
                        "id": original.annotation.annotation_id,
                    }
                    if sid is not None
                    else {
                        "round": rid,
                        "draft_snapshot": did,
                        "ref": original.version,
                        "id": original.annotation.annotation_id,
                    }
                )
                mapped = reanchor_annotation(
                    original,
                    original.evidence,
                    old_document.text,
                    document.text,
                    mapping,
                )
                target = None
                if isinstance(mapped, Carried):
                    evidence = [
                        EvidenceSnapshot.create(
                            EvidenceMention(
                                evidence_id=f"input-{iid}-e{index}",
                                segments=[
                                    Segment(start=s.start, end=s.end)
                                    for s in ev.segments
                                ],
                                cue_segments=[
                                    Segment(start=s.start, end=s.end)
                                    for s in ev.cue_segments
                                ],
                            ),
                            document,
                        )
                        for index, ev in enumerate(mapped.evidence)
                    ]
                    annotation = original.annotation.model_copy(
                        deep=True,
                        update={
                            "annotation_id": f"input-{iid}",
                            "document_id": document.document_id,
                            "evidence_refs": [
                                EvidenceRef(
                                    evidence_id=e.mention.evidence_id,
                                    version=e.version,
                                )
                                for e in evidence
                            ],
                            "provenance": original.annotation.provenance.model_copy(
                                update={"source_refs": [f"round-input:{iid}"]}
                            ),
                        },
                    )
                    target = snapshot(annotation, evidence, document, profile)
                inputs.append(
                    _input_payload(iid, sid, original, target, mapped, did=did)
                )
        targets = ReviewTargetSet.create(
            [
                AnnotationRef(
                    annotation_id=i["target_snapshot"]["annotation"]["annotation_id"],
                    version=i["target_snapshot"]["version"],
                )
                for i in inputs
                if i["target_snapshot"] is not None
            ]
            if mode == "review"
            else []
        )
        if mode == "review" and not sources and kind == "ordinary":
            targets = ReviewTargetSet.create(
                [
                    AnnotationRef(
                        annotation_id=s.annotation.annotation_id, version=s.version
                    )
                    for s in self.repo.list_annotations_for_document(
                        project, document.document_id
                    )
                    if s.annotation.layer_id in scope.editable_layer_ids
                ]
            )
        key = WorkspaceKey(
            format_version="ontocurator-workspace-key/v3",
            round_id=rid,
            project_key=project,
            document_id=document.document_id,
            annotator_id=owner,
            mode=mode,
            scope_id=scope.scope_id,
            target_set_id=targets.target_set_id if mode == "review" else "targets-0",
        )
        manifest_content: dict[str, Any] = {
            "submission_ids": sources,
            "inputs": inputs,
            "targets": targets.model_dump(),
        }
        if draft_sources:
            manifest_content["draft_snapshot_ids"] = draft_sources
        manifest = canonical_hash(manifest_content)
        now = datetime.now(UTC)
        conn.execute(
            insert(WorkRoundRow).values(
                round_id=rid,
                project_id=pid,
                assignment_id=assignment_id,
                document_id=document.document_id,
                annotator_id=owner,
                kind=kind,
                mode=mode,
                predecessor_round_id=prior_id,
                input_manifest_sha256=manifest,
                input_submission_ids=sources,
                workspace_key=key.model_dump(mode="json"),
                created_by=actor.user_id,
                created_at=now,
            )
        )
        conn.execute(
            insert(WorkRoundStateRow).values(round_id=rid, state="editable", revision=1)
        )
        conn.execute(
            insert(RoundWorkspaceBindingRow).values(
                project_id=pid, workspace_key=_key_str(key), round_id=rid
            )
        )
        for position, payload in enumerate(inputs):
            conn.execute(
                insert(RoundInputRow).values(
                    input_id=payload["input_id"],
                    project_id=pid,
                    round_id=rid,
                    source_submission_id=payload["source_submission_id"],
                    source_draft_snapshot_id=payload.get("source_draft_snapshot_id"),
                    position=position,
                    payload=payload,
                )
            )
        if prior_id:
            conn.execute(
                update(WorkRoundStateRow)
                .where(WorkRoundStateRow.round_id == prior_id)
                .values(
                    state="abandoned" if kind == "clean_restart" else "superseded",
                    revision=WorkRoundStateRow.revision + 1,
                )
            )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(
                active_round_id=rid,
                workflow_revision=expected_workflow_revision + 1,
                status="open",
                last_submission_id=None,
                updated_at=now,
            )
        )
        self.repo._create_draft(conn, pid, key, _key_str(key), targets)
        if kind == "consolidation":
            # Matching findings are kept automatically (U14, T9); both start
            # paths (the assignment's rounds and the start command) end here.
            from ontocurator.application.consolidation_resolve import (
                take_over_matches,
            )

            take_over_matches(conn, self.repo, pid, key)
        return self.repo.get_work_round(project, rid)


def validate_round_input_resolutions(repo: Repository, draft: Any) -> None:
    """Every carry-forward input must resolve against this exact mutable draft.

    A dismissed input whose carried finding is still in the draft (any
    version) is refused: dismissing removes that finding atomically, so this
    catches drafts dismissed before that rule and findings re-created with the
    carried ID.
    """
    inputs = repo.get_round_input_inventory(draft.key.project_key, draft.key.round_id)
    by_id = {item["input_id"]: item for item in inputs}
    resolutions = {r.input_id: r for r in draft.round_input_resolutions}
    if len(resolutions) != len(draft.round_input_resolutions) or set(
        resolutions
    ) != set(by_id):
        raise DomainError("ROUND_INPUTS_INCOMPLETE")
    snapshots = {(s.annotation.annotation_id, s.version): s for s in draft.annotations}
    present = {s.annotation.annotation_id for s in draft.annotations}
    for iid, resolution in resolutions.items():
        if resolution.outcome == "dismissed":
            carried_id = _carried_annotation_id(by_id[iid])
            if carried_id is not None and carried_id in present:
                raise DomainError(
                    "ROUND_INPUT_CARRIED_FINDING_PRESENT",
                    {"input_id": iid, "annotation_id": carried_id},
                )
            continue
        ref = resolution.annotation_ref
        target = snapshots.get((ref.annotation_id, ref.version)) if ref else None
        source = by_id[iid]["source_snapshot"]["annotation"]
        if target is None or (
            target.annotation.layer_id,
            target.annotation.type_id,
        ) != (source["layer_id"], source["type_id"]):
            raise DomainError("ROUND_INPUT_RESOLUTION_STALE", {"input_id": iid})


def _carried_annotation_id(item: dict[str, Any]) -> str | None:
    """The ID of the finding an input carried into the round, if any."""
    target = item.get("target_snapshot")
    return str(target["annotation"]["annotation_id"]) if target else None


class ResolveRoundInputCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_id: str
    outcome: Literal["completed", "dismissed"]
    annotation_ref: AnnotationRef | None = None
    reason: str | None = None
    remove_carried_finding: bool = False


class ClearRoundInputCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["clear_round_input_resolution"]
    input_id: str


_CLEAR_COMMAND = "clear_round_input_resolution"


class RoundInputResolutionService:
    def __init__(self, repo: Repository):
        self.repo = repo

    def _carry_inputs(self, key: WorkspaceKey) -> dict[str, dict[str, Any]]:
        """The inputs of the carry-forward round of ``key``, by ID."""
        if (
            key.round_id is None
            or self.repo.get_work_round(key.project_key, key.round_id).kind
            not in CARRY_ROUND_KINDS
        ):
            raise DomainError("ROUND_KIND_INVALID")
        return {
            i["input_id"]: i
            for i in self.repo.get_round_input_inventory(key.project_key, key.round_id)
        }

    def resolve(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        """Complete or dismiss one carried input.

        Dismissing an input whose carried finding is still in the draft
        requires ``remove_carried_finding``; the finding and its orphaned
        evidence are then removed in the same mutation.

        Raises:
            DomainError: ``ROUND_KIND_INVALID``, ``ROUND_INPUT_INVALID``,
                ``ROUND_INPUT_CARRIED_FINDING_PRESENT``,
                ``ROUND_INPUT_RESOLUTION_STALE``.
        """
        from ontocurator.application.editing import remove_draft_annotation
        from ontocurator.domain.workspace import RoundInputResolution

        command = ResolveRoundInputCommand.model_validate(envelope.payload)
        if command.remove_carried_finding and command.outcome != "dismissed":
            raise DomainError("ROUND_INPUT_INVALID", {"input_id": command.input_id})
        resolution = RoundInputResolution(
            **command.model_dump(exclude={"remove_carried_finding"})
        )

        def operation(draft: Any) -> Any:
            inputs = self._carry_inputs(key)
            if resolution.input_id not in inputs:
                raise DomainError("ROUND_INPUT_INVALID")
            draft.round_input_resolutions = [
                r
                for r in draft.round_input_resolutions
                if r.input_id != resolution.input_id
            ] + [resolution]
            if resolution.outcome == "dismissed":
                carried_id = _carried_annotation_id(inputs[resolution.input_id])
                if carried_id is not None and any(
                    s.annotation.annotation_id == carried_id for s in draft.annotations
                ):
                    if not command.remove_carried_finding:
                        raise DomainError(
                            "ROUND_INPUT_CARRIED_FINDING_PRESENT",
                            {
                                "input_id": resolution.input_id,
                                "annotation_id": carried_id,
                            },
                        )
                    remove_draft_annotation(draft, carried_id)
            if resolution.outcome == "completed":
                ref = resolution.annotation_ref
                source = inputs[resolution.input_id]["source_snapshot"]["annotation"]
                finding = next(
                    (
                        s
                        for s in draft.annotations
                        if ref
                        and (s.annotation.annotation_id, s.version)
                        == (ref.annotation_id, ref.version)
                    ),
                    None,
                )
                if finding is None or (
                    finding.annotation.layer_id,
                    finding.annotation.type_id,
                ) != (source["layer_id"], source["type_id"]):
                    raise DomainError("ROUND_INPUT_RESOLUTION_STALE")
            return draft

        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result

    def clear(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        """Reset one carried input to unresolved before submission.

        When the input's latest resolution is a dismissal that removed the
        carried finding, that finding is put back exactly as it was at the
        moment of the dismissal (same version, with its evidence), unless a
        finding with its ID exists again. Checked layers are not changed.

        Raises:
            DomainError: ``ROUND_KIND_INVALID``, ``ROUND_INPUT_INVALID`` (unknown
                or unresolved input), ``ROUND_NOT_EDITABLE``.
        """
        command = ClearRoundInputCommand.model_validate(envelope.payload)
        restore: list[tuple[AnnotationSnapshot, list[EvidenceSnapshot]]] = []

        def load(conn: Connection) -> None:
            # Inside the mutation's transaction, after the draft lock.
            restore.clear()
            found = self._removed_finding(conn, key, command.input_id)
            if found is not None:
                restore.append(found)

        def operation(draft: Any) -> Any:
            inputs = self._carry_inputs(key)
            if command.input_id not in inputs or not any(
                r.input_id == command.input_id for r in draft.round_input_resolutions
            ):
                raise DomainError("ROUND_INPUT_INVALID", {"input_id": command.input_id})
            draft.round_input_resolutions = [
                r
                for r in draft.round_input_resolutions
                if r.input_id != command.input_id
            ]
            if restore:
                finding, evidence = restore[0]
                finding_id = finding.annotation.annotation_id
                if not any(
                    s.annotation.annotation_id == finding_id for s in draft.annotations
                ):
                    draft.annotations = [*draft.annotations, finding]
                    known = {(e.mention.evidence_id, e.version) for e in draft.evidence}
                    draft.evidence = [
                        *draft.evidence,
                        *(
                            e
                            for e in evidence
                            if (e.mention.evidence_id, e.version) not in known
                        ),
                    ]
            return draft

        result = self.repo.run_mutation(key, envelope, operation, before_operation=load)
        assert isinstance(result, Draft)
        return result

    def _removed_finding(
        self, conn: Connection, key: WorkspaceKey, input_id: str
    ) -> tuple[AnnotationSnapshot, list[EvidenceSnapshot]] | None:
        """The carried finding the latest resolution of ``input_id`` removed.

        ``None`` unless that resolution is a dismissal with
        ``remove_carried_finding``. The finding is taken from the draft state
        just before that dismissal (the round's initial content at revision 0)
        and loaded from the content-addressed snapshot rows.
        """
        from ontocurator.domain.serialization import decode_snapshot
        from ontocurator.storage.repository import DraftState
        from ontocurator.storage.tables import (
            AnnotationSnapshotRow,
            EditEventRow,
            EvidenceSnapshotRow,
        )

        if key.round_id is None:
            return None
        events = conn.execute(
            self.repo._draft_events(key)
            .where(
                EditEventRow.kind == "edit",
                EditEventRow.command["input_id"].astext == input_id,
            )
            .order_by(EditEventRow.id.desc())
        ).all()
        latest = next(
            (
                e
                for e in events
                if e.command.get("command") == _CLEAR_COMMAND
                or ("outcome" in e.command and "command" not in e.command)
            ),
            None,
        )
        if (
            latest is None
            or latest.command.get("outcome") != "dismissed"
            or latest.command.get("remove_carried_finding") is not True
        ):
            return None
        item = next(
            (
                i
                for i in self.repo.get_round_input_inventory(
                    key.project_key, key.round_id
                )
                if i["input_id"] == input_id
            ),
            None,
        )
        carried_id = _carried_annotation_id(item) if item is not None else None
        if item is None or carried_id is None:
            return None
        version: str | None = None
        if latest.revision_before == 0:
            version = str(item["target_snapshot"]["version"])
        else:
            before = conn.execute(
                self.repo._draft_events(key)
                .where(EditEventRow.revision_after == latest.revision_before)
                .order_by(EditEventRow.id.desc())
                .limit(1)
            ).first()
            if before is not None:
                version = next(
                    (
                        v
                        for i, v in DraftState.from_json(before.state).annotations
                        if i == carried_id
                    ),
                    None,
                )
        if version is None:
            return None
        project_id = self.repo._require_project(conn, key.project_key)
        payload = conn.execute(
            select(AnnotationSnapshotRow.payload).where(
                AnnotationSnapshotRow.project_id == project_id,
                AnnotationSnapshotRow.annotation_id == carried_id,
                AnnotationSnapshotRow.version == version,
            )
        ).scalar_one_or_none()
        if payload is None:
            return None
        finding = decode_snapshot(payload)
        evidence: list[EvidenceSnapshot] = []
        for ref in finding.annotation.evidence_refs:
            stored = conn.execute(
                select(EvidenceSnapshotRow.payload).where(
                    EvidenceSnapshotRow.project_id == project_id,
                    EvidenceSnapshotRow.evidence_id == ref.evidence_id,
                    EvidenceSnapshotRow.version == ref.version,
                )
            ).scalar_one_or_none()
            if stored is not None:
                evidence.append(EvidenceSnapshot.model_validate(stored))
        return finding, evidence


class MergeRoundInputsService:
    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def merge(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        from pydantic import BaseModel, ConfigDict, Field

        from ontocurator.application.consolidation_resolve import (
            merged_annotation,
            review_decision,
        )
        from ontocurator.application.reviews import DecisionCommand, ReviewService
        from ontocurator.domain.serialization import decode_snapshot

        class MergeCommand(BaseModel):
            model_config = ConfigDict(extra="forbid")
            input_ids: list[str] = Field(min_length=2)
            replacement: AnnotationRef
            note: str | None = None

        command = MergeCommand.model_validate(envelope.payload)

        def operation(draft: Draft) -> Draft:
            if (
                key.round_id is None
                or self.repo.get_work_round(key.project_key, key.round_id).kind
                != "consolidation"
            ):
                raise DomainError("ROUND_KIND_INVALID")
            inventory = {
                i["input_id"]: i
                for i in self.repo.get_round_input_inventory(
                    key.project_key, key.round_id
                )
            }
            if len(set(command.input_ids)) != len(command.input_ids) or not set(
                command.input_ids
            ) <= set(inventory):
                raise DomainError("ROUND_INPUT_INVALID")
            original = next(
                (
                    s
                    for s in draft.annotations
                    if (s.annotation.annotation_id, s.version)
                    == (command.replacement.annotation_id, command.replacement.version)
                ),
                None,
            )
            if original is None:
                raise DomainError("REPLACEMENT_NOT_FOUND")
            targets = []
            for iid in command.input_ids:
                raw = inventory[iid]["target_snapshot"]
                if raw is None:
                    raise DomainError("ROUND_INPUT_INVALID")
                source = decode_snapshot(raw)
                if (source.annotation.layer_id, source.annotation.type_id) != (
                    original.annotation.layer_id,
                    original.annotation.type_id,
                ):
                    raise DomainError("REPLACEMENT_LAYER_TYPE_MISMATCH")
                targets.append(
                    AnnotationRef(
                        annotation_id=source.annotation.annotation_id,
                        version=source.version,
                    )
                )
            document = self.repo.get_document(key.project_key, key.document_id)
            assert document is not None
            annotation = merged_annotation(original.annotation, command.input_ids)
            merged = snapshot(
                annotation,
                original.evidence,
                document,
                self.repo.get_task_profile(key.project_key),
            )
            ref = AnnotationRef(
                annotation_id=merged.annotation.annotation_id, version=merged.version
            )
            draft.annotations = [
                merged
                if s.annotation.annotation_id == merged.annotation.annotation_id
                else s
                for s in draft.annotations
            ]
            draft.decisions = [
                d
                for d in draft.decisions
                if d.target not in targets and d.replacement != command.replacement
            ]
            for target in targets:
                ReviewService._discard_abandoned_adoptions(
                    draft,
                    DecisionCommand(
                        target=target,
                        outcome="changed",
                        replacement=ref,
                        note=command.note,
                    ),
                )
                draft.decisions.append(
                    review_decision(
                        key,
                        target,
                        outcome="changed",
                        replacement=ref,
                        note=command.note,
                    )
                )
            draft.checked_layer_ids = [
                lid
                for lid in draft.checked_layer_ids
                if lid != merged.annotation.layer_id
            ]
            return draft

        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result
