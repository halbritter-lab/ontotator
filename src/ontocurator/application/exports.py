"""Workspace export service with strict scope isolation."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import EvidenceSnapshot
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.packages.models import (
    PackageManifest,
    ValidatedPackage,
)
from ontocurator.storage.repository import Repository


class ExportService:
    """Exports a single workspace and its transitive dependencies."""

    def __init__(self, repo: Repository) -> None:
        self.repo = repo

    def for_workspace(self, key: WorkspaceKey) -> ValidatedPackage:
        """Produce a scoped ValidatedPackage containing only workspace data."""
        doc = self.repo.get_document(key.package_id, key.document_id)
        if doc is None:
            raise DomainError(
                "DOCUMENT_NOT_FOUND",
                f"Document '{key.document_id}' not found for export",
            )

        # Get original package manifest for ontology ref
        orig_pkg = self.repo.export_package(key.package_id)
        ontology_ref = orig_pkg.manifest.ontology

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
            refs = list(sub.targets.targets)
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

        search_events = self.repo.get_search_events_for_workspace(key)

        now = datetime.now(UTC).isoformat()
        export_pkg_id = f"export-{uuid4()}"
        manifest = PackageManifest(
            package_id=export_pkg_id,
            created_at=now,
            ontology=ontology_ref,
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
        )
