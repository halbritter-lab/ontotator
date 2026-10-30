"""PostgreSQL repository for projects, revisioned drafts and immutable submissions.

A project replaces the desktop editor's work package: ``project_key`` in
``WorkspaceKey`` and in the method names below is the project key (T2 index
decision D-e). Every query is filtered by project. Snapshots and submissions
are append-only (T2 D6): the application role can only insert and read them.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import partial
from typing import Any, Literal, cast
from urllib.parse import quote, unquote

from sqlalchemy import (
    Connection,
    Row,
    Select,
    Text,
    and_,
    delete,
    exists,
    func,
    insert,
    literal_column,
    or_,
    select,
    tuple_,
    update,
)
from sqlalchemy import cast as cast_sql
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import aliased

from ontotator.auth.context import current_principal
from ontotator.domain.annotations import AnnotationSnapshot
from ontotator.domain.axes import AxesConfig
from ontotator.domain.axis_visibility import editor_profile, legacy_axes_config
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import Document, EvidenceSnapshot
from ontotator.domain.errors import DomainError, InvalidPackage, RevisionConflict
from ontotator.domain.guidelines import guideline_ref
from ontotator.domain.profiles import OntologyDefinition, TaskProfile, profile_hash
from ontotator.domain.project_rules import ProjectRules
from ontotator.domain.reanchor_resolution import PendingReanchorRef, ReanchorItem
from ontotator.domain.results import latest_submissions
from ontotator.domain.review import ReviewDecision, ReviewTargetSet
from ontotator.domain.scopes import build_scope, is_review_like
from ontotator.domain.serialization import decode_snapshot, encode_snapshot
from ontotator.domain.variants import VariantInfo
from ontotator.domain.work_rounds import (
    CARRY_ROUND_KINDS,
    WorkRoundView,
    archive_round,
    archived_inputs,
    derive_source_obligations,
)
from ontotator.domain.workspace import (
    Draft,
    MutationEnvelope,
    Submission,
    WorkspaceKey,
)
from ontotator.exchange.t1 import (
    ImportCounts,
    ImportedDocument,
    ImportedSet,
    Pin,
    T1Profile,
    check_t1_profile,
)
from ontotator.ontology.conditions import SearchCondition, validate_resources
from ontotator.packages.models import (
    PackageManifest,
    SearchEventRecord,
    ValidatedPackage,
    is_tree_walk,
)
from ontotator.storage.database import Database, advisory_lock_id
from ontotator.storage.guidelines import current_guideline_version, guideline_facts
from ontotator.storage.live_submissions import discarded_draft_keys, live_submission
from ontotator.storage.tables import (
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
# Identities per snapshot verification query (bind parameters stay far below limits).
_SNAPSHOT_CHUNK = 1000
_INSERT_CHUNK = 5000


def _insert_rows(
    conn: Connection, table: Any, rows: list[dict[str, Any]], *returning: Any
) -> list[Row[Any]]:
    """Insert ``rows`` unless they exist, with one array parameter per column.

    An import of thousands of documents does this under the exclusive project
    lock: arrays take far less time than executemany or multi-row VALUES (#209).
    """

    def column(name: str, values: list[Any]) -> Any:
        kind = table.__table__.c[name].type
        if isinstance(kind, JSONB):
            texts = cast_sql([json.dumps(value) for value in values], ARRAY(Text))
            return cast_sql(func.unnest(texts), JSONB)
        return func.unnest(cast_sql(values, ARRAY(kind)))

    names = list(rows[0])
    inserted: list[Row[Any]] = []
    for i in range(0, len(rows), _INSERT_CHUNK):
        chunk = rows[i : i + _INSERT_CHUNK]
        statement = (
            pg_insert(table)
            .from_select(
                names, select(*[column(n, [r[n] for r in chunk]) for n in names])
            )
            .on_conflict_do_nothing()
        )
        result = conn.execute(statement.returning(*returning or (literal_column("1"),)))
        inserted.extend(result.all())
    return inserted


def _key_str(key: WorkspaceKey) -> str:
    """The persisted identity of a workspace key.

    Keys whose components contain no ':' use the ':'-joined form. Any other
    key is percent-encoded per component and joined with '|' behind a prefix,
    which keeps the encoding injective.
    """
    parts = [
        key.project_key,
        key.document_id,
        key.annotator_id,
        key.mode,
        key.scope_id,
        key.target_set_id,
    ]
    if key.round_id is not None:
        return "wk3|" + "|".join(
            quote(part, safe="") for part in [*parts, key.round_id]
        )
    if not any(":" in part for part in parts):
        return ":".join(parts)
    return _ESCAPED_KEY_PREFIX + "|".join(quote(part, safe="") for part in parts)


def _decode_key_str(value: str) -> WorkspaceKey:
    """Decode the storage identity; never reconstruct a v3 key from legacy columns."""
    fields = (
        "project_key",
        "document_id",
        "annotator_id",
        "mode",
        "scope_id",
        "target_set_id",
    )
    if value.startswith("wk3|") and len(value.split("|")) == 8:
        parts = [unquote(part) for part in value.split("|")[1:]]
        return WorkspaceKey.model_validate(
            dict(zip(fields, parts[:6], strict=True))
            | {"format_version": "ontotator-workspace-key/v3", "round_id": parts[6]}
        )
    parts = (
        [unquote(part) for part in value.split("|")[1:]]
        if value.startswith(_ESCAPED_KEY_PREFIX)
        else value.split(":")
    )
    if len(parts) != 6:
        raise DomainError("INVALID_WORKSPACE_KEY")
    return WorkspaceKey.model_validate(dict(zip(fields, parts, strict=True)))


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
    origin: WorkspaceKey, project_key: str, profile: TaskProfile
) -> WorkspaceKey:
    """Bind imported history to the importing project's workspace identity."""
    return origin.model_copy(
        update={
            "project_key": project_key,
            "scope_id": build_scope(profile, origin.mode).scope_id,
            "target_set_id": "targets-0"
            if origin.mode == "independent" and origin.round_id is None
            else origin.target_set_id,
        }
    )


def _workspace_aliases(key: WorkspaceKey) -> tuple[str, ...]:
    """Both historical empty-target and API-default independent bindings."""
    keys = {_key_str(key)}
    if key.round_id is not None:
        return (_key_str(key),)
    if key.mode == "independent":
        for target_id in ("targets-0", ReviewTargetSet.create([]).target_set_id):
            keys.add(_key_str(key.model_copy(update={"target_set_id": target_id})))
    return tuple(sorted(keys))


_lock_id = advisory_lock_id


def _lock_project(conn: Connection, project_key: str, *, exclusive: bool) -> None:
    """The project's transaction lock, shared or exclusive."""
    lock = (
        func.pg_advisory_xact_lock if exclusive else func.pg_advisory_xact_lock_shared
    )
    conn.execute(select(lock(_lock_id("project", project_key))))


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
    reanchor_inputs: tuple[dict[str, Any], ...] = ()
    reanchor_resolutions: tuple[dict[str, Any], ...] = ()
    round_input_resolutions: tuple[dict[str, Any], ...] = ()

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
            round_input_resolutions=tuple(
                r.model_dump(mode="json") for r in draft.round_input_resolutions
            ),
            reanchor_inputs=tuple(
                item.model_dump(mode="json") for item in draft.reanchor_inputs
            ),
            reanchor_resolutions=tuple(
                item.model_dump(mode="json") for item in draft.reanchor_resolutions
            ),
        )

    @classmethod
    def from_json(cls, stored: dict[str, Any]) -> DraftState:
        return cls(
            annotations=tuple((str(i), str(v)) for i, v in stored["annotations"]),
            evidence=tuple((str(i), str(v)) for i, v in stored["evidence"]),
            decisions=tuple(stored["decisions"]),
            checked_layer_ids=tuple(stored["checked_layer_ids"]),
            reanchor_inputs=tuple(stored.get("reanchor_inputs", [])),
            reanchor_resolutions=tuple(stored.get("reanchor_resolutions", [])),
            round_input_resolutions=tuple(stored.get("round_input_resolutions", [])),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "annotations": [list(pair) for pair in self.annotations],
            "evidence": [list(pair) for pair in self.evidence],
            "decisions": list(self.decisions),
            "checked_layer_ids": list(self.checked_layer_ids),
            **(
                {"round_input_resolutions": list(self.round_input_resolutions)}
                if self.round_input_resolutions
                else {}
            ),
            **(
                {
                    "reanchor_inputs": list(self.reanchor_inputs),
                    "reanchor_resolutions": list(self.reanchor_resolutions),
                }
                if self.reanchor_inputs or self.reanchor_resolutions
                else {}
            ),
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
    # By submission_id, only for stamped submissions (G20): the reference and
    # the version number of the guideline each result was made under.
    guideline_refs: dict[str, str] = field(default_factory=dict)
    guideline_versions: dict[str, int] = field(default_factory=dict)
    proposal_notes: dict[tuple[str, str], list[str]] = field(default_factory=dict)


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

    def workspace_input_snapshots(self, key: WorkspaceKey) -> list[AnnotationSnapshot]:
        """Only frozen human inputs for a round; legacy proposal selection stays intact."""
        if key.round_id is None:
            return self.list_annotations_for_document(key.project_key, key.document_id)
        round_view = self.get_work_round(key.project_key, key.round_id)
        if round_view.workspace_key != key:
            raise DomainError("ROUND_KEY_MISMATCH")
        inputs = self.get_round_input_inventory(key.project_key, key.round_id)
        # A text-change round has no source submission: its inputs come from a
        # frozen draft, so the carry kind decides, not the submission list.
        if round_view.input_submission_ids or round_view.kind in CARRY_ROUND_KINDS:
            return [
                decode_snapshot(item["target_snapshot"])
                for item in inputs
                if item["target_snapshot"] is not None
            ]
        if round_view.kind == "clean_restart" or key.mode == "independent":
            return []
        with self.db.transaction() as conn:
            row = self._draft_row(
                conn, self._require_project(conn, key.project_key), _key_str(key)
            )
            if row is None:
                raise DomainError("ROUND_NOT_FOUND")
            targets = ReviewTargetSet.model_validate(row.targets)
        allowed = {(ref.annotation_id, ref.version) for ref in targets.targets}
        return [
            snap
            for snap in self.list_annotations_for_document(
                key.project_key, key.document_id
            )
            if (snap.annotation.annotation_id, snap.version) in allowed
        ]

    def _archived_rounds(
        self, conn: Connection, project_id: int
    ) -> dict[str, dict[str, Any]]:
        manifest = PackageManifest.model_validate(
            conn.execute(
                select(ProjectRow.manifest).where(ProjectRow.id == project_id)
            ).scalar_one()
        )
        return manifest.workflow_history or {}

    def get_work_round(self, project_key: str, round_id: str) -> WorkRoundView:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            return self.work_round_in(conn, project_key, project_id, round_id)

    def work_round_in(
        self, conn: Connection, project_key: str, project_id: int, round_id: str
    ) -> WorkRoundView:
        """The round on the caller's connection; the caller has authorized it."""
        from ontotator.storage.tables import AssignmentRow
        from ontotator.storage.workflow_tables import WorkRoundRow, WorkRoundStateRow

        row = (
            conn.execute(
                select(
                    WorkRoundRow,
                    WorkRoundStateRow.state,
                    WorkRoundStateRow.latest_submission_id,
                    AssignmentRow.active_round_id,
                    AssignmentRow.workflow_revision,
                )
                .join(
                    WorkRoundStateRow,
                    WorkRoundStateRow.round_id == WorkRoundRow.round_id,
                )
                .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
                .where(
                    WorkRoundRow.project_id == project_id,
                    WorkRoundRow.round_id == round_id,
                )
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            archived = self._archived_rounds(conn, project_id).get(round_id)
            if archived is None:
                raise DomainError("ROUND_NOT_FOUND")
            view = WorkRoundView.model_validate(archived["round"])
            return view.model_copy(update={"project_key": project_key, "active": False})
        return WorkRoundView(
            round_id=row["round_id"],
            project_key=project_key,
            assignment_id=row["assignment_id"],
            document_id=row["document_id"],
            annotator_id=row["annotator_id"],
            kind=row["kind"],
            mode=row["mode"],
            state=row["state"],
            workflow_revision=row["workflow_revision"],
            latest_submission_id=row["latest_submission_id"],
            predecessor_round_id=row["predecessor_round_id"],
            input_manifest_sha256=row["input_manifest_sha256"],
            input_submission_ids=row["input_submission_ids"],
            workspace_key=row["workspace_key"],
            active=row["active_round_id"] == round_id,
        )

    def get_round_for_submission(
        self, project_key: str, submission_id: str
    ) -> WorkRoundView | None:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            return self.round_for_submission_in(
                conn, project_key, project_id, submission_id
            )

    def round_for_submission_in(
        self, conn: Connection, project_key: str, project_id: int, submission_id: str
    ) -> WorkRoundView | None:
        """The submission's round on the caller's connection; caller has authorized it."""
        from ontotator.storage.workflow_tables import RoundSubmissionBindingRow

        round_id = conn.execute(
            select(RoundSubmissionBindingRow.round_id).where(
                RoundSubmissionBindingRow.project_id == project_id,
                RoundSubmissionBindingRow.submission_id == submission_id,
            )
        ).scalar_one_or_none()
        if round_id is None:
            matches = [
                rid
                for rid, archived in self._archived_rounds(conn, project_id).items()
                if submission_id in archived["submission_ids"]
            ]
            if len(matches) > 1:
                raise DomainError("AMBIGUOUS_SUBMISSION_ORIGIN")
            round_id = matches[0] if matches else None
        return (
            None
            if round_id is None
            else self.work_round_in(conn, project_key, project_id, round_id)
        )

    def get_round_input_inventory(
        self, project_key: str, round_id: str
    ) -> list[dict[str, Any]]:
        from ontotator.storage.workflow_tables import RoundInputRow

        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            archived = self._archived_rounds(conn, project_id).get(round_id)
            if archived is not None:
                return archived_inputs(archived)
            self.get_work_round(project_key, round_id)
            # Re-assert the input id, the source submission and (frozen-draft
            # inputs only) the draft snapshot from the columns; submission
            # inputs keep their exact stored shape (exports and archives
            # hash it).
            return [
                dict(row.payload)
                | {
                    "input_id": row.input_id,
                    "source_submission_id": row.source_submission_id,
                }
                | (
                    {"source_draft_snapshot_id": row.source_draft_snapshot_id}
                    if row.source_draft_snapshot_id is not None
                    else {}
                )
                for row in conn.execute(
                    select(RoundInputRow)
                    .where(
                        RoundInputRow.project_id == project_id,
                        RoundInputRow.round_id == round_id,
                    )
                    .order_by(RoundInputRow.position)
                )
            ]

    def list_workflow_causes(self, project_key: str) -> list[dict[str, Any]]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            return self.workflow_causes_in(conn, project_key, project_id)

    def workflow_causes_in(
        self, conn: Connection, project_key: str, project_id: int
    ) -> list[dict[str, Any]]:
        """Workflow causes on the caller's connection; the caller has authorized it.

        An active hold whose report is not open becomes the derived cause
        ``TASK_PAUSED_WITHOUT_REPORT`` with id ``TASK_PAUSED_WITHOUT_REPORT:{hold_id}``.
        """
        from ontotator.storage.workflow_tables import ReviewObligationResolutionRow

        resolved = set(
            conn.execute(
                select(ReviewObligationResolutionRow.cause_id).where(
                    ReviewObligationResolutionRow.project_id == project_id,
                )
            ).scalars()
        )
        # `_variants` opens `db.transaction()`, which joins the ambient
        # transaction, so it runs on the caller's connection.
        result = [
            cause.model_dump()
            for cause in derive_source_obligations(
                project_key, self._variants(project_key), resolved
            )
        ]
        from ontotator.storage.tables import AssignmentRow
        from ontotator.storage.workflow_tables import (
            ProblemReportRow,
            ProblemReportStateRow,
            TaskHoldRow,
            TaskHoldStateRow,
        )

        reports = conn.execute(
            select(
                ProblemReportRow.report_id,
                ProblemReportStateRow.revision,
                AssignmentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
            )
            .join(
                ProblemReportStateRow,
                ProblemReportStateRow.report_id == ProblemReportRow.report_id,
            )
            .join(AssignmentRow, AssignmentRow.id == ProblemReportRow.assignment_id)
            .join(
                DocumentRow,
                and_(
                    DocumentRow.project_id == AssignmentRow.project_id,
                    DocumentRow.document_id == AssignmentRow.document_id,
                ),
            )
            .where(
                ProblemReportRow.project_id == project_id,
                ProblemReportStateRow.state == "open",
            )
        ).all()
        for row in reports:
            result.append(
                {
                    "cause_id": row.report_id,
                    "cause_revision": row.revision,
                    "code": "OPEN_PROBLEM_REPORT",
                    "case_id": row.case_id,
                    "language": row.language,
                    "document_id": row.document_id,
                    "report_id": row.report_id,
                    "reason": "An open problem report needs a lead decision.",
                    "destination": f"#/projects/{quote(project_key, safe='')}/problem-reports/{quote(row.report_id, safe='')}",
                }
            )
        holds = conn.execute(
            select(
                TaskHoldRow.hold_id,
                TaskHoldRow.reason,
                TaskHoldRow.report_id,
                TaskHoldRow.assignment_id,
                ProblemReportStateRow.state.label("report_state"),
                AssignmentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.language,
            )
            .join(TaskHoldStateRow, TaskHoldStateRow.hold_id == TaskHoldRow.hold_id)
            .join(
                ProblemReportStateRow,
                ProblemReportStateRow.report_id == TaskHoldRow.report_id,
            )
            .join(AssignmentRow, AssignmentRow.id == TaskHoldRow.assignment_id)
            .join(
                DocumentRow,
                and_(
                    DocumentRow.project_id == AssignmentRow.project_id,
                    DocumentRow.document_id == AssignmentRow.document_id,
                ),
            )
            .where(
                TaskHoldRow.project_id == project_id,
                TaskHoldStateRow.active.is_(True),
            )
        ).all()
        for held in holds:
            report_open = held.report_state == "open"
            result.append(
                {
                    "cause_id": held.hold_id
                    if report_open
                    else f"TASK_PAUSED_WITHOUT_REPORT:{held.hold_id}",
                    "cause_revision": 1,
                    "code": "TASK_ON_HOLD"
                    if report_open
                    else "TASK_PAUSED_WITHOUT_REPORT",
                    "case_id": held.case_id,
                    "language": held.language,
                    "document_id": held.document_id,
                    "report_id": held.report_id,
                    "assignment_id": held.assignment_id,
                    "reason": held.reason
                    if report_open
                    else "This task is paused, but its report is resolved.",
                    "destination": f"#/projects/{quote(project_key, safe='')}/problem-reports/{quote(held.report_id, safe='')}",
                }
            )
        return result

    # --- projects ---------------------------------------------------------- #

    @staticmethod
    def _project_id(conn: Connection, project_key: str) -> int | None:
        return conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == project_key)
        ).scalar_one_or_none()

    def _require_project(self, conn: Connection, project_key: str) -> int:
        project_id = self._project_id(conn, project_key)
        if project_id is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{project_key}'"
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
        with self.db.transaction() as conn:
            files = {
                path: (self.db.put_blob(conn, data), len(data))
                for path, data in package.embedded_files.items()
            }
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
        project_key = package.manifest.package_id
        order = {
            doc_id: index
            for index, doc_id in enumerate(package.manifest.document_order)
        }
        documents = [
            {
                "project_id": project_id,
                "document_id": doc.document_id,
                "case_id": doc.document_id,
                "external_id": doc.document_id,
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
        proposal_annotations = (
            package.manifest.proposal_annotation_refs
            if package.manifest.format_version == "ontotator-work-package/v3"
            else list(package.annotations)
        )
        proposal_evidence = (
            package.manifest.proposal_evidence_refs
            if package.manifest.format_version == "ontotator-work-package/v3"
            else list(package.evidence)
        )
        if proposal_annotations:
            conn.execute(
                insert(ProposalAnnotationRow),
                [
                    {"project_id": project_id, "annotation_id": a, "version": v}
                    for a, v in proposal_annotations
                ],
            )
        if proposal_evidence:
            conn.execute(
                insert(ProposalEvidenceRow),
                [
                    {"project_id": project_id, "evidence_id": e, "version": v}
                    for e, v in proposal_evidence
                ],
            )
        for submission in package.submissions.values():
            local = _local_import_key(submission.origin_key, project_key, profile)
            self._insert_submission(
                conn, project_id, submission, local_key=_key_str(local), imported=True
            )
        for event in package.search_events:
            local = _local_import_key(event.workspace_key, project_key, profile)
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
        """A known snapshot identity of any project must have the same content.

        One indexed query per chunk of identities, not one table scan each:
        imports run this under the global import lock.
        """
        checks: tuple[tuple[Any, Any, list[tuple[str, str, Callable[[], Any]]]], ...]
        checks = (
            (
                AnnotationSnapshotRow,
                AnnotationSnapshotRow.annotation_id,
                [
                    (
                        s.annotation.annotation_id,
                        s.version,
                        partial(encode_snapshot, s),
                    )
                    for s in annotations
                ],
            ),
            (
                EvidenceSnapshotRow,
                EvidenceSnapshotRow.evidence_id,
                [(e.mention.evidence_id, e.version, e.model_dump) for e in evidence],
            ),
        )
        for row, id_column, items in checks:
            # Hashed only for identities already stored: a new import has none,
            # and it waits here under the exclusive project lock (#209).
            encoders: dict[tuple[str, str], list[Callable[[], Any]]] = {}
            for item_id, version, encode in items:
                encoders.setdefault((item_id, version), []).append(encode)
            keys = list(encoders)
            for i in range(0, len(keys), _SNAPSHOT_CHUNK):
                for item_id, version, stored in conn.execute(
                    select(id_column, row.version, row.payload).where(
                        tuple_(id_column, row.version).in_(
                            keys[i : i + _SNAPSHOT_CHUNK]
                        )
                    )
                ):
                    expected = {
                        canonical_hash(encode())
                        for encode in encoders[(item_id, version)]
                    }
                    if expected != {canonical_hash(stored)}:
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
            or stored_annotations
            != set(
                package.manifest.proposal_annotation_refs
                if package.manifest.proposal_annotation_refs is not None
                else package.annotations
            )
            or stored_evidence
            != set(
                package.manifest.proposal_evidence_refs
                if package.manifest.proposal_evidence_refs is not None
                else package.evidence
            )
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

    def get_search_conditions(self, project_key: str) -> list[SearchCondition] | None:
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, project_key)
            if project_id is None:
                return None
            return self._search_conditions(conn, project_id)

    def capture_search_conditions(
        self,
        project_key: str,
        conditions: list[SearchCondition],
        resources: dict[str, bytes],
        *,
        expected_structure: str | None = None,
    ) -> list[SearchCondition]:
        """Store first-use conditions once; concurrent captures get the first ones."""
        with self.db.transaction() as conn:
            files = {
                path: (self.db.put_blob(conn, data), len(data))
                for path, data in resources.items()
            }
            conn.execute(
                select(
                    func.pg_advisory_xact_lock_shared(_lock_id("project", project_key))
                )
            )
            if expected_structure is not None:
                from ontotator.projects.runtime import project_state

                if project_state(conn, project_key)[0] != expected_structure:
                    raise RevisionConflict(
                        "Project structure changed while capturing search conditions; retry."
                    )
            validate_resources(
                conditions, self.get_task_profile(project_key), resources
            )
            project_id = self._require_project(conn, project_key)
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
                    raise DomainError("SEARCH_CONDITIONS_MISSING", project_key)
                return existing
            self._store_files(conn, project_id, files)
            return conditions

    def get_embedded_files(self, project_key: str) -> dict[str, bytes]:
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, project_key)
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

    def project_pins(self, project_key: str) -> dict[str, Pin]:
        """The project's pinned ontologies by ontology id."""
        with self.db.transaction() as conn:
            return self._pins(conn, self._require_project(conn, project_key))

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

    def add_snapshots(
        self,
        project_key: str,
        annotations: Sequence[AnnotationSnapshot],
        evidence: Sequence[EvidenceSnapshot],
    ) -> None:
        """Store the snapshots of a coming import before its exclusive project lock.

        They are most of an import's rows, and until the commit nobody sees them,
        so the project stays readable meanwhile (#209). Runs in the caller's
        transaction, which must fail if the plan they belong to turns out outdated:
        committed without their sets, they would refer to nothing.
        """
        with self.db.transaction() as conn:
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("import"))))
            project_id = self._require_project(conn, project_key)
            self._verify_snapshot_contents(conn, annotations, evidence)
            self._insert_snapshots(conn, project_id, annotations, evidence)

    def add_documents_and_proposals(
        self,
        project_key: str,
        documents: Sequence[ImportedDocument],
        proposal_sets: Sequence[ImportedSet],
        *,
        source_sha256: str | None,
        imported_by: int | None = None,
        job_id: int | None = None,
        on_done: Callable[[Connection, int, ImportCounts], None] | None = None,
        snapshots_added: bool = False,
    ) -> ImportCounts:
        """Add imported documents and sets in one transaction (T3 A1, T7 O1, O2).

        A known document with another text is ``DOCUMENT_CONFLICT`` and nothing
        is written; an identical one is skipped. A set already imported under
        the same (bundle, set, document) is skipped, so a re-import adds
        nothing. ``on_done`` runs with the counts in the same transaction.
        With ``snapshots_added``, ``add_snapshots`` already stored the snapshots.
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
                select(func.pg_advisory_xact_lock(_lock_id("project", project_key)))
            )
            project_id = self._require_project(conn, project_key)
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
            if not snapshots_added:
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
                        "case_id": entry.variant.case_id if entry.variant else doc_id,
                        "external_id": entry.variant.external_id
                        if entry.variant
                        else doc_id,
                        "version": entry.variant.version if entry.variant else 1,
                        "origin": entry.variant.origin if entry.variant else "native",
                        "derived_from": entry.variant.derived_from
                        if entry.variant
                        else None,
                        "translation": entry.variant.translation
                        if entry.variant
                        else None,
                        "translation_status": entry.variant.translation_status
                        if entry.variant
                        else None,
                        "status_reason": entry.variant.status_reason
                        if entry.variant
                        else None,
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
            if proposal_sets:
                # One statement per table, not per set: this runs under the
                # exclusive project lock (#209).
                created = {
                    (bundle_id, annotation_set_id, document_id): set_id
                    for set_id, bundle_id, annotation_set_id, document_id in _insert_rows(
                        conn,
                        ProposalSetRow,
                        [
                            {
                                "project_id": project_id,
                                "document_id": item.document_id,
                                "bundle_id": item.bundle_id,
                                "manifest_sha256": item.manifest_sha256,
                                "annotation_set_id": item.annotation_set_id,
                                "set_kind": item.set_kind,
                                "actors": item.actors,
                                "payload": item.payload,
                                "origin": item.origin,
                                "pending_items": item.pending_items,
                                "source_sha256": source_sha256,
                                "imported_by": imported_by,
                                "job_id": job_id,
                            }
                            for item in proposal_sets
                        ],
                        ProposalSetRow.id,
                        ProposalSetRow.bundle_id,
                        ProposalSetRow.annotation_set_id,
                        ProposalSetRow.document_id,
                    )
                }
                added: list[tuple[int, ImportedSet]] = []
                for item in proposal_sets:
                    key = (item.bundle_id, item.annotation_set_id, item.document_id)
                    set_id = created.pop(key, None)
                    if set_id is None:
                        counts["sets_skipped"] += 1
                    else:
                        counts["sets_added"] += 1
                        added.append((set_id, item))
                if not snapshots_added:
                    self._insert_snapshots(
                        conn,
                        project_id,
                        [s for _, item in added for s in item.proposals.annotations],
                        [e for _, item in added for e in item.proposals.evidence],
                    )
                annotation_rows = [
                    {
                        "project_id": project_id,
                        "annotation_id": snap.annotation.annotation_id,
                        "version": snap.version,
                        "proposal_set_id": set_id,
                        "notes": item.proposals.notes.get(
                            snap.annotation.annotation_id, []
                        ),
                    }
                    for set_id, item in added
                    for snap in item.proposals.annotations
                ]
                if annotation_rows:
                    counts["proposals"] = len(
                        _insert_rows(
                            conn,
                            ProposalAnnotationRow,
                            annotation_rows,
                            ProposalAnnotationRow.annotation_id,
                        )
                    )
                evidence_rows = [
                    {
                        "project_id": project_id,
                        "evidence_id": ev.mention.evidence_id,
                        "version": ev.version,
                    }
                    for _, item in added
                    for ev in item.proposals.evidence
                ]
                if evidence_rows:
                    _insert_rows(conn, ProposalEvidenceRow, evidence_rows)
            if on_done is not None:
                on_done(conn, project_id, counts)
        return counts

    # --- exports (T2d) ------------------------------------------------------ #

    def t1_export_content(self, project_key: str) -> ProjectExport:
        """What a T1 export of the project needs, read in one snapshot.

        Per document, annotator and mode only the latest submission is kept:
        the latest revision of each origin, then the one recorded last.
        """
        return self._t1_export_content(project_key)

    def t1_export_content_exact(
        self, project_key: str, submission_ids: Sequence[str]
    ) -> ProjectExport:
        """Resolve exact immutable selections without a latest-result substitution."""
        return self._t1_export_content(
            project_key, tuple(dict.fromkeys(submission_ids))
        )

    def _t1_export_content(
        self, project_key: str, submission_ids: tuple[str, ...] | None = None
    ) -> ProjectExport:
        context = (
            self.db.transaction()
            if submission_ids is not None and self.db.in_transaction()
            else self.db.snapshot()
        )
        with context as conn:
            project = conn.execute(
                select(ProjectRow.id, ProjectRow.task_profile).where(
                    ProjectRow.project_key == project_key
                )
            ).one_or_none()
            if project is None:
                raise DomainError(
                    "PACKAGE_NOT_FOUND", f"No package found for package '{project_key}'"
                )
            variants = {v.document_id: v for v in self._variants(project_key)}
            documents = {
                row.document_id: ImportedDocument(
                    Document(
                        document_id=row.document_id,
                        text=row.text,
                        language=row.language,
                        text_sha256=row.text_sha256,
                    ),
                    row.source_text_sha256,
                    variants[row.document_id],
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
            submission_query = select(
                SubmissionRow.document_id,
                SubmissionRow.annotator_id,
                SubmissionRow.mode,
                SubmissionRow.recorded_at,
                SubmissionRow.payload,
                SubmissionRow.guideline_version,
            ).where(SubmissionRow.project_id == project.id)
            if submission_ids is not None:
                # The exact closure of a final export (guarded on selection).
                submission_query = submission_query.where(
                    SubmissionRow.submission_id.in_(submission_ids)
                )
            else:
                # The work export skips discarded submissions (#109).
                submission_query = submission_query.where(live_submission())
            submission_rows = conn.execute(
                submission_query.order_by(
                    SubmissionRow.recorded_at, SubmissionRow.submission_id
                )
            ).all()
            proposal_payloads = conn.execute(
                select(AnnotationSnapshotRow.payload, ProposalAnnotationRow.notes)
                .join(
                    ProposalAnnotationRow,
                    and_(
                        ProposalAnnotationRow.project_id
                        == AnnotationSnapshotRow.project_id,
                        ProposalAnnotationRow.annotation_id
                        == AnnotationSnapshotRow.annotation_id,
                        ProposalAnnotationRow.version == AnnotationSnapshotRow.version,
                    ),
                )
                .where(AnnotationSnapshotRow.project_id == project.id)
            ).all()
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
            facts = (
                guideline_facts(conn, project.id)
                if any(row.guideline_version is not None for row in submission_rows)
                else {}
            )
        groups: dict[tuple[str, str, str], list[Submission]] = {}
        recorded: dict[str, datetime] = {}
        stamps: dict[str, int] = {}
        for row in submission_rows:
            submission = Submission.model_validate(row.payload)
            recorded[submission.submission_id] = row.recorded_at
            if row.guideline_version is not None:
                stamps[submission.submission_id] = row.guideline_version
            groups.setdefault((row.document_id, row.annotator_id, row.mode), []).append(
                submission
            )
        submissions = (
            [
                max(
                    latest_submissions(group),
                    key=lambda s: (recorded[s.submission_id], s.draft_revision),
                )
                for _key, group in sorted(groups.items())
            ]
            if submission_ids is None
            else [Submission.model_validate(row.payload) for row in submission_rows]
        )
        if submission_ids is not None:
            by_id = {item.submission_id: item for item in submissions}
            if set(by_id) != set(submission_ids):
                raise DomainError(
                    "SUBMISSION_NOT_FOUND", "An exact export input is unavailable"
                )
            submissions = [by_id[identity] for identity in submission_ids]
        proposals: dict[tuple[str, str], AnnotationSnapshot] = {}
        proposal_notes: dict[tuple[str, str], list[str]] = {}
        for payload, notes in proposal_payloads:
            snap = decode_snapshot(payload)
            ref = (snap.annotation.annotation_id, snap.version)
            proposals[ref] = snap
            proposal_notes[ref] = list(notes)
        for submission in submissions:
            if submission.origin_key.round_id is not None:
                for item in self.get_round_input_inventory(
                    project_key, submission.origin_key.round_id
                ):
                    if item["target_snapshot"] is not None:
                        alias = decode_snapshot(item["target_snapshot"])
                        proposals[(alias.annotation.annotation_id, alias.version)] = (
                            alias
                        )
        # A withdrawn version keeps its reference (G20): hash and kind stay.
        versions = {
            s.submission_id: stamps[s.submission_id]
            for s in submissions
            if s.submission_id in stamps
        }
        return ProjectExport(
            profile=TaskProfile.model_validate(project.task_profile),
            pins=pins,
            documents=documents,
            submissions=submissions,
            proposals=proposals,
            proposal_notes=proposal_notes,
            contributors=contributors,
            guideline_refs={
                sid: guideline_ref(project_key, version, facts[version].sha256)
                for sid, version in versions.items()
            },
            guideline_versions=versions,
        )

    def edit_log(self, project_key: str) -> list[dict[str, Any]]:
        """Every edit event of the project in id order, pseudonymised (D6).

        No user id and no session id: the annotator is the draft's pseudonym;
        ``at`` is UTC to the second.
        """
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
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

    def get_manifest(self, project_key: str) -> PackageManifest:
        """The stored manifest of a project."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(ProjectRow.manifest).where(ProjectRow.project_key == project_key)
            ).scalar_one_or_none()
        if stored is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND", f"No package found for package '{project_key}'"
            )
        return PackageManifest.model_validate(stored)

    def manifest_hash(self, project_key: str) -> str | None:
        """Canonical manifest hash of a project, or None if absent."""
        with self.db.transaction() as conn:
            return conn.execute(
                select(ProjectRow.manifest_sha256).where(
                    ProjectRow.project_key == project_key
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

    def get_task_profile(self, project_key: str) -> TaskProfile:
        """The resolved task profile of a project."""
        with self.db.transaction() as conn:
            stored = conn.execute(
                select(ProjectRow.task_profile).where(
                    ProjectRow.project_key == project_key
                )
            ).scalar_one_or_none()
        if stored is None:
            raise DomainError(
                "PACKAGE_NOT_FOUND",
                f"No package or task profile found for package '{project_key}'",
            )
        return TaskProfile.model_validate(stored)

    def get_project_rules(self, project_key: str) -> ProjectRules:
        """Read the project's opt-in restrictions by name."""
        with self.db.transaction() as conn:
            row = conn.execute(
                select(
                    ProjectRow.contiguous_mentions_only,
                    ProjectRow.allow_spanless_findings,
                    ProjectRow.require_spanless_note,
                    ProjectRow.require_chosen_axes,
                    ProjectRow.hidden_axis_values,
                    ProjectRow.creation_defaults,
                    ProjectRow.annotation_policy_revision,
                ).where(ProjectRow.project_key == project_key)
            ).one_or_none()
        if row is None:
            raise DomainError("PACKAGE_NOT_FOUND", f"Project '{project_key}' not found")
        return ProjectRules.of(row)

    def get_axes_config(self, project_key: str) -> AxesConfig:
        """AxesConfig synthesized from the task profile, for older callers."""
        return legacy_axes_config(
            editor_profile(
                self.get_task_profile(project_key), self.get_project_rules(project_key)
            )
        )

    # --- documents and proposals ------------------------------------------- #

    def _variants(
        self,
        project_key: str,
        *,
        case_id: str | None = None,
        sha: str | None = None,
        document_id: str | None = None,
        document_ids: frozenset[str] | None = None,
    ) -> list[VariantInfo]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            query = select(
                DocumentRow.document_id,
                DocumentRow.case_id,
                DocumentRow.external_id,
                DocumentRow.language,
                DocumentRow.version,
                DocumentRow.origin,
                DocumentRow.derived_from,
                DocumentRow.translation,
                DocumentRow.translation_status,
                DocumentRow.status_reason,
                DocumentRow.text_sha256,
            ).where(DocumentRow.project_id == project_id)
            if case_id is not None:
                query = query.where(DocumentRow.case_id == case_id)
            if sha is not None:
                query = query.where(DocumentRow.text_sha256 == sha)
            if document_id is not None:
                query = query.where(DocumentRow.document_id == document_id)
            if document_ids is not None:
                query = query.where(DocumentRow.document_id.in_(document_ids))
            return [
                VariantInfo(**row)
                for row in conn.execute(
                    query.order_by(
                        DocumentRow.position.asc().nulls_last(), DocumentRow.document_id
                    )
                ).mappings()
            ]

    def get_variant(self, project_key: str, document_id: str) -> VariantInfo:
        rows = self._variants(project_key, document_id=document_id)
        if not rows:
            raise DomainError("DOCUMENT_NOT_FOUND")
        return rows[0]

    def list_variants(
        self, project_key: str, *, case_id: str | None = None
    ) -> list[VariantInfo]:
        return self._variants(project_key, case_id=case_id)

    def find_variants_by_text_sha256(
        self, project_key: str, sha: str
    ) -> list[VariantInfo]:
        return self._variants(project_key, sha=sha)

    def get_document(self, project_key: str, document_id: str) -> Document | None:
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
                    ProjectRow.project_key == project_key,
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

    def list_documents(self, project_key: str) -> list[Document]:
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
                .where(ProjectRow.project_key == project_key)
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
            _insert_rows(conn, AnnotationSnapshotRow, annotation_rows)
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
            _insert_rows(conn, EvidenceSnapshotRow, evidence_rows)

    def get_annotation_snapshot(
        self, annotation_id: str, version: str, project_key: str | None = None
    ) -> AnnotationSnapshot | None:
        statement = select(AnnotationSnapshotRow.payload).where(
            AnnotationSnapshotRow.annotation_id == annotation_id,
            AnnotationSnapshotRow.version == version,
        )
        if project_key is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == AnnotationSnapshotRow.project_id
            ).where(ProjectRow.project_key == project_key)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else decode_snapshot(stored)

    def get_evidence_snapshot(
        self, evidence_id: str, version: str, project_key: str | None = None
    ) -> EvidenceSnapshot | None:
        statement = select(EvidenceSnapshotRow.payload).where(
            EvidenceSnapshotRow.evidence_id == evidence_id,
            EvidenceSnapshotRow.version == version,
        )
        if project_key is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == EvidenceSnapshotRow.project_id
            ).where(ProjectRow.project_key == project_key)
        with self.db.transaction() as conn:
            stored = conn.execute(statement.limit(1)).scalar_one_or_none()
        return None if stored is None else EvidenceSnapshot.model_validate(stored)

    def list_annotations_for_document(
        self, project_key: str, document_id: str
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
                        ProjectRow.project_key == project_key,
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

    def _proposal_set_metadata_query(self, project_id: int) -> Select[Any]:
        previous = aliased(DocumentRow)
        return (
            select(
                ProposalSetRow.id,
                ProposalSetRow.document_id,
                ProposalSetRow.annotation_set_id,
                ProposalSetRow.bundle_id,
                ProposalSetRow.set_kind,
                ProposalSetRow.origin,
                previous.document_id.label("source_document_id"),
                previous.version.label("source_version"),
                ProposalSetRow.actors,
                ProposalSetRow.imported_at,
                UserRow.pseudonym.label("imported_by_pseudonym"),
            )
            .outerjoin(UserRow, UserRow.id == ProposalSetRow.imported_by)
            .join(
                DocumentRow,
                and_(
                    DocumentRow.project_id == ProposalSetRow.project_id,
                    DocumentRow.document_id == ProposalSetRow.document_id,
                ),
            )
            .outerjoin(
                previous,
                and_(
                    previous.project_id == DocumentRow.project_id,
                    previous.document_id == DocumentRow.derived_from,
                    previous.case_id == DocumentRow.case_id,
                    previous.language == DocumentRow.language,
                ),
            )
            .where(ProposalSetRow.project_id == project_id)
        )

    @staticmethod
    def _proposal_set_metadata(row: Mapping[str, Any]) -> dict[str, Any]:
        result = dict(row)
        if row["origin"] != "reanchor":
            result.update(source_document_id=None, source_version=None)
        elif row["source_version"] is None:
            raise DomainError("PROPOSAL_SET_NOT_FOUND")
        return result

    def get_proposal_set(self, project_key: str, set_id: int) -> dict[str, Any]:
        """Producer metadata, with its actual owning document association."""
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            row = (
                conn.execute(
                    self._proposal_set_metadata_query(project_id).where(
                        ProposalSetRow.id == set_id
                    )
                )
                .mappings()
                .one_or_none()
            )
            if row is None or self.get_document(project_key, row.document_id) is None:
                raise DomainError("PROPOSAL_SET_NOT_FOUND", "Proposal set not found.")
            return self._proposal_set_metadata(dict(row))

    def workspace_proposal_sets(
        self, key: WorkspaceKey, offered: Sequence[tuple[str, str, int]]
    ) -> list[dict[str, Any]]:
        """Unique metadata behind server-offered immutable refs, never arbitrary sets."""
        if key.mode == "independent" or not offered:
            return []
        scope = build_scope(self.get_task_profile(key.project_key), key.mode)
        if key.scope_id and key.scope_id != scope.scope_id:
            raise DomainError("INVALID_SCOPE")
        layers = scope.reference_layer_ids + (
            scope.editable_layer_ids if is_review_like(key.mode) else []
        )
        if not layers:
            return []
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, key.project_key)
            offered_sets = (
                select(ProposalAnnotationRow.proposal_set_id)
                .join(
                    AnnotationSnapshotRow,
                    and_(
                        AnnotationSnapshotRow.project_id
                        == ProposalAnnotationRow.project_id,
                        AnnotationSnapshotRow.annotation_id
                        == ProposalAnnotationRow.annotation_id,
                        AnnotationSnapshotRow.version == ProposalAnnotationRow.version,
                    ),
                )
                .where(
                    ProposalAnnotationRow.project_id == project_id,
                    AnnotationSnapshotRow.document_id == key.document_id,
                    AnnotationSnapshotRow.payload["annotation"]["layer_id"].astext.in_(
                        layers
                    ),
                    tuple_(
                        ProposalAnnotationRow.annotation_id,
                        ProposalAnnotationRow.version,
                        ProposalAnnotationRow.proposal_set_id,
                    ).in_(offered),
                )
            )
            rows = conn.execute(
                self._proposal_set_metadata_query(project_id)
                .where(
                    ProposalSetRow.document_id == key.document_id,
                    ProposalSetRow.id.in_(offered_sets),
                )
                .order_by(ProposalSetRow.id)
            ).mappings()
            return [self._proposal_set_metadata(dict(row)) for row in rows]

    def get_variant_text(self, project_key: str, document_id: str) -> Document | None:
        """Immutable text, separately scoped from annotation/workspace reads."""
        return Repository.get_document(self, project_key, document_id)

    def get_annotation_version(
        self, project_key: str, document_id: str, kind: str, version_id: str
    ) -> dict[str, Any]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            if kind in {"own", "submission", "final"}:
                payload = conn.execute(
                    select(SubmissionRow.payload).where(
                        SubmissionRow.project_id == project_id,
                        SubmissionRow.document_id == document_id,
                        SubmissionRow.submission_id == version_id,
                    )
                ).scalar_one_or_none()
                if payload is None:
                    raise DomainError("VERSION_NOT_FOUND")
                annotations = Submission.model_validate(payload).snapshots
            elif kind == "proposals" and version_id.isdecimal():
                payloads = (
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
                        .join(
                            ProposalSetRow,
                            and_(
                                ProposalSetRow.id
                                == ProposalAnnotationRow.proposal_set_id,
                                ProposalSetRow.project_id
                                == ProposalAnnotationRow.project_id,
                            ),
                        )
                        .where(
                            ProposalSetRow.project_id == project_id,
                            ProposalSetRow.document_id == document_id,
                            ProposalSetRow.id == int(version_id),
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
                annotations = [decode_snapshot(payload) for payload in payloads]
            else:
                raise DomainError("VERSION_NOT_FOUND")
            evidence = {
                (item.mention.evidence_id, item.version): item
                for snap in annotations
                for item in snap.evidence
            }
            return {"annotations": annotations, "evidence": list(evidence.values())}

    def get_reanchor_items(
        self, project_key: str, document_id: str
    ) -> list[dict[str, Any]]:
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            rows = conn.execute(
                select(ProposalSetRow.id, ProposalSetRow.pending_items)
                .where(
                    ProposalSetRow.project_id == project_id,
                    ProposalSetRow.document_id == document_id,
                    ProposalSetRow.origin == "reanchor",
                )
                .order_by(ProposalSetRow.id)
            ).all()
            result = []
            for row in rows:
                for item in row.pending_items:
                    if not isinstance(item, dict):
                        raise DomainError("VERSION_NOT_FOUND")
                    result.append({**item, "proposal_set_id": row.id})
            return result

    def proposal_metadata(
        self, project_key: str, document_id: str
    ) -> dict[tuple[str, str], dict[str, Any]]:
        """Metadata keyed by immutable annotation reference in one document."""
        if self.get_document(project_key, document_id) is None:
            raise DomainError("DOCUMENT_NOT_FOUND", "Document not found.")
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            rows = conn.execute(
                select(
                    ProposalAnnotationRow.annotation_id,
                    ProposalAnnotationRow.version,
                    ProposalAnnotationRow.proposal_set_id,
                    ProposalAnnotationRow.notes,
                )
                .join(
                    AnnotationSnapshotRow,
                    and_(
                        AnnotationSnapshotRow.project_id
                        == ProposalAnnotationRow.project_id,
                        AnnotationSnapshotRow.annotation_id
                        == ProposalAnnotationRow.annotation_id,
                        AnnotationSnapshotRow.version == ProposalAnnotationRow.version,
                    ),
                )
                .where(
                    ProposalAnnotationRow.project_id == project_id,
                    AnnotationSnapshotRow.document_id == document_id,
                )
            )
            return {
                (r.annotation_id, r.version): {
                    "proposal_set_id": r.proposal_set_id,
                    "notes": r.notes,
                }
                for r in rows
            }

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
        guideline_version: int | None = None,
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
            guideline_version=guideline_version,
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
        project_key: str,
        annotator_id: str,
        mode: str | None = None,
        document_id: str | None = None,
    ) -> list[WorkspaceKey]:
        """Workspace identities of one annotator: opened drafts and submissions."""
        profile = self.get_task_profile(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
            drafts = select(
                DraftRow.draft_key,
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
                live_submission(),
            )
            if mode is not None:
                drafts = drafts.where(DraftRow.mode == mode)
                submissions = submissions.where(SubmissionRow.mode == mode)
            if document_id is not None:
                drafts = drafts.where(DraftRow.document_id == document_id)
                submissions = submissions.where(
                    SubmissionRow.document_id == document_id
                )
            gone = discarded_draft_keys(
                conn, project_id, annotator_id=annotator_id, mode=mode
            )
            draft_rows = [
                row for row in conn.execute(drafts) if row.draft_key not in gone
            ]
            payloads = conn.execute(submissions).scalars().all()
        keys: dict[str, WorkspaceKey] = {}
        for row in draft_rows:
            key = _decode_key_str(row.draft_key)
            keys[_key_str(key)] = key
        for payload in payloads:
            origin = WorkspaceKey.model_validate(payload["origin_key"])
            key = (
                origin
                if origin.project_key == project_key
                else _local_import_key(origin, project_key, profile)
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
                DraftRow.spanless_policy_version,
                DraftRow.reanchor_inputs,
                DraftRow.reanchor_resolutions,
                DraftRow.round_input_resolutions,
                DraftRow.reanchor_inputs_initialized_at,
                DraftRow.targets,
            ).where(DraftRow.project_id == project_id, DraftRow.draft_key == key_string)
        ).one_or_none()

    def draft_annotation_layer(
        self, key: WorkspaceKey, annotation_id: str
    ) -> str | None:
        """The layer of ``annotation_id`` in the workspace's draft, if it is there.

        A single read: unlike ``open_draft`` it neither locks nor creates the draft.
        """
        with self.db.transaction() as conn:
            project_id = self._project_id(conn, key.project_key)
            if project_id is None:
                return None
            return conn.execute(
                select(AnnotationSnapshotRow.payload["annotation"]["layer_id"].astext)
                .join(
                    DraftAnnotationRow,
                    and_(
                        DraftAnnotationRow.annotation_id
                        == AnnotationSnapshotRow.annotation_id,
                        DraftAnnotationRow.version == AnnotationSnapshotRow.version,
                    ),
                )
                .join(DraftRow, DraftRow.id == DraftAnnotationRow.draft_id)
                .where(
                    DraftRow.project_id == project_id,
                    DraftRow.draft_key == _key_str(key),
                    AnnotationSnapshotRow.project_id == project_id,
                    DraftAnnotationRow.annotation_id == annotation_id,
                )
                .order_by(DraftAnnotationRow.version)
                .limit(1)
            ).scalar_one_or_none()

    def open_draft(
        self,
        key: WorkspaceKey,
        targets: ReviewTargetSet | None = None,
        pending_proposal_set_ids: list[int] | None = None,
    ) -> Draft:
        """Open or initialize the draft of a workspace key.

        Takes the draft lock, so that a draft is never read while a mutation
        of it is half committed.
        """
        with self.db.transaction() as conn:
            self._before_workspace_locks(conn, key)
            self._lock_round_assignment(conn, key)
            self._lock_draft(conn, key)
            self._before_open_draft(conn, key)
            draft = self._open_draft(conn, key, targets)
            return self._freeze_reanchor_inputs(conn, draft, pending_proposal_set_ids)

    def _freeze_reanchor_inputs(
        self, conn: Connection, draft: Draft, selected: list[int] | None
    ) -> Draft:
        """Initialize only at open, under the same lock as draft creation."""
        key = draft.key
        if not is_review_like(key.mode) or key.round_id is not None:
            if selected:
                raise DomainError("INVALID_REANCHOR_ITEM")
            return draft
        project_id = self._require_project(conn, key.project_key)
        row = self._draft_row(conn, project_id, _key_str(key))
        assert row is not None
        if row.reanchor_inputs_initialized_at is not None:
            if selected is not None and set(selected) != {
                item.proposal_set_id for item in draft.reanchor_inputs
            }:
                raise DomainError("REANCHOR_INPUTS_CONFLICT")
            return draft
        scope = build_scope(self.get_task_profile(key.project_key), key.mode)
        rows = conn.execute(
            select(ProposalSetRow.id, ProposalSetRow.pending_items)
            .where(
                ProposalSetRow.project_id == project_id,
                ProposalSetRow.document_id == key.document_id,
                ProposalSetRow.origin == "reanchor",
            )
            .order_by(ProposalSetRow.id)
        ).all()
        eligible: dict[int, list[PendingReanchorRef]] = {}
        for candidate in rows:
            refs = [
                PendingReanchorRef(
                    proposal_set_id=candidate.id, source_ref=raw["source_ref"]
                )
                for raw in candidate.pending_items
                if raw["layer_id"] in scope.editable_layer_ids
            ]
            if refs:
                eligible[candidate.id] = refs
        if selected is not None and not set(selected).issubset(eligible):
            raise DomainError("INVALID_REANCHOR_ITEM")
        refs = [
            ref
            for set_id, items in eligible.items()
            if selected is None or set_id in selected
            for ref in items
        ]
        now = datetime.now(UTC)
        conn.execute(
            update(DraftRow)
            .where(DraftRow.id == row.id)
            .values(
                reanchor_inputs=[ref.model_dump(mode="json") for ref in refs],
                reanchor_inputs_initialized_at=now,
            )
        )
        draft.reanchor_inputs = refs
        draft.reanchor_inputs_initialized_at = now.isoformat()
        return draft

    def workspace_reanchor_items(self, draft: Draft) -> list[ReanchorItem]:
        """Only the immutable pending context frozen into this workspace."""
        refs = {
            (
                item.proposal_set_id,
                item.source_ref.annotation_id,
                item.source_ref.version,
            )
            for item in draft.reanchor_inputs
        }
        if not refs or not is_review_like(draft.key.mode):
            return []
        items = []
        for raw in self.get_reanchor_items(
            draft.key.project_key, draft.key.document_id
        ):
            identity = (
                raw["proposal_set_id"],
                raw["source_ref"]["annotation_id"],
                raw["source_ref"]["version"],
            )
            if identity not in refs:
                continue
            source, content_valid = self.reanchor_source_identity(
                draft.key,
                PendingReanchorRef(
                    proposal_set_id=raw["proposal_set_id"], source_ref=raw["source_ref"]
                ),
            )
            items.append(
                ReanchorItem.model_validate(
                    {
                        **raw,
                        "type_id": source.annotation.type_id if content_valid else None,
                        "axes_values": source.annotation.axes_values
                        if content_valid
                        else None,
                        "axes_defaulted": source.annotation.axes_defaulted
                        if content_valid
                        else None,
                    }
                )
            )
        return items

    def verified_reanchor_source(
        self, key: WorkspaceKey, item: PendingReanchorRef
    ) -> AnnotationSnapshot:
        """Require valid source content before authoring or linking a finding."""
        source, content_valid = self.reanchor_source_identity(key, item)
        if not content_valid:
            raise DomainError("INVALID_REANCHOR_ITEM")
        return source

    def reanchor_source_identity(
        self, key: WorkspaceKey, item: PendingReanchorRef
    ) -> tuple[AnnotationSnapshot, bool]:
        """Narrow predecessor lookup: no permission to browse the predecessor."""
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, key.project_key)
            current = (
                conn.execute(
                    select(DocumentRow).where(
                        DocumentRow.project_id == project_id,
                        DocumentRow.document_id == key.document_id,
                    )
                )
                .mappings()
                .one_or_none()
            )
            if current is None or current["origin"] != "correction":
                raise DomainError("INVALID_REANCHOR_ITEM")
            previous = (
                conn.execute(
                    select(DocumentRow).where(
                        DocumentRow.project_id == project_id,
                        DocumentRow.document_id == current["derived_from"],
                        DocumentRow.case_id == current["case_id"],
                        DocumentRow.language == current["language"],
                        DocumentRow.version == current["version"] - 1,
                    )
                )
                .mappings()
                .one_or_none()
            )
            producer = (
                conn.execute(
                    select(ProposalSetRow).where(
                        ProposalSetRow.project_id == project_id,
                        ProposalSetRow.id == item.proposal_set_id,
                        ProposalSetRow.document_id == key.document_id,
                        ProposalSetRow.origin == "reanchor",
                    )
                )
                .mappings()
                .one_or_none()
            )
            if previous is None or producer is None:
                raise DomainError("INVALID_REANCHOR_ITEM")
            pending = next(
                (
                    raw
                    for raw in producer["pending_items"]
                    if raw["source_ref"] == item.source_ref.model_dump()
                ),
                None,
            )
            if pending is None:
                raise DomainError("INVALID_REANCHOR_ITEM")
            members = conn.execute(
                select(ProposalSetRow.id, AnnotationSnapshotRow.payload)
                .join(
                    ProposalAnnotationRow,
                    and_(
                        ProposalAnnotationRow.project_id == ProposalSetRow.project_id,
                        ProposalAnnotationRow.proposal_set_id == ProposalSetRow.id,
                    ),
                )
                .join(
                    AnnotationSnapshotRow,
                    and_(
                        AnnotationSnapshotRow.project_id
                        == ProposalAnnotationRow.project_id,
                        AnnotationSnapshotRow.annotation_id
                        == ProposalAnnotationRow.annotation_id,
                        AnnotationSnapshotRow.version == ProposalAnnotationRow.version,
                    ),
                )
                .where(
                    ProposalSetRow.project_id == project_id,
                    ProposalSetRow.document_id == previous["document_id"],
                    AnnotationSnapshotRow.document_id == previous["document_id"],
                    AnnotationSnapshotRow.annotation_id
                    == item.source_ref.annotation_id,
                    AnnotationSnapshotRow.version == item.source_ref.version,
                )
            ).all()
            for source_set_id, payload in members:
                expected = (
                    f"{key.project_key}:reanchor:{key.document_id}:{source_set_id}"
                )
                if producer["annotation_set_id"] == expected:
                    source = decode_snapshot(payload)
                    content_valid = (
                        source.text_sha256 == previous["text_sha256"]
                        and source.document_id == previous["document_id"]
                        and source.annotation.document_id == previous["document_id"]
                        and source.annotation.annotation_id
                        == item.source_ref.annotation_id
                        and source.version == item.source_ref.version
                        and source.annotation.layer_id == pending["layer_id"]
                        and source.annotation.term_id == pending["term_id"]
                    )
                    return source, content_valid
            raise DomainError("INVALID_REANCHOR_ITEM")

    def _lock_round_assignment(self, conn: Connection, key: WorkspaceKey) -> None:
        from ontotator.storage.tables import AssignmentRow
        from ontotator.storage.workflow_tables import (
            RoundWorkspaceBindingRow,
            WorkRoundRow,
        )

        pid = self._require_project(conn, key.project_key)
        row = conn.execute(
            select(AssignmentRow.id)
            .join(WorkRoundRow, WorkRoundRow.assignment_id == AssignmentRow.id)
            .join(
                RoundWorkspaceBindingRow,
                RoundWorkspaceBindingRow.round_id == WorkRoundRow.round_id,
            )
            .where(
                RoundWorkspaceBindingRow.project_id == pid,
                RoundWorkspaceBindingRow.workspace_key == _key_str(key),
            )
            .with_for_update(of=AssignmentRow, key_share=True)
        ).first()
        if key.round_id is not None and row is None:
            raise DomainError("ROUND_NOT_FOUND")

    def _check_round_mutation(
        self, conn: Connection, key: WorkspaceKey, *, allow_submitted: bool = False
    ) -> None:
        from ontotator.storage.tables import AssignmentRow
        from ontotator.storage.workflow_tables import (
            RoundWorkspaceBindingRow,
            WorkRoundRow,
            WorkRoundStateRow,
        )

        pid = self._require_project(conn, key.project_key)
        row = conn.execute(
            select(
                WorkRoundRow.round_id,
                WorkRoundStateRow.state,
                AssignmentRow.active_round_id,
            )
            .join(
                WorkRoundStateRow, WorkRoundStateRow.round_id == WorkRoundRow.round_id
            )
            .join(AssignmentRow, AssignmentRow.id == WorkRoundRow.assignment_id)
            .join(
                RoundWorkspaceBindingRow,
                RoundWorkspaceBindingRow.round_id == WorkRoundRow.round_id,
            )
            .where(
                RoundWorkspaceBindingRow.project_id == pid,
                RoundWorkspaceBindingRow.workspace_key == _key_str(key),
            )
        ).first()
        permitted_states = (
            {"editable", "submitted"} if allow_submitted else {"editable"}
        )
        if row is not None and (
            row.round_id != row.active_round_id or row.state not in permitted_states
        ):
            raise DomainError("ROUND_NOT_EDITABLE")
        if key.round_id is not None and (row is None or row.round_id != key.round_id):
            raise DomainError("ROUND_KEY_MISMATCH")
        if row is None:
            from ontotator.assignments.service import TASK_FOR_MODE

            active = conn.execute(
                select(AssignmentRow.active_round_id)
                .join(UserRow, UserRow.id == AssignmentRow.user_id)
                .where(
                    AssignmentRow.project_id == pid,
                    AssignmentRow.document_id == key.document_id,
                    UserRow.pseudonym == key.annotator_id,
                    AssignmentRow.task == TASK_FOR_MODE[key.mode],
                    AssignmentRow.revoked_at.is_(None),
                )
            ).scalar_one_or_none()
            if active is not None:
                raise DomainError("ROUND_KEY_MISMATCH")

    def _advance_round(
        self, conn: Connection, key: WorkspaceKey, result: Draft | Submission
    ) -> None:
        from ontotator.storage.workflow_tables import (
            RoundSubmissionBindingRow,
            RoundWorkspaceBindingRow,
            WorkRoundStateRow,
        )

        if not isinstance(result, Submission):
            return
        pid = self._require_project(conn, key.project_key)
        rid = conn.execute(
            select(RoundWorkspaceBindingRow.round_id).where(
                RoundWorkspaceBindingRow.project_id == pid,
                RoundWorkspaceBindingRow.workspace_key == _key_str(key),
            )
        ).scalar_one_or_none()
        if rid is not None:
            conn.execute(
                insert(RoundSubmissionBindingRow).values(
                    project_id=pid, round_id=rid, submission_id=result.submission_id
                )
            )
            conn.execute(
                update(WorkRoundStateRow)
                .where(WorkRoundStateRow.round_id == rid)
                .values(
                    state="submitted",
                    latest_submission_id=result.submission_id,
                    revision=WorkRoundStateRow.revision + 1,
                )
            )

    def _before_workspace_locks(
        self, conn: Connection, key: WorkspaceKey, *, exclusive: bool = False
    ) -> None:
        """Keep a contextual principal stable before any draft/assignment lock.

        ``exclusive`` takes the project lock exclusively: a shared lock is
        never upgraded later in the same transaction (two shared holders
        waiting for the same upgrade would deadlock).
        """
        principal = current_principal.get()
        if principal is not None:
            from ontotator.auth.authority import lock_user_authority

            conn.execute(
                select(
                    func.pg_advisory_xact_lock_shared(
                        _lock_id("members", key.project_key)
                    )
                )
            )
            _lock_project(conn, key.project_key, exclusive=exclusive)
            lock_user_authority(conn, principal.user_id)

    def _before_open_draft(self, conn: Connection, key: WorkspaceKey) -> None:
        """HTTP-context open gate; trusted nonrequest callers retain their boundary."""
        principal = current_principal.get()
        if principal is None:
            return
        from ontotator.assignments.eligibility import require_annotation_gate
        from ontotator.assignments.service import TASK_FOR_MODE
        from ontotator.storage.tables import AssignmentRow

        project_id = self._require_project(conn, key.project_key)
        status = conn.execute(
            select(AssignmentRow.status).where(
                AssignmentRow.project_id == project_id,
                AssignmentRow.document_id == key.document_id,
                AssignmentRow.user_id == principal.user_id,
                AssignmentRow.task == TASK_FOR_MODE[key.mode],
                AssignmentRow.revoked_at.is_(None),
            )
        ).scalar_one_or_none()
        if status != "submitted":
            require_annotation_gate(conn, project_id, key.document_id)

    def _before_new_mutation(self, conn: Connection, key: WorkspaceKey) -> None:
        """Request-specific gate, after successful replay/revision checks."""
        if current_principal.get() is not None:
            from ontotator.application.workflow_guards import require_task_writable
            from ontotator.assignments.eligibility import require_annotation_gate
            from ontotator.assignments.service import TASK_FOR_MODE, AssignmentService

            principal = current_principal.get()
            assert principal is not None
            assignment = AssignmentService.active_for(
                conn,
                self._require_project(conn, key.project_key),
                key.document_id,
                principal.user_id,
                TASK_FOR_MODE[key.mode],
            )
            if assignment is not None:
                require_task_writable(conn, assignment.id)
            require_annotation_gate(
                conn, self._require_project(conn, key.project_key), key.document_id
            )

    def _after_new_mutation(
        self,
        conn: Connection,
        key: WorkspaceKey,
        result: Draft | Submission,
        at: datetime,
    ) -> None:
        """Status changes after storage, before receipt, in the same transaction."""
        principal = current_principal.get()
        if principal is None:
            return
        from ontotator.assignments.service import TASK_FOR_MODE
        from ontotator.storage.tables import AssignmentRow

        project_id = self._require_project(conn, key.project_key)
        statement = update(AssignmentRow).where(
            AssignmentRow.project_id == project_id,
            AssignmentRow.document_id == key.document_id,
            AssignmentRow.user_id == principal.user_id,
            AssignmentRow.task == TASK_FOR_MODE[key.mode],
            AssignmentRow.revoked_at.is_(None),
        )
        if isinstance(result, Submission):
            statement = statement.where(
                AssignmentRow.status.in_(["open", "in_progress", "reopened"])
            ).values(
                status="submitted",
                last_submission_id=result.submission_id,
                updated_at=at,
            )
        else:
            statement = statement.where(AssignmentRow.status == "open").values(
                status="in_progress", updated_at=at
            )
        conn.execute(statement)

    @staticmethod
    def _lock_draft(conn: Connection, key: WorkspaceKey) -> None:
        """Serialise the readers and writers of one draft until the transaction ends.

        The advisory lock works before the draft row exists.
        """
        conn.execute(
            select(
                func.pg_advisory_xact_lock(
                    _lock_id("draft", key.project_key, _key_str(key))
                )
            )
        )

    def _open_draft(
        self, conn: Connection, key: WorkspaceKey, targets: ReviewTargetSet | None
    ) -> Draft:
        project_id = self._require_project(conn, key.project_key)
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
            spanless_policy_version=row.spanless_policy_version,
            reanchor_inputs=row.reanchor_inputs,
            reanchor_resolutions=row.reanchor_resolutions,
            round_input_resolutions=row.round_input_resolutions,
            reanchor_inputs_initialized_at=(
                row.reanchor_inputs_initialized_at.isoformat()
                if row.reanchor_inputs_initialized_at is not None
                else None
            ),
            annotations=[decode_snapshot(p) for p in annotations],
            evidence=[EvidenceSnapshot.model_validate(p) for p in evidence],
            decisions=[ReviewDecision.model_validate(p) for p in decisions],
            checked_layer_ids=list(row.checked_layer_ids),
        )

    @staticmethod
    def _discard_drafts(
        conn: Connection,
        project_id: int,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> int:
        """Delete every draft of one workspace (all scopes, target sets and
        rounds); annotations, evidence and decisions cascade. Edit events,
        snapshots and audit stay. The number of drafts deleted."""
        return len(
            conn.execute(
                delete(DraftRow)
                .where(
                    DraftRow.project_id == project_id,
                    DraftRow.document_id == document_id,
                    DraftRow.annotator_id == annotator_id,
                    DraftRow.mode == mode,
                )
                .returning(DraftRow.id)
            ).all()
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
                spanless_policy_version=1,
                updated_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=["project_id", "draft_key"])
            .returning(DraftRow.id)
        ).scalar_one_or_none()
        if draft_id is None:
            return  # created by a concurrent request; the caller reads it
        submissions = self._submissions_for_workspace(conn, project_id, key)
        if not submissions:
            if key.round_id is not None and key.mode == "independent":
                seeds = self.workspace_input_snapshots(key)
                # An ordinary independent attempt never sees proposal seeds.
                if (
                    self.get_work_round(key.project_key, key.round_id).kind
                    not in CARRY_ROUND_KINDS
                ):
                    seeds = []
                evidence = [ev for annotation in seeds for ev in annotation.evidence]
                self._insert_snapshots(conn, project_id, seeds, evidence)
                self._write_draft_content(conn, draft_id, seeds, evidence, [])
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
            if not is_review_like(key.mode)
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
                reanchor_inputs=[
                    r.model_dump(mode="json") for r in latest.reanchor_inputs
                ],
                reanchor_resolutions=[
                    r.model_dump(mode="json") for r in latest.reanchor_resolutions
                ],
                reanchor_inputs_initialized_at=(
                    datetime.now(UTC) if latest.reanchor_inputs else None
                ),
                targets=latest.targets.model_dump(mode="json"),
                revision=latest.draft_revision,
                checked_layer_ids=list(latest.checked_layer_ids),
                round_input_resolutions=[
                    r.model_dump(mode="json") for r in latest.round_input_resolutions
                ],
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
        *,
        before_operation: Callable[[Connection], None] | None = None,
        exclusive_project: bool = False,
        after_submit: Callable[[Connection, Submission], None] | None = None,
    ) -> Draft | Submission:
        """Run ``operation`` on the draft at the expected revision, exactly once.

        Writers of one draft are serialised by a transaction-scoped advisory
        lock. A retried mutation ID with the same payload replays the stored
        response; with another payload it is a conflict.

        Every committed command is logged in ``edit_events`` in the same
        transaction (D6), with the user and session of the running request
        (none outside a request). A replay logs nothing.

        ``exclusive_project`` takes the project lock exclusively from the
        first acquisition on (a submit that creates work, V8);
        ``after_submit`` runs in the transaction once a submission is stored
        and its round and assignment are advanced, before the receipt.
        """
        key_string = _key_str(key)
        request_hash = canonical_hash(envelope.model_dump())
        with self.db.transaction() as conn:
            self._before_workspace_locks(conn, key, exclusive=exclusive_project)
            # Shared across independent drafts, exclusive against structural
            # changes/imports. Always acquire before the per-draft lock. With
            # ``exclusive_project`` an exclusive lock: once held, this one
            # adds nothing.
            _lock_project(conn, key.project_key, exclusive=exclusive_project)
            project_id = self._require_project(conn, key.project_key)
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
            if before_operation is not None:
                before_operation(conn)
            self._before_new_mutation(conn, key)
            self._check_round_mutation(conn, key)
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
                self._store_draft(
                    conn,
                    project_id,
                    draft_row.id,
                    result,
                    envelope,
                    current_revision,
                    now,
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
                    # The version in force when this submit commits (G15).
                    guideline_version=current_guideline_version(conn, project_id),
                )
                response = _submission_payload(result)
            else:
                raise ValueError(f"Unsupported operation return type: {type(result)}")
            self._advance_round(conn, key, result)
            self._after_new_mutation(conn, key, result, now)
            if after_submit is not None and isinstance(result, Submission):
                # After the guideline stamp, the round and the assignment
                # status: the hook carries the submission as its round's
                # result (V8).
                after_submit(conn, result)
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

    def _store_draft(
        self,
        conn: Connection,
        project_id: int,
        draft_id: int,
        result: Draft,
        envelope: MutationEnvelope,
        current_revision: int,
        now: datetime,
    ) -> None:
        """Write ``result`` as the next revision of a draft and log the edit."""
        new_revision = current_revision + 1
        result.revision = new_revision
        conn.execute(
            update(DraftRow)
            .where(DraftRow.id == draft_id)
            .values(
                revision=new_revision,
                checked_layer_ids=list(result.checked_layer_ids),
                round_input_resolutions=[
                    r.model_dump(mode="json") for r in result.round_input_resolutions
                ],
                reanchor_inputs=[
                    r.model_dump(mode="json") for r in result.reanchor_inputs
                ],
                reanchor_resolutions=[
                    r.model_dump(mode="json") for r in result.reanchor_resolutions
                ],
                updated_at=now,
            )
        )
        conn.execute(
            delete(DraftAnnotationRow).where(DraftAnnotationRow.draft_id == draft_id)
        )
        conn.execute(
            delete(DraftEvidenceRow).where(DraftEvidenceRow.draft_id == draft_id)
        )
        conn.execute(
            delete(ReviewDecisionRow).where(ReviewDecisionRow.draft_id == draft_id)
        )
        self._insert_snapshots(conn, project_id, result.annotations, result.evidence)
        self._write_draft_content(
            conn, draft_id, result.annotations, result.evidence, result.decisions
        )
        self._log_edit(
            conn,
            project_id,
            draft_id,
            envelope,
            current_revision,
            DraftState.of(result),
            at=now,
        )

    def _rewrite_draft_in(
        self,
        conn: Connection,
        project_id: int,
        draft_key: str,
        operation: Callable[[Draft], Draft | None],
        command: Callable[[], dict[str, Any]],
        mutation_id: str,
    ) -> Draft | None:
        """Apply a server-side change to one stored draft as its next revision.

        For changes no client sent (moving a project to another ontology
        release, #81). The caller holds the project lock exclusively; this
        takes the draft lock. ``operation`` returns ``None`` to leave the draft
        unchanged; ``command``, called after it, gives the logged command. The
        change is logged in ``edit_events`` like any edit, so
        every revision stays reconstructable; a client still on the old
        revision gets a revision conflict and reloads.
        """
        key = _decode_key_str(draft_key)
        self._lock_draft(conn, key)
        row = self._draft_row(conn, project_id, draft_key)
        if row is None:
            return None
        draft = self._open_draft(conn, key, None)
        result = operation(draft)
        if result is None:
            return None
        revision = int(row.revision)
        envelope = MutationEnvelope(
            mutation_id=mutation_id, expected_revision=revision, payload=command()
        )
        self._store_draft(
            conn, project_id, row.id, result, envelope, revision, datetime.now(UTC)
        )
        return result

    def superseded_pins(self, project_key: str) -> dict[str, set[str]]:
        """Ontology id -> the digests its pin pointed to before (#81)."""
        with self.db.transaction() as conn:
            rows = conn.execute(
                select(
                    ProjectOntologyRow.ontology_id,
                    ProjectOntologyRow.superseded_sha256,
                )
                .join(ProjectRow, ProjectRow.id == ProjectOntologyRow.project_id)
                .where(ProjectRow.project_key == project_key)
            ).all()
        return {row.ontology_id: set(row.superseded_sha256 or []) for row in rows}

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
                ProjectRow.project_key == key.project_key,
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
            self._require_project(conn, key.project_key)
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
            self._require_project(conn, key.project_key)
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
        project_key: str,
        document_id: str,
        annotator_id: str,
        mode: str,
    ) -> Literal["not_started", "in_progress", "completed"]:
        """Progress of one annotator in one mode on one document."""
        return self._document_statuses(
            project_key, annotator_id, mode, document_id
        ).get(document_id, "not_started")

    def get_document_statuses(
        self, project_key: str, annotator_id: str, mode: str
    ) -> dict[str, Literal["not_started", "in_progress", "completed"]]:
        """Progress facts for one project's annotator/mode; absent means not started.

        Read all workspace facts in a bounded number of statements. Immutable
        submissions still resolve by complete origin and revision, never clocks.
        """
        return self._document_statuses(project_key, annotator_id, mode)

    def _document_statuses(
        self,
        project_key: str,
        annotator_id: str,
        mode: str,
        document_id: str | None = None,
    ) -> dict[str, Literal["not_started", "in_progress", "completed"]]:
        profile = self.get_task_profile(project_key)
        with self.db.transaction() as conn:
            project_id = self._require_project(conn, project_key)
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
                    live_submission(),
                )
                .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
            )
            if document_id is not None:
                drafts = drafts.where(DraftRow.document_id == document_id)
                submissions = submissions.where(
                    SubmissionRow.document_id == document_id
                )
            gone = discarded_draft_keys(
                conn, project_id, annotator_id=annotator_id, mode=mode
            )
            draft_rows = [
                row for row in conn.execute(drafts) if row.draft_key not in gone
            ]
            submission_rows = conn.execute(submissions).all()
            from ontotator.storage.tables import AssignmentRow
            from ontotator.storage.workflow_tables import WorkRoundRow

            active_keys = {
                row.document_id: WorkspaceKey.model_validate(row.workspace_key)
                for row in conn.execute(
                    select(WorkRoundRow.document_id, WorkRoundRow.workspace_key)
                    .join(
                        AssignmentRow,
                        AssignmentRow.active_round_id == WorkRoundRow.round_id,
                    )
                    .where(
                        WorkRoundRow.project_id == project_id,
                        WorkRoundRow.annotator_id == annotator_id,
                        WorkRoundRow.mode == mode,
                        AssignmentRow.revoked_at.is_(None),
                    )
                )
            }

        rows_by_key = {row.draft_key: row for row in draft_rows}
        keys: dict[str, WorkspaceKey] = {}
        for row in draft_rows:
            key = _decode_key_str(row.draft_key)
            keys[_key_str(key)] = key
        submissions_by_key: dict[str, list[Submission]] = {}
        for stored in submission_rows:
            submission = Submission.model_validate(stored.payload)
            submissions_by_key.setdefault(stored.local_key, []).append(submission)
            origin = submission.origin_key
            key = (
                origin
                if origin.project_key == project_key
                else _local_import_key(origin, project_key, profile)
            )
            keys.setdefault(_key_str(key), key)

        keys = {
            identity: key
            for identity, key in keys.items()
            if key.document_id not in active_keys
            or identity in _workspace_aliases(active_keys[key.document_id])
        }
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

    def review_input_document_ids(self, project_key: str) -> set[str]:
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
                    .where(ProjectRow.project_key == project_key)
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
                    # Discarded by a mode change (#109): not this chain's.
                    live_submission(),
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
            project_id = self._project_id(conn, key.project_key)
            if project_id is None:
                return []
            return self._submissions_for_workspace(conn, project_id, key)

    def get_submissions_for_document(
        self, project_key: str, document_id: str
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
                        ProjectRow.project_key == project_key,
                        SubmissionRow.document_id == document_id,
                        live_submission(),
                    )
                    .order_by(SubmissionRow.created_at, SubmissionRow.submission_id)
                )
                .scalars()
                .all()
            )
        return [Submission.model_validate(p) for p in stored]

    def get_submission(
        self, submission_id: str, project_key: str | None = None
    ) -> Submission | None:
        """A submission by ID, within a project when ``project_key`` is given."""
        statement = select(SubmissionRow.payload).where(
            SubmissionRow.submission_id == submission_id
        )
        if project_key is not None:
            statement = statement.join(
                ProjectRow, ProjectRow.id == SubmissionRow.project_id
            ).where(ProjectRow.project_key == project_key)
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
            project_id = self._require_project(conn, event.workspace_key.project_key)
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
        self, event_id: str, project_key: str | None = None
    ) -> SearchEventRecord | None:
        """The event with this ID; within a project when ``project_key`` is given.

        Without a project, an ID stored in several projects must have the same
        content everywhere; otherwise the lookup is ambiguous.
        """
        statement = select(SearchEventRow.payload).where(
            SearchEventRow.event_id == event_id
        )
        with self.db.transaction() as conn:
            if project_key is not None:
                project_id = self._project_id(conn, project_key)
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
                project_id = self._project_id(conn, workspace_key.project_key)
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
            project_id = self._project_id(conn, key.project_key)
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
        self, project_key: str, *, include_captured_conditions: bool = True
    ) -> ValidatedPackage:
        """Everything of a project as an in-memory package.

        All reads share one snapshot, so a draft edit committing meanwhile
        cannot leave an annotation without the evidence version it references.
        """
        with self.db.snapshot() as conn:
            project = conn.execute(
                select(ProjectRow.id, ProjectRow.manifest).where(
                    ProjectRow.project_key == project_key
                )
            ).one_or_none()
            if project is None:
                raise InvalidPackage(f"Package '{project_key}' not found")
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
            stored_files = self.get_embedded_files(project_key)
            from ontotator.storage.workflow_tables import (
                RoundSubmissionBindingRow,
                WorkRoundRow,
            )

            workflow_history = dict(manifest.workflow_history or {})
            for rid in conn.execute(
                select(WorkRoundRow.round_id).where(
                    WorkRoundRow.project_id == project_id
                )
            ).scalars():
                # The archived format predates the read-only facts; leave them
                # out so older readers (extra="forbid") still accept it.
                workflow_history[rid] = archive_round(
                    self.get_work_round(project_key, rid).model_dump(
                        mode="json", exclude=set(WorkRoundView.NOT_ARCHIVED)
                    ),
                    self.get_round_input_inventory(project_key, rid),
                    list(
                        conn.execute(
                            select(RoundSubmissionBindingRow.submission_id).where(
                                RoundSubmissionBindingRow.project_id == project_id,
                                RoundSubmissionBindingRow.round_id == rid,
                            )
                        ).scalars()
                    ),
                )
            proposal_annotation_refs = [
                tuple(row)
                for row in conn.execute(
                    select(
                        ProposalAnnotationRow.annotation_id,
                        ProposalAnnotationRow.version,
                    ).where(ProposalAnnotationRow.project_id == project_id)
                )
            ]
            proposal_evidence_refs = [
                tuple(row)
                for row in conn.execute(
                    select(
                        ProposalEvidenceRow.evidence_id, ProposalEvidenceRow.version
                    ).where(ProposalEvidenceRow.project_id == project_id)
                )
            ]
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
        for submission in submissions.values():
            for snap in submission.snapshots:
                annotations[(snap.annotation.annotation_id, snap.version)] = snap
                for ev in snap.evidence:
                    evidence[(ev.mention.evidence_id, ev.version)] = ev
        for archived in workflow_history.values():
            for item in archived["inputs"]:
                for snapshot_field in ("source_snapshot", "target_snapshot"):
                    if item[snapshot_field] is not None:
                        snap = decode_snapshot(item[snapshot_field])
                        annotations[(snap.annotation.annotation_id, snap.version)] = (
                            snap
                        )
                        for ev in snap.evidence:
                            evidence[(ev.mention.evidence_id, ev.version)] = ev
        if submissions or workflow_history:
            manifest = manifest.model_copy(
                update={
                    "format_version": "ontotator-work-package/v3",
                    "workflow_history": workflow_history,
                    "proposal_annotation_refs": proposal_annotation_refs,
                    "proposal_evidence_refs": proposal_evidence_refs,
                }
            )
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
