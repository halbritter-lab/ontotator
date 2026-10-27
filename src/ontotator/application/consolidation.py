"""Consolidation groups and the consolidation read (acceptance fixes spec
"WP-E Consolidation view > Backend").

A consolidation round's inputs are the frozen findings of its source
submissions (``round_inputs``). ``consolidation_groups`` groups them with the
pure ``domain.agreement.groups``: one "submission" per source, in the round's
``input_submission_ids`` order (frozen drafts after them, in inventory
order), so a source without findings still makes every group ``partial``.
Each input with a target snapshot is a finding keyed by its ``input_id``
(axis defaults filled exactly as the final panel's agreement,
``finding_of``).

Group state lives in the consolidator's review decisions on the inputs'
target snapshots: a group is *open* while a member has no decision or only
an ``uncertain`` one; otherwise its state is the decisions'
``ConsolidationMark.action``. A group is *edited* when its resulting
annotation's content hash differs from the mark's ``content_sha256``
(``consolidated_content_sha256``) or the annotation was deleted.

Visibility (U8, U9): the assignee reads the live draft; a lead who is not the
assignee reads the submitted result once the round is submitted; every other
caller, and a lead before submission, gets ``ROUND_NOT_FOUND``. Both readers
see the input authors' display names.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, select

from ontotator.application.document_row_panel import (
    AxisDefaults,
    finding_of,
    project_profile,
    project_roles,
)
from ontotator.application.people import person_refs
from ontotator.authz.policy import Access, Action, can
from ontotator.domain.agreement import Finding, Group, groups
from ontotator.domain.annotations import (
    Annotation,
    AnnotationRef,
    AnnotationSnapshot,
    annotation_content,
)
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import TaskProfile
from ontotator.domain.review import ReviewDecision
from ontotator.domain.serialization import decode_snapshot
from ontotator.domain.work_rounds import WorkRoundView
from ontotator.domain.workspace import Submission
from ontotator.ontology.modifiers import NO_TERM_ROLES, TermRoles, modifier_layers
from ontotator.storage.final_tables import FinalSelectionRow
from ontotator.storage.repository import Repository, _key_str
from ontotator.storage.tables import (
    DocumentRow,
    ProposalAnnotationRow,
    SubmissionRow,
    UserRow,
)
from ontotator.storage.workflow_tables import RoundInputRow, WorkRoundRow

__all__ = [
    "ConsolidationReader",
    "RoundMember",
    "RoundMembers",
    "consolidated_content_sha256",
    "consolidation_group_id",
    "consolidation_groups",
    "consolidation_progress",
    "is_open",
    "member_ref",
    "open_group_count",
    "round_groups",
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
    snapshot: AnnotationSnapshot  # the target snapshot
    finding: Finding
    source_id: str  # the annotation id in its source submission or draft


@dataclass(frozen=True)
class RoundMembers:
    """A round's sources and its grouping members."""

    order: list[str]  # source ids: submissions first, then "draft-<id>"
    authors: dict[str, str]  # source id -> author pseudonym
    members: dict[str, RoundMember]  # by input id
    roles: TermRoles  # modifier roles of the project's layers


def round_members(
    conn: Connection,
    pid: int,
    round_id: str,
    profile: TaskProfile,
    defaults: AxisDefaults,
) -> RoundMembers:
    """The round's sources, their authors and its members by input id
    (inputs with a target snapshot in editable layers, as ``findings_of``).

    Every source submission is in ``order``, also one without findings or
    with findings only outside the editable layers. Consolidation requires
    the exact target text, so every input has a target snapshot; one without
    is skipped. Reads ``WorkRoundRow`` and ``RoundInputRow`` on the caller's
    connection, so it also sees a round created in the caller's open
    transaction. ``profile`` and ``defaults`` come from ``project_profile``;
    the modifier roles (standalone modifier findings) from ``project_roles``.
    """
    roles = project_roles(conn, pid, profile)
    editable = {
        layer.layer_id for layer in profile.layers if layer.access == "editable"
    }
    sources = conn.execute(
        select(WorkRoundRow.input_submission_ids).where(
            WorkRoundRow.project_id == pid, WorkRoundRow.round_id == round_id
        )
    ).scalar_one_or_none()
    order: list[str] = [str(sid) for sid in sources or []]
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
    sids = sorted(
        set(order) | {r.source_submission_id for r in rows if r.source_submission_id}
    )
    authors: dict[str, str] = (
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
    members: dict[str, RoundMember] = {}
    position = dict.fromkeys(order, 0)
    for row in rows:
        submission = (
            row.source_submission_id
            if row.source_submission_id is not None
            else f"draft-{row.source_draft_snapshot_id}"
        )
        if submission not in position:
            position[submission] = 0
            order.append(submission)
        if submission not in authors:  # a frozen draft: its snapshots' author
            source = decode_snapshot(row.payload["source_snapshot"])
            authors[submission] = source.annotation.provenance.actor.actor_id
        raw = row.payload.get("target_snapshot")
        if raw is None:
            continue
        item = decode_snapshot(raw)
        if item.annotation.layer_id not in editable:
            continue
        person = authors[submission]
        members[row.input_id] = RoundMember(
            input_id=row.input_id,
            submission_id=submission,
            person_id=person,
            snapshot=item,
            finding=finding_of(
                item,
                key=row.input_id,
                order=position[submission],
                defaults=defaults,
                roles=roles,
            ),
            source_id=row.payload["source_snapshot"]["annotation"]["annotation_id"],
        )
        position[submission] += 1
    return RoundMembers(order=order, authors=authors, members=members, roles=roles)


def consolidation_groups(
    conn: Connection,
    pid: int,
    round_id: str,
    profile: TaskProfile,
    defaults: AxisDefaults,
) -> list[tuple[Group, dict[str, str]]]:
    """The round's groups in reading order, each with its members as
    ``{submission id: input id}`` (the finding keys are the input ids)."""
    found = round_members(conn, pid, round_id, profile, defaults)
    return [
        (group, dict(group.members)) for group in _groups(found.order, found.members)
    ]


def _groups(order: list[str], members: Mapping[str, RoundMember]) -> tuple[Group, ...]:
    findings: dict[str, list[Finding]] = {submission: [] for submission in order}
    for member in members.values():
        findings[member.submission_id].append(member.finding)
    return groups(findings, order)


def round_groups(found: RoundMembers) -> tuple[Group, ...]:
    """The groups of ``round_members`` in reading order (finding keys are
    input ids)."""
    return _groups(found.order, found.members)


def member_ref(member: RoundMember) -> AnnotationRef:
    """The review target of a member: its target snapshot."""
    return AnnotationRef(
        annotation_id=member.snapshot.annotation.annotation_id,
        version=member.snapshot.version,
    )


def is_open(
    targets: Iterable[tuple[str, str]], decisions: Sequence[ReviewDecision]
) -> bool:
    """Whether a group with these member targets is open: a member has no
    decision or only an ``uncertain`` one (the read and submit gating)."""
    decided = {
        (d.target.annotation_id, d.target.version)
        for d in decisions
        if d.outcome != "uncertain"
    }
    return any(target not in decided for target in targets)


def consolidation_progress(
    conn: Connection, pid: int, round_id: str, decisions: Sequence[ReviewDecision]
) -> tuple[int, int]:
    """``(open, total)`` groups of the round under ``decisions``."""
    profile, defaults = project_profile(conn, pid)
    found = round_members(conn, pid, round_id, profile, defaults)
    groups = list(round_groups(found))
    open_count = sum(
        1
        for group in groups
        if is_open(
            (
                (ref.annotation_id, ref.version)
                for ref in (
                    member_ref(found.members[i]) for i in group.members.values()
                )
            ),
            decisions,
        )
    )
    return open_count, len(groups)


def open_group_count(
    conn: Connection, pid: int, round_id: str, decisions: Sequence[ReviewDecision]
) -> int:
    """How many groups of the round are open under ``decisions`` (submit
    gating, ``CONSOLIDATION_GROUPS_OPEN``)."""
    return consolidation_progress(conn, pid, round_id, decisions)[0]


@dataclass(frozen=True)
class _Content:
    """The consolidator's state: the live draft or the submitted result."""

    annotations: Sequence[AnnotationSnapshot]
    decisions: Sequence[ReviewDecision]
    revision: int = 0  # the live draft's revision (0 when read-only)


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
            found = round_members(conn, pid, item.round_id, profile, defaults)
            order, members = found.order, found.members
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
            # The Finalization step of the path: accepted once the lead chose a
            # final result for this text.
            accepted_at = (
                conn.execute(
                    select(FinalSelectionRow.selected_at).where(
                        FinalSelectionRow.project_id == pid,
                        FinalSelectionRow.document_id == item.document_id,
                    )
                ).scalar()
                if submitted
                else None
            )
            people = _people(conn, access, order, found.authors)
            from_proposal = _from_tool_proposal(conn, pid, members)
            added = _added(members, content, defaults, found.roles)
            modifier_layer_ids = modifier_layers(profile, Repository._pins(conn, pid))
            consolidator = _people(
                conn, access, ["self"], {"self": item.annotator_id}
            )[0]["label"]
        return {
            "round_id": item.round_id,
            "workspace_id": None,  # filled by the route for the editable assignee
            "read_only": reason is not None,
            "read_only_reason": reason,
            "accepted_at": accepted_at,
            "case_id": document.case_id,
            "language": document.language,
            "document_version": document.version,
            "document_id": item.document_id,
            "text": document.text,
            "people": people,
            "groups": [
                _group_view(group, members, content, from_proposal, found.roles)
                for group in _groups(order, members)
            ],
            "added": added,
            "added_by": consolidator if added else None,
            "consolidator": consolidator,
            "workflow_revision": item.workflow_revision,
            "draft_revision": 0 if submitted else content.revision,
            "modifier_layer_ids": modifier_layer_ids,
        }


def _modifiers(annotation: Annotation, roles: TermRoles) -> list[dict[str, Any]]:
    """A member's modifiers for the read view; ``term_label`` holds the term
    id (the route fills labels). A term the classifier does not know (old
    data) reads as a plain modifier."""
    return [
        {
            "term_id": m.term_id,
            "term_label": m.term_id,
            "kind": roles.kind(annotation.layer_id, m.term_id) or "modifier",
            "exclusive_class": roles.exclusive_class(annotation.layer_id, m.term_id),
            "segments": [[s.start, s.end] for s in m.segments],
        }
        for m in annotation.modifiers
    ]


def _added(
    members: Mapping[str, RoundMember],
    content: _Content,
    defaults: AxisDefaults,
    roles: TermRoles,
) -> list[dict[str, Any]]:
    """Findings the consolidator added outside every group ("Add finding"):
    the draft's or submission's annotations that are neither a group's
    ``cons-…`` result, a member target nor a decision's replacement.

    Each is shaped like a group member; ``input_id`` holds the annotation id
    and ``person_id`` the annotation's author (the consolidator)."""
    targets = {m.snapshot.annotation.annotation_id for m in members.values()}
    replacements = {
        d.replacement.annotation_id
        for d in content.decisions
        if d.replacement is not None
    }
    added: list[dict[str, Any]] = []
    for snapshot in content.annotations:
        annotation = snapshot.annotation
        if (
            annotation.annotation_id.startswith("cons-")
            or annotation.annotation_id in targets
            or annotation.annotation_id in replacements
        ):
            continue
        found = finding_of(
            snapshot,
            key=annotation.annotation_id,
            order=len(added),
            defaults=defaults,
            roles=roles,
        )
        added.append(
            {
                "input_id": annotation.annotation_id,
                "person_id": annotation.provenance.actor.actor_id,
                "annotation_id": annotation.annotation_id,
                "term_id": annotation.term_id,
                "term_label": annotation.term_id,
                "layer_id": annotation.layer_id,
                "type_id": annotation.type_id,
                "axes": dict(found.axes),
                "spans": [list(span) for span in found.spans],
                "cues": [list(span) for span in found.cues],
                "note": annotation.note or None,
                "modifiers": _modifiers(annotation, roles),
            }
        )
    added.sort(key=lambda item: (item["spans"][:1], item["annotation_id"]))
    return added


def _people(
    conn: Connection,
    access: Access,
    order: Sequence[str],
    authors: Mapping[str, str],
) -> list[dict[str, Any]]:
    """The source authors in source order, with display names (U8); also
    the author of a source without findings."""
    pseudonyms: list[str] = []
    for submission in order:
        person = authors.get(submission)
        if person is not None and person not in pseudonyms:
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


def _from_tool_proposal(
    conn: Connection, pid: int, members: Mapping[str, RoundMember]
) -> set[str]:
    """Input ids whose finding comes from a tool proposal: its source
    annotation id (any version) is a proposal of the project, or it is the
    replacement of a decision on a proposal in its source submission (a
    corrected one). Target snapshots carry ``input-…`` ids, so the source
    snapshot's id is the one compared."""
    sids = {
        m.submission_id
        for m in members.values()
        if not m.submission_id.startswith("draft-")
    }
    # (source submission, replacement annotation id) -> target annotation id
    corrected: dict[tuple[str, str], str] = {}
    if sids:
        for row in conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.payload).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(sids),
            )
        ):
            for decision in Submission.model_validate(row.payload).decisions:
                if decision.replacement is not None:
                    corrected[
                        (row.submission_id, decision.replacement.annotation_id)
                    ] = decision.target.annotation_id
    candidates = {m.source_id for m in members.values()} | set(corrected.values())
    if not candidates:
        return set()
    proposals = set(
        conn.execute(
            select(ProposalAnnotationRow.annotation_id)
            .where(
                ProposalAnnotationRow.project_id == pid,
                ProposalAnnotationRow.annotation_id.in_(candidates),
            )
            .distinct()
        ).scalars()
    )
    marked: set[str] = set()
    for input_id, member in members.items():
        target = corrected.get((member.submission_id, member.source_id))
        if member.source_id in proposals or target in proposals:
            marked.add(input_id)
    return marked


def _group_view(
    group: Group,
    members: Mapping[str, RoundMember],
    content: _Content,
    from_proposal: set[str],
    roles: TermRoles,
) -> dict[str, Any]:
    inputs = list(group.members.values())
    member_views = []
    targets: dict[tuple[str, str], Annotation] = {}
    for input_id in inputs:
        member = members[input_id]
        annotation = member.snapshot.annotation
        targets[(annotation.annotation_id, member.snapshot.version)] = annotation
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
                "from_tool_proposal": input_id in from_proposal,
                "modifiers": _modifiers(annotation, roles),
            }
        )
    state = _state(targets, content, roles)
    return {
        "group_id": consolidation_group_id(inputs),
        "kinds": sorted(group.kinds),
        "differing_axes": list(group.differing_axes),
        "majority": dict(group.majority),
        "span_conflict": group.span_conflict,
        "keep_input_id": group.members[group.keep],
        "start": group.start,
        "members": member_views,
        **state,
    }


def _state(
    targets: Mapping[tuple[str, str], Annotation],
    content: _Content,
    roles: TermRoles = NO_TERM_ROLES,
) -> dict[str, Any]:
    """State, note, flag, edit and resulting annotations of one group.

    ``targets`` maps the members' target refs to their frozen annotations.
    A group is open while a member target has no decision or only an
    ``uncertain`` one (the rule submit gating uses). Each decision has at
    most one resulting annotation: its ``replacement``, else the target
    itself when ``confirmed``, else none (``rejected``). E1b stores
    ``content_sha256`` on every decision with a resulting annotation (the
    hash of that annotation); a hash on a decision without one is ignored.
    The group is edited when a resulting annotation's hash differs from the
    mark or a replacement no longer exists.
    """
    if is_open(targets, content.decisions):
        return {"state": "open"}
    by_target = {
        (d.target.annotation_id, d.target.version): d
        for d in content.decisions
        if d.outcome != "uncertain"
    }
    decided = [by_target[target] for target in targets]
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
        if decision.replacement is not None:
            current = annotations.get(decision.replacement.annotation_id)
        elif decision.outcome == "confirmed":
            ref = decision.target
            current = annotations.get(ref.annotation_id) or targets.get(
                (ref.annotation_id, ref.version)
            )
        else:
            continue
        if (
            current is None
            or consolidated_content_sha256(current) != mark.content_sha256
        ):
            edited = True
    resulting = {
        d.replacement.annotation_id for d in decided if d.replacement is not None
    } | {d.target.annotation_id for d in decided if d.outcome == "confirmed"}
    # R-2: what the decision kept, readable after a reload and in read-only views.
    result = next(
        (
            annotations.get(d.replacement.annotation_id)
            if d.replacement is not None
            else annotations.get(d.target.annotation_id)
            or targets.get((d.target.annotation_id, d.target.version))
            for d in decided
            if d.replacement is not None or d.outcome == "confirmed"
        ),
        None,
    )
    return {
        "state": state,
        "edited": edited,
        "note": next((d.note for d in decided if d.note), None),
        "guidelines_unclear": any(m.guidelines_unclear for m in marks),
        "annotation_ids": sorted(resulting),
        "attached_to": next((m.attached_to for m in marks if m.attached_to), None),
        "result": None
        if result is None
        else {
            "term_id": result.term_id,
            "term_label": result.term_id,
            "layer_id": result.layer_id,
            "axes": {k: v for k, v in result.axes_values.items() if v},
            "modifiers": _modifiers(result, roles),
        },
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
    return _Content(
        annotations=draft.annotations,
        decisions=draft.decisions,
        revision=draft.revision,
    )


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
