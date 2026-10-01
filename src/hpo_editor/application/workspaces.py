"""Workspace application service and view models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.documents import Document
from hpo_editor.domain.errors import DomainError
from hpo_editor.domain.review import ReviewTargetSet
from hpo_editor.domain.workspace import Draft, Submission, WorkspaceKey
from hpo_editor.ontology.service import OntologyService
from hpo_editor.storage.repository import Repository


class DocumentSummary(BaseModel):
    """Metadata-only summary of a document in a package."""

    model_config = ConfigDict(extra="forbid")

    document_id: str
    language: str
    text_length: int


class WorkspaceView(BaseModel):
    """Loaded view of a workspace including document, draft and submissions."""

    model_config = ConfigDict(extra="forbid")

    key: WorkspaceKey
    document: Document
    draft: Draft
    targets: ReviewTargetSet
    available_inputs: list[AnnotationSnapshot] = Field(default_factory=list)
    submissions: list[Submission] = Field(default_factory=list)


class WorkspaceService:
    """Coordinates workspace opening, document summaries and input selection."""

    def __init__(self, repo: Repository, ontology: OntologyService) -> None:
        self.repo = repo
        self.ontology = ontology

    def list_documents(self, package_id: str) -> list[DocumentSummary]:
        """List documents showing only metadata, without proposal counts."""
        docs = self.repo.list_documents(package_id)
        return [
            DocumentSummary(
                document_id=d.document_id,
                language=d.language,
                text_length=len(d.text),
            )
            for d in docs
        ]

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
        """Fetch historical annotations available for review setup."""
        return self.repo.list_annotations_for_document(package_id, document_id)

    def open(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> WorkspaceView:
        """Open or initialize a workspace view."""
        doc = self.get_document(key.package_id, key.document_id)

        if key.mode == "independent":
            effective_targets = ReviewTargetSet.create([])
            available_inputs: list[AnnotationSnapshot] = []
        else:
            if targets is not None:
                effective_targets = targets
            else:
                existing_draft = self.repo.open_draft(key)
                effective_targets = existing_draft.targets
            available_inputs = self.get_review_inputs(key.package_id, key.document_id)

        draft = self.repo.open_draft(key, effective_targets)
        submissions = self.repo.get_submissions_for_workspace(key)

        return WorkspaceView(
            key=key,
            document=doc,
            draft=draft,
            targets=effective_targets,
            available_inputs=available_inputs,
            submissions=submissions,
        )
