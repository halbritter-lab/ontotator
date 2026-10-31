"""Resolve, annotate and reopen consolidation groups; the automatic take-over
of matching findings (acceptance fixes spec "WP-E Backend").

All three group commands are draft mutations of the consolidator's
workspace (``Repository.run_mutation``: revision check, receipt, one edit
event). ``input_ids`` must name exactly one group of the round
(``consolidation.round_groups``), else ``ROUND_INPUT_INVALID``.

* **Resolve** replaces the group's decisions and resulting annotations: the
  consolidated annotation gets the deterministic id
  ``consolidated_annotation_id`` (``n`` = 0), the
  provenance ``merged`` with the contributing ``round-input:…`` refs and the
  consolidator as actor; every member target gets a ``changed`` decision
  with ``ConsolidationMark(action, guidelines_unclear, content_sha256)``.
  ``leave_out`` records ``rejected`` decisions only. Only *relevant*
  differences are decisions (acceptance 2026-10-22): ``keep`` is refused
  when the members differ in term or values or their spans genuinely
  conflict (``Group.span_conflict``); ``choose`` must name every differing
  axis (``Group.differing_axes``, measured across terms). Overlapping spans
  with small shifts and differing notes are no decision: span, evidence
  and note come with the member the result is based on
  (``span_from_input_id``). A group resolves to exactly one finding; the
  legacy ``keep_both`` action and ``term_choices`` are refused. The group
  note is the decisions' ``note``. Like ``merge-inputs`` it unchecks the
  group's layer. Modifiers (modifiers spec "Consolidation > Backend"):
  ``choice.modifiers`` is the explicit final list (validated like
  ``add_modifier``), omitted: the span member's; ``keep`` keeps the member's.
  A standalone modifier group (``modifier_as_finding``) resolves like any
  group (a modifier term may name a finding, e.g. Stillbirth; submit warns)
  or by ``leave_out`` with ``attach_to`` a resolved ``cons-…`` finding that
  then gains the modifier (S18); reopening it detaches it again, and
  reopening the target also reopens it (S21 B).
* **Annotate** changes note and flag on the decisions of a resolved group;
  annotations stay untouched, so every ``content_sha256`` stays valid.
* **Reopen** deletes the group's decisions and resulting annotations.
* **Reopen all** (R-10, "re-merge") does that for every group of the round in
  one mutation, then takes over the ``match`` groups again (``auto``), so the
  groups read as when the round started; findings added outside the groups
  stay. **Undo reopen all**, only directly after it, restores the draft's
  annotations, evidence, decisions and checked layers of the revision before
  (``edit_events.state``). Both are logged like every draft command.
* **Automatic take-over** (``take_over_matches``, called by
  ``WorkRoundService.create_in`` for consolidation rounds): every ``match``
  group gets the result of ``keep`` (the ``cons-…`` annotation with
  ``merged`` provenance and ``changed`` decisions), marked ``auto``; one
  edit event. Groups already decided are skipped, so it is idempotent. A
  group with an annotator's Unresolved finding is no ``match`` (#246): it
  stays open for a decision; the Unresolved note stays in provenance.

An edit of a ``cons-…`` annotation in the editor keeps the marked decisions
(``EditingService._update_decision_replacements``): the group stays
resolved and reads *edited*. Deleting it there drops its decisions, so the
group reads open again. An editor decision on a member target
(``ReviewService.decide``, ``release_group_of``) first reopens the group in
the same mutation, so its ``cons-…`` result never stays next to the
editor's decisions.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Connection, delete, select, update

from ontotator.application.consolidation import (
    RoundMember,
    consolidated_content_sha256,
    is_open,
    member_ref,
    round_groups,
    round_members,
)
from ontotator.application.document_row_panel import project_profile
from ontotator.domain.agreement import Group
from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    AnnotationSnapshot,
    Modifier,
    snapshot,
)
from ontotator.domain.axes import validate_axes
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import Document, Segment
from ontotator.domain.errors import DomainError, InvalidAnnotation, RevisionConflict
from ontotator.domain.profiles import TaskProfile, resolve_type
from ontotator.domain.review import (
    ConsolidationAction,
    ConsolidationMark,
    ReviewDecision,
    ReviewOutcome,
)
from ontotator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontotator.ontology.modifiers import TermRoles
from ontotator.storage.repository import DraftState, Repository, _key_str
from ontotator.storage.tables import (
    DraftAnnotationRow,
    DraftEvidenceRow,
    DraftRow,
    EditEventRow,
    ReviewDecisionRow,
)
from ontotator.storage.workflow_tables import WorkRoundRow

__all__ = [
    "AnnotateCommand",
    "ConsolidationGroupService",
    "ModifierIn",
    "ReopenAllCommand",
    "ReopenCommand",
    "ResolveChoice",
    "ResolveCommand",
    "UndoReopenAllCommand",
    "consolidated_annotation_id",
    "merged_annotation",
    "release_group_of",
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


class ModifierIn(BaseModel):
    """A chosen modifier of the resolved finding."""

    model_config = ConfigDict(extra="forbid")
    term_id: str
    segments: list[Segment] = Field(default_factory=list)


class ResolveChoice(BaseModel):
    """One person's span, the chosen term and axis values."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    span_from_input_id: str
    # null: the axis is not set (a person left it empty).
    axes: dict[str, str | None] = Field(default_factory=dict)
    # Omitted: the span member's note; null: no note.
    note_from_input_id: str | None = None
    # Omitted: the span member's modifiers.
    modifiers: list[ModifierIn] | None = None


class ResolveCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_ids: list[str] = Field(min_length=1)
    action: Literal["keep", "choose", "leave_out"]
    choice: ResolveChoice | None = None
    note: str | None = None
    guidelines_unclear: bool = False
    # A cons-… annotation a left-out standalone modifier is attached to.
    attach_to: str | None = None


class AnnotateCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_ids: list[str] = Field(min_length=1)
    # Omitted: the note stays; null or "": no note.
    note: str | None = None
    guidelines_unclear: bool


class ReopenCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_ids: list[str] = Field(min_length=1)


class ReopenAllCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command: Literal["consolidation_reopen_all"]


class UndoReopenAllCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    command: Literal["consolidation_undo_reopen_all"]


class TermValidator(Protocol):
    """The canonical id of ``term_id`` in the layer, ``None`` when the
    term is unknown or obsolete there (may load the ontology)."""

    def __call__(self, project_key: str, layer_id: str, term_id: str) -> str | None: ...


@dataclass(frozen=True)
class _Group:
    """One group of the round with its members (by input id, member order)."""

    round_id: str
    group: Group
    members: dict[str, RoundMember]
    profile: TaskProfile
    roles: TermRoles

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


# "Keep" takes the default member as it is; a group whose members differ in
# term or values (or whose spans conflict) needs a decision per differing
# field ("choose").
_UNSETTLED_BY_KEEP = frozenset({"term_differs", "values_differ"})


def _invalid(message: str) -> DomainError:
    return DomainError("ROUND_INPUT_INVALID", message)


def _note(value: str | None) -> str | None:
    return value if value and value.strip() else None


def _round_items(conn: Connection, repo: Repository, key: WorkspaceKey) -> list[_Group]:
    """Every group of the consolidation round of ``key``."""
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
    profile, defaults = project_profile(conn, pid)
    found = round_members(conn, pid, key.round_id, profile, defaults)
    return [
        _Group(
            round_id=key.round_id,
            group=group,
            members={iid: found.members[iid] for iid in group.members.values()},
            profile=profile,
            roles=found.roles,
        )
        for group in round_groups(found)
    ]


def _find_group(
    conn: Connection, repo: Repository, key: WorkspaceKey, input_ids: Sequence[str]
) -> _Group:
    """The consolidation group whose members are exactly ``input_ids``."""
    if len(set(input_ids)) != len(input_ids):
        raise _invalid("Repeated input")
    wanted = set(input_ids)
    for item in _round_items(conn, repo, key):
        if set(item.input_ids) == wanted:
            return item
    raise _invalid("The inputs are not exactly one consolidation group")


def _clear_group(
    draft: Draft, item: _Group, keep: frozenset[str] = frozenset()
) -> None:
    """Remove the group's decisions and resulting annotations: its
    deterministic ``cons-…`` annotations, replacements no remaining decision
    names, and adopted copies of its targets (except the annotation ids in
    ``keep``); then their unused evidence."""
    refs = {(r.annotation_id, r.version) for r in item.refs.values()}
    cons_ids = item.cons_ids()
    # A standalone modifier attached to this group's result reads open
    # again with it (S21 B); its modifier goes with the result.
    removed = [
        d
        for d in draft.decisions
        if (d.target.annotation_id, d.target.version) in refs
        or (d.consolidation is not None and d.consolidation.attached_to in cons_ids)
    ]
    draft.decisions = [d for d in draft.decisions if d not in removed]
    kept_replacements = {
        d.replacement.annotation_id for d in draft.decisions if d.replacement
    }
    doomed = cons_ids | {
        d.replacement.annotation_id
        for d in removed
        if d.replacement is not None
        and d.replacement.annotation_id not in kept_replacements
    }
    adopted = {f"{a}:{v}" for a, v in refs}
    dropped = [
        a
        for a in draft.annotations
        if a.annotation.annotation_id not in keep
        and (
            a.annotation.annotation_id in doomed
            or adopted & set(a.annotation.provenance.source_refs)
        )
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


def _standalone_modifier(item: _Group) -> Modifier:
    """The modifier a standalone modifier group stands for: the default
    member's term with its first mention's segments (as
    ``convert_to_modifier`` with ``link_span``)."""
    source = item.members[item.group.members[item.group.keep]].snapshot
    segments: list[Segment] = []
    if source.annotation.evidence_refs:
        first = source.annotation.evidence_refs[0]
        segments = next(
            (
                list(e.mention.segments)
                for e in source.evidence
                if (e.mention.evidence_id, e.version)
                == (first.evidence_id, first.version)
            ),
            [],
        )
    return Modifier(term_id=source.annotation.term_id, segments=segments)


def _draft_snapshot(draft: Draft, annotation_id: str) -> AnnotationSnapshot | None:
    return next(
        (a for a in draft.annotations if a.annotation.annotation_id == annotation_id),
        None,
    )


def _with_modifiers(
    draft: Draft,
    current: AnnotationSnapshot,
    modifiers: Sequence[Modifier],
    document: Document,
    profile: TaskProfile,
) -> None:
    """Re-snapshot the ``cons-…`` annotation ``current`` with ``modifiers``
    and repoint the decisions naming it; a mark that matched the old content
    gets the new hash, so the attach does not read *edited* (S18)."""
    annotation_id = current.annotation.annotation_id
    before = consolidated_content_sha256(current.annotation)
    try:
        annotation = Annotation.model_validate(
            current.annotation.model_dump()
            | {"modifiers": [m.model_dump() for m in modifiers]}
        )
        made = snapshot(annotation, list(current.evidence), document, profile)
    except (InvalidAnnotation, ValueError) as exc:
        raise _invalid(str(exc)) from exc
    _add(draft, made)
    after = consolidated_content_sha256(made.annotation)
    replacement = AnnotationRef(annotation_id=annotation_id, version=made.version)
    for index, decision in enumerate(draft.decisions):
        if (
            decision.replacement is None
            or decision.replacement.annotation_id != annotation_id
        ):
            continue
        update: dict[str, Any] = {"replacement": replacement}
        mark = decision.consolidation
        if mark is not None and mark.content_sha256 == before:
            update["consolidation"] = mark.model_copy(update={"content_sha256": after})
        draft.decisions[index] = decision.model_copy(update=update)


def _detach(draft: Draft, item: _Group, document: Document) -> None:
    """Undo an earlier attach of this standalone modifier group (S21): the
    target loses the modifier while it still has exactly that term and
    segments. An attach that only linked segments to the target's spanless
    modifier gives that modifier back without segments."""
    refs = list(item.refs.values())
    mark = next(
        (
            d.consolidation
            for d in draft.decisions
            if d.target in refs
            and d.consolidation is not None
            and d.consolidation.attached_to is not None
        ),
        None,
    )
    if mark is None or mark.attached_to is None:
        return
    current = _draft_snapshot(draft, mark.attached_to)
    if current is None:
        return
    attached = _standalone_modifier(item)
    if attached in current.annotation.modifiers:
        kept = [m for m in current.annotation.modifiers if m != attached]
        if mark.attached_linked:
            kept.append(Modifier(term_id=attached.term_id))
        _with_modifiers(draft, current, kept, document, item.profile)


def _attach(
    draft: Draft, item: _Group, target_id: str, document: Document
) -> tuple[bool, bool]:
    """Add the group's standalone modifier to the resolved ``cons-…``
    finding ``target_id`` (S18); whether the target changed and whether it
    only linked segments. The term already there without segments gets
    them; with the same segments it is a no-op; with other segments
    ``DUPLICATE_MODIFIER``."""
    current = (
        _draft_snapshot(draft, target_id) if target_id.startswith("cons-") else None
    )
    layer_id = next(iter(item.members.values())).snapshot.annotation.layer_id
    if current is None or current.annotation.layer_id != layer_id:
        raise DomainError(
            "INVALID_RESOLUTION", "Attach to a resolved finding of this round"
        )
    attached = _standalone_modifier(item)
    modifiers = list(current.annotation.modifiers)
    found = next((m for m in modifiers if m.term_id == attached.term_id), None)
    if found is not None and found.segments == attached.segments:
        return False, False
    if found is not None and found.segments:
        raise DomainError("DUPLICATE_MODIFIER", {"term_id": attached.term_id})
    kept = [m for m in modifiers if m is not found]
    _with_modifiers(draft, current, [*kept, attached], document, item.profile)
    return True, found is not None


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


def _add_result(
    draft: Draft,
    key: WorkspaceKey,
    annotation_id: str,
    base: RoundMember,
    annotation: Annotation,
    contributors: Mapping[str, AnnotationRef],
    mark: ConsolidationMark,
    document: Document,
    profile: TaskProfile,
    *,
    note: str | None = None,
) -> None:
    """Add one consolidated annotation (``annotation`` as ``annotation_id``,
    provenance ``merged`` from ``contributors`` by the consolidator, span and
    evidence of ``base``) and a ``changed`` decision per contributing target,
    marked with ``mark`` and the annotation's content hash. Resolve and the
    automatic take-over share it, so their results look alike."""
    consolidated = merged_annotation(
        annotation.model_copy(update={"annotation_id": annotation_id}),
        list(contributors),
        actor=ActorRef(actor_id=key.annotator_id, kind="human"),
    )
    made = snapshot(consolidated, list(base.snapshot.evidence), document, profile)
    _add(draft, made)
    marked = mark.model_copy(
        update={"content_sha256": consolidated_content_sha256(made.annotation)}
    )
    replacement = AnnotationRef(
        annotation_id=made.annotation.annotation_id, version=made.version
    )
    for ref in contributors.values():
        draft.decisions.append(
            review_decision(
                key,
                ref,
                outcome="changed",
                replacement=replacement,
                note=note,
                mark=marked,
            )
        )


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

        # Loads the ontology and its modifier classifier before the draft
        # lock is taken; the group's inputs are frozen, so this read is stable.
        with self.repo.db.transaction() as conn:
            _find_group(conn, self.repo, key, input_ids)
        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result

    def _checked_choice(
        self, key: WorkspaceKey, cmd: ResolveCommand
    ) -> tuple[str | None, list[Modifier] | None]:
        """The canonical id of a chosen term outside the group's terms
        ("Other term…") and the validated ``choice.modifiers``, checked
        before the draft lock is taken: the checks may load the ontology,
        and the group's members are frozen inputs."""
        choice = cmd.choice
        if choice is None:
            return None, None
        with self.repo.db.transaction() as conn:
            item = _find_group(conn, self.repo, key, cmd.input_ids)
        base = item.members.get(choice.span_from_input_id)
        if base is None:
            return None, None  # refused by ``_chosen``
        layer_id = base.snapshot.annotation.layer_id
        other_term = None
        if choice.term_id not in item.group.terms and self.valid_term is not None:
            other_term = self.valid_term(key.project_key, layer_id, choice.term_id)
        if choice.modifiers is None:
            return other_term, None
        return other_term, self._modifiers(key, item, layer_id, choice.modifiers)

    def _modifiers(
        self, key: WorkspaceKey, item: _Group, layer_id: str, given: list[ModifierIn]
    ) -> list[Modifier]:
        """The explicit final modifier list (not required to come from the
        members, so "Edit values…" may add one), validated as ``add_modifier``."""
        if given and not item.roles.supports(layer_id):
            raise DomainError("MODIFIERS_NOT_SUPPORTED", {"layer_id": layer_id})
        result: list[Modifier] = []
        for modifier in given:
            term_id = (
                self.valid_term(key.project_key, layer_id, modifier.term_id)
                if self.valid_term is not None
                else modifier.term_id
            )
            if term_id is None:
                raise DomainError("UNKNOWN_TERM", {"term_id": modifier.term_id})
            if item.roles.kind(layer_id, term_id) is None:
                raise DomainError("MODIFIER_NOT_ALLOWED", {"term_id": term_id})
            if any(m.term_id == term_id for m in result):
                raise DomainError("DUPLICATE_MODIFIER", {"term_id": term_id})
            result.append(Modifier(term_id=term_id, segments=modifier.segments))
        return result

    def resolve(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        if (
            envelope.payload.get("action") == "keep_both"
            or "term_choices" in envelope.payload
        ):
            raise _invalid(
                "Keep both is no longer offered: choose one finding and add a"
                " second finding on the text"
            )
        cmd = ResolveCommand.model_validate(envelope.payload)
        other_term, modifiers = self._checked_choice(key, cmd)

        def apply(draft: Draft, item: _Group, document: Document) -> None:
            if cmd.attach_to is not None and (
                cmd.action != "leave_out"
                or "modifier_as_finding" not in item.group.kinds
            ):
                raise DomainError(
                    "INVALID_RESOLUTION",
                    "Only a standalone modifier left out is attached to a finding",
                )
            plans = self._plans(cmd, item, other_term, modifiers)
            _detach(draft, item, document)
            _clear_group(draft, item)
            note = _note(cmd.note)
            if cmd.action == "leave_out":
                # Attaching what the target already has changes nothing: a
                # plain leave-out, so a reopen never removes the target's own.
                attached, linked = (
                    _attach(draft, item, cmd.attach_to, document)
                    if cmd.attach_to is not None
                    else (False, False)
                )
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
                                attached_to=cmd.attach_to if attached else None,
                                attached_linked=linked,
                            ),
                        )
                    )
                _uncheck(draft, item)
                return
            for n, (base, annotation, contributors) in enumerate(plans):
                _add_result(
                    draft,
                    key,
                    consolidated_annotation_id(item.round_id, item.input_ids, n),
                    base,
                    annotation,
                    {iid: item.refs[iid] for iid in contributors},
                    ConsolidationMark(
                        action=cmd.action,
                        guidelines_unclear=cmd.guidelines_unclear,
                    ),
                    document,
                    item.profile,
                    note=note,
                )
            _uncheck(draft, item)

        return self._run(key, envelope, cmd.input_ids, apply)

    def _plans(
        self,
        cmd: ResolveCommand,
        item: _Group,
        other_term: str | None,
        modifiers: list[Modifier] | None,
    ) -> list[tuple[RoundMember, Annotation, list[str]]]:
        """Per consolidated annotation: the member giving span and evidence,
        the annotation content and the contributing input ids. ``other_term``
        is the canonical id of a chosen term outside the group's terms,
        ``modifiers`` the validated ``choice.modifiers``."""
        if (cmd.choice is not None) != (cmd.action == "choose"):
            raise _invalid("A choice goes with the action 'choose' only")
        group, members = item.group, item.members
        if cmd.action == "leave_out":
            return []
        if cmd.action == "keep":
            if group.kinds & _UNSETTLED_BY_KEEP or group.span_conflict:
                raise _invalid("Choose the term, every differing value and the text")
            keep = members[group.members[group.keep]]
            return [(keep, keep.snapshot.annotation, item.input_ids)]
        choice = cmd.choice
        assert choice is not None
        term_id = choice.term_id if choice.term_id in group.terms else other_term
        if term_id is None:
            raise _invalid("The term is not valid in this layer")
        base, chosen = self._chosen(
            item, choice, item.input_ids, group.differing_axes, term_id, modifiers
        )
        return [(base, chosen, item.input_ids)]

    @staticmethod
    def _chosen(
        item: _Group,
        choice: ResolveChoice,
        allowed: Sequence[str],
        differing_axes: Sequence[str],
        term_id: str,
        modifiers: list[Modifier] | None = None,
    ) -> tuple[RoundMember, Annotation]:
        """The member giving span, evidence and (by default) note and
        modifiers, and the chosen annotation: ``term_id``, the member's axes
        overlaid with the chosen ones, ``modifiers`` when given. ``allowed``
        are the input ids span and note may come from; ``choice.axes`` must
        name every axis of ``differing_axes``."""
        members = item.members
        if choice.span_from_input_id not in allowed:
            raise _invalid("The span comes from a member of the group")
        if (
            choice.note_from_input_id is not None
            and choice.note_from_input_id not in allowed
        ):
            raise _invalid("The note comes from a member of the group")
        unchosen = [axis for axis in differing_axes if axis not in choice.axes]
        if unchosen:
            raise _invalid("Choose every differing value: " + ", ".join(unchosen))
        base = members[choice.span_from_input_id]
        source = base.snapshot.annotation
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
        content: dict[str, Any] = {"term_id": term_id, "note": note}
        if modifiers is not None:
            content["modifiers"] = [m.model_dump() for m in modifiers]
        try:
            chosen = Annotation.model_validate(
                source.with_axes(axes).model_dump() | content
            )
        except (InvalidAnnotation, ValueError) as exc:
            raise _invalid(str(exc)) from exc
        return base, chosen

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

        def apply(draft: Draft, item: _Group, document: Document) -> None:
            _detach(draft, item, document)
            _clear_group(draft, item)
            _uncheck(draft, item)

        return self._run(key, envelope, cmd.input_ids, apply)

    def reopen_all(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        ReopenAllCommand.model_validate(envelope.payload)

        def operation(draft: Draft) -> Draft:
            with self.repo.db.transaction() as conn:
                items = _round_items(conn, self.repo, key)
            document = self.repo.get_document(key.project_key, key.document_id)
            assert document is not None
            for item in items:
                _detach(draft, item, document)
                _clear_group(draft, item)
                _uncheck(draft, item)
            # As at the round's start (``take_over_matches``).
            for item in items:
                if item.group.kinds == frozenset({"match"}):
                    keep = item.members[item.group.members[item.group.keep]]
                    _add_result(
                        draft,
                        key,
                        consolidated_annotation_id(item.round_id, item.input_ids, 0),
                        keep,
                        keep.snapshot.annotation,
                        item.refs,
                        ConsolidationMark(action="auto"),
                        document,
                        item.profile,
                    )
            return draft

        # Loads the ontology before the draft lock is taken (as ``_run``).
        with self.repo.db.transaction() as conn:
            _round_items(conn, self.repo, key)
        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result

    def undo_reopen_all(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        UndoReopenAllCommand.model_validate(envelope.payload)

        def operation(draft: Draft) -> Draft:
            with self.repo.db.transaction() as conn:
                last = conn.execute(
                    self.repo._draft_events(key)
                    .where(EditEventRow.revision_after == draft.revision)
                    .order_by(EditEventRow.id.desc())
                    .limit(1)
                ).one_or_none()
            if (
                last is None
                or (last.command or {}).get("command") != "consolidation_reopen_all"
            ):
                raise RevisionConflict(
                    "Nothing to undo: the last change was not Reopen all decisions"
                )
            before = self.repo.draft_state_at(key, int(last.revision_before))
            # The pairs come from this workspace's own state (``draft_state_at``
            # checks the access), so they are read unscoped: the scoped read
            # refuses snapshots no current draft or submission names.
            have = {
                (a.annotation.annotation_id, a.version): a for a in draft.annotations
            }
            have_evidence = {
                (e.mention.evidence_id, e.version): e for e in draft.evidence
            }
            annotations = [
                have.get(pair)
                or Repository.get_annotation_snapshot(self.repo, *pair, key.project_key)
                for pair in before.annotations
            ]
            evidence = [
                have_evidence.get(pair)
                or Repository.get_evidence_snapshot(self.repo, *pair, key.project_key)
                for pair in before.evidence
            ]
            if None in annotations or None in evidence:
                raise RevisionConflict("The previous decisions can no longer be read")
            draft.annotations = [a for a in annotations if a is not None]
            draft.evidence = [e for e in evidence if e is not None]
            draft.decisions = [
                ReviewDecision.model_validate(d) for d in before.decisions
            ]
            draft.checked_layer_ids = list(before.checked_layer_ids)
            return draft

        result = self.repo.run_mutation(key, envelope, operation)
        assert isinstance(result, Draft)
        return result


def release_group_of(
    repo: Repository,
    key: WorkspaceKey,
    draft: Draft,
    target: AnnotationRef,
    keep: AnnotationRef | None = None,
) -> bool:
    """Reopen the group of ``target`` when its decision is consolidation
    marked, before an editor decision replaces it; whether it did.

    The editor decision on one member supersedes the group's resolution:
    like reopen, its ``cons-…`` annotations and the other members' marked
    decisions go (so no result stays behind next to the editor's
    decisions). ``keep`` (the editor decision's replacement, e.g. an
    adopted copy of ``target``) survives. Joins the caller's transaction.
    """
    prior = next((d for d in draft.decisions if d.target == target), None)
    if prior is None or prior.consolidation is None or key.round_id is None:
        return False
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, key.project_key)
        profile, defaults = project_profile(conn, pid)
        found = round_members(conn, pid, key.round_id, profile, defaults)
    for group in round_groups(found):
        members = {iid: found.members[iid] for iid in group.members.values()}
        if any(member_ref(m) == target for m in members.values()):
            item = _Group(key.round_id, group, members, profile, found.roles)
            kept = frozenset({keep.annotation_id} if keep is not None else set())
            document = repo.get_document(key.project_key, key.document_id)
            assert document is not None
            _detach(draft, item, document)
            _clear_group(draft, item, keep=kept)
            return True
    return False


# --- automatic take-over --------------------------------------------------- #


def take_over_matches(
    conn: Connection, repo: Repository, pid: int, key: WorkspaceKey
) -> int:
    """Decide every undecided ``match`` group of the round of ``key`` with
    the mark ``auto`` (U14, T9); the number of groups decided.

    Runs on the caller's connection (the round and its inputs may be
    uncommitted). Each group gets the result of "Keep" (``_add_result``):
    the annotation ``cons-…`` (``n`` = 0) from its earliest member with
    ``merged`` provenance, and a ``changed`` decision per member, so an
    automatic group exports like a resolved one and an edit in the editor
    reads *edited*. The decisions' ``reviewer_id`` is the consolidator; the
    edit event's user is the caller who starts the round (the lead in the
    start command, the consolidator when they start it themselves), as for
    every write of ``create_in``. One edit event and one revision for all
    groups; nothing is written when no group needs it.
    """
    assert key.round_id is not None
    profile, defaults = project_profile(conn, pid)
    found = round_members(conn, pid, key.round_id, profile, defaults)
    draft = repo._open_draft(conn, key, None)
    decided = {(d.target.annotation_id, d.target.version) for d in draft.decisions}
    seeded: list[list[str]] = []
    document: Document | None = None
    for group in round_groups(found):
        if group.kinds != frozenset({"match"}):
            continue
        input_ids = list(group.members.values())
        refs = {iid: member_ref(found.members[iid]) for iid in input_ids}
        if any((r.annotation_id, r.version) in decided for r in refs.values()):
            continue
        if document is None:
            # Joins the caller's transaction.
            document = repo.get_document(key.project_key, key.document_id)
            assert document is not None
        keep = found.members[group.members[group.keep]]
        _add_result(
            draft,
            key,
            consolidated_annotation_id(key.round_id, input_ids, 0),
            keep,
            keep.snapshot.annotation,
            refs,
            ConsolidationMark(action="auto"),
            document,
            profile,
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
    for table in (DraftAnnotationRow, DraftEvidenceRow, ReviewDecisionRow):
        conn.execute(delete(table).where(table.draft_id == row.id))
    Repository._insert_snapshots(conn, pid, draft.annotations, draft.evidence)
    Repository._write_draft_content(
        conn, row.id, draft.annotations, draft.evidence, draft.decisions
    )
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
