CREATE TABLE workspace_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO workspace_metadata (key, value) VALUES ('format_version', 'ontocurator-workspace/v4');

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version, applied_at) VALUES (4, CURRENT_TIMESTAMP);

CREATE TABLE packages (
    package_id TEXT PRIMARY KEY,
    manifest_hash TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE package_task_profiles (
    package_id TEXT PRIMARY KEY REFERENCES packages(package_id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL
);

CREATE TABLE documents (
    document_id TEXT NOT NULL,
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    language TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    PRIMARY KEY (document_id, package_id)
);

CREATE TABLE evidence_snapshots (
    evidence_id TEXT NOT NULL,
    version TEXT NOT NULL,
    document_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (evidence_id, version)
);

CREATE TABLE package_evidence (
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (package_id, evidence_id, version)
);

CREATE TABLE annotation_snapshots (
    annotation_id TEXT NOT NULL,
    version TEXT NOT NULL,
    document_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (annotation_id, version)
);

CREATE TABLE package_annotations (
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    annotation_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (package_id, annotation_id, version)
);

CREATE TABLE workspaces (
    workspace_key TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    annotator_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    target_set_id TEXT NOT NULL,
    targets_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    checked_layer_ids_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);

CREATE TABLE workspace_annotations (
    workspace_key TEXT NOT NULL REFERENCES workspaces(workspace_key) ON DELETE CASCADE,
    annotation_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (workspace_key, annotation_id, version)
);

CREATE TABLE workspace_evidence (
    workspace_key TEXT NOT NULL REFERENCES workspaces(workspace_key) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY (workspace_key, evidence_id, version)
);

CREATE TABLE workspace_decisions (
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

CREATE TABLE submissions (
    submission_id TEXT PRIMARY KEY,
    origin_key TEXT NOT NULL,
    targets_json TEXT NOT NULL,
    draft_revision INTEGER NOT NULL,
    checked_layer_ids_json TEXT NOT NULL DEFAULT '[]',
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE imported_submission_bindings (
    local_package_id TEXT NOT NULL,
    submission_id TEXT NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
    local_key TEXT NOT NULL,
    PRIMARY KEY (local_package_id, submission_id)
);

CREATE TABLE search_events (
    event_id TEXT PRIMARY KEY,
    workspace_key TEXT NOT NULL,
    annotation_id TEXT NOT NULL,
    layer_id TEXT,
    ontology_sha256 TEXT,
    payload_json TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE package_search_events (
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES search_events(event_id) ON DELETE CASCADE,
    local_key TEXT NOT NULL,
    PRIMARY KEY (package_id, event_id)
);

CREATE TABLE mutation_receipts (
    workspace_key TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_key, mutation_id)
);

CREATE TABLE package_ontology_resources (
    package_id TEXT NOT NULL REFERENCES packages(package_id) ON DELETE CASCADE,
    resource_path TEXT NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (package_id, resource_path)
);
