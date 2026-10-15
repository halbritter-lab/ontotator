"""The repository as one request may use it: only the projects it can see (E3).

``ScopedRepository`` checks every project a call names against the policy
before it delegates. A project the user cannot see raises
``PROJECT_NOT_FOUND``, the same error (HTTP 404) as a project that does not
exist, so its existence is not revealed. Lookups that name no project are
refused with ``PROJECT_REQUIRED``. Every public method of ``Repository`` is
either overridden here or listed in ``PROJECT_FREE``; a test enforces that.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Connection, select

from ontocurator.auth.audit import Actor, record_audit
from ontocurator.authz.memberships import grant_roles
from ontocurator.authz.policy import ROLES, Access, Action, can
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
from ontocurator.domain.documents import Document, EvidenceSnapshot
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.ontology.conditions import SearchCondition
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from ontocurator.storage.database import Database
from ontocurator.storage.repository import DraftState, EditEvent, Repository
from ontocurator.storage.tables import UserRow

# Public methods that touch no project data.
PROJECT_FREE = frozenset({"ontology_resources", "package_manifest_hash"})


def project_not_found(package_id: str) -> DomainError:
    return DomainError("PROJECT_NOT_FOUND", f"There is no project '{package_id}'.")


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

    def _visible(self, package_id: str) -> None:
        if not can(self.access, Action.VIEW_PROJECT, package_id):
            raise project_not_found(package_id)

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

    def get_search_conditions(self, package_id: str) -> list[SearchCondition] | None:
        self._visible(package_id)
        return super().get_search_conditions(package_id)

    def capture_search_conditions(
        self,
        package_id: str,
        conditions: list[SearchCondition],
        resources: dict[str, bytes],
    ) -> list[SearchCondition]:
        self._visible(package_id)
        return super().capture_search_conditions(package_id, conditions, resources)

    def get_embedded_files(self, package_id: str) -> dict[str, bytes]:
        self._visible(package_id)
        return super().get_embedded_files(package_id)

    def get_manifest(self, package_id: str) -> PackageManifest:
        self._visible(package_id)
        return super().get_manifest(package_id)

    def manifest_hash(self, package_id: str) -> str | None:
        self._visible(package_id)
        return super().manifest_hash(package_id)

    def list_manifests(self) -> list[PackageManifest]:
        return [
            manifest
            for manifest in super().list_manifests()
            if can(self.access, Action.VIEW_PROJECT, manifest.package_id)
        ]

    def get_task_profile(self, package_id: str) -> TaskProfile:
        self._visible(package_id)
        return super().get_task_profile(package_id)

    def get_axes_config(self, package_id: str) -> AxesConfig:
        self._visible(package_id)
        return super().get_axes_config(package_id)

    # --- documents and proposals ------------------------------------------- #

    def get_document(self, package_id: str, document_id: str) -> Document | None:
        self._visible(package_id)
        return super().get_document(package_id, document_id)

    def list_documents(self, package_id: str) -> list[Document]:
        self._visible(package_id)
        return super().list_documents(package_id)

    def get_annotation_snapshot(
        self, annotation_id: str, version: str, package_id: str | None = None
    ) -> AnnotationSnapshot | None:
        if package_id is None:
            raise _project_required()
        self._visible(package_id)
        return super().get_annotation_snapshot(annotation_id, version, package_id)

    def get_evidence_snapshot(
        self, evidence_id: str, version: str, package_id: str | None = None
    ) -> EvidenceSnapshot | None:
        if package_id is None:
            raise _project_required()
        self._visible(package_id)
        return super().get_evidence_snapshot(evidence_id, version, package_id)

    def list_annotations_for_document(
        self, package_id: str, document_id: str
    ) -> list[AnnotationSnapshot]:
        self._visible(package_id)
        return super().list_annotations_for_document(package_id, document_id)

    # --- drafts and mutations ---------------------------------------------- #

    def list_workspace_keys(
        self,
        package_id: str,
        annotator_id: str,
        mode: str | None = None,
        document_id: str | None = None,
    ) -> list[WorkspaceKey]:
        self._visible(package_id)
        return super().list_workspace_keys(package_id, annotator_id, mode, document_id)

    def open_draft(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> Draft:
        self._visible(key.package_id)
        return super().open_draft(key, targets)

    def run_mutation(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        operation: Callable[[Draft], Draft | Submission],
    ) -> Draft | Submission:
        self._visible(key.package_id)
        return super().run_mutation(key, envelope, operation)

    def get_document_status(
        self,
        package_id: str,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> Literal["not_started", "in_progress", "completed"]:
        self._visible(package_id)
        return super().get_document_status(package_id, document_id, annotator_id, mode)

    # --- submissions -------------------------------------------------------- #

    def get_submissions_for_workspace(self, key: WorkspaceKey) -> list[Submission]:
        self._visible(key.package_id)
        return super().get_submissions_for_workspace(key)

    def get_submissions_for_document(
        self, package_id: str, document_id: str
    ) -> list[Submission]:
        self._visible(package_id)
        return super().get_submissions_for_document(package_id, document_id)

    def get_submission(
        self, submission_id: str, package_id: str | None = None
    ) -> Submission | None:
        if package_id is None:
            raise _project_required()
        self._visible(package_id)
        return super().get_submission(submission_id, package_id)

    # --- search events ------------------------------------------------------ #

    def save_search_event(self, event: SearchEventRecord) -> None:
        self._visible(event.workspace_key.package_id)
        super().save_search_event(event)

    def get_search_event(
        self, event_id: str, package_id: str | None = None
    ) -> SearchEventRecord | None:
        if package_id is None:
            raise _project_required()
        self._visible(package_id)
        return super().get_search_event(event_id, package_id)

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
        self._visible(workspace_key.package_id)
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
        self._visible(key.package_id)
        return super().get_search_events_for_workspace(key)

    # --- export ------------------------------------------------------------- #

    def export_package(
        self, package_id: str, *, include_captured_conditions: bool = True
    ) -> ValidatedPackage:
        self._visible(package_id)
        return super().export_package(
            package_id, include_captured_conditions=include_captured_conditions
        )

    # --- edit log ----------------------------------------------------------- #

    def edit_events(self, key: WorkspaceKey) -> list[EditEvent]:
        self._visible(key.package_id)
        return super().edit_events(key)

    def draft_state_at(self, key: WorkspaceKey, revision: int) -> DraftState:
        self._visible(key.package_id)
        return super().draft_state_at(key, revision)
