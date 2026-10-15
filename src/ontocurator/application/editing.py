"""Annotation editing commands and application service."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from ontocurator.domain.annotations import (
    ActorKind,
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontocurator.domain.axes import Axes, validate_axes
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
    snapshot_evidence,
    validate_segments,
)
from ontocurator.domain.errors import AccessDenied, DomainError, RevisionConflict
from ontocurator.domain.profiles import (
    TaskProfile,
    resolve_layer,
    resolve_type,
)
from ontocurator.domain.scopes import TaskScope, build_scope
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.projects.runtime import project_state, require_state
from ontocurator.storage.repository import Repository


class CreateAnnotationCommand(BaseModel):
    """Command creating an annotation with optional evidence."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["create_annotation"] = "create_annotation"
    annotation_id: str
    term_id: str
    layer_id: str | None = None
    type_id: str | None = None
    search_event_id: str | None = None
    axes_values: dict[str, str | None] = Field(default_factory=dict)
    evidence_id: str | None = None
    segments: list[Segment] = Field(default_factory=list)
    label: str | None = None
    actor_kind: ActorKind = "human"
    # None: attributed to the annotator of the workspace the command is applied to.
    actor_id: str | None = None
    method: str = "manual"
    source_annotation_id: str | None = None
    source_version: str | None = None

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            has_term = "term_id" in d
            has_hpo = "hpo_id" in d
            if has_term and has_hpo:
                if d["term_id"] != d["hpo_id"]:
                    raise ValueError(
                        f"Conflicting 'term_id' ('{d['term_id']}') and "
                        f"'hpo_id' ('{d['hpo_id']}') provided"
                    )
                d.pop("hpo_id")
            elif has_hpo:
                d["term_id"] = d.pop("hpo_id")

            if "axes" in d and "axes_values" not in d:
                raw_axes = d.pop("axes")
                if isinstance(raw_axes, dict):
                    d["axes_values"] = raw_axes.get("values", raw_axes)
                elif hasattr(raw_axes, "values"):
                    d["axes_values"] = raw_axes.values
            return d
        return data

    @property
    def hpo_id(self) -> str:
        return self.term_id

    @hpo_id.setter
    def hpo_id(self, val: str) -> None:
        self.term_id = val

    @property
    def axes(self) -> Axes:
        return Axes(definition_name="custom", values=self.axes_values)


class SetTermCommand(BaseModel):
    """Command updating an annotation's ontology concept."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["set_term"] = "set_term"
    annotation_id: str
    term_id: str
    search_event_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            has_term = "term_id" in d
            has_hpo = "hpo_id" in d
            if has_term and has_hpo:
                if d["term_id"] != d["hpo_id"]:
                    raise ValueError(
                        f"Conflicting 'term_id' ('{d['term_id']}') and "
                        f"'hpo_id' ('{d['hpo_id']}') provided"
                    )
                d.pop("hpo_id")
            elif has_hpo:
                d["term_id"] = d.pop("hpo_id")
            return d
        return data

    @property
    def hpo_id(self) -> str:
        return self.term_id

    @hpo_id.setter
    def hpo_id(self, val: str) -> None:
        self.term_id = val


class SetAxesCommand(BaseModel):
    """Command updating clinical context axes."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["set_axes"] = "set_axes"
    annotation_id: str
    axes_values: dict[str, str | None] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            if "axes" in d and "axes_values" not in d:
                raw_axes = d.pop("axes")
                if isinstance(raw_axes, dict):
                    d["axes_values"] = raw_axes.get("values", raw_axes)
                elif hasattr(raw_axes, "values"):
                    d["axes_values"] = raw_axes.values
            return d
        return data

    @property
    def axes(self) -> Axes:
        return Axes(definition_name="custom", values=self.axes_values)


class AttachMentionCommand(BaseModel):
    """Command creating and attaching an evidence mention to an annotation."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["attach_mention"] = "attach_mention"
    annotation_id: str
    evidence_id: str
    segments: list[Segment]
    label: str | None = None


class EditMentionCommand(BaseModel):
    """Command updating mention segments with copy-on-write support."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["edit_mention"] = "edit_mention"
    evidence_id: str
    annotation_id: str | None = None
    segments: list[Segment]
    label: str | None = None


class DetachMentionCommand(BaseModel):
    """Command detaching an evidence mention from an annotation."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["detach_mention"] = "detach_mention"
    annotation_id: str
    evidence_id: str


class DeleteDraftAnnotationCommand(BaseModel):
    """Command deleting an annotation from the current draft."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["delete_draft_annotation"] = "delete_draft_annotation"
    annotation_id: str


class CheckLayerCommand(BaseModel):
    """Command toggling checked status for a specific layer."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["check_layer"] = "check_layer"
    layer_id: str
    checked: bool

    @model_validator(mode="before")
    @classmethod
    def handle_kind(cls, data: Any) -> Any:
        if isinstance(data, dict):
            d = dict(data)
            if "kind" in d and "command" not in d:
                d["command"] = d.pop("kind")
            return d
        return data


EditCommand = Annotated[
    CreateAnnotationCommand
    | SetTermCommand
    | SetAxesCommand
    | AttachMentionCommand
    | EditMentionCommand
    | DetachMentionCommand
    | DeleteDraftAnnotationCommand
    | CheckLayerCommand,
    Field(discriminator="command"),
]

_edit_adapter: TypeAdapter[EditCommand] = TypeAdapter(EditCommand)


class EditingService:
    """Coordinates command validation, mutation and atomic draft updates."""

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

    def parse_command(self, payload: dict[str, Any]) -> EditCommand:
        """Parse untyped mutation payload into typed EditCommand."""
        return _edit_adapter.validate_python(payload)

    def apply(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        """Transactionally execute an edit command against a workspace draft."""
        cmd = self.parse_command(envelope.payload)
        if isinstance(cmd, CreateAnnotationCommand):
            if cmd.actor_id is None:
                cmd = cmd.model_copy(update={"actor_id": key.annotator_id})
            elif cmd.actor_kind == "human" and cmd.actor_id != key.annotator_id:
                # A person annotates only as the workspace's annotator; a tool's
                # proposal names the tool.
                raise AccessDenied(
                    "IDENTITY_MISMATCH",
                    "A human annotation is attributed to the workspace's annotator.",
                )
        with self.repo.db.transaction() as conn:
            prepared_state = project_state(conn, key.project_key)
        doc = self.repo.get_document(key.project_key, key.document_id)
        if doc is None:
            raise DomainError(
                "DOCUMENT_NOT_FOUND",
                f"Document '{key.document_id}' not found in package '{key.project_key}'",
            )
        profile = self.repo.get_task_profile(key.project_key)
        scope = build_scope(profile, key.mode)

        if key.scope_id and key.scope_id != scope.scope_id:
            raise DomainError(
                "INVALID_SCOPE",
                f"Workspace scope_id '{key.scope_id}' does not match expected '{scope.scope_id}'",
            )

        services: dict[str, OntologyService | Exception] = {}
        preparation_error: RevisionConflict | None = None
        if isinstance(cmd, (CreateAnnotationCommand, SetTermCommand)):
            if self.registry is not None:
                try:
                    self.registry.ensure_package_conditions(self.repo, key.project_key)
                except RevisionConflict as exc:
                    # A known receipt must still replay if capture raced a
                    # structural edit. Reject fresh commands under the lock.
                    preparation_error = exc
                with self.repo.db.transaction() as conn:
                    conditions_state = project_state(conn, key.project_key)[1]
                prepared_state = (prepared_state[0], conditions_state)
            # Set-term's layer comes from the locked draft. Resolve all editable
            # layers first rather than trusting an unlocked draft read. Keep
            # strong references so LRU eviction cannot cause a build in operation.
            layers = scope.editable_layer_ids
            if isinstance(cmd, CreateAnnotationCommand):
                layers = []
                if cmd.layer_id is not None:
                    if cmd.layer_id in scope.editable_layer_ids:
                        layers = [cmd.layer_id]
                elif len(scope.editable_layer_ids) == 1:
                    layers = scope.editable_layer_ids
            for layer_id in layers:
                try:
                    services[layer_id] = self._get_service_for_layer(
                        key.project_key, layer_id
                    )
                except Exception as exc:
                    # Defer a resolution failure to the original validation
                    # point. Receipt replay and revision/layer/type checks must
                    # keep their precedence, and an unused layer cannot fail an edit.
                    services[layer_id] = exc

        def operation(draft: Draft) -> Draft:
            result = self._execute_edit(draft, cmd, doc, profile, scope, services)
            if (
                isinstance(cmd, (CreateAnnotationCommand, SetTermCommand))
                and cmd.search_event_id
            ):
                event = self.repo.get_search_event(cmd.search_event_id, key.project_key)
                # The layer the annotation has after this edit. Two layers can
                # share an ontology, so the candidates alone do not tell
                # whether the event was a search or a walk for this layer.
                layer_id = next(
                    (
                        snap.annotation.layer_id
                        for snap in result.annotations
                        if snap.annotation.annotation_id == cmd.annotation_id
                    ),
                    None,
                )
                if (
                    event is None
                    or event.workspace_key != key
                    or event.annotation_id != cmd.annotation_id
                    or event.layer_id != layer_id
                    or cmd.term_id not in event.candidates
                ):
                    raise DomainError(
                        "INVALID_SEARCH_SELECTION",
                        "Search selection does not match this workspace, "
                        "annotation, layer and candidate",
                    )
                event = event.model_copy(deep=True)
                event.source_search_event_id = cmd.search_event_id
                event.event_id = "selection-" + canonical_hash(
                    {
                        "workspace": key.model_dump(),
                        "mutation_id": envelope.mutation_id,
                        "query_event_id": cmd.search_event_id,
                    }
                )
                event.timestamp = datetime.now(UTC).isoformat()
                event.selected_term_id = cmd.term_id
                event.displayed_position = event.candidates.index(cmd.term_id) + 1
                event.ranked_position = (
                    event.ranked_ids.index(cmd.term_id) + 1
                    if cmd.term_id in event.ranked_ids
                    else None
                )
                self.repo.save_search_event(event)
            return result

        result = self.repo.run_mutation(
            key,
            envelope,
            operation,
            before_operation=lambda conn: require_state(
                conn, key.project_key, prepared_state, preparation_error
            ),
        )
        if not isinstance(result, Draft):
            raise ValueError(f"Expected Draft from run_mutation, got {type(result)}")
        return result

    apply_edit = apply

    def _execute_edit(
        self,
        draft: Draft,
        cmd: EditCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
        services: dict[str, OntologyService | Exception],
    ) -> Draft:
        if isinstance(cmd, CheckLayerCommand):
            return self._check_layer(draft, cmd, scope)
        if isinstance(cmd, CreateAnnotationCommand):
            return self._create_annotation(draft, cmd, doc, profile, scope, services)
        if isinstance(cmd, SetTermCommand):
            return self._set_term(draft, cmd, doc, profile, scope, services)
        if isinstance(cmd, SetAxesCommand):
            return self._set_axes(draft, cmd, doc, profile, scope)
        if isinstance(cmd, AttachMentionCommand):
            return self._attach_mention(draft, cmd, doc, profile, scope)
        if isinstance(cmd, EditMentionCommand):
            return self._edit_mention(draft, cmd, doc, profile, scope)
        if isinstance(cmd, DetachMentionCommand):
            return self._detach_mention(draft, cmd, doc, profile, scope)
        if isinstance(cmd, DeleteDraftAnnotationCommand):
            return self._delete_annotation(draft, cmd, scope)
        raise ValueError(f"Unhandled command: {cmd}")

    def _check_layer(
        self,
        draft: Draft,
        cmd: CheckLayerCommand,
        scope: TaskScope,
    ) -> Draft:
        if cmd.layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "INVALID_LAYER",
                f"Layer '{cmd.layer_id}' cannot be checked in this workspace",
            )
        if cmd.checked:
            draft.checked_layer_ids = sorted(
                list(set(draft.checked_layer_ids) | {cmd.layer_id})
            )
        else:
            draft.checked_layer_ids = [
                lid for lid in draft.checked_layer_ids if lid != cmd.layer_id
            ]
        return draft

    def _validate_term_for_layer(
        self,
        service: OntologyService | Exception,
        term_id: str,
    ) -> str:
        """Reject obsolete/unknown terms; return the primary term ID.

        Alternative (merged) IDs and case variants resolve to the primary ID,
        which is what gets stored.
        """
        if isinstance(service, Exception):
            raise service
        status = service.validate_term(term_id)
        if status.status == "obsolete":
            hint = f"; use '{status.replaced_by}' instead" if status.replaced_by else ""
            raise DomainError(
                "OBSOLETE_TERM",
                f"Term '{term_id}' is obsolete and cannot be newly created{hint}",
            )
        if status.status == "unknown":
            raise DomainError(
                "UNKNOWN_TERM",
                f"Term '{term_id}' is not present in the current ontology release",
            )
        return status.term_id

    def _primary_term_id(
        self, service: OntologyService | Exception, term_id: str
    ) -> str:
        """Primary ID for an alternative ID or case variant, without rejecting
        obsolete or unknown terms (adopted proposals may carry those)."""
        try:
            if isinstance(service, Exception):
                raise service
            status = service.validate_term(term_id)
        except DomainError:
            return term_id
        return term_id if status.status == "unknown" else status.term_id

    def _is_verified_adoption(
        self,
        draft: Draft,
        cmd: CreateAnnotationCommand,
        doc: Document,
        layer_id: str,
    ) -> bool:
        """True only if the cited source is an existing package proposal for this
        document, layer and exact term. Only then may an obsolete or unknown
        imported term be copied into the draft (it still blocks submission)."""
        if not cmd.source_annotation_id:
            return False
        for source in self.repo.list_annotations_for_document(
            draft.key.project_key, doc.document_id
        ):
            if (
                source.annotation.annotation_id == cmd.source_annotation_id
                and (cmd.source_version is None or source.version == cmd.source_version)
                and source.annotation.term_id == cmd.term_id
                and source.annotation.layer_id == layer_id
                and source.document_id == doc.document_id
            ):
                return True
        return False

    @staticmethod
    def _ensure_evidence_identity(
        draft: Draft, evidence_id: str, segments: list[Segment]
    ) -> EvidenceSnapshot | None:
        """An evidence ID names exactly one mention within a draft."""
        existing = next(
            (e for e in draft.evidence if e.mention.evidence_id == evidence_id),
            None,
        )
        if existing is not None and list(existing.mention.segments) != list(segments):
            raise DomainError(
                "EVIDENCE_ID_CONFLICT",
                f"Evidence '{evidence_id}' already exists with different segments; "
                "use edit_mention to change it or choose a new evidence_id",
            )
        return existing

    def _create_annotation(
        self,
        draft: Draft,
        cmd: CreateAnnotationCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
        services: dict[str, OntologyService | Exception],
    ) -> Draft:
        target_layer = cmd.layer_id
        if target_layer is None:
            if len(scope.editable_layer_ids) == 1:
                target_layer = scope.editable_layer_ids[0]
            else:
                raise DomainError(
                    "MISSING_LAYER",
                    "layer_id is required when multiple editable layers exist",
                )

        if target_layer in scope.reference_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Layer '{target_layer}' is reference-only and cannot be edited",
            )
        if target_layer not in scope.editable_layer_ids:
            raise DomainError(
                "UNKNOWN_LAYER",
                f"Layer '{target_layer}' is not in this workspace scope",
            )

        layer_def = resolve_layer(profile, target_layer)
        target_type = cmd.type_id
        if target_type is None:
            target_type = layer_def.default_type_id or (
                layer_def.annotation_types[0].type_id
                if layer_def.annotation_types
                else None
            )
            if target_type is None:
                raise DomainError(
                    "MISSING_TYPE", f"No type defined for layer '{target_layer}'"
                )

        type_def = resolve_type(profile, target_layer, target_type)

        if self._is_verified_adoption(draft, cmd, doc, target_layer):
            # Store the primary ID like a normal creation; provenance still
            # points at the adopted source annotation.
            term_id = self._primary_term_id(services[target_layer], cmd.term_id)
        else:
            term_id = self._validate_term_for_layer(services[target_layer], cmd.term_id)

        if any(
            a.annotation.annotation_id == cmd.annotation_id for a in draft.annotations
        ):
            raise DomainError(
                "DUPLICATE_ANNOTATION_ID",
                f"Annotation '{cmd.annotation_id}' already exists in current draft",
            )

        try:
            validate_axes(cmd.axes_values, type_def.axes, complete=False)
        except ValueError as exc:
            raise DomainError("INVALID_AXES", str(exc)) from exc

        evidence_list: list[EvidenceSnapshot] = []
        evidence_refs: list[EvidenceRef] = []

        if cmd.segments:
            validate_segments(doc.text, cmd.segments)
            mention_id = cmd.evidence_id or f"ev-{cmd.annotation_id}"
            self._ensure_evidence_identity(draft, mention_id, cmd.segments)
            mention = EvidenceMention(
                evidence_id=mention_id,
                segments=cmd.segments,
            )
            ev_snap = snapshot_evidence(mention, doc)
            evidence_list.append(ev_snap)
            evidence_refs.append(
                EvidenceRef(evidence_id=mention_id, version=ev_snap.version)
            )
            draft.evidence = [
                e for e in draft.evidence if e.mention.evidence_id != mention_id
            ] + [ev_snap]

        source_refs: list[str] = []
        if cmd.source_annotation_id and cmd.source_version:
            source_refs = [f"{cmd.source_annotation_id}:{cmd.source_version}"]

        assert cmd.actor_id is not None  # defaulted to the annotator by apply()
        prov = Provenance(
            actor=ActorRef(actor_id=cmd.actor_id, kind=cmd.actor_kind),
            method=cmd.method,
            source_refs=source_refs,
        )
        ann = Annotation(
            annotation_id=cmd.annotation_id,
            document_id=doc.document_id,
            layer_id=target_layer,
            type_id=target_type,
            term_id=term_id,
            axes_values=cmd.axes_values,
            evidence_refs=evidence_refs,
            provenance=prov,
        )
        snap = snapshot(ann, evidence_list, doc, profile)
        draft.annotations = [
            a
            for a in draft.annotations
            if a.annotation.annotation_id != cmd.annotation_id
        ] + [snap]
        # Invalidate checked status for this layer
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != target_layer
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, snap)
        return draft

    def _set_term(
        self,
        draft: Draft,
        cmd: SetTermCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
        services: dict[str, OntologyService | Exception],
    ) -> Draft:
        existing = next(
            (
                a
                for a in draft.annotations
                if a.annotation.annotation_id == cmd.annotation_id
            ),
            None,
        )
        if existing is None:
            raise DomainError(
                "ANNOTATION_NOT_FOUND",
                f"Annotation '{cmd.annotation_id}' not found in current draft",
            )
        layer_id = existing.annotation.layer_id
        if layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Annotation '{cmd.annotation_id}' belongs to reference layer '{layer_id}'",
            )

        term_id = self._validate_term_for_layer(services[layer_id], cmd.term_id)
        updated_ann = existing.annotation.model_copy(update={"term_id": term_id})
        new_snap = snapshot(updated_ann, existing.evidence, doc, profile)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != layer_id
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _set_axes(
        self,
        draft: Draft,
        cmd: SetAxesCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
    ) -> Draft:
        existing = next(
            (
                a
                for a in draft.annotations
                if a.annotation.annotation_id == cmd.annotation_id
            ),
            None,
        )
        if existing is None:
            raise DomainError(
                "ANNOTATION_NOT_FOUND",
                f"Annotation '{cmd.annotation_id}' not found in current draft",
            )
        layer_id = existing.annotation.layer_id
        type_id = existing.annotation.type_id
        if layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Annotation '{cmd.annotation_id}' belongs to reference layer '{layer_id}'",
            )

        type_def = resolve_type(profile, layer_id, type_id)
        try:
            validate_axes(cmd.axes_values, type_def.axes, complete=False)
        except ValueError as exc:
            raise DomainError("INVALID_AXES", str(exc)) from exc

        updated_ann = existing.annotation.with_axes(cmd.axes_values)
        new_snap = snapshot(updated_ann, existing.evidence, doc, profile)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != layer_id
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _attach_mention(
        self,
        draft: Draft,
        cmd: AttachMentionCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
    ) -> Draft:
        validate_segments(doc.text, cmd.segments)
        existing = next(
            (
                a
                for a in draft.annotations
                if a.annotation.annotation_id == cmd.annotation_id
            ),
            None,
        )
        if existing is None:
            raise DomainError(
                "ANNOTATION_NOT_FOUND",
                f"Annotation '{cmd.annotation_id}' not found in current draft",
            )
        layer_id = existing.annotation.layer_id
        if layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Annotation '{cmd.annotation_id}' belongs to reference layer '{layer_id}'",
            )

        ev_snap = self._ensure_evidence_identity(draft, cmd.evidence_id, cmd.segments)
        if ev_snap is None:
            mention = EvidenceMention(
                evidence_id=cmd.evidence_id,
                segments=cmd.segments,
            )
            ev_snap = snapshot_evidence(mention, doc)
            draft.evidence.append(ev_snap)

        new_ref = EvidenceRef(evidence_id=cmd.evidence_id, version=ev_snap.version)
        new_refs = [
            r
            for r in existing.annotation.evidence_refs
            if r.evidence_id != cmd.evidence_id
        ] + [new_ref]
        new_ev_list = [
            e for e in existing.evidence if e.mention.evidence_id != cmd.evidence_id
        ] + [ev_snap]

        updated_ann = existing.annotation.model_copy(update={"evidence_refs": new_refs})
        new_snap = snapshot(updated_ann, new_ev_list, doc, profile)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != layer_id
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _edit_mention(
        self,
        draft: Draft,
        cmd: EditMentionCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
    ) -> Draft:
        validate_segments(doc.text, cmd.segments)

        referencing = [
            a
            for a in draft.annotations
            if any(r.evidence_id == cmd.evidence_id for r in a.annotation.evidence_refs)
        ]

        if cmd.annotation_id and not any(
            a.annotation.annotation_id == cmd.annotation_id for a in referencing
        ):
            raise DomainError(
                "EVIDENCE_NOT_ATTACHED",
                f"Evidence '{cmd.evidence_id}' is not attached to annotation "
                f"'{cmd.annotation_id}'",
            )
        if not cmd.annotation_id and len(referencing) > 1:
            raise DomainError(
                "SHARED_EVIDENCE_REQUIRES_ANNOTATION",
                f"Evidence '{cmd.evidence_id}' is shared by "
                f"{len(referencing)} annotations; specify annotation_id to edit it "
                "for one annotation (copy-on-write)",
            )

        if cmd.annotation_id and len(referencing) > 1:
            # Copy-on-write for the selected target annotation. A random ID
            # cannot collide with any evidence ID already in the draft.
            new_ev_id = f"{cmd.evidence_id}-cow-{uuid4().hex}"
            mention = EvidenceMention(
                evidence_id=new_ev_id,
                segments=cmd.segments,
            )
            new_ev_snap = snapshot_evidence(mention, doc)
            draft.evidence.append(new_ev_snap)

            target = next(
                (
                    a
                    for a in draft.annotations
                    if a.annotation.annotation_id == cmd.annotation_id
                ),
                None,
            )
            if target:
                layer_id = target.annotation.layer_id
                if layer_id not in scope.editable_layer_ids:
                    raise DomainError(
                        "REFERENCE_LAYER_READ_ONLY",
                        f"Annotation belongs to reference layer '{layer_id}'",
                    )
                new_refs = [
                    r
                    for r in target.annotation.evidence_refs
                    if r.evidence_id != cmd.evidence_id
                ] + [EvidenceRef(evidence_id=new_ev_id, version=new_ev_snap.version)]
                new_ev_list = [
                    e
                    for e in target.evidence
                    if e.mention.evidence_id != cmd.evidence_id
                ] + [new_ev_snap]
                updated_ann = target.annotation.model_copy(
                    update={"evidence_refs": new_refs}
                )
                new_snap = snapshot(updated_ann, new_ev_list, doc, profile)
                draft.annotations = [
                    a if a.annotation.annotation_id != cmd.annotation_id else new_snap
                    for a in draft.annotations
                ]
                draft.checked_layer_ids = [
                    lid for lid in draft.checked_layer_ids if lid != layer_id
                ]
                self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        else:
            # In-place update of mention
            mention = EvidenceMention(
                evidence_id=cmd.evidence_id,
                segments=cmd.segments,
            )
            new_ev_snap = snapshot_evidence(mention, doc)
            draft.evidence = [
                e for e in draft.evidence if e.mention.evidence_id != cmd.evidence_id
            ] + [new_ev_snap]

            affected_layers: set[str] = set()
            updated_annotations = []
            for snap_item in draft.annotations:
                if any(
                    r.evidence_id == cmd.evidence_id
                    for r in snap_item.annotation.evidence_refs
                ):
                    layer_id = snap_item.annotation.layer_id
                    if layer_id not in scope.editable_layer_ids:
                        raise DomainError(
                            "REFERENCE_LAYER_READ_ONLY",
                            f"Annotation belongs to reference layer '{layer_id}'",
                        )
                    affected_layers.add(layer_id)
                    new_refs = [
                        r
                        if r.evidence_id != cmd.evidence_id
                        else EvidenceRef(
                            evidence_id=cmd.evidence_id,
                            version=new_ev_snap.version,
                        )
                        for r in snap_item.annotation.evidence_refs
                    ]
                    new_ev_list = [
                        e if e.mention.evidence_id != cmd.evidence_id else new_ev_snap
                        for e in snap_item.evidence
                    ]
                    updated_ann = snap_item.annotation.model_copy(
                        update={"evidence_refs": new_refs}
                    )
                    updated_snap = snapshot(updated_ann, new_ev_list, doc, profile)
                    updated_annotations.append(updated_snap)
                    self._update_decision_replacements(
                        draft, snap_item.annotation.annotation_id, updated_snap
                    )
                else:
                    updated_annotations.append(snap_item)
            draft.annotations = updated_annotations
            draft.checked_layer_ids = [
                lid for lid in draft.checked_layer_ids if lid not in affected_layers
            ]

        return draft

    def _detach_mention(
        self,
        draft: Draft,
        cmd: DetachMentionCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
    ) -> Draft:
        target = next(
            (
                a
                for a in draft.annotations
                if a.annotation.annotation_id == cmd.annotation_id
            ),
            None,
        )
        if target is None:
            raise DomainError(
                "ANNOTATION_NOT_FOUND",
                f"Annotation '{cmd.annotation_id}' not found",
            )
        layer_id = target.annotation.layer_id
        if layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Annotation belongs to reference layer '{layer_id}'",
            )

        new_refs = [
            r
            for r in target.annotation.evidence_refs
            if r.evidence_id != cmd.evidence_id
        ]
        new_ev_list = [
            e for e in target.evidence if e.mention.evidence_id != cmd.evidence_id
        ]
        updated_ann = target.annotation.model_copy(update={"evidence_refs": new_refs})
        new_snap = snapshot(updated_ann, new_ev_list, doc, profile)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != layer_id
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _delete_annotation(
        self,
        draft: Draft,
        cmd: DeleteDraftAnnotationCommand,
        scope: TaskScope,
    ) -> Draft:
        target = next(
            (
                a
                for a in draft.annotations
                if a.annotation.annotation_id == cmd.annotation_id
            ),
            None,
        )
        if target:
            layer_id = target.annotation.layer_id
            if layer_id not in scope.editable_layer_ids:
                raise DomainError(
                    "REFERENCE_LAYER_READ_ONLY",
                    f"Annotation belongs to reference layer '{layer_id}'",
                )
            draft.checked_layer_ids = [
                lid for lid in draft.checked_layer_ids if lid != layer_id
            ]

        draft.annotations = [
            a
            for a in draft.annotations
            if a.annotation.annotation_id != cmd.annotation_id
        ]
        draft.decisions = [
            d
            for d in draft.decisions
            if not (d.replacement and d.replacement.annotation_id == cmd.annotation_id)
        ]
        active_ev_ids = {
            r.evidence_id for a in draft.annotations for r in a.annotation.evidence_refs
        }
        draft.evidence = [
            e for e in draft.evidence if e.mention.evidence_id in active_ev_ids
        ]
        return draft

    def _update_decision_replacements(
        self,
        draft: Draft,
        annotation_id: str,
        new_snap: AnnotationSnapshot,
    ) -> None:
        """Editing an approved replacement requires a fresh review decision."""
        draft.decisions = [
            dec
            for dec in draft.decisions
            if not (
                dec.replacement
                and dec.replacement.annotation_id == annotation_id
                and dec.replacement.version != new_snap.version
            )
        ]


EditorService = EditingService
