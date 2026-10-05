# Ontocurator (`ontocurator`)

A standalone, secure, offline web-based editor for annotating and reviewing biomedical ontology concepts (such as the Human Phenotype Ontology (HPO), MONDO Disease Ontology, Gene Ontology (GO), and arbitrary OBO Foundry ontologies) on clinical text documents.

Designed specifically for clinical curation workflows, Ontocurator supports:
- **Configured Annotation Layers & Task Profiles**: Fine-grained task configuration via `TaskProfile`: customizable layers (`layers`), annotation types (`annotation_types`), and required ontologies (`ontologies`). Multi-layer workflows allow annotating distinct aspects (e.g. phenotypes, diseases, therapies) independently or jointly.
- **Zero-Extra-Click Single-Layer Simplicity**: Work packages with a single layer present zero superfluous layer controls, maintaining the exact streamlined ergonomics of dedicated single-ontology curation.
- **Multi-Ontology Loading & Registry**: Load pinned OBO Graph JSON ontologies via repeatable `--ontology PATH` flags, auto-discovery in `<workspace>/ontologies/`, or upload in the web UI. Local in-memory exact and prefix lexical search with instant results.
- **Layer-Scoped Case Navigation & Checkmarks**: Fast document navigation respecting package document order (`document_order`), with layer-specific completion validation and explicit verification checkmarks (`checked_layer_ids`).
- **Independent Annotation**: Clean-slate annotation without proposal bias, external prediction leakage, or term count exposure.
- **Origin-Neutral Review**: Identical treatment, actions, validation rules, and status transitions for human proposals and machine/tool predictions.
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
Start the local server with your workspace directory and ontology file(s):

```bash
# Launch with single ontology (HPO)
ontocurator serve --workspace ./workspace --ontology ./hp.json

# Launch with multiple ontologies (repeatable --ontology)
ontocurator serve --workspace ./workspace --ontology ./hp.json --ontology ./mondo.json
```

The CLI will:
1. Initialize SQLite database at `<workspace>/editor.db` with schema version `ontocurator-workspace/v4`.
2. Load ontologies given via `--ontology`, remembered in the settings file, and found in `<workspace>/ontologies/`.
3. Generate a fresh random session token for this launch (never reused; pass `--token` to fix one).
4. Bind `127.0.0.1` on the saved port (default 8000) or the next free port.
5. Once the server accepts connections, open the browser at `http://127.0.0.1:<port>/#token=<token>` (unless `--no-browser` or `"auto_open_browser": false` in the settings file).

Stop the server with `Ctrl+C`; it shuts down gracefully and closes the database.

The console stays quiet by default (no per-request log); the banner shows the
address without the token. Because each start creates a new token, a browser tab
left open from an earlier start shows a "Please reopen Ontocurator" page:
starting Ontocurator again simply opens a fresh tab for the running instance.

When run from source without `--workspace`, the workspace is the last one used
(saved in the settings file) or `./workspace` relative to the current directory.
Pass `--workspace` explicitly for anything beyond local development.

### CLI Options

| Option | Flag | Default | Description |
|---|---|---|---|
| `--workspace` | `-w` | saved / see below | Directory for SQLite database, uploaded packages, and exports |
| `--ontology` | `-o` | `None` | Path to ontology JSON file, used in place (repeatable) |
| `--import-ontology` | | `None` | Copy an ontology JSON into `<workspace>/ontologies/` and remember it (repeatable) |
| `--package` | | `None` | Work package ZIP to import on startup and open in the UI |
| `--port` | `-p` | saved (`8000`) | Port to bind; `0` = random free port; omitted = saved port or next free one |
| `--host` | | `127.0.0.1` | Loopback address (must be `127.0.0.1`, `localhost`, or `::1`) |
| `--no-browser` | | `false` | Do not automatically open default web browser |
| `--web-dir` | | `None` | Custom directory containing built web assets (defaults to embedded) |
| `--axes-config` | | `None` | Path to JSON file defining fallback `AxesConfig` profile |
| `--token` | `-t` | `None` | Custom session token (a new one is generated on every start if omitted) |
| `--print-url` | | `false` | Also print the full link including the session token (always printed with `--no-browser`) |
| `--verbose` | `-v` | `false` | Show technical details in the startup banner and log every HTTP request |
| `--provision-dir` | | app folder (standalone) | Folder with `ontologies/`, `packages/` and `ontocurator-settings.json` to register/import at start (see [Preconfigured distribution](#preconfigured-distribution)); not used implicitly when run from source |

`ontocurator config [--path | --open | --delete-legacy [--yes]]` shows or manages
the settings locations (see
[Settings from an earlier installation](#settings-from-an-earlier-installation)).

`ontocurator <file-or-folder>` (also: drag & drop onto the executable, "Open with")
routes `.zip` to `--package`, `.json` to `--import-ontology` and a folder to
`--workspace`. Anything else is reported as ignored and the editor starts normally.

---

## Standalone Portable Distribution (no Python, no admin rights)

`scripts/build_standalone.py` produces `ontocurator-portable-<os>-<arch>.zip`
(and on macOS additionally `ontocurator-macos-<arch>-app.zip` with
`Ontocurator.app`).

**Start:** extract the ZIP to a local folder you can write (e.g. `C:\Ontocurator`;
not `C:\Program Files`, and not a OneDrive/Dropbox-synced folder) and double-click `ontocurator.exe` / `ontocurator`.
A console window opens and the browser shows the editor. Dropping a work
package `.zip`, an ontology `.json` or a workspace folder onto the executable
opens it; dropped ontologies are copied into `workspace/ontologies/` as
`<name>-<sha256 prefix>.json`, so the original file can be deleted afterwards.

**Windows SmartScreen:** builds without an Authenticode signature trigger an
"unknown publisher" warning; choose *More info -> Run anyway* only for ZIPs from
a trusted source. **macOS Gatekeeper:** for unsigned builds right-click the app
and choose *Open* the first time.

**Quit:** press `Ctrl+C` in the console window. Do not close the window while a
save or import is running (closing the window triggers a best-effort graceful
shutdown on Windows; `Ctrl+C` is the safe way). For `Ontocurator.app`, quit via
the Dock (Force Quit if it does not react).

**One instance per workspace:** starting Ontocurator again (or dropping another
file onto it) while it is running does not start a second server on the same
database; it opens the browser for the running instance and forwards dropped
packages/ontologies to it. The lock (`<workspace>/.ontocurator.lock`) is released
by the operating system even after a crash, so stale locks never block a start.

**Where data lives** (printed at every start, together with the settings file):

| Mode | Settings file | Default workspace |
|---|---|---|
| Portable ZIP (folder writable, contains `portable.txt`) | `<app folder>/config.json` (paths stored relative to the folder) | `<app folder>/workspace` |
| `Ontocurator.app`, read-only location, or `portable.txt` deleted | per-user config dir (`%APPDATA%\ontocurator`, `~/Library/Application Support/ontocurator`, `~/.config/ontocurator`) | local user data dir: `%LOCALAPPDATA%\Ontocurator\workspace`, `~/Library/Application Support/Ontocurator/workspace`, `~/.local/share/Ontocurator/workspace` |
| From source / wheel | per-user config dir | last used workspace, else `./workspace` |

`ONTOCURATOR_CONFIG_PATH` overrides the settings file location. Moving or
re-extracting the portable folder keeps working because paths inside it are
stored relatively. To update, extract the new version and copy `workspace/` (and
`config.json`) from the old folder. If a saved workspace no longer exists the
default is used and a notice is printed: Ontocurator never switches workspace
silently.

The full workspace path is printed in the console at every start (`Workspace:`)
and again on exit. To **back it up**, quit Ontocurator and copy that folder (see
[Safe Backup Procedure](#safe-backup-procedure)). The per-user default is a
local, non-roaming folder on purpose: `Documents` is often synchronised by
OneDrive, and cloud sync tools can corrupt a SQLite database that is open.
Workspaces saved by older versions (e.g. `Documents/Ontocurator/workspace`) are
kept as they are and never moved. If the workspace lies inside a OneDrive,
Dropbox, iCloud Drive or Google Drive folder, a warning is printed at start;
move it to a local folder (`--workspace`) or pause syncing while you work.

**Switching to the portable ZIP:** the portable copy uses its own
`config.json` and `<app folder>/workspace`. Settings of an older per-user
installation are never taken over automatically (see below). To keep working on
an old workspace, copy that folder into the app folder (or start with
`--workspace <old path>`).

**Session token:** a fresh token is generated on every start. While running it
is stored in `<workspace>/.ontocurator-instance.json` so that a second launch
can reopen the browser; the file is deleted on shutdown. It is owner-only
(mode 0600 on macOS/Linux; on Windows its inherited ACL is replaced by one that
grants only the current user, best effort via `icacls`). The token is only ever
sent to loopback addresses; an instance file naming any other host is ignored.
A second launch waits up to two minutes for a still-starting first instance
(printing progress every ~10 s); if it gives up, it says which dropped files
were *not* imported so they can be imported in the web UI.

### Settings from an earlier installation

An older Ontocurator installation may have left a settings file in the per-user
config folder (e.g. `%APPDATA%\ontocurator\config.json`). Ontocurator never
imports it silently. If it lists ontology files, a port or a browser setting
that differ from the current ones, the start page shows the notice
**"Settings from an earlier Ontocurator installation were found"** with the
file's location and its content (ontology files that no longer exist are marked
"file not found, will be skipped"). You can:

- **Import settings** - the ontology files are copied into
  `workspace/ontologies/` (so the workspace keeps working without the old
  files) and loaded right away; the port and the browser setting take effect the
  next time Ontocurator starts. The old workspace is never taken over.
- **Ignore** - hides the notice. It comes back only if the old file changes.
- **Open folder** - shows the folder of the old settings file.
- **Delete old settings** - after a confirmation, deletes only that one file
  (and its folder if it is then empty). Workspaces, work packages, annotations
  and ontology files are not affected.

A preconfigured bundle (one with `ontocurator-settings.json`) ignores old
settings entirely and shows no notice.

Administrators can do the same on the command line:

```bash
ontocurator config --path            # settings file in use, old settings file (if any), data folder
ontocurator config --open            # open the folder of the settings file in use
ontocurator config --delete-legacy   # delete the old settings file (asks first; --yes skips the question)
```

`ONTOCURATOR_LEGACY_CONFIG_PATH` overrides where the old settings file is
looked for (intended for tests and administrators).

### Building

```bash
# Reproducible: environment from uv.lock, npm ci, artifacts outside the repo
uv run --locked python scripts/build_standalone.py --out-dir ../ontocurator-dist
uv run python scripts/build_standalone.py --help   # all options
```

- `--skip-frontend` bundles the committed `src/ontocurator/web` assets;
  `--skip-npm-ci` reuses `frontend/node_modules` (development only).
- The source tree is only modified with `--update-embedded-web`.
- `scripts/build_release.py` (wheel) refreshes `src/ontocurator/web`, because
  the wheel embeds the UI from there (use `--skip-frontend` to avoid that).
- Optional code signing runs only when configured: `WINDOWS_SIGN_CERT`,
  `WINDOWS_SIGN_PASSWORD`, `WINDOWS_SIGN_TIMESTAMP_URL` (signtool) and
  `MACOS_CODESIGN_IDENTITY`, `MACOS_NOTARY_PROFILE` (codesign/notarytool).
  Unsigned builds are the default (TODO: obtain certificates).
- The archive includes `THIRD_PARTY_NOTICES.md` and `LICENSES/` with generated
  license texts for all bundled Python and npm packages.

---

## Preconfigured distribution

A portable copy can ship everything an annotator needs, so they only extract
the ZIP and double-click the executable:

```
Ontocurator/
├── ontocurator.exe
├── ontologies/                 ← *.json registered at startup
├── packages/                   ← *.zip work packages imported at startup
├── ontocurator-settings.json   ← optional presets
└── workspace/
```

**At every start** (before the browser opens) Ontocurator first registers each
`ontologies/*.json` (copied content-addressed into `workspace/ontologies/` and
remembered in `config.json`), then imports each `packages/*.zip` (packages may
need those ontologies or embed their own). Packages that are already imported
unchanged are skipped silently, so starting again is safe. Invalid files are
skipped with a message in the console; they never block the start.

**These folders are for the initial delivery only.** Imported packages are
immutable and pinned by hash, so replacing or editing files there later does
NOT change data already in the workspace:

- A package in `packages/` whose package ID is already imported but whose
  content differs is **not** imported. The console and the dashboard show a
  yellow warning: *"Package 'X' in the packages folder differs from the already
  imported version. The changed version was NOT imported. To ship changed
  content, use a new package ID."*
- An ontology file with the same name as a previously provisioned one but
  different content is registered as a **new version**; the old one stays for
  existing packages. The dashboard shows a one-time notice.
- To ship changed content, create a new work package with a new package ID, or
  add the new ontology version. Never edit `workspace/` by hand.

`workspace/provisioning.json` records which file was provisioned with which
SHA-256 to detect such changes. `GET /api/v1/provisioning` returns the notices
of the current start. `ontologies/README.txt` and `packages/README.txt` in the
bundle repeat these rules.

### `ontocurator-settings.json`

Optional, next to the executable (every key is optional):

```json
{ "default_mode": "independent", "allowed_modes": ["independent"], "annotator_id": null,
  "open_package": "study-xy-round1", "auto_open_browser": true }
```

| Key | Effect |
|---|---|
| `default_mode` | Working mode used when the person has not chosen one for a package (`independent`, `review`, `assisted`); must be in `allowed_modes` |
| `allowed_modes` | Modes that may be used. With a single mode the dashboard shows it as a fixed label instead of a chooser. Enforced by the server too (other modes → HTTP 403 `MODE_NOT_ALLOWED`), because blinding is the point |
| `annotator_id` | Suggested identity for personalised copies (same rules as the identity field); the person still confirms "You are annotating as …" |
| `open_package` | Package preselected on the dashboard and included in the opened link |
| `auto_open_browser` | Open the browser at start |

Unknown keys are reported and ignored; an invalid file is reported and the
defaults are used. **Precedence:** command line flags (e.g. `--no-browser`,
`--package`) > `ontocurator-settings.json` > saved settings (`config.json`) >
built-in defaults. `GET /api/v1/settings` returns the effective presets.

### Building a preconfigured bundle

Automatically, as part of the standalone build (all preloads are validated
before the build starts: packages must be readable v2 work packages,
ontologies must parse, settings must validate):

```bash
uv run --locked python scripts/build_standalone.py --out-dir ../oc-dist     --package study-xy-round1.zip --ontology hp.json     --settings ontocurator-settings.json --bundle-name study-xy
```

`--package` and `--ontology` are repeatable. `--bundle-name NAME` produces
`NAME.zip` with the top-level folder `NAME/` (so two studies never extract
into the same folder). Without the dev toolchain (no Node.js/PyInstaller),
preconfigure an already built ZIP with the same validation:

```bash
uv run python scripts/provision_bundle.py ontocurator-portable-windows-x86_64.zip     --package study-xy-round1.zip --ontology hp.json     --settings ontocurator-settings.json --bundle-name study-xy
```

Manually (gives the same layout):

1. Extract the standard portable ZIP.
2. Copy work packages (`.zip`) into `packages/` and ontologies (`.json`) into
   `ontologies/`.
3. Optionally add `ontocurator-settings.json` next to the executable.
4. Zip the folder again (keep `workspace/` empty: never ship a used workspace).

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

# Build release bundle (Frontend -> Web Assets -> Wheel Packaging -> Verification)
uv run --locked python scripts/build_release.py --out-dir dist

# Regenerate the demo work package fixture
uv run python scripts/create_demo_package.py --output tests/fixtures/demo_package.zip
```
