"""Annotation editing commands and application service."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from hpo_editor.domain.annotations import (
    ActorKind,
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from hpo_editor.domain.axes import Axes
from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
    snapshot_evidence,
    validate_segments,
)
from hpo_editor.domain.errors import DomainError
from hpo_editor.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from hpo_editor.ontology.service import OntologyService
from hpo_editor.storage.repository import Repository


class CreateAnnotationCommand(BaseModel):
    """Command creating an annotation with optional evidence."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["create_annotation"] = "create_annotation"
    annotation_id: str
    hpo_id: str
    search_event_id: str | None = None
    axes: Axes = Field(default_factory=Axes)
    evidence_id: str | None = None
    segments: list[Segment] = Field(default_factory=list)
    label: str | None = None
    actor_kind: ActorKind = "human"
    actor_id: str = "annotator"
    method: str = "manual"
    source_annotation_id: str | None = None
    source_version: str | None = None


class SetTermCommand(BaseModel):
    """Command updating an annotation's HPO concept."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["set_term"] = "set_term"
    annotation_id: str
    hpo_id: str
    search_event_id: str | None = None


class SetAxesCommand(BaseModel):
    """Command updating clinical context axes."""

    model_config = ConfigDict(extra="forbid")

    command: Literal["set_axes"] = "set_axes"
    annotation_id: str
    axes: Axes


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


EditCommand = Annotated[
    CreateAnnotationCommand
    | SetTermCommand
    | SetAxesCommand
    | AttachMentionCommand
    | EditMentionCommand
    | DetachMentionCommand
    | DeleteDraftAnnotationCommand,
    Field(discriminator="command"),
]

_edit_adapter: TypeAdapter[EditCommand] = TypeAdapter(EditCommand)


class EditorService:
    """Coordinates annotation commands, validations, and copy-on-write logic."""

    def __init__(self, repo: Repository, ontology: OntologyService) -> None:
        self.repo = repo
        self.ontology = ontology

    def parse_command(self, payload: dict[str, Any]) -> EditCommand:
        """Parse untyped mutation payload into typed EditCommand."""
        return _edit_adapter.validate_python(payload)

    def apply(self, key: WorkspaceKey, envelope: MutationEnvelope) -> Draft:
        """Transactionally execute an edit command against a workspace draft."""
        cmd = self.parse_command(envelope.payload)
        doc = self.repo.get_document(key.package_id, key.document_id)
        if doc is None:
            raise DomainError(
                "DOCUMENT_NOT_FOUND",
                f"Document '{key.document_id}' not found in package '{key.package_id}'",
            )

        def operation(draft: Draft) -> Draft:
            result = self._execute_edit(draft, cmd, doc)
            if (
                isinstance(cmd, (CreateAnnotationCommand, SetTermCommand))
                and cmd.search_event_id
            ):
                event = self.repo.get_search_event(cmd.search_event_id)
                if (
                    event is None
                    or event.workspace_key != key
                    or event.annotation_id != cmd.annotation_id
                    or cmd.hpo_id not in event.candidates
                ):
                    raise DomainError(
                        "INVALID_SEARCH_SELECTION",
                        "Search selection does not match this workspace, "
                        "annotation and candidate",
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
                event.selected_hpo_id = cmd.hpo_id
                event.displayed_position = event.candidates.index(cmd.hpo_id) + 1
                event.ranked_position = (
                    event.ranked_ids.index(cmd.hpo_id) + 1
                    if cmd.hpo_id in event.ranked_ids
                    else None
                )
                self.repo.save_search_event(event)
            return result

        result = self.repo.run_mutation(key, envelope, operation)
        if not isinstance(result, Draft):
            raise ValueError(f"Expected Draft from run_mutation, got {type(result)}")
        return result

    def _execute_edit(self, draft: Draft, cmd: EditCommand, doc: Document) -> Draft:
        if isinstance(cmd, CreateAnnotationCommand):
            return self._create_annotation(draft, cmd, doc)
        if isinstance(cmd, SetTermCommand):
            return self._set_term(draft, cmd, doc)
        if isinstance(cmd, SetAxesCommand):
            return self._set_axes(draft, cmd, doc)
        if isinstance(cmd, AttachMentionCommand):
            return self._attach_mention(draft, cmd, doc)
        if isinstance(cmd, EditMentionCommand):
            return self._edit_mention(draft, cmd, doc)
        if isinstance(cmd, DetachMentionCommand):
            return self._detach_mention(draft, cmd, doc)
        if isinstance(cmd, DeleteDraftAnnotationCommand):
            return self._delete_annotation(draft, cmd)
        raise ValueError(f"Unhandled command: {cmd}")

    def _validate_term(self, hpo_id: str) -> None:
        status = self.ontology.validate_term(hpo_id)
        if status.status == "obsolete":
            raise DomainError(
                "OBSOLETE_TERM",
                f"HPO term '{hpo_id}' is obsolete and cannot be newly created",
            )
        if status.status == "unknown":
            raise DomainError(
                "UNKNOWN_TERM",
                f"HPO term '{hpo_id}' is not present in the current ontology release",
            )

    def _create_annotation(
        self, draft: Draft, cmd: CreateAnnotationCommand, doc: Document
    ) -> Draft:
        self._validate_term(cmd.hpo_id)
        evidence_list: list[EvidenceSnapshot] = []
        evidence_refs: list[EvidenceRef] = []

        if cmd.evidence_id and cmd.segments:
            validate_segments(doc.text, cmd.segments)
            mention_label = cmd.label
            if not mention_label and cmd.segments:
                mention_label = doc.text[cmd.segments[0].start : cmd.segments[0].end]
            mention = EvidenceMention(
                evidence_id=cmd.evidence_id,
                segments=cmd.segments,
            )
            ev_snap = snapshot_evidence(mention, doc)
            evidence_list.append(ev_snap)
            evidence_refs.append(
                EvidenceRef(evidence_id=cmd.evidence_id, version=ev_snap.version)
            )
            # Add or update in draft evidence pool
            draft.evidence = [
                e for e in draft.evidence if e.mention.evidence_id != cmd.evidence_id
            ] + [ev_snap]

        source_refs: list[str] = []
        if cmd.source_annotation_id and cmd.source_version:
            source_refs = [f"{cmd.source_annotation_id}:{cmd.source_version}"]

        prov = Provenance(
            actor=ActorRef(actor_id=cmd.actor_id, kind=cmd.actor_kind),
            method=cmd.method,
            source_refs=source_refs,
        )
        ann = Annotation(
            annotation_id=cmd.annotation_id,
            document_id=doc.document_id,
            hpo_id=cmd.hpo_id,
            axes=cmd.axes,
            evidence_refs=evidence_refs,
            provenance=prov,
        )
        snap = snapshot(ann, evidence_list, doc, self.ontology.ref)
        draft.annotations = [
            a
            for a in draft.annotations
            if a.annotation.annotation_id != cmd.annotation_id
        ] + [snap]
        self._update_decision_replacements(draft, cmd.annotation_id, snap)
        return draft

    def _set_term(self, draft: Draft, cmd: SetTermCommand, doc: Document) -> Draft:
        self._validate_term(cmd.hpo_id)
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

        updated_ann = existing.annotation.model_copy(update={"hpo_id": cmd.hpo_id})
        new_snap = snapshot(updated_ann, existing.evidence, doc, self.ontology.ref)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _set_axes(self, draft: Draft, cmd: SetAxesCommand, doc: Document) -> Draft:
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

        updated_ann = existing.annotation.model_copy(update={"axes": cmd.axes})
        new_snap = snapshot(updated_ann, existing.evidence, doc, self.ontology.ref)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _attach_mention(
        self, draft: Draft, cmd: AttachMentionCommand, doc: Document
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

        # Check existing evidence in draft
        ev_snap = next(
            (e for e in draft.evidence if e.mention.evidence_id == cmd.evidence_id),
            None,
        )
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
        new_snap = snapshot(updated_ann, new_ev_list, doc, self.ontology.ref)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _edit_mention(
        self, draft: Draft, cmd: EditMentionCommand, doc: Document
    ) -> Draft:
        validate_segments(doc.text, cmd.segments)

        referencing = [
            a
            for a in draft.annotations
            if any(r.evidence_id == cmd.evidence_id for r in a.annotation.evidence_refs)
        ]

        if cmd.annotation_id and len(referencing) > 1:
            # Copy-on-write for the selected annotation
            new_ev_id = f"{cmd.evidence_id}-cow-{len(draft.evidence) + 1}"
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
                new_snap = snapshot(updated_ann, new_ev_list, doc, self.ontology.ref)
                draft.annotations = [
                    a if a.annotation.annotation_id != cmd.annotation_id else new_snap
                    for a in draft.annotations
                ]
                self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        else:
            # In-place update of mention for referencing annotations
            mention = EvidenceMention(
                evidence_id=cmd.evidence_id,
                segments=cmd.segments,
            )
            new_ev_snap = snapshot_evidence(mention, doc)
            draft.evidence = [
                e for e in draft.evidence if e.mention.evidence_id != cmd.evidence_id
            ] + [new_ev_snap]

            updated_annotations = []
            for snap in draft.annotations:
                if any(
                    r.evidence_id == cmd.evidence_id
                    for r in snap.annotation.evidence_refs
                ):
                    new_refs = [
                        r
                        if r.evidence_id != cmd.evidence_id
                        else EvidenceRef(
                            evidence_id=cmd.evidence_id,
                            version=new_ev_snap.version,
                        )
                        for r in snap.annotation.evidence_refs
                    ]
                    new_ev_list = [
                        e if e.mention.evidence_id != cmd.evidence_id else new_ev_snap
                        for e in snap.evidence
                    ]
                    updated_ann = snap.annotation.model_copy(
                        update={"evidence_refs": new_refs}
                    )
                    updated_snap = snapshot(
                        updated_ann, new_ev_list, doc, self.ontology.ref
                    )
                    updated_annotations.append(updated_snap)
                    self._update_decision_replacements(
                        draft, snap.annotation.annotation_id, updated_snap
                    )
                else:
                    updated_annotations.append(snap)
            draft.annotations = updated_annotations

        return draft

    def _detach_mention(
        self, draft: Draft, cmd: DetachMentionCommand, doc: Document
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

        new_refs = [
            r
            for r in target.annotation.evidence_refs
            if r.evidence_id != cmd.evidence_id
        ]
        new_ev_list = [
            e for e in target.evidence if e.mention.evidence_id != cmd.evidence_id
        ]
        updated_ann = target.annotation.model_copy(update={"evidence_refs": new_refs})
        new_snap = snapshot(updated_ann, new_ev_list, doc, self.ontology.ref)
        draft.annotations = [
            a if a.annotation.annotation_id != cmd.annotation_id else new_snap
            for a in draft.annotations
        ]
        self._update_decision_replacements(draft, cmd.annotation_id, new_snap)
        return draft

    def _delete_annotation(
        self, draft: Draft, cmd: DeleteDraftAnnotationCommand
    ) -> Draft:
        draft.annotations = [
            a
            for a in draft.annotations
            if a.annotation.annotation_id != cmd.annotation_id
        ]
        # Remove any decisions whose replacement was this annotation
        draft.decisions = [
            d
            for d in draft.decisions
            if not (d.replacement and d.replacement.annotation_id == cmd.annotation_id)
        ]
        # Clean up unreferenced evidence
        active_ev_ids = {
            r.evidence_id for a in draft.annotations for r in a.annotation.evidence_refs
        }
        draft.evidence = [
            e for e in draft.evidence if e.mention.evidence_id in active_ev_ids
        ]
        return draft

    def _update_decision_replacements(
        self, draft: Draft, annotation_id: str, new_snap: AnnotationSnapshot
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
