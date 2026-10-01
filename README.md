# Ontocurator (`ontocurator`)

A standalone, secure, offline web-based editor for annotating and reviewing biomedical ontology concepts (such as the Human Phenotype Ontology (HPO), MONDO Disease Ontology, Gene Ontology (GO), and arbitrary OBO Foundry ontologies) on clinical text documents.

Designed specifically for clinical curation workflows, Ontocurator supports:
- **Multi-Ontology Support**: Pinned OBO Graph JSON ontology loading (HPO, MONDO, GO, etc.) with deterministic numeric and CURIE search.
- **Configurable Context Axes Profiles**: Custom clinical or conceptual axes profiles (e.g. severity, confidence, assertion) configurable per package, with built-in profiles and CLI fallback. Empty axes profiles (`[]`) cleanly hide context axes.
- **100% Backward Compatibility**: Historical v1 packages and sqlite workspaces (`hpo-editor-work-package/v1`) preserve exact RFC-8785 hashes, historical annotation wire data, and receipt request hashes across imports, edits, and upgrades.
- **Independent Annotation**: Clean-slate annotation without proposal bias or count leakage.
- **Origin-Neutral Review**: Identical treatment, actions, validation rules, and status transitions for human proposals and machine/tool predictions.
- **Strict Unicode Codepoint Precision**: Exact slice indexing supporting non-BMP characters (e.g. emoji 👶🏽), combining accents (e.g. café), and line breaks.
- **Lossless Work Package Interchange**: Atomic, secure ZIP archive exchange format (`ontocurator-work-package/v1` and `hpo-editor-work-package/v1`) with RFC-8785 canonical JSON hashing.
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
| FastAPI Backend Application (`ontocurator`)                                       |
|                                                                                   |
|  +--------------------+  +----------------------+  +---------------------------+  |
|  |   API & Security   |  | Application Services |  | Ontology Search Engine    |  |
|  | Loopback & Token   |  | Workspaces, Editing, |  | In-memory lexical & exact |  |
|  | Rebinding Guard    |  | Reviews, Submissions |  | Variable-width CURIE/ID   |  |
|  +--------------------+  +----------------------+  +---------------------------+  |
|                                     |                                             |
|  +----------------------------------v------------------------------------------+  |
|  | SQLite Storage (`editor.db` via WAL & PRAGMA foreign_keys = ON)              |  |
|  | Schema migrations (v1-v3), revision conflict (409), idempotency receipts     |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## Installation & Quick Start

### 1. Requirements
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or `pip`
- Pinned OBO Graph JSON ontology file (e.g. `hp.json`, `mondo.json`)

### 2. Install Wheel
The editor is packaged as a standard Python wheel containing all static frontend assets. No Node.js runtime is required.

```bash
# Using uv tool install
uv tool install dist/ontocurator-0.1.0-py3-none-any.whl

# Or in a virtual environment
pip install dist/ontocurator-0.1.0-py3-none-any.whl
```

### 3. Launching the Editor
Start the local server with your workspace directory and ontology file:

```bash
# Launch with HPO
ontocurator serve --workspace ./workspace --ontology ./hp.json

# Launch with MONDO and custom axes profile
ontocurator serve --workspace ./workspace --ontology ./mondo.json --axes-config ./axes.json
```

The CLI will:
1. Initialize SQLite database at `./workspace/editor.db` with auto-migration.
2. Verify integrity and load the ontology file into memory.
3. Generate a secure 32-byte cryptographic session token.
4. Bind to `127.0.0.1` on a free port (default 8000).
5. Automatically open the default browser to `http://127.0.0.1:8000/#token=<session_token>`.

### CLI Options

| Option | Flag | Default | Description |
|---|---|---|---|
| `--workspace` | `-w` | `./workspace` | Directory for SQLite database, uploaded packages, and exports |
| `--ontology` | `-o` | `./hp.json` | Path to pinned OBO Graph JSON ontology file |
| `--axes-config` | | `None` | Path to JSON file defining fallback `AxesConfig` profile |
| `--port` | `-p` | `8000` | Port to bind (use `0` for random free port) |
| `--host` | | `127.0.0.1` | Loopback address (must be `127.0.0.1`, `localhost`, or `::1`) |
| `--no-browser` | | `false` | Do not automatically open default web browser |
| `--web-dir` | | `None` | Custom directory containing built web assets (defaults to embedded) |

---

## Axes Profile Resolution & Fallback

Each work package resolves an `AxesConfig` profile that defines allowed contextual axes:
1. **Explicit Package Config**: If `manifest.json` specifies `axes_config` (including empty `[]`), that profile is bound and persisted.
2. **Built-in Profile**: If `axes_definition` names a known built-in (`editor-axes/v1` or `clinical-phenotype/v1`), standard clinical axes (assertion, experiencer, temporality) are used.
3. **CLI Fallback**: If `--axes-config PATH` is passed to `ontocurator serve`, and matches the package's `axes_definition`, the profile is initialized from the file and persisted in `editor.db`.
4. **Reopen Persistence**: Once resolved, the profile is permanently stored in `package_axes_profiles` in the database, allowing reopening workspaces without passing `--axes-config` again.

Example `axes.json`:
```json
{
  "definition_name": "rare-disease/v1",
  "axes": [
    {
      "id": "severity",
      "label": "Schweregrad",
      "options": ["mild", "moderate", "severe"],
      "allow_empty": false
    },
    {
      "id": "confidence",
      "label": "Befundsicherheit",
      "options": ["confirmed", "suspected", "refuted"],
      "allow_empty": true
    }
  ]
}
```

---

## Security & Offline Guarantees

1. **Loopback-Only Binding**: Service rejects non-loopback addresses (`0.0.0.0`, external IPs) with exit code 1.
2. **DNS Rebinding Protection**: Host header validation rejects any request not directed at `127.0.0.1`, `localhost`, or `[::1]`.
3. **Session Authentication**: All API endpoints require `Authorization: Bearer <token>`, preventing unauthorized local processes from tampering with the workspace.
4. **Zero Runtime Network Calls**: Search operates entirely against the pinned local ontology index. No external dense models, cloud APIs, or telemetry are contacted.
5. **Streaming ZIP Guard**: Package import enforces 64 MB compressed limit, 256 MB uncompressed limit, path traversal sanitization, and atomic tempfile replacement.

---

## Persistence, Migration & Safe Backup

### Workspace Layout
```
workspace/
├── editor.db           # SQLite database containing packages, drafts, and submissions
├── editor.db-wal       # SQLite write-ahead log (when active)
└── editor.db-shm       # SQLite shared-memory file (when active)
```

### Schema Upgrades & Backward Compatibility
- Schema upgrades from earlier versions apply additively (e.g. migration 003 adds `package_axes_profiles`).
- Legacy annotations without `schema_version` retain their original wire layout (`hpo_id`, explicit nulls, legacy axes) and unchanged RFC-8785 hashes.
- New annotations use `schema_version: "ontocurator-annotation/v2"` with `term_id`, `axes: {definition_name, values}`, and bind `axes_config_sha256`.

### Safe Backup Procedure
1. Stop the editor service (`Ctrl+C` in terminal).
2. Confirm no processes are accessing `editor.db`.
3. Copy `workspace/editor.db` (and any associated archive files) to your backup destination.
4. Alternatively, use SQLite's online backup API via command line:
   ```bash
   sqlite3 workspace/editor.db ".backup backup/editor_backup.db"
   ```

---

## Work Package Interchange Formats

Ontocurator reads and writes versioned ZIP packages:
- `ontocurator-work-package/v1` (current default for exports)
- `hpo-editor-work-package/v1` (legacy packages, fully supported for import and roundtrip)

Package contents:
- `manifest.json`: Package ID, format version, ontology SHA-256, axes definition/config/digest, file checksums.
- `documents.jsonl`: Document texts and metadata.
- `annotations.jsonl`: Immutable annotation snapshots with RFC-8785 canonical hashes.
- `evidence.jsonl`: Evidence mentions and segment offsets.
- `submissions.jsonl`: Completed submission records and reviewer decisions.
- `search_events.jsonl`: Audit log of search queries, ranking positions, and selections.

---

## Development & Verification Pipeline

```bash
# Run backend tests
uv run pytest -q

# Run linting and type checks
uv run ruff check .
uv run ruff format --check .
uv run mypy src

# Verify OpenAPI schema synchronization
uv run python scripts/export_openapi.py --check

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
