"""Practice projects (issue 266): a private project per person to try the work.

Offered to people with the Annotator role (annotation and translation review)
in at least one real project, on demand. A practice project is built through
the same services as real work: ``ProjectService.create`` (flagged practice),
a T1 bundle import job, ``grant_roles``, ``AssignmentService.assign`` and,
for consolidators, two virtual colleagues who annotate and submit through
``WorkRoundService``, ``EditingService`` and ``SubmissionService`` before
the consolidation round starts with ``WorkRoundService.create_in`` (the seam
of the consolidation start command).

Nothing about a practice project counts: real-project listings, counts and
exports leave it out (``storage.practice_store.REAL_PROJECT``), admin rights do
not reach it (``Access.practice``), and it is deleted after
``LIFETIME`` without activity. Its audit events are marked practice and stay.
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from time import monotonic, sleep
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import Connection, delete, func, insert, select
from sqlalchemy.sql import literal

from ontotator.application import practice_content as content
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.policy import Access
from ontotator.domain.errors import DomainError
from ontotator.exchange.t1 import Pin
from ontotator.storage import practice_store as store
from ontotator.storage.database import Database
from ontotator.storage.tables import (
    AnnotationSnapshotRow,
    AssignmentRow,
    DocumentRow,
    DraftAnnotationRow,
    DraftRow,
    EditEventRow,
    OneTimeCodeRow,
    PracticeProjectRow,
    ProjectMembershipRow,
    ProjectRow,
    ReviewDecisionRow,
    TranslationReviewDraftRow,
    UserRow,
)
from ontotator.storage.workflow_tables import RoundInputRow

logger = logging.getLogger(__name__)

LIFETIME = timedelta(days=30)
# The same for everyone: a person's name in it would stay in the audit trail
# (``project.create``) after the account is anonymised (issue 280).
NAME = "Practice project"
# User languages are free two- or three-letter codes, not mapped to one form.
GERMAN = frozenset({"de", "deu", "ger"})
ACTOR = Actor(None, "system:practice")
# The sweep runs at most this often per process (opportunistic, on use).
SWEEP_INTERVAL = timedelta(hours=1)
_MODES = {
    "scratch": "independent",
    "proposals": "proposal_check",
    "consolidation": "review",
}

UnavailableReason = Literal["offer_off", "not_eligible", "no_ontology"]
_MESSAGES: dict[str, str] = {
    "offer_off": "Practice projects are switched off on this server.",
    "not_eligible": "Practice is for annotators and translation reviewers.",
    "no_ontology": (
        "Practice is not available: this server has no suitable HPO release."
        " An administrator can load one on the Ontologies page."
    ),
}


class PracticeFinding(BaseModel):
    term_id: str
    assertion: str | None = None
    defaulted: list[str] = []
    # An Edit & Replace copy of a proposal, not an own finding.
    replacement: bool = False


class PracticeDecision(BaseModel):
    """A decision on a proposal or on a colleague's finding."""

    term_id: str | None = None
    outcome: str
    replacement_term_id: str | None = None
    # The consolidation action (``auto``, ``keep``, ``choose``, ``leave_out``).
    action: str | None = None


class PracticeTask(BaseModel):
    """One practice task and the facts its steps are ticked from."""

    assignment_id: int
    kind: content.PracticeKind
    status: str
    case_id: str
    language: str
    findings: list[PracticeFinding] = []
    decisions: list[PracticeDecision] = []
    # Translation review: the saved text and decision of the draft.
    translation_text: str | None = None
    translation_decision: str | None = None


class PracticeProject(BaseModel):
    project_key: str
    name: str
    created_at: datetime
    last_activity_at: datetime
    expires_at: datetime
    tasks: list[PracticeTask]
    done: int
    total: int


class PracticeState(BaseModel):
    """``GET /api/v1/me/practice``."""

    offered: bool
    # Whether "Try it out" / "Start practice" can create a project now.
    available: bool
    unavailable_reason: UnavailableReason | None = None
    unavailable_message: str | None = None
    # The "New here?" card on My tasks: offered, no project, not hidden.
    show_card: bool
    card_hidden: bool
    # The practice texts are German; no languages listed counts as not reading it.
    reads_german: bool
    project: PracticeProject | None = None


class AdminPracticeProject(BaseModel):
    project_key: str
    name: str
    owner_username: str
    owner_display_name: str
    created_at: datetime
    last_activity_at: datetime
    expires_at: datetime
    done: int
    total: int


@dataclass(frozen=True)
class _Owner:
    id: int
    username: str
    display_name: str
    pseudonym: str


class _AlreadyStarted(Exception):
    """Another request (a second tab) created the practice project first."""


def _activity(project_id: Any) -> Any:
    """The last change in the practice project: an edit, a task change or a
    saved translation review; at least its creation."""
    edits = (
        select(func.max(EditEventRow.at))
        .where(EditEventRow.project_id == project_id)
        .scalar_subquery()
    )
    tasks = (
        select(func.max(AssignmentRow.updated_at))
        .where(AssignmentRow.project_id == project_id)
        .scalar_subquery()
    )
    reviews = (
        select(func.max(TranslationReviewDraftRow.updated_at))
        .join(
            AssignmentRow, AssignmentRow.id == TranslationReviewDraftRow.assignment_id
        )
        .where(AssignmentRow.project_id == project_id)
        .scalar_subquery()
    )
    return func.greatest(PracticeProjectRow.created_at, edits, tasks, reviews)


class PracticeService:
    """Start, read, reset and delete practice projects; the admin side too."""

    _last_sweep: datetime | None = None
    _sweep_lock = threading.Lock()

    def __init__(
        self,
        db: Database,
        *,
        accounts: Any,
        store_: Any,
        registry: Any,
        jobs: Any,
        preferences: Any,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.db = db
        self.accounts = accounts
        self.ontologies = store_
        self.registry = registry
        self.jobs = jobs
        self.preferences = preferences
        self._now = now

    # --- reading ---------------------------------------------------------

    @staticmethod
    def _roles_elsewhere(conn: Connection, user_id: int) -> set[str]:
        return set(
            conn.execute(
                select(ProjectMembershipRow.role)
                .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
                .where(ProjectMembershipRow.user_id == user_id, store.REAL_PROJECT)
            ).scalars()
        )

    def _ontology(self) -> tuple[Any, Pin] | None:
        """The HPO release for practice: the newest installed one (as a new
        project would take it) that has every practice term current and below
        the phenotype root; None when no release has them all."""
        files = [
            item
            for item in self.ontologies.list()
            if item.kind == "ontology" and item.prefix.lower() == "hp"
        ]
        files.sort(
            key=lambda item: (item.release or "", item.uploaded_at), reverse=True
        )
        for item in files:
            service = self.ontologies.service(item.sha256)
            if service is not None and all(
                service.validate_term(term).status == "valid"
                and content.ROOT in service.all_ancestors_of(term)
                for term in content.TERMS
            ):
                return item, Pin(item.sha256, (content.ROOT,), "hpo-phenotype")
        return None

    def _unavailable(
        self, conn: Connection, user_id: int
    ) -> tuple[UnavailableReason | None, bool]:
        """Why practice cannot start (None: it can), and whether it is offered."""
        if not store.offer_enabled(conn):
            return "offer_off", False
        if "annotator" not in self._roles_elsewhere(conn, user_id):
            return "not_eligible", False
        return None, True

    def state(self, user_id: int) -> PracticeState:
        self.sweep_if_due()
        prefs = self.preferences.load(user_id)
        with self.db.transaction() as conn:
            reason, offered = self._unavailable(conn, user_id)
            key = store.practice_project_of(conn, user_id)
            project = self._project(conn, key, user_id) if key else None
        if reason is None and project is None and self._ontology() is None:
            reason = "no_ontology"
        return PracticeState(
            offered=offered,
            available=reason is None and project is None,
            unavailable_reason=reason,
            unavailable_message=_MESSAGES[reason] if reason else None,
            show_card=offered and project is None and not prefs.practice_card_hidden,
            card_hidden=bool(prefs.practice_card_hidden),
            reads_german=bool(GERMAN & self.accounts.languages_of([user_id])[user_id]),
            project=project,
        )

    def _project(self, conn: Connection, key: str, user_id: int) -> PracticeProject:
        row = conn.execute(
            select(
                ProjectRow.id,
                ProjectRow.project_key,
                ProjectRow.name,
                PracticeProjectRow.created_at,
                _activity(ProjectRow.id).label("activity"),
                UserRow.pseudonym,
            )
            .join(PracticeProjectRow, PracticeProjectRow.project_id == ProjectRow.id)
            .join(UserRow, UserRow.id == PracticeProjectRow.user_id)
            .where(ProjectRow.project_key == key)
        ).one()
        tasks = self._tasks(conn, row.id, user_id, row.pseudonym)
        return PracticeProject(
            project_key=row.project_key,
            name=row.name,
            created_at=row.created_at,
            last_activity_at=row.activity,
            expires_at=row.activity + LIFETIME,
            tasks=tasks,
            done=sum(task.status == "submitted" for task in tasks),
            total=len(tasks),
        )

    def _tasks(
        self, conn: Connection, pid: int, user_id: int, pseudonym: str
    ) -> list[PracticeTask]:
        kinds = {
            (item.case_id, item.language): item.kind
            for item in content.texts(True)
            if item.kind
        }
        rows = conn.execute(
            select(
                AssignmentRow.id,
                AssignmentRow.task,
                AssignmentRow.status,
                AssignmentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
            )
            .join(
                DocumentRow,
                (DocumentRow.project_id == AssignmentRow.project_id)
                & (DocumentRow.document_id == AssignmentRow.document_id),
            )
            .where(
                AssignmentRow.project_id == pid,
                AssignmentRow.user_id == user_id,
                AssignmentRow.revoked_at.is_(None),
            )
            .order_by(DocumentRow.case_id, AssignmentRow.id)
        ).all()
        result = []
        for row in rows:
            kind = kinds.get((row.case_id, row.language))
            if kind is None:
                continue
            task = PracticeTask(
                assignment_id=row.id,
                kind=kind,
                status=row.status,
                case_id=row.case_id,
                language=row.language,
            )
            if kind == "translation_review":
                draft = conn.execute(
                    select(
                        TranslationReviewDraftRow.text, TranslationReviewDraftRow.form
                    ).where(TranslationReviewDraftRow.assignment_id == row.id)
                ).one_or_none()
                if draft is not None:
                    task.translation_text = draft.text
                    decision = (draft.form or {}).get("decision")
                    task.translation_decision = (
                        decision if isinstance(decision, str) else None
                    )
            else:
                self._draft_facts(conn, pid, pseudonym, row.document_id, kind, task)
            result.append(task)
        return result

    @staticmethod
    def _draft_facts(
        conn: Connection,
        pid: int,
        pseudonym: str,
        document_id: str,
        kind: str,
        task: PracticeTask,
    ) -> None:
        draft_id = conn.execute(
            select(DraftRow.id)
            .where(
                DraftRow.project_id == pid,
                DraftRow.document_id == document_id,
                DraftRow.annotator_id == pseudonym,
                DraftRow.mode == _MODES[kind],
            )
            .order_by(DraftRow.updated_at.desc(), DraftRow.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if draft_id is None:
            return

        # A consolidation decides on round inputs: their target snapshots are
        # kept in the round, not in annotation_snapshots.
        input_terms: dict[tuple[str, str], str] = {}
        if kind == "consolidation":
            for payload in conn.execute(
                select(RoundInputRow.payload).where(RoundInputRow.project_id == pid)
            ).scalars():
                item = payload.get("target_snapshot")
                if item is not None:
                    annotation = item["annotation"]
                    input_terms[(annotation["annotation_id"], item["version"])] = (
                        annotation["term_id"]
                    )

        def term_of(annotation_id: str | None, version: str | None) -> str | None:
            if annotation_id is None or version is None:
                return None
            if (annotation_id, version) in input_terms:
                return input_terms[(annotation_id, version)]
            payload = conn.execute(
                select(AnnotationSnapshotRow.payload).where(
                    AnnotationSnapshotRow.project_id == pid,
                    AnnotationSnapshotRow.annotation_id == annotation_id,
                    AnnotationSnapshotRow.version == version,
                )
            ).scalar_one_or_none()
            term = (payload or {}).get("annotation", {}).get("term_id")
            return term if isinstance(term, str) else None

        decisions = conn.execute(
            select(ReviewDecisionRow)
            .where(ReviewDecisionRow.draft_id == draft_id)
            .order_by(ReviewDecisionRow.position)
        ).all()
        replacements = {d.replacement_id for d in decisions if d.replacement_id}
        for decision in decisions:
            mark = (decision.payload or {}).get("consolidation") or {}
            task.decisions.append(
                PracticeDecision(
                    term_id=term_of(decision.target_id, decision.target_version),
                    outcome=decision.outcome,
                    replacement_term_id=term_of(
                        decision.replacement_id, decision.replacement_version
                    ),
                    action=mark.get("action") if isinstance(mark, dict) else None,
                )
            )
        for annotation_id, payload in conn.execute(
            select(AnnotationSnapshotRow.annotation_id, AnnotationSnapshotRow.payload)
            .join(
                DraftAnnotationRow,
                (
                    DraftAnnotationRow.annotation_id
                    == AnnotationSnapshotRow.annotation_id
                )
                & (DraftAnnotationRow.version == AnnotationSnapshotRow.version),
            )
            .where(
                DraftAnnotationRow.draft_id == draft_id,
                AnnotationSnapshotRow.project_id == pid,
            )
        ).tuples():
            annotation = (payload or {}).get("annotation", {})
            axes = annotation.get("axes_values") or {}
            task.findings.append(
                PracticeFinding(
                    term_id=str(annotation.get("term_id", "")),
                    assertion=axes.get("assertion"),
                    defaulted=list(annotation.get("axes_defaulted") or []),
                    # An Edit & Replace copy names its proposal from the start;
                    # the decision only follows once the copy differs.
                    replacement=annotation_id in replacements
                    or bool((annotation.get("provenance") or {}).get("source_refs")),
                )
            )

    # --- the card -----------------------------------------------------------

    def set_card(self, user_id: int, show: bool) -> PracticeState:
        from ontotator.application.preferences import PreferencesUpdate

        self.preferences.update(
            user_id, PreferencesUpdate(practice_card_hidden=not show)
        )
        return self.state(user_id)

    # --- start, reset, delete -------------------------------------------------

    def _owner(self, conn: Connection, user_id: int) -> _Owner:
        row = conn.execute(
            select(
                UserRow.id, UserRow.username, UserRow.display_name, UserRow.pseudonym
            ).where(UserRow.id == user_id)
        ).one()
        return _Owner(row.id, row.username, row.display_name, row.pseudonym)

    @staticmethod
    def _lock(conn: Connection, user_id: int) -> None:
        from ontotator.storage.repository import _lock_id

        conn.execute(
            select(func.pg_advisory_xact_lock(_lock_id("practice", str(user_id))))
        )

    def _require_available(self, user_id: int) -> tuple[Any, Pin]:
        """The HPO release for a new practice project of this user.

        Raises:
            DomainError: ``PRACTICE_UNAVAILABLE`` with the reason.
        """
        with self.db.transaction() as conn:
            reason, _ = self._unavailable(conn, user_id)
        chosen = None if reason else self._ontology()
        if reason is None and chosen is None:
            reason = "no_ontology"
        if reason is not None:
            raise DomainError(
                "PRACTICE_UNAVAILABLE", {"reason": reason, "message": _MESSAGES[reason]}
            )
        assert chosen is not None
        return chosen

    def start(self, user_id: int) -> PracticeState:
        """Create the user's practice project, or keep the one they have.

        Raises:
            DomainError: ``PRACTICE_UNAVAILABLE`` with the reason.
        """
        with self.db.transaction() as conn:
            self._lock(conn, user_id)
            existing = store.practice_project_of(conn, user_id)
            consolidation = "adjudicator" in self._roles_elsewhere(conn, user_id)
            owner = self._owner(conn, user_id)
        if existing is None:
            ontology, pin = self._require_available(user_id)
            key = f"practice-{owner.id}-{secrets.token_hex(3)}"
            try:
                self._build(key, owner, ontology, pin, consolidation)
            except _AlreadyStarted:
                # A second tab: the project the first one built is the answer.
                pass
            except Exception:
                # A half-built practice project is removed again.
                self._remove(key, ACTOR, "start_failed")
                raise
        # Read after the commit, so a due sweep removes its files as well.
        return self.state(user_id)

    def _build(
        self, key: str, owner: _Owner, ontology: Any, pin: Pin, consolidation: bool
    ) -> None:
        from ontotator.assignments.service import AssignmentService
        from ontotator.authz.memberships import grant_roles
        from ontotator.domain.profile_templates import hpo_phenotype
        from ontotator.projects.service import ProjectService, ProjectSettingsChange

        profile = hpo_phenotype(ontology)
        projects = ProjectService(self.db, self.ontologies)
        now = self._now()
        # The project and its owner row commit together: a crash leaves both
        # (the owner sees it, resets it or lets it expire) or neither.
        with self.db.transaction() as conn:
            # Held until the commit: a second request waits, then finds the row.
            self._lock(conn, owner.id)
            if store.practice_project_of(conn, owner.id) is not None:
                raise _AlreadyStarted
            projects.create(
                ACTOR,
                key=key,
                name=NAME,
                description="Invented texts for practice. Nothing here counts.",
                profile=profile,
                pins={"HP": pin},
                languages=content.LANGUAGES,
                practice=True,
            )
            pid = conn.execute(
                select(ProjectRow.id).where(ProjectRow.project_key == key)
            ).scalar_one()
            conn.execute(
                insert(PracticeProjectRow).values(
                    project_id=pid,
                    user_id=owner.id,
                    consolidation=consolidation,
                    created_at=now,
                )
            )
            roles = ["annotator", "adjudicator"] if consolidation else ["annotator"]
            grant_roles(conn, ACTOR, pid, owner.id, owner.username, roles, now)  # type: ignore[arg-type]
            record_audit(
                conn,
                Actor.user(owner.id, owner.username),
                "practice.start",
                target_type="project",
                target_id=key,
                project_id=pid,
                details={"consolidation": consolidation},
                at=now,
            )
        if consolidation:
            projects.update_settings(
                ACTOR, key, ProjectSettingsChange(annotations_per_text=2)
            )
        self._import(key, pid, content.bundle_bytes(profile, pin, consolidation))
        documents = self._documents(pid)
        assignments = AssignmentService(self.db)
        for item in content.texts(consolidation):
            if item.kind in ("scratch", "proposals"):
                task = "annotate"
            elif item.kind == "translation_review":
                task = "translation_review"
            else:
                continue
            assignments.assign(
                ACTOR,
                key,
                documents[(item.case_id, item.language)],
                owner.username,
                task,  # type: ignore[arg-type]
                confirm_language=True,
            )
        if consolidation:
            self._consolidation(key, pid, owner, documents[("PRACTICE-4", "de")])

    def _import(self, key: str, pid: int, data: bytes) -> None:
        from ontotator.exchange.jobs import store_file

        digest = store_file(self.db, data)
        payload = {"project": key, "blob_sha256": digest, "filename": "practice.zip"}
        job_id = self.jobs.enqueue("t1_import", payload, project_id=pid, actor=ACTOR)
        worker = f"practice:{os.getpid()}:{uuid4().hex[:8]}"
        job = self.jobs.claim(job_id, worker)
        if job is not None:
            job = self.jobs.run(job, worker)
        deadline = monotonic() + 60
        while job is None or job.status in ("queued", "running"):
            if monotonic() > deadline:
                raise DomainError("PRACTICE_IMPORT_FAILED", {"job_id": job_id})
            sleep(0.05)
            job = self.jobs.get(job_id)
        if job.status != "succeeded":
            raise DomainError("PRACTICE_IMPORT_FAILED", {"job_id": job_id})

    def _documents(self, pid: int) -> dict[tuple[str, str], str]:
        with self.db.transaction() as conn:
            return {
                (row.case_id, row.language): row.document_id
                for row in conn.execute(
                    select(
                        DocumentRow.case_id,
                        DocumentRow.language,
                        DocumentRow.document_id,
                    ).where(DocumentRow.project_id == pid)
                )
            }

    def _colleagues(self) -> list[_Owner]:
        """The two virtual colleagues, created once per server."""
        from ontotator.storage.repository import _lock_id

        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock(_lock_id("practice", "colleagues")))
            )
            ids = sorted(store.colleague_ids(conn))
            while len(ids) < len(content.COLLEAGUES):
                name = content.COLLEAGUES[len(ids)]
                username = f"practice-colleague-{len(ids) + 1}-{secrets.token_hex(3)}"
                self.accounts.create_user(ACTOR, username, name)
                user = self.accounts.get_by_username(username)
                # Nobody ever logs in as a virtual colleague.
                conn.execute(
                    delete(OneTimeCodeRow).where(OneTimeCodeRow.user_id == user.id)
                )
                self.accounts.set_languages(ACTOR, username, content.LANGUAGES)
                ids.append(user.id)
                store.save_colleague_ids(conn, ids)
            return [self._owner(conn, user_id) for user_id in ids]

    def _consolidation(
        self, key: str, pid: int, owner: _Owner, document_id: str
    ) -> None:
        from ontotator.application.editing import EditingService
        from ontotator.application.submissions import SubmissionService
        from ontotator.application.work_rounds import WorkRoundService
        from ontotator.assignments.service import AssignmentService
        from ontotator.authz.memberships import grant_roles
        from ontotator.authz.scoped import ScopedRepository
        from ontotator.domain.workspace import MutationEnvelope
        from ontotator.storage.repository import _lock_id

        colleagues = self._colleagues()
        assignments = AssignmentService(self.db)
        rounds = WorkRoundService(self.db)
        with self.db.transaction() as conn:
            for colleague in colleagues:
                grant_roles(
                    conn,
                    ACTOR,
                    pid,
                    colleague.id,
                    colleague.username,
                    ["annotator"],
                    self._now(),
                )
        sources = []
        for colleague, findings in zip(
            colleagues, content.COLLEAGUE_FINDINGS, strict=True
        ):
            assignment = assignments.assign(
                ACTOR,
                key,
                document_id,
                colleague.username,
                "annotate",
                confirm_language=True,
            )
            access = Access(
                colleague.id,
                colleague.pseudonym,
                False,
                {key: frozenset({"annotator"})},
            )
            actor = Actor.user(colleague.id, colleague.username)
            started = rounds.create(
                access,
                actor,
                assignment.id,
                request_id=f"practice-{uuid4().hex}",
                expected_workflow_revision=assignment.workflow_revision,
            )
            key_ = started.workspace_key
            assert key_ is not None
            scoped = ScopedRepository(self.db, access, actor)
            editing = EditingService(scoped, self.registry)
            for quote, term, axes in findings:
                draft = scoped.open_draft(key_)
                editing.apply(
                    key_,
                    MutationEnvelope(
                        mutation_id=f"practice-{uuid4().hex}",
                        expected_revision=draft.revision,
                        payload={
                            "command": "create_annotation",
                            "annotation_id": f"ann-{uuid4().hex[:12]}",
                            "evidence_id": f"ev-{uuid4().hex[:12]}",
                            "term_id": term,
                            "layer_id": "hpo-layer",
                            "type_id": "phenotype",
                            "segments": [
                                {
                                    field: value
                                    for field, value in content.span(
                                        content.CONSOLIDATION_TEXT, quote
                                    ).items()
                                    if field != "text"
                                }
                            ],
                            "axes_values": axes,
                            "chosen_axis_ids": list(axes),
                        },
                    ),
                )
            draft = scoped.open_draft(key_)
            submitted = SubmissionService(scoped, self.registry).submit(
                key_,
                MutationEnvelope(
                    mutation_id=f"practice-{uuid4().hex}",
                    expected_revision=draft.revision,
                    payload={"document_checked": True},
                ),
            )
            sources.append(submitted.submission_id)
        with self.db.transaction() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("members", key))))
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            project = (
                conn.execute(select(ProjectRow).where(ProjectRow.id == pid))
                .mappings()
                .one()
            )
            review = assignments._assign_locked(
                conn, ACTOR, project, document_id, owner.id, "review", True
            )
            locked = AssignmentService._locked(conn, review.id)
            created = rounds.create_in(
                conn,
                project=key,
                pid=pid,
                actor=ACTOR,
                assignment=locked,
                kind="consolidation",
                sources=sources,
                draft_sources=[],
                reason=None,
                expected_workflow_revision=int(locked["workflow_revision"]),
                lead=True,
                owner=owner.pseudonym,
            )
            record_audit(
                conn,
                ACTOR,
                "round.create",
                target_type="round",
                target_id=created.round_id,
                project_id=pid,
                details={"kind": "consolidation", "sources": sources},
            )

    def _remove(self, key: str, actor: Actor, reason: str) -> None:
        from ontotator.exchange.jobs import unlink_after_commit

        with self.db.transaction() as conn:
            exists = conn.execute(
                select(ProjectRow.id).where(
                    ProjectRow.project_key == key, ProjectRow.practice.is_(True)
                )
            ).first()
            deleted = (
                store.purge_practice_project(conn, actor, key, reason=reason)
                if exists
                else []
            )
            # Inside a caller's transaction, the files go after its commit.
            unlink_after_commit(self.db, deleted)

    def delete(self, user_id: int, actor: Actor) -> PracticeState:
        with self.db.transaction() as conn:
            key = store.practice_project_of(conn, user_id)
        if key is not None:
            self._remove(key, actor, "deleted_by_owner")
        return self.state(user_id)

    def reset(self, user_id: int, actor: Actor) -> PracticeState:
        """Delete the practice project and start a fresh one.

        Raises:
            DomainError: ``PRACTICE_UNAVAILABLE``, before anything is deleted,
                when no new project could be started.
        """
        self._require_available(user_id)
        with self.db.transaction() as conn:
            key = store.practice_project_of(conn, user_id)
        if key is not None:
            self._remove(key, actor, "reset")
        return self.start(user_id)

    # --- administration -----------------------------------------------------

    def admin_list(self) -> list[AdminPracticeProject]:
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(
                    ProjectRow.id,
                    ProjectRow.project_key,
                    ProjectRow.name,
                    UserRow.username,
                    UserRow.display_name,
                    PracticeProjectRow.created_at,
                    _activity(ProjectRow.id).label("activity"),
                    select(func.count())
                    .where(
                        AssignmentRow.project_id == ProjectRow.id,
                        AssignmentRow.user_id == PracticeProjectRow.user_id,
                        AssignmentRow.revoked_at.is_(None),
                    )
                    .scalar_subquery()
                    .label("total"),
                    select(func.count())
                    .where(
                        AssignmentRow.project_id == ProjectRow.id,
                        AssignmentRow.user_id == PracticeProjectRow.user_id,
                        AssignmentRow.revoked_at.is_(None),
                        AssignmentRow.status == literal("submitted"),
                    )
                    .scalar_subquery()
                    .label("done"),
                )
                .join(
                    PracticeProjectRow, PracticeProjectRow.project_id == ProjectRow.id
                )
                .join(UserRow, UserRow.id == PracticeProjectRow.user_id)
                .where(ProjectRow.practice.is_(True))
                .order_by(PracticeProjectRow.created_at.desc(), ProjectRow.id.desc())
            ).all()
        return [
            AdminPracticeProject(
                project_key=row.project_key,
                name=row.name,
                owner_username=row.username,
                owner_display_name=row.display_name,
                created_at=row.created_at,
                last_activity_at=row.activity,
                expires_at=row.activity + LIFETIME,
                done=row.done,
                total=row.total,
            )
            for row in rows
        ]

    def admin_delete(self, actor: Actor, key: str) -> list[str]:
        """Delete a practice project in the caller's transaction; a real
        project is refused. The stored files to unlink after the commit."""
        with self.db.transaction() as conn:
            return store.purge_practice_project(
                conn, actor, key, reason="deleted_by_admin"
            )

    # --- expiry ---------------------------------------------------------------

    def expire(self) -> list[str]:
        """Delete every practice project without activity for ``LIFETIME``,
        and every practice project without an owner row: one a build left
        behind when it crashed before creation became atomic (issue 286)."""
        cutoff = self._now() - LIFETIME
        with self.db.transaction() as conn:
            keys = list(
                conn.execute(
                    select(ProjectRow.project_key)
                    .join(
                        PracticeProjectRow,
                        PracticeProjectRow.project_id == ProjectRow.id,
                    )
                    .where(
                        ProjectRow.practice.is_(True), _activity(ProjectRow.id) < cutoff
                    )
                ).scalars()
            )
            keys += conn.execute(
                select(ProjectRow.project_key)
                .outerjoin(
                    PracticeProjectRow, PracticeProjectRow.project_id == ProjectRow.id
                )
                .where(
                    ProjectRow.practice.is_(True),
                    PracticeProjectRow.project_id.is_(None),
                )
            ).scalars()
        removed = []
        for key in keys:
            try:
                self._remove(key, ACTOR, "expired")
                removed.append(key)
            except Exception:
                logger.warning(
                    "Could not delete expired practice project %s", key, exc_info=True
                )
        return removed

    def sweep_if_due(self) -> None:
        """Run ``expire`` at most once per ``SWEEP_INTERVAL`` in this process."""
        now = self._now()
        with PracticeService._sweep_lock:
            last = PracticeService._last_sweep
            if last is not None and now - last < SWEEP_INTERVAL:
                return
            PracticeService._last_sweep = now
        try:
            self.expire()
        except Exception:
            logger.warning("The practice project sweep failed.", exc_info=True)
