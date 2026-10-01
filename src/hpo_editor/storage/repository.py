import json
from collections.abc import Callable
from datetime import UTC, datetime

from hpo_editor.domain.annotations import AnnotationSnapshot
from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.documents import Document, EvidenceSnapshot
from hpo_editor.domain.errors import InvalidPackage, RevisionConflict
from hpo_editor.domain.review import ReviewDecision, ReviewTargetSet
from hpo_editor.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from hpo_editor.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from hpo_editor.storage.database import Database


def _key_str(key: WorkspaceKey) -> str:
    parts = [
        key.package_id,
        key.document_id,
        key.annotator_id,
        key.mode,
        key.target_set_id,
    ]
    return ":".join(parts)


class Repository:
    """Storage repository for work packages, revisioned drafts and submissions."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def import_package(self, package: ValidatedPackage) -> str:
        """Atomically import package into database or verify idempotency."""
        manifest_hash = canonical_hash(package.manifest.model_dump())
        conn = self.db.get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT manifest_hash FROM packages WHERE package_id = ?;",
            (package.manifest.package_id,),
        )
        row = cursor.fetchone()
        if row is not None:
            existing_hash = row[0]
            if existing_hash != manifest_hash:
                raise InvalidPackage(
                    f"Package '{package.manifest.package_id}' exists with "
                    f"different manifest hash"
                )
            return package.manifest.package_id

        # Insert package data atomically
        cursor.execute("BEGIN IMMEDIATE;")
        try:
            now = datetime.now(UTC).isoformat()
            cursor.execute(
                "INSERT INTO packages "
                "(package_id, manifest_hash, manifest_json, created_at) "
                "VALUES (?, ?, ?, ?);",
                (
                    package.manifest.package_id,
                    manifest_hash,
                    json.dumps(package.manifest.model_dump()),
                    now,
                ),
            )

            for doc in package.documents.values():
                cursor.execute(
                    "INSERT INTO documents "
                    "(document_id, package_id, text, language, text_sha256) "
                    "VALUES (?, ?, ?, ?, ?);",
                    (
                        doc.document_id,
                        package.manifest.package_id,
                        doc.text,
                        doc.language,
                        doc.text_sha256,
                    ),
                )

            for ev in package.evidence.values():
                cursor.execute(
                    "INSERT OR IGNORE INTO evidence_snapshots "
                    "(evidence_id, version, document_id, payload_json) "
                    "VALUES (?, ?, ?, ?);",
                    (
                        ev.mention.evidence_id,
                        ev.version,
                        ev.document_id,
                        json.dumps(ev.model_dump()),
                    ),
                )

            for snap in package.annotations.values():
                cursor.execute(
                    "INSERT OR IGNORE INTO annotation_snapshots "
                    "(annotation_id, version, document_id, payload_json) "
                    "VALUES (?, ?, ?, ?);",
                    (
                        snap.annotation.annotation_id,
                        snap.version,
                        snap.document_id,
                        json.dumps(snap.model_dump()),
                    ),
                )

            for sub in package.submissions.values():
                cursor.execute(
                    "INSERT OR IGNORE INTO submissions (submission_id, origin_key, "
                    "targets_json, draft_revision, document_checked, payload_json, "
                    "created_at) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (
                        sub.submission_id,
                        _key_str(sub.origin_key),
                        json.dumps(sub.targets.model_dump()),
                        sub.draft_revision,
                        1 if sub.document_checked else 0,
                        json.dumps(sub.model_dump()),
                        sub.created_at,
                    ),
                )
                cursor.execute(
                    "INSERT OR IGNORE INTO imported_submission_bindings "
                    "(local_package_id, submission_id, local_key) "
                    "VALUES (?, ?, ?);",
                    (
                        package.manifest.package_id,
                        sub.submission_id,
                        _key_str(sub.origin_key),
                    ),
                )

            for event in package.search_events:
                cursor.execute(
                    "INSERT OR IGNORE INTO search_events "
                    "(event_id, workspace_key, annotation_id, payload_json, "
                    "timestamp) VALUES (?, ?, ?, ?, ?);",
                    (
                        event.event_id,
                        _key_str(event.workspace_key),
                        event.annotation_id,
                        json.dumps(event.model_dump()),
                        event.timestamp,
                    ),
                )

            cursor.execute("COMMIT;")
            return package.manifest.package_id
        except Exception:
            cursor.execute("ROLLBACK;")
            raise

    def open_draft(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> Draft:
        """Open or initialize mutable workspace draft."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        k_str = _key_str(key)

        cursor.execute(
            "SELECT revision, document_checked, targets_json "
            "FROM workspaces WHERE workspace_key = ?;",
            (k_str,),
        )
        row = cursor.fetchone()

        if row is None:
            # Initialize new workspace
            effective_targets = (
                targets if targets is not None else ReviewTargetSet.create([])
            )
            now = datetime.now(UTC).isoformat()
            cursor.execute(
                "INSERT INTO workspaces "
                "(workspace_key, package_id, document_id, annotator_id, "
                "mode, target_set_id, targets_json, revision, "
                "document_checked, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?);",
                (
                    k_str,
                    key.package_id,
                    key.document_id,
                    key.annotator_id,
                    key.mode,
                    key.target_set_id,
                    json.dumps(effective_targets.model_dump()),
                    now,
                ),
            )
            return Draft(
                key=key,
                targets=effective_targets,
                revision=0,
                annotations=[],
                evidence=[],
                decisions=[],
                document_checked=False,
            )

        revision = int(row[0])
        doc_checked = bool(row[1])
        parsed_targets = ReviewTargetSet.model_validate_json(row[2])

        # Load workspace annotations
        cursor.execute(
            "SELECT s.payload_json FROM workspace_annotations wa "
            "JOIN annotation_snapshots s "
            "ON wa.annotation_id = s.annotation_id AND wa.version = s.version "
            "WHERE wa.workspace_key = ?;",
            (k_str,),
        )
        annotations = [
            AnnotationSnapshot.model_validate_json(r[0]) for r in cursor.fetchall()
        ]

        # Load workspace evidence
        cursor.execute(
            "SELECT s.payload_json FROM workspace_evidence we "
            "JOIN evidence_snapshots s "
            "ON we.evidence_id = s.evidence_id AND we.version = s.version "
            "WHERE we.workspace_key = ?;",
            (k_str,),
        )
        evidence = [
            EvidenceSnapshot.model_validate_json(r[0]) for r in cursor.fetchall()
        ]

        # Load workspace decisions
        cursor.execute(
            "SELECT payload_json FROM workspace_decisions WHERE workspace_key = ?;",
            (k_str,),
        )
        decisions = [
            ReviewDecision.model_validate_json(r[0]) for r in cursor.fetchall()
        ]

        return Draft(
            key=key,
            targets=parsed_targets,
            revision=revision,
            annotations=annotations,
            evidence=evidence,
            decisions=decisions,
            document_checked=doc_checked,
        )

    def run_mutation(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        operation: Callable[[Draft], Draft | Submission],
    ) -> Draft | Submission:
        """Transactionally execute mutation with idempotency receipt check."""
        k_str = _key_str(key)
        request_hash = canonical_hash(envelope.model_dump())
        conn = self.db.get_connection()
        cursor = conn.cursor()

        # Check existing receipt
        cursor.execute(
            "SELECT request_hash, response_json FROM mutation_receipts "
            "WHERE workspace_key = ? AND mutation_id = ?;",
            (k_str, envelope.mutation_id),
        )
        receipt_row = cursor.fetchone()
        if receipt_row is not None:
            existing_hash, resp_json = receipt_row[0], receipt_row[1]
            if existing_hash != request_hash:
                raise RevisionConflict(
                    f"Mutation ID reused with different payload: {envelope.mutation_id}"
                )
            # Replay stored response without incrementing revision
            data = json.loads(resp_json)
            if "submission_id" in data:
                return Submission.model_validate(data)
            return Draft.model_validate(data)

        # Begin transaction
        cursor.execute("BEGIN IMMEDIATE;")
        try:
            cursor.execute(
                "SELECT revision FROM workspaces WHERE workspace_key = ?;",
                (k_str,),
            )
            row = cursor.fetchone()
            current_revision = int(row[0]) if row is not None else 0

            if current_revision != envelope.expected_revision:
                raise RevisionConflict(
                    f"REVISION_CONFLICT: Expected revision "
                    f"{envelope.expected_revision}, current is {current_revision}"
                )

            # Open draft within current state
            draft = self.open_draft(key)
            result = operation(draft)
            now = datetime.now(UTC).isoformat()
            new_revision = current_revision + 1

            if isinstance(result, Draft):
                result.revision = new_revision
                # Update workspace record
                cursor.execute(
                    "UPDATE workspaces "
                    "SET revision = ?, document_checked = ?, updated_at = ? "
                    "WHERE workspace_key = ?;",
                    (
                        new_revision,
                        1 if result.document_checked else 0,
                        now,
                        k_str,
                    ),
                )

                # Replace workspace annotations
                cursor.execute(
                    "DELETE FROM workspace_annotations WHERE workspace_key = ?;",
                    (k_str,),
                )
                for ann in result.annotations:
                    cursor.execute(
                        "INSERT OR IGNORE INTO annotation_snapshots "
                        "(annotation_id, version, document_id, payload_json) "
                        "VALUES (?, ?, ?, ?);",
                        (
                            ann.annotation.annotation_id,
                            ann.version,
                            ann.document_id,
                            json.dumps(ann.model_dump()),
                        ),
                    )
                    cursor.execute(
                        "INSERT INTO workspace_annotations "
                        "(workspace_key, annotation_id, version) "
                        "VALUES (?, ?, ?);",
                        (k_str, ann.annotation.annotation_id, ann.version),
                    )

                # Replace workspace evidence
                cursor.execute(
                    "DELETE FROM workspace_evidence WHERE workspace_key = ?;",
                    (k_str,),
                )
                for ev in result.evidence:
                    cursor.execute(
                        "INSERT OR IGNORE INTO evidence_snapshots "
                        "(evidence_id, version, document_id, payload_json) "
                        "VALUES (?, ?, ?, ?);",
                        (
                            ev.mention.evidence_id,
                            ev.version,
                            ev.document_id,
                            json.dumps(ev.model_dump()),
                        ),
                    )
                    cursor.execute(
                        "INSERT INTO workspace_evidence "
                        "(workspace_key, evidence_id, version) "
                        "VALUES (?, ?, ?);",
                        (k_str, ev.mention.evidence_id, ev.version),
                    )

                # Replace workspace decisions
                cursor.execute(
                    "DELETE FROM workspace_decisions WHERE workspace_key = ?;",
                    (k_str,),
                )
                for dec in result.decisions:
                    cursor.execute(
                        "INSERT INTO workspace_decisions "
                        "(decision_id, workspace_key, target_id, target_version, "
                        "outcome, replacement_id, replacement_version, note, "
                        "reviewer_id, payload_json) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
                        (
                            dec.decision_id,
                            k_str,
                            dec.target.annotation_id,
                            dec.target.version,
                            dec.outcome,
                            dec.replacement.annotation_id if dec.replacement else None,
                            dec.replacement.version if dec.replacement else None,
                            dec.note,
                            dec.reviewer_id,
                            json.dumps(dec.model_dump()),
                        ),
                    )

                resp_json = json.dumps(result.model_dump())
            elif isinstance(result, Submission):
                # Save submission record
                cursor.execute(
                    "UPDATE workspaces SET revision = ?, updated_at = ? "
                    "WHERE workspace_key = ?;",
                    (new_revision, now, k_str),
                )
                cursor.execute(
                    "INSERT INTO submissions (submission_id, origin_key, targets_json, "
                    "draft_revision, document_checked, payload_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (
                        result.submission_id,
                        k_str,
                        json.dumps(result.targets.model_dump()),
                        result.draft_revision,
                        1 if result.document_checked else 0,
                        json.dumps(result.model_dump()),
                        result.created_at,
                    ),
                )
                cursor.execute(
                    "INSERT OR IGNORE INTO imported_submission_bindings "
                    "(local_package_id, submission_id, local_key) VALUES (?, ?, ?);",
                    (key.package_id, result.submission_id, k_str),
                )
                resp_json = json.dumps(result.model_dump())
            else:
                raise ValueError(f"Unsupported operation return type: {type(result)}")

            # Save mutation receipt
            cursor.execute(
                "INSERT INTO mutation_receipts "
                "(workspace_key, mutation_id, request_hash, response_json, created_at) "
                "VALUES (?, ?, ?, ?, ?);",
                (k_str, envelope.mutation_id, request_hash, resp_json, now),
            )

            cursor.execute("COMMIT;")
            return result
        except Exception:
            cursor.execute("ROLLBACK;")
            raise

    def export_package(self, package_id: str) -> ValidatedPackage:
        """Export all data associated with package into a ValidatedPackage."""
        conn = self.db.get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT manifest_json FROM packages WHERE package_id = ?;",
            (package_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise InvalidPackage(f"Package '{package_id}' not found")
        manifest = PackageManifest.model_validate_json(row[0])

        cursor.execute(
            "SELECT document_id, text, language, text_sha256 FROM documents "
            "WHERE package_id = ?;",
            (package_id,),
        )
        documents = {
            r[0]: Document(document_id=r[0], text=r[1], language=r[2], text_sha256=r[3])
            for r in cursor.fetchall()
        }

        # Load all annotations for these documents
        doc_ids = list(documents.keys())
        placeholders = ",".join("?" * len(doc_ids))
        cursor.execute(
            f"SELECT payload_json FROM annotation_snapshots "
            f"WHERE document_id IN ({placeholders});",
            doc_ids,
        )
        annotations = {}
        for r in cursor.fetchall():
            snap = AnnotationSnapshot.model_validate_json(r[0])
            annotations[(snap.annotation.annotation_id, snap.version)] = snap

        cursor.execute(
            f"SELECT payload_json FROM evidence_snapshots "
            f"WHERE document_id IN ({placeholders});",
            doc_ids,
        )
        evidence = {}
        for r in cursor.fetchall():
            ev = EvidenceSnapshot.model_validate_json(r[0])
            evidence[(ev.mention.evidence_id, ev.version)] = ev

        cursor.execute(
            "SELECT s.payload_json FROM submissions s "
            "JOIN imported_submission_bindings b ON s.submission_id = b.submission_id "
            "WHERE b.local_package_id = ?;",
            (package_id,),
        )
        submissions = {
            s.submission_id: s
            for s in [Submission.model_validate_json(r[0]) for r in cursor.fetchall()]
        }

        cursor.execute(
            "SELECT payload_json FROM search_events WHERE workspace_key LIKE ?;",
            (f"{package_id}:%",),
        )
        search_events = [
            SearchEventRecord.model_validate_json(r[0]) for r in cursor.fetchall()
        ]

        return ValidatedPackage(
            manifest=manifest,
            documents=documents,
            annotations=annotations,
            evidence=evidence,
            submissions=submissions,
            search_events=search_events,
        )
