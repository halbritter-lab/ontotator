"""Typed table mappings of the server schema (T2 P2).

The repository runs Core statements against these mapped classes on a
``Connection``. It never loads ORM objects, so snapshot and submission
payloads stay plain JSON (JSONB). A project replaces the work package of the
desktop editor; ``WorkspaceKey.project_key`` carries ``projects.project_key``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    MetaData,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "ontotator"
OWNER_ROLE = "ontotator_owner"
APP_ROLE = "ontotator_app"

# The application role may only read and insert these (T2 D6).
APPEND_ONLY_TABLES = (
    "final_selection_events",
    "export_selection_snapshots",
    "annotation_snapshots",
    "evidence_snapshots",
    "submissions",
    "audit_events",
    "edit_events",
    "proposal_sets",
    "translation_reviews",
    "problem_reports",
    "task_holds",
    "problem_report_events",
    "work_rounds",
    "round_workspace_bindings",
    "round_submission_bindings",
    "round_inputs",
    "workflow_command_receipts",
    "review_obligation_resolutions",
    "translation_acceptances",
    "discarded_variants",
    "text_change_resolutions",
    "draft_snapshots",
    "guideline_versions",
    "guideline_withdrawals",
)

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)
    type_annotation_map: ClassVar[dict[Any, Any]] = {
        str: Text(),
        dict[str, Any]: JSONB(),
        list[Any]: JSONB(),
        datetime: DateTime(timezone=True),
    }


class ProjectRow(Base):
    """A project; until T2d it is created from an in-memory seed package."""

    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(
            "annotations_per_text BETWEEN 1 AND 5", name="annotations_per_text"
        ),
        CheckConstraint(
            "import_plan IN ('nothing', 'review_and_annotate_translations')",
            name="import_plan",
        ),
        CheckConstraint(
            "tool_proposal_mode IN ('proposals', 'scratch')", name="tool_proposal_mode"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_key: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    description: Mapped[str | None]
    manifest: Mapped[dict[str, Any]]
    manifest_sha256: Mapped[str]
    task_profile: Mapped[dict[str, Any]]
    task_profile_sha256: Mapped[str]
    languages: Mapped[list[Any]] = mapped_column(server_default=text("'[]'::jsonb"))
    allow_spanless_findings: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true")
    )
    require_spanless_note: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true")
    )
    require_chosen_axes: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    creation_defaults: Mapped[dict[str, Any]] = mapped_column(
        server_default=text("'{}'::jsonb")
    )
    annotation_policy_revision: Mapped[int] = mapped_column(
        BigInteger, server_default=text("1")
    )
    adjudicator_not_annotator: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    contiguous_mentions_only: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    hidden_axis_values: Mapped[dict[str, Any]] = mapped_column(
        server_default=text("'{}'::jsonb")
    )
    annotate_accepted_translations_only: Mapped[bool] = mapped_column(
        Boolean, server_default=text("true")
    )
    annotations_per_text: Mapped[int] = mapped_column(server_default=text("1"))
    import_plan: Mapped[str] = mapped_column(
        server_default=text("'review_and_annotate_translations'")
    )
    tool_proposal_mode: Mapped[str] = mapped_column(server_default=text("'proposals'"))
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # A private practice project of one person (issue 266, migration 0028):
    # never listed, counted or exported with real projects.
    practice: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class StoredFileRow(Base):
    """A file of the content-addressed store on the data volume (D3)."""

    __tablename__ = "stored_files"

    sha256: Mapped[str] = mapped_column(primary_key=True)
    size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProjectResourceRow(Base):
    """An embedded ontology or captured search resource of a project."""

    __tablename__ = "project_resources"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    resource_path: Mapped[str] = mapped_column(primary_key=True)
    sha256: Mapped[str] = mapped_column(ForeignKey(StoredFileRow.sha256))


class ProjectSearchConditionsRow(Base):
    """The immutable search conditions captured at first use or imported."""

    __tablename__ = "project_search_conditions"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    conditions: Mapped[list[Any]]


class DocumentRow(Base):
    """A canonical text; ``position`` is its place in the project's order."""

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint("version >= 1", name="version"),
        CheckConstraint(
            "origin IN ('native', 'machine_translation', 'human_translation', 'correction')",
            name="origin",
        ),
        CheckConstraint(
            "translation_status IN ('translated', 'automatic_check_failed', 'ready_for_review', 'reviewed', 'accepted')",
            name="translation_status",
        ),
        CheckConstraint(
            "origin NOT IN ('machine_translation', 'human_translation') OR translation_status IS NOT NULL",
            name="translation_status_required",
        ),
        ForeignKeyConstraint(
            ["project_id", "derived_from"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
        ),
        UniqueConstraint(
            "project_id",
            "external_id",
            "language",
            "version",
            name="uq_documents_variant",
        ),
        Index("ix_documents_project_id_case_id", "project_id", "case_id"),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    document_id: Mapped[str] = mapped_column(primary_key=True)
    position: Mapped[int | None]
    language: Mapped[str]
    text: Mapped[str]
    text_sha256: Mapped[str]
    source_text_sha256: Mapped[str | None]
    case_id: Mapped[str]
    external_id: Mapped[str]
    version: Mapped[int] = mapped_column(server_default=sql_text("1"))
    origin: Mapped[str] = mapped_column(server_default=sql_text("'native'"))
    derived_from: Mapped[str | None]
    translation: Mapped[dict[str, Any] | None]
    translation_status: Mapped[str | None]
    status_reason: Mapped[str | None]


class AnnotationSnapshotRow(Base):
    """An immutable, content-addressed annotation snapshot (append-only)."""

    __tablename__ = "annotation_snapshots"
    # Identity lookups across projects (import verification).
    __table_args__ = (
        Index(
            "ix_annotation_snapshots_annotation_id_version", "annotation_id", "version"
        ),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    annotation_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class EvidenceSnapshotRow(Base):
    """An immutable, content-addressed evidence snapshot (append-only)."""

    __tablename__ = "evidence_snapshots"
    # Identity lookups across projects (import verification).
    __table_args__ = (
        Index("ix_evidence_snapshots_evidence_id_version", "evidence_id", "version"),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    evidence_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProposalAnnotationRow(Base):
    """An annotation the project offers as input (imported proposals).

    ``proposal_set_id`` names the imported T1 set it came with (NULL for seed
    packages); ``notes`` are the set's provenance notes (T2d).
    """

    __tablename__ = "proposal_annotations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "annotation_id", "version"],
            [
                f"{SCHEMA}.annotation_snapshots.project_id",
                f"{SCHEMA}.annotation_snapshots.annotation_id",
                f"{SCHEMA}.annotation_snapshots.version",
            ],
        ),
        Index(
            "ix_proposal_annotations_project_id_proposal_set_id",
            "project_id",
            "proposal_set_id",
        ),
    )

    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    annotation_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)
    proposal_set_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.proposal_sets.id")
    )
    notes: Mapped[list[Any]] = mapped_column(server_default=text("'[]'::jsonb"))


class ProposalEvidenceRow(Base):
    """Evidence that belongs to the project's proposals."""

    __tablename__ = "proposal_evidence"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "evidence_id", "version"],
            [
                f"{SCHEMA}.evidence_snapshots.project_id",
                f"{SCHEMA}.evidence_snapshots.evidence_id",
                f"{SCHEMA}.evidence_snapshots.version",
            ],
        ),
    )

    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    evidence_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class DraftRow(Base):
    """The mutable, revisioned working state of one workspace key."""

    __tablename__ = "drafts"
    __table_args__ = (
        UniqueConstraint("project_id", "draft_key"),
        Index(
            "ix_drafts_project_annotator_document",
            "project_id",
            "annotator_id",
            "document_id",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    draft_key: Mapped[str]
    document_id: Mapped[str]
    annotator_id: Mapped[str]
    mode: Mapped[str]
    scope_id: Mapped[str]
    target_set_id: Mapped[str]
    targets: Mapped[dict[str, Any]]
    revision: Mapped[int] = mapped_column(server_default=text("0"))
    spanless_policy_version: Mapped[int | None] = mapped_column(
        server_default=text("1")
    )
    checked_layer_ids: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )
    reanchor_inputs: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )
    reanchor_resolutions: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )
    round_input_resolutions: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )
    reanchor_inputs_initialized_at: Mapped[datetime | None]
    updated_at: Mapped[datetime]


class DraftAnnotationRow(Base):
    __tablename__ = "draft_annotations"

    draft_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(DraftRow.id, ondelete="CASCADE"), primary_key=True
    )
    annotation_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class DraftEvidenceRow(Base):
    __tablename__ = "draft_evidence"

    draft_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(DraftRow.id, ondelete="CASCADE"), primary_key=True
    )
    evidence_id: Mapped[str] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(primary_key=True)


class ReviewDecisionRow(Base):
    """A review decision of a draft, kept in the order it was made."""

    __tablename__ = "review_decisions"

    draft_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(DraftRow.id, ondelete="CASCADE"), primary_key=True
    )
    decision_id: Mapped[str] = mapped_column(primary_key=True)
    position: Mapped[int]
    target_id: Mapped[str]
    target_version: Mapped[str]
    outcome: Mapped[str]
    replacement_id: Mapped[str | None]
    replacement_version: Mapped[str | None]
    note: Mapped[str | None]
    reviewer_id: Mapped[str]
    payload: Mapped[dict[str, Any]]


class SubmissionRow(Base):
    """An immutable submission (append-only).

    ``local_key`` is the workspace key the submission belongs to in this
    project. For an imported submission it differs from ``origin_key``.
    """

    __tablename__ = "submissions"
    __table_args__ = (
        Index("ix_submissions_project_local_key", "project_id", "local_key"),
        Index("ix_submissions_project_document", "project_id", "document_id"),
        ForeignKeyConstraint(
            ["project_id", "guideline_version"],
            [
                f"{SCHEMA}.guideline_versions.project_id",
                f"{SCHEMA}.guideline_versions.version",
            ],
        ),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    submission_id: Mapped[str] = mapped_column(primary_key=True)
    local_key: Mapped[str]
    origin_key: Mapped[str]
    document_id: Mapped[str]
    annotator_id: Mapped[str]
    mode: Mapped[str]
    draft_revision: Mapped[int]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[str]
    recorded_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # The edit event of the submit command (T2c); NULL for imported submissions.
    last_edit_event_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.edit_events.id")
    )
    # The guideline version in force at submit; NULL when none was (G19).
    guideline_version: Mapped[int | None] = mapped_column(Integer)


class SearchEventRow(Base):
    """Provenance of a term search or tree walk.

    ``seq`` keeps the order events were written in. ``imported`` marks events
    that came with a seed package (they take part in its re-import check).
    """

    __tablename__ = "search_events"
    __table_args__ = (
        Index("ix_search_events_project_local_key", "project_id", "local_key"),
        Index("ix_search_events_project_workspace_key", "project_id", "workspace_key"),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))
    workspace_key: Mapped[str]
    local_key: Mapped[str]
    imported: Mapped[bool] = mapped_column(server_default=text("false"))
    annotation_id: Mapped[str]
    layer_id: Mapped[str | None]
    ontology_sha256: Mapped[str | None]
    payload: Mapped[dict[str, Any]]
    timestamp: Mapped[str]


class MutationReceiptRow(Base):
    """The stored response of a committed write, replayed on a retry."""

    __tablename__ = "mutation_receipts"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    workspace_key: Mapped[str] = mapped_column(primary_key=True)
    mutation_id: Mapped[str] = mapped_column(primary_key=True)
    request_hash: Mapped[str]
    response: Mapped[dict[str, Any]]
    created_at: Mapped[datetime]


# --- Identity (T2b, migration 0002) -------------------------------------


class UserRow(Base):
    """An account; ``pseudonym`` (``ann-0001``, ...) is the same in every project."""

    __tablename__ = "users"
    qualification: Mapped[str | None]

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    username: Mapped[str] = mapped_column(unique=True)
    display_name: Mapped[str]
    email: Mapped[str | None]
    pseudonym: Mapped[str] = mapped_column(unique=True)
    orcid: Mapped[str | None]
    orcid_consent: Mapped[bool] = mapped_column(server_default=text("false"))
    is_system_admin: Mapped[bool] = mapped_column(server_default=text("false"))
    active: Mapped[bool] = mapped_column(server_default=text("true"))
    credential_generation: Mapped[int] = mapped_column(server_default=text("1"))
    # Set once by the erasure (GDPR Art. 17); the account is then closed for good.
    anonymised_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class PasswordCredentialRow(Base):
    """The Argon2id hash of a user's password."""

    __tablename__ = "password_credentials"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(UserRow.id), primary_key=True
    )
    password_hash: Mapped[str]
    changed_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SessionRow(Base):
    """A server-side login session; only the token's SHA-256 is stored."""

    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_id_revoked_at", "user_id", "revoked_at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    token_sha256: Mapped[str] = mapped_column(unique=True)
    csrf_token: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    revoked_reason: Mapped[str | None]
    client_ip: Mapped[str | None]
    user_agent: Mapped[str | None]


class OneTimeCodeRow(Base):
    """A single-use setup or reset code; only its SHA-256 is stored."""

    __tablename__ = "one_time_codes"
    __table_args__ = (CheckConstraint("purpose IN ('setup', 'reset')", name="purpose"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    purpose: Mapped[str]
    code_sha256: Mapped[str] = mapped_column(unique=True)
    issued_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    credential_generation: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]


class LoginAttemptRow(Base):
    """One login attempt, for throttling per account and per client address."""

    __tablename__ = "login_attempts"
    __table_args__ = (
        Index("ix_login_attempts_username_at", "username", "at"),
        Index("ix_login_attempts_client_ip_at", "client_ip", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    username: Mapped[str]
    client_ip: Mapped[str]
    succeeded: Mapped[bool]
    # Refused because of a lock: recorded, but not counted towards one.
    throttled: Mapped[bool] = mapped_column(server_default=text("false"))
    at: Mapped[datetime]


class AuditEventRow(Base):
    """An administrative or security event (append-only)."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_project_id_at", "project_id", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    at: Mapped[datetime] = mapped_column(server_default=func.now())
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(UserRow.id)
    )
    actor_label: Mapped[str]
    action: Mapped[str]
    target_type: Mapped[str]
    target_id: Mapped[str]
    # The account behind a ``user`` target, so its history survives a rename.
    target_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(UserRow.id), index=True
    )
    project_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id)
    )
    details: Mapped[dict[str, Any]] = mapped_column(server_default=text("'{}'::jsonb"))


class UserPreferencesRow(Base):
    """The editor preferences of one user."""

    __tablename__ = "user_preferences"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(UserRow.id), primary_key=True
    )
    preferences: Mapped[dict[str, Any]]


class InstanceStateRow(Base):
    """Instance-wide state, one JSON value per key."""

    __tablename__ = "instance_state"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


# --- Projects and the edit log (T2c, migration 0003) --------------------


class ProjectMembershipRow(Base):
    """One role of a user in a project; roles combine freely (E9)."""

    __tablename__ = "project_memberships"
    __table_args__ = (
        CheckConstraint("role IN ('lead', 'annotator', 'adjudicator')", name="role"),
        Index("ix_project_memberships_user_id", "user_id"),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(UserRow.id), primary_key=True
    )
    role: Mapped[str] = mapped_column(primary_key=True)
    added_at: Mapped[datetime] = mapped_column(server_default=func.now())
    added_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))


class EditEventRow(Base):
    """One committed editing command (append-only, T2 D6).

    ``state`` is the complete draft content after the command, as sorted
    snapshot identities, so any revision is a lookup, not a replay.
    """

    __tablename__ = "edit_events"
    __table_args__ = (
        CheckConstraint("kind IN ('edit', 'submit')", name="kind"),
        Index("ix_edit_events_project_id_draft_id_id", "project_id", "draft_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    # No foreign key since 0020: edit events outlive purged drafts.
    draft_id: Mapped[int] = mapped_column(BigInteger)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    session_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(SessionRow.id)
    )
    at: Mapped[datetime] = mapped_column(server_default=func.now())
    mutation_id: Mapped[str]
    kind: Mapped[str]
    command: Mapped[dict[str, Any]]
    revision_before: Mapped[int]
    revision_after: Mapped[int]
    state: Mapped[dict[str, Any]]
    submission_id: Mapped[str | None]


# --- Ontologies and jobs (T2d, migration 0004) ----------------------------


class OntologyFileRow(Base):
    """An uploaded ontology or translation file; the bytes are in the blob store."""

    __tablename__ = "ontology_files"
    __table_args__ = (
        CheckConstraint("kind IN ('ontology', 'translation')", name="kind"),
        Index("ix_ontology_files_prefix_kind", "prefix", "kind"),
    )

    sha256: Mapped[str] = mapped_column(
        ForeignKey(StoredFileRow.sha256), primary_key=True
    )
    kind: Mapped[str]
    # The lower-case dominant prefix, e.g. ``hp``.
    prefix: Mapped[str]
    release: Mapped[str | None]
    filename: Mapped[str]
    language: Mapped[str | None]
    uploaded_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    uploaded_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ProjectOntologyRow(Base):
    """A project's pin of one profile ontology to an uploaded file (P7)."""

    __tablename__ = "project_ontologies"
    __table_args__ = (
        CheckConstraint(
            "t1_profile IN ('generic', 'hpo-phenotype')", name="t1_profile"
        ),
    )

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    ontology_id: Mapped[str] = mapped_column(primary_key=True)
    sha256: Mapped[str] = mapped_column(ForeignKey(OntologyFileRow.sha256))
    allowed_roots: Mapped[list[Any]] = mapped_column(server_default=text("'[]'::jsonb"))
    t1_profile: Mapped[str] = mapped_column(server_default=text("'generic'"))
    # Digests this pin pointed to before, oldest first (0026, #81): work
    # submitted under them stays a valid review target.
    superseded_sha256: Mapped[list[Any]] = mapped_column(
        server_default=text("'[]'::jsonb")
    )


class JobRow(Base):
    """A long-running import or export, claimed by one worker (P6, index D-l)."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')", name="status"
        ),
        Index("ix_jobs_status_id", "status", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    kind: Mapped[str]
    status: Mapped[str]
    project_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id)
    )
    requested_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    requested_label: Mapped[str]
    payload: Mapped[dict[str, Any]]
    result: Mapped[dict[str, Any] | None]
    error: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    worker: Mapped[str | None]


class ProposalSetRow(Base):
    """An imported T1 annotation set, kept as delivered (append-only, T7 O1).

    One row per (bundle, set, document); a re-import of the same set is
    skipped. ``manifest_sha256`` is the hash of the bundle's ``manifest.json``
    bytes; a single ``.json`` unit has neither bundle id nor manifest hash.
    """

    __tablename__ = "proposal_sets"
    __table_args__ = (
        CheckConstraint("origin IN ('import', 'reanchor')", name="origin"),
        UniqueConstraint(
            "project_id",
            "bundle_id",
            "annotation_set_id",
            "document_id",
            name="uq_proposal_sets_identity",
            postgresql_nulls_not_distinct=True,
        ),
        ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    document_id: Mapped[str]
    bundle_id: Mapped[str | None]
    manifest_sha256: Mapped[str | None]
    annotation_set_id: Mapped[str]
    set_kind: Mapped[str]
    actors: Mapped[list[Any]]
    payload: Mapped[dict[str, Any]]
    source_sha256: Mapped[str | None] = mapped_column(ForeignKey(StoredFileRow.sha256))
    origin: Mapped[str] = mapped_column(server_default=text("'import'"))
    pending_items: Mapped[list[Any]] = mapped_column(server_default=text("'[]'::jsonb"))
    imported_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    imported_at: Mapped[datetime] = mapped_column(server_default=func.now())
    job_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(JobRow.id))


# --- Administration (T3a, migration 0005) -------------------------------


class UserLanguageRow(Base):
    """A user's supported language codes."""

    __tablename__ = "user_languages"
    __table_args__ = (CheckConstraint("language ~ '^[a-z]{2,3}$'", name="language"),)

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(UserRow.id, ondelete="CASCADE"), primary_key=True
    )
    language: Mapped[str] = mapped_column(primary_key=True)


class AssignmentRow(Base):
    """A task for one user and document; revocation preserves earlier assignments."""

    __tablename__ = "assignments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
        ),
        CheckConstraint(
            "task IN ('annotate', 'review', 'translation_review')", name="task"
        ),
        CheckConstraint(
            "status IN ('open', 'in_progress', 'submitted', 'reopened')", name="status"
        ),
        CheckConstraint(
            "(task = 'annotate' AND annotation_mode IS NOT NULL"
            " AND annotation_mode IN ('proposals', 'scratch'))"
            " OR (task <> 'annotate' AND annotation_mode IS NULL)",
            name="annotation_mode",
        ),
        Index(
            "uq_assignments_active",
            "project_id",
            "document_id",
            "user_id",
            "task",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index("ix_assignments_project_id_user_id", "project_id", "user_id"),
        Index("ix_assignments_project_id_document_id", "project_id", "document_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    document_id: Mapped[str]
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    task: Mapped[str]
    status: Mapped[str] = mapped_column(server_default=text("'open'"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
    revoked_at: Mapped[datetime | None]
    revoked_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    last_submission_id: Mapped[str | None]
    held: Mapped[bool] = mapped_column(server_default=text("false"))
    hold_reason: Mapped[str | None]
    active_round_id: Mapped[str | None]
    workflow_revision: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    # FD1: the lead's own translation review of a rejected or queried version.
    lead_correction: Mapped[bool] = mapped_column(server_default=text("false"))
    annotation_mode: Mapped[str | None]


class TranslationReviewRow(Base):
    """Immutable submitted translation review and its reviewer snapshot."""

    __tablename__ = "translation_reviews"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "document_id"],
            [f"{SCHEMA}.documents.project_id", f"{SCHEMA}.documents.document_id"],
        ),
        CheckConstraint(
            "decision IN ('accepted_unchanged', 'accepted_corrected', 'query', 'rejected')",
            name="decision",
        ),
        Index(
            "ix_translation_reviews_project_id_document_id_id",
            "project_id",
            "document_id",
            "id",
        ),
        ForeignKeyConstraint(
            ["project_id", "guideline_version"],
            [
                f"{SCHEMA}.guideline_versions.project_id",
                f"{SCHEMA}.guideline_versions.version",
            ],
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    document_id: Mapped[str]
    assignment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(AssignmentRow.id))
    reviewer_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    reviewer_pseudonym: Mapped[str]
    reviewer_qualification: Mapped[str]
    reviewer_languages: Mapped[list[Any]]
    decision: Mapped[str]
    clinical_change: Mapped[bool]
    categories: Mapped[list[Any]] = mapped_column(server_default=text("'[]'::jsonb"))
    rationale: Mapped[str | None]
    machine_text_sha256: Mapped[str]
    proposed_text: Mapped[str]
    proposed_text_sha256: Mapped[str]
    status_before: Mapped[str]
    status_after: Mapped[str]
    created_variant_id: Mapped[str | None]
    review_policy: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # The guideline version in force at submit; NULL when none was (G19).
    guideline_version: Mapped[int | None] = mapped_column(Integer)


class TranslationReviewDraftRow(Base):
    """Mutable autosaved translation text/form, keyed by assignment."""

    __tablename__ = "translation_review_drafts"
    assignment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(AssignmentRow.id), primary_key=True
    )
    text: Mapped[str]
    form: Mapped[dict[str, Any]] = mapped_column(server_default=sql_text("'{}'::jsonb"))
    revision: Mapped[int] = mapped_column(server_default=sql_text("0"))
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))


class UploadRow(Base):
    """A staged document upload and its preview/commit jobs."""

    __tablename__ = "uploads"
    __table_args__ = (
        CheckConstraint("kind IN ('t1', 'text')", name="kind"),
        CheckConstraint(
            "status IN ('previewing', 'ready', 'invalid', 'committing', 'committed', 'failed', 'discarded')",
            name="status",
        ),
        Index("ix_uploads_project_id_created_at", "project_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ProjectRow.id))
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(UserRow.id))
    kind: Mapped[str]
    files: Mapped[list[Any]]
    language: Mapped[str | None]
    status: Mapped[str]
    preview: Mapped[dict[str, Any] | None]
    plan_sha256: Mapped[str | None]
    preview_job_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(JobRow.id)
    )
    commit_job_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(JobRow.id))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


# Register workflow mappings after the shared Base and historical tables exist.
# Register split final-result metadata with the shared schema.
from ontotator.storage import final_tables as _final_tables  # noqa: E402,F401
from ontotator.storage import guideline_tables as _guideline_tables  # noqa: E402,F401
from ontotator.storage import mode_change_tables as _mode_tables  # noqa: E402,F401
from ontotator.storage import overview_tables as _overview_tables  # noqa: E402,F401
from ontotator.storage import plan_tables as _plan_tables  # noqa: E402,F401
from ontotator.storage import workflow_tables as _workflow_tables  # noqa: E402, F401


class PracticeProjectRow(Base):
    """The owner of a practice project (issue 266, migration 0028).

    The application only inserts; ``delete_practice_project`` removes it with
    the project.
    """

    __tablename__ = "practice_projects"

    project_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(ProjectRow.id), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(UserRow.id), unique=True
    )
    # Whether the project has the consolidation task (owner consolidates).
    consolidation: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
