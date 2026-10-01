CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
    package_id TEXT PRIMARY KEY,
    manifest_hash TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT NOT NULL,
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    language TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    PRIMARY KEY (document_id, package_id)
);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
    evidence_id TEXT NOT NULL,
    version TEXT NOT NULL,
    document_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (evidence_id, version)
);

CREATE TABLE IF NOT EXISTS annotation_snapshots (
    annotation_id TEXT NOT NULL,
    version TEXT NOT NULL,
    document_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (annotation_id, version)
);

CREATE TABLE IF NOT EXISTS workspaces (
    workspace_key TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    annotator_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    target_set_id TEXT NOT NULL,
    targets_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    document_checked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_annotations (
    workspace_key TEXT NOT NULL REFERENCES workspaces(workspace_key) ON DELETE CASCADE,
    annotation_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (workspace_key, annotation_id, version)
);

CREATE TABLE IF NOT EXISTS workspace_evidence (
    workspace_key TEXT NOT NULL REFERENCES workspaces(workspace_key) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (workspace_key, evidence_id, version)
);

CREATE TABLE IF NOT EXISTS workspace_decisions (
    decision_id TEXT PRIMARY KEY,
    workspace_key TEXT NOT NULL REFERENCES workspaces(workspace_key) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    target_version TEXT NOT NULL,
    outcome TEXT NOT NULL,
    replacement_id TEXT,
    replacement_version TEXT,
    note TEXT,
    reviewer_id TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
    submission_id TEXT PRIMARY KEY,
    origin_key TEXT NOT NULL,
    targets_json TEXT NOT NULL,
    draft_revision INTEGER NOT NULL,
    document_checked INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imported_submission_bindings (
    local_package_id TEXT NOT NULL,
    submission_id TEXT NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
    local_key TEXT NOT NULL,
    PRIMARY KEY (local_package_id, submission_id)
);

CREATE TABLE IF NOT EXISTS search_events (
    event_id TEXT PRIMARY KEY,
    workspace_key TEXT NOT NULL,
    annotation_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mutation_receipts (
    workspace_key TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_key, mutation_id)
);
