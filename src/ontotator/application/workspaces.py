"""Workspace application service and view models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ontotator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontotator.domain.axes import AxisDefinition
from ontotator.domain.axis_visibility import editor_profile, legacy_axes_config
from ontotator.domain.documents import Document
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import (
    LayerDefinition,
    OntologyDefinition,
    resolve_layer,
    resolve_ontology,
)
from ontotator.domain.proposals import ProposalSetView
from ontotator.domain.reanchor_resolution import ReanchorItem
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.scopes import TaskScope, build_scope, is_review_like
from ontotator.domain.workspace import (
    Draft,
    Submission,
    WorkspaceKey,
    WorkspaceMode,
)
from ontotator.ontology.modifiers import modifier_layers
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService
from ontotator.storage.proposal_queries import newest_proposal_refs
from ontotator.storage.repository import Repository


class DocumentSummary(BaseModel):
    """Metadata-only summary of a document in a package."""

    model_config = ConfigDict(extra="forbid")

    document_id: str
    language: str
    text_length: int
    position: int
    status: Literal["not_started", "in_progress", "completed"] = "not_started"
    # Only set when listing for review mode: whether the document has proposals to
    # review. A boolean, never a count, and None in the other (blinded) modes.
    has_review_inputs: bool | None = None


class EditorProposal(AnnotationSnapshot):
    """Editor projection; producer metadata never changes snapshot hashes."""

    proposal_set_id: int | None = None
    notes: list[str] = Field(default_factory=list)


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
    available_inputs: list[EditorProposal] = Field(default_factory=list)
    proposal_sets: list[ProposalSetView] = Field(default_factory=list)
    submissions: list[Submission] = Field(default_factory=list)
    term_statuses: dict[str, Literal["valid", "obsolete", "unknown"]] = Field(
        default_factory=dict
    )
    pending_reanchor_items: list[ReanchorItem] = Field(default_factory=list)
    enforce_spanless_rules: bool = False
    allow_spanless_findings: bool = True
    require_spanless_note: bool = True
    require_chosen_axes: bool = False
    creation_defaults: dict[str, dict[str, dict[str, str]]] = Field(
        default_factory=dict
    )
    annotation_policy_revision: int = 1
    axes_definition: str = "editor-axes/v1"
    axes_config: list[AxisDefinition] = Field(default_factory=list)
    axes_config_sha256: str = ""
    # Layers whose pin has the T1 profile ``hpo-phenotype``: only there a
    # finding has modifiers.
    modifier_layer_ids: list[str] = Field(default_factory=list)


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
        self, project_key: str, layer_id: str
    ) -> OntologyService:
        if self.registry is not None:
            return self.registry.for_package_layer(self.repo, project_key, layer_id)
        if self.ontology is not None:
            return self.ontology
        raise DomainError(
            "ONTOLOGY_NOT_FOUND",
            f"No ontology service configured for layer '{layer_id}'",
        )

    def list_documents(
        self,
        project_key: str,
        annotator_id: str | None = None,
        mode: str | None = None,
        reveal_review_inputs: bool = False,
    ) -> list[DocumentSummary]:
        """List documents showing only metadata, without proposal counts.

        With ``reveal_review_inputs`` each summary tells whether the document has
        review proposals; callers must only request this for review mode.
        """
        docs = self.repo.list_documents(project_key)
        if not docs:
            return []
        statuses = (
            self.repo.get_document_statuses(project_key, annotator_id, mode)
            if annotator_id and mode
            else {}
        )
        review_documents = (
            self.repo.review_input_document_ids(project_key)
            if reveal_review_inputs
            else set()
        )
        summaries: list[DocumentSummary] = []
        for idx, d in enumerate(docs, start=1):
            summaries.append(
                DocumentSummary(
                    document_id=d.document_id,
                    language=d.language,
                    text_length=len(d.text),
                    position=idx,
                    status=statuses.get(d.document_id, "not_started"),
                    has_review_inputs=(
                        d.document_id in review_documents
                        if reveal_review_inputs
                        else None
                    ),
                )
            )
        return summaries

    def get_document(self, project_key: str, document_id: str) -> Document:
        """Fetch a document or raise DomainError."""
        doc = self.repo.get_document(project_key, document_id)
        if doc is None:
            raise DomainError(
                "DOCUMENT_NOT_FOUND",
                f"Document '{document_id}' not found in package '{project_key}'",
            )
        return doc

    def get_review_inputs(
        self, project_key: str, document_id: str, mode: WorkspaceMode = "review"
    ) -> list[EditorProposal]:
        """The document's proposals on the layers a review may edit.

        Never other members' submissions or drafts: anything not assigned to
        a reviewer could bias them (index Q3). Their work reaches review only
        through workflow assignments (T4). ``proposal_check`` offers only the
        newest tool proposal set (spec 2026-10-23 §1 Targets).
        """
        profile = self.repo.get_task_profile(project_key)
        scope = build_scope(profile, mode)
        snapshots = self.repo.list_annotations_for_document(project_key, document_id)
        if mode == "proposal_check":
            newest = self._newest_refs(project_key, document_id)
            snapshots = [
                snap
                for snap in snapshots
                if (snap.annotation.annotation_id, snap.version) in newest
            ]
        return self._editor_proposals(
            project_key,
            document_id,
            [
                snap
                for snap in snapshots
                if snap.annotation.layer_id in scope.editable_layer_ids
            ],
        )

    def _newest_refs(self, project_key: str, document_id: str) -> set[tuple[str, str]]:
        with self.repo.db.transaction() as conn:
            project_id = self.repo._require_project(conn, project_key)
            return {
                (ref.annotation_id, ref.version)
                for ref in newest_proposal_refs(conn, project_id, document_id)
            }

    def _editor_proposals(
        self, project_key: str, document_id: str, snapshots: list[AnnotationSnapshot]
    ) -> list[EditorProposal]:
        metadata = (
            self.repo.proposal_metadata(project_key, document_id) if snapshots else {}
        )
        return [
            EditorProposal(
                **snap.model_dump(),
                **metadata.get((snap.annotation.annotation_id, snap.version), {}),
            )
            for snap in snapshots
        ]

    def open(
        self,
        key: WorkspaceKey,
        targets: ReviewTargetSet | None = None,
        pending_proposal_set_ids: list[int] | None = None,
    ) -> WorkspaceView:
        """Open or initialize a workspace view."""
        if (
            is_review_like(key.mode)
            and key.round_id is None
            and targets is not None
            and pending_proposal_set_ids is None
        ):
            raise DomainError("REANCHOR_PENDING_SELECTION_REQUIRED")
        doc = self.get_document(key.project_key, key.document_id)
        profile = self.repo.get_task_profile(key.project_key)
        scope = build_scope(profile, key.mode)

        if key.scope_id and key.scope_id != scope.scope_id:
            raise DomainError(
                "INVALID_SCOPE",
                f"Workspace scope_id '{key.scope_id}' does not match expected '{scope.scope_id}'",
            )
        if not key.scope_id:
            key = key.model_copy(update={"scope_id": scope.scope_id})

        accessible_layer_ids = scope.editable_layer_ids + scope.reference_layer_ids
        visible_profile = editor_profile(
            profile, self.repo.get_project_rules(key.project_key)
        )
        layers = [resolve_layer(visible_profile, lid) for lid in accessible_layer_ids]
        ont_ids = {layer.ontology_id for layer in layers}
        ontologies = [resolve_ontology(profile, oid) for oid in sorted(ont_ids)]

        term_statuses: dict[str, Literal["valid", "obsolete", "unknown"]] = {}

        if key.round_id is not None:
            round_view = self.repo.get_work_round(key.project_key, key.round_id)
            if round_view.workspace_key != key:
                raise DomainError("ROUND_KEY_MISMATCH")
            effective_targets = self.repo.open_draft(key).targets
            available_inputs = (
                self.repo.workspace_input_snapshots(key)
                if key.mode != "independent"
                else []
            )
        elif key.mode == "independent":
            effective_targets = ReviewTargetSet.create([])
            available_inputs = []
        else:
            # review-like modes (review, proposal_check)
            if targets is not None:
                # Client targets of a proposal check stay within the newest set.
                if key.mode == "proposal_check" and not {
                    (t.annotation_id, t.version) for t in targets.targets
                } <= self._newest_refs(key.project_key, key.document_id):
                    raise DomainError(
                        "INVALID_TARGET_SET",
                        "Targets must belong to the newest proposal set",
                    )
                effective_targets = targets
            else:
                rounds = [
                    k
                    for k in self.repo.list_workspace_keys(
                        key.project_key, key.annotator_id, key.mode, key.document_id
                    )
                    if k.document_id == key.document_id and k.scope_id == key.scope_id
                ]
                if key.target_set_id != "targets-0":
                    rounds = [k for k in rounds if k.target_set_id == key.target_set_id]
                    if not rounds:
                        raise DomainError(
                            "REVIEW_ROUND_NOT_FOUND",
                            "Selected review round is unavailable",
                        )
                if len(rounds) > 1:
                    raise DomainError(
                        "AMBIGUOUS_REVIEW_ROUND",
                        {
                            "message": "Select the review round to resume",
                            "rounds": [k.target_set_id for k in rounds],
                        },
                    )
                if rounds:
                    key = rounds[0]
                    effective_targets = self.repo.open_draft(
                        key, pending_proposal_set_ids=pending_proposal_set_ids
                    ).targets
                else:
                    effective_targets = ReviewTargetSet.create(
                        [
                            AnnotationRef(
                                annotation_id=s.annotation.annotation_id,
                                version=s.version,
                            )
                            for s in self.get_review_inputs(
                                key.project_key, key.document_id, key.mode
                            )
                        ]
                    )
                    key = key.model_copy(
                        update={"target_set_id": effective_targets.target_set_id}
                    )
            all_inputs = self.repo.list_annotations_for_document(
                key.project_key, key.document_id
            )
            available_inputs = [
                s
                for s in all_inputs
                if s.annotation.layer_id
                in (scope.editable_layer_ids + scope.reference_layer_ids)
            ]
            if key.mode == "proposal_check":
                # Older sets' proposals stay out, as on the round path; the
                # newest set's reference-layer proposals stay as context.
                wanted = {
                    (t.annotation_id, t.version) for t in effective_targets.targets
                }
                newest = self._newest_refs(key.project_key, key.document_id)
                available_inputs = [
                    s
                    for s in available_inputs
                    if (s.annotation.annotation_id, s.version) in wanted
                    or (
                        s.annotation.layer_id not in scope.editable_layer_ids
                        and (s.annotation.annotation_id, s.version) in newest
                    )
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
            # Work submitted before the project moved to another release
            # carries that release's digest (#81).
            superseded = (
                self.repo.superseded_pins(key.project_key) if canonical.targets else {}
            )
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
                if snap.ontology_sha256 != ont.sha256 and (
                    snap.ontology_sha256 not in superseded.get(layer.ontology_id, set())
                ):
                    raise DomainError(
                        "INVALID_REVIEW_TARGET",
                        "Review target ontology SHA-256 does not match configured layer ontology",
                    )

        draft = self.repo.open_draft(key, effective_targets, pending_proposal_set_ids)

        for a in available_inputs:
            tid = a.annotation.term_id
            lid = a.annotation.layer_id
            st_key = f"{lid}:{tid}"
            if st_key not in term_statuses:
                service = self._get_service_for_layer(key.project_key, lid)
                term_statuses[st_key] = service.validate_term(tid).status

        for snap in draft.annotations:
            st_key = f"{snap.annotation.layer_id}:{snap.annotation.term_id}"
            if st_key not in term_statuses:
                service = self._get_service_for_layer(
                    key.project_key, snap.annotation.layer_id
                )
                term_statuses[st_key] = service.validate_term(
                    snap.annotation.term_id
                ).status

        submissions = self.repo.get_submissions_for_workspace(key)
        axes_profile = legacy_axes_config(visible_profile)

        editor_inputs = self._editor_proposals(
            key.project_key, key.document_id, available_inputs
        )
        offered = [
            (snap.annotation.annotation_id, snap.version, snap.proposal_set_id)
            for snap in editor_inputs
            if snap.proposal_set_id is not None
        ]
        proposal_sets = [
            ProposalSetView.model_validate(row)
            for row in self.repo.workspace_proposal_sets(key, offered)
        ]
        rules = self.repo.get_project_rules(key.project_key)
        return WorkspaceView(
            pending_reanchor_items=self.repo.workspace_reanchor_items(draft),
            enforce_spanless_rules=draft.spanless_policy_version == 1,
            allow_spanless_findings=rules.allow_spanless_findings,
            require_spanless_note=rules.require_spanless_note,
            require_chosen_axes=rules.require_chosen_axes,
            creation_defaults={
                layer: {kind: dict(values) for kind, values in kinds.items()}
                for layer, kinds in rules.creation_defaults.items()
            },
            annotation_policy_revision=rules.annotation_policy_revision,
            key=key,
            document=doc,
            draft=draft,
            targets=effective_targets,
            scope=scope,
            layers=layers,
            ontologies=ontologies,
            checked_layer_ids=draft.checked_layer_ids,
            available_inputs=editor_inputs,
            proposal_sets=proposal_sets,
            submissions=submissions,
            term_statuses=term_statuses,
            axes_definition=axes_profile.definition_name,
            axes_config=axes_profile.axes,
            axes_config_sha256=axes_profile.config_sha256,
            modifier_layer_ids=modifier_layers(
                profile, self.repo.project_pins(key.project_key)
            ),
        )
