"""Workspace export service with strict scope isolation."""

from __future__ import annotations

from datetime import UTC, datetime

from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.documents import EvidenceSnapshot
from hpo_editor.domain.errors import DomainError
from hpo_editor.domain.workspace import WorkspaceKey
from hpo_editor.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from hpo_editor.storage.repository import Repository, _key_str


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

        for sub in subs:
            # Add snapshots in submission
            for snap in sub.snapshots:
                k = (snap.annotation.annotation_id, snap.version)
                annotations_map[k] = snap
                for ev in snap.evidence:
                    ev_k = (ev.mention.evidence_id, ev.version)
                    evidence_map[ev_k] = ev

            # If review mode, also preserve the original targeted proposal snapshots
            if key.mode == "review":
                for target_ref in sub.targets.targets:
                    orig_snap = self.repo.get_annotation_snapshot(
                        target_ref.annotation_id, target_ref.version
                    )
                    if orig_snap is not None:
                        k = (
                            orig_snap.annotation.annotation_id,
                            orig_snap.version,
                        )
                        annotations_map[k] = orig_snap
                        for ev in orig_snap.evidence:
                            ev_k = (ev.mention.evidence_id, ev.version)
                            evidence_map[ev_k] = ev

        # Load search events for this workspace
        k_str = _key_str(key)
        conn = self.repo.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT payload_json FROM search_events WHERE workspace_key = ?;",
            (k_str,),
        )
        search_events = [
            SearchEventRecord.model_validate_json(r[0])
            for r in cursor.fetchall()
        ]

        now = datetime.now(UTC).isoformat()
        export_pkg_id = (
            f"export-{key.package_id}-{key.document_id}-{key.annotator_id}"
        )
        manifest = PackageManifest(
            package_id=export_pkg_id,
            created_at=now,
            ontology=ontology_ref,
            origin_package_id=key.package_id,
        )

        return ValidatedPackage(
            manifest=manifest,
            documents={key.document_id: doc},
            annotations=annotations_map,
            evidence=evidence_map,
            submissions=submissions_map,
            search_events=search_events,
        )
