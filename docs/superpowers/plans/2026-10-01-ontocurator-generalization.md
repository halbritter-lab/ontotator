# Ontocurator Generalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the editor from an HPO-only tool to `ontocurator`, an ontology-agnostic annotation and review system for OBO Foundry ontologies, renaming packages, models, CLI, and UI.

**Architecture:** The core storage and review engines remain invariant, while the Python namespace changes from `hpo_editor` to `ontocurator`, the domain attribute `hpo_id` transitions to `term_id` (with backward compatibility aliases), the ontology search is generalized for any CURIE and dominant prefix, and the React frontend is re-branded and re-synced with OpenAPI.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, SQLite 3, React 18, TypeScript, Vite.

**Spec:** `docs/superpowers/specs/2026-10-01-ontocurator-generalization-design.md`

## Global Constraints

- Python package name must be `ontocurator`, CLI binary name `ontocurator`.
- Data model must support `term_id` as primary attribute while deserializing legacy `hpo_id` transparently.
- Work package importer must accept both `ontocurator-work-package/v1` and legacy `hpo-editor-work-package/v1`.
- Tests must pass cleanly with `uv run pytest`.
- Frontend build must compile cleanly and embed into the package without requiring Node.js at runtime.

## Review Focus

1. **Legacy Work Package Compatibility:** Importing a zip package with `format_version: "hpo-editor-work-package/v1"` and `hpo_id` must load cleanly into `term_id`.
2. **Non-HPO CURIE Search:** Exact and lexical search on an ontology with prefix other than `HP` (e.g. `MONDO:0000001`) must resolve and rank correctly.
3. **Draft Serialization Roundtrip:** In-progress workspace drafts and SQLite snapshots must preserve RFC-8785 canonical hash integrity with `term_id`.
4. **CLI Entrypoint & Help Output:** `ontocurator --help` and `ontocurator serve --help` must run without import errors.
5. **Frontend Asset Integrity:** Embedded web assets must contain new branding ("Ontocurator") and render `term_id` values properly.

---

### Task 1: Package Rename and Import Migration

**Files:**
- Create/Move: `src/ontocurator/` (from `src/hpo_editor/`)
- Modify: `pyproject.toml`
- Modify: All files in `src/ontocurator/` and `tests/`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: Python packaging config
- Produces: `import ontocurator` namespace, `ontocurator` CLI executable

- [ ] **Step 1: Move directory and update `pyproject.toml`**
Rename `src/hpo_editor` to `src/ontocurator`.
In `pyproject.toml`, set:
```toml
[project]
name = "ontocurator"
version = "0.1.0"
description = "Secure offline editor for ontology annotation and origin-neutral review"
...
[project.scripts]
ontocurator = "ontocurator.cli:main"
```

- [ ] **Step 2: Update all import statements**
Replace all occurrences of `from hpo_editor.` and `import hpo_editor` with `from ontocurator.` and `import ontocurator` across `src/ontocurator/` and `tests/`.

- [ ] **Step 3: Run pytest to verify imports**
Run: `uv run pytest tests/test_domain.py -v`
Expected: PASS with new `ontocurator` imports.

- [ ] **Step 4: Commit changes**
```bash
git add pyproject.toml src/ tests/
git commit -m "refactor: rename package and imports to ontocurator"
```

---

### Task 2: Domain Model, Configurable Axes & Database Schema Generalization

**Files:**
- Modify: `src/ontocurator/domain/axes.py`
- Modify: `src/ontocurator/domain/annotations.py`
- Modify: `src/ontocurator/storage/database.py`
- Create: `src/ontocurator/storage/migrations/003_generalize_term_id_and_axes.sql`
- Modify: `src/ontocurator/storage/repository.py`
- Modify: `src/ontocurator/application/editing.py`
- Modify: `src/ontocurator/application/reviews.py`
- Test: `tests/test_domain.py`, `tests/test_storage.py`

**Interfaces:**
- Consumes: `Annotation`, `AnnotationSnapshot`, `Axes`, SQLite database
- Produces: `Annotation(term_id=...)` with backward-compatible alias `hpo_id`, `Axes(definition_name=..., values=...)` with `AxisDefinition`

- [ ] **Step 1: Write failing test for `term_id` and configurable `Axes`**
In `tests/test_domain.py`, add:
```python
def test_annotation_supports_term_id_and_legacy_hpo_id():
    from ontocurator.domain.annotations import Annotation, Provenance, ActorRef
    from ontocurator.domain.axes import Axes, AxisDefinition
    
    # Using term_id and dynamic axes
    axes = Axes(definition_name="custom/v1", values={"severity": "severe"})
    ann = Annotation(
        annotation_id="ann-1",
        document_id="doc-1",
        term_id="MONDO:0000001",
        axes=axes,
        provenance=Provenance(actor=ActorRef(actor_id="a1", kind="human"), method="manual"),
    )
    assert ann.term_id == "MONDO:0000001"
    assert ann.axes.values["severity"] == "severe"
    
    # Using legacy hpo_id and legacy axes
    legacy = Annotation.model_validate({
        "annotation_id": "ann-2",
        "document_id": "doc-1",
        "hpo_id": "HP:0001250",
        "axes": {"definition_name": "editor-axes/v1", "assertion": "present"},
        "provenance": {"actor": {"actor_id": "a1", "kind": "human"}, "method": "manual"},
    })
    assert legacy.term_id == "HP:0001250"
    assert legacy.axes.values["assertion"] == "present"
    assert legacy.axes.assertion == "present"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `uv run pytest tests/test_domain.py -k test_annotation_supports_term_id_and_legacy_hpo_id -v`
Expected: FAIL (`term_id` not found or validation error)

- [ ] **Step 3: Update `Axes` in `domain/axes.py`**
In `src/ontocurator/domain/axes.py`:
- Add `AxisDefinition(id: str, label: str, options: list[str], allow_empty: bool = True)`
- Add `STANDARD_CLINICAL_AXES: list[AxisDefinition]` defining assertion, experiencer, temporality.
- Redefine `Axes(definition_name: str = "clinical-phenotype/v1", values: dict[str, str] = Field(default_factory=dict))`
- Add validator to convert legacy keys (`assertion`, `experiencer`, `temporality`) into `values`.
- Add backward-compatibility property getters and setters for `.assertion`, `.experiencer`, `.temporality`.

- [ ] **Step 4: Update `Annotation` and `AnnotationSnapshot`**
In `src/ontocurator/domain/annotations.py`:
- Define `term_id: str = Field(..., validation_alias=AliasChoices("term_id", "hpo_id"))` or model validator mapping `hpo_id` to `term_id`.
- Update CURIE validation to `^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`.
- Expose `@property def hpo_id(self) -> str: return self.term_id` for backward compatibility.
- Ensure RFC-8785 canonical hash dictionary uses `term_id` and canonical sorted `axes.values`.

- [ ] **Step 5: Update SQLite migration and repository**
- Add migration `003_generalize_term_id_and_axes.sql` migrating column `hpo_id` to `term_id` and storing `axes` JSON values.
- Update repository queries in `src/ontocurator/storage/repository.py` to use `term_id` and dynamic axes.

- [ ] **Step 6: Run tests to verify pass**
Run: `uv run pytest tests/test_domain.py tests/test_storage.py -v`
Expected: PASS

- [ ] **Step 7: Commit changes**
```bash
git add src/ontocurator/domain/ src/ontocurator/storage/ tests/
git commit -m "feat: generalize annotation domain model to term_id and dynamic configurable axes"
```

---

### Task 3: Ontology Service & Search CURIE Generalization

**Files:**
- Modify: `src/ontocurator/ontology/service.py`
- Modify: `src/ontocurator/vendor/hpo_span_annotator/hpo.py`
- Modify: `src/ontocurator/vendor/hpo_span_annotator/search.py`
- Test: `tests/test_ontology.py`

**Interfaces:**
- Consumes: OBO Graph JSON file
- Produces: `OntologyService` capable of searching and validating terms for any OBO ontology prefix

- [ ] **Step 1: Write test for non-HPO ontology loading and search**
In `tests/test_ontology.py`, write a test that builds a mini OBO-graph with `MONDO:0000001` and searches for `MONDO:0000001` as well as query `0000001`.

- [ ] **Step 2: Run test to verify it fails**
Run: `uv run pytest tests/test_ontology.py -k test_mondo_search -v`
Expected: FAIL

- [ ] **Step 3: Implement dynamic dominant prefix and general CURIE handling**
In `src/ontocurator/vendor/hpo_span_annotator/hpo.py`:
- Store detected ontology prefix in `HPOTreeIndex` / `OntologyIndex`.
In `src/ontocurator/vendor/hpo_span_annotator/search.py`:
- In candidate normalization, check if query contains `:` or matches any CURIE. If digits only, prefix with detected ontology prefix (e.g. `MONDO:` or `HP:`).
In `src/ontocurator/ontology/service.py`:
- Generalize `validate_term` to support any CURIE format matching loaded index.

- [ ] **Step 4: Run tests to verify pass**
Run: `uv run pytest tests/test_ontology.py -v`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add src/ontocurator/ontology/ src/ontocurator/vendor/ tests/test_ontology.py
git commit -m "feat: support arbitrary OBO ontology prefixes in ontology service and search"
```

---

### Task 4: Work Package Format Version, Configurable Axes & Reader/Writer Migration

**Files:**
- Modify: `src/ontocurator/packages/models.py`
- Modify: `src/ontocurator/packages/reader.py`
- Modify: `src/ontocurator/packages/writer.py`
- Modify: `src/ontocurator/application/workspaces.py`
- Modify: `docs/work-package-v1.md`
- Test: `tests/test_packages.py`

**Interfaces:**
- Consumes: ZIP archive with `manifest.json` containing `axes_definition` and optional `axes_config`
- Produces: `WorkspaceView(..., axes_config=...)`, exported `ontocurator-work-package/v1` package

- [ ] **Step 1: Write test for backward-compatible package reading and custom axes config**
In `tests/test_packages.py`, add:
```python
def test_package_reads_custom_axes_config_and_legacy_axes():
    # 1. Test reading legacy package with editor-axes/v1
    # 2. Test reading modern package with axes_config: list[AxisDefinition]
```

- [ ] **Step 2: Update `PackageManifest` and `WorkspaceView`**
In `src/ontocurator/packages/models.py`:
- `DEFAULT_FORMAT_VERSION = "ontocurator-work-package/v1"`
- `SUPPORTED_FORMAT_VERSIONS = {"ontocurator-work-package/v1", "hpo-editor-work-package/v1"}`
- `axes_config: list[AxisDefinition] | None = None`
In `src/ontocurator/application/workspaces.py`:
- `WorkspaceView` adds `axes_config: list[AxisDefinition] = Field(default_factory=list)`.
- `WorkspaceService.open` populates `axes_config` from package manifest (defaulting to `STANDARD_CLINICAL_AXES` if `axes_definition in ("editor-axes/v1", "clinical-phenotype/v1")` and no explicit `axes_config` is set).

- [ ] **Step 3: Update `reader.py` and `writer.py`**
In `src/ontocurator/packages/reader.py`:
- Normalize incoming records so `hpo_id` is translated to `term_id`, and legacy axes fields are converted to `Axes.values`.
In `src/ontocurator/packages/writer.py`:
- Write `format_version = "ontocurator-work-package/v1"`, include `axes_config`, and output `term_id`.

- [ ] **Step 4: Run package tests**
Run: `uv run pytest tests/test_packages.py -v`
Expected: PASS

- [ ] **Step 5: Commit changes**
```bash
git add src/ontocurator/packages/ src/ontocurator/application/workspaces.py docs/work-package-v1.md tests/test_packages.py
git commit -m "feat: support configurable axes and ontocurator-work-package/v1 in package services"
```

---

### Task 5: Frontend UI Branding, Dynamic Axes, OpenAPI Contracts & Asset Build

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/editor/AnnotationPanel.tsx`
- Modify: `frontend/src/app/CaseScreen.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `contracts/openapi.json`
- Output: `src/ontocurator/web/assets/`
- Test: `npm run check`, `npm run build`

**Interfaces:**
- Consumes: `WorkspaceView.axes_config`, FastAPI OpenAPI schema
- Produces: Dynamic React UI rendering dropdowns driven by `axes_config`, neutral terminology

- [ ] **Step 1: Regenerate OpenAPI contract**
Run command to export fresh `contracts/openapi.json` from `ontocurator.api.app:create_app`.
Update TypeScript types with `npm run api:generate` (or verify types).

- [ ] **Step 2: Implement dynamic axes rendering in `AnnotationPanel.tsx`**
In `frontend/src/editor/AnnotationPanel.tsx`:
- Receive `axesConfig: AxisDefinition[]` via props.
- If `axesConfig.length === 0`, do not render the axes section.
- If `axesConfig.length > 0`, dynamically map over each axis and render labeled `<select>` dropdowns updating `axes.values[axis.id]`.

- [ ] **Step 3: Update frontend labels and branding**
- Header: Replace "HPO Annotations-Editor" with "Ontocurator".
- Subtitle: "Lokale ärztliche Ontologie-Annotation & Origin-neutrales Review".
- Modals & Forms: Replace "HPO Term" with "Ontologie-Term / Konzept", "hpo_id" references with "term_id".

- [ ] **Step 4: Build frontend assets**
In `frontend/`:
Run: `npm run build`
Copy built `dist/*` files to `src/ontocurator/web/`.

- [ ] **Step 5: Verify static asset loading**
Run: `uv run pytest tests/test_api.py -v`
Expected: PASS

- [ ] **Step 6: Commit changes**
```bash
git add frontend/ contracts/ src/ontocurator/web/
git commit -m "feat: dynamic axes rendering and Ontocurator branding in frontend"
```

---

### Task 6: End-to-End Verification & CLI Roundtrip

**Files:**
- Modify: `README.md`
- Test: All tests across suite `tests/`
- CLI test: `ontocurator serve --help`

- [ ] **Step 1: Run full test suite**
Run: `uv run pytest -v`
Expected: 100% tests passing.

- [ ] **Step 2: Test CLI entrypoint**
Run: `uv run ontocurator --help` and `uv run ontocurator serve --help`
Verify command description, flags, and lack of deprecated HPO-exclusive assumptions.

- [ ] **Step 3: Update README.md**
Update `README.md` to reflect `ontocurator`, showing examples with both `hp.json` and other OBO ontologies (like `mondo.json`).

- [ ] **Step 4: Commit changes**
```bash
git add README.md
git commit -m "docs: update documentation and quickstart for Ontocurator"
```
