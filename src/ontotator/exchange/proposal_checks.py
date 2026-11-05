"""Per-proposal decisions of proposal-check submissions (final export receipt)
and the tool behind each proposal (proposals.csv)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy import Connection, select

from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.workspace import Submission
from ontotator.exchange.t1 import _proposal_ref
from ontotator.storage.proposal_queries import ProposalSetRef
from ontotator.storage.tables import (
    DocumentRow,
    EmptyProposalSetRow,
    ProposalAnnotationRow,
    ProposalSetRow,
)

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


def proposal_sources(
    conn: Connection,
    project_id: int | None,
    submissions: Iterable[Submission],
    proposals: Mapping[tuple[str, str], AnnotationSnapshot],
) -> dict[tuple[str, str], tuple[str, str]]:
    """Per target of a proposal check, the tool that proposed it: name and
    version of the proposal's actor in the imported set (proposals.csv).

    An actor without a name is named by its id; a seed proposal without a set
    by the actor id of its provenance, with an empty version."""
    wanted = {
        (t.annotation_id, t.version)
        for s in submissions
        if s.origin_key.mode == "proposal_check"
        for t in s.targets.targets
        if (t.annotation_id, t.version) in proposals
    }
    actors: dict[tuple[str, str], list[dict[str, Any]]] = {}
    if wanted:
        rows = conn.execute(
            select(
                ProposalAnnotationRow.annotation_id,
                ProposalAnnotationRow.version,
                ProposalSetRow.actors,
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
        actors = {
            (r.annotation_id, r.version): list(r.actors or [])
            for r in rows
            if (r.annotation_id, r.version) in wanted
        }
    sources = {}
    for key in sorted(wanted):
        actor_id = proposals[key].annotation.provenance.actor.actor_id
        actor = next(
            (a for a in actors.get(key, []) if a.get("actor_id") == actor_id), {}
        )
        sources[key] = (actor.get("name") or actor_id, actor.get("version") or "")
    return sources


def tool_chances(
    sets: Iterable[tuple[str, Iterable[Mapping[str, Any]], Mapping[str, Any]]],
) -> dict[tuple[str, str], dict[str, bool]]:
    """Per tool (name and version as :func:`proposal_sources` names them) the
    texts on which one of its proposal sets was imported, each with whether
    the tool proposed anything there (proposals.csv, recall).

    ``sets`` holds ``(document_id, actors, payload)`` of stored proposal sets
    and of imported sets without any finding (payload ``{}``). A tool had the
    chance to propose on a text when it is a tool actor of a set of that text,
    or the actor of one of the set's annotations."""
    chances: dict[tuple[str, str], dict[str, bool]] = {}
    for document_id, actors, payload in sets:
        named = {
            actor["actor_id"]: (
                actor.get("name") or actor["actor_id"],
                actor.get("version") or "",
            )
            for actor in actors
            if actor.get("kind") == "tool" and actor.get("actor_id")
        }
        proposing = {
            actor["actor_id"]
            for annotation in payload.get("annotations", [])
            if (actor := annotation.get("provenance", {}).get("actor", {}))
            and actor.get("kind") == "tool"
            and actor.get("actor_id")
        }
        for actor_id in sorted(named.keys() | proposing):
            tool = named.get(actor_id, (actor_id, ""))
            texts = chances.setdefault(tool, {})
            texts[document_id] = texts.get(document_id, False) or (
                actor_id in proposing
            )
    return chances


def proposal_set_chances(
    conn: Connection, project_id: int | None, document_ids: Iterable[str]
) -> dict[tuple[str, str], dict[str, bool]]:
    """:func:`tool_chances` of the proposal sets stored for these texts.

    Besides the stored proposal sets this counts the imported sets without
    any finding (``empty_proposal_sets``). Those of an earlier version of a
    corrected text count for the correction too, as the reanchored copy of a
    set with findings does: an empty set has nothing to reanchor. Texts
    imported before ``empty_proposal_sets`` existed have no such record."""
    wanted = set(document_ids)
    if not wanted:
        return {}
    rows = conn.execute(
        select(
            ProposalSetRow.document_id, ProposalSetRow.actors, ProposalSetRow.payload
        )
        .where(
            ProposalSetRow.project_id == project_id,
            ProposalSetRow.document_id.in_(wanted),
        )
        .order_by(ProposalSetRow.id)
    )
    sets: list[tuple[str, Iterable[Mapping[str, Any]], Mapping[str, Any]]] = [
        (r.document_id, r.actors or [], r.payload or {}) for r in rows
    ]
    corrected_from = {
        r.document_id: r.derived_from
        for r in conn.execute(
            select(DocumentRow.document_id, DocumentRow.derived_from).where(
                DocumentRow.project_id == project_id,
                DocumentRow.origin == "correction",
                DocumentRow.derived_from.is_not(None),
            )
        )
    }
    # Each stored version and the wanted texts its empty sets count for.
    counts_for: dict[str, set[str]] = {}
    for document_id in wanted:
        version: str | None = document_id
        while version is not None and document_id not in counts_for.get(version, ()):
            counts_for.setdefault(version, set()).add(document_id)
            version = corrected_from.get(version)
    empty = conn.execute(
        select(EmptyProposalSetRow.document_id, EmptyProposalSetRow.actors)
        .where(
            EmptyProposalSetRow.project_id == project_id,
            EmptyProposalSetRow.document_id.in_(counts_for),
        )
        .order_by(EmptyProposalSetRow.id)
    )
    sets.extend(
        (document_id, r.actors or [], {})
        for r in empty
        for document_id in sorted(counts_for[r.document_id])
    )
    return tool_chances(sets)
