"""Annotation editing commands and application service."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from ontotator.domain.annotations import (
    ActorKind,
    ActorRef,
    Annotation,
    AnnotationRef,
    AnnotationSnapshot,
    Modifier,
    Provenance,
    snapshot,
)
from ontotator.domain.axes import Axes, validate_axes
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
    snapshot_evidence,
    validate_segments,
)
from ontotator.domain.errors import AccessDenied, DomainError, RevisionConflict
from ontotator.domain.profiles import (
    TaskProfile,
    resolve_layer,
    resolve_type,
)
from ontotator.domain.project_rules import ProjectRules, rule_violations
from ontotator.domain.reanchor_resolution import PendingReanchorRef
from ontotator.domain.review import ReviewDecision
from ontotator.domain.scopes import TaskScope, build_scope, is_review_like
from ontotator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontotator.exchange.t1 import Pin
from ontotator.ontology.modifiers import (
    ModifierClassifier,
    classifier_of,
    finding_roots,
    modifier_layers,
    subtree,
)
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService
from ontotator.projects.runtime import project_state, require_state
from ontotator.storage.repository import Repository


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
    chosen_axis_ids: list[str] | None = None
    evidence_id: str | None = None
    segments: list[Segment] = Field(default_factory=list)
    note: str | None = None
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


class RecreateReanchorCommand(BaseModel):
    """Author current-text evidence against a verified frozen predecessor finding."""

    model_config = ConfigDict(extra="forbid")
    command: Literal["recreate_reanchor"] = "recreate_reanchor"
    item: PendingReanchorRef
    annotation_id: str
    evidence_id: str
    term_id: str
    layer_id: str
    type_id: str
    axes_values: dict[str, str | None] = Field(default_factory=dict)
    segments: list[Segment] = Field(min_length=1)


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


class SetAnnotationNoteCommand(BaseModel):
    """Set or clear an annotation justification in a new draft version."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["set_annotation_note"] = "set_annotation_note"
    annotation_id: str
    note: str | None


class SetAxesCommand(BaseModel):
    """Command updating clinical context axes."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["set_axes"] = "set_axes"
    annotation_id: str
    axes_values: dict[str, str | None] = Field(default_factory=dict)
    chosen_axis_ids: list[str] = Field(default_factory=list)

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


class AddModifierCommand(BaseModel):
    """Add a modifier to a finding; segments of a spanless existing one are linked."""

    model_config = ConfigDict(extra="forbid")
    command: Literal["add_modifier"] = "add_modifier"
    annotation_id: str
    term_id: str
    segments: list[Segment] = Field(default_factory=list)


class SetModifierSegmentsCommand(BaseModel):
    """Link (replace) or, with ``[]``, remove a modifier's text span."""

    model_config = ConfigDict(extra="forbid")
    command: Literal["set_modifier_segments"] = "set_modifier_segments"
    annotation_id: str
    term_id: str
    segments: list[Segment]


class RemoveModifierCommand(BaseModel):
    """Remove a modifier from a finding."""

    model_config = ConfigDict(extra="forbid")
    command: Literal["remove_modifier"] = "remove_modifier"
    annotation_id: str
    term_id: str


class ConvertToModifierCommand(BaseModel):
    """Old data (R3): a standalone modifier finding becomes a modifier of another."""

    model_config = ConfigDict(extra="forbid")
    command: Literal["convert_to_modifier"] = "convert_to_modifier"
    annotation_id: str
    target_annotation_id: str
    link_span: bool = True


ModifierCommand = (
    AddModifierCommand
    | SetModifierSegmentsCommand
    | RemoveModifierCommand
    | ConvertToModifierCommand
)
MODIFIER_COMMANDS = (
    AddModifierCommand,
    SetModifierSegmentsCommand,
    RemoveModifierCommand,
    ConvertToModifierCommand,
)

EditCommand = Annotated[
    CreateAnnotationCommand
    | RecreateReanchorCommand
    | SetTermCommand
    | SetAnnotationNoteCommand
    | SetAxesCommand
    | AttachMentionCommand
    | EditMentionCommand
    | DetachMentionCommand
    | DeleteDraftAnnotationCommand
    | CheckLayerCommand
    | AddModifierCommand
    | SetModifierSegmentsCommand
    | RemoveModifierCommand
    | ConvertToModifierCommand,
    Field(discriminator="command"),
]

_edit_adapter: TypeAdapter[EditCommand] = TypeAdapter(EditCommand)


def remove_draft_annotation(draft: Draft, annotation_id: str) -> None:
    """Remove a finding, replacement decisions naming it and orphaned evidence; unchecks its layer."""
    target = next(
        (a for a in draft.annotations if a.annotation.annotation_id == annotation_id),
        None,
    )
    if target:
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != target.annotation.layer_id
        ]
    draft.annotations = [
        a for a in draft.annotations if a.annotation.annotation_id != annotation_id
    ]
    draft.decisions = [
        d
        for d in draft.decisions
        if not (d.replacement and d.replacement.annotation_id == annotation_id)
    ]
    active = {
        r.evidence_id for a in draft.annotations for r in a.annotation.evidence_refs
    }
    draft.evidence = [e for e in draft.evidence if e.mention.evidence_id in active]


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
        pins: Mapping[str, Pin] | None = None
        if isinstance(
            cmd,
            (
                CreateAnnotationCommand,
                RecreateReanchorCommand,
                SetTermCommand,
                *MODIFIER_COMMANDS,
            ),
        ):
            # Read once, outside the mutation: R2 needs the layer's pin.
            pins = self.repo.project_pins(key.project_key)
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
            if isinstance(cmd, (CreateAnnotationCommand, RecreateReanchorCommand)):
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
            previous_refs = {
                (s.annotation.annotation_id, s.version) for s in draft.annotations
            }
            result = self._execute_edit(
                draft, cmd, doc, profile, scope, services, pins=pins
            )
            current_refs = {
                (s.annotation.annotation_id, s.version) for s in result.annotations
            }
            result.reanchor_resolutions = [
                resolution
                for resolution in result.reanchor_resolutions
                if resolution.replacement is None
                or (
                    resolution.replacement.annotation_id,
                    resolution.replacement.version,
                )
                in current_refs
            ]
            if draft.spanless_policy_version == 1:
                changed = [
                    s
                    for s in result.annotations
                    if (s.annotation.annotation_id, s.version) not in previous_refs
                ]
                # #124: the task profile wins over the project setting. A new
                # or changed finding of a span-required type cannot be saved
                # without a text span; unchanged ones (saved before) stay as
                # they are and the submit check still flags them.
                for item in changed:
                    annotation = item.annotation
                    if (
                        not annotation.evidence_refs
                        and resolve_type(
                            profile, annotation.layer_id, annotation.type_id
                        ).evidence_policy
                        == "required_on_complete"
                    ):
                        raise DomainError(
                            "MISSING_EVIDENCE",
                            f"Annotation '{annotation.annotation_id}' in layer "
                            f"'{annotation.layer_id}' requires a text span: "
                            "select supporting text first",
                        )
                rules = self.repo.get_project_rules(key.project_key)
                violations = rule_violations(
                    changed,
                    {
                        (e.mention.evidence_id, e.version): e
                        for s in changed
                        for e in s.evidence
                    },
                    profile,
                    ProjectRules(
                        allow_spanless_findings=rules.allow_spanless_findings,
                        require_spanless_note=rules.require_spanless_note,
                    ),
                    at_submission=False,
                    enforce_spanless=True,
                )
                if violations:
                    raise DomainError(
                        "PROJECT_RULE_VIOLATION",
                        {"violations": [asdict(v) for v in violations]},
                    )
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
        *,
        pins: Mapping[str, Pin] | None = None,
    ) -> Draft:
        if isinstance(cmd, RecreateReanchorCommand):
            if (
                not is_review_like(draft.key.mode)
                or cmd.item not in draft.reanchor_inputs
            ):
                raise DomainError("INVALID_REANCHOR_ITEM")
            source = self.repo.verified_reanchor_source(draft.key, cmd.item)
            if (
                cmd.layer_id != source.annotation.layer_id
                or cmd.type_id != source.annotation.type_id
            ):
                raise DomainError("INVALID_REANCHOR_ITEM")
            created = self._create_annotation(
                draft,
                CreateAnnotationCommand(
                    annotation_id=cmd.annotation_id,
                    evidence_id=cmd.evidence_id,
                    term_id=cmd.term_id,
                    layer_id=cmd.layer_id,
                    type_id=cmd.type_id,
                    # Re-anchoring changes evidence, not the clinical finding.
                    # Axis changes require a later explicit edit command.
                    axes_values=source.annotation.axes_values,
                    segments=cmd.segments,
                    actor_id=draft.key.annotator_id,
                ),
                doc,
                profile,
                scope,
                services,
                apply_creation_defaults=False,
                pins=pins,
            )
            own = next(
                a
                for a in created.annotations
                if a.annotation.annotation_id == cmd.annotation_id
            )
            annotation = own.annotation.model_copy(
                update={
                    "axes_defaulted": list(source.annotation.axes_defaulted),
                    # Modifiers are part of the finding (R9); their old spans may
                    # no longer exist in the new text, so they come back spanless.
                    "modifiers": [
                        Modifier(term_id=m.term_id) for m in source.annotation.modifiers
                    ],
                    "provenance": Provenance(
                        actor=ActorRef(actor_id=draft.key.annotator_id, kind="human"),
                        method="edited",
                        source_refs=[
                            f"{cmd.item.source_ref.annotation_id}:{cmd.item.source_ref.version}"
                        ],
                    ),
                }
            )
            replacement = snapshot(annotation, own.evidence, doc, profile)
            created.annotations = [
                replacement if a.annotation.annotation_id == cmd.annotation_id else a
                for a in created.annotations
            ]
            return created
        if isinstance(cmd, CheckLayerCommand):
            return self._check_layer(draft, cmd, scope)
        if isinstance(cmd, CreateAnnotationCommand):
            return self._create_annotation(
                draft, cmd, doc, profile, scope, services, pins=pins
            )
        if isinstance(cmd, SetTermCommand):
            return self._set_term(draft, cmd, doc, profile, scope, services, pins=pins)
        if isinstance(cmd, MODIFIER_COMMANDS):
            return self._edit_modifiers(
                draft, cmd, doc, profile, scope, services, pins=pins
            )
        if isinstance(cmd, SetAnnotationNoteCommand):
            return self._set_annotation_note(draft, cmd, doc, profile, scope)
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

    def _adoption_source(
        self,
        draft: Draft,
        cmd: CreateAnnotationCommand,
        doc: Document,
        layer_id: str,
        type_id: str,
    ) -> AnnotationSnapshot | None:
        """Resolve the exact source before inheriting immutable provenance."""
        if not cmd.source_annotation_id or not cmd.source_version:
            return None
        for source in self.repo.workspace_input_snapshots(draft.key):
            if (
                source.annotation.annotation_id == cmd.source_annotation_id
                and source.version == cmd.source_version
                and source.annotation.layer_id == layer_id
                and source.annotation.type_id == type_id
                and source.document_id == doc.document_id
                and source.text_sha256 == doc.text_sha256
            ):
                return source
        return None

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
        *,
        apply_creation_defaults: bool = True,
        pins: Mapping[str, Pin] | None = None,
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

        source = self._adoption_source(draft, cmd, doc, target_layer, target_type)
        if source is not None and source.annotation.term_id == cmd.term_id:
            # Store the primary ID like a normal creation; provenance still
            # points at the adopted source annotation.
            term_id = self._primary_term_id(services[target_layer], cmd.term_id)
        else:
            term_id = self._validate_term_for_layer(services[target_layer], cmd.term_id)
            self._check_allowed_roots(
                draft, profile, pins, target_layer, services, term_id
            )

        if (cmd.source_annotation_id or cmd.source_version) and source is None:
            raise DomainError(
                "INVALID_ADOPTION_SOURCE",
                "Adoption requires an exact source in the same document, layer and type",
            )

        if any(
            a.annotation.annotation_id == cmd.annotation_id for a in draft.annotations
        ):
            raise DomainError(
                "DUPLICATE_ANNOTATION_ID",
                f"Annotation '{cmd.annotation_id}' already exists in current draft",
            )

        values = dict(cmd.axes_values)
        presets: Mapping[str, str] = {}
        if source is None and apply_creation_defaults:
            rules = self.repo.get_project_rules(draft.key.project_key)
            presets = rules.creation_defaults.get(target_layer, {}).get(target_type, {})
            values = {**presets, **values}
        chosen_axis_ids = (
            set(cmd.chosen_axis_ids)
            if cmd.chosen_axis_ids is not None
            else {
                axis
                for axis, value in cmd.axes_values.items()
                if value not in (None, "") and value != presets.get(axis)
            }
        )
        axis_ids = {axis.id for axis in type_def.axes}
        if any(
            axis not in axis_ids or cmd.axes_values.get(axis) in (None, "")
            for axis in chosen_axis_ids
        ):
            raise DomainError(
                "INVALID_AXES", "Only supplied nonempty axes can be confirmed"
            )
        try:
            validate_axes(values, type_def.axes, complete=False)
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
            axes_values=values,
            axes_defaulted=[
                axis
                for axis in source.annotation.axes_defaulted
                if cmd.axes_values.get(axis) not in (None, "")
                and cmd.axes_values.get(axis) == source.annotation.axes_values.get(axis)
            ]
            if source is not None
            else [
                axis
                for axis, value in values.items()
                if value not in (None, "") and axis not in chosen_axis_ids
            ],
            evidence_refs=evidence_refs,
            note=(cmd.note.strip() or None) if cmd.note is not None else None,
            # An adopted proposal keeps its modifiers.
            modifiers=[m.model_copy(deep=True) for m in source.annotation.modifiers]
            if source is not None
            else [],
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
        *,
        pins: Mapping[str, Pin] | None = None,
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
        if term_id != existing.annotation.term_id:
            self._check_allowed_roots(draft, profile, pins, layer_id, services, term_id)
        # The finding keeps its modifiers.
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

    def _set_annotation_note(
        self,
        draft: Draft,
        cmd: SetAnnotationNoteCommand,
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
        if layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Annotation '{cmd.annotation_id}' belongs to reference layer '{layer_id}'",
            )

        note = (cmd.note.strip() or None) if cmd.note is not None else None
        updated_ann = existing.annotation.model_copy(update={"note": note})
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

        axis_ids = {axis.id for axis in type_def.axes}
        if any(
            axis not in axis_ids or cmd.axes_values.get(axis) in (None, "")
            for axis in cmd.chosen_axis_ids
        ):
            raise DomainError(
                "INVALID_AXES", "Only known axes with a nonempty value can be confirmed"
            )
        updated_ann = existing.annotation.with_axes(cmd.axes_values)
        updated_ann = updated_ann.model_copy(
            update={
                "axes_defaulted": [
                    axis
                    for axis in updated_ann.axes_defaulted
                    if axis not in cmd.chosen_axis_ids
                ]
            }
        )
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
        remove_draft_annotation(draft, cmd.annotation_id)
        return draft

    # --- modifiers ------------------------------------------------------- #

    def _classifier(
        self,
        draft: Draft,
        profile: TaskProfile,
        pins: Mapping[str, Pin] | None,
        layer_id: str,
        services: dict[str, OntologyService | Exception],
    ) -> ModifierClassifier | None:
        """The layer's classifier; None unless its pin is ``hpo-phenotype`` (R2)."""
        if pins is None:
            pins = self.repo.project_pins(draft.key.project_key)
        if layer_id not in modifier_layers(profile, pins):
            return None
        service = services[layer_id]
        if isinstance(service, Exception):
            raise service
        return classifier_of(service)

    def _check_allowed_roots(
        self,
        draft: Draft,
        profile: TaskProfile,
        pins: Mapping[str, Pin] | None,
        layer_id: str,
        services: dict[str, OntologyService | Exception],
        term_id: str,
    ) -> None:
        """A newly chosen finding term lies under its pin's allowed roots (#85).

        Fail closed: a term outside every root is refused, unless it is a
        modifier term recorded on its own (hpo-phenotype layers). Findings
        already stored are not re-checked, so earlier work stays valid.
        """
        if pins is None:
            pins = self.repo.project_pins(draft.key.project_key)
        pin = pins.get(resolve_layer(profile, layer_id).ontology_id)
        if pin is None or not pin.allowed_roots:
            return
        service = services[layer_id]
        if isinstance(service, Exception):
            raise service
        roots = finding_roots(service, pin.allowed_roots)
        if roots is None or any(term_id in subtree(service, r) for r in roots):
            return
        classifier = self._classifier(draft, profile, pins, layer_id, services)
        if classifier is not None and classifier.kind(term_id) is not None:
            return
        raise DomainError(
            "TERM_OUTSIDE_ALLOWED_ROOTS",
            f"Term '{term_id}' is outside the branches this project allows "
            f"({', '.join(pin.allowed_roots)}).",
        )

    @staticmethod
    def _draft_annotation(draft: Draft, annotation_id: str) -> AnnotationSnapshot:
        found = next(
            (
                a
                for a in draft.annotations
                if a.annotation.annotation_id == annotation_id
            ),
            None,
        )
        if found is None:
            raise DomainError(
                "ANNOTATION_NOT_FOUND",
                f"Annotation '{annotation_id}' not found in current draft",
            )
        return found

    def _modifier_term(
        self,
        service: OntologyService | Exception,
        classifier: ModifierClassifier,
        term_id: str,
    ) -> str:
        primary = self._validate_term_for_layer(service, term_id)  # UNKNOWN/OBSOLETE
        if classifier.kind(primary) is None:
            raise DomainError("MODIFIER_NOT_ALLOWED", {"term_id": primary})
        return primary

    def _edit_modifiers(
        self,
        draft: Draft,
        cmd: ModifierCommand,
        doc: Document,
        profile: TaskProfile,
        scope: TaskScope,
        services: dict[str, OntologyService | Exception],
        *,
        pins: Mapping[str, Pin] | None = None,
    ) -> Draft:
        target_id = (
            cmd.target_annotation_id
            if isinstance(cmd, ConvertToModifierCommand)
            else cmd.annotation_id
        )
        existing = self._draft_annotation(draft, target_id)
        layer_id = existing.annotation.layer_id
        if layer_id not in scope.editable_layer_ids:
            raise DomainError(
                "REFERENCE_LAYER_READ_ONLY",
                f"Annotation '{target_id}' belongs to reference layer '{layer_id}'",
            )
        classifier = self._classifier(draft, profile, pins, layer_id, services)
        if classifier is None:
            raise DomainError("MODIFIERS_NOT_SUPPORTED", {"layer_id": layer_id})
        service = services[layer_id]
        current = list(existing.annotation.modifiers)

        if isinstance(cmd, ConvertToModifierCommand):
            source = self._draft_annotation(draft, cmd.annotation_id)
            if source.annotation.layer_id != layer_id:
                raise DomainError(
                    "LAYER_MISMATCH",
                    "A finding becomes a modifier only of a finding in its layer",
                )
            term_id = self._modifier_term(
                service, classifier, source.annotation.term_id
            )
            if cmd.annotation_id == target_id:
                raise DomainError("MODIFIER_NOT_ALLOWED", {"term_id": term_id})
            segments: list[Segment] = []
            if cmd.link_span and source.annotation.evidence_refs:
                first = source.annotation.evidence_refs[0]
                segments = list(
                    next(
                        e
                        for e in source.evidence
                        if (e.mention.evidence_id, e.version)
                        == (first.evidence_id, first.version)
                    ).mention.segments
                )
            found = next((m for m in current if m.term_id == term_id), None)
            if (
                found is not None
                and segments
                and found.segments
                and found.segments != segments
            ):
                raise DomainError("DUPLICATE_MODIFIER", {"term_id": term_id})
            modifiers = [m for m in current if m is not found] + [
                Modifier(
                    term_id=term_id,
                    segments=segments or (found.segments if found else []),
                )
            ]
            remove_draft_annotation(draft, cmd.annotation_id)
        elif isinstance(cmd, AddModifierCommand):
            term_id = self._modifier_term(service, classifier, cmd.term_id)
            found = next((m for m in current if m.term_id == term_id), None)
            if found is not None and (found.segments or not cmd.segments):
                raise DomainError("DUPLICATE_MODIFIER", {"term_id": term_id})
            # A spanless modifier already there gets the segments (attach flow).
            modifiers = [m for m in current if m is not found] + [
                Modifier(term_id=term_id, segments=cmd.segments)
            ]
        else:
            term_id = self._primary_term_id(service, cmd.term_id)
            if not any(m.term_id == term_id for m in current):
                raise DomainError("MODIFIER_NOT_FOUND", {"term_id": term_id})
            others = [m for m in current if m.term_id != term_id]
            modifiers = (
                [*others, Modifier(term_id=term_id, segments=cmd.segments)]
                if isinstance(cmd, SetModifierSegmentsCommand)
                else others
            )

        # Validated anew (sorted, no duplicates): model_copy would skip that.
        annotation = Annotation.model_validate(
            {
                **existing.annotation.model_dump(),
                "modifiers": [m.model_dump() for m in modifiers],
            }
        )
        self._replace(draft, existing, annotation, doc, profile)
        return draft

    def _replace(
        self,
        draft: Draft,
        existing: AnnotationSnapshot,
        annotation: Annotation,
        doc: Document,
        profile: TaskProfile,
    ) -> None:
        new_snap = snapshot(annotation, existing.evidence, doc, profile)
        draft.annotations = [
            new_snap if a.annotation.annotation_id == annotation.annotation_id else a
            for a in draft.annotations
        ]
        layer = annotation.layer_id
        draft.checked_layer_ids = [
            lid for lid in draft.checked_layer_ids if lid != layer
        ]
        self._update_decision_replacements(draft, annotation.annotation_id, new_snap)

    def _update_decision_replacements(
        self,
        draft: Draft,
        annotation_id: str,
        new_snap: AnnotationSnapshot,
    ) -> None:
        """Editing an approved replacement requires a fresh review decision.

        Except a consolidation's decisions (``ConsolidationMark``): they
        follow the edited annotation, so the group stays resolved and reads
        *edited* (its mark keeps the hash of the resolution)."""
        kept: list[ReviewDecision] = []
        for dec in draft.decisions:
            if (
                dec.replacement
                and dec.replacement.annotation_id == annotation_id
                and dec.replacement.version != new_snap.version
            ):
                if dec.consolidation is None:
                    continue
                dec = dec.model_copy(
                    update={
                        "replacement": AnnotationRef(
                            annotation_id=annotation_id, version=new_snap.version
                        )
                    }
                )
            kept.append(dec)
        draft.decisions = kept


EditorService = EditingService
