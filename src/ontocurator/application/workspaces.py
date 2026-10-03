"""Workspace application service and view models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxisDefinition
from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import (
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    resolve_layer,
    resolve_ontology,
)
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.scopes import TaskScope, build_scope
from ontocurator.domain.workspace import Draft, Submission, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.storage.repository import Repository


class DocumentSummary(BaseModel):
    """Metadata-only summary of a document in a package."""

    model_config = ConfigDict(extra="forbid")

    document_id: str
    language: str
    text_length: int
    position: int
    status: Literal["not_started", "in_progress", "completed"] = "not_started"


class WorkspaceView(BaseModel):
    """Loaded view of a workspace including document, draft and submissions."""

    model_config = ConfigDict(extra="forbid")

    key: WorkspaceKey
    document: Document
    draft: Draft
    targets: ReviewTargetSet
    scope: TaskScope
    layers: list[LayerDefinition] = Field(default_factory=list)
    ontologies: list[OntologyDefinition] = Field(default_factory=list)
    checked_layer_ids: list[str] = Field(default_factory=list)
    available_inputs: list[AnnotationSnapshot] = Field(default_factory=list)
    submissions: list[Submission] = Field(default_factory=list)
    term_statuses: dict[str, Literal["valid", "obsolete", "unknown"]] = Field(
        default_factory=dict
    )
    axes_definition: str = "editor-axes/v1"
    axes_config: list[AxisDefinition] = Field(default_factory=list)
    axes_config_sha256: str = ""


class WorkspaceService:
    """Coordinates workspace opening, document summaries and input selection."""

    def __init__(
        self,
        repo: Repository,
        ontology: OntologyService | OntologyRegistry,
    ) -> None:
        self.repo = repo
        if isinstance(ontology, OntologyRegistry):
            self.registry: OntologyRegistry | None = ontology
            self.ontology: OntologyService | None = None
        else:
            self.registry = None
            self.ontology = ontology

    def _get_service_for_layer(
        self, profile: TaskProfile, layer_id: str
    ) -> OntologyService:
        if self.registry is not None:
            return self.registry.for_layer(profile, layer_id)
        if self.ontology is not None:
            return self.ontology
        raise DomainError(
            "ONTOLOGY_NOT_FOUND",
            f"No ontology service configured for layer '{layer_id}'",
        )

    def list_documents(
        self,
        package_id: str,
        annotator_id: str | None = None,
        mode: str | None = None,
    ) -> list[DocumentSummary]:
        """List documents showing only metadata, without proposal counts."""
        docs = self.repo.list_documents(package_id)
        summaries: list[DocumentSummary] = []
        for idx, d in enumerate(docs, start=1):
            status: Literal["not_started", "in_progress", "completed"] = "not_started"
            if annotator_id and mode:
                status = self.repo.get_document_status(
                    package_id, d.document_id, annotator_id, mode
                )
            summaries.append(
                DocumentSummary(
                    document_id=d.document_id,
                    language=d.language,
                    text_length=len(d.text),
                    position=idx,
                    status=status,
                )
            )
        return summaries

    def get_document(self, package_id: str, document_id: str) -> Document:
        """Fetch a document or raise DomainError."""
        doc = self.repo.get_document(package_id, document_id)
        if doc is None:
            raise DomainError(
                "DOCUMENT_NOT_FOUND",
                f"Document '{document_id}' not found in package '{package_id}'",
            )
        return doc

    def get_review_inputs(
        self, package_id: str, document_id: str
    ) -> list[AnnotationSnapshot]:
        """Fetch historical annotations eligible as review targets."""
        profile = self.repo.get_task_profile(package_id)
        scope = build_scope(profile, "review")
        return [
            snap
            for snap in self.repo.list_annotations_for_document(package_id, document_id)
            if snap.annotation.layer_id in scope.editable_layer_ids
        ]

    def open(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> WorkspaceView:
        """Open or initialize a workspace view."""
        doc = self.get_document(key.package_id, key.document_id)
        profile = self.repo.get_task_profile(key.package_id)
        scope = build_scope(profile, key.mode)

        if key.scope_id and key.scope_id != scope.scope_id:
            raise DomainError(
                "INVALID_SCOPE",
                f"Workspace scope_id '{key.scope_id}' does not match expected '{scope.scope_id}'",
            )
        if not key.scope_id:
            key = key.model_copy(update={"scope_id": scope.scope_id})

        accessible_layer_ids = scope.editable_layer_ids + scope.reference_layer_ids
        layers = [resolve_layer(profile, lid) for lid in accessible_layer_ids]
        ont_ids = {layer.ontology_id for layer in layers}
        ontologies = [resolve_ontology(profile, oid) for oid in sorted(ont_ids)]

        term_statuses: dict[str, Literal["valid", "obsolete", "unknown"]] = {}

        if key.mode == "independent":
            effective_targets = ReviewTargetSet.create([])
            available_inputs: list[AnnotationSnapshot] = []
        elif key.mode == "assisted":
            effective_targets = ReviewTargetSet.create([])
            all_inputs = self.repo.list_annotations_for_document(
                key.package_id, key.document_id
            )
            available_inputs = [
                s
                for s in all_inputs
                if s.annotation.layer_id in scope.reference_layer_ids
            ]
        else:
            # review mode
            if targets is not None:
                effective_targets = targets
            else:
                existing_draft = self.repo.open_draft(key)
                effective_targets = existing_draft.targets
            all_inputs = self.repo.list_annotations_for_document(
                key.package_id, key.document_id
            )
            available_inputs = [
                s
                for s in all_inputs
                if s.annotation.layer_id
                in (scope.editable_layer_ids + scope.reference_layer_ids)
            ]
            canonical = ReviewTargetSet.create(effective_targets.targets)
            if (
                effective_targets != canonical
                or key.target_set_id != canonical.target_set_id
            ):
                raise DomainError(
                    "INVALID_TARGET_SET",
                    "Review target identity does not match its canonical content",
                )
            members = {
                (a.annotation.annotation_id, a.version): a for a in available_inputs
            }
            for target in canonical.targets:
                snap = members.get((target.annotation_id, target.version))
                if snap is None:
                    raise DomainError(
                        "INVALID_REVIEW_TARGET",
                        "Review target not found in available inputs",
                    )
                if (
                    snap.document_id != doc.document_id
                    or snap.text_sha256 != doc.text_sha256
                ):
                    raise DomainError(
                        "INVALID_REVIEW_TARGET",
                        "Review target does not match this document",
                    )
                if snap.annotation.layer_id not in scope.editable_layer_ids:
                    raise DomainError(
                        "INVALID_REVIEW_TARGET",
                        f"Review target layer '{snap.annotation.layer_id}' is not an editable layer in this scope",
                    )
                layer = resolve_layer(profile, snap.annotation.layer_id)
                ont = resolve_ontology(profile, layer.ontology_id)
                if snap.ontology_sha256 != ont.sha256:
                    raise DomainError(
                        "INVALID_REVIEW_TARGET",
                        "Review target ontology SHA-256 does not match configured layer ontology",
                    )

        draft = self.repo.open_draft(key, effective_targets)

        for a in available_inputs:
            tid = a.annotation.term_id
            lid = a.annotation.layer_id
            st_key = f"{lid}:{tid}"
            if st_key not in term_statuses:
                service = self._get_service_for_layer(profile, lid)
                term_statuses[st_key] = service.validate_term(tid).status

        for snap in draft.annotations:
            st_key = f"{snap.annotation.layer_id}:{snap.annotation.term_id}"
            if st_key not in term_statuses:
                service = self._get_service_for_layer(profile, snap.annotation.layer_id)
                term_statuses[st_key] = service.validate_term(
                    snap.annotation.term_id
                ).status

        submissions = self.repo.get_submissions_for_workspace(key)
        axes_profile = self.repo.get_axes_config(key.package_id)

        return WorkspaceView(
            key=key,
            document=doc,
            draft=draft,
            targets=effective_targets,
            scope=scope,
            layers=layers,
            ontologies=ontologies,
            checked_layer_ids=draft.checked_layer_ids,
            available_inputs=available_inputs,
            submissions=submissions,
            term_statuses=term_statuses,
            axes_definition=axes_profile.definition_name,
            axes_config=axes_profile.axes,
            axes_config_sha256=axes_profile.config_sha256,
        )
