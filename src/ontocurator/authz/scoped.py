"""The repository as one request may use it: only the projects it can see (E3).

``ScopedRepository`` checks every project a call names against the policy
before it delegates. A project the user cannot see raises
``PROJECT_NOT_FOUND``, the same error (HTTP 404) as a project that does not
exist, so its existence is not revealed. Lookups that name no project are
refused with ``PROJECT_REQUIRED``. Every public method of ``Repository`` is
either overridden here or listed in ``PROJECT_FREE``; a test enforces that.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import Connection, func, select, update

from ontocurator.assignments.eligibility import require_annotation_gate
from ontocurator.assignments.service import TASK_FOR_MODE, Assignment, AssignmentService
from ontocurator.auth.audit import Actor, record_audit
from ontocurator.auth.authority import lock_user_authority
from ontocurator.authz.memberships import grant_roles
from ontocurator.authz.policy import ROLES, Access, Action, can, may_take
from ontocurator.authz.versions import (
    require_proposals,
    text_layers,
    visible_annotation_versions,
)
from ontocurator.authz.visibility import (
    DocumentFilter,
    current_access,
    may_read_translation_review_output_metadata,
    project_document_filters,
    readable_case_documents,
    require_case_text,
    require_document,
    visible_documents,
)
from ontocurator.domain.annotation_modes import workspace_mode
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.documents import Document, EvidenceSnapshot
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.project_rules import ProjectRules
from ontocurator.domain.reanchor_resolution import PendingReanchorRef, ReanchorItem
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.variants import VariantInfo
from ontocurator.domain.work_rounds import WorkRoundView
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.exchange.t1 import ImportCounts, ImportedDocument, ImportedSet, Pin
from ontocurator.ontology.conditions import SearchCondition
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from ontocurator.storage.database import Database
from ontocurator.storage.repository import (
    DraftState,
    EditEvent,
    ProjectExport,
    ProjectInfo,
    Repository,
    _lock_id,
)
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    AssignmentRow,
    EvidenceSnapshotRow,
    ProposalSetRow,
    SearchEventRow,
    SubmissionRow,
    UserRow,
)

# Public methods that touch no project data.
PROJECT_FREE = frozenset({"ontology_resources", "package_manifest_hash"})


def project_not_found(project_key: str) -> DomainError:
    return DomainError("PROJECT_NOT_FOUND", f"There is no project '{project_key}'.")


def _project_required() -> DomainError:
    return DomainError(
        "PROJECT_REQUIRED", "This lookup needs the project it belongs to."
    )


class ScopedRepository(Repository):
    """A ``Repository`` limited to the projects ``access`` may see.

    With an ``actor`` (the API passes the logged-in user), a project this
    repository creates gets its creator as a member with every role.
    """

    def __init__(
        self, db: Database, access: Access, actor: Actor | None = None
    ) -> None:
        super().__init__(db)
        self.access = access
        self.actor = actor

    def _visible(self, project_key: str) -> None:
        if not can(self.access, Action.VIEW_PROJECT, project_key):
            raise project_not_found(project_key)

    def _document(self, project_key: str, document_id: str) -> None:
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            require_document(conn, self.access, project_id, project_key, document_id)

    def _documents(self, project_key: str) -> DocumentFilter:
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            return visible_documents(conn, self.access, project_id, project_key)

    def workspace_input_snapshots(self, key: WorkspaceKey) -> list[AnnotationSnapshot]:
        self._document(key.project_key, key.document_id)
        if key.round_id is not None:
            self.get_work_round(key.project_key, key.round_id)
        return super().workspace_input_snapshots(key)

    def get_work_round(self, project_key: str, round_id: str) -> WorkRoundView:
        self._visible(project_key)
        result = super().get_work_round(project_key, round_id)
        self._document(project_key, result.document_id)
        if (
            not can(self.access, Action.EXPORT_ALL_WORK, project_key)
            and result.annotator_id != self.access.pseudonym
        ):
            raise DomainError("ROUND_NOT_FOUND")
        return result

    def get_round_for_submission(
        self, project_key: str, submission_id: str
    ) -> WorkRoundView | None:
        self._visible(project_key)
        if not can(self.access, Action.EXPORT_ALL_WORK, project_key):
            self.get_submission(submission_id, project_key)
        return super().get_round_for_submission(project_key, submission_id)

    def get_round_input_inventory(
        self, project_key: str, round_id: str
    ) -> list[dict[str, Any]]:
        self.get_work_round(project_key, round_id)
        return super().get_round_input_inventory(project_key, round_id)

    def list_workflow_causes(self, project_key: str) -> list[dict[str, Any]]:
        self._visible(project_key)
        if not can(self.access, Action.VIEW_PROGRESS, project_key):
            raise AccessDenied("NOT_ALLOWED")
        return super().list_workflow_causes(project_key)

    # The connection-scoped reads below leave item checks to their caller (who
    # authorized the item first); the project check is still made here.
    def work_round_in(
        self, conn: Connection, project_key: str, project_id: int, round_id: str
    ) -> WorkRoundView:
        self._visible(project_key)
        return super().work_round_in(conn, project_key, project_id, round_id)

    def round_for_submission_in(
        self, conn: Connection, project_key: str, project_id: int, submission_id: str
    ) -> WorkRoundView | None:
        self._visible(project_key)
        return super().round_for_submission_in(
            conn, project_key, project_id, submission_id
        )

    def workflow_causes_in(
        self, conn: Connection, project_key: str, project_id: int
    ) -> list[dict[str, Any]]:
        self._visible(project_key)
        return super().workflow_causes_in(conn, project_key, project_id)

    def workspace_assignment(self, key: WorkspaceKey) -> Assignment:
        """The workspace's current authorized assignment, with storage encapsulated."""
        self._visible(key.project_key)
        with self.db.transaction() as conn:
            return self.require_workable(conn, key)

    def require_workable(
        self, conn: Connection, key: WorkspaceKey, *, mutation: bool = False
    ) -> Assignment:
        project_id = self._require_project(conn, key.project_key)
        access = current_access(conn, self.access, project_id, key.project_key)
        require_document(conn, access, project_id, key.project_key, key.document_id)
        if key.annotator_id != access.pseudonym:
            raise AccessDenied("IDENTITY_MISMATCH")
        if not may_take(access, key.project_key, TASK_FOR_MODE[key.mode]):
            raise AccessDenied("MODE_NOT_ALLOWED")
        assignment = AssignmentService.active_for(
            conn, project_id, key.document_id, access.user_id, TASK_FOR_MODE[key.mode]
        )
        if assignment is None:
            raise AccessDenied("ASSIGNMENT_REQUIRED")
        # An annotate assignment opens only its own mode (plan review R8).
        if assignment.task == "annotate" and key.mode != workspace_mode(
            assignment.task, assignment.annotation_mode
        ):
            raise AccessDenied("MODE_NOT_ALLOWED")
        if mutation and assignment.status == "submitted":
            raise DomainError("ASSIGNMENT_SUBMITTED")
        return assignment

    def _before_workspace_locks(
        self, conn: Connection, key: WorkspaceKey, *, exclusive: bool = False
    ) -> None:
        conn.execute(
            select(
                func.pg_advisory_xact_lock_shared(_lock_id("members", key.project_key))
            )
        )
        # Exclusive for a submit that creates work (V8); never upgraded later.
        project_lock = (
            func.pg_advisory_xact_lock
            if exclusive
            else func.pg_advisory_xact_lock_shared
        )
        conn.execute(select(project_lock(_lock_id("project", key.project_key))))
        lock_user_authority(conn, self.access.user_id)
        # Revocation uses project EXCLUSIVE, so this assignment stays valid
        # through commit without a global command mutex.
        assignment = self.require_workable(conn, key)
        conn.execute(
            select(AssignmentRow.id)
            .where(AssignmentRow.id == assignment.id)
            .with_for_update(key_share=True)
        ).one()

    def _before_open_draft(self, conn: Connection, key: WorkspaceKey) -> None:
        assignment = self.require_workable(conn, key)
        conn.execute(
            select(AssignmentRow.id)
            .where(AssignmentRow.id == assignment.id)
            .with_for_update(key_share=True)
        ).one()
        assignment = self.require_workable(conn, key)
        if assignment.status != "submitted":
            require_annotation_gate(
                conn, self._require_project(conn, key.project_key), key.document_id
            )

    def _before_new_mutation(self, conn: Connection, key: WorkspaceKey) -> None:
        assignment = self.require_workable(conn, key, mutation=True)
        from ontocurator.application.workflow_guards import require_task_writable

        require_task_writable(conn, assignment.id)
        conn.execute(
            select(AssignmentRow.id)
            .where(AssignmentRow.id == assignment.id)
            .with_for_update(key_share=True)
        ).one()
        # Another compatible draft can submit the same task while this row
        # lock waits.
        self.require_workable(conn, key, mutation=True)
        require_annotation_gate(
            conn, self._require_project(conn, key.project_key), key.document_id
        )

    def _after_new_mutation(
        self,
        conn: Connection,
        key: WorkspaceKey,
        result: Draft | Submission,
        at: datetime,
    ) -> None:
        assignment = self.require_workable(conn, key, mutation=True)
        values: dict[str, Any] = {"updated_at": at}
        if isinstance(result, Submission):
            values.update(status="submitted", last_submission_id=result.submission_id)
        elif assignment.status == "open":
            values["status"] = "in_progress"
        else:
            return
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment.id)
            .values(**values)
        )

    # --- projects ---------------------------------------------------------- #

    def import_package(
        self,
        package: ValidatedPackage,
        fallback_axes_config: AxesConfig | None = None,
        *,
        on_create: Callable[[Connection, int], None] | None = None,
    ) -> str:
        """Create a project (system admins) or add to one (``IMPORT_DOCUMENTS``).

        The same refusal for a missing and a foreign project, so neither is
        revealed. A new project is audited as ``project.create`` and its
        creator becomes a member with every role, in the creating transaction.
        """
        key = package.manifest.package_id
        if not (
            can(self.access, Action.CREATE_PROJECT)
            or can(self.access, Action.IMPORT_DOCUMENTS, key)
        ):
            raise AccessDenied("NOT_ALLOWED", "You may not import into this project.")
        actor = self.actor

        def created(conn: Connection, project_id: int) -> None:
            if actor is not None and actor.user_id is not None:
                now = datetime.now(UTC)
                record_audit(
                    conn,
                    actor,
                    "project.create",
                    target_type="project",
                    target_id=key,
                    project_id=project_id,
                    at=now,
                )
                # The creator keeps their session: the request that created
                # the project continues with it (D2 is about later changes).
                username = conn.execute(
                    select(UserRow.username).where(UserRow.id == actor.user_id)
                ).scalar_one()
                grant_roles(
                    conn, actor, project_id, actor.user_id, username, ROLES, now
                )
            if on_create is not None:
                on_create(conn, project_id)

        return super().import_package(package, fallback_axes_config, on_create=created)

    def create_project(
        self,
        key: str,
        name: str,
        description: str | None,
        profile: TaskProfile,
        pins: Mapping[str, Pin],
        *,
        on_create: Callable[[Connection, int], None] | None = None,
    ) -> None:
        """Create a project (system admins only), audited as ``project.create``.

        A creating user becomes a member with every role, as for
        :meth:`import_package`.
        """
        if not can(self.access, Action.CREATE_PROJECT):
            raise AccessDenied("NOT_ALLOWED", "You may not create projects.")
        actor = self.actor

        def created(conn: Connection, project_id: int) -> None:
            now = datetime.now(UTC)
            if actor is not None:
                record_audit(
                    conn,
                    actor,
                    "project.create",
                    target_type="project",
                    target_id=key,
                    project_id=project_id,
                    details={
                        "name": name,
                        "profile_id": profile.profile_id,
                        "pins": {
                            ontology_id: pin.sha256
                            for ontology_id, pin in sorted(pins.items())
                        },
                    },
                    at=now,
                )
            if actor is not None and actor.user_id is not None:
                username = conn.execute(
                    select(UserRow.username).where(UserRow.id == actor.user_id)
                ).scalar_one()
                grant_roles(
                    conn, actor, project_id, actor.user_id, username, ROLES, now
                )
            if on_create is not None:
                on_create(conn, project_id)

        super().create_project(key, name, description, profile, pins, on_create=created)

    def project_pins(self, project_key: str) -> dict[str, Pin]:
        self._visible(project_key)
        return super().project_pins(project_key)

    def add_documents_and_proposals(
        self,
        project_key: str,
        documents: Sequence[ImportedDocument],
        proposal_sets: Sequence[ImportedSet],
        *,
        source_sha256: str | None,
        imported_by: int | None = None,
        job_id: int | None = None,
        on_done: Callable[[Connection, int, ImportCounts], None] | None = None,
    ) -> ImportCounts:
        self._visible(project_key)
        if not can(self.access, Action.IMPORT_DOCUMENTS, project_key):
            raise AccessDenied("NOT_ALLOWED", "You may not import into this project.")
        return super().add_documents_and_proposals(
            project_key,
            documents,
            proposal_sets,
            source_sha256=source_sha256,
            imported_by=imported_by,
            job_id=job_id,
            on_done=on_done,
        )

    def get_search_conditions(self, project_key: str) -> list[SearchCondition] | None:
        self._visible(project_key)
        return super().get_search_conditions(project_key)

    def capture_search_conditions(
        self,
        project_key: str,
        conditions: list[SearchCondition],
        resources: dict[str, bytes],
        *,
        expected_structure: str | None = None,
    ) -> list[SearchCondition]:
        self._visible(project_key)
        return super().capture_search_conditions(
            project_key, conditions, resources, expected_structure=expected_structure
        )

    def get_embedded_files(self, project_key: str) -> dict[str, bytes]:
        self._visible(project_key)
        return super().get_embedded_files(project_key)

    def get_manifest(self, project_key: str) -> PackageManifest:
        self._visible(project_key)
        manifest = super().get_manifest(project_key)
        visibility = self._documents(project_key)
        if visibility.all:
            return manifest
        return manifest.model_copy(
            update={
                "document_order": [
                    doc
                    for doc in manifest.document_order
                    if doc in visibility.document_ids
                ],
                "file_hashes": {},
            }
        )

    def manifest_hash(self, project_key: str) -> str | None:
        self._visible(project_key)
        return super().manifest_hash(project_key)

    def list_manifests(self) -> list[PackageManifest]:
        with self.db.transaction() as conn:
            filters = project_document_filters(conn, self.access)
        return [
            manifest
            if filters[manifest.package_id].all
            else manifest.model_copy(
                update={
                    "document_order": [
                        doc
                        for doc in manifest.document_order
                        if doc in filters[manifest.package_id].document_ids
                    ],
                    "file_hashes": {},
                }
            )
            for manifest in super().list_manifests()
            if manifest.package_id in filters
        ]

    def list_projects(self) -> list[ProjectInfo]:
        with self.db.transaction() as conn:
            filters = project_document_filters(conn, self.access)
        return [
            project
            if filters[project.project_key].all
            else replace(
                project, document_count=len(filters[project.project_key].document_ids)
            )
            for project in super().list_projects()
            if project.project_key in filters
        ]

    def get_task_profile(self, project_key: str) -> TaskProfile:
        self._visible(project_key)
        return super().get_task_profile(project_key)

    def get_axes_config(self, project_key: str) -> AxesConfig:
        self._visible(project_key)
        return super().get_axes_config(project_key)

    def get_project_rules(self, project_key: str) -> ProjectRules:
        self._visible(project_key)
        return super().get_project_rules(project_key)

    # --- documents and proposals ------------------------------------------- #

    def get_variant(self, project_key: str, document_id: str) -> VariantInfo:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            try:
                require_case_text(
                    conn, self.access, project_id, project_key, document_id
                )
            except DomainError as error:
                if (
                    error.code != "DOCUMENT_NOT_FOUND"
                    or not may_read_translation_review_output_metadata(
                        conn, self.access, project_id, document_id
                    )
                ):
                    raise
            return super().get_variant(project_key, document_id)

    def list_variants(
        self, project_key: str, *, case_id: str | None = None
    ) -> list[VariantInfo]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            fresh = current_access(conn, self.access, project_id, project_key)
            if not can(fresh, Action.VIEW_PROJECT, project_key):
                raise project_not_found(project_key)
            visibility = readable_case_documents(conn, fresh, project_id, project_key)
            return self._variants(
                project_key,
                case_id=case_id,
                document_ids=None if visibility.all else visibility.document_ids,
            )

    def get_variant_text(self, project_key: str, document_id: str) -> Document | None:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            require_case_text(conn, self.access, project_id, project_key, document_id)
            return super().get_variant_text(project_key, document_id)

    def get_annotation_version(
        self, project_key: str, document_id: str, kind: str, version_id: str
    ) -> dict[str, Any]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            try:
                refs = visible_annotation_versions(
                    conn, self.access, project_id, project_key, document_id
                )
                if kind in {"final", "proposals"}:
                    # Offered through the text layers (final result; newest
                    # proposal set for annotators from proposals).
                    refs += [
                        entry.ref
                        for entry in text_layers(
                            conn, self.access, project_id, project_key, document_id
                        )
                        if entry.ref is not None
                    ]
            except DomainError as error:
                if error.code == "DOCUMENT_NOT_FOUND":
                    raise DomainError("VERSION_NOT_FOUND") from None
                raise
            ref = next(
                (item for item in refs if item.kind == kind and item.id == version_id),
                None,
            )
            if ref is None:
                raise DomainError("VERSION_NOT_FOUND")
            return {
                "ref": ref,
                **super().get_annotation_version(
                    project_key, document_id, kind, version_id
                ),
            }

    def require_proposals(self, project_key: str, document_id: str) -> None:
        """Raise unless this user may see the document's proposals."""
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            require_proposals(conn, self.access, project_id, project_key, document_id)

    def get_reanchor_items(
        self, project_key: str, document_id: str
    ) -> list[dict[str, Any]]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            require_case_text(conn, self.access, project_id, project_key, document_id)
            require_proposals(conn, self.access, project_id, project_key, document_id)
            return super().get_reanchor_items(project_key, document_id)

    def find_variants_by_text_sha256(
        self, project_key: str, sha: str
    ) -> list[VariantInfo]:
        visibility = self._documents(project_key)
        return self._variants(
            project_key,
            sha=sha,
            document_ids=None if visibility.all else visibility.document_ids,
        )

    def get_document(self, project_key: str, document_id: str) -> Document | None:
        self._document(project_key, document_id)
        self._visible(project_key)
        return super().get_document(project_key, document_id)

    def list_documents(self, project_key: str) -> list[Document]:
        self._visible(project_key)
        visibility = self._documents(project_key)
        return [
            doc
            for doc in super().list_documents(project_key)
            if visibility.all or doc.document_id in visibility.document_ids
        ]

    def get_annotation_snapshot(
        self, annotation_id: str, version: str, project_key: str | None = None
    ) -> AnnotationSnapshot | None:
        if project_key is None:
            raise _project_required()
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            owner = conn.execute(
                select(AnnotationSnapshotRow.document_id).where(
                    AnnotationSnapshotRow.project_id == project_id,
                    AnnotationSnapshotRow.annotation_id == annotation_id,
                    AnnotationSnapshotRow.version == version,
                )
            ).scalar_one_or_none()
            if owner is not None:
                require_case_text(conn, self.access, project_id, project_key, owner)
            from ontocurator.authz.workflow import may_read_snapshot

            if owner is not None and not may_read_snapshot(
                conn,
                self.access,
                project_id,
                project_key,
                "annotation",
                annotation_id,
                version,
            ):
                raise DomainError("ANNOTATION_NOT_FOUND")
        return super().get_annotation_snapshot(annotation_id, version, project_key)

    def get_evidence_snapshot(
        self, evidence_id: str, version: str, project_key: str | None = None
    ) -> EvidenceSnapshot | None:
        if project_key is None:
            raise _project_required()
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            owner = conn.execute(
                select(EvidenceSnapshotRow.document_id).where(
                    EvidenceSnapshotRow.project_id == project_id,
                    EvidenceSnapshotRow.evidence_id == evidence_id,
                    EvidenceSnapshotRow.version == version,
                )
            ).scalar_one_or_none()
            if owner is not None:
                require_case_text(conn, self.access, project_id, project_key, owner)
            from ontocurator.authz.workflow import may_read_snapshot

            if owner is not None and not may_read_snapshot(
                conn,
                self.access,
                project_id,
                project_key,
                "evidence",
                evidence_id,
                version,
            ):
                raise DomainError("EVIDENCE_NOT_FOUND")
        return super().get_evidence_snapshot(evidence_id, version, project_key)

    def list_annotations_for_document(
        self, project_key: str, document_id: str
    ) -> list[AnnotationSnapshot]:
        self._document(project_key, document_id)
        self._visible(project_key)
        return super().list_annotations_for_document(project_key, document_id)

    # --- drafts and mutations ---------------------------------------------- #

    def get_proposal_set(self, project_key: str, set_id: int) -> dict[str, Any]:
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            owner = conn.execute(
                select(ProposalSetRow.document_id).where(
                    ProposalSetRow.project_id == project_id, ProposalSetRow.id == set_id
                )
            ).scalar_one_or_none()
            if owner is not None:
                from ontocurator.authz.versions import may_read_proposals

                if not may_read_proposals(
                    conn, self.access, project_id, project_key, owner
                ):
                    raise DomainError("PROPOSAL_SET_NOT_FOUND")
            return super().get_proposal_set(project_key, set_id)

    def workspace_proposal_sets(
        self, key: WorkspaceKey, offered: Sequence[tuple[str, str, int]]
    ) -> list[dict[str, Any]]:
        self._visible(key.project_key)
        with self.db.transaction() as conn:
            self.require_workable(conn, key)
            return super().workspace_proposal_sets(key, offered)

    def proposal_metadata(
        self, project_key: str, document_id: str
    ) -> dict[tuple[str, str], dict[str, Any]]:
        self._document(project_key, document_id)
        self._visible(project_key)
        return super().proposal_metadata(project_key, document_id)

    def list_workspace_keys(
        self,
        project_key: str,
        annotator_id: str,
        mode: str | None = None,
        document_id: str | None = None,
    ) -> list[WorkspaceKey]:
        self._visible(project_key)
        visibility = self._documents(project_key)
        if document_id is not None:
            self._document(project_key, document_id)
        return [
            key
            for key in super().list_workspace_keys(
                project_key, annotator_id, mode, document_id
            )
            if visibility.all or key.document_id in visibility.document_ids
        ]

    def open_draft(
        self,
        key: WorkspaceKey,
        targets: ReviewTargetSet | None = None,
        pending_proposal_set_ids: list[int] | None = None,
    ) -> Draft:
        self._document(key.project_key, key.document_id)
        self._visible(key.project_key)
        return super().open_draft(key, targets, pending_proposal_set_ids)

    def workspace_reanchor_items(self, draft: Draft) -> list[ReanchorItem]:
        self._visible(draft.key.project_key)
        with self.db.transaction() as conn:
            self.require_workable(conn, draft.key)
            return super().workspace_reanchor_items(draft)

    def reanchor_source_identity(
        self, key: WorkspaceKey, item: PendingReanchorRef
    ) -> tuple[AnnotationSnapshot, bool]:
        self._visible(key.project_key)
        with self.db.transaction() as conn:
            self.require_workable(conn, key)
            return super().reanchor_source_identity(key, item)

    def verified_reanchor_source(
        self, key: WorkspaceKey, item: PendingReanchorRef
    ) -> AnnotationSnapshot:
        self._visible(key.project_key)
        with self.db.transaction() as conn:
            self.require_workable(conn, key)
            return super().verified_reanchor_source(key, item)

    def run_mutation(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        operation: Callable[[Draft], Draft | Submission],
        *,
        before_operation: Callable[[Connection], None] | None = None,
        exclusive_project: bool = False,
        after_submit: Callable[[Connection, Submission], None] | None = None,
    ) -> Draft | Submission:
        self._document(key.project_key, key.document_id)
        self._visible(key.project_key)
        return super().run_mutation(
            key,
            envelope,
            operation,
            before_operation=before_operation,
            exclusive_project=exclusive_project,
            after_submit=after_submit,
        )

    def get_document_status(
        self,
        project_key: str,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> Literal["not_started", "in_progress", "completed"]:
        self._document(project_key, document_id)
        self._visible(project_key)
        return super().get_document_status(project_key, document_id, annotator_id, mode)

    # --- submissions -------------------------------------------------------- #

    def get_document_statuses(
        self, project_key: str, annotator_id: str, mode: str
    ) -> dict[str, Literal["not_started", "in_progress", "completed"]]:
        self._visible(project_key)
        visibility = self._documents(project_key)
        return {
            doc: status
            for doc, status in super()
            .get_document_statuses(project_key, annotator_id, mode)
            .items()
            if visibility.all or doc in visibility.document_ids
        }

    def review_input_document_ids(self, project_key: str) -> set[str]:
        self._visible(project_key)
        visibility = self._documents(project_key)
        docs = super().review_input_document_ids(project_key)
        return docs if visibility.all else docs & visibility.document_ids

    def get_submissions_for_workspace(self, key: WorkspaceKey) -> list[Submission]:
        if key.annotator_id != self.access.pseudonym and not can(
            self.access, Action.EXPORT_ALL_WORK, key.project_key
        ):
            raise AccessDenied("NOT_ALLOWED")
        self._document(key.project_key, key.document_id)
        self._visible(key.project_key)
        return super().get_submissions_for_workspace(key)

    def get_submissions_for_document(
        self, project_key: str, document_id: str
    ) -> list[Submission]:
        self._visible(project_key)
        from ontocurator.authz.workflow import may_read_human_submission

        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            require_case_text(conn, self.access, project_id, project_key, document_id)
            return [
                submission
                for submission in super().get_submissions_for_document(
                    project_key, document_id
                )
                if may_read_human_submission(
                    conn, self.access, project_id, project_key, submission.submission_id
                )
            ]

    def get_submission(
        self, submission_id: str, project_key: str | None = None
    ) -> Submission | None:
        if project_key is None:
            raise _project_required()
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            owner = conn.execute(
                select(SubmissionRow.document_id).where(
                    SubmissionRow.project_id == project_id,
                    SubmissionRow.submission_id == submission_id,
                )
            ).scalar_one_or_none()
            if owner is not None:
                require_case_text(conn, self.access, project_id, project_key, owner)
            from ontocurator.authz.workflow import may_read_human_submission

            if owner is not None and not may_read_human_submission(
                conn, self.access, project_id, project_key, submission_id
            ):
                raise DomainError("SUBMISSION_NOT_FOUND")
        return super().get_submission(submission_id, project_key)

    # --- search events ------------------------------------------------------ #

    def _before_search_provenance(self, conn: Connection, key: WorkspaceKey) -> None:
        """Record browsing without reopening or changing submitted clinical work."""
        from ontocurator.application.workflow_guards import require_task_writable

        self._lock_round_assignment(conn, key)
        self._check_round_mutation(conn, key, allow_submitted=True)
        assignment = self.require_workable(conn, key)
        require_task_writable(conn, assignment.id)

    def save_search_event(self, event: SearchEventRecord) -> None:
        self._document(event.workspace_key.project_key, event.workspace_key.document_id)
        self._visible(event.workspace_key.project_key)
        with self.db.transaction() as conn:
            self._before_workspace_locks(conn, event.workspace_key)
            self._before_search_provenance(conn, event.workspace_key)
            require_annotation_gate(
                conn,
                self._require_project(conn, event.workspace_key.project_key),
                event.workspace_key.document_id,
            )
            super().save_search_event(event)

    def get_search_event(
        self, event_id: str, project_key: str | None = None
    ) -> SearchEventRecord | None:
        if project_key is None:
            raise _project_required()
        self._visible(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            owner = conn.execute(
                select(SearchEventRow.payload["workspace_key"]).where(
                    SearchEventRow.project_id == project_id,
                    SearchEventRow.event_id == event_id,
                )
            ).scalar_one_or_none()
            if owner is not None:
                workspace = WorkspaceKey.model_validate(owner)
                fresh = current_access(conn, self.access, project_id, project_key)
                if workspace.annotator_id != fresh.pseudonym and not can(
                    fresh, Action.EXPORT_ALL_WORK, project_key
                ):
                    return None
                require_document(
                    conn, fresh, project_id, project_key, workspace.document_id
                )
        return super().get_search_event(event_id, project_key)

    def append_search_event_candidates(
        self,
        event_id: str,
        term_ids: Iterable[str],
        *,
        workspace_key: WorkspaceKey | None = None,
        annotation_id: str | None = None,
        layer_id: str | None = None,
    ) -> SearchEventRecord | None:
        if workspace_key is None:
            raise _project_required()
        self._document(workspace_key.project_key, workspace_key.document_id)
        with self.db.transaction() as conn:
            self._before_workspace_locks(conn, workspace_key)
            self._before_search_provenance(conn, workspace_key)
            require_annotation_gate(
                conn,
                self._require_project(conn, workspace_key.project_key),
                workspace_key.document_id,
            )
            project_id = self._require_project(conn, workspace_key.project_key)
            # A visible supplied workspace must never authorize locking or
            # growing an unrelated persisted event. Association is immutable;
            # the base writer also rechecks it after its event-row lock.
            owner = select(SearchEventRow.event_id).where(
                SearchEventRow.project_id == project_id,
                SearchEventRow.event_id == event_id,
                SearchEventRow.payload["workspace_key"]
                == workspace_key.model_dump(mode="json"),
            )
            if annotation_id is not None:
                owner = owner.where(SearchEventRow.annotation_id == annotation_id)
            if layer_id is not None:
                owner = owner.where(SearchEventRow.layer_id == layer_id)
            if conn.execute(owner).first() is None:
                return None
            return super().append_search_event_candidates(
                event_id,
                term_ids,
                workspace_key=workspace_key,
                annotation_id=annotation_id,
                layer_id=layer_id,
            )

    def get_search_events_for_workspace(
        self, key: WorkspaceKey
    ) -> list[SearchEventRecord]:
        if key.annotator_id != self.access.pseudonym and not can(
            self.access, Action.EXPORT_ALL_WORK, key.project_key
        ):
            raise AccessDenied("NOT_ALLOWED")
        self._document(key.project_key, key.document_id)
        self._visible(key.project_key)
        return super().get_search_events_for_workspace(key)

    # --- export ------------------------------------------------------------- #

    def export_package(
        self, project_key: str, *, include_captured_conditions: bool = True
    ) -> ValidatedPackage:
        self._visible(project_key)
        if not self._documents(project_key).all:
            raise AccessDenied("NOT_ALLOWED", "You may not export all project data.")
        return super().export_package(
            project_key, include_captured_conditions=include_captured_conditions
        )

    def t1_export_content(self, project_key: str) -> ProjectExport:
        self._visible(project_key)
        if not can(self.access, Action.EXPORT_ALL_WORK, project_key):
            raise AccessDenied("NOT_ALLOWED", "You may not export this project.")
        return super().t1_export_content(project_key)

    def t1_export_content_exact(
        self, project_key: str, submission_ids: Sequence[str]
    ) -> ProjectExport:
        self._visible(project_key)
        if not can(self.access, Action.EXPORT_ALL_WORK, project_key):
            raise AccessDenied("NOT_ALLOWED", "You may not export this project.")
        return super().t1_export_content_exact(project_key, submission_ids)

    def edit_log(self, project_key: str) -> list[dict[str, Any]]:
        self._visible(project_key)
        if not can(self.access, Action.EXPORT_EDIT_LOG, project_key):
            raise AccessDenied(
                "NOT_ALLOWED", "You may not export the edit log of this project."
            )
        return super().edit_log(project_key)

    # --- edit log ----------------------------------------------------------- #

    def edit_events(self, key: WorkspaceKey) -> list[EditEvent]:
        if key.annotator_id != self.access.pseudonym and not can(
            self.access, Action.EXPORT_ALL_WORK, key.project_key
        ):
            raise AccessDenied("NOT_ALLOWED")
        self._document(key.project_key, key.document_id)
        self._visible(key.project_key)
        return super().edit_events(key)

    def draft_state_at(self, key: WorkspaceKey, revision: int) -> DraftState:
        if key.annotator_id != self.access.pseudonym and not can(
            self.access, Action.EXPORT_ALL_WORK, key.project_key
        ):
            raise AccessDenied("NOT_ALLOWED")
        self._document(key.project_key, key.document_id)
        self._visible(key.project_key)
        return super().draft_state_at(key, revision)
