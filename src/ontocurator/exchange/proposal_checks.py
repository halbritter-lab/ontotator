"""Per-proposal decisions of proposal-check submissions (final export receipt)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import Connection, select

from ontocurator.domain.workspace import Submission
from ontocurator.exchange.t1 import _proposal_ref
from ontocurator.storage.proposal_queries import ProposalSetRef
from ontocurator.storage.tables import ProposalAnnotationRow, ProposalSetRow

DECISION_WORDS = {
    "confirmed": "confirmed",
    "rejected": "rejected",
    "changed": "corrected",
    "uncertain": "uncertain",
}


def proposal_check_record(
    submission: Submission, project: str, proposal_set: ProposalSetRef | None
) -> dict[str, Any]:
    """Every proposal of the round with its decision; findings the person added.

    ``proposal_set``: the set the targets belong to (looked up by the caller
    from ``proposal_annotations.proposal_set_id`` of the targets; all targets
    of a round come from one set, plan "Proposal targets")."""
    replaced = {
        d.replacement.annotation_id for d in submission.decisions if d.replacement
    }
    targets = {t.annotation_id for t in submission.targets.targets}
    decisions = [
        {
            "proposal_ref": _proposal_ref(d.target.annotation_id, project),
            "proposal_annotation_id": d.target.annotation_id,
            "proposal_version": d.target.version,
            "decision": DECISION_WORDS[d.outcome],
            "corrected_annotation_id": d.replacement.annotation_id
            if d.replacement
            else None,
            "note": d.note,
        }
        for d in sorted(
            submission.decisions,
            key=lambda d: (d.target.annotation_id, d.target.version),
        )
    ]
    added = sorted(
        s.annotation.annotation_id
        for s in submission.snapshots
        if s.annotation.annotation_id not in replaced
        and s.annotation.annotation_id not in targets
    )
    counts = {
        word: sum(1 for d in decisions if d["decision"] == word)
        for word in ("confirmed", "rejected", "corrected", "uncertain")
    }
    return {
        "proposal_set": None
        if proposal_set is None
        else {
            "id": proposal_set.id,
            "annotation_set_id": proposal_set.annotation_set_id,
        },
        "decisions": decisions,
        "added_annotation_ids": added,
        "counts": counts | {"added": len(added)},
    }


def proposal_check_records(
    conn: Connection,
    project_id: int | None,
    project: str,
    submissions: Iterable[Submission],
) -> dict[str, dict[str, Any]]:
    """Receipt key ``proposal_checks``: one record per proposal-check submission."""
    checks = [s for s in submissions if s.origin_key.mode == "proposal_check"]
    wanted = {(t.annotation_id, t.version) for s in checks for t in s.targets.targets}
    sets: dict[tuple[str, str], ProposalSetRef] = {}
    if wanted:
        rows = conn.execute(
            select(
                ProposalAnnotationRow.annotation_id,
                ProposalAnnotationRow.version,
                ProposalAnnotationRow.proposal_set_id,
                ProposalSetRow.annotation_set_id,
            )
            .outerjoin(
                ProposalSetRow,
                ProposalSetRow.id == ProposalAnnotationRow.proposal_set_id,
            )
            .where(
                ProposalAnnotationRow.project_id == project_id,
                ProposalAnnotationRow.annotation_id.in_({a for a, _ in wanted}),
            )
        )
        sets = {
            (r.annotation_id, r.version): ProposalSetRef(
                r.proposal_set_id, r.annotation_set_id
            )
            for r in rows
            if (r.annotation_id, r.version) in wanted
        }

    def set_of(sub: Submission) -> ProposalSetRef | None:
        # All targets of a round come from one set; take the first one found.
        return next(
            (
                sets[key]
                for t in sub.targets.targets
                if (key := (t.annotation_id, t.version)) in sets
            ),
            None,
        )

    return {
        sub.submission_id: proposal_check_record(sub, project, set_of(sub))
        for sub in checks
    }
