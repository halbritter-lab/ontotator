# Ontotator Generalization Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for sequential implementation, or `superpowers:subagent-driven-development` if that method is explicitly selected. Steps use checkbox syntax. This planning document does not itself start implementation.

**Goal:** Generalize the local editor to `ontotator`, with non-HPO ontologies and configurable axes while preserving historical annotations, reviews, submissions and workspaces.

**Architecture:** Separate immutable, versioned package/storage records from normalized application/API views. Preserve legacy wire representations and hashes; new edits produce explicitly versioned snapshots. Resolve and persist axes profiles per package and retain them through workspace export.

**Tech Stack:** Existing Python 3.11+, FastAPI, Pydantic v2, SQLite, RFC-8785, React, TypeScript, Vite, pytest, Vitest and Playwright stack. Keep locked dependencies except metadata changes needed for the rename.

**Spec:** [Ontotator design](../specs/2026-10-01-ontotator-generalization-design.md).

**Status:** Revised 2026-10-02 following source review of baseline `94a31a9`. Planning only; no implementation or application-test success is claimed.

## Global Constraints

- Distribution, Python namespace and CLI become `ontotator`. The checkout directory and remote repository are not moved or renamed by this plan.
- Public annotation, command and search DTOs use `term_id`. Legacy `hpo_id` input remains accepted; conflicting aliases fail validation. Historical wire records retain their original vocabulary.
- Import accepts `hpo-editor-work-package/v1` and `ontotator-work-package/v1`. New exports use the latter and may contain legacy snapshots.
- One pinned OBO Graph JSON ontology per server/package; no downloads, remote services or multi-ontology registry.
- Preserve immutable text, codepoint offsets, origin-neutral review, independent-mode isolation, revision checks and idempotent mutations.
- Unknown clinical context remains unknown; no clinical values are inferred from ontology or provenance.
- Runtime remains one loopback Python service with bundled assets; Node.js is only a build dependency.
- Tests use synthetic fixtures, never existing user databases or archives.
- This revision changes planning documents only. Future implementation commits are scoped to their tasks; no publication is included.

## Review Focus

1. Legacy ZIP with completed review and replacement versions: preserve historical hashes and all references through export/reimport (Tasks 1, 3, 4).
2. Schema-v2 DB with drafts and receipts: upgrade, restart and original-request retry preserve identity and exactly-once behavior (Task 4).
3. Custom or empty axes: enforce values server-side and preserve profile through restart/export; `[]` is not missing configuration (Tasks 3–5, 7).
4. Non-HPO numeric IDs and mixed prefixes: deterministic resolution without assuming seven digits or guessing ambiguous identities (Task 6).
5. Installed wheel: CLI, generated API and bundled assets work without source checkout or Node.js (Tasks 2, 7).

## Source findings

- `annotation_snapshots` stores `payload_json`; there is no `annotations.hpo_id` SQL column. Submissions and mutation responses also embed serialized annotations.
- Snapshot verification currently hashes `annotation.model_dump()`. Changing that output with aliases invalidates historical hashes.
- `ExportService.for_workspace` constructs a fresh manifest without propagating axes metadata.
- Rename coverage must include both build/export scripts, Hatch/mypy configuration, lockfiles, test launchers and CI.
- Vite build does not typecheck. Existing scripts are `typecheck`, `api:check`, `test`, `test:e2e`; `npm run check` does not exist.

## Shared contracts

### Immutable records and public views

Add `domain/serialization.py` with `decode_snapshot(raw: dict) -> AnnotationSnapshot`, `encode_snapshot(snapshot: AnnotationSnapshot) -> dict`, and `verify_snapshot(snapshot: AnnotationSnapshot) -> None`. Packages, repository reads/writes, collision comparisons, submissions and receipts must use version-aware encoding, including nested snapshots.

- A snapshot without `schema_version` is legacy. Keep its validated original annotation representation, including `hpo_id`, legacy axes, explicit nulls and `editor-axes/v1`. Use the existing hash algorithm unchanged. Expose normalized values separately; merely reading, presenting or exporting never rewrites historical content. Unknown extra fields still fail validation.
- New snapshots carry `schema_version: "ontotator-annotation/v2"` and `axes_config_sha256`. Hash these fields plus `annotation`, `document_id`, sorted `evidence`, `ontology_sha256` and `text_sha256`; exclude `version`. New annotation wire data uses `term_id` and `{definition_name, values}`. Reject unknown snapshot schemas.
- Preserve old versions, target-set hashes, decisions, submission content, original manifests and receipt request hashes. Editing a legacy snapshot produces a v2 version through existing copy-on-write behavior. No mutable setters on historical snapshots.
- API DTOs expose normalized snapshots with the original identity and explicit schema designation (`legacy/v1` for old records). These are views, not archive records; browsers do not rehash them. Centralize conversion in new `api/schemas.py` for review-input, workspace, mutation, submission and search responses. Archive exports use wire codecs.
- Legacy search records preserve `selected_hpo_id`; new records use `selected_term_id`. Public search candidates/status use `term_id`. Conflicting aliases fail instead of silently preferring one.
- Receipt comparison uses the original received envelope before command alias normalization. Replaying a historical response decodes it into the current public view without executing a write. Reusing an ID with a differently encoded request remains a conflict.
- Preserve original legacy manifest serialization for identity/provenance. Adding optional model fields must not change its canonical hash. New exports get new package identities and retain the actual source manifest hash.

### Axes profiles

- `AxisDefinition(id: str, label: str, options: list[str], allow_empty: bool = True)`.
- `AxesConfig(definition_name: str, axes: list[AxisDefinition])`.
- `Axes(definition_name: str, values: dict[str, str | None])`.
- `validate_axes(axes: Axes, config: AxesConfig, *, complete: bool) -> None`.

Accept built-ins `editor-axes/v1` and `clinical-phenotype/v1` as distinct names with the same options: assertion `present|absent|uncertain`, experiencer `patient|other`, temporality `current|historical|future`. Never silently rename a historical definition.

Validation rejects unknown keys, invalid values, profile mismatch, duplicate/empty axis IDs and duplicate/empty options. Missing/null means unknown; empty string is not an unknown encoding. Drafts allow incomplete required axes; confirmation, replacement approval and submission enforce `allow_empty=False`. Rejecting or marking an input uncertain does not require completing that input. Built-in clinical profiles allow unknown values.

For new snapshots normalize missing configured keys to null. Preserve null/absence distinctions in legacy wire data. Profile hash covers definition name, labels, ordered axes/options and `allow_empty`; dictionary key order uses RFC-8785.

Manifest fields are `axes_definition`, optional `axes_config: list[AxisDefinition] | None`, and for new-format manifests `axes_config_sha256`. Every v2 snapshot matches that digest. Legacy snapshots can only use their original built-in clinical profile, not be reinterpreted under custom axes.

Resolution precedence: explicit manifest config (including `[]`), then known built-in, then matching CLI fallback, otherwise reject with a missing-profile error. Reject conflicting redefinitions of built-in names. `ontotator serve --axes-config PATH` reads one JSON `AxesConfig`; it never overrides explicit/built-in profiles. Malformed input fails before serving.

Persist resolved profiles separately from the immutable source manifest. Reopen using persisted config without the CLI file; conflicting resolution for an existing package fails. New exports include the full resolved profile and digest.

## Task 1: Freeze compatibility fixtures before changing models

**Files:** Create `tests/fixtures/legacy_v1/{review.zip,workspace-v2.sqlite,expected.json,README.md}` and `tests/test_compatibility.py`.
**Interface:** Frozen synthetic baseline artifacts; subsequent tests never regenerate them using generalized models.

- [ ] Generate a legacy package containing shared evidence, null axes, historical/current annotation versions, replacement review and a completed submission. Generate a schema-v2 DB with independent/review drafts and edit/submission receipts; capture original retry envelopes.
- [ ] Record fixture generation procedure, source commit, file digests, expected snapshot versions, target-set IDs, submission content, original manifest hashes, draft revisions and receipt request hashes.
- [ ] Add `test_frozen_legacy_package` and `test_frozen_v2_workspace` checking all recorded identities. Copy the DB into `tmp_path` before opening it.
- [ ] Run `uv run pytest tests/test_compatibility.py -q`; expect PASS on the baseline. This is characterization, not a failing behavior-change test.
- [ ] Commit as `test: freeze legacy archive and workspace compatibility fixtures`.

## Task 2: Rename package and complete build-tool coverage

**Files:** Move `src/hpo_editor/` to `src/ontotator/`; modify `pyproject.toml`, `uv.lock`, imports under `src/`, `tests/`, `scripts/export_openapi.py`, `scripts/build_release.py`, `.github/workflows/ci.yml`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/index.html`, `README.md`, `tests/test_release.py`; create `tests/test_cli.py`.
**Interface:** `import ontotator`, `ontotator --help`, `ontotator serve --help`; installed assets/migrations under the new namespace.

- [ ] Add failing CLI/import and wheel-member tests for new names. Run `uv run pytest tests/test_cli.py tests/test_release.py -q`; verify failures stem from old names.
- [ ] Rename namespace, distribution, CLI, Hatch package path and mypy package configuration. Update release `WEB_DIR`, required wheel members, asset prefixes and OpenAPI exporter import. Inspect `rg -n 'hpo_editor|hpo-editor' pyproject.toml scripts src tests frontend .github`; retain only documented legacy contracts/fixtures and attribution.
- [ ] Refresh lockfile metadata without unrelated upgrades; update help/docs and test launchers. Do not add an old Python-package shim: compatibility covers data and legacy input fields.
- [ ] Run `uv sync --locked`, both new CLI help commands, `uv run python scripts/export_openapi.py`, targeted tests and `uv run python scripts/build_release.py`. Confirm old source/asset paths are not recreated.
- [ ] Commit as `refactor: rename editor namespace and build tooling to ontotator`.

## Task 3: Versioned codecs and validated domain axes

**Files:** `src/ontotator/domain/{annotations,axes,serialization}.py`, `src/ontotator/packages/models.py`, `tests/{test_domain,test_domain_regressions,test_compatibility}.py`; create `tests/test_axes.py`.
**Interface:** Shared serialization/profile contracts above; snapshot creation accepts the resolved profile. Until Task 5 updates callers, default only to the existing built-in profile.

- [ ] Add failing tests `test_legacy_snapshot_wire_and_hash_unchanged`, `test_new_snapshot_binds_profile_digest`, `test_mixed_history_keeps_target_identity`, `test_conflicting_term_aliases_rejected`, `test_unknown_snapshot_schema_rejected`. Tampering with term, axes value or profile digest must fail verification.
- [ ] Add axes tests for custom `severity=severe`, empty configuration, null legacy values, invalid keys/options, duplicate definitions, profile mismatch and required-value completion. Assert incomplete drafts pass but incomplete required values with `complete=True` fail.
- [ ] Run `uv run pytest tests/test_domain.py tests/test_domain_regressions.py tests/test_axes.py tests/test_compatibility.py -q`; confirm expected missing-behavior failures.
- [ ] Implement strict codecs preserving validated historical wire records separately from normalized application data. New snapshots emit v2 and bind the profile digest. Update snapshot call sites needed to keep existing tests meaningful; do not rewrite fixture expectations.
- [ ] Implement `term_id` with legacy input normalization and alias-conflict checks. Read-only `.hpo_id` may temporarily bridge callers. Supported CURIE syntax is `^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`; index membership determines whether a syntactically valid term is known.
- [ ] Re-run focused tests; expect PASS. Commit as `feat: add versioned annotation serialization and validated axes profiles`.

## Task 4: Additive DB migration and compatible package histories

**Files:** `src/ontotator/storage/{database,repository}.py`, new `storage/migrations/003_axes_profiles.sql`, `packages/{models,reader,writer}.py`, `domain/{workspace,serialization}.py`; `tests/{test_storage,test_storage_regressions,test_packages,test_compatibility}.py`.
**Interface:** `Repository.get_axes_config(package_id: str) -> AxesConfig`; atomic package import receives a resolved profile; nested record encoding preserves submissions and receipts.

- [ ] Add failing tests `test_upgrade_v2_preserves_payloads_and_receipts`, `test_legacy_export_reimport_preserves_history`, `test_new_format_mixed_snapshots`, `test_profile_digest_tamper_rejected`, `test_unknown_format_rejected`, `test_migration_failure_rolls_back`. Compare original JSON/identities after upgrade; replay original envelopes with no duplicate effects.
- [ ] Run focused storage/package/compatibility tests; identify missing codec/migration failures.
- [ ] Add schema v3 table `package_axes_profiles(package_id PRIMARY KEY REFERENCES packages(package_id), profile_json NOT NULL, profile_sha256 NOT NULL)`. Backfill built-ins from stored manifests transactionally; mark migration applied only on success. Unknown/unresolvable profiles fail without modifying the database. Do not rename nonexistent columns or rewrite historical payloads.
- [ ] Cover fresh creation, v1→v2→v3, v2→v3, restart, failed migration/retry and rejection of newer DB versions. Route all snapshot/submission/receipt reads, writes and collision comparisons through codecs. Preserve historical request hashes.
- [ ] Reader verifies archive file hashes before decoding; validates each snapshot using its schema. Accept both package formats, reject v2 snapshots in legacy-format archives, unknown schemas, unresolved references and profile mismatch. Writer emits new format with mixed historical/new snapshots, preserving nested submissions; only new outer manifest/file hashes change.
- [ ] Run `uv run pytest tests/test_storage.py tests/test_storage_regressions.py tests/test_packages.py tests/test_compatibility.py -q`; expect PASS, including repeated legacy import without false collisions.
- [ ] Commit as `feat: preserve legacy histories across profile storage and package upgrades`.

## Task 5: Propagate profiles and generic term fields through services/API

**Files:** `src/ontotator/application/{workspaces,editing,reviews,submissions,exports}.py`, `api/{app,routes,schemas}.py`, `config.py`, `cli.py`, `ontology/provenance.py`, `packages/models.py`; `tests/{test_editing,test_reviews,test_api,test_api_regressions,test_cli,test_compatibility}.py`, `docs/work-package-v1.md`.
**Interface:** Workspace views expose `axes_config`, `axes_definition`, `axes_config_sha256`; create/set-term commands use `term_id` with legacy input aliases; `AppConfig.axes_config: AxesConfig | None` carries CLI fallback.

- [ ] Add failing resolution tests: explicit custom/empty profiles, built-in/CLI fallback, missing definition, reserved-name redefinition, conflicting persisted resolution and malformed CLI JSON. Reopening without the CLI file retains saved configuration.
- [ ] Add API tests for new/legacy term commands, alias conflicts, normalized historical views and required-axis checks on confirmation, replacement and submission. Exercise original lost-response retries before/after restart.
- [ ] Add `test_custom_axes_workspace_export_roundtrip`: import→edit→submit→workspace export→restart/reimport retains definition, options, digest, values and versions. Parameterize custom, empty and legacy clinical profiles; independent exports still exclude hidden inputs.
- [ ] Run focused API/edit/review/CLI tests; confirm the new cases fail before implementation.
- [ ] Implement profile resolution and atomic persistence at import; initialize annotations from their package profile. Apply draft and completion validation at defined boundaries. Keep existing obsolete/unknown-term rules and incomplete-review behavior.
- [ ] Implement normalized DTOs consistently across all API response paths and generic command/search fields. Verify receipts before alias normalization. Extend `ExportService` to propagate the persisted axes definition/config/digest and correct source manifest provenance.
- [ ] Implement `--axes-config PATH`; document shape, precedence, legacy encoding and mixed-history exports in `docs/work-package-v1.md`.
- [ ] Run `uv run pytest tests/test_editing.py tests/test_reviews.py tests/test_api.py tests/test_api_regressions.py tests/test_cli.py tests/test_compatibility.py -q`; expect PASS. Commit as `feat: apply package axes profiles across editing review and export`.

## Task 6: Generalize ontology loading and search deterministically

**Files:** `src/ontotator/ontology/{service,provenance}.py`, `vendor/hpo_span_annotator/{hpo,search}.py`; `tests/test_ontology.py`, `tests/fixtures/mondo.json`, `THIRD_PARTY_NOTICES.md`.
**Interface:** Existing `Ontology` and `SearchEngine` become prefix-aware. `validate_term(term_id)` resolves against the loaded index. Retain vendor class names unless a change is necessary.

- [ ] Add failing tests for MONDO full CURIE, `1250`→`MONDO:0001250`, exact label, synonym and lexical search, with HP regressions. Include mixed prefixes, prefix ties, varying numeric widths, alphanumeric IDs and unknown/obsolete terms; assert stable ranking/provenance.
- [ ] Run `uv run pytest tests/test_ontology.py -q`; identify current HP/padding/parser failures.
- [ ] Accept explicit supported CURIEs and OBO-style IRI tails with supported prefix/local-ID characters. Preserve explicit identifier spelling/case; remove unconditional uppercasing. Ignore unsupported external IRIs instead of fabricating IDs.
- [ ] Count loaded terms to detect a unique dominant prefix. Digits-only queries match integer-equivalent numeric local IDs within it; never assume seven digits. Prefix ties or multiple matching IDs return no ID candidate, with UI guidance to use a full CURIE. Explicit CURIE lookup works for every loaded prefix; text routes remain unchanged.
- [ ] Version the normalization policy in `index_identity` and preserve old stored search events. Record vendor changes and preserve licensing.
- [ ] Re-run ontology tests; expect PASS. Commit as `feat: generalize ontology identifiers and numeric search`.

## Task 7: Dynamic frontend and installed-release acceptance

**Files:** `frontend/src/{App.tsx,api/client.ts,api/generated.ts,app/CaseScreen.tsx,editor/AnnotationPanel.tsx,editor/SearchPanel.tsx}`, `frontend/index.html`, `contracts/openapi.json`, `frontend/tests/e2e/`, `frontend/browser/workflow.spec.ts`; `tests/test_release.py`, `.github/workflows/ci.yml`, `scripts/export_openapi.py`, `README.md`, bundled `src/ontotator/web/`.
**Interface:** Browser consumes normalized DTOs and resolved workspace profiles; archive serialization remains server-side.

- [ ] Apply Impeccable before UI implementation. Add component/browser tests for custom and empty axes, legacy null display, clearing to null, required-value errors and a full non-HPO review/export workflow. Assert edits carry the selected profile name rather than a hard-coded clinical name.
- [ ] Run `uv run python scripts/export_openapi.py` and `npm --prefix frontend run api:generate`. Ensure normalized response schemas and generic command/search fields are generated; never hand-edit generated types.
- [ ] Run focused frontend tests and establish expected failures. Render selects from `axes_config`; preserve unknown selection, hide axes for `[]`, and display required status/server errors. Update all term access paths, including review lists and search selection. Header: `Ontotator`; subtitle: `Lokale Ontologie-Annotation und Review`. Explain full-CURIE entry near numeric search.
- [ ] Add exporter `--check` mode comparing live OpenAPI with committed JSON without rewriting. Run it in CI after Python installation; existing `api:check` only checks JSON→TypeScript drift.
- [ ] Use the release script for bundling assets. Update README with HPO/MONDO and CLI-profile examples, upgrade/backup instructions and compatibility semantics. Keep the existing checkout path accurate.
- [ ] Run all final commands below. Install the explicitly selected new wheel into a clean environment outside the checkout. Verify CLI/assets/migrations without Node.js or source imports; perform browser edit/review, restart and export using synthetic MONDO data. Run Windows/Linux backend/build checks and Chromium workflow in CI; inspect desktop/narrow layouts once.
- [ ] Commit as `feat: ship Ontotator UI and verified compatible offline release` after checks pass.

## Final verification and acceptance

All commands run from repository root and must exit zero. `--check` below is added by Task 7.

```text
uv sync --locked
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run ontotator --help
uv run ontotator serve --help
uv run python scripts/export_openapi.py --check
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run api:check
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:e2e
uv run python scripts/build_release.py
git diff --check
```

Install the pinned Playwright runtime before offline tests if absent. Dependency/browser installation may use network; application acceptance after installation must not. Clean-wheel acceptance must use the newly built artifact, not an arbitrary stale file in `dist/`.

| Requirement | Evidence |
|---|---|
| Namespace/CLI/build rename | Task 2 CLI/build tests; Task 7 installed wheel |
| Historical identity preservation | Task 1 frozen fixtures; Tasks 3–4 mixed-history roundtrip |
| Existing workspace upgrade | Task 4 restart, receipt replay and rollback tests |
| Dynamic axes/CLI fallback | Tasks 3/5 validation and precedence; Task 7 browser cases |
| Export preserves profile semantics | Task 5 custom/empty/legacy workspace roundtrip |
| Non-HPO search | Task 6 exact, lexical, numeric and ambiguity cases |
| API/UI consistency | Task 7 live schema drift, typecheck and browser checks |
| Existing editor guarantees | Full regression suite: isolation, Unicode, review and autosave |

## Revision self-review

The fictional column migration is removed. Historical hash preservation, profile validation/persistence/export, CLI fallback, complete rename coverage and release checks now have explicit tasks and tests. Companion-spec corrections align the same contracts. No product code, fixtures or migrations were created during this planning revision. Sequential implementation is recommended because serialization, profiles and API contracts are shared.
