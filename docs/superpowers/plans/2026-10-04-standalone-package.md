# Standalone Package & Zero-CLI Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a zero-installation, portable standalone distribution of Ontocurator with persistent configuration, automatic ontology discovery, in-app ontology upload, and a local PyInstaller build pipeline.

**Architecture:** A lightweight persistent configuration module (`PersistentConfig`) resolves standard OS configuration directories and local overrides. The application server automatically discovers and loads ontologies from `<workspace>/ontologies/` on startup. The REST API is extended with `GET /api/v1/ontologies` and `POST /api/v1/ontologies`, allowing the web UI to manage ontologies and recover from `ONTOLOGY_NOT_FOUND` errors dynamically. A standalone packaging script (`scripts/build_standalone.py`) builds the frontend, packages the application via PyInstaller into a portable zero-install directory/ZIP, and validates the build.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, Typer, PyInstaller, React 18, Vite, TypeScript, Pytest.

**Spec:** [docs/superpowers/specs/2026-10-04-standalone-package-design.md](file:///C:/Users/jan-p/Development/hpo-annotation-editor/.worktrees/standalone-package/docs/superpowers/specs/2026-10-04-standalone-package-design.md)

## Global Constraints

- No external installer required (pure portable ZIP distribution).
- Loopback-only binding guarantee (127.0.0.1, localhost, ::1) remains strictly enforced.
- Existing tests and CLI flags must remain 100% backward compatible.
- All configuration changes must persist safely without file corruption (atomic write or safe replace).
- No hardcoded OS-specific paths: use `pathlib.Path` and platform-aware directory resolution.

## Review Focus

1. Corrupted or invalid JSON in `%APPDATA%/ontocurator/config.json`: Must fall back gracefully to defaults instead of crashing.
2. Incompatible or malformed JSON file dropped in `<workspace>/ontologies/`: Must log a warning and skip the file without aborting server startup.
3. Uploading an ontology that is already registered: Must return success with existing metadata without duplicate service registration.
4. Uploading an invalid/non-OBO JSON to `POST /api/v1/ontologies`: Must return 400 Bad Request with a clear message, leaving existing registry unchanged.
5. Launching `ontocurator` with a single file path as argument (e.g. dropped file): Must gracefully handle `.zip` or `.json` or directory without unhandled exceptions.

---

### Task 1: Persistent Configuration Subsystem (`PersistentConfig`)

**Files:**
- Create: `src/ontocurator/config_store.py`
- Modify: `src/ontocurator/config.py`
- Test: `tests/test_config_store.py`

**Interfaces:**
- Produces:
  ```python
  class PersistentConfig(BaseModel):
      workspace_dir: Path = Path("./workspace")
      ontology_paths: list[Path] = Field(default_factory=list)
      port: int = 8000
      host: str = "127.0.0.1"
      auto_open_browser: bool = True


  def get_default_config_path() -> Path: ...
  def load_persistent_config(custom_path: Path | None = None) -> PersistentConfig: ...
  def save_persistent_config(
      config: PersistentConfig, custom_path: Path | None = None
  ) -> None: ...
  ```

- [ ] **Step 1: Write the failing tests for PersistentConfig loading, saving, and corruption handling**

`tests/test_config_store.py`:
```python
from pathlib import Path
import json
import pytest
from ontocurator.config_store import (
    PersistentConfig,
    get_default_config_path,
    load_persistent_config,
    save_persistent_config,
)


def test_default_config_values(tmp_path: Path) -> None:
    cfg = PersistentConfig()
    assert cfg.port == 8000
    assert cfg.host == "127.0.0.1"
    assert cfg.auto_open_browser is True


def test_save_and_load_persistent_config(tmp_path: Path) -> None:
    config_file = tmp_path / "config.json"
    cfg = PersistentConfig(
        workspace_dir=tmp_path / "custom_ws",
        ontology_paths=[tmp_path / "hp.json"],
        port=8080,
        host="127.0.0.1",
        auto_open_browser=False,
    )
    save_persistent_config(cfg, config_file)
    assert config_file.is_file()

    loaded = load_persistent_config(config_file)
    assert loaded.workspace_dir == (tmp_path / "custom_ws").resolve()
    assert loaded.ontology_paths == [(tmp_path / "hp.json").resolve()]
    assert loaded.port == 8080
    assert loaded.auto_open_browser is False


def test_corrupted_config_falls_back_to_defaults(tmp_path: Path) -> None:
    config_file = tmp_path / "corrupt.json"
    config_file.write_text("{invalid json...", encoding="utf-8")
    loaded = load_persistent_config(config_file)
    assert loaded.port == 8000
    assert loaded.host == "127.0.0.1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_config_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ontocurator.config_store'`

- [ ] **Step 3: Implement `src/ontocurator/config_store.py`**

```python
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from pydantic import BaseModel, Field


class PersistentConfig(BaseModel):
    workspace_dir: Path = Path("./workspace")
    ontology_paths: list[Path] = Field(default_factory=list)
    port: int = 8000
    host: str = "127.0.0.1"
    auto_open_browser: bool = True


def get_default_config_path() -> Path:
    """Resolve standard OS configuration path for ontocurator."""
    if sys.platform == "win32":
        app_data = os.environ.get("APPDATA")
        base = Path(app_data) if app_data else Path.home() / "AppData" / "Roaming"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg_config) if xdg_config else Path.home() / ".config"

    return base / "ontocurator" / "config.json"


def load_persistent_config(custom_path: Path | None = None) -> PersistentConfig:
    """Load persistent configuration, falling back cleanly to defaults if missing or corrupted."""
    target = custom_path or get_default_config_path()
    if not target.is_file():
        return PersistentConfig()

    try:
        content = target.read_text(encoding="utf-8")
        data = json.loads(content)
        return PersistentConfig.model_validate(data)
    except Exception:
        return PersistentConfig()


def save_persistent_config(
    config: PersistentConfig, custom_path: Path | None = None
) -> None:
    """Save persistent configuration atomically."""
    target = custom_path or get_default_config_path()
    target.parent.mkdir(parents=True, exist_ok=True)

    tmp_file = target.with_suffix(".tmp")
    data = config.model_dump(mode="json")
    # Store resolved path strings
    data["workspace_dir"] = str(config.workspace_dir.resolve())
    data["ontology_paths"] = [str(p.resolve()) for p in config.ontology_paths]

    tmp_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_file.replace(target)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_config_store.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/ontocurator/config_store.py tests/test_config_store.py
git commit -m "feat(config): add persistent configuration store with OS directory resolution"
```

---

### Task 2: Auto-Discovery & In-App Ontology Management

**Files:**
- Create: `src/ontocurator/ontology/discovery.py`
- Modify: `src/ontocurator/api/routes.py`
- Modify: `src/ontocurator/api/app.py`
- Test: `tests/test_ontology_management.py`

**Interfaces:**
- Produces:
  ```python
  def discover_ontologies(search_dirs: list[Path]) -> list[Path]: ...
  ```
  REST Endpoints:
  - `GET /api/v1/ontologies` -> `list[OntologyInfo]`
  - `POST /api/v1/ontologies` (multipart upload) -> `OntologyInfo`

- [ ] **Step 1: Write failing tests for ontology auto-discovery and API endpoints**

`tests/test_ontology_management.py`:
```python
from pathlib import Path
import json
import pytest
from fastapi.testclient import TestClient
from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.ontology.discovery import discover_ontologies

SAMPLE_OBO_JSON = {
    "graphs": [
        {
            "id": "http://purl.obolibrary.org/obo/hp.json",
            "meta": {"version": "2024-06-01"},
            "nodes": [
                {
                    "id": "http://purl.obolibrary.org/obo/HP_0000001",
                    "lbl": "All",
                    "type": "CLASS",
                },
                {
                    "id": "http://purl.obolibrary.org/obo/HP_0000118",
                    "lbl": "Phenotypic abnormality",
                    "type": "CLASS",
                },
            ],
            "edges": [],
        }
    ]
}


def test_discover_ontologies(tmp_path: Path) -> None:
    ont_dir = tmp_path / "ontologies"
    ont_dir.mkdir()
    valid_ont = ont_dir / "hp.json"
    valid_ont.write_text(json.dumps(SAMPLE_OBO_JSON), encoding="utf-8")
    invalid_file = ont_dir / "other.txt"
    invalid_file.write_text("not json", encoding="utf-8")

    discovered = discover_ontologies([ont_dir])
    assert valid_ont.resolve() in discovered


def test_get_and_post_ontologies_endpoint(tmp_path: Path) -> None:
    config = AppConfig(
        workspace_dir=tmp_path / "workspace",
        database_path=tmp_path / "workspace" / "editor.db",
        session_token="test-token",
        port=8000,
        host="127.0.0.1",
    )
    app = create_app(config)
    client = TestClient(app, headers={"Authorization": "Bearer test-token"})

    # Initial list is empty
    res = client.get("/api/v1/ontologies")
    assert res.status_code == 200
    assert res.json() == []

    # Upload ontology
    file_bytes = json.dumps(SAMPLE_OBO_JSON).encode("utf-8")
    res_upload = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", file_bytes, "application/json")},
    )
    assert res_upload.status_code == 200
    data = res_upload.json()
    assert data["term_count"] == 2
    assert "sha256" in data

    # Verify listed now
    res_after = client.get("/api/v1/ontologies")
    assert res_after.status_code == 200
    assert len(res_after.json()) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ontology_management.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ontocurator.ontology.discovery'`

- [ ] **Step 3: Implement `src/ontocurator/ontology/discovery.py`**

```python
from __future__ import annotations

import json
from pathlib import Path


def is_probable_obo_graph(path: Path) -> bool:
    """Check if file is a readable JSON file with OBO Graph structure."""
    if not path.is_file() or path.suffix.lower() != ".json":
        return False
    try:
        # Quick inspect without reading massive files entirely if possible
        with open(path, "r", encoding="utf-8") as f:
            head = f.read(512)
            return '"graphs"' in head or '"nodes"' in head
    except Exception:
        return False


def discover_ontologies(search_dirs: list[Path]) -> list[Path]:
    """Scan directories for valid ontology JSON files."""
    found: list[Path] = []
    seen_resolved: set[Path] = set()

    for directory in search_dirs:
        if not directory.is_dir():
            continue
        for candidate in directory.glob("*.json"):
            resolved = candidate.resolve()
            if resolved in seen_resolved:
                continue
            if is_probable_obo_graph(resolved):
                seen_resolved.add(resolved)
                found.append(resolved)

    return found
```

- [ ] **Step 4: Implement endpoints in `src/ontocurator/api/routes.py` and models**

Add `OntologyInfo` model and endpoints:
```python
class OntologyInfo(BaseModel):
    ontology_id: str
    release: str
    sha256: str
    term_count: int
    path: str | None = None


@router.get("/ontologies")
def list_ontologies(request: Request) -> list[OntologyInfo]:
    """List loaded ontologies in memory registry."""
    registry = request.app.state.ontology_registry
    results = []
    for sha, svc in registry._services.items():
        results.append(
            OntologyInfo(
                ontology_id=svc.ontology_id,
                release=svc.ref.release,
                sha256=sha,
                term_count=len(svc.terms),
            )
        )
    return results


@router.post("/ontologies")
async def upload_ontology(
    file: UploadFile,
    request: Request,
) -> OntologyInfo:
    """Upload and register an ontology file into the active workspace."""
    content = await file.read()
    registry = request.app.state.ontology_registry
    config = getattr(request.app.state, "config", None)

    workspace_ont_dir = (
        (config.workspace_dir / "ontologies")
        if config
        else Path("./workspace/ontologies")
    )
    workspace_ont_dir.mkdir(parents=True, exist_ok=True)

    filename = file.filename or "ontology.json"
    dest_path = workspace_ont_dir / filename
    dest_path.write_bytes(content)

    digest = registry.register_path(dest_path)
    from ontocurator.ontology.service import OntologyService
    from ontocurator.domain.annotations import OntologyRef

    svc = OntologyService.load(
        dest_path, OntologyRef(release="uploaded", sha256=digest)
    )
    registry.register_service(svc)

    # Persist in configuration
    from ontocurator.config_store import load_persistent_config, save_persistent_config

    p_cfg = load_persistent_config()
    if dest_path.resolve() not in [p.resolve() for p in p_cfg.ontology_paths]:
        p_cfg.ontology_paths.append(dest_path.resolve())
        save_persistent_config(p_cfg)

    return OntologyInfo(
        ontology_id=svc.ontology_id,
        release=svc.ref.release,
        sha256=digest,
        term_count=len(svc.terms),
        path=str(dest_path),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/test_ontology_management.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ontocurator/ontology/discovery.py src/ontocurator/api/routes.py tests/test_ontology_management.py
git commit -m "feat(ontology): add ontology auto-discovery and in-app upload endpoints"
```

---

### Task 3: Zero-CLI Startup & Safe Argument Handling in CLI

**Files:**
- Modify: `src/ontocurator/cli.py`
- Test: `tests/test_cli_standalone.py`

**Interfaces:**
- CLI behavior:
  - When invoked as `ontocurator` (without arguments):
    - Loads `PersistentConfig`.
    - Auto-discovers ontologies in `<workspace>/ontologies/`.
    - Automatically creates `<workspace>` and `<workspace>/ontologies/`.
  - When invoked with a single positional file/path argument:
    - If `.zip`: starts server, imports the package, opens browser.
    - If `.json`: registers the ontology into `<workspace>/ontologies/` and starts.
    - If directory: sets workspace directory.

- [ ] **Step 1: Write failing tests for CLI zero-argument and safe single-argument launch**

`tests/test_cli_standalone.py`:
```python
from pathlib import Path
from unittest.mock import patch
import pytest
from typer.testing import CliRunner
from ontocurator.cli import app
from ontocurator.config_store import PersistentConfig

runner = CliRunner()


def test_cli_default_launch_loads_config_and_discovers_ontologies(
    tmp_path: Path,
) -> None:
    ws = tmp_path / "my_workspace"
    ont_dir = ws / "ontologies"
    ont_dir.mkdir(parents=True)
    (ont_dir / "dummy.json").write_text("{}", encoding="utf-8")

    fake_config = PersistentConfig(workspace_dir=ws)

    with (
        patch("ontocurator.cli.load_persistent_config", return_value=fake_config),
        patch("ontocurator.cli.uvicorn.run") as mock_run,
        patch("ontocurator.cli.webbrowser.open"),
    ):
        result = runner.invoke(app, ["serve", "--no-browser", "--port", "0"])
        assert result.exit_code == 0
        mock_run.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails or runs as expected**

Run: `uv run pytest tests/test_cli_standalone.py -v`

- [ ] **Step 3: Modify `src/ontocurator/cli.py` to integrate PersistentConfig, Auto-Discovery, and Safe Argument Interpretation**

Update `serve` command in `src/ontocurator/cli.py`:
1. Check `load_persistent_config()`. If `--workspace` was not explicitly passed, use `persistent_config.workspace_dir`.
2. Discover ontologies in `<workspace>/ontologies/` and combine with CLI `--ontology` and `persistent_config.ontology_paths`.
3. Support a root callback in `cli.py` that interprets single argument `target_path: Path | None = None` if `serve` was omitted.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_cli_standalone.py tests/test_cli.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ontocurator/cli.py tests/test_cli_standalone.py
git commit -m "feat(cli): integrate persistent config, ontology auto-discovery and zero-CLI launch"
```

---

### Task 4: Web UI Integration for Missing Ontologies and In-App Upload

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/ontologyUpload.test.tsx`

**Interfaces:**
- `api.listOntologies()`: calls `GET /api/v1/ontologies`
- `api.uploadOntology(file: File)`: calls `POST /api/v1/ontologies`
- UI: When package import encounters `ONTOLOGY_NOT_FOUND`, display an ontology recovery modal allowing upload of the missing `.json` file, followed by immediate package retry.

- [ ] **Step 1: Write failing frontend test for ontology upload prompt on ONTOLOGY_NOT_FOUND**

`frontend/tests/ontologyUpload.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";

describe("Ontology recovery workflow", () => {
  it("renders upload prompt when package requires missing ontology", async () => {
    // Mock API client to fail uploadPackage with ONTOLOGY_NOT_FOUND
    // Verify modal is displayed and user can upload missing ontology
  });
});
```

- [ ] **Step 2: Run frontend test to verify it fails**

Run: `npm --prefix frontend test frontend/tests/ontologyUpload.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement client methods and recovery dialog in `frontend/src/App.tsx`**

1. Add `listOntologies()` and `uploadOntology()` to `frontend/src/api/client.ts`.
2. In `App.tsx`:
   - Catch `ONTOLOGY_NOT_FOUND` in package upload / selection.
   - Show intuitive modal dialog:
     *"This package requires the ontology '[ontology_id]'. Upload the corresponding OBO Graph JSON file to continue."*
   - Once file is uploaded via `api.uploadOntology(file)`, automatically retry the package opening.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test frontend/tests/ontologyUpload.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/App.tsx frontend/tests/ontologyUpload.test.tsx
git commit -m "feat(ui): add in-app ontology management and recovery modal for missing ontologies"
```

---

### Task 5: Standalone Packaging Script & PyInstaller Specification (`scripts/build_standalone.py`)

**Files:**
- Create: `scripts/build_standalone.py`
- Modify: `pyproject.toml` (add `pyinstaller` to dev dependencies)
- Test: `tests/test_standalone_packaging.py`

**Interfaces:**
- Produces:
  - `dist/ontocurator-portable-<os>-<arch>/` and `dist/ontocurator-portable-<os>-<arch>.zip`
  - Containing:
    - `ontocurator.exe` (or `ontocurator` on Unix)
    - `ontologies/README.txt`
    - `workspace/`
    - `README.txt`

- [ ] **Step 1: Add `pyinstaller` to `pyproject.toml` dev dependency group and sync**

```toml
[dependency-groups]
dev = [
    ...,
    "pyinstaller>=6.5,<7",
]
```
Run `uv sync` to install PyInstaller.

- [ ] **Step 2: Implement `scripts/build_standalone.py`**

```python
"""Standalone portable release packager for Ontocurator."""

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
WEB_DIR = REPO_ROOT / "src" / "ontocurator" / "web"
DIST_DIR = REPO_ROOT / "dist"


def main() -> None:
    # 1. Build frontend and copy assets
    # 2. Invoke PyInstaller with --onedir and proper hooks
    # 3. Create portable structure with ontologies/ and workspace/
    # 4. Create ZIP archive in dist/
    ...
```

- [ ] **Step 3: Write test verifying standalone build structure and smoke test execution**

`tests/test_standalone_packaging.py`:
```python
import subprocess
import sys
from pathlib import Path


def test_standalone_distribution_bundle(tmp_path: Path) -> None:
    # Verify build_standalone generates valid portable directory with executable
    ...
```

- [ ] **Step 4: Run `scripts/build_standalone.py` and verify build**

Run: `uv run python scripts/build_standalone.py`
Expected: Successfully generates portable ZIP in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock scripts/build_standalone.py tests/test_standalone_packaging.py
git commit -m "feat(packaging): add automated standalone PyInstaller build pipeline"
```

---

### Task 6: Full Suite Verification & Final Polish

- [ ] **Step 1: Run all Python tests**
Run: `uv run pytest`
Expected: 100% PASS

- [ ] **Step 2: Run all linters and typecheckers**
Run: `uv run ruff check .`
Run: `uv run ruff format --check .`
Run: `uv run mypy src`
Run: `npm --prefix frontend run typecheck`
Run: `npm --prefix frontend test`
Expected: 0 errors

- [ ] **Step 3: Commit and finalize**
