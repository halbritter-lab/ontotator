"""Consolidation groups and the consolidation read (acceptance fixes spec
"WP-E Consolidation view > Backend").

A consolidation round's inputs are the frozen findings of its source
submissions (``round_inputs``). ``consolidation_groups`` groups them with the
pure ``domain.agreement.groups``: one "submission" per source submission, in
inventory order, each input a finding keyed by its ``input_id`` (axis
defaults filled exactly as the final panel's agreement, ``finding_of``).

Group state lives in the consolidator's review decisions on the inputs'
target snapshots: a group is *open* while a member has no decision;
otherwise its state is the decisions' ``ConsolidationMark.action``. A group
is *edited* when a resulting annotation's content hash differs from the
mark's ``content_sha256`` (``consolidated_content_sha256``).

Visibility (U8, U9): the assignee reads the live draft; a lead who is not the
assignee reads the submitted result once the round is submitted; every other
caller, and a lead before submission, gets ``ROUND_NOT_FOUND``. Both readers
see the input authors' display names.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, select

from ontocurator.application.document_row_panel import (
    AxisDefaults,
    finding_of,
    project_profile,
)
from ontocurator.application.people import person_refs
from ontocurator.authz.policy import Access, Action, can
from ontocurator.domain.agreement import Finding, Group, groups
from ontocurator.domain.annotations import (
    Annotation,
    AnnotationSnapshot,
    annotation_content,
)
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.review import ReviewDecision
from ontocurator.domain.serialization import decode_snapshot
from ontocurator.domain.work_rounds import WorkRoundView
from ontocurator.domain.workspace import Submission
from ontocurator.storage.repository import Repository, _key_str
from ontocurator.storage.tables import DocumentRow, SubmissionRow, UserRow
from ontocurator.storage.workflow_tables import RoundInputRow

__all__ = [
    "ConsolidationReader",
    "RoundMember",
    "consolidated_content_sha256",
    "consolidation_group_id",
    "consolidation_groups",
    "round_members",
]

# Lanes of person marks in the text (U12): one per person, lane 4 also for
# every further person.
MAX_LANE = 4


def consolidated_content_sha256(annotation: Annotation) -> str:
    """The content hash ``ConsolidationMark.content_sha256`` records for a
    consolidated annotation; a later edit in the editor changes it."""
    return canonical_hash(annotation_content(annotation))


def consolidation_group_id(input_ids: Sequence[str]) -> str:
    """Stable group id: sha256 of the sorted input ids, first 16 hex."""
    joined = "|".join(sorted(input_ids))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class RoundMember:
    """One frozen round input as a grouping member."""

    input_id: str
    submission_id: str  # the source submission ("draft-<id>" for a frozen draft)
    person_id: str  # the source author's pseudonym
    snapshot: AnnotationSnapshot  # the target snapshot (else the source one)
    finding: Finding


def round_members(
    conn: Connection,
    pid: int,
    round_id: str,
    profile: TaskProfile,
    defaults: AxisDefaults,
) -> tuple[list[str], dict[str, RoundMember]]:
    """The round's submissions in inventory order and its members by input id
    (inputs in editable layers, as ``findings_of``).

    Reads ``RoundInputRow`` on the caller's connection, so it also sees the
    inputs of a round created in the caller's open transaction. ``profile``
    and ``defaults`` come from ``project_profile``.
    """
    editable = {
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    }
    rows = conn.execute(
        select(
            RoundInputRow.input_id,
            RoundInputRow.source_submission_id,
            RoundInputRow.source_draft_snapshot_id,
            RoundInputRow.payload,
        )
        .where(RoundInputRow.project_id == pid, RoundInputRow.round_id == round_id)
        .order_by(RoundInputRow.position)
    ).all()
    sids = sorted({r.source_submission_id for r in rows if r.source_submission_id})
    authors = (
        {
            row.submission_id: row.annotator_id
            for row in conn.execute(
                select(SubmissionRow.submission_id, SubmissionRow.annotator_id).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.submission_id.in_(sids),
                )
            )
        }
        if sids
        else {}
    )
    order: list[str] = []
    members: dict[str, RoundMember] = {}
    position: dict[str, int] = {}
    for row in rows:
        submission = (
            row.source_submission_id
            if row.source_submission_id is not None
            else f"draft-{row.source_draft_snapshot_id}"
        )
        if submission not in position:
            position[submission] = 0
            order.append(submission)
        raw = row.payload.get("target_snapshot") or row.payload["source_snapshot"]
        item = decode_snapshot(raw)
        if item.annotation.layer_id not in editable:
            continue
        person = authors.get(submission) or item.annotation.provenance.actor.actor_id
        members[row.input_id] = RoundMember(
            input_id=row.input_id,
            submission_id=submission,
            person_id=person,
            snapshot=item,
            finding=finding_of(
                item, key=row.input_id, order=position[submission], defaults=defaults
            ),
        )
        position[submission] += 1
    return order, members


def consolidation_groups(
    conn: Connection,
    pid: int,
    round_id: str,
    profile: TaskProfile,
    defaults: AxisDefaults,
) -> list[tuple[Group, dict[str, str]]]:
    """The round's groups in reading order, each with its members as
    ``{submission id: input id}`` (the finding keys are the input ids)."""
    order, members = round_members(conn, pid, round_id, profile, defaults)
    return [(group, dict(group.members)) for group in _groups(order, members)]


def _groups(order: list[str], members: Mapping[str, RoundMember]) -> tuple[Group, ...]:
    findings: dict[str, list[Finding]] = {submission: [] for submission in order}
    for member in members.values():
        findings[member.submission_id].append(member.finding)
    return groups(findings, order)


@dataclass(frozen=True)
class _Content:
    """The consolidator's state: the live draft or the submitted result."""

    annotations: Sequence[AnnotationSnapshot]
    decisions: Sequence[ReviewDecision]


class ConsolidationReader:
    """``GET /rounds/{round_id}/consolidation`` (U8, U9)."""

    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def read(self, item: WorkRoundView, access: Access) -> dict[str, Any]:
        """``ConsolidationView`` fields of a round the caller may see
        (``_visible_round``); term labels are left to the caller
        (``term_label`` holds the term id)."""
        if item.kind != "consolidation":
            raise DomainError("ROUND_NOT_FOUND")
        assignee = item.annotator_id == access.pseudonym
        # A submitted round stays readable once a later round superseded it.
        submitted = item.latest_submission_id is not None and item.state in {
            "submitted",
            "superseded",
        }
        if not assignee and not (
            submitted and can(access, Action.MANAGE_ASSIGNMENTS, item.project_key)
        ):
            raise DomainError("ROUND_NOT_FOUND")
        base = Repository(self.repo.db)
        with base.db.snapshot() as conn:
            pid = base._require_project(conn, item.project_key)
            profile, defaults = project_profile(conn, pid)
            order, members = round_members(conn, pid, item.round_id, profile, defaults)
            reason: str | None = None
            if submitted:
                reason = "submitted"
            elif not assignee or not item.active or item.state != "editable":
                reason = "not_assigned"
            elif _withdrawn(conn, base, item, pid, order):
                reason = "input_withdrawn"
            if submitted:
                content = _submitted(conn, pid, item.latest_submission_id)
            else:
                content = _draft(conn, base, pid, item)
            document = conn.execute(
                select(
                    DocumentRow.case_id,
                    DocumentRow.language,
                    DocumentRow.version,
                    DocumentRow.text,
                ).where(
                    DocumentRow.project_id == pid,
                    DocumentRow.document_id == item.document_id,
                )
            ).one()
            people = _people(conn, access, order, members)
        return {
            "round_id": item.round_id,
            "workspace_id": None,  # filled by the route for the editable assignee
            "read_only": reason is not None,
            "read_only_reason": reason,
            "case_id": document.case_id,
            "language": document.language,
            "document_version": document.version,
            "document_id": item.document_id,
            "text": document.text,
            "people": people,
            "groups": [
                _group_view(group, members, content)
                for group in _groups(order, members)
            ],
            "workflow_revision": item.workflow_revision,
        }


def _people(
    conn: Connection,
    access: Access,
    order: Sequence[str],
    members: Mapping[str, RoundMember],
) -> list[dict[str, Any]]:
    """The input authors in submission order, with display names (U8)."""
    by_submission = {m.submission_id: m.person_id for m in members.values()}
    pseudonyms: list[str] = []
    for submission in order:
        person = by_submission[submission]
        if person not in pseudonyms:
            pseudonyms.append(person)
    ids = {
        row.pseudonym: row.id
        for row in conn.execute(
            select(UserRow.id, UserRow.pseudonym).where(
                UserRow.pseudonym.in_(pseudonyms)
            )
        )
    }
    refs = person_refs(
        conn, ids.values(), viewer_id=access.user_id, viewer_is_lead=True
    )
    people = []
    for index, pseudonym in enumerate(pseudonyms):
        ref = refs.get(ids.get(pseudonym, -1))
        name = ref.display_name if ref is not None else None
        people.append(
            {
                "person_id": pseudonym,
                "label": f"{name} ({pseudonym})" if name else pseudonym,
                "lane": min(index + 1, MAX_LANE),
            }
        )
    return people


def _group_view(
    group: Group,
    members: Mapping[str, RoundMember],
    content: _Content,
) -> dict[str, Any]:
    inputs = list(group.members.values())
    member_views = []
    targets = []
    for input_id in inputs:
        member = members[input_id]
        annotation = member.snapshot.annotation
        targets.append((annotation.annotation_id, member.snapshot.version))
        member_views.append(
            {
                "input_id": input_id,
                "person_id": member.person_id,
                "annotation_id": annotation.annotation_id,
                "term_id": annotation.term_id,
                "term_label": annotation.term_id,
                "layer_id": annotation.layer_id,
                "type_id": annotation.type_id,
                "axes": dict(member.finding.axes),
                "spans": [list(span) for span in member.finding.spans],
                "cues": [list(span) for span in member.finding.cues],
                "note": annotation.note or None,
            }
        )
    state = _state(targets, content)
    return {
        "group_id": consolidation_group_id(inputs),
        "kinds": sorted(group.kinds),
        "differing_axes": list(group.differing_axes),
        "majority": dict(group.majority),
        "keep_input_id": group.members[group.keep],
        "start": group.start,
        "members": member_views,
        **state,
    }


def _state(targets: Sequence[tuple[str, str]], content: _Content) -> dict[str, Any]:
    """State, note, flag, edit and resulting annotations of one group."""
    by_target = {
        (d.target.annotation_id, d.target.version): d for d in content.decisions
    }
    decisions = [by_target.get(target) for target in targets]
    if any(d is None for d in decisions):
        return {"state": "open"}
    decided = [d for d in decisions if d is not None]
    marks = [d.consolidation for d in decided if d.consolidation is not None]
    if marks:
        state = marks[0].action
    else:  # decided in the editor without the consolidation view
        state = "leave_out" if all(d.outcome == "rejected" for d in decided) else "keep"
    annotations = {
        s.annotation.annotation_id: s.annotation for s in content.annotations
    }
    edited = False
    for decision in decided:
        mark = decision.consolidation
        if mark is None or mark.content_sha256 is None:
            continue
        replacement = decision.replacement
        current = (
            annotations.get(replacement.annotation_id)
            if replacement is not None
            else None
        )
        if (
            current is None
            or consolidated_content_sha256(current) != mark.content_sha256
        ):
            edited = True
    resulting = {
        d.replacement.annotation_id for d in decided if d.replacement is not None
    } | {d.target.annotation_id for d in decided if d.outcome == "confirmed"}
    return {
        "state": state,
        "edited": edited,
        "note": next((d.note for d in decided if d.note), None),
        "guidelines_unclear": any(m.guidelines_unclear for m in marks),
        "annotation_ids": sorted(resulting),
    }


def _submitted(conn: Connection, pid: int, submission_id: str | None) -> _Content:
    payload = conn.execute(
        select(SubmissionRow.payload).where(
            SubmissionRow.project_id == pid,
            SubmissionRow.submission_id == submission_id,
        )
    ).scalar_one()
    submission = Submission.model_validate(payload)
    return _Content(annotations=submission.snapshots, decisions=submission.decisions)


def _draft(
    conn: Connection, repo: Repository, pid: int, item: WorkRoundView
) -> _Content:
    """The live draft; nothing decided when the draft does not exist yet
    (a read never creates one)."""
    key = item.workspace_key
    if key is None or repo._draft_row(conn, pid, _key_str(key)) is None:
        return _Content(annotations=(), decisions=())
    draft = repo._open_draft(conn, key, None)
    return _Content(annotations=draft.annotations, decisions=draft.decisions)


def _withdrawn(
    conn: Connection,
    repo: Repository,
    item: WorkRoundView,
    pid: int,
    order: Sequence[str],
) -> bool:
    """Whether a source submission is no longer the current result of its
    round (its author reopened or restarted the work)."""
    for sid in order:
        if sid.startswith("draft-"):
            continue
        bound = repo.round_for_submission_in(conn, item.project_key, pid, sid)
        if bound is not None and (
            not bound.active
            or bound.state != "submitted"
            or bound.latest_submission_id != sid
        ):
            return True
    return False
