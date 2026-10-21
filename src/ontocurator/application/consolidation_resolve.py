"""Resolve, annotate and reopen consolidation groups; the automatic take-over
of matching findings (acceptance fixes spec "WP-E Backend").

All three group commands are draft mutations of the consolidator's
workspace (``Repository.run_mutation``: revision check, receipt, one edit
event). ``input_ids`` must name exactly one group of the round
(``consolidation.round_groups``), else ``ROUND_INPUT_INVALID``.

* **Resolve** replaces the group's decisions and resulting annotations: the
  consolidated annotation(s) get the deterministic ids
  ``consolidated_annotation_id`` (``n`` = 0, and 1… for ``keep_both``), the
  provenance ``merged`` with the contributing ``round-input:…`` refs and the
  consolidator as actor; every member target gets a ``changed`` decision
  with ``ConsolidationMark(action, guidelines_unclear, content_sha256)``.
  ``leave_out`` records ``rejected`` decisions only. The group note is the
  decisions' ``note``. Like ``merge-inputs`` it unchecks the group's layer.
* **Annotate** changes note and flag on the decisions of a resolved group;
  annotations stay untouched, so every ``content_sha256`` stays valid.
* **Reopen** deletes the group's decisions and resulting annotations.
* **Automatic take-over** (``take_over_matches``, called by
  ``WorkRoundService.create_in`` for consolidation rounds): every ``match``
  group keeps its earliest member as is (``confirmed`` with its content
  hash) and rejects the others, all marked ``auto`` by the consolidator; one
  edit event. Groups already decided are skipped, so it is idempotent.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Connection, delete, select, update

from ontocurator.application.consolidation import (
    RoundMember,
    consolidated_content_sha256,
    is_open,
    member_ref,
    round_groups,
    round_members,
)
from ontocurator.application.document_row_panel import project_profile
from ontocurator.domain.agreement import Group
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    AnnotationSnapshot,
    snapshot,
)
from ontocurator.domain.axes import validate_axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError, InvalidAnnotation
from ontocurator.domain.profiles import TaskProfile, resolve_type
from ontocurator.domain.review import (
    ConsolidationAction,
    ConsolidationMark,
    ReviewDecision,
    ReviewOutcome,
)
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.storage.repository import DraftState, Repository, _key_str
from ontocurator.storage.tables import DraftRow, ReviewDecisionRow
from ontocurator.storage.workflow_tables import WorkRoundRow

__all__ = [
    "AnnotateCommand",
    "ConsolidationGroupService",
    "ReopenCommand",
    "ResolveChoice",
    "ResolveCommand",
    "consolidated_annotation_id",
    "merged_annotation",
    "review_decision",
    "take_over_matches",
]

AUTO_TAKE_OVER_COMMAND = "consolidation_auto_take_over"


# --- shared with ``MergeRoundInputsService`` ------------------------------ #


def merged_annotation(
    annotation: Annotation,
    input_ids: Iterable[str],
    *,
    actor: ActorRef | None = None,
) -> Annotation:
    """``annotation`` with the provenance of a consolidation: method
    ``merged``, the sorted ``round-input:…`` refs, and ``actor`` if given."""
    update_provenance: dict[str, Any] = {
        "method": "merged",
        "source_refs": [f"round-input:{iid}" for iid in sorted(input_ids)],
    }
    if actor is not None:
        update_provenance["actor"] = actor
    return annotation.model_copy(
        deep=True,
        update={
            "provenance": annotation.provenance.model_copy(update=update_provenance)
        },
    )


def review_decision(
    key: WorkspaceKey,
    target: AnnotationRef,
    *,
    outcome: ReviewOutcome,
    replacement: AnnotationRef | None = None,
    note: str | None = None,
    mark: ConsolidationMark | None = None,
) -> ReviewDecision:
    """The consolidator's decision on ``target``; its id depends on the
    workspace and the target only (as the editor's decisions)."""
    return ReviewDecision(
        decision_id="dec-"
        + canonical_hash(
            {"workspace": key.model_dump(), "target": target.model_dump()}
        ),
        target=target,
        outcome=outcome,
        replacement=replacement,
        note=note,
        reviewer_id=key.annotator_id,
        consolidation=mark,
    )


def consolidated_annotation_id(round_id: str, input_ids: Sequence[str], n: int) -> str:
    """``cons-`` + sha256 of round, sorted input ids and ``n``, first 16 hex."""
    joined = "|".join(sorted(input_ids))
    digest = hashlib.sha256(f"{round_id}|{joined}|{n}".encode()).hexdigest()
    return f"cons-{digest[:16]}"


# --- commands ------------------------------------------------------------ #


class ResolveChoice(BaseModel):
    """One person's span, the chosen term and axis values."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    span_from_input_id: str
    axes: dict[str, str] = Field(default_factory=dict)
    # Omitted: the span member's note; null: no note.
    note_from_input_id: str | None = None


class ResolveCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_ids: list[str] = Field(min_length=1)
    action: Literal["keep", "choose", "keep_both", "leave_out"]
    choice: ResolveChoice | None = None
    note: str | None = None
    guidelines_unclear: bool = False


class AnnotateCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_ids: list[str] = Field(min_length=1)
    # Omitted: the note stays; null or "": no note.
    note: str | None = None
    guidelines_unclear: bool


class ReopenCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_ids: list[str] = Field(min_length=1)


class TermValidator(Protocol):
    def __call__(self, project_key: str, layer_id: str, term_id: str) -> bool: ...


@dataclass(frozen=True)
class _Group:
    """One group of the round with its members (by input id, member order)."""

    round_id: str
    group: Group
    members: dict[str, RoundMember]
    profile: TaskProfile

    @property
    def input_ids(self) -> list[str]:
        return list(self.members)

    @property
    def refs(self) -> dict[str, AnnotationRef]:
        return {iid: member_ref(m) for iid, m in self.members.items()}

    def cons_ids(self) -> set[str]:
        """Every deterministic id this group's resolutions may use."""
        count = max(len(self.group.terms), 1)
        return {
            consolidated_annotation_id(self.round_id, self.input_ids, n)
            for n in range(count)
        }


def _invalid(message: str) -> DomainError:
    return DomainError("ROUND_INPUT_INVALID", message)


def _note(value: str | None) -> str | None:
    return value if value and value.strip() else None


def _find_group(
    conn: Connection, repo: Repository, key: WorkspaceKey, input_ids: Sequence[str]
) -> _Group:
    """The consolidation group whose members are exactly ``input_ids``."""
    pid = repo._require_project(conn, key.project_key)
    kind = (
        conn.execute(
            select(WorkRoundRow.kind).where(
                WorkRoundRow.project_id == pid, WorkRoundRow.round_id == key.round_id
            )
        ).scalar_one_or_none()
        if key.round_id is not None
        else None
    )
    if kind != "consolidation":
        raise DomainError("ROUND_KIND_INVALID")
    assert key.round_id is not None
    if len(set(input_ids)) != len(input_ids):
        raise _invalid("Repeated input")
    profile, defaults = project_profile(conn, pid)
    found = round_members(conn, pid, key.round_id, profile, defaults)
    wanted = set(input_ids)
    for group in round_groups(found):
        if set(group.members.values()) == wanted:
            return _Group(
                round_id=key.round_id,
                group=group,
                members={iid: found.members[iid] for iid in group.members.values()},
                profile=profile,
            )
    raise _invalid("The inputs are not exactly one consolidation group")


def _clear_group(draft: Draft, item: _Group) -> None:
    """Remove the group's decisions and resulting annotations: its
    deterministic ``cons-…`` annotations, replacements no remaining decision
    names, and adopted copies of its targets; then their unused evidence."""
    refs = {(r.annotation_id, r.version) for r in item.refs.values()}
    removed = [
        d for d in draft.decisions if (d.target.annotation_id, d.target.version) in refs
    ]
    draft.decisions = [d for d in draft.decisions if d not in removed]
    kept_replacements = {
        d.replacement.annotation_id for d in draft.decisions if d.replacement
    }
    doomed = item.cons_ids() | {
        d.replacement.annotation_id
        for d in removed
        if d.replacement is not None
        and d.replacement.annotation_id not in kept_replacements
    }
    adopted = {f"{a}:{v}" for a, v in refs}
    dropped = [
        a
        for a in draft.annotations
        if a.annotation.annotation_id in doomed
        or adopted & set(a.annotation.provenance.source_refs)
    ]
    draft.annotations = [a for a in draft.annotations if a not in dropped]
    used = {
        (r.evidence_id, r.version)
        for a in draft.annotations
        for r in a.annotation.evidence_refs
    }
    orphaned = {
        (r.evidence_id, r.version)
        for a in dropped
        for r in a.annotation.evidence_refs
        if (r.evidence_id, r.version) not in used
    }
    draft.evidence = [
        e for e in draft.evidence if (e.mention.evidence_id, e.version) not in orphaned
    ]


def _uncheck(draft: Draft, item: _Group) -> None:
    layers = {m.snapshot.annotation.layer_id for m in item.members.values()}
    draft.checked_layer_ids = [
        lid for lid in draft.checked_layer_ids if lid not in layers
    ]


def _add(draft: Draft, made: AnnotationSnapshot) -> None:
    draft.annotations = [
        a
        for a in draft.annotations
        if a.annotation.annotation_id != made.annotation.annotation_id
    ] + [made]
    known = {(e.mention.evidence_id, e.version) for e in draft.evidence}
    draft.evidence = [
        *draft.evidence,
        *(e for e in made.evidence if (e.mention.evidence_id, e.version) not in known),
    ]


def _resulting_hash(draft: Draft, decision: ReviewDecision, item: _Group) -> str | None:
    """The content hash of a decision's resulting annotation, if any."""
    if decision.replacement is not None:
        current = next(
            (
                a.annotation
                for a in draft.annotations
                if a.annotation.annotation_id == decision.replacement.annotation_id
            ),
            None,
        )
        return consolidated_content_sha256(current) if current is not None else None
    if decision.outcome == "confirmed":
        member = next(
            (m for m in item.members.values() if member_ref(m) == decision.target),
            None,
        )
        if member is not None:
            return consolidated_content_sha256(member.snapshot.annotation)
    return None


class ConsolidationGroupService:
    """``POST /workspaces/{id}/consolidation-groups/{resolve,annotate,reopen}``."""

    def __init__(
        self, repo: Repository, valid_term: TermValidator | None = None
    ) -> None:
        self.repo = repo
        self.valid_term = valid_term

    def _run(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        input_ids: Sequence[str],
        apply: Callable[[Draft, _Group, Document], None],
    ) -> Draft:
        def operation(draft: Draft) -> Draft:
            # Joins the mutation's transaction (the inputs and the round are
            # read under its locks).
            with self.repo.db.transaction() as conn:
                item = _find_group(conn, self.repo, key, input_ids)
            document = self.repo.get_document(key.project_key, key.document_id)
            assert document is not None
            apply(draft, item, document)
            return draft

        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result

    def resolve(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        cmd = ResolveCommand.model_validate(envelope.payload)

        def apply(draft: Draft, item: _Group, document: Document) -> None:
            plans = self._plans(key, cmd, item)
            _clear_group(draft, item)
            note = _note(cmd.note)
            if cmd.action == "leave_out":
                for ref in item.refs.values():
                    draft.decisions.append(
                        review_decision(
                            key,
                            ref,
                            outcome="rejected",
                            note=note,
                            mark=ConsolidationMark(
                                action="leave_out",
                                guidelines_unclear=cmd.guidelines_unclear,
                            ),
                        )
                    )
                _uncheck(draft, item)
                return
            actor = ActorRef(actor_id=key.annotator_id, kind="human")
            for n, (base, annotation, contributors) in enumerate(plans):
                consolidated = merged_annotation(
                    annotation.model_copy(
                        update={
                            "annotation_id": consolidated_annotation_id(
                                item.round_id, item.input_ids, n
                            )
                        }
                    ),
                    contributors,
                    actor=actor,
                )
                made = snapshot(
                    consolidated, list(base.snapshot.evidence), document, item.profile
                )
                _add(draft, made)
                mark = ConsolidationMark(
                    action=cmd.action,
                    guidelines_unclear=cmd.guidelines_unclear,
                    content_sha256=consolidated_content_sha256(made.annotation),
                )
                replacement = AnnotationRef(
                    annotation_id=made.annotation.annotation_id, version=made.version
                )
                for iid in contributors:
                    draft.decisions.append(
                        review_decision(
                            key,
                            item.refs[iid],
                            outcome="changed",
                            replacement=replacement,
                            note=note,
                            mark=mark,
                        )
                    )
            _uncheck(draft, item)

        return self._run(key, envelope, cmd.input_ids, apply)

    def _plans(
        self, key: WorkspaceKey, cmd: ResolveCommand, item: _Group
    ) -> list[tuple[RoundMember, Annotation, list[str]]]:
        """Per consolidated annotation: the member giving span and evidence,
        the annotation content and the contributing input ids."""
        if (cmd.choice is not None) != (cmd.action == "choose"):
            raise _invalid("A choice goes with the action 'choose' only")
        group, members = item.group, item.members
        if cmd.action == "leave_out":
            return []
        if cmd.action == "keep":
            keep = members[group.members[group.keep]]
            return [(keep, keep.snapshot.annotation, item.input_ids)]
        if cmd.action == "keep_both":
            if "term_differs" not in group.kinds:
                raise _invalid("Keep both needs different terms")
            plans = []
            for term in group.terms:
                same = [
                    iid
                    for iid, m in members.items()
                    if m.snapshot.annotation.term_id == term
                ]
                base = members[same[0]]
                plans.append((base, base.snapshot.annotation, same))
            return plans
        choice = cmd.choice
        assert choice is not None
        if choice.span_from_input_id not in members:
            raise _invalid("The span comes from a member of the group")
        if (
            choice.note_from_input_id is not None
            and choice.note_from_input_id not in members
        ):
            raise _invalid("The note comes from a member of the group")
        base = members[choice.span_from_input_id]
        source = base.snapshot.annotation
        if choice.term_id not in group.terms and not (
            self.valid_term is not None
            and self.valid_term(key.project_key, source.layer_id, choice.term_id)
        ):
            raise _invalid("The term is not valid in this layer")
        type_def = resolve_type(item.profile, source.layer_id, source.type_id)
        axes: dict[str, str | None] = {**source.axes_values, **choice.axes}
        try:
            validate_axes(axes, type_def.axes, complete=False)
        except ValueError as exc:
            raise _invalid(str(exc)) from exc
        if "note_from_input_id" in choice.model_fields_set:
            note = (
                members[choice.note_from_input_id].snapshot.annotation.note
                if choice.note_from_input_id is not None
                else None
            )
        else:
            note = source.note
        try:
            chosen = Annotation.model_validate(
                source.with_axes(axes).model_dump()
                | {"term_id": choice.term_id, "note": note}
            )
        except (InvalidAnnotation, ValueError) as exc:
            raise _invalid(str(exc)) from exc
        return [(base, chosen, item.input_ids)]

    def annotate(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        cmd = AnnotateCommand.model_validate(envelope.payload)

        def apply(draft: Draft, item: _Group, _document: Document) -> None:
            refs = {(r.annotation_id, r.version) for r in item.refs.values()}
            if is_open(refs, draft.decisions):
                raise _invalid("Resolve the group first")
            mine = [
                d
                for d in draft.decisions
                if (d.target.annotation_id, d.target.version) in refs
                and d.outcome != "uncertain"
            ]
            derived: ConsolidationAction = (
                "leave_out" if all(d.outcome == "rejected" for d in mine) else "keep"
            )
            changed: dict[str, ReviewDecision] = {}
            for decision in mine:
                mark = decision.consolidation or ConsolidationMark(
                    action=derived,
                    content_sha256=_resulting_hash(draft, decision, item),
                )
                update: dict[str, Any] = {
                    "consolidation": mark.model_copy(
                        update={"guidelines_unclear": cmd.guidelines_unclear}
                    )
                }
                if "note" in cmd.model_fields_set:
                    update["note"] = _note(cmd.note)
                changed[decision.decision_id] = decision.model_copy(update=update)
            draft.decisions = [changed.get(d.decision_id, d) for d in draft.decisions]

        return self._run(key, envelope, cmd.input_ids, apply)

    def reopen(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        cmd = ReopenCommand.model_validate(envelope.payload)

        def apply(draft: Draft, item: _Group, _document: Document) -> None:
            _clear_group(draft, item)
            _uncheck(draft, item)

        return self._run(key, envelope, cmd.input_ids, apply)


# --- automatic take-over --------------------------------------------------- #


def take_over_matches(
    conn: Connection, repo: Repository, pid: int, key: WorkspaceKey
) -> int:
    """Decide every undecided ``match`` group of the round of ``key`` with
    the mark ``auto`` (U14, T9); the number of groups decided.

    Runs on the caller's connection (the round and its inputs may be
    uncommitted). The earliest member is kept as is (``confirmed``, with the
    content hash of its target), the others are rejected; the reviewer is
    the consolidator. One edit event and one revision for all groups; nothing
    is written when no group needs it.
    """
    assert key.round_id is not None
    profile, defaults = project_profile(conn, pid)
    found = round_members(conn, pid, key.round_id, profile, defaults)
    draft = repo._open_draft(conn, key, None)
    decided = {(d.target.annotation_id, d.target.version) for d in draft.decisions}
    seeded: list[list[str]] = []
    for group in round_groups(found):
        if group.kinds != frozenset({"match"}):
            continue
        input_ids = list(group.members.values())
        refs = {iid: member_ref(found.members[iid]) for iid in input_ids}
        if any((r.annotation_id, r.version) in decided for r in refs.values()):
            continue
        keep = group.members[group.keep]
        for iid, ref in refs.items():
            kept = iid == keep
            draft.decisions.append(
                review_decision(
                    key,
                    ref,
                    outcome="confirmed" if kept else "rejected",
                    mark=ConsolidationMark(
                        action="auto",
                        content_sha256=consolidated_content_sha256(
                            found.members[iid].snapshot.annotation
                        )
                        if kept
                        else None,
                    ),
                )
            )
        seeded.append(sorted(input_ids))
    if not seeded:
        return 0
    row = repo._draft_row(conn, pid, _key_str(key))
    assert row is not None
    before = int(row.revision)
    now = datetime.now(UTC)
    conn.execute(
        update(DraftRow)
        .where(DraftRow.id == row.id)
        .values(revision=before + 1, updated_at=now)
    )
    conn.execute(delete(ReviewDecisionRow).where(ReviewDecisionRow.draft_id == row.id))
    Repository._write_draft_content(conn, row.id, [], [], draft.decisions)
    Repository._log_edit(
        conn,
        pid,
        row.id,
        MutationEnvelope(
            mutation_id=f"{AUTO_TAKE_OVER_COMMAND}-{key.round_id}",
            expected_revision=before,
            payload={"command": AUTO_TAKE_OVER_COMMAND, "groups": seeded},
        ),
        before,
        DraftState.of(draft),
        at=now,
    )
    return len(seeded)
