import json
import sqlite3
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.parse import quote

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import (
    AxesConfig,
)
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.documents import Document, EvidenceSnapshot
from ontocurator.domain.errors import DomainError, InvalidPackage, RevisionConflict
from ontocurator.domain.profiles import OntologyDefinition, TaskProfile, profile_hash
from ontocurator.domain.results import latest_submissions
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.scopes import build_scope
from ontocurator.domain.serialization import decode_snapshot, encode_snapshot
from ontocurator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontocurator.ontology.conditions import SearchCondition, validate_resources
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
    is_tree_walk,
)
from ontocurator.storage.sqlite_database import Database

_ESCAPED_KEY_PREFIX = "wk2|"


def _key_str(key: WorkspaceKey) -> str:
    """Encode a WorkspaceKey as the persisted workspace identity string.

    Keys whose components contain no ':' keep the historical ':'-joined form,
    so every persisted v4 workspace, submission binding, receipt and search
    event stays addressable without a migration. That form is unambiguous only
    when no component contains ':'. Any other key is percent-encoded per
    component and joined with '|' behind a prefix. The escaped form contains no
    ':' at all, so it can never equal a legacy key (which always has exactly
    five), and percent-encoding keeps it injective.
    """
    parts = [
        key.package_id,
        key.document_id,
        key.annotator_id,
        key.mode,
        key.scope_id,
        key.target_set_id,
    ]
    if not any(":" in part for part in parts):
        return ":".join(parts)
    return _ESCAPED_KEY_PREFIX + "|".join(quote(part, safe="") for part in parts)


def _same_tree_walk(stored: SearchEventRecord, incoming: SearchEventRecord) -> bool:
    """Whether two records are one tree walk seen at two moments.

    A walk only ever gains terms at the end, its two lists gain them together,
    and it lists every term once. So both records must be walks, one must be
    the later one in both lists, the earlier record's lists must be the
    beginning of the later one's, the later one must not repeat a term, and
    nothing else may differ.
    """
    # This checks the shape of a walk, not its truth: someone who edits their
    # own export can add terms the tree never showed, as they could by walking.
    if not is_tree_walk(stored) or not is_tree_walk(incoming):
        return False
    grown = {"candidates", "ranked_ids"}
    if stored.model_dump(exclude=grown) != incoming.model_dump(exclude=grown):
        return False
    earlier, later = sorted((stored, incoming), key=lambda e: len(e.candidates))
    shown, ranked = len(earlier.candidates), len(earlier.ranked_ids)
    return (
        later.candidates[:shown] == earlier.candidates
        and later.ranked_ids[:ranked] == earlier.ranked_ids
        and later.candidates[shown:] == later.ranked_ids[ranked:]
        # The added terms are new: none repeats an earlier one or another.
        and len(set(later.candidates)) == len(later.candidates)
    )


def _legacy_key_str(key: WorkspaceKey) -> str:
    """The ':'-joined form every v4 build before the escaped encoding stored.

    Identical to ``_key_str`` unless a component contains ':'; such legacy rows
    are rewritten by ``Repository.migrate_legacy_workspace_keys``.
    """
    return ":".join(
        [
            key.package_id,
            key.document_id,
            key.annotator_id,
            key.mode,
            key.scope_id,
            key.target_set_id,
        ]
    )


def _has_component_colon(column: str) -> str:
    """SQL predicate: a ':'-joined key whose components contain ':'.

    Legacy keys without ':' in a component have exactly five separators and
    escaped keys have none, so only affected legacy rows match.
    """
    return f"(length({column}) - length(replace({column}, ':', ''))) > 5"


# (table, column) pairs that persist a workspace identity string.
_KEY_COLUMNS = (
    ("workspaces", "workspace_key"),
    ("mutation_receipts", "workspace_key"),
    ("submissions", "origin_key"),
    ("imported_submission_bindings", "local_key"),
    ("search_events", "workspace_key"),
    ("package_search_events", "local_key"),
)
_WORKSPACE_CHILD_TABLES = (
    "workspace_annotations",
    "workspace_evidence",
    "workspace_decisions",
    "mutation_receipts",
)


def _local_import_key(
    origin: WorkspaceKey, package_id: str, profile: TaskProfile
) -> WorkspaceKey:
    """Bind immutable history to the imported profile's local workspace identity."""
    return origin.model_copy(
        update={
            "package_id": package_id,
            "scope_id": build_scope(profile, origin.mode).scope_id,
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
        self.migrate_legacy_workspace_keys()

    def migrate_legacy_workspace_keys(self) -> int:
        """Rewrite legacy ':'-joined identities of keys whose components contain ':'.

        Older v4 builds joined key components with ':'; the current encoding
        escapes such keys (see ``_key_str``). Without this rewrite their drafts,
        receipts, submissions and search events would be unreachable and the
        next open would create a second, empty workspace. Every identity is
        recomputed from structured data (workspace columns or JSON payloads)
        and only rewritten when its legacy string matches exactly, so keys that
        collided under the old encoding are never cross-assigned. Runs in one
        transaction, is idempotent and needs no schema change
        (``workspace_key`` already is the primary key of ``workspaces``).
        Returns the number of rewritten rows.
        """
        conn = self.db.get_connection()
        if not any(
            conn.execute(
                f"SELECT 1 FROM {table} WHERE {_has_component_colon(column)} LIMIT 1"
            ).fetchone()
            for table, column in _KEY_COLUMNS
        ):
            return 0
        conn.execute("BEGIN IMMEDIATE")
        try:
            # Parent and child keys are renamed one after another.
            conn.execute("PRAGMA defer_foreign_keys = ON")
            changed = self._rewrite_legacy_keys(conn)
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        return changed

    def _rewrite_legacy_keys(self, conn: sqlite3.Connection) -> int:
        changed = 0
        profiles: dict[str, TaskProfile | None] = {}

        def profile_of(package_id: str) -> TaskProfile | None:
            if package_id not in profiles:
                try:
                    profiles[package_id] = self.get_task_profile(package_id)
                except DomainError:
                    profiles[package_id] = None
            return profiles[package_id]

        def local_candidates(
            origin: WorkspaceKey, package_id: str
        ) -> list[WorkspaceKey]:
            candidates = [origin]
            profile = profile_of(package_id)
            if profile is not None:
                candidates.append(_local_import_key(origin, package_id, profile))
            return candidates

        def rewrite(
            table: str, column: str, where: str, args: tuple[str, ...], new: str
        ) -> None:
            nonlocal changed
            changed += conn.execute(
                f"UPDATE {table} SET {column} = ? WHERE {where}", (new, *args)
            ).rowcount

        rows = conn.execute(
            "SELECT workspace_key, package_id, document_id, annotator_id, mode, "
            "scope_id, target_set_id FROM workspaces "
            f"WHERE {_has_component_colon('workspace_key')}"
        ).fetchall()
        for row in rows:
            key = WorkspaceKey(
                package_id=row[1],
                document_id=row[2],
                annotator_id=row[3],
                mode=row[4],
                scope_id=row[5],
                target_set_id=row[6],
            )
            old, new = row[0], _key_str(key)
            if old == new or old != _legacy_key_str(key):
                continue
            if conn.execute(
                "SELECT 1 FROM workspaces WHERE workspace_key = ?", (new,)
            ).fetchone():
                if not self._is_pristine_workspace(conn, new):
                    continue  # both carry work: never merge or drop silently
                # Empty row created by a build that missed the legacy row.
                conn.execute("DELETE FROM workspaces WHERE workspace_key = ?", (new,))
            rewrite("workspaces", "workspace_key", "workspace_key = ?", (old,), new)
            for table in _WORKSPACE_CHILD_TABLES:
                rewrite(table, "workspace_key", "workspace_key = ?", (old,), new)

        rows = conn.execute(
            "SELECT submission_id, origin_key, payload_json FROM submissions "
            f"WHERE {_has_component_colon('origin_key')}"
        ).fetchall()
        for sub_id, old, payload in rows:
            origin = WorkspaceKey.model_validate(json.loads(payload)["origin_key"])
            if old == _legacy_key_str(origin):
                rewrite(
                    "submissions",
                    "origin_key",
                    "submission_id = ?",
                    (sub_id,),
                    _key_str(origin),
                )

        rows = conn.execute(
            "SELECT b.local_package_id, b.submission_id, b.local_key, s.payload_json "
            "FROM imported_submission_bindings b JOIN submissions s "
            f"USING(submission_id) WHERE {_has_component_colon('b.local_key')}"
        ).fetchall()
        for package_id, sub_id, old, payload in rows:
            origin = WorkspaceKey.model_validate(json.loads(payload)["origin_key"])
            for candidate in local_candidates(origin, package_id):
                if old == _legacy_key_str(candidate):
                    rewrite(
                        "imported_submission_bindings",
                        "local_key",
                        "local_package_id = ? AND submission_id = ?",
                        (package_id, sub_id),
                        _key_str(candidate),
                    )
                    break

        rows = conn.execute(
            "SELECT event_id, workspace_key, payload_json FROM search_events "
            f"WHERE {_has_component_colon('workspace_key')}"
        ).fetchall()
        for event_id, old, payload in rows:
            event_key = WorkspaceKey.model_validate(
                json.loads(payload)["workspace_key"]
            )
            if old == _legacy_key_str(event_key):
                rewrite(
                    "search_events",
                    "workspace_key",
                    "event_id = ?",
                    (event_id,),
                    _key_str(event_key),
                )

        rows = conn.execute(
            "SELECT p.package_id, p.event_id, p.local_key, e.payload_json "
            "FROM package_search_events p JOIN search_events e USING(event_id) "
            f"WHERE {_has_component_colon('p.local_key')}"
        ).fetchall()
        for package_id, event_id, old, payload in rows:
            event_key = WorkspaceKey.model_validate(
                json.loads(payload)["workspace_key"]
            )
            for candidate in local_candidates(event_key, package_id):
                if old == _legacy_key_str(candidate):
                    rewrite(
                        "package_search_events",
                        "local_key",
                        "package_id = ? AND event_id = ?",
                        (package_id, event_id),
                        _key_str(candidate),
                    )
                    break
        return changed

    @staticmethod
    def _is_pristine_workspace(conn: sqlite3.Connection, key_str: str) -> bool:
        """True for a workspace row that never received any work."""
        row = conn.execute(
            "SELECT revision, checked_layer_ids_json FROM workspaces "
            "WHERE workspace_key = ?",
            (key_str,),
        ).fetchone()
        if row is None or row[0] != 0 or json.loads(row[1] or "[]"):
            return False
        return not any(
            conn.execute(
                f"SELECT 1 FROM {table} WHERE workspace_key = ? LIMIT 1", (key_str,)
            ).fetchone()
            for table in _WORKSPACE_CHILD_TABLES
        )

    def import_package(
        self,
        package: ValidatedPackage,
        fallback_axes_config: AxesConfig | None = None,
    ) -> str:
        """Atomically import package into database or verify idempotency."""
        manifest_hash = self.package_manifest_hash(package)
        conn = self.db.get_connection()
        cursor = conn.cursor()

        task_profile = package.manifest.task_profile
        if task_profile is None:
            raise InvalidPackage(
                f"Package '{package.manifest.package_id}' is missing mandatory task profile"
            )
        t_hash = package.manifest.task_profile_sha256 or profile_hash(task_profile)

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
                    "SELECT profile_sha256 FROM package_task_profiles "
                    "WHERE package_id = ?;",
                    (package.manifest.package_id,),
                ).fetchone()
                if prof_row is not None and prof_row[0] != t_hash:
                    raise InvalidPackage(
                        "Conflicting task profile resolution for existing package"
                    )
                self._verify_existing_package_content(package)
                self._store_ontology_resources(package)
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
                "INSERT INTO package_task_profiles "
                "(package_id, profile_json, profile_sha256) VALUES (?, ?, ?);",
                (
                    package.manifest.package_id,
                    task_profile.model_dump_json(),
                    t_hash,
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
                checked_ids = getattr(sub, "checked_layer_ids", [])
                cursor.execute(
                    "INSERT OR IGNORE INTO submissions (submission_id, origin_key, "
                    "targets_json, draft_revision, checked_layer_ids_json, payload_json, "
                    "created_at) VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (
                        sub.submission_id,
                        _key_str(sub.origin_key),
                        json.dumps(sub.targets.model_dump()),
                        sub.draft_revision,
                        json.dumps(checked_ids),
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
                                sub.origin_key,
                                package.manifest.package_id,
                                task_profile,
                            )
                        ),
                    ),
                )

            for event in package.search_events:
                cursor.execute(
                    "INSERT OR IGNORE INTO search_events "
                    "(event_id, workspace_key, annotation_id, layer_id, "
                    "ontology_sha256, payload_json, timestamp) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (
                        event.event_id,
                        _key_str(event.workspace_key),
                        event.annotation_id,
                        getattr(event, "layer_id", None),
                        getattr(event, "ontology_sha256", None),
                        json.dumps(event.model_dump()),
                        event.timestamp,
                    ),
                )

            self._store_ontology_resources(package)
            self._store_package_membership(package)
            cursor.execute("COMMIT;")
            return package.manifest.package_id
        except Exception:
            cursor.execute("ROLLBACK;")
            raise

    def _verify_existing_package_content(self, package: ValidatedPackage) -> None:
        """Re-import is idempotent only if the datasets equal the installed ones.

        Archives read from disk carry mandatory per-file digests inside the
        manifest, so a changed dataset already changes the manifest hash. This
        check also covers in-memory packages whose manifest has no digests.
        """
        conn = self.db.get_connection()
        package_id = package.manifest.package_id
        stored_docs = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT document_id, text_sha256 FROM documents WHERE package_id=?",
                (package_id,),
            )
        }
        stored_annotations = {
            (row[0], row[1])
            for row in conn.execute(
                "SELECT annotation_id, version FROM package_annotations "
                "WHERE package_id=?",
                (package_id,),
            )
        }
        stored_evidence = {
            (row[0], row[1])
            for row in conn.execute(
                "SELECT evidence_id, version FROM package_evidence WHERE package_id=?",
                (package_id,),
            )
        }
        stored_events = {
            row[0]
            for row in conn.execute(
                "SELECT event_id FROM package_search_events WHERE package_id=?",
                (package_id,),
            )
        }
        bound_submissions = {
            row[0]
            for row in conn.execute(
                "SELECT submission_id FROM imported_submission_bindings "
                "WHERE local_package_id=?",
                (package_id,),
            )
        }
        if (
            stored_docs
            != {d.document_id: d.text_sha256 for d in package.documents.values()}
            or stored_annotations != set(package.annotations)
            or stored_evidence != set(package.evidence)
            or stored_events != {e.event_id for e in package.search_events}
            or not set(package.submissions) <= bound_submissions
        ):
            raise InvalidPackage(
                f"Package '{package_id}' exists with identical manifest but "
                "different dataset content"
            )

    def _store_ontology_resources(self, package: ValidatedPackage) -> None:
        """Persist resources inside the same transaction as their package."""
        if package.manifest.search_conditions is not None:
            assert package.manifest.task_profile is not None
            validate_resources(
                package.manifest.search_conditions,
                package.manifest.task_profile,
                package.embedded_files,
            )
            existing = self.get_search_conditions(package.manifest.package_id)
            if existing is not None and existing != package.manifest.search_conditions:
                raise InvalidPackage("Conflicting immutable package search conditions")
            self.db.get_connection().execute(
                "INSERT OR IGNORE INTO package_search_conditions VALUES (?, ?)",
                (
                    package.manifest.package_id,
                    json.dumps(
                        [c.model_dump() for c in package.manifest.search_conditions]
                    ),
                ),
            )
        self.db.get_connection().executemany(
            "INSERT OR IGNORE INTO package_ontology_resources "
            "(package_id, resource_path, content) VALUES (?, ?, ?)",
            [
                (package.manifest.package_id, path, data)
                for path, data in package.embedded_files.items()
            ],
        )

    def get_search_conditions(self, package_id: str) -> list[SearchCondition] | None:
        row = (
            self.db.get_connection()
            .execute(
                "SELECT payload_json FROM package_search_conditions WHERE package_id=?",
                (package_id,),
            )
            .fetchone()
        )
        return (
            [SearchCondition.model_validate(c) for c in json.loads(row[0])]
            if row
            else None
        )

    def capture_search_conditions(
        self,
        package_id: str,
        conditions: list[SearchCondition],
        resources: dict[str, bytes],
    ) -> list[SearchCondition]:
        """Insert first-use capture atomically without rewriting source manifests.

        Call before entering a draft mutation transaction. Concurrent captures
        return the first committed condition set rather than replacing it.
        """
        validate_resources(conditions, self.get_task_profile(package_id), resources)
        conn = self.db.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        try:
            existing = self.get_search_conditions(package_id)
            if existing is None:
                conn.execute(
                    "INSERT INTO package_search_conditions VALUES (?, ?)",
                    (package_id, json.dumps([c.model_dump() for c in conditions])),
                )
                conn.executemany(
                    "INSERT OR IGNORE INTO package_ontology_resources VALUES (?, ?, ?)",
                    [(package_id, path, data) for path, data in resources.items()],
                )
                existing = conditions
            conn.execute("COMMIT")
            return existing
        except BaseException:
            conn.execute("ROLLBACK")
            raise

    def get_embedded_files(self, package_id: str) -> dict[str, bytes]:
        rows = (
            self.db.get_connection()
            .execute(
                "SELECT resource_path, content FROM package_ontology_resources WHERE package_id=?",
                (package_id,),
            )
            .fetchall()
        )
        return {row[0]: bytes(row[1]) for row in rows}

    def ontology_resources(self) -> list[tuple[OntologyDefinition, bytes]]:
        """Return persisted definitions and bytes for registry restoration at startup."""
        rows = (
            self.db.get_connection()
            .execute(
                "SELECT p.profile_json, r.resource_path, r.content "
                "FROM package_ontology_resources r JOIN package_task_profiles p "
                "ON r.package_id=p.package_id"
            )
            .fetchall()
        )
        result = []
        for row in rows:
            profile = TaskProfile.model_validate_json(row[0])
            for ont in profile.ontologies:
                if ont.resource_path == row[1]:
                    result.append((ont, bytes(row[2])))
        return result

    def get_manifest(self, package_id: str) -> PackageManifest:
        """Return the stored manifest of an installed package."""
        row = (
            self.db.get_connection()
            .execute(
                "SELECT manifest_json FROM packages WHERE package_id = ?;",
                (package_id,),
            )
            .fetchone()
        )
        if row is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{package_id}'"
            )
        return PackageManifest.model_validate_json(row[0])

    def manifest_hash(self, package_id: str) -> str | None:
        """Canonical manifest hash of an installed package, or None if absent."""
        row = (
            self.db.get_connection()
            .execute(
                "SELECT manifest_hash FROM packages WHERE package_id = ?;",
                (package_id,),
            )
            .fetchone()
        )
        return None if row is None else str(row[0])

    @staticmethod
    def package_manifest_hash(package: ValidatedPackage) -> str:
        """The hash :meth:`import_package` stores for ``package``."""
        return canonical_hash(package.manifest.model_dump())

    def list_manifests(self) -> list[PackageManifest]:
        """Return manifests of all installed packages, newest first."""
        rows = self.db.get_connection().execute(
            "SELECT manifest_json FROM packages ORDER BY created_at DESC;"
        )
        return [PackageManifest.model_validate_json(row[0]) for row in rows]

    def list_workspace_keys(
        self,
        package_id: str,
        annotator_id: str,
        mode: str | None = None,
        document_id: str | None = None,
    ) -> list[WorkspaceKey]:
        """Return local workspace identities of one annotator, matched exactly.

        Includes opened workspaces and the local bindings of submissions
        (local or imported) whose origin belongs to this annotator.
        """
        conn = self.db.get_connection()
        keys: dict[str, WorkspaceKey] = {}
        rows = conn.execute(
            "SELECT package_id, document_id, annotator_id, mode, scope_id, "
            "target_set_id FROM workspaces "
            "WHERE package_id = ? AND annotator_id = ? "
            "AND (? IS NULL OR mode = ?) AND (? IS NULL OR document_id = ?);",
            (package_id, annotator_id, mode, mode, document_id, document_id),
        )
        for row in rows:
            key = WorkspaceKey(
                package_id=row[0],
                document_id=row[1],
                annotator_id=row[2],
                mode=row[3],
                scope_id=row[4],
                target_set_id=row[5],
            )
            keys[_key_str(key)] = key

        profile = self.get_task_profile(package_id)
        rows = conn.execute(
            "SELECT s.payload_json FROM submissions s "
            "JOIN imported_submission_bindings b USING(submission_id) "
            "WHERE b.local_package_id = ? "
            "AND json_extract(s.payload_json, '$.origin_key.annotator_id') = ? "
            "AND (? IS NULL OR json_extract(s.payload_json, '$.origin_key.mode') = ?) "
            "AND (? IS NULL OR json_extract(s.payload_json, '$.origin_key.document_id') = ?);",
            (package_id, annotator_id, mode, mode, document_id, document_id),
        )
        for row in rows:
            origin = WorkspaceKey.model_validate(json.loads(row[0])["origin_key"])
            key = (
                origin
                if origin.package_id == package_id
                else _local_import_key(origin, package_id, profile)
            )
            keys.setdefault(_key_str(key), key)
        return sorted(
            keys.values(),
            key=lambda k: (k.document_id, k.mode, k.scope_id, k.target_set_id),
        )

    def get_task_profile(self, package_id: str) -> TaskProfile:
        """Return the resolved TaskProfile for an installed package."""
        conn = self.db.get_connection()
        row = conn.execute(
            "SELECT profile_json FROM package_task_profiles WHERE package_id = ?;",
            (package_id,),
        ).fetchone()
        if row is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND",
                f"No package or task profile found for package '{package_id}'",
            )
        return TaskProfile.model_validate_json(row[0])

    def get_axes_config(self, package_id: str) -> AxesConfig:
        """Return AxesConfig synthesized from package task profile for backwards compatibility."""
        tp = self.get_task_profile(package_id)
        name = tp.preset or "custom"
        for layer in tp.layers:
            for at in layer.annotation_types:
                if at.axes:
                    return AxesConfig(definition_name=name, axes=at.axes)
        return AxesConfig(definition_name=name, axes=[])

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
            "SELECT revision, checked_layer_ids_json, targets_json "
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
                "mode, scope_id, target_set_id, targets_json, revision, "
                "checked_layer_ids_json, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', ?);",
                (
                    k_str,
                    key.package_id,
                    key.document_id,
                    key.annotator_id,
                    key.mode,
                    key.scope_id,
                    key.target_set_id,
                    json.dumps(effective_targets.model_dump()),
                    now,
                ),
            )
            submissions = self.get_submissions_for_workspace(key)
            if submissions:
                current = latest_submissions(submissions)
                if len(current) != 1:
                    raise DomainError(
                        "AMBIGUOUS_SUBMISSION_ORIGIN",
                        {
                            "message": "Cannot restore multiple submission origins into one draft",
                            "origins": [s.origin_key.model_dump() for s in current],
                        },
                    )
                latest = current[0]
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
                    "UPDATE workspaces SET targets_json=?, revision=?, checked_layer_ids_json=? WHERE workspace_key=?",
                    (
                        latest.targets.model_dump_json(),
                        latest.draft_revision,
                        json.dumps(latest.checked_layer_ids),
                        k_str,
                    ),
                )
            return self._open_draft(key, targets)

        revision = int(row[0])
        checked_layers = json.loads(row[1]) if row[1] else []
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
            checked_layer_ids=checked_layers,
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
                    "SET revision = ?, checked_layer_ids_json = ?, updated_at = ? "
                    "WHERE workspace_key = ?;",
                    (
                        new_revision,
                        json.dumps(result.checked_layer_ids),
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
                    "draft_revision, checked_layer_ids_json, payload_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?);",
                    (
                        result.submission_id,
                        _key_str(result.origin_key),
                        json.dumps(result.targets.model_dump()),
                        result.draft_revision,
                        json.dumps(getattr(result, "checked_layer_ids", [])),
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

    def export_package(
        self, package_id: str, *, include_captured_conditions: bool = True
    ) -> ValidatedPackage:
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

        if include_captured_conditions:
            conditions = self.get_search_conditions(package_id)
            if conditions is not None:
                manifest = manifest.model_copy(update={"search_conditions": conditions})

        declared_search_resources = {
            item.resource_path
            for condition in manifest.search_conditions or []
            for item in condition.translations
        }
        # A first capture can commit after the condition read above. Its bytes
        # are only part of this export if this manifest observed their declaration.
        embedded_files = {
            path: content
            for path, content in self.get_embedded_files(package_id).items()
            if not path.startswith("search-resources/")
            or path in declared_search_resources
        }

        return ValidatedPackage(
            manifest=manifest,
            documents=documents,
            annotations=annotations,
            evidence=evidence,
            submissions=submissions,
            search_events=search_events,
            embedded_files=embedded_files,
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
        """Fetch all documents for a package, preserving document_order if present."""
        conn = self.db.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT manifest_json FROM packages WHERE package_id = ?;",
            (package_id,),
        )
        row = cursor.fetchone()
        order_map: dict[str, int] = {}
        if row is not None:
            m = json.loads(row[0])
            for idx, doc_id in enumerate(m.get("document_order", [])):
                order_map[doc_id] = idx

        cursor.execute(
            "SELECT document_id, text, language, text_sha256 FROM documents "
            "WHERE package_id = ?;",
            (package_id,),
        )
        docs = [
            Document(document_id=r[0], text=r[1], language=r[2], text_sha256=r[3])
            for r in cursor.fetchall()
        ]
        if order_map:
            docs.sort(key=lambda d: order_map.get(d.document_id, 999999))
        else:
            docs.sort(key=lambda d: d.document_id)
        return docs

    def get_document_status(
        self,
        package_id: str,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> Literal["not_started", "in_progress", "completed"]:
        """Compute document progress status strictly isolated to annotator and mode."""
        conn = self.db.get_connection()
        any_completed = False
        for key in self.list_workspace_keys(
            package_id, annotator_id, mode, document_id
        ):
            if key.document_id != document_id:
                continue
            current = latest_submissions(self.get_submissions_for_workspace(key))
            row = conn.execute(
                "SELECT revision, checked_layer_ids_json FROM workspaces WHERE workspace_key=?",
                (_key_str(key),),
            ).fetchone()
            if current:
                any_completed = True
                # Never compare a draft revision across unrelated origin branches.
                if row is not None and (
                    len(current) != 1 or row[0] > current[0].draft_revision
                ):
                    return "in_progress"
                continue
            if row is None:
                continue
            if row[0] > 0 or json.loads(row[1] or "[]"):
                return "in_progress"
            for table in ("workspace_annotations", "workspace_decisions"):
                if conn.execute(
                    f"SELECT 1 FROM {table} WHERE workspace_key=? LIMIT 1",
                    (_key_str(key),),
                ).fetchone():
                    return "in_progress"
        return "completed" if any_completed else "not_started"

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

    def get_submissions_for_document(
        self, package_id: str, document_id: str
    ) -> list[Submission]:
        """Read only immutable submissions locally bound to this document."""
        rows = self.db.get_connection().execute(
            "SELECT s.payload_json FROM submissions s "
            "JOIN imported_submission_bindings b USING(submission_id) "
            "WHERE b.local_package_id=? "
            "AND json_extract(s.payload_json, '$.origin_key.document_id')=?;",
            (package_id, document_id),
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
        profile = package.manifest.task_profile
        if profile is None:
            raise InvalidPackage("Package task profile is required")
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
                event.workspace_key, package.manifest.package_id, profile
            )
            conn.execute(
                "INSERT OR IGNORE INTO package_search_events VALUES (?, ?, ?)",
                (package.manifest.package_id, event.event_id, _key_str(local_key)),
            )

    def save_search_event(self, event: SearchEventRecord) -> None:
        self.db.get_connection().execute(
            "INSERT INTO search_events (event_id, workspace_key, annotation_id, "
            "layer_id, ontology_sha256, payload_json, timestamp) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                event.event_id,
                _key_str(event.workspace_key),
                event.annotation_id,
                getattr(event, "layer_id", None),
                getattr(event, "ontology_sha256", None),
                event.model_dump_json(),
                event.timestamp,
            ),
        )

    def append_search_event_candidates(
        self,
        event_id: str,
        term_ids: Iterable[str],
        *,
        workspace_key: WorkspaceKey | None = None,
        annotation_id: str | None = None,
        layer_id: str | None = None,
    ) -> SearchEventRecord | None:
        """Add newly shown terms to a stored tree walk, in order of first appearance.

        A search event is written once. The one exception is a walk through the
        tree: what it showed grows with every node that is opened, and the
        selection made from it has to find those terms among its candidates.

        Only a walk grows: an event of another route, or the copy written for a
        selection, is left alone. ``workspace_key``, ``annotation_id`` and
        ``layer_id`` name the owner the caller acts for; the event must belong
        to each one that is given. Returns None, and stores nothing, for an
        unknown event and for one that fails these checks.

        The checks, the read and the write happen in one transaction, so two
        requests of the same walk cannot lose each other's terms.
        """
        conn = self.db.get_connection()
        conn.execute("BEGIN IMMEDIATE")
        try:
            event = self.get_search_event(event_id)
            if event is not None and (
                not is_tree_walk(event)
                or (workspace_key is not None and event.workspace_key != workspace_key)
                or (annotation_id is not None and event.annotation_id != annotation_id)
                or (layer_id is not None and event.layer_id != layer_id)
            ):
                event = None
            if event is not None:
                known = set(event.candidates)
                added = [t for t in dict.fromkeys(term_ids) if t not in known]
                if added:
                    event.candidates = [*event.candidates, *added]
                    event.ranked_ids = [*event.ranked_ids, *added]
                    conn.execute(
                        "UPDATE search_events SET payload_json=? WHERE event_id=?",
                        (event.model_dump_json(), event_id),
                    )
            conn.execute("COMMIT")
            return event
        except Exception:
            conn.execute("ROLLBACK")
            raise

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
            if existing_event is None or existing_event == event:
                continue
            if not _same_tree_walk(existing_event, event):
                raise InvalidPackage("Conflicting search event content")
            # Two exports of one walk through the tree, taken at different
            # moments: keep the one that has seen more.
            if len(event.candidates) > len(existing_event.candidates):
                conn.execute(
                    "UPDATE search_events SET payload_json=? WHERE event_id=?",
                    (event.model_dump_json(), event.event_id),
                )
