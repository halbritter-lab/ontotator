# Ontocurator (`ontocurator`)

A standalone, secure, offline web-based editor for annotating and reviewing biomedical ontology concepts (such as the Human Phenotype Ontology (HPO), MONDO Disease Ontology, Gene Ontology (GO), and arbitrary OBO Foundry ontologies) on clinical text documents.

Designed specifically for clinical curation workflows, Ontocurator supports:
- **Configured Annotation Layers & Task Profiles**: Fine-grained task configuration via `TaskProfile`: customizable layers (`layers`), annotation types (`annotation_types`), and required ontologies (`ontologies`). Multi-layer workflows allow annotating distinct aspects (e.g. phenotypes, diseases, therapies) independently or jointly.
- **Zero-Extra-Click Single-Layer Simplicity**: Work packages with a single layer present zero superfluous layer controls, maintaining the exact streamlined ergonomics of dedicated single-ontology curation.
- **Multi-Ontology Loading & Registry**: Load pinned OBO Graph JSON ontologies via repeatable `--ontology PATH` flags, auto-discovery in `<workspace>/ontologies/`, or upload in the web UI. Local in-memory exact and prefix lexical search with instant results. Official HPO translation files (`hp-<language>.babelon.tsv`, `hp-<language>.synonyms.tsv`) placed next to the ontology or uploaded in the web UI make the terms searchable in that language; each annotator chooses the languages with the flag button in the search box.
- **Layer-Scoped Case Navigation & Checkmarks**: Fast document navigation respecting package document order (`document_order`), with layer-specific completion validation and explicit verification checkmarks (`checked_layer_ids`).
- **Independent Annotation**: Clean-slate annotation without proposal bias, external prediction leakage, or term count exposure.
- **Origin-Neutral Review**: Identical treatment, actions, validation rules, and status transitions for human proposals and machine/tool predictions.
- **Scientific Result Extraction**: Current submissions selected by revision within their recorded origin, explicit review rounds, and JSON analysis distinguishing missing work, checked-negative results and uncertainty. Review retains visible source provenance. See [the scientific workflow](docs/scientific-workflow.md) for a small two-annotator technical pilot.
- **Strict Unicode Codepoint Precision**: Exact slice indexing supporting non-BMP characters (e.g. emoji 👶🏽), combining accents (e.g. café), and line breaks.
- **Lossless Work Package Interchange (V2)**: Atomic, secure ZIP archive exchange format (`ontocurator-work-package/v2`) with RFC-8785 canonical JSON hashing and `ontocurator-annotation/v3` immutable snapshots.
- **V4 Workspace Storage & Clean Format Boundary**: SQLite storage using WAL mode and transactional idempotency receipts (`ontocurator-workspace/v4`). Legacy formats (`hpo-editor-work-package/v1`, `ontocurator-work-package/v1`, and DB v2/v3) are rejected with explicit errors, leaving legacy files completely byte-identical.
- **Self-Contained Offline Bundling**: Pre-compiled React frontend embedded into the Python wheel package; runs without Node.js or network connectivity at runtime.

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
|  |   API & Security   |  | Application Services |  | Ontology Registry         |  |
|  | Loopback & Token   |  | Workspaces, Editing, |  | In-memory lexical & exact |  |
|  | Rebinding Guard    |  | Reviews, Submissions |  | Repeatable --ontology     |  |
|  +--------------------+  +----------------------+  +---------------------------+  |
|                                     |                                             |
|  +----------------------------------v------------------------------------------+  |
|  | SQLite Storage (`editor.db` via WAL & PRAGMA foreign_keys = ON)              |  |
|  | Schema v4 with TaskProfile, revision conflicts (409), idempotency receipts  |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## Installation & Quick Start

### 1. Requirements
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or `pip`
- Pinned OBO Graph JSON ontology file(s) (e.g. `hp.json`, `mondo.json`)

### 2. Install Wheel
The editor is packaged as a standard Python wheel containing all static frontend assets. No Node.js runtime is required.

```bash
# Using uv tool install
uv tool install dist/ontocurator-0.1.0-py3-none-any.whl

# Or in a virtual environment
pip install dist/ontocurator-0.1.0-py3-none-any.whl
```

### 3. Launching the Editor
Create the database schema once with the schema owner's credentials, then start
the server with a data folder and ontology file(s):

```bash
export ONTOCURATOR_MIGRATION_DATABASE_URL=postgresql://ontocurator_owner@localhost/ontocurator
ontocurator db upgrade

export ONTOCURATOR_DATABASE_URL=postgresql://ontocurator_app@localhost/ontocurator
# Launch with a single ontology (HPO)
ontocurator serve --data-dir ./data --ontology ./hp.json

# Launch with multiple ontologies (repeatable --ontology)
ontocurator serve --data-dir ./data --ontology ./hp.json --ontology ./mondo.json
```

The server loads the ontologies given via `--ontology` and those uploaded
earlier (stored in `<data-dir>/ontologies/`), generates a fresh session token
and prints the link `http://<host>:<port>/#token=<token>` to open in the
browser. Stop it with `Ctrl+C`. Passwords come from
`ONTOCURATOR_MIGRATION_DATABASE_PASSWORD` and `ONTOCURATOR_DATABASE_PASSWORD`
(or their `_FILE` variants).

### CLI Options

`ontocurator serve`:

| Option | Flag | Default | Description |
|---|---|---|---|
| `--data-dir` | | `data` (env `ONTOCURATOR_DATA_DIR`) | Folder for stored files, uploaded ontologies, preferences and exports |
| `--database-url` | | env `ONTOCURATOR_DATABASE_URL` | PostgreSQL URL of the application role |
| `--ontology` | `-o` | `None` | Path to ontology JSON file, used in place (repeatable) |
| `--translations-dir` | | `None` | Folder with translation files besides `<data-dir>/ontologies/` (repeatable) |
| `--host` | | `127.0.0.1` (env `ONTOCURATOR_HOST`) | Address to bind |
| `--port` | | `8000` (env `ONTOCURATOR_PORT`) | Port to bind |
| `--web-dir` | | `None` | Custom directory containing built web assets (defaults to embedded) |
| `--verbose` | `-v` | `false` | Log every HTTP request |

Other commands: `ontocurator db upgrade` (schema migrations, as the schema
owner), `ontocurator analyze <package.zip>` (analysis JSON of an exported work
package) and `ontocurator version`.

---

## Ontology Licensing

Ontocurator does not bundle ontology releases. The Human Phenotype Ontology is
subject to the HPO license and citation requirements:
https://hpo.jax.org/license. Third-party code and bundled dependencies are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Security & Offline Guarantees

1. **Loopback-Only Binding**: Service rejects non-loopback addresses (`0.0.0.0`, external IPs) with exit code 1.
2. **DNS Rebinding Protection**: Host header validation rejects any request not directed at `127.0.0.1`, `localhost`, or `[::1]`.
3. **Session Authentication**: All API endpoints require `Authorization: Bearer <token>`, preventing unauthorized local processes from tampering with the workspace.
4. **Zero Runtime Network Calls**: Search operates entirely against the pinned local ontology index. No external dense models, cloud APIs, or telemetry are contacted.
5. **Streaming ZIP Guard**: Package import enforces 64 MB compressed limit, 256 MB uncompressed limit, path traversal sanitization, and atomic tempfile replacement.

---

## Persistence & Storage

### Workspace Layout
```
workspace/
├── editor.db           # SQLite database (ontocurator-workspace/v4)
├── editor.db-wal       # SQLite write-ahead log (when active)
└── editor.db-shm       # SQLite shared-memory file (when active)
```

### Schema & Format Boundary
- Workspaces are initialized with schema `ontocurator-workspace/v4`.
- Legacy database versions (v1, v2, v3) are strictly rejected with error code `UNSUPPORTED_WORKSPACE_VERSION`. The database files remain completely unmodified.
- Legacy work packages (`hpo-editor-work-package/v1`, `ontocurator-work-package/v1`) are cleanly rejected with error code `INVALID_PACKAGE`.
- Benchmark adapters and migration converters for legacy formats are maintained externally as dedicated conversion tooling.

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

Ontocurator uses the **V2 Work Package** format (`ontocurator-work-package/v2`). For complete specification and schema examples, see [docs/work-package-v2.md](docs/work-package-v2.md).

*(Note: The previous V1 format documentation is archived at [docs/work-package-v1.md](docs/work-package-v1.md) for historical reference.)*

Package contents:
- `manifest.json`: Package ID, format version `ontocurator-work-package/v2`, `task_profile` definition, `task_profile_sha256`, and file checksums.
- `documents.jsonl`: Document texts and metadata.
- `annotations.jsonl`: Immutable annotation snapshots (`ontocurator-annotation/v3`) with RFC-8785 canonical hashes.
- `evidence.jsonl`: Evidence mentions and segment offsets.
- `submissions.jsonl`: Completed submission records, layer checkmarks (`checked_layer_ids`), and reviewer decisions.
- `search-events.jsonl`: Audit log of search queries, ranking positions, and selections.

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

# Build the wheel from the committed web assets and check its contents
uv run python scripts/check_wheel.py --out-dir dist

# Regenerate the demo work package fixture
uv run python scripts/create_demo_package.py --output tests/fixtures/demo_package.zip
```
