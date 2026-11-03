"""Hide annotator names during consolidation (issue 302).

With the project setting ``blind_consolidation`` on, a consolidator sees the
authors of a consolidation round's inputs as "Annotator A", "Annotator B", …
instead of names or pseudonyms. The letters follow the time each author's
first input submission was recorded (frozen drafts after them, in the
round's order), so they stay the same for the whole round. Every payload a
consolidator reads about the round's inputs carries the opaque id
``annotator-a``, … in place of the pseudonym: the consolidation view, the
round's inputs, the workspace's available inputs and the input submissions'
history. Tool proposals keep their tool actor. Leads (and system admins)
always see names; exports do not change.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar

from sqlalchemy import Connection, select

from ontotator.authz.policy import Access, Action, can
from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.review import ReviewDecision
from ontotator.storage.tables import (
    AssignmentRow,
    ProjectRow,
    SubmissionRow,
)
from ontotator.storage.workflow_tables import RoundInputRow, WorkRoundRow

# A human author outside the round (for example of a carried input of an
# earlier round): hidden too, without a letter.
OTHER_ID = "annotator"
OTHER_LABEL = "Another annotator"

S = TypeVar("S", bound=AnnotationSnapshot)


def letters(index: int) -> str:
    """A, B, …, Z, AA, AB, … for the 0-based ``index``."""
    out = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        out = chr(ord("A") + rest) + out
    return out


@dataclass(frozen=True)
class Blinding:
    """The blinded identity of each input author of one round."""

    viewer: str  # the consolidator's own pseudonym, never hidden
    ids: Mapping[str, str]  # pseudonym -> "annotator-a"
    labels: Mapping[str, str]  # pseudonym -> "Annotator A"
    order: Sequence[str]  # pseudonyms, A first

    def person(self, pseudonym: str) -> str:
        if pseudonym == self.viewer:
            return pseudonym
        return self.ids.get(pseudonym, OTHER_ID)

    def label(self, pseudonym: str) -> str:
        if pseudonym == self.viewer:
            return pseudonym
        return self.labels.get(pseudonym, OTHER_LABEL)

    def snapshot(self, snap: S) -> S:
        """``snap`` with a hidden human author; a tool keeps its actor.

        The version stays the snapshot's: references by (id, version) keep
        working, and a reader cannot recompute the author from the hash
        without the other fields of the author's original.
        """
        actor = snap.annotation.provenance.actor
        if actor.kind != "human" or actor.actor_id == self.viewer:
            return snap
        provenance = snap.annotation.provenance.model_copy(
            update={
                "actor": actor.model_copy(
                    update={"actor_id": self.person(actor.actor_id)}
                )
            }
        )
        return snap.model_copy(
            update={
                "annotation": snap.annotation.model_copy(
                    update={"provenance": provenance}
                )
            }
        )

    def snapshots(self, snaps: Iterable[S]) -> list[S]:
        return [self.snapshot(snap) for snap in snaps]

    def decision(self, decision: ReviewDecision) -> ReviewDecision:
        return decision.model_copy(
            update={"reviewer_id": self.person(decision.reviewer_id)}
        )

    def input_view(self, item: Any) -> Any:
        """A ``RoundInputView`` with hidden source and target authors."""
        return item.model_copy(
            update={
                "source_snapshot": self.snapshot(item.source_snapshot),
                "target_snapshot": self.snapshot(item.target_snapshot)
                if item.target_snapshot is not None
                else None,
            }
        )


def build_blinding(
    viewer: str,
    order: Sequence[str],
    authors: Mapping[str, str],
    recorded: Mapping[str, datetime],
) -> Blinding:
    """Letters by each author's first recorded source submission; authors of
    frozen drafts (no recording time) after them, in source order."""
    first: dict[str, tuple[bool, float, int]] = {}
    for position, source in enumerate(order):
        author = authors.get(source)
        if author is None or author == viewer:
            continue
        at = recorded.get(source)
        key = (at is None, at.timestamp() if at is not None else 0.0, position)
        if author not in first or key < first[author]:
            first[author] = key
    ranked = sorted(first, key=first.__getitem__)
    return Blinding(
        viewer=viewer,
        ids={a: f"annotator-{letters(i).lower()}" for i, a in enumerate(ranked)},
        labels={a: f"Annotator {letters(i)}" for i, a in enumerate(ranked)},
        order=ranked,
    )


def recorded_at(
    conn: Connection, pid: int, submission_ids: Iterable[str]
) -> dict[str, datetime]:
    wanted = sorted(set(submission_ids))
    if not wanted:
        return {}
    return dict(
        conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.recorded_at).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(wanted),
            )
        )
        .tuples()
        .all()
    )


def blinds(conn: Connection, access: Access, pid: int, project_key: str) -> bool:
    """The project hides annotator names and the viewer is no lead."""
    if can(access, Action.EXPORT_ALL_WORK, project_key):
        return False
    return bool(
        conn.execute(
            select(ProjectRow.blind_consolidation).where(ProjectRow.id == pid)
        ).scalar()
    )


def round_blinding(
    conn: Connection, access: Access, pid: int, project_key: str, round_id: str
) -> Blinding | None:
    """The blinding of a consolidation round for ``access``, or None (names)."""
    kind = conn.execute(
        select(WorkRoundRow.kind).where(
            WorkRoundRow.project_id == pid, WorkRoundRow.round_id == round_id
        )
    ).scalar_one_or_none()
    if kind != "consolidation" or not blinds(conn, access, pid, project_key):
        return None
    order, authors = round_authors(conn, pid, round_id)
    return build_blinding(
        access.pseudonym,
        order,
        authors,
        recorded_at(conn, pid, [s for s in order if not s.startswith("draft-")]),
    )


def round_authors(
    conn: Connection, pid: int, round_id: str
) -> tuple[list[str], dict[str, str]]:
    """The round's sources in order and each source's author, as
    ``consolidation.round_members`` reads them (without the findings)."""
    sources = conn.execute(
        select(WorkRoundRow.input_submission_ids).where(
            WorkRoundRow.project_id == pid, WorkRoundRow.round_id == round_id
        )
    ).scalar_one_or_none()
    order = [str(sid) for sid in sources or []]
    authors: dict[str, str] = {}
    for row in conn.execute(
        select(
            RoundInputRow.source_submission_id,
            RoundInputRow.source_draft_snapshot_id,
            RoundInputRow.payload["source_snapshot"]["annotation"]["provenance"][
                "actor"
            ]["actor_id"].astext.label("actor_id"),
        )
        .where(RoundInputRow.project_id == pid, RoundInputRow.round_id == round_id)
        .order_by(RoundInputRow.position)
    ):
        source = (
            row.source_submission_id
            if row.source_submission_id is not None
            else f"draft-{row.source_draft_snapshot_id}"
        )
        if source not in order:
            order.append(source)
        if row.source_submission_id is None and source not in authors:
            authors[source] = row.actor_id
    sids = [s for s in order if not s.startswith("draft-")]
    if sids:
        authors.update(
            conn.execute(
                select(SubmissionRow.submission_id, SubmissionRow.annotator_id).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.submission_id.in_(sids),
                )
            )
            .tuples()
            .all()
        )
    return order, authors


def submission_blinding(
    conn: Connection,
    access: Access,
    pid: int,
    project_key: str,
    submission_id: str,
    owner: str,
) -> Blinding | None:
    """The blinding of a submission the viewer reads as an input of one of
    their consolidation rounds (not their own; leads never), or None."""
    if owner == access.pseudonym or not blinds(conn, access, pid, project_key):
        return None
    round_id = conn.execute(
        select(WorkRoundRow.round_id)
        .join(RoundInputRow, RoundInputRow.round_id == WorkRoundRow.round_id)
        .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
        .where(
            WorkRoundRow.project_id == pid,
            WorkRoundRow.kind == "consolidation",
            RoundInputRow.source_submission_id == submission_id,
            AssignmentRow.user_id == access.user_id,
        )
        .order_by(WorkRoundRow.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if round_id is None:
        return None
    return round_blinding(conn, access, pid, project_key, round_id)
