"""Undo, redo and reset of a draft's own changes (issue 320).

The history is built from the edit log, so it survives a reload. It covers
the edits after the last submit or server-side rewrite of the current draft
(the current round); before them is its base: the state the draft started
with (``drafts.initial_state``) or the state that event left.

One step is one user action: one logged command, or the consecutive commands
that share a ``step_id``. Commands of one action that another action got
between are taken together with it. Undo, redo and reset write a new edit
that puts a logged state back (whole content: findings, evidence, decisions,
checked layers and resolutions; the targets and frozen re-anchor inputs stay);
history is never rewritten. ``undo_step`` and ``redo_step`` name the step they
take back or bring back, so a replay of the log gives the same stacks.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Connection, select, tuple_

from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.documents import EvidenceSnapshot
from ontotator.domain.errors import DomainError
from ontotator.domain.reanchor_resolution import ReanchorResolution
from ontotator.domain.review import ReviewDecision
from ontotator.domain.serialization import decode_snapshot
from ontotator.domain.workspace import (
    Draft,
    MutationEnvelope,
    RoundInputResolution,
    WorkspaceKey,
)
from ontotator.storage.repository import DraftState, Repository, _key_str
from ontotator.storage.tables import (
    AnnotationSnapshotRow,
    EditEventRow,
    EvidenceSnapshotRow,
)

UNDO = "undo_step"
REDO = "redo_step"
RESET = "reset_changes"

#: Commands an annotator sends from the editor; each is (part of) a step.
EDIT_COMMANDS = frozenset(
    {
        "create_annotation",
        "recreate_reanchor",
        "set_term",
        "set_annotation_note",
        "set_axes",
        "attach_mention",
        "edit_mention",
        "detach_mention",
        "delete_draft_annotation",
        "check_layer",
        "add_modifier",
        "set_modifier_segments",
        "remove_modifier",
        "convert_to_modifier",
        "clear_round_input_resolution",
        RESET,
    }
)

#: Consolidation drafts keep resolution marks only the consolidation screen
#: writes; their editor has no history.
HISTORY_MODES = frozenset({"independent", "proposal_check"})


def action_of(command: dict[str, Any]) -> str | None:
    """The user action a logged command is, or None for anything else.

    Decisions, round-input and re-anchor resolutions carry no ``command``
    key; they are told apart by their fields.
    """
    name = command.get("command")
    if name is None:
        if "target" in command:
            return "decision"
        if "input_id" in command and "outcome" in command:
            return "resolve_round_input"
        if "item" in command and "outcome" in command:
            return "resolve_reanchor"
        return None
    return str(name) if name in EDIT_COMMANDS else None


class HistoryCommand(BaseModel):
    """Payload of ``POST /workspaces/{id}/history``."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["undo_step", "redo_step", "reset_changes"]
    # The step to take back or bring back: its ``after_revision``.
    step: int | None = None


class HistoryStepView(BaseModel):
    """One step as the editor names it ("Undo: delete finding Seizure")."""

    model_config = ConfigDict(extra="forbid")

    before_revision: int
    after_revision: int
    action: str
    outcome: str | None = None
    annotation_id: str | None = None
    layer_id: str | None = None
    term_id: str | None = None
    commands: int = 1


class DraftHistoryView(BaseModel):
    """What undo, redo and reset would do now."""

    model_config = ConfigDict(extra="forbid")

    available: bool
    revision: int
    undo: HistoryStepView | None = None
    redo: HistoryStepView | None = None
    undo_count: int = 0
    redo_count: int = 0
    # The content differs from the start of the round: reset would change it.
    changed: bool = False


@dataclass(frozen=True)
class _Event:
    id: int
    kind: str
    command: dict[str, Any]
    revision_before: int
    revision_after: int
    state: dict[str, Any]
    step_id: str | None


@dataclass
class _Step:
    events: list[_Event]
    kind: Literal["edit", "undo", "redo"] = "edit"

    @property
    def before(self) -> int:
        return self.events[0].revision_before

    @property
    def after(self) -> int:
        return self.events[-1].revision_after

    @property
    def target(self) -> int | None:
        step = self.events[0].command.get("step")
        return step if isinstance(step, int) else None


@dataclass
class DraftHistory:
    """The undo and redo stacks of the current draft of a key."""

    base_revision: int
    base_state: DraftState
    events: list[_Event]
    # Events before the base (earlier rounds of the same draft), oldest first.
    earlier: list[_Event] = field(default_factory=list)
    done: list[_Step] = field(default_factory=list)
    undone: list[_Step] = field(default_factory=list)

    def state_at(self, revision: int) -> DraftState | None:
        """The logged content after ``revision``; None when it is not logged."""
        if revision == self.base_revision:
            return self.base_state
        for event in reversed([*self.earlier, *self.events]):
            if event.revision_after == revision:
                return DraftState.from_json(event.state)
        return None

    def effective_events(self) -> list[_Event]:
        """The events whose effect the current content still has, oldest first.

        Earlier events, then the events of the steps on the undo stack.
        Undone steps and the undo and redo commands themselves are left out.
        """
        return [*self.earlier, *(e for step in self.done for e in step.events)]


def _same(a: DraftState, b: DraftState) -> bool:
    """Equal content; the frozen re-anchor inputs are not content."""
    left, right = a.to_json(), b.to_json()
    left.pop("reanchor_inputs", None)
    right.pop("reanchor_inputs", None)
    return left == right


def build_history(
    repo: Repository, conn: Connection, key: WorkspaceKey
) -> DraftHistory:
    """Read the edit log of the current draft of ``key`` and replay its steps."""
    project_id = repo._require_project(conn, key.project_key)
    row = repo._draft_row(conn, project_id, _key_str(key))
    if row is None:
        return DraftHistory(0, DraftState(), [])
    rows = conn.execute(
        select(
            EditEventRow.id,
            EditEventRow.kind,
            EditEventRow.command,
            EditEventRow.revision_before,
            EditEventRow.revision_after,
            EditEventRow.state,
            EditEventRow.step_id,
        )
        .where(EditEventRow.project_id == project_id, EditEventRow.draft_id == row.id)
        .order_by(EditEventRow.id)
    ).all()
    events = [_Event(**r._asdict()) for r in rows]
    barrier = None
    for index, event in enumerate(events):
        name = event.command.get("command")
        if event.kind != "edit" or (
            name not in (UNDO, REDO) and action_of(event.command) is None
        ):
            barrier = index
    if barrier is None:
        base_state = repo._draft_initial_state(conn, key)
        segment = events
        base_revision = segment[0].revision_before if segment else int(row.revision)
        earlier: list[_Event] = []
    else:
        base_state = DraftState.from_json(events[barrier].state)
        base_revision = events[barrier].revision_after
        segment = events[barrier + 1 :]
        earlier = events[: barrier + 1]
    history = DraftHistory(base_revision, base_state, segment, earlier)
    for step in _steps(segment):
        if step.kind == "edit":
            history.done.append(step)
            history.undone.clear()
        elif step.kind == "undo":
            if history.done and history.done[-1].after == step.target:
                history.undone.append(history.done.pop())
        elif history.undone and history.undone[-1].after == step.target:
            history.done.append(history.undone.pop())
    return history


def _steps(events: Sequence[_Event]) -> list[_Step]:
    steps: list[_Step] = []
    for event in events:
        name = event.command.get("command")
        if name in (UNDO, REDO):
            steps.append(_Step([event], "undo" if name == UNDO else "redo"))
            continue
        joined = False
        if event.step_id is not None:
            # The same action again since the last undo or redo: one step from
            # its first command on (an action that got in between joins it).
            for index in range(len(steps) - 1, -1, -1):
                if steps[index].kind != "edit":
                    break
                if any(e.step_id == event.step_id for e in steps[index].events):
                    merged = [e for step in steps[index:] for e in step.events]
                    del steps[index:]
                    steps.append(_Step([*merged, event]))
                    joined = True
                    break
        if not joined:
            steps.append(_Step([event]))
    return steps


class DraftHistoryService:
    """Undo, redo and reset of the current round's own changes (issue 320)."""

    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def view(self, key: WorkspaceKey) -> DraftHistoryView:
        """The current undo and redo steps of the draft of ``key``."""
        with self.repo.db.transaction() as conn:
            project_id = self.repo._require_project(conn, key.project_key)
            row = self.repo._draft_row(conn, project_id, _key_str(key))
            revision = 0 if row is None else int(row.revision)
            if key.mode not in HISTORY_MODES or row is None:
                return DraftHistoryView(available=False, revision=revision)
            history = build_history(self.repo, conn, key)
            current = history.state_at(revision)
            return DraftHistoryView(
                available=True,
                revision=revision,
                undo=self._describe(conn, project_id, key, history, history.done),
                redo=self._describe(conn, project_id, key, history, history.undone),
                undo_count=len(history.done),
                redo_count=len(history.undone),
                changed=current is not None and not _same(current, history.base_state),
            )

    def apply(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        """Undo or redo the named step, or reset to the start of the round.

        Raises:
            DomainError: ``HISTORY_NOT_AVAILABLE`` (a consolidation),
                ``HISTORY_STEP_UNAVAILABLE`` (the step is not the one undo or
                redo would take now), ``HISTORY_NOTHING_TO_RESET``, plus the
                editability errors of every draft write.
        """
        if key.mode not in HISTORY_MODES:
            raise DomainError("HISTORY_NOT_AVAILABLE")
        command = HistoryCommand.model_validate(envelope.payload)
        if command.command != RESET and command.step is None:
            raise DomainError("HISTORY_STEP_UNAVAILABLE")
        loaded: list[tuple[DraftState, _Content]] = []

        def load(conn: Connection) -> None:
            # Inside the mutation's transaction, after the draft lock.
            loaded.clear()
            history = build_history(self.repo, conn, key)
            state: DraftState | None = history.base_state
            if command.command != RESET:
                stack = history.done if command.command == UNDO else history.undone
                if not stack or stack[-1].after != command.step:
                    raise DomainError(
                        "HISTORY_STEP_UNAVAILABLE", {"step": command.step}
                    )
                step = stack[-1]
                state = history.state_at(
                    step.before if command.command == UNDO else step.after
                )
            if state is None:
                raise DomainError("HISTORY_STEP_UNAVAILABLE", {"step": command.step})
            loaded.append((state, _loaded(conn, self.repo, key, state)))

        def operation(draft: Draft) -> Draft:
            state, content = loaded[0]
            if command.command == RESET and _same(DraftState.of(draft), state):
                raise DomainError("HISTORY_NOTHING_TO_RESET")
            draft.annotations = content.annotations
            draft.evidence = content.evidence
            draft.decisions = [
                ReviewDecision.model_validate(d) for d in state.decisions
            ]
            draft.checked_layer_ids = list(state.checked_layer_ids)
            draft.reanchor_resolutions = [
                ReanchorResolution.model_validate(r) for r in state.reanchor_resolutions
            ]
            draft.round_input_resolutions = [
                RoundInputResolution.model_validate(r)
                for r in state.round_input_resolutions
            ]
            return draft

        result = self.repo.run_mutation(key, envelope, operation, before_operation=load)
        assert isinstance(result, Draft)
        return result

    def _describe(
        self,
        conn: Connection,
        project_id: int,
        key: WorkspaceKey,
        history: DraftHistory,
        stack: list[_Step],
    ) -> HistoryStepView | None:
        if not stack:
            return None
        step = stack[-1]
        command = step.events[0].command
        action = action_of(command) or "edit"
        view = HistoryStepView(
            before_revision=step.before,
            after_revision=step.after,
            action=action,
            outcome=command.get("outcome"),
            commands=len(step.events),
            layer_id=command.get("layer_id"),
        )
        ref: tuple[str, str | None] | None = None
        if action == "decision":
            target = command.get("target") or {}
            ref = (str(target.get("annotation_id")), target.get("version"))
        elif action in ("resolve_round_input", "clear_round_input_resolution"):
            source = self._round_input_source(key, str(command.get("input_id")))
            if source is not None:
                view.annotation_id = source.get("annotation_id")
                view.layer_id = source.get("layer_id")
                view.term_id = source.get("term_id")
            return view
        elif action == "resolve_reanchor":
            source_ref = (command.get("item") or {}).get("source_ref") or {}
            if source_ref.get("annotation_id"):
                ref = (str(source_ref["annotation_id"]), source_ref.get("version"))
        elif command.get("annotation_id"):
            ref = (str(command["annotation_id"]), None)
        if ref is None:
            return view
        annotation_id, version = ref
        view.annotation_id = annotation_id
        if version is None:
            # The finding after the step, or before it when the step removed it.
            for revision in (step.after, step.before):
                state = history.state_at(revision)
                version = next(
                    (
                        v
                        for i, v in (state.annotations if state else ())
                        if i == annotation_id
                    ),
                    None,
                )
                if version is not None:
                    break
        if version is None:
            return view
        payload = conn.execute(
            select(AnnotationSnapshotRow.payload).where(
                AnnotationSnapshotRow.project_id == project_id,
                AnnotationSnapshotRow.annotation_id == annotation_id,
                AnnotationSnapshotRow.version == version,
            )
        ).scalar_one_or_none()
        if payload is not None:
            annotation = payload.get("annotation", {})
            view.layer_id = annotation.get("layer_id", view.layer_id)
            view.term_id = annotation.get("term_id")
        return view

    def _round_input_source(
        self, key: WorkspaceKey, input_id: str
    ) -> dict[str, Any] | None:
        if key.round_id is None:
            return None
        for item in self.repo.get_round_input_inventory(key.project_key, key.round_id):
            if item.get("input_id") == input_id:
                source = item.get("source_snapshot") or {}
                annotation = source.get("annotation") or {}
                return {
                    "annotation_id": annotation.get("annotation_id"),
                    "layer_id": annotation.get("layer_id"),
                    "term_id": annotation.get("term_id"),
                }
        return None


@dataclass(frozen=True)
class _Content:
    annotations: list[AnnotationSnapshot]
    evidence: list[EvidenceSnapshot]


def _loaded(
    conn: Connection, repo: Repository, key: WorkspaceKey, state: DraftState
) -> _Content:
    """The snapshots a logged state names, from the content-addressed rows."""
    project_id = repo._require_project(conn, key.project_key)
    annotations: dict[tuple[str, str], AnnotationSnapshot] = {}
    if state.annotations:
        for row in conn.execute(
            select(
                AnnotationSnapshotRow.annotation_id,
                AnnotationSnapshotRow.version,
                AnnotationSnapshotRow.payload,
            ).where(
                AnnotationSnapshotRow.project_id == project_id,
                tuple_(
                    AnnotationSnapshotRow.annotation_id, AnnotationSnapshotRow.version
                ).in_(list(state.annotations)),
            )
        ):
            annotations[(row.annotation_id, row.version)] = decode_snapshot(row.payload)
    evidence: dict[tuple[str, str], EvidenceSnapshot] = {}
    if state.evidence:
        for row in conn.execute(
            select(
                EvidenceSnapshotRow.evidence_id,
                EvidenceSnapshotRow.version,
                EvidenceSnapshotRow.payload,
            ).where(
                EvidenceSnapshotRow.project_id == project_id,
                tuple_(
                    EvidenceSnapshotRow.evidence_id, EvidenceSnapshotRow.version
                ).in_(list(state.evidence)),
            )
        ):
            evidence[(row.evidence_id, row.version)] = EvidenceSnapshot.model_validate(
                row.payload
            )
    if len(annotations) != len(set(state.annotations)) or len(evidence) != len(
        set(state.evidence)
    ):
        raise DomainError("HISTORY_STEP_UNAVAILABLE")
    return _Content(
        [annotations[pair] for pair in state.annotations],
        [evidence[pair] for pair in state.evidence],
    )
