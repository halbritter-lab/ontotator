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
from ontocurator.domain.errors import AccessDenied, DomainError, RevisionConflict
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
    ProjectRow,
    SubmissionRow,
    TranslationReviewRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import ReviewObligationResolutionRow


def _pseudonym(conn: Connection, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    return conn.execute(
        select(UserRow.pseudonym).where(UserRow.id == user_id)
    ).scalar_one_or_none()


def _conflict(conn: Connection, old: Any) -> dict[str, Any]:
    """409 details naming the current selection's revision, author and time."""
    if not old:
        return {"current_revision": 0, "selected_by": None, "updated_at": None}
    return {
        "current_revision": old["revision"],
        "selected_by": _pseudonym(conn, old["actor_id"]),
        "updated_at": old["updated_at"].isoformat(),
    }


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
        if self.actor.user_id is None:
            # A selection names the lead who chose it (final_selections.actor_id
            # is NOT NULL); process actors pass project authority but cannot
            # be that lead, so refuse instead of failing on the insert.
            raise AccessDenied(
                "NOT_ALLOWED", "Only a signed-in lead can choose a final result."
            )
        with self.db.transaction() as conn:
            pid = self._authorize(conn, key, exclusive=True)
            doc = conn.execute(
                select(DocumentRow.case_id, DocumentRow.language).where(
                    DocumentRow.project_id == pid, DocumentRow.document_id == document
                )
            ).one_or_none()
            exact = conn.execute(
                select(SubmissionRow.submission_id, SubmissionRow.annotator_id).where(
                    SubmissionRow.project_id == pid,
                    SubmissionRow.document_id == document,
                    SubmissionRow.submission_id == submission,
                )
            ).first()
            if doc is None or exact is None:
                raise DomainError("VERSION_NOT_FOUND")
            rule = conn.execute(
                select(ProjectRow.adjudicator_not_annotator).where(ProjectRow.id == pid)
            ).scalar_one()
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
                raise RevisionConflict(_conflict(conn, old))
            # After the revision check: a stale request learns of the newer
            # selection first instead of the rule refusal.
            selected_by = _pseudonym(conn, self.actor.user_id)
            if rule and exact.annotator_id == selected_by:
                raise DomainError(
                    "OWN_RESULT_NOT_SELECTABLE",
                    "This project keeps adjudication separate from annotation. "
                    "Another lead must choose this result.",
                )
            same = bool(
                old
                and old["document_id"] == document
                and old["submission_id"] == submission
            )
            if acknowledged_cause_ids:
                if not old or not same:
                    raise DomainError(
                        "INVALID_FINAL_SELECTION",
                        "New selections cannot pre-acknowledge future causes.",
                    )
                # The client sends the complete set it showed; any addition,
                # removal or status change since then is a conflict.
                available = {
                    warning.get("cause_id")
                    for warning in self._projection(conn, key, pid)["warnings"]
                    if warning["code"] in ACKNOWLEDGEABLE_CODES
                    and warning["case_id"] == doc.case_id
                    and warning["language"] == doc.language
                }
                if set(acknowledged_cause_ids) != available:
                    raise RevisionConflict(
                        _conflict(conn, old) | {"reason": "warnings_changed"}
                    )
            if old and same:
                acknowledged_cause_ids = sorted(
                    set(acknowledged_cause_ids) | set(old["acknowledged_cause_ids"])
                )
            now = datetime.now(UTC)
            values = {
                "project_id": pid,
                "case_id": doc.case_id,
                "language": doc.language,
                "document_id": document,
                "submission_id": submission,
                "revision": expected_revision + 1,
                "actor_id": self.actor.user_id,
                "acknowledged_cause_ids": sorted(set(acknowledged_cause_ids)),
                "updated_at": now,
                "selected_at": old["selected_at"] if old and same else now,
                "adjudicator_not_annotator": rule,
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
                    "adjudicator_not_annotator",
                )
            }
            event = {
                **result,
                "actor_id": self.actor.user_id,
                "acknowledged_cause_ids": values["acknowledged_cause_ids"],
                "selected_at": values["selected_at"].isoformat(),
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
            return result | {
                "selected_at": values["selected_at"],
                "updated_at": values["updated_at"],
                "selected_by": selected_by,
            }

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
            recorded_at = {
                sid: at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                for sid, at in conn.execute(
                    select(
                        SubmissionRow.submission_id, SubmissionRow.recorded_at
                    ).where(
                        SubmissionRow.project_id == pid,
                        SubmissionRow.submission_id.in_(closure_ids),
                    )
                ).all()
            }
            project_name = conn.execute(
                select(ProjectRow.name).where(ProjectRow.id == pid)
            ).scalar_one()
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
                "project_name": project_name,
                "submission_recorded_at": recorded_at,
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
