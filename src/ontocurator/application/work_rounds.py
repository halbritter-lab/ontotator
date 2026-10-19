"""Transactional, exact-input attempts; immutable history stays in place."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import func, insert, select, update

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
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.serialization import encode_snapshot
from ontocurator.domain.work_rounds import RoundKind, WorkRoundView
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import AssignmentRow, ProjectRow, UserRow
from ontocurator.storage.workflow_tables import (
    RoundInputRow,
    RoundWorkspaceBindingRow,
    WorkflowCommandReceiptRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


def _input_payload(
    iid: str,
    sid: str,
    original: AnnotationSnapshot,
    target: AnnotationSnapshot | None,
    mapped: Carried | NeedsReview,
) -> dict[str, Any]:
    """The stored payload of one frozen round input.

    ``review_reason`` names why a carried finding could not be re-anchored; it
    is stored for new rounds only (older payloads have no such key).
    """
    return {
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
            if assignment["workflow_revision"] != expected_workflow_revision:
                raise DomainError("WORKFLOW_REVISION_CONFLICT")
            if assignment["task"] not in MODE_FOR_TASK:
                raise DomainError(
                    "ROUND_KIND_INVALID", "This endpoint handles annotation rounds"
                )
            owner = conn.execute(
                select(UserRow.pseudonym).where(UserRow.id == assignment["user_id"])
            ).scalar_one()
            mode = MODE_FOR_TASK[assignment["task"]]
            prior_id = assignment["active_round_id"]
            if kind == "consolidation" and (
                (
                    prior_id
                    and self.repo.get_work_round(project, prior_id).state == "editable"
                )
                or (
                    not prior_id and assignment["status"] in {"in_progress", "reopened"}
                )
            ):
                raise DomainError(
                    "ROUND_ACTIVE", "Finish or explicitly restart existing work first"
                )
            from ontocurator.application.workflow_guards import require_task_writable

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
            if kind in {"ordinary", "clean_restart"} and sources:
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
            rid = f"round-{uuid4().hex}"
            inputs: list[dict[str, Any]] = []
            for sid in sources:
                source = self.repo.get_submission(sid, project)
                if source is None:
                    raise DomainError("SUBMISSION_NOT_FOUND")
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
                if kind == "carry_forward":
                    if (
                        source.origin_key.annotator_id != owner
                        or source.origin_key.mode != "independent"
                    ):
                        raise DomainError(
                            "ROUND_INPUT_INVALID",
                            "Carry-forward is private to its author",
                        )
                    current = variants[document.document_id]
                    seen = set()
                    while current.document_id != source.origin_key.document_id:
                        if (
                            current.document_id in seen
                            or current.origin != "correction"
                            or current.derived_from not in variants
                        ):
                            raise DomainError(
                                "ROUND_INPUT_INVALID",
                                "Source must be an exact correction ancestor",
                            )
                        seen.add(current.document_id)
                        previous = variants[current.derived_from]
                        if (
                            previous.case_id,
                            previous.external_id,
                            previous.language,
                            previous.version + 1,
                        ) != (
                            current.case_id,
                            current.external_id,
                            current.language,
                            current.version,
                        ):
                            raise DomainError("ROUND_INPUT_INVALID")
                        current = previous
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
                    )
                    mapped = reanchor_annotation(
                        original,
                        original.evidence,
                        old_document.text,
                        document.text,
                        text_map(old_document.text, document.text),
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
                    inputs.append(_input_payload(iid, sid, original, target, mapped))
            targets = ReviewTargetSet.create(
                [
                    AnnotationRef(
                        annotation_id=i["target_snapshot"]["annotation"][
                            "annotation_id"
                        ],
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
                target_set_id=targets.target_set_id
                if mode == "review"
                else "targets-0",
            )
            manifest = canonical_hash(
                {
                    "submission_ids": sources,
                    "inputs": inputs,
                    "targets": targets.model_dump(),
                }
            )
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
                insert(WorkRoundStateRow).values(
                    round_id=rid, state="editable", revision=1
                )
            )
            conn.execute(
                insert(RoundWorkspaceBindingRow).values(
                    project_id=pid, workspace_key=_key_str(key), round_id=rid
                )
            )
            for position, item in enumerate(inputs):
                conn.execute(
                    insert(RoundInputRow).values(
                        input_id=item["input_id"],
                        project_id=pid,
                        round_id=rid,
                        source_submission_id=item["source_submission_id"],
                        position=position,
                        payload=item,
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
            result = self.repo.get_work_round(project, rid)
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
                target_id=rid,
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


def validate_round_input_resolutions(repo: Repository, draft: Any) -> None:
    """Every carry-forward input must resolve against this exact mutable draft."""
    inputs = repo.get_round_input_inventory(draft.key.project_key, draft.key.round_id)
    by_id = {item["input_id"]: item for item in inputs}
    resolutions = {r.input_id: r for r in draft.round_input_resolutions}
    if len(resolutions) != len(draft.round_input_resolutions) or set(
        resolutions
    ) != set(by_id):
        raise DomainError("ROUND_INPUTS_INCOMPLETE")
    snapshots = {(s.annotation.annotation_id, s.version): s for s in draft.annotations}
    for iid, resolution in resolutions.items():
        if resolution.outcome == "dismissed":
            continue
        ref = resolution.annotation_ref
        target = snapshots.get((ref.annotation_id, ref.version)) if ref else None
        source = by_id[iid]["source_snapshot"]["annotation"]
        if target is None or (
            target.annotation.layer_id,
            target.annotation.type_id,
        ) != (source["layer_id"], source["type_id"]):
            raise DomainError("ROUND_INPUT_RESOLUTION_STALE", {"input_id": iid})


class RoundInputResolutionService:
    def __init__(self, repo: Repository):
        self.repo = repo

    def resolve(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        from ontocurator.domain.workspace import RoundInputResolution

        resolution = RoundInputResolution.model_validate(envelope.payload)

        def operation(draft: Any) -> Any:
            if (
                key.round_id is None
                or self.repo.get_work_round(key.project_key, key.round_id).kind
                != "carry_forward"
            ):
                raise DomainError("ROUND_KIND_INVALID")
            inputs = {
                i["input_id"]: i
                for i in self.repo.get_round_input_inventory(
                    key.project_key, key.round_id
                )
            }
            if resolution.input_id not in inputs:
                raise DomainError("ROUND_INPUT_INVALID")
            draft.round_input_resolutions = [
                r
                for r in draft.round_input_resolutions
                if r.input_id != resolution.input_id
            ] + [resolution]
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


class MergeRoundInputsService:
    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def merge(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        from pydantic import BaseModel, ConfigDict, Field

        from ontocurator.application.reviews import DecisionCommand, ReviewService
        from ontocurator.domain.review import ReviewDecision
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
            annotation = original.annotation.model_copy(
                deep=True,
                update={
                    "provenance": original.annotation.provenance.model_copy(
                        update={
                            "method": "merged",
                            "source_refs": [
                                f"round-input:{iid}"
                                for iid in sorted(command.input_ids)
                            ],
                        }
                    )
                },
            )
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
                    ReviewDecision(
                        decision_id="dec-"
                        + canonical_hash(
                            {
                                "workspace": key.model_dump(),
                                "target": target.model_dump(),
                            }
                        ),
                        target=target,
                        outcome="changed",
                        replacement=ref,
                        note=command.note,
                        reviewer_id=key.annotator_id,
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
