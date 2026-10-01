# Local HPO Annotation Editor (`hpo-editor`)

A standalone, secure, offline web-based editor for annotating and reviewing Human Phenotype Ontology (HPO) terms on clinical text documents.

Designed specifically for clinical curation workflows, the editor supports:
- **Independent Annotation**: Clean-slate annotation without proposal bias or count leakage.
- **Origin-Neutral Review**: Identical treatment, actions, validation rules, and status transitions for human proposals and machine/tool predictions.
- **Strict Unicode Codepoint Precision**: Exact slice indexing supporting non-BMP characters (e.g. emoji 👶🏽), combining accents (e.g. café), and line breaks.
- **Lossless Work Package v1 Interchange**: Atomic, secure ZIP archive exchange format with RFC-8785 canonical JSON hashing.
- **Optimistic Concurrency & Idempotency**: Revision-protected SQLite mutations with transactional idempotency receipts.
- **Self-Contained Offline Bundling**: Pre-compiled React frontend embedded into the Python wheel package; runs without Node.js or Vite at runtime.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |       Web Browser (Same-Origin)       |
                      |   React 18 SPA (Embedded Static Web)  |
                      +-------------------+-------------------+
                                          | Loopback HTTP (127.0.0.1)
                                          | Bearer Token Authentication
                                          v
+-----------------------------------------------------------------------------------+
| FastAPI Backend Application (`hpo_editor`)                                        |
|                                                                                   |
|  +--------------------+  +----------------------+  +---------------------------+  |
|  |   API & Security   |  | Application Services |  | Pinned HPO Search Engine  |  |
|  | Loopback & Token   |  | Workspaces, Editing, |  | In-memory lexical & exact |  |
|  | Rebinding Guard    |  | Reviews, Submissions |  | Pinned hp.json index      |  |
|  +--------------------+  +----------------------+  +---------------------------+  |
|                                     |                                             |
|  +----------------------------------v------------------------------------------+  |
|  | SQLite Storage (`editor.db` via WAL & PRAGMA foreign_keys = ON)              |  |
|  | Schema migrations, revision conflict detection (409), idempotency receipts  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## Installation & Quick Start

### 1. Requirements
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or `pip`
- Pinned HPO ontology release file (`hp.json`)

### 2. Install Wheel
The editor is packaged as a standard Python wheel containing all static frontend assets. No Node.js runtime is required.

```bash
# Using uv tool install
uv tool install dist/hpo_editor-0.1.0-py3-none-any.whl

# Or in a virtual environment
pip install dist/hpo_editor-0.1.0-py3-none-any.whl
```

### 3. Launching the Editor
Start the local server with your workspace directory and ontology file:

```bash
hpo-editor serve --workspace ./workspace --ontology ./hp.json
```

The CLI will:
1. Initialize SQLite database at `./workspace/editor.db` with auto-migration.
2. Verify integrity and load `./hp.json`.
3. Generate a secure 32-byte cryptographic session token.
4. Bind to `127.0.0.1` on a free port (default 8000).
5. Automatically open the default browser to `http://127.0.0.1:8000/#token=<session_token>`.

### CLI Options

| Option | Flag | Default | Description |
|---|---|---|---|
| `--workspace` | `-w` | `./workspace` | Directory for SQLite database, uploaded packages, and exports |
| `--ontology` | `-o` | `./hp.json` | Path to pinned HPO JSON release file |
| `--port` | `-p` | `8000` | Port to bind (use `0` for random free port) |
| `--host` | | `127.0.0.1` | Loopback address (must be `127.0.0.1`, `localhost`, or `::1`) |
| `--no-browser` | | `false` | Do not automatically open default web browser |
| `--web-dir` | | `None` | Custom directory containing built web assets (defaults to embedded) |

---

## Security & Offline Guarantees

1. **Loopback-Only Binding**: Service rejects non-loopback addresses (`0.0.0.0`, external IPs) with exit code 1.
2. **DNS Rebinding Protection**: Host header validation rejects any request not directed at `127.0.0.1`, `localhost`, or `[::1]`.
3. **Session Authentication**: All API endpoints require `Authorization: Bearer <token>`, preventing unauthorized local processes from tampering with the workspace.
4. **Zero Runtime Network Calls**: Search operates entirely against the pinned local `hp.json`. No external dense models, cloud APIs, or telemetry are contacted.
5. **Streaming ZIP Guard**: Package import enforces 64 MB compressed limit, 256 MB uncompressed limit, path traversal sanitization, and atomic tempfile replacement.

---

## Persistence & Backup Procedures

### Workspace Layout
```
workspace/
├── editor.db           # SQLite database containing packages, drafts, and submissions
├── editor.db-wal       # SQLite write-ahead log (when active)
└── editor.db-shm       # SQLite shared-memory file (when active)
```

### Safe Backup Procedure
1. Stop the editor service (`Ctrl+C` in terminal).
2. Confirm no processes are accessing `editor.db`.
3. Copy `workspace/editor.db` (and any associated archive files) to your backup destination.
4. Alternatively, use SQLite's online backup API via command line:
   ```bash
   sqlite3 workspace/editor.db ".backup backup/editor_backup.db"
   ```

---

## Work Package Interchange (v1 Format)

Work packages are versioned ZIP archives (`hpo-editor-work-package/v1`) containing:
- `manifest.json`: Package ID, format version, ontology SHA-256, axes definition, file checksums.
- `documents.jsonl`: Document texts and metadata.
- `annotations.jsonl`: Immutable annotation snapshots with RFC-8785 canonical hashes.
- `evidence.jsonl`: Evidence mentions and segment offsets.
- `submissions.jsonl`: Completed submission records and reviewer decisions.
- `search_events.jsonl`: Audit log of search queries, ranking positions, and selections.

> [!NOTE]
> **Boundary with Benchmark Pipeline**: Work package v1 is an editor-internal, lossless interchange format preserving grouped mentions, stable IDs, and unknown context values. Canonical benchmark gold standard generation and multi-annotator reconciliation are separate pipeline steps.

---

## Mapping of Acceptance Criteria (Design Spec 1–12)

The implementation satisfies all 12 criteria specified in the design document:

| # | Acceptance Criterion | Verification Test Cases |
|---|---|---|
| 1 | Lossless Roundtrip of Packages | `test_packages.py::test_package_writer_and_reader_roundtrip`, `test_storage.py::test_import_package_idempotence_and_integrity`, `test_release.py::test_offline_end_to_end_lifecycle` |
| 2 | Origin-Neutral Review Decisions | `test_reviews.py::test_review_decisions_for_human_and_tool_proposals`, `test_reviews.py::test_review_decision_changed_requires_and_binds_replacement`, `frontend/tests/reviewActions.test.tsx`, `frontend/tests/e2e/release.spec.tsx` |
| 3 | Spanless Annotations with Stable IDs | `test_editing.py::test_attach_evidence_to_spanless_annotation_retains_id`, `test_domain.py::test_annotation_equality_and_hashing` |
| 4 | Discontinuous & Repeated Mentions | `test_packages.py::test_evidence_discontinuous_and_repeated_mentions`, `frontend/tests/offsets.test.ts`, `frontend/tests/spans.test.ts` |
| 5 | Copy-on-Write (COW) for Shared Evidence | `test_editing.py::test_modify_shared_evidence_triggers_cow_isolation` |
| 6 | Strict Unicode Codepoint Offsets | `frontend/tests/offsets.test.ts`, `frontend/tests/spans.test.ts`, `test_release.py::test_offline_end_to_end_lifecycle` |
| 7 | No Proposal Leakage in Independent Mode | `test_editing.py::test_independent_mode_workspace_isolation`, `test_api.py::test_document_metadata_listing_does_not_leak_proposals` |
| 8 | Null-Findings vs. Uncertain Distinction | `test_reviews.py::test_submission_zero_findings_vs_uncertain_distinct`, `frontend/tests/reviewActions.test.tsx` |
| 9 | Revision Conflict & Error Resilience | `test_storage.py::test_revision_conflict_detected`, `test_api.py::test_revision_conflict_409_and_domain_error_422`, `frontend/tests/autosave.test.ts` |
| 10 | Multi-Annotator Isolation | `test_storage.py::test_multiple_annotators_isolated`, `test_reviews.py::test_multiple_annotator_submissions_coexist` |
| 11 | Historical Submissions Re-import | `test_storage.py::test_reimport_historical_submissions_preserves_hashes_and_targets` |
| 12 | Autosave Queue & Retry Idempotency | `test_storage.py::test_mutation_idempotency_receipt`, `frontend/tests/autosave.test.ts` |

---

## Development & Build Pipeline

```bash
# Run backend tests
uv run pytest -v

# Run linting and type checks
uv run ruff check .
uv run mypy src

# Run frontend tests and type checks
cd frontend
npm run typecheck
npm run api:check
npm test
npm run test:e2e
npm run build
cd ..

# Build release bundle (Frontend -> Web Assets -> Wheel Packaging -> Verification)
uv run python scripts/build_release.py
```
