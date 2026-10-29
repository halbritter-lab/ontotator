"""Submissions view of one Documents row (case, language).

Runs its own reads on the caller's connection; the caller (``DocumentRowsService``)
has authorized the lead and holds the shared project lock.

Also the consolidation facts of the lead's row reads (acceptance fixes spec
"WP-B > After consolidation", "Flags", X4, X5): findings kept automatically
and findings flagged "guidelines unclear" of a submitted consolidation. Both
count findings, i.e. consolidation groups (``consolidation_groups``): each
member of a group carries its own decision with the group's mark.
"""

from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection, and_, func, select

from ontotator.application.people import person_refs
from ontotator.domain import document_rows as rules
from ontotator.domain.errors import DomainError
from ontotator.domain.submission_labels import round_ordinals, submission_kind
from ontotator.packages.models import PackageManifest
from ontotator.storage.guidelines import guideline_facts
from ontotator.storage.live_submissions import live_submission
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontotator.storage.workflow_tables import (
    RoundSubmissionBindingRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


def lead_pseudonym_refs(
    conn: Connection, pseudonyms: Iterable[str], *, viewer_id: int
) -> dict[str, dict[str, Any]]:
    """PersonRefView fields per pseudonym for a lead viewer (D1).

    Submissions and rounds name their author by pseudonym only; a pseudonym
    without an account keeps the pseudonym alone.
    """
    wanted = sorted(set(pseudonyms))
    if not wanted:
        return {}
    ids = conn.execute(
        select(UserRow.id).where(UserRow.pseudonym.in_(wanted))
    ).scalars()
    refs = person_refs(conn, ids, viewer_id=viewer_id, viewer_is_lead=True)
    known = {ref.pseudonym: ref.model_dump() for ref in refs.values()}
    return {
        pseudonym: known.get(
            pseudonym, {"pseudonym": pseudonym, "display_name": None, "is_me": False}
        )
        for pseudonym in wanted
    }


@dataclass(frozen=True)
class ConsolidationSummary:
    """Findings of a submitted consolidation by their consolidation mark."""

    kept_automatically: int = 0  # groups in state "auto"
    flagged_unclear: int = 0  # groups flagged "guidelines unclear"
    # The first flagged group in reading order (``consolidation_group_id``).
    flagged_group_id: str | None = None


_NO_MARKS = ConsolidationSummary()


def _marked(raw: Any) -> bool:
    """Whether stored decisions carry a consolidation mark (cheap pre-check)."""
    return isinstance(raw, list) and any(
        isinstance(item, dict) and isinstance(item.get("consolidation"), dict)
        for item in raw
    )


def _flagged(raw: Any) -> bool:
    return isinstance(raw, list) and any(
        isinstance(item, dict)
        and isinstance(item.get("consolidation"), dict)
        and item["consolidation"].get("guidelines_unclear") is True
        for item in raw
    )


def consolidation_summaries(
    conn: Connection, pid: int, submissions: Mapping[str, tuple[str, Any]]
) -> dict[str, ConsolidationSummary]:
    """Summary per consolidation submission (``submissions``: submission id
    -> (round id, stored decisions JSON)). A submission without marks, or
    whose decisions do not decode, has the empty summary.

    A group counts by its state (``consolidation._state``, the rule of the
    consolidation view): "auto" counts as kept automatically; a decided group
    with ``guidelines_unclear`` counts as flagged.
    """
    # Imported here: ``consolidation`` imports ``document_row_panel``, which
    # imports this module.
    from ontotator.application.consolidation import (
        _Content,
        _state,
        consolidation_group_id,
        round_members,
    )
    from ontotator.application.document_row_panel import project_profile
    from ontotator.domain.agreement import Finding, groups
    from ontotator.domain.review import ReviewDecision

    result = dict.fromkeys(submissions, _NO_MARKS)
    marked = {
        sid: (rid, raw) for sid, (rid, raw) in submissions.items() if _marked(raw)
    }
    if not marked:
        return result
    profile, defaults = project_profile(conn, pid)
    for submission_id, (round_id, raw) in marked.items():
        try:
            decisions = [ReviewDecision.model_validate(item) for item in raw]
        except ValueError:
            continue
        content = _Content(annotations=(), decisions=decisions)
        found = round_members(conn, pid, round_id, profile, defaults)
        findings: dict[str, list[Finding]] = {sid: [] for sid in found.order}
        for member in found.members.values():
            findings[member.submission_id].append(member.finding)
        kept = flagged = 0
        first: str | None = None
        for group in groups(findings, found.order):
            inputs = list(group.members.values())
            targets = {
                (
                    found.members[iid].snapshot.annotation.annotation_id,
                    found.members[iid].snapshot.version,
                ): found.members[iid].snapshot.annotation
                for iid in inputs
            }
            state = _state(targets, content)
            if state["state"] == "auto":
                kept += 1
            if state["state"] != "open" and state["guidelines_unclear"]:
                flagged += 1
                if first is None:
                    first = consolidation_group_id(inputs)
        result[submission_id] = ConsolidationSummary(
            kept_automatically=kept, flagged_unclear=flagged, flagged_group_id=first
        )
    return result


def _stored_decisions(
    conn: Connection, pid: int, submission_ids: Iterable[str]
) -> dict[str, Any]:
    """The stored decisions JSON per submission (without the snapshots)."""
    return {
        row.submission_id: row.decisions
        for row in conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.payload["decisions"].label("decisions"),
            ).where(
                SubmissionRow.project_id == pid,
                SubmissionRow.submission_id.in_(sorted(set(submission_ids))),
            )
        )
    }


@dataclass(frozen=True)
class FlaggedConsolidation:
    """A submitted consolidation whose stored decisions carry a "guidelines
    unclear" mark (``load_consolidation_flags``)."""

    round_id: str
    submission_id: str


def load_consolidation_flags(
    conn: Connection, pid: int
) -> dict[str, FlaggedConsolidation]:
    """Per document: its latest submitted consolidation round, if that
    round's submission has a decision flagged "guidelines unclear".

    Cheap pre-check for the facet and the filter (one read of the stored
    decisions JSON, no grouping); the exact counts are computed for the shown
    rows only (``fill_consolidation_flags``). The pre-check and the exact count
    differ only for a flagged decision of a group that is still open, which a
    submitted consolidation does not normally have.

    "Latest submitted" is by round creation: while a newer consolidation of
    the same version is still open (editable), the flags of the older
    submitted round are shown.
    """
    latest: dict[str, tuple[str, str]] = {}
    for row in conn.execute(
        select(
            WorkRoundRow.round_id,
            WorkRoundRow.document_id,
            WorkRoundStateRow.latest_submission_id,
        )
        .join(WorkRoundStateRow, WorkRoundStateRow.round_id == WorkRoundRow.round_id)
        .where(
            WorkRoundRow.project_id == pid,
            WorkRoundRow.kind == "consolidation",
            WorkRoundStateRow.state == "submitted",
            WorkRoundStateRow.latest_submission_id.is_not(None),
        )
        .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
    ):
        latest[row.document_id] = (row.round_id, row.latest_submission_id)
    if not latest:
        return {}
    decisions = _stored_decisions(conn, pid, (sid for _, sid in latest.values()))
    return {
        document_id: FlaggedConsolidation(round_id=rid, submission_id=sid)
        for document_id, (rid, sid) in latest.items()
        if _flagged(decisions.get(sid))
    }


def fill_consolidation_flags(
    conn: Connection,
    pid: int,
    flagged: Mapping[str, FlaggedConsolidation],
    page: Mapping[str, Any],
) -> None:
    """Exact ``flagged_unclear`` and ``flagged_group_id`` of the page's rows
    that passed the pre-check (``flagged_round_id`` set). Runs after paging,
    so only the shown rows are grouped; a row whose groups turn out not
    flagged is cleared."""
    rows = [
        row
        for group in page["groups"]
        for row in group["rows"]
        if row.get("flagged_round_id") is not None
    ]
    if not rows:
        return
    by_round = {item.round_id: item.submission_id for item in flagged.values()}
    wanted = {
        by_round[row["flagged_round_id"]]: row["flagged_round_id"]
        for row in rows
        if row["flagged_round_id"] in by_round
    }
    decisions = _stored_decisions(conn, pid, wanted)
    summaries = consolidation_summaries(
        conn, pid, {sid: (rid, decisions.get(sid)) for sid, rid in wanted.items()}
    )
    for row in rows:
        sid = by_round.get(row["flagged_round_id"])
        summary = summaries.get(sid, _NO_MARKS) if sid is not None else _NO_MARKS
        if summary.flagged_unclear:
            row["flagged_unclear"] = summary.flagged_unclear
            row["flagged_group_id"] = summary.flagged_group_id
        else:
            row["flagged_unclear"] = 0
            row["flagged_group_id"] = None
            row["flagged_round_id"] = None


def _row_versions(
    conn: Connection, pid: int, case_id: str, language: str
) -> list[rules.Version]:
    return [
        rules.Version(
            document_id=row.document_id,
            case_id=row.case_id,
            language=row.language,
            external_id=row.external_id,
            version=row.version,
            origin=row.origin,
            derived_from=row.derived_from,
            translation=row.translation,
            translation_status=row.translation_status,
            position=row.position,
        )
        for row in conn.execute(
            select(
                DocumentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.external_id,
                DocumentRow.version,
                DocumentRow.origin,
                DocumentRow.derived_from,
                DocumentRow.translation,
                DocumentRow.translation_status,
                DocumentRow.position,
            ).where(
                DocumentRow.project_id == pid,
                DocumentRow.case_id == case_id,
                DocumentRow.language == language,
            )
        )
    ]


def _live_rounds(conn: Connection, pid: int, documents: list[str]) -> list[Any]:
    """All rounds on the row's versions, translation-review rounds included."""
    return list(
        conn.execute(
            select(
                WorkRoundRow.round_id,
                WorkRoundRow.assignment_id,
                WorkRoundRow.predecessor_round_id,
                WorkRoundRow.document_id,
                WorkRoundRow.kind,
                WorkRoundRow.mode,
                WorkRoundRow.annotator_id,
                WorkRoundStateRow.state,
                WorkRoundStateRow.latest_submission_id,
            )
            .join(
                WorkRoundStateRow, WorkRoundStateRow.round_id == WorkRoundRow.round_id
            )
            .where(
                WorkRoundRow.project_id == pid,
                WorkRoundRow.document_id.in_(documents),
            )
            .order_by(WorkRoundRow.created_at, WorkRoundRow.round_id)
        )
    )


def _archived_rounds(
    conn: Connection, pid: int, documents: set[str], live: set[str]
) -> dict[str, dict[str, Any]]:
    """Imported workflow history of the row's versions (rounds without live rows).

    Used only to name the round of an imported submission, as the editor's
    round reads do; archived rounds are not listed as rounds of the row.
    """
    manifest = PackageManifest.model_validate(
        conn.execute(
            select(ProjectRow.manifest).where(ProjectRow.id == pid)
        ).scalar_one()
    )
    return {
        rid: item
        for rid, item in (manifest.workflow_history or {}).items()
        if rid not in live and item.get("round", {}).get("document_id") in documents
    }


def _submissions(conn: Connection, pid: int, documents: list[str]) -> list[Any]:
    return list(
        conn.execute(
            select(
                SubmissionRow.submission_id,
                SubmissionRow.document_id,
                SubmissionRow.annotator_id,
                SubmissionRow.recorded_at,
                SubmissionRow.mode,
                SubmissionRow.guideline_version,
                func.coalesce(
                    func.jsonb_array_length(SubmissionRow.payload["snapshots"]), 0
                ).label("findings"),
                RoundSubmissionBindingRow.round_id,
            )
            .outerjoin(
                RoundSubmissionBindingRow,
                and_(
                    RoundSubmissionBindingRow.project_id == SubmissionRow.project_id,
                    RoundSubmissionBindingRow.submission_id
                    == SubmissionRow.submission_id,
                ),
            )
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.document_id.in_(documents),
                live_submission(),
            )
            .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
        )
    )


def _open_translation_reviews(
    conn: Connection, pid: int, documents: list[str]
) -> list[Any]:
    return list(
        conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.document_id,
                AssignmentRow.user_id,
                UserRow.pseudonym,
            )
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.document_id.in_(documents),
                AssignmentRow.task == "translation_review",
                AssignmentRow.revoked_at.is_(None),
                AssignmentRow.status != "submitted",
            )
            .order_by(AssignmentRow.id)
        )
    )


def _kept_automatically(
    conn: Connection, pid: int, rounds: Mapping[str, str]
) -> dict[str, int]:
    """Findings kept automatically per consolidation submission (``rounds``:
    submission id -> its live consolidation round)."""
    if not rounds:
        return {}
    decisions = _stored_decisions(conn, pid, rounds)
    summaries = consolidation_summaries(
        conn,
        pid,
        {sid: (rid, decisions.get(sid)) for sid, rid in rounds.items()},
    )
    return {sid: item.kept_automatically for sid, item in summaries.items()}


def build_submissions(
    conn: Connection,
    key: str,
    pid: int,
    case_id: str,
    language: str,
    viewer_user_id: int,
) -> dict[str, Any]:
    """Submissions, rounds and open translation reviews of row (case, language)."""
    versions = _row_versions(conn, pid, case_id, language)
    if not versions:
        raise DomainError("CASE_NOT_FOUND")
    chains = rules.build_chains(versions)
    parallel = len(chains) > 1
    chain_name = {
        item.document_id: chain.name if parallel else None
        for chain in chains
        for item in chain.versions
    }
    number = {item.document_id: item.version for item in versions}
    documents = sorted(number)
    rule = conn.execute(
        select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
    ).scalar_one()
    viewer = conn.execute(
        select(UserRow.pseudonym).where(UserRow.id == viewer_user_id)
    ).scalar_one()

    live = _live_rounds(conn, pid, documents)
    live_ids = {row.round_id for row in live}
    archived = _archived_rounds(
        conn, pid, set(documents), {row.round_id for row in live}
    )
    ordinals = round_ordinals(
        [(row.round_id, row.predecessor_round_id) for row in live]
        + [
            (rid, item["round"].get("predecessor_round_id"))
            for rid, item in archived.items()
        ]
    )
    # round_id -> (kind, state, latest_submission_id)
    round_facts: dict[str, tuple[str | None, str | None, str | None]] = {
        row.round_id: (row.kind, row.state, row.latest_submission_id) for row in live
    }
    archived_owner: dict[str, str] = {}
    for rid, item in archived.items():
        stored = item["round"]
        round_facts[rid] = (
            stored.get("kind"),
            stored.get("state"),
            stored.get("latest_submission_id"),
        )
        for sid in item.get("submission_ids", []):
            archived_owner.setdefault(sid, rid)

    rows = _submissions(conn, pid, documents)
    open_reviews = _open_translation_reviews(conn, pid, documents)
    people = lead_pseudonym_refs(
        conn,
        [
            *(row.annotator_id for row in rows),
            *(row.annotator_id for row in live),
            *(row.pseudonym for row in open_reviews),
        ],
        viewer_id=viewer_user_id,
    )
    owner = {
        row.submission_id: row.round_id or archived_owner.get(row.submission_id)
        for row in rows
    }
    held = Counter(rid for rid in owner.values() if rid is not None)
    for rid, item in archived.items():
        held[rid] = max(held[rid], len(item.get("submission_ids", [])))

    facts = (
        guideline_facts(conn, pid)
        if any(row.guideline_version is not None for row in rows)
        else {}
    )
    kept = _kept_automatically(
        conn,
        pid,
        {
            row.submission_id: owned
            for row in rows
            if (owned := owner[row.submission_id]) is not None
            and owned in live_ids
            and round_facts[owned][0] == "consolidation"
        },
    )
    submissions = []
    for row in rows:
        owned = owner[row.submission_id]
        kind, state, latest = round_facts.get(owned or "", (None, None, None))
        submissions.append(
            {
                "submission_id": row.submission_id,
                "document_id": row.document_id,
                "version": number[row.document_id],
                "chain_name": chain_name[row.document_id],
                "author_label": row.annotator_id,
                "is_me": row.annotator_id == viewer,
                "recorded_at": row.recorded_at,
                "mode": row.mode,
                "kind": submission_kind(kind, row.mode),
                "round_id": owned,
                "round_ordinal": ordinals.get(owned) if owned else None,
                "round_state": state,
                "is_latest_in_round": (
                    None
                    if owned is None or held[owned] <= 1
                    else row.submission_id == latest
                ),
                "finding_count": int(row.findings),
                "author": people[row.annotator_id],
                "guideline_version": row.guideline_version,
                "guideline_withdrawn": row.guideline_version is not None
                and facts[row.guideline_version].withdrawn,
                "kept_automatically": kept.get(row.submission_id, 0),
            }
        )

    rounds = [
        {
            "round_id": row.round_id,
            "assignment_id": row.assignment_id,
            "predecessor_round_id": row.predecessor_round_id,
            "document_id": row.document_id,
            "version": number[row.document_id],
            "chain_name": chain_name[row.document_id],
            "kind": row.kind,
            "mode": row.mode,
            "state": row.state,
            "author_label": row.annotator_id,
            "is_me": row.annotator_id == viewer,
            "round_ordinal": ordinals.get(row.round_id),
            "submitted": row.latest_submission_id is not None,
            "author": people[row.annotator_id],
        }
        for row in live
        if row.mode is not None
    ]
    reviews = [
        {
            "assignment_id": row.id,
            "document_id": row.document_id,
            "version": number[row.document_id],
            "chain_name": chain_name[row.document_id],
            "reviewer_label": row.pseudonym,
            "is_me": row.user_id == viewer_user_id,
            "reviewer": people[row.pseudonym],
        }
        for row in open_reviews
    ]
    return {
        "case_id": case_id,
        "language": language,
        "adjudicator_not_annotator": rule,
        "submissions": submissions,
        "rounds": rounds,
        "open_translation_reviews": reviews,
    }
