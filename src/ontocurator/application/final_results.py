"""Lead-selected immutable results and transactional final export preflight."""

from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import Connection, func, insert, select, update

from ontocurator.application.translation_reviews import TranslationReviewRecord
from ontocurator.application.workflow_warnings import project_warnings, state_digest
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access, Action
from ontocurator.authz.project_authority import require_project_management
from ontocurator.authz.scoped import ScopedRepository, project_not_found
from ontocurator.domain.errors import DomainError, RevisionConflict
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.exchange.final_content import freeze_content
from ontocurator.exchange.human_inputs import human_input_closure
from ontocurator.storage.database import Database
from ontocurator.storage.final_tables import (
    ExportSelectionSnapshotRow,
    FinalSelectionEventRow,
    FinalSelectionRow,
)
from ontocurator.storage.repository import Repository, _key_str, _lock_id
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    DraftRow,
    JobRow,
    SubmissionRow,
    TranslationReviewDraftRow,
    TranslationReviewRow,
)
from ontocurator.storage.workflow_tables import (
    ReviewObligationResolutionRow,
    WorkRoundRow,
    WorkRoundStateRow,
)


def _correction_roots(inventory: list[dict[str, Any]]) -> dict[str, str]:
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


class FinalResultService:
    def __init__(self, db: Database, actor: Actor, access: Access):
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    def _authorize(self, conn: Connection, key: str, *, exclusive: bool = False) -> int:
        conn.execute(
            select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
        )
        lock = (
            func.pg_advisory_xact_lock
            if exclusive
            else func.pg_advisory_xact_lock_shared
        )
        conn.execute(select(lock(_lock_id("project", key))))
        pid = Repository._project_id(conn, key)
        if pid is None:
            raise project_not_found(key)
        require_project_management(conn, self.actor, key, pid, Action.EXPORT_ALL_WORK)
        return pid

    def select(
        self,
        key: str,
        document: str,
        submission: str,
        expected_revision: int,
        acknowledged_cause_ids: list[str],
    ) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            doc = conn.execute(
                select(DocumentRow.case_id, DocumentRow.language).where(
                    DocumentRow.project_id == pid, DocumentRow.document_id == document
                )
            ).one_or_none()
            exact = conn.execute(
                select(SubmissionRow.submission_id).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.document_id == document,
                    SubmissionRow.submission_id == submission,
                )
            ).first()
            if doc is None or exact is None:
                raise DomainError("VERSION_NOT_FOUND")
            slot = (
                FinalSelectionRow.project_id == pid,
                FinalSelectionRow.case_id == doc.case_id,
                FinalSelectionRow.language == doc.language,
            )
            old = (
                conn.execute(select(FinalSelectionRow).where(*slot).with_for_update())
                .mappings()
                .first()
            )
            if expected_revision != (old["revision"] if old else 0):
                raise RevisionConflict(
                    {"current_revision": old["revision"] if old else 0}
                )
            if acknowledged_cause_ids:
                if (
                    not old
                    or old["document_id"] != document
                    or old["submission_id"] != submission
                ):
                    raise DomainError(
                        "INVALID_FINAL_SELECTION",
                        "New selections cannot pre-acknowledge future causes.",
                    )
                available = {
                    warning.get("cause_id")
                    for warning in self._projection(conn, key, pid)["warnings"]
                    if warning["code"]
                    in {
                        "SELECTED_ROUND_ABANDONED",
                        "SELECTED_ROUND_SUPERSEDED",
                        "SELECTED_RESULT_REVISED",
                        "SELECTED_TEXT_CORRECTED",
                    }
                    and warning["case_id"] == doc.case_id
                    and warning["language"] == doc.language
                }
                if not set(acknowledged_cause_ids).issubset(available):
                    raise RevisionConflict(
                        "Selection warnings changed; review them again."
                    )
            if (
                old
                and old["document_id"] == document
                and old["submission_id"] == submission
            ):
                acknowledged_cause_ids = sorted(
                    set(acknowledged_cause_ids) | set(old["acknowledged_cause_ids"])
                )
            values = {
                "project_id": pid,
                "case_id": doc.case_id,
                "language": doc.language,
                "document_id": document,
                "submission_id": submission,
                "revision": expected_revision + 1,
                "actor_id": self.actor.user_id,
                "acknowledged_cause_ids": sorted(set(acknowledged_cause_ids)),
                "updated_at": datetime.now(UTC),
            }
            if old:
                conn.execute(update(FinalSelectionRow).where(*slot).values(**values))
            else:
                conn.execute(insert(FinalSelectionRow).values(**values))
            result = {
                name: values[name]
                for name in (
                    "case_id",
                    "language",
                    "document_id",
                    "submission_id",
                    "revision",
                )
            }
            event = {
                **result,
                "actor_id": self.actor.user_id,
                "acknowledged_cause_ids": values["acknowledged_cause_ids"],
            }
            conn.execute(
                insert(FinalSelectionEventRow).values(project_id=pid, payload=event)
            )
            record_audit(
                conn,
                self.actor,
                "project.final_selection",
                target_type="project",
                target_id=key,
                project_id=pid,
                details=event,
            )
            return result

    def _projection(self, conn: Connection, key: str, pid: int) -> dict[str, Any]:
        def destination(case_id: str, document_id: str) -> str:
            return (
                f"#/projects/{quote(key, safe='')}/cases/{quote(case_id, safe='')}"
                f"?variant={quote(document_id, safe='')}"
            )

        inventory = (
            conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.case_id,
                    DocumentRow.language,
                    DocumentRow.derived_from,
                    DocumentRow.origin,
                    DocumentRow.external_id,
                    DocumentRow.version,
                ).where(DocumentRow.project_id == pid)
            )
            .mappings()
            .all()
        )
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
        documents = [dict(item) for item in inventory]
        roots = _correction_roots(documents)
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
        causes = [
            cause
            for cause in self.repo.list_workflow_causes(key)
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
        by_document = {item["document_id"]: item for item in documents}
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
        for row in rows:
            round_view = self.repo.get_round_for_submission(key, row["submission_id"])
            if round_view and round_view.state in {"abandoned", "superseded"}:
                code = "SELECTED_ROUND_" + round_view.state.upper()
                cause_id = (
                    f"{code}:{round_view.round_id}:{round_view.workflow_revision}"
                )
                if cause_id not in row["acknowledged_cause_ids"]:
                    causes.append(
                        {
                            "code": code,
                            "cause_id": cause_id,
                            "cause_revision": round_view.workflow_revision,
                            "case_id": row["case_id"],
                            "language": row["language"],
                            "document_id": row["document_id"],
                            "reason": "The selected result belongs to an earlier work round. Review the selection.",
                            "destination": destination(
                                row["case_id"], row["document_id"]
                            ),
                        }
                    )
            if (
                round_view
                and round_view.latest_submission_id
                and round_view.latest_submission_id != row["submission_id"]
            ):
                cause_id = f"SELECTED_RESULT_REVISED:{round_view.latest_submission_id}"
                if cause_id not in row["acknowledged_cause_ids"]:
                    causes.append(
                        {
                            "code": "SELECTED_RESULT_REVISED",
                            "cause_id": cause_id,
                            "cause_revision": round_view.workflow_revision,
                            "case_id": row["case_id"],
                            "language": row["language"],
                            "document_id": row["document_id"],
                            "reason": "This work round has another submitted result. The final selection remains unchanged.",
                            "destination": destination(
                                row["case_id"], row["document_id"]
                            ),
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
                cause_id = f"SELECTED_TEXT_CORRECTED:{row['document_id']}:{descendant}"
                if cause_id not in row["acknowledged_cause_ids"]:
                    causes.append(
                        {
                            "code": "SELECTED_TEXT_CORRECTED",
                            "cause_id": cause_id,
                            "cause_revision": 1,
                            "case_id": row["case_id"],
                            "language": row["language"],
                            "document_id": descendant,
                            "reason": "A correction follows the selected text. Review the exact final result.",
                            "destination": destination(
                                row["case_id"], row["document_id"]
                            ),
                        }
                    )
        return project_warnings(
            key, [dict(item) for item in inventory], selected, causes
        )

    def preflight(self, key: str) -> dict[str, Any]:
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            return self._projection(conn, key, pid)

    def freeze(self, key: str, request: dict[str, Any]) -> dict[str, int]:
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            previous = (
                conn.execute(
                    select(ExportSelectionSnapshotRow).where(
                        ExportSelectionSnapshotRow.project_id == pid,
                        ExportSelectionSnapshotRow.requester_id == self.actor.user_id,
                        ExportSelectionSnapshotRow.request_id == request["request_id"],
                    )
                )
                .mappings()
                .first()
            )
            if previous:
                if previous["payload"]["request"] != request:
                    raise RevisionConflict(
                        "Export request ID was already used for another acknowledgement."
                    )
                job = conn.execute(
                    select(JobRow.id).where(
                        JobRow.project_id == pid,
                        JobRow.kind == "final_t1_export",
                        JobRow.payload["snapshot_id"].astext == previous["snapshot_id"],
                    )
                ).scalar_one()
                return {"job_id": job}
            state = self._projection(conn, key, pid)
            expected_warnings = [
                {"id": warning["id"], "cause_revision": warning["cause_revision"]}
                for warning in state["warnings"]
            ]

            def sort(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
                return sorted(items, key=state_digest)

            if (
                request["state_digest"] != state["state_digest"]
                or sort(request["acknowledged_warnings"]) != sort(expected_warnings)
                or sort(request["accepted_omissions"]) != sort(state["omissions"])
            ):
                raise RevisionConflict(
                    {"reason": "EXPORT_PREFLIGHT_STALE", "preflight": state}
                )
            if not state["selections"]:
                raise DomainError(
                    "EXPORT_EMPTY",
                    "Select at least one exact submitted result before final export.",
                )
            selected_ids = [item["submission_id"] for item in state["selections"]]
            closure_ids, round_inputs, round_kinds = human_input_closure(
                self.repo, key, selected_ids
            )
            content = self.repo.t1_export_content_exact(key, closure_ids)
            immutable = [
                {
                    "submission_id": sub.submission_id,
                    "sha256": state_digest(sub.model_dump(mode="json")),
                }
                for sub in content.submissions
            ]
            review_records = {
                review["id"]: TranslationReviewRecord.model_validate(review).model_dump(
                    mode="json", exclude={"project_id", "reviewer_user_id"}
                )
                for review in conn.execute(
                    select(TranslationReviewRow).where(
                        TranslationReviewRow.project_id == pid
                    )
                ).mappings()
            }
            source_reviews = []
            for resolution in conn.execute(
                select(ReviewObligationResolutionRow).where(
                    ReviewObligationResolutionRow.project_id == pid
                )
            ).mappings():
                record = review_records.get(resolution["payload"]["review_id"])
                if record is None:
                    raise DomainError(
                        "INVALID_EXPORT_SNAPSHOT",
                        "An immutable source review is unavailable.",
                    )
                source_reviews.append(
                    {
                        "cause_id": resolution["cause_id"],
                        "payload": resolution["payload"],
                        "review_record": record,
                        "created_at": resolution["created_at"].isoformat(),
                    }
                )
            payload = {
                "format": "ontocurator-final-selection/v1",
                "project": key,
                "request": request,
                "state": state,
                "immutable_submissions": immutable,
                "content": freeze_content(content, source_reviews=source_reviews),
                "round_inputs": round_inputs,
                "round_kinds": round_kinds,
                "selected_submission_ids": selected_ids,
            }
            sid = str(uuid4())
            digest = state_digest(payload)
            conn.execute(
                insert(ExportSelectionSnapshotRow).values(
                    snapshot_id=sid,
                    project_id=pid,
                    requester_id=self.actor.user_id,
                    request_id=request["request_id"],
                    sha256=digest,
                    payload=payload,
                )
            )
            job_id = conn.execute(
                insert(JobRow)
                .values(
                    kind="final_t1_export",
                    status="queued",
                    project_id=pid,
                    requested_by=self.actor.user_id,
                    requested_label=self.actor.label,
                    payload={
                        "project": key,
                        "snapshot_id": sid,
                        "snapshot_sha256": digest,
                    },
                )
                .returning(JobRow.id)
            ).scalar_one()
            record_audit(
                conn,
                self.actor,
                "project.final_export_requested",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={
                    "job_id": job_id,
                    "snapshot_id": sid,
                    "snapshot_sha256": digest,
                },
            )
            return {"job_id": job_id}
