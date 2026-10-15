"""PostgreSQL repository for projects, revisioned drafts and immutable submissions.

A project replaces the desktop editor's work package: ``package_id`` in
``WorkspaceKey`` and in the method names below is the project key (T2 index
decision D-e). Every query is filtered by project. Snapshots and submissions
are append-only (T2 D6): the application role can only insert and read them.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, cast
from urllib.parse import quote

from sqlalchemy import (
    Connection,
    Row,
    and_,
    delete,
    exists,
    func,
    insert,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontocurator.auth.context import current_principal
from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.axes import AxesConfig
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
from ontocurator.exchange.t1 import (
    ImportCounts,
    ImportedDocument,
    ImportedSet,
    Pin,
    T1Profile,
    check_t1_profile,
)
from ontocurator.ontology.conditions import SearchCondition, validate_resources
from ontocurator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
    is_tree_walk,
)
from ontocurator.storage.database import Database, advisory_lock_id
from ontocurator.storage.tables import (
    AnnotationSnapshotRow,
    DocumentRow,
    DraftAnnotationRow,
    DraftEvidenceRow,
    DraftRow,
    EditEventRow,
    EvidenceSnapshotRow,
    MutationReceiptRow,
    OntologyFileRow,
    ProjectOntologyRow,
    ProjectResourceRow,
    ProjectRow,
    ProjectSearchConditionsRow,
    ProposalAnnotationRow,
    ProposalEvidenceRow,
    ProposalSetRow,
    ReviewDecisionRow,
    SearchEventRow,
    StoredFileRow,
    SubmissionRow,
    UserRow,
)

_ESCAPED_KEY_PREFIX = "wk2|"


def _key_str(key: WorkspaceKey) -> str:
    """The persisted identity of a workspace key.

    Keys whose components contain no ':' use the ':'-joined form. Any other
    key is percent-encoded per component and joined with '|' behind a prefix,
    which keeps the encoding injective.
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
    and it lists every term once.
    """
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
        and len(set(later.candidates)) == len(later.candidates)
    )


def _local_import_key(
    origin: WorkspaceKey, package_id: str, profile: TaskProfile
) -> WorkspaceKey:
    """Bind imported history to the importing project's workspace identity."""
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
    """Both historical empty-target and API-default independent bindings."""
    keys = {_key_str(key)}
    if key.mode == "independent":
        for target_id in ("targets-0", ReviewTargetSet.create([]).target_set_id):
            keys.add(_key_str(key.model_copy(update={"target_set_id": target_id})))
    return tuple(sorted(keys))


_lock_id = advisory_lock_id


# Search event IDs are global, but the primary key is per project. Writers that
# check an ID and then insert it hold this lock until they commit: local saves
# shared (they bring fresh IDs, so they need not wait for each other), imports
# exclusive (they bring external IDs, so no local save may check in between).
# One lock for all IDs keeps a large import at one lock and costs local saves
# only the wait for an import with search events, which are serialised anyway.
# Lock order: "import", "project", this lock, then search event rows.
SEARCH_EVENT_IDENTITY_LOCK = _lock_id("search-event-identity")


def _submission_payload(submission: Submission) -> dict[str, Any]:
    payload = submission.model_dump(mode="json")
    payload["snapshots"] = [encode_snapshot(s) for s in submission.snapshots]
    return payload


def _draft_payload(draft: Draft) -> dict[str, Any]:
    payload = draft.model_dump(mode="json")
    payload["annotations"] = [encode_snapshot(a) for a in draft.annotations]
    return payload


@dataclass(frozen=True)
class DraftState:
    """The complete content of a draft at one revision (``edit_events.state``).

    Annotations and evidence are sorted ``(id, version)`` pairs of the
    content-addressed snapshots, so a revision is reconstructed by a lookup.
    """

    annotations: tuple[tuple[str, str], ...] = ()
    evidence: tuple[tuple[str, str], ...] = ()
    decisions: tuple[dict[str, Any], ...] = ()
    checked_layer_ids: tuple[str, ...] = ()

    @classmethod
    def of(cls, draft: Draft) -> DraftState:
        return cls(
            annotations=tuple(
                sorted(
                    (a.annotation.annotation_id, a.version) for a in draft.annotations
                )
            ),
            evidence=tuple(
                sorted((e.mention.evidence_id, e.version) for e in draft.evidence)
            ),
            decisions=tuple(d.model_dump(mode="json") for d in draft.decisions),
            checked_layer_ids=tuple(draft.checked_layer_ids),
        )

    @classmethod
    def from_json(cls, stored: dict[str, Any]) -> DraftState:
        return cls(
            annotations=tuple((str(i), str(v)) for i, v in stored["annotations"]),
            evidence=tuple((str(i), str(v)) for i, v in stored["evidence"]),
            decisions=tuple(stored["decisions"]),
            checked_layer_ids=tuple(stored["checked_layer_ids"]),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "annotations": [list(pair) for pair in self.annotations],
            "evidence": [list(pair) for pair in self.evidence],
            "decisions": list(self.decisions),
            "checked_layer_ids": list(self.checked_layer_ids),
        }


@dataclass(frozen=True)
class ProjectInfo:
    """A project as the project list shows it."""

    project_key: str
    name: str
    description: str | None
    document_count: int


@dataclass(frozen=True)
class ProjectExport:
    """What a T1 export reads from a project (T2d Task 5).

    ``submissions`` holds the latest submission per document, annotator and
    mode; ``contributors`` the (pseudonym, name, ORCID) of the consenting
    annotators among them.
    """

    profile: TaskProfile
    pins: dict[str, Pin]
    documents: dict[str, ImportedDocument]
    submissions: list[Submission]
    proposals: dict[tuple[str, str], AnnotationSnapshot]
    contributors: list[tuple[str, str, str | None]]


@dataclass(frozen=True)
class EditEvent:
    """One row of the edit log (``edit_events``)."""

    id: int
    project_id: int
    draft_id: int
    user_id: int | None
    session_id: int | None
    at: datetime
    mutation_id: str
    kind: str
    command: dict[str, Any]
    revision_before: int
    revision_after: int
    state: dict[str, Any]
    submission_id: str | None


class Repository:
    """Projects, drafts, submissions and search provenance in PostgreSQL."""

    def __init__(self, db: Database) -> None:
        self.db = db

    # --- projects ---------------------------------------------------------- #

    @staticmethod
    def _project_id(conn: Connection, package_id: str) -> int | None:
        return conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == package_id)
        ).scalar_one_or_none()

    def _require_project(self, conn: Connection, package_id: str) -> int:
        project_id = self._project_id(conn, package_id)
        if project_id is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{package_id}'"
            )
        return project_id

    @staticmethod
    def package_manifest_hash(package: ValidatedPackage) -> str:
        """The hash :meth:`import_package` stores for ``package``."""
        return canonical_hash(package.manifest.model_dump())

    def import_package(
        self,
        package: ValidatedPackage,
        fallback_axes_config: AxesConfig | None = None,
        *,
        on_create: Callable[[Connection, int], None] | None = None,
    ) -> str:
        """Create the project of an in-memory seed package, or verify an identical one.

        Re-importing a manifest is idempotent only if every dataset is equal.
        ``on_create`` runs with the new project's ID in the creating
        transaction, and only when the project is new.
        """
        del fallback_axes_config  # profiles carry their axes; kept for callers
        manifest = package.manifest
        profile = manifest.task_profile
        if profile is None:
            raise InvalidPackage(
                f"Package '{manifest.package_id}' is missing mandatory task profile"
            )
        manifest_hash = self.package_manifest_hash(package)
        profile_sha = manifest.task_profile_sha256 or profile_hash(profile)
        if manifest.search_conditions is not None:
            validate_resources(
                manifest.search_conditions, profile, package.embedded_files
            )
        files = {
            path: (self.db.blobs.put(data), len(data))
            for path, data in package.embedded_files.items()
        }
        with self.db.transaction() as conn:
            # Content identities are global, so imports of any two projects
            # check and write them one after the other.
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(_lock_id("project", manifest.package_id))
                )
            )
            if package.search_events:
                conn.execute(
                    select(func.pg_advisory_xact_lock(SEARCH_EVENT_IDENTITY_LOCK))
                )
            self._verify_existing_snapshots(
                conn, package, self._project_id(conn, manifest.package_id)
            )
            existing = conn.execute(
                select(
                    ProjectRow.id,
                    ProjectRow.manifest_sha256,
                    ProjectRow.task_profile_sha256,
                ).where(ProjectRow.project_key == manifest.package_id)
            ).one_or_none()
            if existing is not None:
                if existing.manifest_sha256 != manifest_hash:
                    raise InvalidPackage(
                        f"Package '{manifest.package_id}' exists with "
                        "different manifest hash"
                    )
                if existing.task_profile_sha256 != profile_sha:
                    raise InvalidPackage(
                        "Conflicting task profile resolution for existing package"
                    )
                self._verify_existing_package_content(conn, existing.id, package)
                self._store_resources(
                    conn, existing.id, manifest.search_conditions, files
                )
                return manifest.package_id
            project_id = conn.execute(
                insert(ProjectRow)
                .values(
                    project_key=manifest.package_id,
                    name=manifest.package_id,
                    manifest=manifest.model_dump(mode="json"),
                    manifest_sha256=manifest_hash,
                    task_profile=profile.model_dump(mode="json"),
                    task_profile_sha256=profile_sha,
                )
                .returning(ProjectRow.id)
            ).scalar_one()
            self._insert_project_content(conn, project_id, package, profile)
            self._store_resources(conn, project_id, manifest.search_conditions, files)
            if on_create is not None:
                on_create(conn, project_id)
        return manifest.package_id

    def _insert_project_content(
        self,
        conn: Connection,
        project_id: int,
        package: ValidatedPackage,
        profile: TaskProfile,
    ) -> None:
        package_id = package.manifest.package_id
        order = {
            doc_id: index
            for index, doc_id in enumerate(package.manifest.document_order)
        }
        documents = [
            {
                "project_id": project_id,
                "document_id": doc.document_id,
                "position": order.get(doc.document_id),
                "language": doc.language,
                "text": doc.text,
                "text_sha256": doc.text_sha256,
            }
            for doc in package.documents.values()
        ]
        if documents:
            conn.execute(insert(DocumentRow), documents)
        self._insert_snapshots(
            conn, project_id, package.annotations.values(), package.evidence.values()
        )
        if package.annotations:
            conn.execute(
                insert(ProposalAnnotationRow),
                [
                    {"project_id": project_id, "annotation_id": a, "version": v}
                    for a, v in package.annotations
                ],
            )
        if package.evidence:
            conn.execute(
                insert(ProposalEvidenceRow),
                [
                    {"project_id": project_id, "evidence_id": e, "version": v}
                    for e, v in package.evidence
                ],
            )
        for submission in package.submissions.values():
            local = _local_import_key(submission.origin_key, package_id, profile)
            self._insert_submission(
                conn, project_id, submission, local_key=_key_str(local), imported=True
            )
        for event in package.search_events:
            local = _local_import_key(event.workspace_key, package_id, profile)
            self._insert_search_event(
                conn,
                project_id,
                event,
                local_key=_key_str(local),
                imported=True,
            )

    def _verify_existing_snapshots(
        self, conn: Connection, package: ValidatedPackage, project_id: int | None
    ) -> None:
        """Never keep conflicting immutable content under an existing identity.

        Identities are global, as in the desktop workspace: a snapshot,
        submission or search event of any project with the same identity must
        have the same content; a tree walk may be the same walk seen at another
        moment. Copies of a walk grow per project: a re-import into the
        importing project (``project_id``, None for a new one) keeps the longer
        state of its own copy, and no other project's copy is changed or handed
        to the importing project.
        """
        self._verify_snapshot_contents(
            conn, package.annotations.values(), package.evidence.values()
        )
        for submission in package.submissions.values():
            for stored in conn.execute(
                select(SubmissionRow.payload).where(
                    SubmissionRow.submission_id == submission.submission_id
                )
            ).scalars():
                if Submission.model_validate(stored) != submission:
                    raise InvalidPackage("Conflicting immutable submission content")
        for event in package.search_events:
            # Lock the stored copies so that a concurrent append cannot be
            # overwritten by the update below.
            rows = conn.execute(
                select(SearchEventRow.project_id, SearchEventRow.payload)
                .where(SearchEventRow.event_id == event.event_id)
                .order_by(SearchEventRow.project_id)
                .with_for_update()
            ).all()
            copies = [
                (row.project_id, SearchEventRecord.model_validate(row.payload))
                for row in rows
            ]
            for copy_project_id, existing in copies:
                if existing == event:
                    continue
                if not _same_tree_walk(existing, event):
                    raise InvalidPackage("Conflicting search event content")
                if copy_project_id == project_id and len(event.candidates) > len(
                    existing.candidates
                ):
                    conn.execute(
                        update(SearchEventRow)
                        .where(
                            SearchEventRow.project_id == project_id,
                            SearchEventRow.event_id == event.event_id,
                        )
                        .values(payload=event.model_dump(mode="json"))
                    )

    @staticmethod
    def _verify_snapshot_contents(
        conn: Connection,
        annotations: Iterable[AnnotationSnapshot],
        evidence: Iterable[EvidenceSnapshot],
    ) -> None:
        """A known snapshot identity of any project must have the same content."""
        for snap in annotations:
            expected = canonical_hash(encode_snapshot(snap))
            for stored in conn.execute(
                select(AnnotationSnapshotRow.payload).where(
                    AnnotationSnapshotRow.annotation_id
                    == snap.annotation.annotation_id,
                    AnnotationSnapshotRow.version == snap.version,
                )
            ).scalars():
                if canonical_hash(stored) != expected:
                    raise InvalidPackage("Conflicting immutable snapshot content")
        for ev in evidence:
            expected = canonical_hash(ev.model_dump())
            for stored in conn.execute(
                select(EvidenceSnapshotRow.payload).where(
                    EvidenceSnapshotRow.evidence_id == ev.mention.evidence_id,
                    EvidenceSnapshotRow.version == ev.version,
                )
            ).scalars():
                if canonical_hash(stored) != expected:
                    raise InvalidPackage("Conflicting immutable snapshot content")

    @staticmethod
    def _verify_existing_package_content(
        conn: Connection, project_id: int, package: ValidatedPackage
    ) -> None:
        """A re-import is idempotent only if its datasets equal the installed ones."""
        stored_docs = dict(
            conn.execute(
                select(DocumentRow.document_id, DocumentRow.text_sha256).where(
                    DocumentRow.project_id == project_id
                )
            )
            .tuples()
            .all()
        )
        stored_annotations = set(
            conn.execute(
                select(
                    ProposalAnnotationRow.annotation_id, ProposalAnnotationRow.version
                ).where(ProposalAnnotationRow.project_id == project_id)
            )
            .tuples()
            .all()
        )
        stored_evidence = set(
            conn.execute(
                select(
                    ProposalEvidenceRow.evidence_id, ProposalEvidenceRow.version
                ).where(ProposalEvidenceRow.project_id == project_id)
            )
            .tuples()
            .all()
        )
        stored_events = set(
            conn.execute(
                select(SearchEventRow.event_id).where(
                    SearchEventRow.project_id == project_id,
                    SearchEventRow.imported.is_(True),
                )
            ).scalars()
        )
        bound_submissions = set(
            conn.execute(
                select(SubmissionRow.submission_id).where(
                    SubmissionRow.project_id == project_id
                )
            ).scalars()
        )
        if (
            stored_docs
            != {d.document_id: d.text_sha256 for d in package.documents.values()}
            or stored_annotations != set(package.annotations)
            or stored_evidence != set(package.evidence)
            or stored_events != {e.event_id for e in package.search_events}
            or not set(package.submissions) <= bound_submissions
        ):
            raise InvalidPackage(
                f"Package '{package.manifest.package_id}' exists with identical "
                "manifest but different dataset content"
            )

    def _store_resources(
        self,
        conn: Connection,
        project_id: int,
        conditions: list[SearchCondition] | None,
        files: dict[str, tuple[str, int]],
    ) -> None:
        if conditions is not None:
            existing = self._search_conditions(conn, project_id)
            if existing is not None and existing != conditions:
                raise InvalidPackage("Conflicting immutable package search conditions")
            conn.execute(
                pg_insert(ProjectSearchConditionsRow)
                .values(
                    project_id=project_id,
                    conditions=[c.model_dump(mode="json") for c in conditions],
                )
                .on_conflict_do_nothing()
            )
        self._store_files(conn, project_id, files)

    @staticmethod
    def _store_files(
        conn: Connection, project_id: int, files: dict[str, tuple[str, int]]
    ) -> None:
        if not files:
            return
        conn.execute(
            pg_insert(StoredFileRow).on_conflict_do_nothing(),
            [{"sha256": sha, "size": size} for sha, size in files.values()],
        )
        conn.execute(
            pg_insert(ProjectResourceRow).on_conflict_do_nothing(),
            [
                {"project_id": project_id, "resource_path": path, "sha256": sha}
                for path, (sha, _size) in files.items()
            ],
        )

    @staticmethod
    def _search_conditions(
        conn: Connection, project_id: int
    ) -> list[SearchCondition] | None:
        stored = conn.execute(
            select(ProjectSearchConditionsRow.conditions).where(
                ProjectSearchConditionsRow.project_id == project_id
            )
        ).scalar_one_or_none()
        if stored is None:
            return None
        return [SearchCondition.model_validate(c) for c in stored]

    def get_search_conditions(self, package_id: str) -> list[SearchCondition] | None:
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, package_id)
            if project_id is None:
                return None
            return self._search_conditions(conn, project_id)

    def capture_search_conditions(
        self,
        package_id: str,
        conditions: list[SearchCondition],
        resources: dict[str, bytes],
    ) -> list[SearchCondition]:
        """Store first-use conditions once; concurrent captures get the first ones."""
        validate_resources(conditions, self.get_task_profile(package_id), resources)
        files = {
            path: (self.db.blobs.put(data), len(data))
            for path, data in resources.items()
        }
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            inserted = conn.execute(
                pg_insert(ProjectSearchConditionsRow)
                .values(
                    project_id=project_id,
                    conditions=[c.model_dump(mode="json") for c in conditions],
                )
                .on_conflict_do_nothing()
                .returning(ProjectSearchConditionsRow.project_id)
            ).scalar_one_or_none()
            if inserted is None:
                existing = self._search_conditions(conn, project_id)
                if existing is None:
                    raise DomainError("SEARCH_CONDITIONS_MISSING", package_id)
                return existing
            self._store_files(conn, project_id, files)
            return conditions

    def get_embedded_files(self, package_id: str) -> dict[str, bytes]:
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, package_id)
            if project_id is None:
                return {}
            rows = (
                conn.execute(
                    select(
                        ProjectResourceRow.resource_path, ProjectResourceRow.sha256
                    ).where(ProjectResourceRow.project_id == project_id)
                )
                .tuples()
                .all()
            )
        return {path: self.db.blobs.get(sha) for path, sha in rows}

    def ontology_resources(self) -> list[tuple[OntologyDefinition, bytes]]:
        """Definitions and bytes of every embedded ontology, for start-up loading."""
        with self.db.transaction() as conn:
            rows = (
                conn.execute(
                    select(
                        ProjectRow.task_profile,
                        ProjectResourceRow.resource_path,
                        ProjectResourceRow.sha256,
                    ).join(
                        ProjectResourceRow,
                        ProjectResourceRow.project_id == ProjectRow.id,
                    )
                )
                .tuples()
                .all()
            )
        result: list[tuple[OntologyDefinition, bytes]] = []
        for stored_profile, path, sha in rows:
            for ont in TaskProfile.model_validate(stored_profile).ontologies:
                if ont.resource_path == path:
                    result.append((ont, self.db.blobs.get(sha)))
        return result

    # --- projects from the CLI and T1 imports (T2d) ------------------------ #

    def create_project(
        self,
        key: str,
        name: str,
        description: str | None,
        profile: TaskProfile,
        pins: Mapping[str, Pin],
        *,
        on_create: Callable[[Connection, int], None] | None = None,
    ) -> None:
        """Create an empty project whose profile ontologies are pinned (P7).

        Every profile ontology must be pinned to a stored ontology file with
        the profile's sha256 and release, and no other ontology may be pinned;
        otherwise ``PIN_MISMATCH`` lists the differences. A synthesised
        manifest keeps the readers of seed projects working.
        """
        check_t1_profile(profile, pins)
        differences: list[dict[str, Any]] = []
        defined = {o.ontology_id: o for o in profile.ontologies}
        for ontology_id in sorted(set(pins) - set(defined)):
            differences.append(
                {"ontology_id": ontology_id, "field": "profile", "found": None}
            )
        for ontology_id, definition in defined.items():
            pin = pins.get(ontology_id)
            if pin is None:
                differences.append(
                    {"ontology_id": ontology_id, "field": "pin", "found": None}
                )
            elif pin.sha256 != definition.sha256:
                differences.append(
                    {
                        "ontology_id": ontology_id,
                        "field": "sha256",
                        "expected": definition.sha256,
                        "found": pin.sha256,
                    }
                )
        manifest = PackageManifest(
            package_id=key,
            task_profile=profile,
            task_profile_sha256=profile_hash(profile),
            created_at=datetime.now(UTC).isoformat(),
        )
        with self.db.transaction() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            for ontology_id, pin in pins.items():
                pinned = defined.get(ontology_id)
                if pinned is None or pin.sha256 != pinned.sha256:
                    continue
                stored = conn.execute(
                    select(OntologyFileRow.kind, OntologyFileRow.release).where(
                        OntologyFileRow.sha256 == pin.sha256
                    )
                ).one_or_none()
                if stored is None or stored.kind != "ontology":
                    differences.append(
                        {"ontology_id": ontology_id, "field": "file", "found": None}
                    )
                elif stored.release != pinned.release:
                    differences.append(
                        {
                            "ontology_id": ontology_id,
                            "field": "release",
                            "expected": pinned.release,
                            "found": stored.release,
                        }
                    )
            if differences:
                raise DomainError("PIN_MISMATCH", {"differences": differences})
            if self._project_id(conn, key) is not None:
                raise DomainError("PROJECT_EXISTS", f"Project '{key}' exists.")
            project_id = conn.execute(
                insert(ProjectRow)
                .values(
                    project_key=key,
                    name=name,
                    description=description,
                    manifest=manifest.model_dump(mode="json"),
                    manifest_sha256=canonical_hash(manifest.model_dump()),
                    task_profile=profile.model_dump(mode="json"),
                    task_profile_sha256=profile_hash(profile),
                )
                .returning(ProjectRow.id)
            ).scalar_one()
            if pins:
                conn.execute(
                    insert(ProjectOntologyRow),
                    [
                        {
                            "project_id": project_id,
                            "ontology_id": ontology_id,
                            "sha256": pin.sha256,
                            "allowed_roots": list(pin.allowed_roots),
                            "t1_profile": pin.t1_profile,
                        }
                        for ontology_id, pin in sorted(pins.items())
                    ],
                )
            if on_create is not None:
                on_create(conn, project_id)

    def project_pins(self, package_id: str) -> dict[str, Pin]:
        """The project's pinned ontologies by ontology id."""
        with self.db.transaction() as conn:
            return self._pins(conn, self._require_project(conn, package_id))

    @staticmethod
    def _pins(conn: Connection, project_id: int) -> dict[str, Pin]:
        rows = conn.execute(
            select(
                ProjectOntologyRow.ontology_id,
                ProjectOntologyRow.sha256,
                ProjectOntologyRow.allowed_roots,
                ProjectOntologyRow.t1_profile,
            ).where(ProjectOntologyRow.project_id == project_id)
        ).all()
        return {
            row.ontology_id: Pin(
                sha256=row.sha256,
                allowed_roots=tuple(row.allowed_roots),
                t1_profile=cast(T1Profile, row.t1_profile),
            )
            for row in rows
        }

    def add_documents_and_proposals(
        self,
        package_id: str,
        documents: Sequence[ImportedDocument],
        proposal_sets: Sequence[ImportedSet],
        *,
        source_sha256: str,
        imported_by: int | None = None,
        job_id: int | None = None,
        on_done: Callable[[Connection, int, ImportCounts], None] | None = None,
    ) -> ImportCounts:
        """Add imported documents and sets in one transaction (T3 A1, T7 O1, O2).

        A known document with another text is ``DOCUMENT_CONFLICT`` and nothing
        is written; an identical one is skipped. A set already imported under
        the same (bundle, set, document) is skipped, so a re-import adds
        nothing. ``on_done`` runs with the counts in the same transaction.
        """
        texts: dict[str, ImportedDocument] = {}
        conflicts: set[str] = set()
        for entry in documents:
            doc = entry.document
            known = texts.setdefault(doc.document_id, entry)
            if known.document.text_sha256 != doc.text_sha256:
                conflicts.add(doc.document_id)
        with self.db.transaction() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
            conn.execute(
                select(func.pg_advisory_xact_lock(_lock_id("project", package_id)))
            )
            project_id = self._require_project(conn, package_id)
            stored = dict(
                conn.execute(
                    select(DocumentRow.document_id, DocumentRow.text_sha256).where(
                        DocumentRow.project_id == project_id,
                        DocumentRow.document_id.in_(list(texts)),
                    )
                )
                .tuples()
                .all()
            )
            conflicts.update(
                doc_id
                for doc_id, sha in stored.items()
                if texts[doc_id].document.text_sha256 != sha
            )
            if conflicts:
                raise DomainError("DOCUMENT_CONFLICT", {"documents": sorted(conflicts)})
            self._verify_snapshot_contents(
                conn,
                [s for item in proposal_sets for s in item.proposals.annotations],
                [e for item in proposal_sets for e in item.proposals.evidence],
            )
            position = conn.execute(
                select(func.coalesce(func.max(DocumentRow.position), -1)).where(
                    DocumentRow.project_id == project_id
                )
            ).scalar_one()
            assert position is not None
            new_documents = []
            for doc_id, entry in texts.items():
                if doc_id in stored:
                    continue
                position += 1
                new_documents.append(
                    {
                        "project_id": project_id,
                        "document_id": doc_id,
                        "position": position,
                        "language": entry.document.language,
                        "text": entry.document.text,
                        "text_sha256": entry.document.text_sha256,
                        "source_text_sha256": entry.source_text_sha256,
                    }
                )
            if new_documents:
                conn.execute(insert(DocumentRow), new_documents)
            counts: ImportCounts = {
                "documents_added": len(new_documents),
                "documents_skipped": len(texts) - len(new_documents),
                "documents_only": len(
                    set(texts) - {item.document_id for item in proposal_sets}
                ),
                "sets_added": 0,
                "sets_skipped": 0,
                "proposals": 0,
            }
            for item in proposal_sets:
                set_id = conn.execute(
                    pg_insert(ProposalSetRow)
                    .values(
                        project_id=project_id,
                        document_id=item.document_id,
                        bundle_id=item.bundle_id,
                        manifest_sha256=item.manifest_sha256,
                        annotation_set_id=item.annotation_set_id,
                        set_kind=item.set_kind,
                        actors=item.actors,
                        payload=item.payload,
                        source_sha256=source_sha256,
                        imported_by=imported_by,
                        job_id=job_id,
                    )
                    .on_conflict_do_nothing()
                    .returning(ProposalSetRow.id)
                ).scalar_one_or_none()
                if set_id is None:
                    counts["sets_skipped"] += 1
                    continue
                counts["sets_added"] += 1
                proposals = item.proposals
                self._insert_snapshots(
                    conn, project_id, proposals.annotations, proposals.evidence
                )
                if proposals.annotations:
                    inserted = conn.execute(
                        pg_insert(ProposalAnnotationRow)
                        .on_conflict_do_nothing()
                        .returning(ProposalAnnotationRow.annotation_id),
                        [
                            {
                                "project_id": project_id,
                                "annotation_id": snap.annotation.annotation_id,
                                "version": snap.version,
                                "proposal_set_id": set_id,
                                "notes": proposals.notes.get(
                                    snap.annotation.annotation_id, []
                                ),
                            }
                            for snap in proposals.annotations
                        ],
                    ).all()
                    counts["proposals"] += len(inserted)
                if proposals.evidence:
                    conn.execute(
                        pg_insert(ProposalEvidenceRow).on_conflict_do_nothing(),
                        [
                            {
                                "project_id": project_id,
                                "evidence_id": ev.mention.evidence_id,
                                "version": ev.version,
                            }
                            for ev in proposals.evidence
                        ],
                    )
            if on_done is not None:
                on_done(conn, project_id, counts)
        return counts

    # --- exports (T2d) ------------------------------------------------------ #

    def t1_export_content(self, package_id: str) -> ProjectExport:
        """What a T1 export of the project needs, read in one snapshot.

        Per document, annotator and mode only the latest submission is kept:
        the latest revision of each origin, then the one recorded last.
        """
        with self.db.snapshot() as conn:
            project = conn.execute(
                select(ProjectRow.id, ProjectRow.task_profile).where(
                    ProjectRow.project_key == package_id
                )
            ).one_or_none()
            if project is None:
                raise DomainError(
                    "PACKAGE_NOT_FOUND", f"No package found for package '{package_id}'"
                )
            documents = {
                row.document_id: ImportedDocument(
                    Document(
                        document_id=row.document_id,
                        text=row.text,
                        language=row.language,
                        text_sha256=row.text_sha256,
                    ),
                    row.source_text_sha256,
                )
                for row in conn.execute(
                    select(
                        DocumentRow.document_id,
                        DocumentRow.text,
                        DocumentRow.language,
                        DocumentRow.text_sha256,
                        DocumentRow.source_text_sha256,
                    ).where(DocumentRow.project_id == project.id)
                )
            }
            submission_rows = conn.execute(
                select(
                    SubmissionRow.document_id,
                    SubmissionRow.annotator_id,
                    SubmissionRow.mode,
                    SubmissionRow.recorded_at,
                    SubmissionRow.payload,
                )
                .where(SubmissionRow.project_id == project.id)
                .order_by(SubmissionRow.recorded_at, SubmissionRow.submission_id)
            ).all()
            proposal_payloads = (
                conn.execute(
                    select(AnnotationSnapshotRow.payload)
                    .join(
                        ProposalAnnotationRow,
                        and_(
                            ProposalAnnotationRow.project_id
                            == AnnotationSnapshotRow.project_id,
                            ProposalAnnotationRow.annotation_id
                            == AnnotationSnapshotRow.annotation_id,
                            ProposalAnnotationRow.version
                            == AnnotationSnapshotRow.version,
                        ),
                    )
                    .where(AnnotationSnapshotRow.project_id == project.id)
                )
                .scalars()
                .all()
            )
            annotators = {row.annotator_id for row in submission_rows}
            contributors = [
                (row.pseudonym, row.display_name, row.orcid)
                for row in conn.execute(
                    select(UserRow.pseudonym, UserRow.display_name, UserRow.orcid)
                    .where(
                        UserRow.orcid_consent.is_(True),
                        UserRow.pseudonym.in_(sorted(annotators)),
                    )
                    .order_by(UserRow.pseudonym)
                )
            ]
            pins = self._pins(conn, project.id)
        groups: dict[tuple[str, str, str], list[Submission]] = {}
        recorded: dict[str, datetime] = {}
        for row in submission_rows:
            submission = Submission.model_validate(row.payload)
            recorded[submission.submission_id] = row.recorded_at
            groups.setdefault((row.document_id, row.annotator_id, row.mode), []).append(
                submission
            )
        submissions = [
            max(
                latest_submissions(group),
                key=lambda s: (recorded[s.submission_id], s.draft_revision),
            )
            for _key, group in sorted(groups.items())
        ]
        proposals: dict[tuple[str, str], AnnotationSnapshot] = {}
        for payload in proposal_payloads:
            snap = decode_snapshot(payload)
            proposals[(snap.annotation.annotation_id, snap.version)] = snap
        return ProjectExport(
            profile=TaskProfile.model_validate(project.task_profile),
            pins=pins,
            documents=documents,
            submissions=submissions,
            proposals=proposals,
            contributors=contributors,
        )

    def edit_log(self, package_id: str) -> list[dict[str, Any]]:
        """Every edit event of the project in id order, pseudonymised (D6).

        No user id and no session id: the annotator is the draft's pseudonym;
        ``at`` is UTC to the second.
        """
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            rows = conn.execute(
                select(
                    EditEventRow.id,
                    EditEventRow.at,
                    DraftRow.document_id,
                    DraftRow.annotator_id,
                    DraftRow.mode,
                    EditEventRow.kind,
                    EditEventRow.revision_before,
                    EditEventRow.revision_after,
                    EditEventRow.command,
                    EditEventRow.state,
                    EditEventRow.submission_id,
                )
                .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
                .where(EditEventRow.project_id == project_id)
                .order_by(EditEventRow.id)
            ).all()
        return [
            {
                "event": row.id,
                "at": row.at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "document_id": row.document_id,
                "annotator": row.annotator_id,
                "mode": row.mode,
                "kind": row.kind,
                "revision_before": row.revision_before,
                "revision_after": row.revision_after,
                "command": row.command,
                "state": row.state,
                "submission_id": row.submission_id,
            }
            for row in rows
        ]

    def get_manifest(self, package_id: str) -> PackageManifest:
        """The stored manifest of a project."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(ProjectRow.manifest).where(ProjectRow.project_key == package_id)
            ).scalar_one_or_none()
        if stored is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{package_id}'"
            )
        return PackageManifest.model_validate(stored)

    def manifest_hash(self, package_id: str) -> str | None:
        """Canonical manifest hash of a project, or None if absent."""
        with self.db.transaction() as conn:
            return conn.execute(
                select(ProjectRow.manifest_sha256).where(
                    ProjectRow.project_key == package_id
                )
            ).scalar_one_or_none()

    def list_manifests(self) -> list[PackageManifest]:
        """Manifests of all projects, newest first."""
        with self.db.transaction() as conn:
            stored = (
                conn.execute(
                    select(ProjectRow.manifest).order_by(
                        ProjectRow.created_at.desc(), ProjectRow.id.desc()
                    )
                )
                .scalars()
                .all()
            )
        return [PackageManifest.model_validate(m) for m in stored]

    def list_projects(self) -> list[ProjectInfo]:
        """Every project with its document count, newest first."""
        documents = (
            select(func.count())
            .where(DocumentRow.project_id == ProjectRow.id)
            .scalar_subquery()
        )
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(
                    ProjectRow.project_key,
                    ProjectRow.name,
                    ProjectRow.description,
                    documents.label("document_count"),
                ).order_by(ProjectRow.created_at.desc(), ProjectRow.id.desc())
            ).all()
        return [ProjectInfo(**row._asdict()) for row in rows]

    def get_task_profile(self, package_id: str) -> TaskProfile:
        """The resolved task profile of a project."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(ProjectRow.task_profile).where(
                    ProjectRow.project_key == package_id
                )
            ).scalar_one_or_none()
        if stored is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND",
                f"No package or task profile found for package '{package_id}'",
            )
        return TaskProfile.model_validate(stored)

    def get_axes_config(self, package_id: str) -> AxesConfig:
        """AxesConfig synthesized from the task profile, for older callers."""
        profile = self.get_task_profile(package_id)
        name = profile.preset or "custom"
        for layer in profile.layers:
            for annotation_type in layer.annotation_types:
                if annotation_type.axes:
                    return AxesConfig(definition_name=name, axes=annotation_type.axes)
        return AxesConfig(definition_name=name, axes=[])

    # --- documents and proposals ------------------------------------------- #

    def get_document(self, package_id: str, document_id: str) -> Document | None:
        with self.db.transaction() as conn:
            row = conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.text,
                    DocumentRow.language,
                    DocumentRow.text_sha256,
                )
                .join(ProjectRow, ProjectRow.id == DocumentRow.project_id)
                .where(
                    ProjectRow.project_key == package_id,
                    DocumentRow.document_id == document_id,
                )
            ).one_or_none()
        if row is None:
            return None
        return Document(
            document_id=row.document_id,
            text=row.text,
            language=row.language,
            text_sha256=row.text_sha256,
        )

    def list_documents(self, package_id: str) -> list[Document]:
        """Documents in the declared order, the rest by ID."""
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(
                    DocumentRow.document_id,
                    DocumentRow.text,
                    DocumentRow.language,
                    DocumentRow.text_sha256,
                )
                .join(ProjectRow, ProjectRow.id == DocumentRow.project_id)
                .where(ProjectRow.project_key == package_id)
                .order_by(
                    DocumentRow.position.asc().nulls_last(), DocumentRow.document_id
                )
            ).all()
        return [
            Document(
                document_id=row.document_id,
                text=row.text,
                language=row.language,
                text_sha256=row.text_sha256,
            )
            for row in rows
        ]

    @staticmethod
    def _insert_snapshots(
        conn: Connection,
        project_id: int,
        annotations: Iterable[AnnotationSnapshot],
        evidence: Iterable[EvidenceSnapshot],
    ) -> None:
        """Insert content-addressed snapshots; known identities are skipped."""
        annotation_rows = [
            {
                "project_id": project_id,
                "annotation_id": snap.annotation.annotation_id,
                "version": snap.version,
                "document_id": snap.document_id,
                "payload": encode_snapshot(snap),
            }
            for snap in annotations
        ]
        if annotation_rows:
            conn.execute(
                pg_insert(AnnotationSnapshotRow).on_conflict_do_nothing(),
                annotation_rows,
            )
        evidence_rows = [
            {
                "project_id": project_id,
                "evidence_id": ev.mention.evidence_id,
                "version": ev.version,
                "document_id": ev.document_id,
                "payload": ev.model_dump(mode="json"),
            }
            for ev in evidence
        ]
        if evidence_rows:
            conn.execute(
                pg_insert(EvidenceSnapshotRow).on_conflict_do_nothing(), evidence_rows
            )

    def get_annotation_snapshot(
        self, annotation_id: str, version: str, package_id: str | None = None
    ) -> AnnotationSnapshot | None:
        statement = select(AnnotationSnapshotRow.payload).where(
            AnnotationSnapshotRow.annotation_id == annotation_id,
            AnnotationSnapshotRow.version == version,
        )
        if package_id is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == AnnotationSnapshotRow.project_id
            ).where(ProjectRow.project_key == package_id)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else decode_snapshot(stored)

    def get_evidence_snapshot(
        self, evidence_id: str, version: str, package_id: str | None = None
    ) -> EvidenceSnapshot | None:
        statement = select(EvidenceSnapshotRow.payload).where(
            EvidenceSnapshotRow.evidence_id == evidence_id,
            EvidenceSnapshotRow.version == version,
        )
        if package_id is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == EvidenceSnapshotRow.project_id
            ).where(ProjectRow.project_key == package_id)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else EvidenceSnapshot.model_validate(stored)

    def list_annotations_for_document(
        self, package_id: str, document_id: str
    ) -> list[AnnotationSnapshot]:
        """The project's proposals for one document, ordered by identity."""
        with self.db.transaction() as conn:
            stored = (
                conn.execute(
                    select(AnnotationSnapshotRow.payload)
                    .join(
                        ProposalAnnotationRow,
                        and_(
                            ProposalAnnotationRow.project_id
                            == AnnotationSnapshotRow.project_id,
                            ProposalAnnotationRow.annotation_id
                            == AnnotationSnapshotRow.annotation_id,
                            ProposalAnnotationRow.version
                            == AnnotationSnapshotRow.version,
                        ),
                    )
                    .join(ProjectRow, ProjectRow.id == AnnotationSnapshotRow.project_id)
                    .where(
                        ProjectRow.project_key == package_id,
                        AnnotationSnapshotRow.document_id == document_id,
                    )
                    .order_by(
                        AnnotationSnapshotRow.annotation_id,
                        AnnotationSnapshotRow.version,
                    )
                )
                .scalars()
                .all()
            )
        return [decode_snapshot(p) for p in stored]

    # --- submissions and search events: insertion -------------------------- #

    @staticmethod
    def _insert_submission(
        conn: Connection,
        project_id: int,
        submission: Submission,
        *,
        local_key: str,
        imported: bool,
        last_edit_event_id: int | None = None,
    ) -> None:
        origin = submission.origin_key
        statement = pg_insert(SubmissionRow).values(
            project_id=project_id,
            submission_id=submission.submission_id,
            local_key=local_key,
            origin_key=_key_str(origin),
            document_id=origin.document_id,
            annotator_id=origin.annotator_id,
            mode=origin.mode,
            draft_revision=submission.draft_revision,
            payload=_submission_payload(submission),
            created_at=submission.created_at,
            last_edit_event_id=last_edit_event_id,
        )
        # Imported submissions may already be known; a local one must be new.
        conn.execute(statement.on_conflict_do_nothing() if imported else statement)

    @staticmethod
    def _insert_search_event(
        conn: Connection,
        project_id: int,
        event: SearchEventRecord,
        *,
        local_key: str,
        imported: bool,
    ) -> None:
        statement = pg_insert(SearchEventRow).values(
            project_id=project_id,
            event_id=event.event_id,
            workspace_key=_key_str(event.workspace_key),
            local_key=local_key,
            imported=imported,
            annotation_id=event.annotation_id,
            layer_id=event.layer_id,
            ontology_sha256=event.ontology_sha256,
            payload=event.model_dump(mode="json"),
            timestamp=event.timestamp,
        )
        # Imported events may already be known; a locally written one must be new.
        conn.execute(statement.on_conflict_do_nothing() if imported else statement)

    # --- drafts and mutations ---------------------------------------------- #

    def list_workspace_keys(
        self,
        package_id: str,
        annotator_id: str,
        mode: str | None = None,
        document_id: str | None = None,
    ) -> list[WorkspaceKey]:
        """Workspace identities of one annotator: opened drafts and submissions."""
        profile = self.get_task_profile(package_id)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            drafts = select(
                DraftRow.document_id,
                DraftRow.mode,
                DraftRow.scope_id,
                DraftRow.target_set_id,
            ).where(
                DraftRow.project_id == project_id, DraftRow.annotator_id == annotator_id
            )
            submissions = select(SubmissionRow.payload).where(
                SubmissionRow.project_id == project_id,
                SubmissionRow.annotator_id == annotator_id,
            )
            if mode is not None:
                drafts = drafts.where(DraftRow.mode == mode)
                submissions = submissions.where(SubmissionRow.mode == mode)
            if document_id is not None:
                drafts = drafts.where(DraftRow.document_id == document_id)
                submissions = submissions.where(
                    SubmissionRow.document_id == document_id
                )
            draft_rows = conn.execute(drafts).all()
            payloads = conn.execute(submissions).scalars().all()
        keys: dict[str, WorkspaceKey] = {}
        for row in draft_rows:
            key = WorkspaceKey(
                package_id=package_id,
                document_id=row.document_id,
                annotator_id=annotator_id,
                mode=row.mode,
                scope_id=row.scope_id,
                target_set_id=row.target_set_id,
            )
            keys[_key_str(key)] = key
        for payload in payloads:
            origin = WorkspaceKey.model_validate(payload["origin_key"])
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

    @staticmethod
    def _draft_row(
        conn: Connection, project_id: int, key_string: str
    ) -> Row[Any] | None:
        return conn.execute(
            select(
                DraftRow.id,
                DraftRow.revision,
                DraftRow.checked_layer_ids,
                DraftRow.targets,
            ).where(DraftRow.project_id == project_id, DraftRow.draft_key == key_string)
        ).one_or_none()

    def open_draft(
        self, key: WorkspaceKey, targets: ReviewTargetSet | None = None
    ) -> Draft:
        """Open or initialize the draft of a workspace key.

        Takes the draft lock, so that a draft is never read while a mutation
        of it is half committed.
        """
        with self.db.transaction() as conn:
            self._lock_draft(conn, key)
            return self._open_draft(conn, key, targets)

    @staticmethod
    def _lock_draft(conn: Connection, key: WorkspaceKey) -> None:
        """Serialise the readers and writers of one draft until the transaction ends.

        The advisory lock works before the draft row exists.
        """
        conn.execute(
            select(
                func.pg_advisory_xact_lock(
                    _lock_id("draft", key.package_id, _key_str(key))
                )
            )
        )

    def _open_draft(
        self, conn: Connection, key: WorkspaceKey, targets: ReviewTargetSet | None
    ) -> Draft:
        project_id = self._require_project(conn, key.package_id)
        key_string = _key_str(key)
        row = self._draft_row(conn, project_id, key_string)
        if row is None:
            self._create_draft(conn, project_id, key, key_string, targets)
            row = self._draft_row(conn, project_id, key_string)
            if row is None:
                raise DomainError("DRAFT_NOT_CREATED", key_string)
        annotations = (
            conn.execute(
                select(AnnotationSnapshotRow.payload)
                .join(
                    DraftAnnotationRow,
                    and_(
                        DraftAnnotationRow.annotation_id
                        == AnnotationSnapshotRow.annotation_id,
                        DraftAnnotationRow.version == AnnotationSnapshotRow.version,
                    ),
                )
                .where(
                    DraftAnnotationRow.draft_id == row.id,
                    AnnotationSnapshotRow.project_id == project_id,
                )
                .order_by(DraftAnnotationRow.annotation_id, DraftAnnotationRow.version)
            )
            .scalars()
            .all()
        )
        evidence = (
            conn.execute(
                select(EvidenceSnapshotRow.payload)
                .join(
                    DraftEvidenceRow,
                    and_(
                        DraftEvidenceRow.evidence_id == EvidenceSnapshotRow.evidence_id,
                        DraftEvidenceRow.version == EvidenceSnapshotRow.version,
                    ),
                )
                .where(
                    DraftEvidenceRow.draft_id == row.id,
                    EvidenceSnapshotRow.project_id == project_id,
                )
                .order_by(DraftEvidenceRow.evidence_id, DraftEvidenceRow.version)
            )
            .scalars()
            .all()
        )
        decisions = (
            conn.execute(
                select(ReviewDecisionRow.payload)
                .where(ReviewDecisionRow.draft_id == row.id)
                .order_by(ReviewDecisionRow.position)
            )
            .scalars()
            .all()
        )
        return Draft(
            key=key,
            targets=ReviewTargetSet.model_validate(row.targets),
            revision=int(row.revision),
            annotations=[decode_snapshot(p) for p in annotations],
            evidence=[EvidenceSnapshot.model_validate(p) for p in evidence],
            decisions=[ReviewDecision.model_validate(p) for p in decisions],
            checked_layer_ids=list(row.checked_layer_ids),
        )

    def _create_draft(
        self,
        conn: Connection,
        project_id: int,
        key: WorkspaceKey,
        key_string: str,
        targets: ReviewTargetSet | None,
    ) -> None:
        """Create the draft row; a new draft resumes the latest submission of its key."""
        effective = targets if targets is not None else ReviewTargetSet.create([])
        draft_id = conn.execute(
            pg_insert(DraftRow)
            .values(
                project_id=project_id,
                draft_key=key_string,
                document_id=key.document_id,
                annotator_id=key.annotator_id,
                mode=key.mode,
                scope_id=key.scope_id,
                target_set_id=key.target_set_id,
                targets=effective.model_dump(mode="json"),
                updated_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=["project_id", "draft_key"])
            .returning(DraftRow.id)
        ).scalar_one_or_none()
        if draft_id is None:
            return  # created by a concurrent request; the caller reads it
        submissions = self._submissions_for_workspace(conn, project_id, key)
        if not submissions:
            return
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
        evidence = [ev for a in annotations for ev in a.evidence]
        decisions = [
            # Rebind the local decision identity to this workspace.
            d.model_copy(
                update={
                    "decision_id": canonical_hash(
                        {"workspace": key.model_dump(), "target": d.target.model_dump()}
                    )
                }
            )
            for d in latest.decisions
        ]
        self._insert_snapshots(conn, project_id, annotations, evidence)
        self._write_draft_content(conn, draft_id, annotations, evidence, decisions)
        conn.execute(
            update(DraftRow)
            .where(DraftRow.id == draft_id)
            .values(
                targets=latest.targets.model_dump(mode="json"),
                revision=latest.draft_revision,
                checked_layer_ids=list(latest.checked_layer_ids),
            )
        )

    @staticmethod
    def _write_draft_content(
        conn: Connection,
        draft_id: int,
        annotations: list[AnnotationSnapshot],
        evidence: list[EvidenceSnapshot],
        decisions: list[ReviewDecision],
    ) -> None:
        """Insert the content rows of a draft whose previous rows are gone."""
        if annotations:
            conn.execute(
                pg_insert(DraftAnnotationRow).on_conflict_do_nothing(),
                [
                    {
                        "draft_id": draft_id,
                        "annotation_id": a.annotation.annotation_id,
                        "version": a.version,
                    }
                    for a in annotations
                ],
            )
        if evidence:
            conn.execute(
                pg_insert(DraftEvidenceRow).on_conflict_do_nothing(),
                [
                    {
                        "draft_id": draft_id,
                        "evidence_id": e.mention.evidence_id,
                        "version": e.version,
                    }
                    for e in evidence
                ],
            )
        if decisions:
            conn.execute(
                insert(ReviewDecisionRow),
                [
                    {
                        "draft_id": draft_id,
                        "decision_id": d.decision_id,
                        "position": position,
                        "target_id": d.target.annotation_id,
                        "target_version": d.target.version,
                        "outcome": d.outcome,
                        "replacement_id": d.replacement.annotation_id
                        if d.replacement
                        else None,
                        "replacement_version": d.replacement.version
                        if d.replacement
                        else None,
                        "note": d.note,
                        "reviewer_id": d.reviewer_id,
                        "payload": d.model_dump(mode="json"),
                    }
                    for position, d in enumerate(decisions)
                ],
            )

    def run_mutation(
        self,
        key: WorkspaceKey,
        envelope: MutationEnvelope,
        operation: Callable[[Draft], Draft | Submission],
    ) -> Draft | Submission:
        """Run ``operation`` on the draft at the expected revision, exactly once.

        Writers of one draft are serialised by a transaction-scoped advisory
        lock. A retried mutation ID with the same payload replays the stored
        response; with another payload it is a conflict.

        Every committed command is logged in ``edit_events`` in the same
        transaction (D6), with the user and session of the running request
        (none outside a request). A replay logs nothing.
        """
        key_string = _key_str(key)
        request_hash = canonical_hash(envelope.model_dump())
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, key.package_id)
            self._lock_draft(conn, key)
            receipt = conn.execute(
                select(
                    MutationReceiptRow.request_hash, MutationReceiptRow.response
                ).where(
                    MutationReceiptRow.project_id == project_id,
                    MutationReceiptRow.workspace_key == key_string,
                    MutationReceiptRow.mutation_id == envelope.mutation_id,
                )
            ).one_or_none()
            if receipt is not None:
                if receipt.request_hash != request_hash:
                    raise RevisionConflict(
                        "Mutation ID reused with different payload: "
                        f"{envelope.mutation_id}"
                    )
                if "submission_id" in receipt.response:
                    return Submission.model_validate(receipt.response)
                return Draft.model_validate(receipt.response)

            row = self._draft_row(conn, project_id, key_string)
            current_revision = 0 if row is None else int(row.revision)
            if current_revision != envelope.expected_revision:
                raise RevisionConflict(
                    f"REVISION_CONFLICT: Expected revision "
                    f"{envelope.expected_revision}, current is {current_revision}"
                )
            draft = self._open_draft(conn, key, None)
            # Taken before the operation, which may change the draft in place.
            state_before = DraftState.of(draft)
            result = operation(draft)
            draft_row = self._draft_row(conn, project_id, key_string)
            if draft_row is None:
                raise DomainError("DRAFT_NOT_CREATED", key_string)
            now = datetime.now(UTC)
            new_revision = current_revision + 1
            response: dict[str, Any]
            if isinstance(result, Draft):
                result.revision = new_revision
                conn.execute(
                    update(DraftRow)
                    .where(DraftRow.id == draft_row.id)
                    .values(
                        revision=new_revision,
                        checked_layer_ids=list(result.checked_layer_ids),
                        updated_at=now,
                    )
                )
                conn.execute(
                    delete(DraftAnnotationRow).where(
                        DraftAnnotationRow.draft_id == draft_row.id
                    )
                )
                conn.execute(
                    delete(DraftEvidenceRow).where(
                        DraftEvidenceRow.draft_id == draft_row.id
                    )
                )
                conn.execute(
                    delete(ReviewDecisionRow).where(
                        ReviewDecisionRow.draft_id == draft_row.id
                    )
                )
                self._insert_snapshots(
                    conn, project_id, result.annotations, result.evidence
                )
                self._write_draft_content(
                    conn,
                    draft_row.id,
                    result.annotations,
                    result.evidence,
                    result.decisions,
                )
                self._log_edit(
                    conn,
                    project_id,
                    draft_row.id,
                    envelope,
                    current_revision,
                    DraftState.of(result),
                    at=now,
                )
                response = _draft_payload(result)
            elif isinstance(result, Submission):
                conn.execute(
                    update(DraftRow)
                    .where(DraftRow.id == draft_row.id)
                    .values(revision=new_revision, updated_at=now)
                )
                # The event first: the submission references it.
                event_id = self._log_edit(
                    conn,
                    project_id,
                    draft_row.id,
                    envelope,
                    current_revision,
                    state_before,
                    at=now,
                    submission_id=result.submission_id,
                )
                self._insert_submission(
                    conn,
                    project_id,
                    result,
                    local_key=key_string,
                    imported=False,
                    last_edit_event_id=event_id,
                )
                response = _submission_payload(result)
            else:
                raise ValueError(f"Unsupported operation return type: {type(result)}")
            conn.execute(
                insert(MutationReceiptRow).values(
                    project_id=project_id,
                    workspace_key=key_string,
                    mutation_id=envelope.mutation_id,
                    request_hash=request_hash,
                    response=response,
                    created_at=now,
                )
            )
            return result

    @staticmethod
    def _log_edit(
        conn: Connection,
        project_id: int,
        draft_id: int,
        envelope: MutationEnvelope,
        revision_before: int,
        state: DraftState,
        *,
        at: datetime,
        submission_id: str | None = None,
    ) -> int:
        """Append one ``edit_events`` row; its ID."""
        principal = current_principal.get()
        return int(
            conn.execute(
                insert(EditEventRow)
                .values(
                    project_id=project_id,
                    draft_id=draft_id,
                    user_id=principal.user_id if principal else None,
                    session_id=principal.session_id if principal else None,
                    at=at,
                    mutation_id=envelope.mutation_id,
                    kind="edit" if submission_id is None else "submit",
                    command=envelope.payload,
                    revision_before=revision_before,
                    revision_after=revision_before + 1,
                    state=state.to_json(),
                    submission_id=submission_id,
                )
                .returning(EditEventRow.id)
            ).scalar_one()
        )

    def _draft_events(self, key: WorkspaceKey) -> Any:
        """Edit events of the draft of ``key`` (a statement to refine)."""
        return (
            select(EditEventRow)
            .join(DraftRow, DraftRow.id == EditEventRow.draft_id)
            .join(ProjectRow, ProjectRow.id == DraftRow.project_id)
            .where(
                ProjectRow.project_key == key.package_id,
                EditEventRow.project_id == ProjectRow.id,
                DraftRow.draft_key == _key_str(key),
            )
        )

    def edit_events(self, key: WorkspaceKey) -> list[EditEvent]:
        """The edit log of one draft, oldest first; empty for an unknown draft.

        Raises:
            DomainError: ``PACKAGE_NOT_FOUND``.
        """
        with self.db.transaction() as conn:
            self._require_project(conn, key.package_id)
            rows = conn.execute(self._draft_events(key).order_by(EditEventRow.id)).all()
        return [EditEvent(**row._asdict()) for row in rows]

    def draft_state_at(self, key: WorkspaceKey, revision: int) -> DraftState:
        """The content of a draft after ``revision``; empty for revision 0.

        Raises:
            DomainError: ``PACKAGE_NOT_FOUND``, or ``REVISION_NOT_FOUND`` when
                no logged command of the draft produced ``revision`` (e.g. the
                revision a draft resumed from a submission started at).
        """
        if revision == 0:
            return DraftState()
        with self.db.transaction() as conn:
            self._require_project(conn, key.package_id)
            row = conn.execute(
                self._draft_events(key)
                .where(EditEventRow.revision_after == revision)
                .order_by(EditEventRow.id.desc())
                .limit(1)
            ).one_or_none()
        if row is None:
            raise DomainError(
                "REVISION_NOT_FOUND",
                f"No logged command made revision {revision} of this draft.",
            )
        return DraftState.from_json(row.state)

    def get_document_status(
        self,
        package_id: str,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> Literal["not_started", "in_progress", "completed"]:
        """Progress of one annotator in one mode on one document."""
        return self._document_statuses(package_id, annotator_id, mode, document_id).get(
            document_id, "not_started"
        )

    def get_document_statuses(
        self, package_id: str, annotator_id: str, mode: str
    ) -> dict[str, Literal["not_started", "in_progress", "completed"]]:
        """Progress facts for one project's annotator/mode; absent means not started.

        Read all workspace facts in a bounded number of statements. Immutable
        submissions still resolve by complete origin and revision, never clocks.
        """
        return self._document_statuses(package_id, annotator_id, mode)

    def _document_statuses(
        self,
        package_id: str,
        annotator_id: str,
        mode: str,
        document_id: str | None = None,
    ) -> dict[str, Literal["not_started", "in_progress", "completed"]]:
        profile = self.get_task_profile(package_id)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, package_id)
            drafts = select(
                DraftRow.id,
                DraftRow.draft_key,
                DraftRow.document_id,
                DraftRow.mode,
                DraftRow.scope_id,
                DraftRow.target_set_id,
                DraftRow.revision,
                DraftRow.checked_layer_ids,
                (
                    exists().where(DraftAnnotationRow.draft_id == DraftRow.id)
                    | exists().where(ReviewDecisionRow.draft_id == DraftRow.id)
                ).label("has_content"),
            ).where(
                DraftRow.project_id == project_id,
                DraftRow.annotator_id == annotator_id,
                DraftRow.mode == mode,
            )
            submissions = (
                select(SubmissionRow.local_key, SubmissionRow.payload)
                .where(
                    SubmissionRow.project_id == project_id,
                    SubmissionRow.annotator_id == annotator_id,
                    SubmissionRow.mode == mode,
                )
                .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
            )
            if document_id is not None:
                drafts = drafts.where(DraftRow.document_id == document_id)
                submissions = submissions.where(
                    SubmissionRow.document_id == document_id
                )
            draft_rows = conn.execute(drafts).all()
            submission_rows = conn.execute(submissions).all()

        rows_by_key = {row.draft_key: row for row in draft_rows}
        keys: dict[str, WorkspaceKey] = {}
        for row in draft_rows:
            key = WorkspaceKey(
                package_id=package_id,
                document_id=row.document_id,
                annotator_id=annotator_id,
                mode=row.mode,
                scope_id=row.scope_id,
                target_set_id=row.target_set_id,
            )
            keys[_key_str(key)] = key
        submissions_by_key: dict[str, list[Submission]] = {}
        for stored in submission_rows:
            submission = Submission.model_validate(stored.payload)
            submissions_by_key.setdefault(stored.local_key, []).append(submission)
            origin = submission.origin_key
            key = (
                origin
                if origin.package_id == package_id
                else _local_import_key(origin, package_id, profile)
            )
            keys.setdefault(_key_str(key), key)

        by_document: dict[str, list[WorkspaceKey]] = {}
        for key in sorted(
            keys.values(),
            key=lambda k: (k.document_id, k.mode, k.scope_id, k.target_set_id),
        ):
            by_document.setdefault(key.document_id, []).append(key)
        statuses: dict[str, Literal["not_started", "in_progress", "completed"]] = {}
        for doc_id, document_keys in by_document.items():
            status: Literal["not_started", "in_progress", "completed"] = "not_started"
            for key in document_keys:
                current = latest_submissions(
                    submission
                    for alias in _workspace_aliases(key)
                    for submission in submissions_by_key.get(alias, [])
                )
                draft_row = rows_by_key.get(_key_str(key))
                if current:
                    status = "completed"
                    # Never compare a draft revision across unrelated origins.
                    if draft_row is not None and (
                        len(current) != 1
                        or draft_row.revision > current[0].draft_revision
                    ):
                        status = "in_progress"
                        break
                    continue
                if draft_row is None:
                    continue
                if draft_row.revision > 0 or draft_row.checked_layer_ids:
                    status = "in_progress"
                    break
                if draft_row.has_content:
                    status = "in_progress"
                    break
            statuses[doc_id] = status
        return statuses

    def review_input_document_ids(self, package_id: str) -> set[str]:
        """Documents with proposals, exposing presence only (never others' work)."""
        with self.db.transaction() as conn:
            return set(
                conn.execute(
                    select(AnnotationSnapshotRow.document_id)
                    .join(
                        ProposalAnnotationRow,
                        and_(
                            ProposalAnnotationRow.project_id
                            == AnnotationSnapshotRow.project_id,
                            ProposalAnnotationRow.annotation_id
                            == AnnotationSnapshotRow.annotation_id,
                            ProposalAnnotationRow.version
                            == AnnotationSnapshotRow.version,
                        ),
                    )
                    .join(ProjectRow, ProjectRow.id == AnnotationSnapshotRow.project_id)
                    .where(ProjectRow.project_key == package_id)
                    .distinct()
                ).scalars()
            )

    # --- submissions -------------------------------------------------------- #

    @staticmethod
    def _submissions_for_workspace(
        conn: Connection, project_id: int, key: WorkspaceKey
    ) -> list[Submission]:
        stored = (
            conn.execute(
                select(SubmissionRow.payload)
                .where(
                    SubmissionRow.project_id == project_id,
                    SubmissionRow.local_key.in_(_workspace_aliases(key)),
                )
                .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
            )
            .scalars()
            .all()
        )
        return [Submission.model_validate(p) for p in stored]

    def get_submissions_for_workspace(self, key: WorkspaceKey) -> list[Submission]:
        """Submissions bound to this workspace key, oldest first."""
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, key.package_id)
            if project_id is None:
                return []
            return self._submissions_for_workspace(conn, project_id, key)

    def get_submissions_for_document(
        self, package_id: str, document_id: str
    ) -> list[Submission]:
        """Every submission of the project for one document.

        Not for review inputs: a reviewer sees the document's proposals only,
        never other members' work (index Q3). Kept for T4 workflow assignments.
        """
        with self.db.transaction() as conn:
            stored = (
                conn.execute(
                    select(SubmissionRow.payload)
                    .join(ProjectRow, ProjectRow.id == SubmissionRow.project_id)
                    .where(
                        ProjectRow.project_key == package_id,
                        SubmissionRow.document_id == document_id,
                    )
                    .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
                )
                .scalars()
                .all()
            )
        return [Submission.model_validate(p) for p in stored]

    def get_submission(
        self, submission_id: str, package_id: str | None = None
    ) -> Submission | None:
        """A submission by ID, within a project when ``package_id`` is given."""
        statement = select(SubmissionRow.payload).where(
            SubmissionRow.submission_id == submission_id
        )
        if package_id is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == SubmissionRow.project_id
            ).where(ProjectRow.project_key == package_id)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else Submission.model_validate(stored)

    # --- search events ------------------------------------------------------ #

    def save_search_event(self, event: SearchEventRecord) -> None:
        """Store a new event in the project of its workspace.

        An event ID is new across all projects, as under the desktop editor's
        global key: an import checks a known ID against every stored copy, and
        a lookup without a project expects one content per ID.
        """
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, event.workspace_key.package_id)
            # Shared: local IDs are a fresh uuid4 or a hash over the workspace
            # and the mutation, so two concurrent local saves never bring the
            # same new ID. An import may repeat any ID, so it takes the lock
            # exclusively and cannot check between this check and the commit.
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(SEARCH_EVENT_IDENTITY_LOCK))
            )
            known = conn.execute(
                select(exists().where(SearchEventRow.event_id == event.event_id))
            ).scalar_one()
            if known:
                raise DomainError("SEARCH_EVENT_EXISTS", {"event_id": event.event_id})
            self._insert_search_event(
                conn,
                project_id,
                event,
                local_key=_key_str(event.workspace_key),
                imported=False,
            )

    def get_search_event(
        self, event_id: str, package_id: str | None = None
    ) -> SearchEventRecord | None:
        """The event with this ID; within a project when ``package_id`` is given.

        Without a project, an ID stored in several projects must have the same
        content everywhere; otherwise the lookup is ambiguous.
        """
        statement = select(SearchEventRow.payload).where(
            SearchEventRow.event_id == event_id
        )
        with self.db.transaction() as conn:
            if package_id is not None:
                project_id = self._project_id(conn, package_id)
                if project_id is None:
                    return None
                statement = statement.where(SearchEventRow.project_id == project_id)
            stored = conn.execute(statement).scalars().all()
        events = [SearchEventRecord.model_validate(p) for p in stored]
        if not events:
            return None
        if any(e != events[0] for e in events[1:]):
            raise DomainError("AMBIGUOUS_SEARCH_EVENT", {"event_id": event_id})
        return events[0]

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

        Only a walk grows. ``workspace_key``, ``annotation_id`` and ``layer_id``
        name the owner the caller acts for; the event must belong to each one
        that is given, and to the project of ``workspace_key``. Returns None,
        and stores nothing, for an unknown event and for one that fails these
        checks.

        Only the copy in the project of ``workspace_key`` grows (without one,
        the first copy): browsing in one project never changes another
        project's copy. That copy is locked, as an import locks it, so two
        requests of one walk cannot lose each other's terms and a concurrent
        re-import keeps them.
        """
        with self.db.transaction() as conn:
            project_id: int | None = None
            if workspace_key is not None:
                project_id = self._project_id(conn, workspace_key.package_id)
                if project_id is None:
                    return None
            statement = select(SearchEventRow.project_id, SearchEventRow.payload).where(
                SearchEventRow.event_id == event_id
            )
            if project_id is not None:
                statement = statement.where(SearchEventRow.project_id == project_id)
            own = conn.execute(
                statement.order_by(SearchEventRow.project_id).limit(1).with_for_update()
            ).first()
            if own is None:
                return None
            event = SearchEventRecord.model_validate(own.payload)
            if (
                not is_tree_walk(event)
                or (workspace_key is not None and event.workspace_key != workspace_key)
                or (annotation_id is not None and event.annotation_id != annotation_id)
                or (layer_id is not None and event.layer_id != layer_id)
            ):
                return None
            known = set(event.candidates)
            added = [t for t in dict.fromkeys(term_ids) if t not in known]
            if added:
                event.candidates = [*event.candidates, *added]
                event.ranked_ids = [*event.ranked_ids, *added]
                conn.execute(
                    update(SearchEventRow)
                    .where(
                        SearchEventRow.project_id == own.project_id,
                        SearchEventRow.event_id == event_id,
                    )
                    .values(payload=event.model_dump(mode="json"))
                )
            return event

    def get_search_events_for_workspace(
        self, key: WorkspaceKey
    ) -> list[SearchEventRecord]:
        """Events written in, or imported into, this workspace, in written order."""
        aliases = _workspace_aliases(key)
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, key.package_id)
            if project_id is None:
                return []
            stored = (
                conn.execute(
                    select(SearchEventRow.payload)
                    .where(
                        SearchEventRow.project_id == project_id,
                        or_(
                            SearchEventRow.workspace_key.in_(aliases),
                            SearchEventRow.local_key.in_(aliases),
                        ),
                    )
                    .order_by(SearchEventRow.seq)
                )
                .scalars()
                .all()
            )
        return [SearchEventRecord.model_validate(p) for p in stored]

    # --- export ------------------------------------------------------------- #

    def export_package(
        self, package_id: str, *, include_captured_conditions: bool = True
    ) -> ValidatedPackage:
        """Everything of a project as an in-memory package.

        All reads share one snapshot, so a draft edit committing meanwhile
        cannot leave an annotation without the evidence version it references.
        """
        with self.db.snapshot() as conn:
            project = conn.execute(
                select(ProjectRow.id, ProjectRow.manifest).where(
                    ProjectRow.project_key == package_id
                )
            ).one_or_none()
            if project is None:
                raise InvalidPackage(f"Package '{package_id}' not found")
            project_id = project.id
            manifest = PackageManifest.model_validate(project.manifest)
            documents = {
                row.document_id: Document(
                    document_id=row.document_id,
                    text=row.text,
                    language=row.language,
                    text_sha256=row.text_sha256,
                )
                for row in conn.execute(
                    select(
                        DocumentRow.document_id,
                        DocumentRow.text,
                        DocumentRow.language,
                        DocumentRow.text_sha256,
                    )
                    .where(DocumentRow.project_id == project_id)
                    .order_by(
                        DocumentRow.position.asc().nulls_last(), DocumentRow.document_id
                    )
                )
            }
            in_drafts = (
                exists()
                .where(DraftRow.project_id == project_id)
                .where(DraftAnnotationRow.draft_id == DraftRow.id)
                .where(
                    DraftAnnotationRow.annotation_id
                    == AnnotationSnapshotRow.annotation_id
                )
                .where(DraftAnnotationRow.version == AnnotationSnapshotRow.version)
            )
            proposed = (
                exists()
                .where(ProposalAnnotationRow.project_id == project_id)
                .where(
                    ProposalAnnotationRow.annotation_id
                    == AnnotationSnapshotRow.annotation_id
                )
                .where(ProposalAnnotationRow.version == AnnotationSnapshotRow.version)
            )
            annotation_payloads = (
                conn.execute(
                    select(AnnotationSnapshotRow.payload).where(
                        AnnotationSnapshotRow.project_id == project_id,
                        or_(proposed, in_drafts),
                    )
                )
                .scalars()
                .all()
            )
            evidence_in_drafts = (
                exists()
                .where(DraftRow.project_id == project_id)
                .where(DraftEvidenceRow.draft_id == DraftRow.id)
                .where(DraftEvidenceRow.evidence_id == EvidenceSnapshotRow.evidence_id)
                .where(DraftEvidenceRow.version == EvidenceSnapshotRow.version)
            )
            evidence_proposed = (
                exists()
                .where(ProposalEvidenceRow.project_id == project_id)
                .where(
                    ProposalEvidenceRow.evidence_id == EvidenceSnapshotRow.evidence_id
                )
                .where(ProposalEvidenceRow.version == EvidenceSnapshotRow.version)
            )
            evidence_payloads = (
                conn.execute(
                    select(EvidenceSnapshotRow.payload).where(
                        EvidenceSnapshotRow.project_id == project_id,
                        or_(evidence_proposed, evidence_in_drafts),
                    )
                )
                .scalars()
                .all()
            )
            submission_payloads = (
                conn.execute(
                    select(SubmissionRow.payload)
                    .where(SubmissionRow.project_id == project_id)
                    .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
                )
                .scalars()
                .all()
            )
            event_payloads = (
                conn.execute(
                    select(SearchEventRow.payload)
                    .where(SearchEventRow.project_id == project_id)
                    .order_by(SearchEventRow.seq)
                )
                .scalars()
                .all()
            )
            conditions = (
                self._search_conditions(conn, project_id)
                if include_captured_conditions
                else None
            )
            stored_files = self.get_embedded_files(package_id)
        if conditions is not None:
            manifest = manifest.model_copy(update={"search_conditions": conditions})
        annotations: dict[tuple[str, str], AnnotationSnapshot] = {}
        for payload in annotation_payloads:
            snap = decode_snapshot(payload)
            annotations[(snap.annotation.annotation_id, snap.version)] = snap
        evidence: dict[tuple[str, str], EvidenceSnapshot] = {}
        for payload in evidence_payloads:
            ev = EvidenceSnapshot.model_validate(payload)
            evidence[(ev.mention.evidence_id, ev.version)] = ev
        submissions = {
            s.submission_id: s
            for s in (Submission.model_validate(p) for p in submission_payloads)
        }
        declared = {
            item.resource_path
            for condition in manifest.search_conditions or []
            for item in condition.translations
        }
        # Captured resources belong to the export only with their conditions
        # (not when ``include_captured_conditions`` is false).
        embedded_files = {
            path: content
            for path, content in stored_files.items()
            if not path.startswith("search-resources/") or path in declared
        }
        return ValidatedPackage(
            manifest=manifest,
            documents=documents,
            annotations=annotations,
            evidence=evidence,
            submissions=submissions,
            search_events=[SearchEventRecord.model_validate(p) for p in event_payloads],
            embedded_files=embedded_files,
        )
