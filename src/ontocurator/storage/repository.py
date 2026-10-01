import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import (
    CLINICAL_PHENOTYPE_CONFIG,
    EDITOR_AXES_CONFIG,
    AxesConfig,
)
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import Document, EvidenceSnapshot
from ontocurator.domain.errors import DomainError, InvalidPackage, RevisionConflict
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.serialization import decode_snapshot, encode_snapshot
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
)
from ontocurator.storage.database import Database


def _key_str(key: WorkspaceKey) -> str:
    parts = [
        key.package_id,
        key.document_id,
        key.annotator_id,
        key.mode,
        key.target_set_id,
    ]
    return ":".join(parts)


def _local_import_key(origin: WorkspaceKey, package_id: str) -> WorkspaceKey:
    """Bind historical content to the local API's independent workspace identity."""
    return origin.model_copy(
        update={
            "package_id": package_id,
            "target_set_id": "targets-0"
            if origin.mode == "independent"
            else origin.target_set_id,
        }
    )


def _workspace_aliases(key: WorkspaceKey) -> tuple[str, ...]:
    """Read both historical empty-target and API-default independent bindings."""
    keys = {_key_str(key)}
    if key.mode == "independent":
        for target_id in ("targets-0", ReviewTargetSet.create([]).target_set_id):
            keys.add(_key_str(key.model_copy(update={"target_set_id": target_id})))
    return tuple(sorted(keys))


class Repository:
    """Storage repository for work packages, revisioned drafts and submissions."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def import_package(
        self,
        package: ValidatedPackage,
        fallback_axes_config: AxesConfig | None = None,
    ) -> str:
        """Atomically import package into database or verify idempotency."""
        manifest_hash = canonical_hash(package.manifest.model_dump())
        conn = self.db.get_connection()
        cursor = conn.cursor()

        # Resolve package axes profile
        profile: AxesConfig
        if package.manifest.axes_config is not None:
            if (
                package.manifest.axes_definition == "editor-axes/v1"
                and package.manifest.axes_config.axes != EDITOR_AXES_CONFIG.axes
            ):
                raise InvalidPackage(
                    "Reserved profile name 'editor-axes/v1' cannot be redefined "
                    "with different axes"
                )
            if (
                package.manifest.axes_definition == "clinical-phenotype/v1"
                and package.manifest.axes_config.axes != CLINICAL_PHENOTYPE_CONFIG.axes
            ):
                raise InvalidPackage(
                    "Reserved profile name 'clinical-phenotype/v1' cannot be redefined "
                    "with different axes"
                )
            profile = package.manifest.axes_config
        elif package.manifest.axes_definition == "editor-axes/v1":
            profile = EDITOR_AXES_CONFIG
        elif package.manifest.axes_definition == "clinical-phenotype/v1":
            profile = CLINICAL_PHENOTYPE_CONFIG
        elif (
            fallback_axes_config is not None
            and fallback_axes_config.definition_name == package.manifest.axes_definition
        ):
            profile = fallback_axes_config
        else:
            raise DomainError(
                "UNRESOLVABLE_PROFILE",
                f"Cannot resolve axes profile '{package.manifest.axes_definition}' "
                f"for package '{package.manifest.package_id}'",
            )

        cursor.execute("BEGIN IMMEDIATE;")
        try:
            self._verify_existing_snapshots(package)
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
                prof_row = cursor.execute(
                    "SELECT profile_sha256 FROM package_axes_profiles "
                    "WHERE package_id = ?;",
                    (package.manifest.package_id,),
                ).fetchone()
                if prof_row is not None and prof_row[0] != profile.config_sha256:
                    raise InvalidPackage(
                        "Conflicting axes profile resolution for existing package"
                    )
                self._store_package_membership(package)
                cursor.execute("COMMIT;")
                return package.manifest.package_id

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

            cursor.execute(
                "INSERT INTO package_axes_profiles "
                "(package_id, profile_json, profile_sha256) VALUES (?, ?, ?);",
                (
                    package.manifest.package_id,
                    profile.model_dump_json(),
                    profile.config_sha256,
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
                        json.dumps(encode_snapshot(snap)),
                    ),
                )

            def _dump_sub(s: Submission) -> dict[str, Any]:
                d = s.model_dump()
                d["snapshots"] = [encode_snapshot(sn) for sn in s.snapshots]
                return d

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
                        json.dumps(_dump_sub(sub)),
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
                        _key_str(
                            _local_import_key(
                                sub.origin_key, package.manifest.package_id
                            )
                        ),
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

            self._store_package_membership(package)
            cursor.execute("COMMIT;")
            return package.manifest.package_id
        except Exception:
            cursor.execute("ROLLBACK;")
            raise

    def get_axes_config(self, package_id: str) -> AxesConfig:
        """Return the resolved AxesConfig for an installed package."""
        conn = self.db.get_connection()
        row = conn.execute(
            "SELECT profile_json FROM package_axes_profiles WHERE package_id = ?;",
            (package_id,),
        ).fetchone()
        if row is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND",
                f"No package or axes profile found for package '{package_id}'",
            )
        return AxesConfig.model_validate_json(row[0])

    def open_draft(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> Draft:
        """Open or initialize mutable workspace draft."""
        conn = self.db.get_connection()
        if conn.in_transaction:
            return self._open_draft(key, targets)
        conn.execute("BEGIN IMMEDIATE")
        try:
            draft = self._open_draft(key, targets)
            conn.execute("COMMIT")
            return draft
        except Exception:
            conn.execute("ROLLBACK")
            raise

    def _open_draft(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> Draft:
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
            submissions = self.get_submissions_for_workspace(key)
            if submissions:
                latest = submissions[-1]
                confirmed = {
                    (d.target.annotation_id, d.target.version)
                    for d in latest.decisions
                    if d.outcome == "confirmed"
                }
                annotations = [
                    a
                    for a in latest.snapshots
                    if key.mode != "review"
                    or (a.annotation.annotation_id, a.version) not in confirmed
                ]
                for ann in annotations:
                    cursor.execute(
                        "INSERT OR IGNORE INTO annotation_snapshots VALUES (?, ?, ?, "
                        "?)",
                        (
                            ann.annotation.annotation_id,
                            ann.version,
                            ann.document_id,
                            ann.model_dump_json(),
                        ),
                    )
                    cursor.execute(
                        "INSERT INTO workspace_annotations VALUES (?, ?, ?)",
                        (k_str, ann.annotation.annotation_id, ann.version),
                    )
                    for ev in ann.evidence:
                        cursor.execute(
                            "INSERT OR IGNORE INTO evidence_snapshots VALUES (?, ?, "
                            "?, ?)",
                            (
                                ev.mention.evidence_id,
                                ev.version,
                                ev.document_id,
                                ev.model_dump_json(),
                            ),
                        )
                        cursor.execute(
                            "INSERT OR IGNORE INTO workspace_evidence VALUES (?, ?, ?)",
                            (k_str, ev.mention.evidence_id, ev.version),
                        )
                for dec in latest.decisions:
                    # Rebind the local decision identity to this workspace.
                    dec = dec.model_copy(
                        update={
                            "decision_id": canonical_hash(
                                {
                                    "workspace": key.model_dump(),
                                    "target": dec.target.model_dump(),
                                }
                            )
                        }
                    )
                    cursor.execute(
                        "INSERT INTO workspace_decisions VALUES (?, ?, ?, ?, ?, ?, ?, "
                        "?, ?, ?)",
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
                            dec.model_dump_json(),
                        ),
                    )
                cursor.execute(
                    "UPDATE workspaces SET targets_json=? WHERE workspace_key=?",
                    (latest.targets.model_dump_json(), k_str),
                )
            return self._open_draft(key, targets)

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
        annotations = [decode_snapshot(json.loads(r[0])) for r in cursor.fetchall()]

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

        cursor.execute("BEGIN IMMEDIATE;")
        try:
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
                        "Mutation ID reused with different payload: "
                        f"{envelope.mutation_id}"
                    )
                # Replay stored response without incrementing revision
                data = json.loads(resp_json)
                cursor.execute("COMMIT;")
                if "submission_id" in data:
                    return Submission.model_validate(data)
                return Draft.model_validate(data)

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
                            json.dumps(encode_snapshot(ann)),
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

                def _dump_draft(d: Draft) -> dict[str, Any]:
                    raw = d.model_dump()
                    raw["annotations"] = [encode_snapshot(a) for a in d.annotations]
                    return raw

                resp_json = json.dumps(_dump_draft(result))
            elif isinstance(result, Submission):
                # Save submission record
                cursor.execute(
                    "UPDATE workspaces SET revision = ?, updated_at = ? "
                    "WHERE workspace_key = ?;",
                    (new_revision, now, k_str),
                )

                def _dump_sub(s: Submission) -> dict[str, Any]:
                    d = s.model_dump()
                    d["snapshots"] = [encode_snapshot(sn) for sn in s.snapshots]
                    return d

                sub_payload = _dump_sub(result)
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
                        json.dumps(sub_payload),
                        result.created_at,
                    ),
                )
                cursor.execute(
                    "INSERT OR IGNORE INTO imported_submission_bindings "
                    "(local_package_id, submission_id, local_key) VALUES (?, ?, ?);",
                    (key.package_id, result.submission_id, k_str),
                )
                resp_json = json.dumps(sub_payload)
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

        cursor.execute(
            "SELECT a.payload_json FROM annotation_snapshots a JOIN "
            "package_annotations p "
            "ON a.annotation_id=p.annotation_id AND a.version=p.version WHERE "
            "p.package_id=? "
            "UNION SELECT a.payload_json FROM annotation_snapshots a JOIN "
            "workspace_annotations wa "
            "ON a.annotation_id=wa.annotation_id AND a.version=wa.version JOIN "
            "workspaces w USING(workspace_key) WHERE w.package_id=?",
            (package_id, package_id),
        )
        annotations = {}
        for r in cursor.fetchall():
            snap = decode_snapshot(json.loads(r[0]))
            annotations[(snap.annotation.annotation_id, snap.version)] = snap

        cursor.execute(
            "SELECT e.payload_json FROM evidence_snapshots e JOIN package_evidence p "
            "ON e.evidence_id=p.evidence_id AND e.version=p.version WHERE "
            "p.package_id=? "
            "UNION SELECT e.payload_json FROM evidence_snapshots e JOIN "
            "workspace_evidence we "
            "ON e.evidence_id=we.evidence_id AND e.version=we.version JOIN workspaces "
            "w USING(workspace_key) WHERE w.package_id=?",
            (package_id, package_id),
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
            "SELECT e.payload_json FROM search_events e "
            "WHERE json_extract(e.payload_json, '$.workspace_key.package_id')=? "
            "OR EXISTS (SELECT 1 FROM package_search_events p "
            "WHERE p.event_id=e.event_id AND p.package_id=?);",
            (package_id, package_id),
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

    def get_document(self, package_id: str, document_id: str) -> Document | None:
        """Fetch a document by package and document ID."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT document_id, text, language, text_sha256 FROM documents "
            "WHERE package_id = ? AND document_id = ?;",
            (package_id, document_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return Document(
            document_id=row[0], text=row[1], language=row[2], text_sha256=row[3]
        )

    def list_documents(self, package_id: str) -> list[Document]:
        """Fetch all documents for a package."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT document_id, text, language, text_sha256 FROM documents "
            "WHERE package_id = ? ORDER BY document_id;",
            (package_id,),
        )
        return [
            Document(document_id=r[0], text=r[1], language=r[2], text_sha256=r[3])
            for r in cursor.fetchall()
        ]

    def get_annotation_snapshot(
        self, annotation_id: str, version: str
    ) -> AnnotationSnapshot | None:
        """Fetch an annotation snapshot by ID and version."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT payload_json FROM annotation_snapshots "
            "WHERE annotation_id = ? AND version = ?;",
            (annotation_id, version),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return decode_snapshot(json.loads(row[0]))

    def get_evidence_snapshot(
        self, evidence_id: str, version: str
    ) -> EvidenceSnapshot | None:
        """Fetch an evidence snapshot by ID and version."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT payload_json FROM evidence_snapshots "
            "WHERE evidence_id = ? AND version = ?;",
            (evidence_id, version),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return EvidenceSnapshot.model_validate_json(row[0])

    def list_annotations_for_document(
        self, package_id: str, document_id: str
    ) -> list[AnnotationSnapshot]:
        """Fetch all historical/imported annotation snapshots for a document."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT a.payload_json FROM annotation_snapshots a "
            "JOIN package_annotations p ON a.annotation_id=p.annotation_id AND "
            "a.version=p.version "
            "WHERE p.package_id = ? AND a.document_id = ?;",
            (package_id, document_id),
        )
        return [decode_snapshot(json.loads(r[0])) for r in cursor.fetchall()]

    def get_submissions_for_workspace(self, key: WorkspaceKey) -> list[Submission]:
        """Fetch immutable submissions through their compatible local bindings."""
        aliases = _workspace_aliases(key)
        placeholders = ",".join("?" for _ in aliases)
        rows = self.db.get_connection().execute(
            "SELECT s.payload_json FROM submissions s "
            "JOIN imported_submission_bindings b "
            f"USING(submission_id) WHERE b.local_key IN ({placeholders}) "
            "ORDER BY s.created_at ASC;",
            aliases,
        )
        return [Submission.model_validate_json(row[0]) for row in rows]

    def get_submission(self, submission_id: str) -> Submission | None:
        """Fetch a submission by ID."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT payload_json FROM submissions WHERE submission_id = ?;",
            (submission_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return Submission.model_validate_json(row[0])

    def _store_package_membership(self, package: ValidatedPackage) -> None:
        conn = self.db.get_connection()
        conn.executemany(
            "INSERT OR IGNORE INTO package_annotations VALUES (?, ?, ?)",
            [(package.manifest.package_id, *ref) for ref in package.annotations],
        )
        conn.executemany(
            "INSERT OR IGNORE INTO package_evidence VALUES (?, ?, ?)",
            [(package.manifest.package_id, *ref) for ref in package.evidence],
        )

        for event in package.search_events:
            local_key = _local_import_key(
                event.workspace_key, package.manifest.package_id
            )
            conn.execute(
                "INSERT OR IGNORE INTO package_search_events VALUES (?, ?, ?)",
                (package.manifest.package_id, event.event_id, _key_str(local_key)),
            )

    def save_search_event(self, event: SearchEventRecord) -> None:
        self.db.get_connection().execute(
            "INSERT INTO search_events VALUES (?, ?, ?, ?, ?)",
            (
                event.event_id,
                _key_str(event.workspace_key),
                event.annotation_id,
                event.model_dump_json(),
                event.timestamp,
            ),
        )

    def get_search_event(self, event_id: str) -> SearchEventRecord | None:
        row = (
            self.db.get_connection()
            .execute(
                "SELECT payload_json FROM search_events WHERE event_id=?", (event_id,)
            )
            .fetchone()
        )
        return SearchEventRecord.model_validate_json(row[0]) if row else None

    def get_search_events_for_workspace(
        self, key: WorkspaceKey
    ) -> list[SearchEventRecord]:
        aliases = _workspace_aliases(key)
        placeholders = ",".join("?" for _ in aliases)
        rows = self.db.get_connection().execute(
            "SELECT e.payload_json FROM search_events e "
            f"WHERE e.workspace_key IN ({placeholders}) "
            "OR EXISTS (SELECT 1 FROM package_search_events p "
            f"WHERE p.event_id=e.event_id AND p.local_key IN ({placeholders}))",
            (*aliases, *aliases),
        )
        return [SearchEventRecord.model_validate_json(row[0]) for row in rows]

    def _verify_existing_snapshots(self, package: ValidatedPackage) -> None:
        """Never silently keep conflicting immutable content under an existing ID."""
        conn = self.db.get_connection()
        entries = [
            ("annotation_snapshots", "annotation_id", identity, encode_snapshot(item))
            for identity, item in package.annotations.items()
        ] + [
            ("evidence_snapshots", "evidence_id", identity, item.model_dump())
            for identity, item in package.evidence.items()
        ]
        for table, column, identity, payload in entries:
            row = conn.execute(
                f"SELECT payload_json FROM {table} WHERE {column}=? AND version=?",
                identity,
            ).fetchone()
            if row and canonical_hash(json.loads(row[0])) != canonical_hash(payload):
                raise InvalidPackage("Conflicting immutable snapshot content")
        for submission in package.submissions.values():
            existing = self.get_submission(submission.submission_id)
            if existing is not None and existing != submission:
                raise InvalidPackage("Conflicting immutable submission content")
        for event in package.search_events:
            existing_event = self.get_search_event(event.event_id)
            if existing_event is not None and existing_event != event:
                raise InvalidPackage("Conflicting search event content")
