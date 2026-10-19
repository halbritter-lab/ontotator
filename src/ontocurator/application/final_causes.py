"""The single cause derivation for Documents and the final export preflight.

Runs on the caller's connection. Callers authorize first: Documents with the
shared project lock, preflight/select/freeze with the exclusive one.
"""

from typing import Any
from urllib.parse import quote

from sqlalchemy import Connection, func, select

from ontocurator.application.workflow_warnings import project_warnings
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.authz.scoped import project_not_found
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    DraftRow,
    SubmissionRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
)
from ontocurator.storage.workflow_tables import WorkRoundRow, WorkRoundStateRow

# Causes a lead confirms by reaffirming the final selection. Every other code
# (for example ROUND_REVIEW_PENDING, OPEN_PROBLEM_REPORT, TASK_ON_HOLD and
# TASK_PAUSED_WITHOUT_REPORT) is resolved by acting on the work itself.
ACKNOWLEDGEABLE_CODES = frozenset(
    {
        "SELECTED_ROUND_ABANDONED",
        "SELECTED_ROUND_SUPERSEDED",
        "SELECTED_RESULT_REVISED",
        "SELECTED_TEXT_CORRECTED",
        "SELECTED_NEWER_RESULT",
    }
)
# Latest review decisions that keep a correction from counting as a newer text.
NOT_NEWER_DECISIONS = frozenset({"rejected", "query"})


def authorize_final_results(
    conn: Connection, actor: Actor, key: str, *, exclusive: bool
) -> int:
    conn.execute(select(func.pg_advisory_xact_lock_shared(_lock_id("members", key))))
    lock = (
        func.pg_advisory_xact_lock if exclusive else func.pg_advisory_xact_lock_shared
    )
    conn.execute(select(lock(_lock_id("project", key))))
    pid = Repository._project_id(conn, key)
    if pid is None:
        raise project_not_found(key)
    require_project_management(conn, actor, key, pid, Action.EXPORT_ALL_WORK)
    return pid


def correction_roots(inventory: list[dict[str, Any]]) -> dict[str, str]:
    """A translation source edge never joins independent correction chains."""
    documents = {item["document_id"]: item for item in inventory}
    roots: dict[str, str] = {}
    for identity, item in documents.items():
        current = item
        seen: set[str] = set()
        while current["origin"] == "correction":
            if current["document_id"] in seen:
                raise DomainError(
                    "VARIANT_SOURCE_UNKNOWN", "Cyclic correction ancestry"
                )
            seen.add(current["document_id"])
            previous = documents.get(current["derived_from"])
            if previous is None or (
                previous["case_id"],
                previous["external_id"],
                previous["language"],
                previous["version"] + 1,
            ) != (
                current["case_id"],
                current["external_id"],
                current["language"],
                current["version"],
            ):
                raise DomainError(
                    "VARIANT_SOURCE_UNKNOWN", "Invalid correction predecessor"
                )
            current = previous
        roots[identity] = current["document_id"]
    return roots


def latest_review_decisions(conn: Connection, pid: int) -> dict[str, str]:
    """document_id -> decision of its latest translation review."""
    rows = conn.execute(
        select(TranslationReviewRow.document_id, TranslationReviewRow.decision)
        .where(TranslationReviewRow.project_id == pid)
        .distinct(TranslationReviewRow.document_id)
        .order_by(
            TranslationReviewRow.document_id,
            TranslationReviewRow.created_at.desc(),
            TranslationReviewRow.id.desc(),
        )
    ).all()
    return {row.document_id: row.decision for row in rows}


def corrects_selected_text(status: str | None, decision: str | None) -> bool:
    """Whether a correction of the selected version asks the lead to confirm.

    Corrections whose latest review is rejected or queried are not newer text.
    Open question 1: an accepted_corrected parent (status reviewed) is skipped
    because its accepted child raises the cause.
    """
    if decision in NOT_NEWER_DECISIONS:
        return False
    return not (status == "reviewed" and decision == "accepted_corrected")


def derive_final_state(
    conn: Connection, repo: Repository, key: str, pid: int
) -> dict[str, Any]:
    """Selections, omissions and warnings of project ``key`` on ``conn``."""

    def destination(case_id: str, document_id: str) -> str:
        return (
            f"#/projects/{quote(key, safe='')}/cases/{quote(case_id, safe='')}"
            f"?variant={quote(document_id, safe='')}"
        )

    inventory = [
        dict(item)
        for item in conn.execute(
            select(
                DocumentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
                DocumentRow.derived_from,
                DocumentRow.origin,
                DocumentRow.external_id,
                DocumentRow.version,
                DocumentRow.translation_status,
            ).where(DocumentRow.project_id == pid)
        ).mappings()
    ]
    rows = (
        conn.execute(
            select(FinalSelectionRow).where(FinalSelectionRow.project_id == pid)
        )
        .mappings()
        .all()
    )
    selected = [
        {
            name: row[name]
            for name in (
                "case_id",
                "language",
                "document_id",
                "submission_id",
                "revision",
            )
        }
        for row in rows
    ]
    roots = correction_roots(inventory)
    selected_chains = {roots[item["document_id"]] for item in selected}
    active = (
        conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.document_id,
                AssignmentRow.task,
                AssignmentRow.workflow_revision,
                WorkRoundRow.round_id,
                WorkRoundRow.kind,
                WorkRoundRow.workspace_key,
                WorkRoundStateRow.state.label("round_state"),
                WorkRoundStateRow.revision.label("round_revision"),
                TranslationReviewDraftRow.revision.label("translation_revision"),
            )
            .outerjoin(
                WorkRoundRow, WorkRoundRow.round_id == AssignmentRow.active_round_id
            )
            .outerjoin(
                WorkRoundStateRow,
                WorkRoundStateRow.round_id == WorkRoundRow.round_id,
            )
            .outerjoin(
                TranslationReviewDraftRow,
                TranslationReviewDraftRow.assignment_id == AssignmentRow.id,
            )
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.revoked_at.is_(None),
                AssignmentRow.status != "submitted",
            )
        )
        .mappings()
        .all()
    )
    active_chains = {roots[item["document_id"]] for item in active}
    # Includes OPEN_PROBLEM_REPORT, TASK_ON_HOLD and the derived, not
    # acknowledgeable TASK_PAUSED_WITHOUT_REPORT; they pass through unchanged.
    causes = [
        cause
        for cause in repo.workflow_causes_in(conn, key, pid)
        if cause["code"] != "SOURCE_UPDATE_UNREVIEWED"
        or roots[cause["document_id"]] in selected_chains | active_chains
    ]
    draft_revisions = dict(
        conn.execute(
            select(DraftRow.draft_key, DraftRow.revision).where(
                DraftRow.project_id == pid
            )
        )
        .tuples()
        .all()
    )
    by_document = {item["document_id"]: item for item in inventory}
    for work in active:
        if roots[work["document_id"]] not in selected_chains:
            continue
        annotation_review = (
            work["kind"] in {"carry_forward", "consolidation"}
            and work["round_state"] == "editable"
        )
        if work["task"] != "translation_review" and not annotation_review:
            continue
        # Saved decisions/forms remain pending until immutable submission. Each
        # intervening draft edit invalidates an earlier warning acknowledgement.
        revision = 1 + work["workflow_revision"] + (work["round_revision"] or 0)
        if work["task"] == "translation_review":
            revision += work["translation_revision"] or 0
        elif work["workspace_key"] is not None:
            workspace_key = WorkspaceKey.model_validate(work["workspace_key"])
            revision += draft_revisions.get(_key_str(workspace_key), 0)
        document = by_document[work["document_id"]]
        identity = work["round_id"] or f"translation-assignment-{work['id']}"
        causes.append(
            {
                "code": "ROUND_REVIEW_PENDING",
                "cause_id": f"ROUND_REVIEW_PENDING:{identity}",
                "cause_revision": revision,
                "case_id": document["case_id"],
                "language": document["language"],
                "document_id": document["document_id"],
                "reason": "Review work on this text's correction chain has not been submitted. The selected result remains unchanged.",
                "destination": destination(
                    document["case_id"], document["document_id"]
                ),
            }
        )
    decisions = latest_review_decisions(conn, pid) if rows else {}
    for row in rows:
        acknowledged = set(row["acknowledged_cause_ids"])
        round_view = repo.round_for_submission_in(conn, key, pid, row["submission_id"])
        if round_view and round_view.state in {"abandoned", "superseded"}:
            code = "SELECTED_ROUND_" + round_view.state.upper()
            # No workflow revision: holds, resumes and reopens keep the identity.
            cause_id = f"{code}:{round_view.round_id}"
            if cause_id not in acknowledged:
                causes.append(
                    {
                        "code": code,
                        "cause_id": cause_id,
                        "cause_revision": 1,
                        "case_id": row["case_id"],
                        "language": row["language"],
                        "document_id": row["document_id"],
                        "reason": "The selected result belongs to an earlier work round. Review the selection.",
                        "destination": destination(row["case_id"], row["document_id"]),
                    }
                )
        # Every REVISED subject, raised or acknowledged (open question 7).
        revised_subjects = {
            cause_id.removeprefix("SELECTED_RESULT_REVISED:")
            for cause_id in acknowledged
            if cause_id.startswith("SELECTED_RESULT_REVISED:")
        }
        if (
            round_view
            and round_view.latest_submission_id
            and round_view.latest_submission_id != row["submission_id"]
        ):
            revised_subjects.add(round_view.latest_submission_id)
            cause_id = f"SELECTED_RESULT_REVISED:{round_view.latest_submission_id}"
            if cause_id not in acknowledged:
                causes.append(
                    {
                        "code": "SELECTED_RESULT_REVISED",
                        "cause_id": cause_id,
                        "cause_revision": round_view.workflow_revision,
                        "case_id": row["case_id"],
                        "language": row["language"],
                        "document_id": row["document_id"],
                        "reason": "This work round has another submitted result. The final selection remains unchanged.",
                        "destination": destination(row["case_id"], row["document_id"]),
                    }
                )
        descendants = {row["document_id"]}
        for _ in inventory:
            descendants.update(
                item["document_id"]
                for item in inventory
                if item["origin"] == "correction"
                and item["derived_from"] in descendants
                and item["case_id"] == row["case_id"]
                and item["language"] == row["language"]
            )
        for descendant in sorted(descendants - {row["document_id"]}):
            status = by_document[descendant]["translation_status"]
            if not corrects_selected_text(status, decisions.get(descendant)):
                continue
            cause_id = (
                f"SELECTED_TEXT_CORRECTED:{row['document_id']}:{descendant}"
                f":{status or 'native'}"
            )
            if cause_id not in acknowledged:
                causes.append(
                    {
                        "code": "SELECTED_TEXT_CORRECTED",
                        "cause_id": cause_id,
                        "cause_revision": 1,
                        "case_id": row["case_id"],
                        "language": row["language"],
                        "document_id": descendant,
                        "reason": "A correction follows the selected text. Review the exact final result.",
                        "destination": destination(row["case_id"], row["document_id"]),
                    }
                )
        # Any version of the row, recorded after the selection was made.
        row_documents = [
            item["document_id"]
            for item in inventory
            if item["case_id"] == row["case_id"] and item["language"] == row["language"]
        ]
        newer = conn.execute(
            select(SubmissionRow.submission_id, SubmissionRow.document_id)
            .where(
                SubmissionRow.project_id == pid,
                SubmissionRow.document_id.in_(row_documents),
                SubmissionRow.recorded_at > row["selected_at"],
                SubmissionRow.submission_id != row["submission_id"],
            )
            .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
        ).all()
        for item in newer:
            if item.submission_id in revised_subjects:
                continue
            cause_id = f"SELECTED_NEWER_RESULT:{item.submission_id}"
            if cause_id in acknowledged:
                continue
            causes.append(
                {
                    "code": "SELECTED_NEWER_RESULT",
                    "cause_id": cause_id,
                    "cause_revision": 1,
                    "case_id": row["case_id"],
                    "language": row["language"],
                    "document_id": item.document_id,
                    "reason": "A result was submitted after the final result was chosen. The final selection remains unchanged.",
                    "destination": destination(row["case_id"], item.document_id),
                }
            )
    return project_warnings(key, inventory, selected, causes)
