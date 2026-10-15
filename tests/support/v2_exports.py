"""Workspace export service with strict scope isolation."""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import Document, EvidenceSnapshot
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import TaskProfile, profile_hash
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.workspace import WorkspaceKey, WorkspaceMode
from ontocurator.ontology.conditions import projected_conditions
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from ontocurator.storage.repository import Repository


class ExportService:
    """Exports workspaces and their transitive dependencies as v2 packages."""

    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def for_package(
        self,
        package_id: str,
        annotator_id: str,
        mode: WorkspaceMode | None = None,
    ) -> ValidatedPackage:
        """Export all work of one annotator on one package as one v2 package.

        Merges the per-workspace exports of every workspace (opened drafts and
        local or imported submission bindings) of ``annotator_id`` in
        ``package_id``; ``mode=None`` includes all modes. Every document of the
        package is included in package order, so exports of different
        annotators share the same document set, task profile and
        ``origin_manifest_hash`` and can be compared for inter-annotator
        agreement. Only submitted annotations are exported (as with the
        per-workspace export); search events are included for every workspace.
        """
        keys = self.repo.list_workspace_keys(package_id, annotator_id, mode)
        if not keys:
            raise DomainError(
                "NO_ANNOTATOR_WORK",
                f"Annotator '{annotator_id}' has no workspaces in package "
                f"'{package_id}'" + (f" for mode '{mode}'" if mode else ""),
            )

        documents = {d.document_id: d for d in self.repo.list_documents(package_id)}
        # Load the installed package and its profile once for all workspaces.
        orig_pkg = self.repo.export_package(
            package_id, include_captured_conditions=False
        )
        package_profile = self.repo.get_task_profile(package_id)
        annotations: dict[tuple[str, str], AnnotationSnapshot] = {}
        evidence: dict[tuple[str, str], EvidenceSnapshot] = {}
        submissions = {}
        search_events: dict[str, SearchEventRecord] = {}
        profile: TaskProfile | None = None
        for key in keys:
            part = self._export_workspace(
                key, orig_pkg, package_profile, documents.get(key.document_id)
            )
            annotations.update(part.annotations)
            evidence.update(part.evidence)
            submissions.update(part.submissions)
            for event in part.search_events:
                search_events.setdefault(event.event_id, event)
            if mode is not None:
                # One mode => one (possibly layer-projected) profile for all.
                profile = part.manifest.task_profile
        if profile is None:
            # Mixed modes: the full package profile covers every layer.
            profile = package_profile
        conditions = projected_conditions(
            self.repo.get_search_conditions(package_id), profile
        )
        # First capture commits conditions and bytes atomically. Read bytes
        # after observing conditions, rather than reuse the earlier package view.
        stored_resources = self.repo.get_embedded_files(package_id)
        embedded = {
            ont.resource_path: stored_resources[ont.resource_path]
            for ont in profile.ontologies
            if ont.resource_path and ont.resource_path in stored_resources
        }

        embedded.update(
            {
                item.resource_path: stored_resources[item.resource_path]
                for condition in conditions or []
                for item in condition.translations
            }
        )

        manifest = PackageManifest(
            format_version="ontocurator-work-package/v2",
            package_id=f"export-{uuid4()}",
            created_at=datetime.now(UTC).isoformat(),
            document_order=list(documents),
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            search_conditions=conditions,
            origin_package_id=package_id,
            origin_manifest_hash=canonical_hash(orig_pkg.manifest.model_dump()),
        )
        return ValidatedPackage(
            manifest=manifest,
            documents=documents,
            annotations=annotations,
            evidence=evidence,
            submissions=submissions,
            search_events=sorted(
                search_events.values(), key=lambda e: (e.timestamp, e.event_id)
            ),
            embedded_files=embedded,
        )

    def for_workspace(self, key: WorkspaceKey) -> ValidatedPackage:
        """Produce a scoped ValidatedPackage containing only workspace data."""
        return self._export_workspace(
            key,
            self.repo.export_package(key.package_id, include_captured_conditions=False),
            self.repo.get_task_profile(key.package_id),
            self.repo.get_document(key.package_id, key.document_id),
        )

    def _export_workspace(
        self,
        key: WorkspaceKey,
        orig_pkg: ValidatedPackage,
        task_profile: TaskProfile,
        doc: Document | None,
    ) -> ValidatedPackage:
        """Export one workspace against an already loaded installed package."""
        if doc is None:
            raise DomainError(
                "DOCUMENT_NOT_FOUND",
                f"Document '{key.document_id}' not found for export",
            )
        scope = build_scope(task_profile, key.mode)

        # Load submissions for this workspace key
        subs = self.repo.get_submissions_for_workspace(key)
        submissions_map = {s.submission_id: s for s in subs}

        annotations_map: dict[tuple[str, str], AnnotationSnapshot] = {}
        evidence_map: dict[tuple[str, str], EvidenceSnapshot] = {}

        def include_snapshot(snap: AnnotationSnapshot) -> None:
            if (
                snap.document_id != key.document_id
                or snap.text_sha256 != doc.text_sha256
            ):
                raise DomainError(
                    "INVALID_EXPORT_DEPENDENCY",
                    "Snapshot belongs to a different document",
                )
            if (
                key.mode == "independent"
                and snap.annotation.layer_id not in scope.editable_layer_ids
            ):
                return
            annotations_map[(snap.annotation.annotation_id, snap.version)] = snap
            embedded = {
                (ev.mention.evidence_id, ev.version): ev for ev in snap.evidence
            }
            for ref in snap.annotation.evidence_refs:
                ev_key = (ref.evidence_id, ref.version)
                ev = embedded.get(ev_key)
                if ev is None:
                    raise DomainError(
                        "MISSING_EXPORT_DEPENDENCY",
                        "Referenced evidence snapshot is missing",
                    )
                evidence_map[ev_key] = ev
            evidence_map.update(embedded)

        for sub in subs:
            for snap in sub.snapshots:
                include_snapshot(snap)

        for sub in subs:
            refs = list(sub.targets.targets) if key.mode == "review" else []
            for decision in sub.decisions:
                refs.append(decision.target)
                if decision.replacement is not None:
                    refs.append(decision.replacement)
            for ref in refs:
                ref_key = (ref.annotation_id, ref.version)
                if ref_key in annotations_map:
                    continue
                dependency = orig_pkg.annotations.get(ref_key)
                if dependency is None:
                    raise DomainError(
                        "MISSING_EXPORT_DEPENDENCY",
                        "Referenced annotation snapshot is missing",
                    )
                include_snapshot(dependency)

        if key.mode == "independent":
            projected_layers = [
                layer
                for layer in task_profile.layers
                if layer.layer_id in scope.editable_layer_ids
            ]
            used_ontology_ids = {layer.ontology_id for layer in projected_layers}
            projected_ontologies = [
                ont
                for ont in task_profile.ontologies
                if ont.ontology_id in used_ontology_ids
            ]
            default_layer_id = (
                task_profile.default_layer_id
                if task_profile.default_layer_id in scope.editable_layer_ids
                else scope.editable_layer_ids[0]
            )
            task_profile = TaskProfile(
                profile_id=task_profile.profile_id,
                version=task_profile.version,
                ontologies=projected_ontologies,
                layers=projected_layers,
                default_layer_id=default_layer_id,
                preset=task_profile.preset,
            )

        search_events = self.repo.get_search_events_for_workspace(key)
        if key.mode == "independent":
            search_events = [
                evt
                for evt in search_events
                if evt.layer_id is None or evt.layer_id in scope.editable_layer_ids
            ]
        now = datetime.now(UTC).isoformat()
        export_pkg_id = f"export-{uuid4()}"
        conditions = projected_conditions(
            self.repo.get_search_conditions(key.package_id), task_profile
        )
        stored_resources = self.repo.get_embedded_files(key.package_id)
        captured_paths = {
            item.resource_path
            for condition in conditions or []
            for item in condition.translations
        }
        manifest = PackageManifest(
            format_version="ontocurator-work-package/v2",
            package_id=export_pkg_id,
            created_at=now,
            document_order=[key.document_id],
            task_profile=task_profile,
            task_profile_sha256=profile_hash(task_profile),
            search_conditions=conditions,
            origin_package_id=key.package_id,
            origin_manifest_hash=canonical_hash(orig_pkg.manifest.model_dump()),
        )

        return ValidatedPackage(
            manifest=manifest,
            documents={key.document_id: doc},
            annotations=annotations_map,
            evidence=evidence_map,
            submissions=submissions_map,
            search_events=search_events,
            embedded_files={
                path: stored_resources[path]
                for path in captured_paths
                | {
                    ont.resource_path
                    for ont in task_profile.ontologies
                    if ont.resource_path and ont.resource_path in stored_resources
                }
            },
        )


def package_export_zip(
    app: Any, package_id: str, annotator_id: str, mode: WorkspaceMode | None = None
) -> bytes:
    """All work of one annotator as a v2 ZIP, as the removed export route wrote it."""
    from support.v2_writer import PackageWriter

    pkg = ExportService(app.state.repo).for_package(package_id, annotator_id, mode)
    buffer = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buffer)
    return buffer.getvalue()


def workspace_export_zip(app: Any, workspace_id: str) -> bytes:
    """One workspace as a v2 ZIP, as the removed workspace export wrote it."""
    from ontocurator.api.routes import decode_workspace_id
    from support.v2_writer import PackageWriter

    pkg = ExportService(app.state.repo).for_workspace(decode_workspace_id(workspace_id))
    buffer = io.BytesIO()
    PackageWriter.write_to_stream(pkg, buffer)
    return buffer.getvalue()
