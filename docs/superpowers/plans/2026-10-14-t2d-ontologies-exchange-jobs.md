# T2d: Ontologies, Jobs and T1 Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal:**
- A system admin uploads ontologies, creates projects that pin them, and imports documents and proposals in the shared T1 format.
- Submitted results and the edit log are exported for analysis.
- Long-running imports and exports run as jobs.
- The v2 ZIP work package disappears from the product.

**Architecture:**
- **Ontology files** live in the blob store (D3), with metadata in `ontology_files` (P7). Projects pin them in `project_ontologies`, together with `allowed_roots` and the T1 profile of each pinned ontology.
- **Loading:** each worker process loads the pinned ontologies in a background thread at start-up; any other ontology loads lazily on first use and stays cached.
- **Jobs:** a `jobs` table with a `FOR UPDATE SKIP LOCKED` worker thread per process (P6, index D-l). CLI commands enqueue and run their job inline, so they also work while the server is stopped.
- **T1 exchange:** `exchange/t1.py` maps between Ontotator snapshots and `ontospan` units. Import turns annotation sets into proposals; export writes submissions as `individual` sets in a validated bundle (D5).
- **Edit log:** the export is pseudonymised JSONL (D6).
- **v2 retirement:** the v2 upload and export endpoints, buttons and `analyze` are removed. The v2 reader and writer move into the test suite as round-trip fixtures (index D-f).

**Spec:** `docs/superpowers/specs/2026-10-14-t2-server-foundation-design.md` (P6, P7, D3, D5, D6). T1: `docs/superpowers/specs/2026-10-14-t1-shared-annotation-format-design.md`. Index: `docs/superpowers/plans/2026-10-14-t2-index.md`. Builds on T2c.

**Branch / worktree:** `feat/t2d-ontologies-exchange` from `feat/t2c-projects-authorization`, worktree `.worktrees/t2d-ontologies-exchange`. Baseline: `scripts/check.sh`.

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution.

---

### Task 1: The ontospan dependency and the T1 mapping

**Dependency:** `uv add "ontospan @ git+https://github.com/janpower/ontospan.git@263368b"`. That is the merge commit of PR #1 on `main` (index D-n). It needs read access to the private repository through the local Git credentials. Write the full 40-character hash into `pyproject.toml` (`git -C ../ontospan rev-parse 263368b`), so `uv.lock` and the Docker build resolve the same commit.

**Create** `src/ontotator/exchange/__init__.py` and `src/ontotator/exchange/t1.py`. These are pure functions without database access.

| Function | Contract |
|---|---|
| `document_from_unit(unit: ontospan.AnnotatedDocument) -> Document` | Uses `document.text` (already canonical NFC/LF) and `text_sha256`; keeps `source_text_sha256` for storage |
| `unit_to_proposals(unit, profile: TaskProfile, document: Document, *, bundle_id: str \| None) -> ImportedProposals` | `ImportedProposals(annotations, evidence, notes: dict[annotation_id, list[str]])`. One snapshot per T1 annotation, built with `domain.annotations.snapshot`; see the rules below |
| `submission_to_unit(submission, document, profile, layers: Sequence[ontospan.Layer], proposals: Mapping[(id, version), AnnotationSnapshot], *, set_id: str) -> tuple[ontospan.AnnotatedDocument, ExportCounts]` | The reverse direction, rules below |
| `layers_for(profile, pins) -> list[ontospan.Layer]` | One `Layer` per profile layer: `profile` is the pin's `t1_profile`; `OntologyResource(id=ontology_id, version=release, sha256=sha256)`; the pin's `allowed_roots` |

**Import rules (`unit_to_proposals`):**
- `annotation_id` is `ontospan.annotation_ref(set_id, annotation_id, bundle_id)`, the URN, so ids from several sets and bundles never collide and the producer's ids stay recoverable with `parse_annotation_ref` (T7 O1). `bundle_id` is the manifest's id, or None for a single `.json` unit. Evidence ids are `"<annotation_id>#m<index>"`.
- `provenance.notes` are returned in `notes` (they are not part of the snapshot, so its hash is unchanged).
- `layer_id` must be a profile layer, otherwise `DomainError("T1_UNKNOWN_LAYER")`. `type_id` is the layer's `default_type_id`.
- `axes_values` is `{axis: value.value}`. An axis that the type does not define is `T1_UNKNOWN_AXIS`. `basis` is not stored; the import report counts the dropped values.
- Each mention becomes an `EvidenceMention(segments, cue_segments)`. A `document_level` annotation has no evidence.
- Provenance is `ActorRef(actor_id, kind)`, `method` is the T1 method, and `source_refs` are the T1 `source_refs`.
- **Modifiers** cannot be represented: the whole unit is refused with `DomainError("T1_UNSUPPORTED", {"annotations": [...ids with modifiers]})`.

> **Resolved Q11:** units that Ontotator cannot represent (e.g. modifiers) are refused as a whole; the refusal lists every affected annotation.

**Export rules (`submission_to_unit`):** this is one unit per (document, submission).
- **Set:**
  - `set_kind="individual"`, `stage=<mode>`, `actors=[Actor(pseudonym, "human")]`;
  - `created_at` is the submission's timestamp; a naive value is read as UTC;
  - `blind = (mode == "independent")`;
  - `guideline_ref = None` (a T3 project setting).
- **Annotations:** the submission snapshots. In review mode, add each `confirmed` target from the proposals with `method="adopted"` and `source_refs=[urn of the proposal]`, and each `changed` replacement with `method="edited"`. `rejected` and `uncertain` decisions are left out and counted.
- **Method mapping** to the closed T1 list: `manual`, `adopted`, `edited` and `merged` are kept; any other method of a `tool` actor becomes `tool`; any other method of a human becomes `manual`.
- **Axes (Q13):** a set value becomes `{value, basis: "chosen"}`. An empty value in an `hpo-phenotype` layer becomes `ontospan.default_axes()[axis]` with `basis: "defaulted"`; in a `generic` layer it is left out.
- An annotation without evidence becomes `document_level=True`. Every segment quotes the canonical text (`ontospan.segment(text, start, end)`).
- `ExportCounts` holds `{rejected, uncertain, defaulted_axes}`.

> **Resolved Q12:** per document and annotator, the latest submission of each mode becomes an `individual` set (`stage` = mode, `blind: true` only for `independent`). Consistent with Q3, a review submission exports only the reviewer's own resulting annotations: adopted proposals (`adopted`), changed ones (`edited`) and new ones (`manual`). Rejected and uncertain decisions are left out and counted.

> **Resolved Q13 (technical):** in the HPO profile, an empty axis value becomes the profile default with `basis: defaulted`; a set value is `chosen`; in `generic` layers empty values are left out.

**Tests:** `tests/test_t1_mapping.py`. They use the T1 sketch unit from the spec (`Keine Krampfanfälle …`) and an HPO profile with the three axes.
- `test_a_unit_becomes_proposals_with_urn_ids_and_evidence`: 2 snapshots; the ids start with `urn:ontospan:`; the cue segment is kept; the snapshot versions verify (`verify_snapshot`).
- `test_imported_ids_keep_bundle_set_and_annotation_id` (T7 O1): `parse_annotation_ref(snapshot.annotation_id)` gives the bundle id, the set id and the original annotation id; `notes` holds the provenance notes.
- `test_a_document_level_annotation_has_no_evidence`.
- `test_unknown_layers_and_axes_are_refused` (2 cases).
- `test_modifiers_refuse_the_whole_unit`: the details list the ids.
- `test_a_submission_round_trips_through_t1`: proposals → submission → unit. `ontospan.validate(unit, {"hp": ObographOntology.load(tests/fixtures/hp.json)})` is OK; terms, axes values and segments are equal.
- `test_review_decisions_map_to_methods_and_counts`: confirmed gives `adopted` with `source_refs`; changed gives `edited`; rejected is counted.
- `test_empty_hpo_axes_are_defaulted`: `basis == "defaulted"` with the profile default value.

**Acceptance:** the tests pass; `uv run python -c "import ontospan"` works. Commit: `feat(exchange): T1 mapping between snapshots and ontospan units`.

---

### Task 2: Ontology files, pins and per-worker loading (migration 0004 part 1)

**Create:** `storage/migrations/versions/0004_ontologies_jobs.py` (this task's tables plus `jobs` from Task 3 and `proposal_sets` from Task 4, one migration); `src/ontotator/ontology/store.py`.

| Table | Columns | Keys |
|---|---|---|
| `ontology_files` | `sha256` → stored_files; `kind` text CHECK in ('ontology','translation'); `prefix` text (lower-case dominant prefix, e.g. `hp`); `release` text null; `filename` text; `language` text null; `uploaded_by` → users null; `uploaded_at` default now() | PK sha256; ix (prefix, kind) |
| `project_ontologies` | `project_id` → projects; `ontology_id` text (the profile's id, e.g. `hp`); `sha256` → ontology_files; `allowed_roots` jsonb default '[]'; `t1_profile` text default 'generic' CHECK in ('generic','hpo-phenotype') | PK (project_id, ontology_id) |

Grants: full DML for the application role on both tables.

**`OntologyStore(db, registry, data_dir)`:**
- `add(actor, filename, data) -> OntologyFile`:
  - a `.json` file is parsed with `OntologyService.load` from a temporary file; otherwise `INVALID_ONTOLOGY`;
  - a `.tsv` file must match the translation naming (`parse_translation_name`); otherwise `INVALID_TRANSLATION`;
  - the bytes go to the blob store; the row is inserted; the action is audited (`ontology.add`);
  - an already known sha256 is idempotent.
- `list() -> list[OntologyFile]`.
- `register_all()`, called at start-up:
  - `registry.register_path(blobs.path(sha))` for every ontology file;
  - translation files are materialised as `<data_dir>/translations/<filename>`, copied if missing or different, because the translation loader keys on file names. `<data_dir>/translations` is added to `registry.translation_dirs`.
- `pinned_shas() -> set[str]`: all `project_ontologies.sha256`.

**`api/app.py`:**
- calls `OntologyStore.register_all()` instead of scanning `<data dir>/ontologies` (that scan is removed again);
- no longer calls `registry.load_registered()` for everything; the eager load of config `ontology_paths` stays for development;
- starts a daemon thread `preload-ontologies` that calls `registry.get_service(sha)` for each pinned sha and then sets `app.state.ontologies_ready` (a `threading.Event`);
- records failures with `registry`'s existing failure list;
- `GET /api/v1/ontologies` lists the loaded services and the failures, as before.

The upload route `POST /api/v1/ontologies` is removed; uploads go through the CLI (D5) until T3.

**CLI:**
- `admin ontologies add FILE…` (each file; prints `sha256  prefix  release  kind`);
- `admin ontologies list`.

**Tests:** `tests/test_ontology_store.py`.
- `test_an_ontology_is_stored_once_by_hash` (audit row, blob present, second add idempotent).
- `test_a_translation_needs_its_naming`.
- `test_registered_ontologies_load_lazily`: after `register_all()` the registry has a registered path but no service; `get_service` loads it.
- `test_pinned_ontologies_are_preloaded`: with a project pinning HP, `app.state.ontologies_ready` gets set and the service is loaded.
- `test_translations_are_found_after_a_restart`: a new app on the same database and data directory searches German names.
- `tests/test_admin_cli.py::test_ontologies_add_and_list`.

Move every existing test that uploaded ontologies over HTTP (`tests/test_ontology_management.py`, upload tests in `test_review_findings.py`, `test_translation_api.py`) to `OntologyStore.add`, or to a harness helper `add_ontology(app, path)` that wraps it. Delete assertions about the upload response format.

**Acceptance:** the full suite passes. Commit: `feat(ontology): ontology files on the data volume, project pins and per-worker preloading`.

---

### Task 3: Jobs (migration 0004 part 2)

| Table | Columns | Keys |
|---|---|---|
| `jobs` | `id` bigint identity; `kind` text; `status` text CHECK in ('queued','running','succeeded','failed'); `project_id` → projects null; `requested_by` → users null; `requested_label` text; `payload` jsonb; `result` jsonb null; `error` text null; `created_at` default now(); `started_at` null; `finished_at` null; `worker` text null | PK id; ix (status, id) |

**Create** `src/ontotator/jobs/__init__.py` and `src/ontotator/jobs/queue.py`:
- `@dataclass Job(id, kind, status, project_id, payload, result, error)`.
- `JobQueue(db, handlers: Mapping[str, Callable[[Job, JobContext], dict]])`:
  - `enqueue(kind, payload, *, project_id=None, actor) -> int`;
  - `claim_next(worker) -> Job | None`;
  - `claim(job_id, worker) -> Job | None`, which claims only that queued job;
  - `run(job, worker)`, which calls the handler and marks the job `succeeded` with the result, or `failed` with `error = f"{type}: {message}"`; the handler's exceptions never propagate;
  - `get(job_id)`.
- `JobContext`: the db, the ontology registry and store, the data dir. Handlers use it instead of globals.
- `Worker(queue, name, interval=2.0)`: a daemon thread with `start()` and `stop()`, which loops over `claim_next` and `run`. `api/app.py` starts it in the lifespan and stops it at shutdown.

The claim statement is the contract:

```sql
UPDATE ontotator.jobs SET status = 'running', started_at = now(), worker = :worker
 WHERE id = (SELECT id FROM ontotator.jobs WHERE status = 'queued'
             ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, kind, status, project_id, payload
```

**Tests:** `tests/test_jobs.py`.
- `test_a_job_runs_once_even_with_two_workers`: two threads claim concurrently; exactly one gets the job.
- `test_a_failing_handler_marks_the_job_failed`.
- `test_claim_takes_only_the_named_job`.
- `test_the_worker_thread_runs_queued_jobs`: within 5 s.
- `test_jobs_are_audited_by_their_handlers`: covered in Tasks 4 and 5.

**Acceptance:** the tests pass. Commit: `feat(jobs): job table with a SKIP LOCKED worker per process`.

---

### Task 4: Projects and T1 import

**Repository additions** (scoped in `ScopedRepository`; creating needs `CREATE_PROJECT`, adding documents needs `IMPORT_DOCUMENTS`):
- `create_project(key, name, description, profile: TaskProfile, pins: Mapping[str, Pin]) -> None`:
  - inserts `projects`, using a synthesised `PackageManifest(package_id=key, task_profile=profile, created_at=now)` so existing readers keep working;
  - inserts `project_ontologies`;
  - every profile ontology must be pinned to a known `ontology_files` sha with the same release (`PIN_MISMATCH`).
- `add_documents_and_proposals(key, documents, proposal_sets: Sequence[ImportedSet]) -> ImportCounts`:
  - an existing `document_id` with another `text_sha256` is refused with `DOCUMENT_CONFLICT` (T3 A1);
  - an identical document is skipped;
  - proposals are inserted with the snapshot identity rules of T2a, each with its `proposal_set_id` and `notes`;
  - a set whose `(bundle_id, annotation_set_id, document_id)` already exists is skipped, so a re-import adds nothing.

**Imported sets (T7 O1, O2, I3, I9).** Migration 0004 also creates:

| Table / change | Columns | Keys |
|---|---|---|
| `proposal_sets` (append-only) | `id` bigint identity; `project_id` → projects; `document_id` text; `bundle_id` text null; `manifest_sha256` text null; `annotation_set_id` text; `set_kind` text; `actors` jsonb (the T1 actors with `name`, `version`, `model`, `run_id`); `payload` jsonb (the T1 annotation set as delivered, `model_dump(mode="json")`); `source_sha256` → stored_files (the imported file); `imported_by` → users null; `imported_at` default now(); `job_id` → jobs null | PK id; UNIQUE NULLS NOT DISTINCT (project_id, bundle_id, annotation_set_id, document_id); FK (project_id, document_id) → documents |
| `proposal_annotations` + | `proposal_set_id` bigint null → proposal_sets; `notes` jsonb default '[]' | ix (project_id, proposal_set_id) |

Add `"proposal_sets"` to `APPEND_ONLY_TABLES` (triggers and `SELECT, INSERT` grants as in T2c Task 1). `ImportedSet` is `(document_id, bundle_id, manifest_sha256, annotation_set_id, set_kind, actors, payload, ImportedProposals)`.

- **Empty sets (O2):** a unit whose annotation set has no annotations creates the document only: no `proposal_sets` row and no proposals. The import result counts it under `documents_only`.
- **Tool provenance (I3):** every actor of kind `tool` needs `name` and `version`. Otherwise the whole import is refused with `DomainError("T1_TOOL_PROVENANCE", {"units": [document_id, …]})`, in line with Q11.
- **Bundle identity (I1, I9):** `manifest_sha256` is the SHA-256 of the `manifest.json` bytes as stored in the bundle; a single `.json` unit has neither bundle id nor manifest hash.

**Import handler `t1_import`** (`src/ontotator/exchange/jobs.py`). The payload is `{project, blob_sha256, filename}`.
- The blob is a `.zip` or a directory bundle (`ontospan.read_bundle`) or a single `.json` unit (`load_annotated_document`). The validation uses `ObographOntology.load(blob path)` for each pinned ontology, keyed by `ontology_id`.
- **Pins must match:** for each layer, the ontology id, the version (= release) and the sha256 (if given) must equal the project's pin. The bundle's `allowed_roots` must equal the pin's. Otherwise `PIN_MISMATCH` with the differences listed (T3 A1).
- Every unit becomes a document plus, unless its set is empty, one imported set with its proposals (Task 1 mapping). One transaction for the whole bundle.
- Audits `project.import` with `{bundle_id, manifest_sha256, producers, units, documents_added, documents_skipped, documents_only, sets_added, sets_skipped, proposals, dropped_basis}`. `producers` lists the distinct tool actors as `{name, version, model, run_id}`. The result is the same counts plus `warnings` (ontospan report codes).

**CLI:**
- `admin projects create KEY --name N [--description D] --profile profile.json [--pin hp=<sha>] [--allowed-roots hp=HP:0000118,…] [--t1-profile hp=hpo-phenotype]`:
  - the profile is a `TaskProfile` JSON;
  - `--pin` overrides the profile's sha256 for an ontology id;
  - audits `project.create`.
- `admin import PROJECT PATH [--no-wait]`:
  - stores the file in the blob store and enqueues `t1_import`;
  - by default it runs the job inline (`claim` + `run`) and prints the counts; `--no-wait` prints the job id for the server's worker;
  - exit 1 with the job error if it failed.

**Tests:** `tests/test_t1_import.py`.
- `test_a_bundle_creates_documents_and_proposals`: use `ontospan.write_bundle` in the test to build a 2-unit bundle against `tests/fixtures/hp.json`.
- `test_reimporting_the_same_bundle_adds_nothing`.
- `test_a_changed_text_under_a_known_id_is_refused` (`DOCUMENT_CONFLICT`; nothing written).
- `test_a_bundle_for_another_ontology_release_is_refused` (`PIN_MISMATCH` lists the difference).
- `test_allowed_roots_must_match_the_project`.
- `test_import_is_audited`.
- `test_the_cli_creates_a_project_and_imports` (`CliRunner`, inline job).
- `test_only_leads_and_admins_import`: an annotator gets `NOT_ALLOWED` through `ScopedRepository`.
- `test_an_imported_set_is_recorded_as_delivered` (O1): one `proposal_sets` row per non-empty unit with the bundle id, the manifest hash and the actors; `payload` validates as `ontospan.AnnotationSet` and equals the delivered set; every proposal row points to it.
- `test_an_empty_set_creates_only_the_document` (O2): no `proposal_sets` row, no proposals, `documents_only == 1`.
- `test_tool_actors_need_name_and_version` (I3): a set whose tool actor lacks `version` refuses the whole import with `T1_TOOL_PROVENANCE` naming the unit; nothing is written.
- `test_two_sets_for_one_document_are_kept_apart`: two bundles with a set each for the same document give two `proposal_sets` rows and distinct proposal ids.
- `test_the_import_audit_names_the_bundle` (I1, I9): the `project.import` details hold `bundle_id`, `manifest_sha256` and `producers`.
- `test_the_application_cannot_rewrite_imported_sets`: `UPDATE ontotator.proposal_sets` fails with "permission denied".

`tests/test_schema.py` gains the three append-only cases of `proposal_sets`; update its expected count accordingly.

**Acceptance:** the tests pass. Commit: `feat(exchange): create projects and import T1 bundles as proposals`.

---

### Task 5: T1 export and the edit-log export

**Export handler `t1_export`.** The payload is `{project}`.
- Per document, per annotator and per mode it takes the latest submission (`latest_submissions` per local key).
- `submission_to_unit` builds the units, with `set_id = f"{project}:{annotator}:{mode}:{submission_id}"`.
- It calls `ontospan.write_bundle(target.zip, units, bundle_id=f"{project}-{UTC timestamp}", created_at=now, contributors=…)`. The contributors are only users with `orcid_consent`, given as `Contributor(actor_id=pseudonym, name=display_name, orcid=orcid)` (T1 F10). `write_bundle` validates and raises `ontospan.FormatError` on any error; the job then fails with the issue codes.
- The zip goes to the blob store, plus a `stored_files` row.
- Audits `project.export` with the counts.
- The result is `{sha256, units, counts}`.

**Edit-log handler `edit_log_export`.** The payload is `{project}`. It writes JSONL to the blob store, one line per `edit_events` row in id order:

```json
{"event": 17, "at": "2026-10-14T12:00:05Z", "document_id": "EN100017", "annotator": "ann-0003",
 "mode": "independent", "kind": "edit", "revision_before": 4, "revision_after": 5,
 "command": {...}, "state": {...}, "submission_id": null}
```

There is no `user_id` and no `session_id`; the annotator is the pseudonym (T1 F10, D6). `at` is UTC to the second. The export is audited as `project.edit_log_export`.

> **Resolved Q14 (technical):** pseudonyms instead of user ids, no session ids, exact timestamps in UTC to the second.

**CLI:**
- `admin export PROJECT OUT.zip [--no-wait]`;
- `admin export-edit-log PROJECT OUT.jsonl [--no-wait]`.

Both copy the blob to `OUT` when run inline and refuse to overwrite an existing `OUT`. Permissions (Q5): the CLI runs as the operator, so the export is done by an admin. The policy action `EXPORT_ALL_WORK` / `EXPORT_EDIT_LOG` guards the same operations for T3's UI.

**Tests:** `tests/test_t1_export.py`.
- `test_submissions_export_as_a_valid_bundle`: `read_bundle` with the HP ontology passes; one unit per (document, annotator, mode); `blind` is true for independent.
- `test_review_submissions_export_adopted_and_edited_annotations`.
- `test_only_consenting_contributors_are_named`.
- `test_an_export_that_does_not_fit_the_profile_fails_with_codes`: for example `temporality = "future"` with `hpo-phenotype` makes the job fail with an ontospan code in `error`.
- `test_the_edit_log_is_pseudonymised`: there are no `user_id`/`session_id` keys and annotators are pseudonyms; the lines are in event order.
- `test_exports_are_audited`.
- `test_the_cli_refuses_to_overwrite`.

**Acceptance:** the tests pass. Commit: `feat(exchange): export submissions as T1 bundles and the pseudonymised edit log`.

---

### Task 6: Retire the v2 work package from the product

**Backend:**
- Delete the routes `POST /api/v1/packages`, `GET /api/v1/workspaces/{id}/export` and `GET /api/v1/packages/{id}/export`.
- Delete `application/uploads.PackageImportService`, `application/exports.py` (`ExportService`), `application/analysis.py`, the CLI `analyze` and `scripts/create_demo_package.py`.
- Move `src/ontotator/packages/reader.py` → `tests/support/v2_reader.py` and `src/ontotator/packages/writer.py` → `tests/support/v2_writer.py`. Move `ExportService` → `tests/support/v2_exports.py` and `PackageImportService` → `tests/support/v2_import.py`. Fix the imports with sed (`ontotator.packages.reader` → `support.v2_reader`, and so on).
- `ontotator/packages/models.py` stays: `ValidatedPackage` is the internal seed structure (index D-f), and `SearchEventRecord` is part of the domain.
- Delete these tests: `test_packages.py`, `test_compatibility.py`, `test_demo_fixture.py`, `test_analysis.py`, and `tests/fixtures/demo_package.zip` and `tests/fixtures/legacy_v1/` if nothing else references them (check with grep).
- Convert API tests that uploaded zips: `client.post("/api/v1/packages", files=…)` becomes `upload_package(client, files=…)` from `auth_harness`. That helper reads the zip with `support.v2_reader`, calls `app.state.repo.import_package` and grants the current user all roles. It returns a response-like object with `status_code` and `json()`: 200 `{package_id, manifest}`, or the status and `{code, details}` the old handler mapped (422 for `InvalidPackage`/`DomainError`, 413 for `PayloadTooLarge`).
- Tests that called the removed export routes switch to `support.v2_exports.ExportService` directly, or are deleted if they only tested the HTTP download (list the deletions in the commit message).

**Frontend:**
- Remove the package upload, the ontology/translation upload, the missing-ontology prompt, the "Export package (.zip)" button and the "Download export" button in the case-submitted dialog.
- Remove `uploadPackage`, `uploadOntology`, `downloadExport`, `downloadPackageExport`, `getExportUrl`, `getPackageExportUrl` and `parseContentDispositionFilename`.
- The guide shown without projects reads: "No projects are available to you yet. Ask an administrator to add you to a project."
- Delete `tests/ontologyUpload.test.tsx` and the upload and export tests in `firstRun.test.tsx` and `review-findings.test.tsx` ("uses real buttons for adding ontologies and importing packages", "confirms a successful import…", the export describe).

**Browser:**
- `tests/browser_server.py` seeds every scenario package at start-up through `app.state.repo.import_package` (in memory, no zip), using the existing scenario builders.
- `/__test_user__` takes `projects=<key>[,<key>]` and grants all roles there.
- A test-only route `/__test_translation__?name=hp-de.babelon.tsv` adds a fixture translation through `OntologyStore`.
- `helpers.importPackage(page, query, packageId, annotator)` becomes "log in as `annotator` with membership in `packageId`, select it in `#package-select`"; the signature stays.
- `translations.spec.ts` uses `/__test_translation__` instead of the upload input.
- `workflow.spec.ts`:
  - "first run" now checks the no-projects guide for a user without memberships, then the import of a T1 bundle through the server route `/__test_import__`, which runs the import job inline;
  - the "Download export" assertion is removed.

**Acceptance:**
- `grep -rnE "PackageWriter|read_package|uploadPackage|uploadOntology|downloadExport|/api/v1/packages\"|analyze_package" src frontend/src` prints nothing.
- `scripts/check.sh` passes.
- Rebuild the embedded assets.
- Commit: `refactor: retire the v2 work package from the product; T1 is the exchange format`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| P6: imports and exports as jobs in a `jobs` table, executed in-process, no Redis/Celery | 3, 4, 5 |
| P7: admin uploads ontologies and translations; projects pin by SHA-256; worker loads lazily and caches (pinned ones preloaded for `/readyz`) | 2 |
| D3: files on `/data` by SHA-256, metadata in PostgreSQL | 2, 5 |
| D5: CLI for projects, ontologies, documents; documents and proposals imported in T1; submitted results exported in T1 | 4, 5 |
| D6: edit-log export, pseudonymised JSONL with the T1 pseudonyms | 5 |
| E6 / P1: v2 package format replaced | 6 |
| T1 F10: contributors only with consent; pseudonyms | 5 |
| T3 A1 rules already enforced on import (pins, allowed roots, text collisions) | 4 |
| T7 O1, O2, I1, I3, I9: imported ids and sets kept as delivered, empty sets create documents only, tool provenance required, bundle id and manifest hash audited | 1, 4 |
