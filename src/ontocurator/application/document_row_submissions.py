"""Submissions view of one Documents row (case, language).

Runs its own reads on the caller's connection; the caller (``DocumentRowsService``)
has authorized the lead and holds the shared project lock.
"""

from collections import Counter
from collections.abc import Iterable
from typing import Any

from sqlalchemy import Connection, and_, func, select

from ontocurator.application.people import person_refs
from ontocurator.domain import document_rows as rules
from ontocurator.domain.errors import DomainError
from ontocurator.domain.submission_labels import round_ordinals, submission_kind
from ontocurator.packages.models import PackageManifest
from ontocurator.storage.guidelines import guideline_facts
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import (
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
