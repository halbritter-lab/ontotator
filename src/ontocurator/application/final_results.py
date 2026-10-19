"""Lead-selected immutable results and transactional final export preflight."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Connection, insert, select, update

from ontocurator.application.final_causes import (
    ACKNOWLEDGEABLE_CODES,
    authorize_final_results,
    derive_final_state,
)
from ontocurator.application.translation_reviews import TranslationReviewRecord
from ontocurator.application.workflow_warnings import state_digest
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError, RevisionConflict
from ontocurator.exchange.final_content import freeze_content
from ontocurator.exchange.human_inputs import human_input_closure
from ontocurator.storage.database import Database
from ontocurator.storage.final_tables import (
    ExportSelectionSnapshotRow,
    FinalSelectionEventRow,
    FinalSelectionRow,
)
from ontocurator.storage.tables import (
    DocumentRow,
    JobRow,
    SubmissionRow,
    TranslationReviewRow,
)
from ontocurator.storage.workflow_tables import ReviewObligationResolutionRow


class FinalResultService:
    def __init__(self, db: Database, actor: Actor, access: Access):
        self.db, self.actor, self.access = db, actor, access
        self.repo = ScopedRepository(db, access, actor)

    def _authorize(self, conn: Connection, key: str, *, exclusive: bool = False) -> int:
        return authorize_final_results(conn, self.actor, key, exclusive=exclusive)

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
                    if warning["code"] in ACKNOWLEDGEABLE_CODES
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
        return derive_final_state(conn, self.repo, key, pid)

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
