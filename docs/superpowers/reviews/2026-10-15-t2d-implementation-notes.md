# T2d implementation notes (Tasks 1–3)

Deviations from `docs/superpowers/plans/2026-10-14-t2d-ontologies-exchange-jobs.md` (kept in the
`t2-plan` worktree), decisions the plan left open, and the gate result. Tasks 4–6 follow in a
later batch. Entries marked **[open question]** are user-flow or domain questions; the most
conservative option was taken and should be confirmed.

## Baseline

- Worktree `.worktrees/t2d-ontologies-exchange`, branch `feat/t2d-ontologies-exchange` from
  `feat/t2c-projects-authorization-audit` at `4281372` (the plan named
  `feat/t2c-projects-authorization`). The plan predates the T2b/T2c review fixes; where it
  conflicted with the code, the code was followed (listed below).

## Task 1: the ontospan dependency and the T1 mapping

- **Pin changed by the user:** `ontospan` is pinned to `4105ec1259fc04d927d78258fcf4c99f8f014b6a`
  (merge of PR #2, format 1.1) instead of `263368b` (index D-n). `ontospan.__version__` and
  `SCHEMA_VERSION` are `1.1.0`.
- The dependency is a direct reference in `[project].dependencies`
  (`ontospan @ git+https://github.com/janpower/ontospan.git@<40-hex>`) with hatch's
  `allow-direct-references = true`, not uv's default `[tool.uv.sources]` entry: the wheel metadata
  then names the pinned commit too, not a bare `ontospan`. `uv.lock` resolves the same commit.
- ontospan has no `py.typed` marker; mypy gets `follow_untyped_imports = true` for `ontospan.*`
  (its sources are annotated), so the strict check still sees its types.
- `Pin(sha256, allowed_roots=(), t1_profile="generic")` is a frozen dataclass in `exchange/t1.py`
  (Task 4 builds it from `project_ontologies`). `layers_for` takes the release from the profile's
  `OntologyDefinition` and the sha256 from the pin (Task 4 requires both to agree); a profile
  ontology without a pin is `PIN_MISSING`.
- `document_from_unit` returns `Document` only (the model forbids extra fields); the importer
  reads `unit.document.source_text_sha256` itself. `submission_to_unit` takes an optional
  keyword `source_text_sha256` for the export.
- `ImportedProposals` has a fourth field `dropped_basis`: the number of axis values that arrived
  with `basis: defaulted` (the value is stored, the basis is lost). Task 4's audit key of the same
  name is meant to use it.
- Refusals list the producer's annotation ids, never the URNs: `T1_UNSUPPORTED`
  (`{"annotations": [...]}`, modifiers), `T1_UNKNOWN_LAYER` (`annotations`, `layers`),
  `T1_UNKNOWN_AXIS` (`annotations`, `axes`). Added: `T1_UNKNOWN_AXIS_VALUE` (`annotations`,
  `values`) for a value outside the options of the layer's default type; the unit is refused as a
  whole, consistent with Q11. Checks run in that order, over the whole unit, before anything is
  built.
- Import: evidence segments are bounds-checked against the text (`validate_segments`); the quoted
  segment text is not re-checked here (ontospan's validation does that in the import handler).
  `notes` maps every imported annotation id to its notes (empty list when none).
- Export, review mode: a review submission already contains its confirmed targets and changed
  replacements (`SubmissionService`). Confirmed targets are marked `adopted`, replacements
  `edited`; a confirmed target missing from the submission is taken from `proposals`
  (`TARGET_NOT_FOUND` if neither has it). Both get the reviewer as provenance actor and the
  proposal's reference in `source_refs`: the proposal's id itself if it already is an
  `urn:ontospan:` reference (imported), otherwise `annotation_ref(f"{project}:proposals", id)`.
- Export: `type_id` is not exported (T1 has none; import uses the layer's default type).
  Other snapshots keep their actor and `source_refs` unchanged; unknown methods map to `tool`
  (tool actor) or `manual` (human). Axis values are not checked against the T1 profile here: as
  the plan's Task 5 test expects, `temporality = "future"` fails ontospan's validation when the
  bundle is written.
- Tests: `tests/test_t1_mapping.py` (13 cases: the plan's eight plus axis values outside the
  profile, the pinned layer, a proposal without a URN and the method mapping).

## Task 2: ontology files, pins and per-worker loading (migration 0004 part 1)

- **Deviation: `POST /api/v1/ontologies` is kept until Task 6.** The web UI's ontology and
  translation upload and the Playwright `translations.spec.ts` still use it, and the gate must pass
  after this batch. The route now writes through `OntologyStore` (blob store, `ontology_files`,
  audit `ontology.add` with the logged-in user as actor) and answers as before; the `path` of the
  answer is the blob path. Task 6 removes it together with the frontend upload, as the plan already
  says for the frontend. `OntologyUploadService` is no longer used by the product (only by
  `tests/test_translation_registry.py`); Task 6 can remove it.
- `OntologyStore(db, registry, data_dir)`: the blob store is `db.blobs` (`<data dir>/blobs`);
  translations are placed in `<data dir>/translations`, which the store puts first in
  `registry.translation_dirs` (an uploaded file wins over one of the same name in a configured
  `--translations-dir`). `add_ontology` / `add_translation` return the row plus the service or the
  rebuild result (used by the route); `add` returns the row.
- Adding a known sha256 again inserts nothing and audits nothing. A known translation is placed
  and reloaded again (cheap, keeps the folder right). Bytes already stored as the other kind are
  refused. An ontology without a dominant prefix is stored with prefix `unknown`.
- At start-up the latest upload of a translation file name wins; files in the translations
  folder that the store does not know are left alone (and still found, as before for the ontology
  folder). A missing or unreadable blob is logged and skipped.
- Start-up order in `create_app`: `store.register_all()`, then the configured `ontology_paths`
  (and `--ontology`) are registered and parsed at once (development), then ontologies embedded in
  seed packages are registered only if no file of that sha256 is registered (`has_ontology`
  instead of `get_service`, so it does not defeat lazy loading). The warning about translation
  files without an ontology now also accepts prefixes of stored but not yet loaded ontologies.
- Preloading: the pinned shas are read in `create_app`; the daemon thread `preload-ontologies`
  only parses them (`OntologyRegistry.preload`, which records any exception as a load failure)
  and then sets `app.state.ontologies_ready`.
- `GET /api/v1/ontologies` still calls `load_registered()` "as before", so listing parses every
  stored ontology in that worker. See open risks.
- CLI: `admin ontologies add FILE...` and `admin ontologies list` print
  `<sha256>  <prefix>  <release or ->  <kind>`. The data volume is `ONTOCURATOR_DATA_DIR`
  (default `./data`), as for the other admin commands; `serve --data-dir` must point to the same
  folder. `serve` no longer creates `<data dir>/ontologies`.
- Tests changed: the two tests of the removed `<data dir>/ontologies` scan
  (`test_a_broken_entry_in_the_ontologies_folder_does_not_stop_the_start`,
  `test_an_unreadable_stored_ontology_does_not_stop_the_start`) are deleted; their intent lives on
  in `test_ontology_store.py::test_a_missing_blob_does_not_stop_the_start` and
  `::test_the_list_shows_failures_of_pinned_files`.
  `test_invalid_upload_does_not_overwrite_or_delete_existing_ontology` became
  `test_an_invalid_upload_leaves_the_stored_ontology`; the restart test checks the blob instead of
  the folder; `test_review_findings.py`'s content-addressing test expects the blob path and the
  size-cap test an empty blob store (the route reads the limits from the `uploads` module at call
  time, so the monkeypatch applies). `test_translation_api.py::_folder` writes to
  `<workspace>/translations`. The two failing-start tests in `test_api.py` patch
  `OntologyStore.register_all` instead of `OntologyRegistry.load_registered`.
- The upload route's docstring changed, so `contracts/openapi.json` and
  `frontend/src/api/generated.ts` were regenerated (description only).

## Task 3: jobs (migration 0004 part 2)

- `JobQueue(db, handlers, *, context=None)`; the context defaults to `JobContext(db,
  data_dir=db.data_dir)`. The app builds it with the registry, the store and the data dir and
  keeps it as `app.state.jobs` with an empty handler map; Tasks 4 and 5 register `t1_import`,
  `t1_export` and `edit_log_export` there.
- `enqueue` refuses a kind without handler (`JOB_KIND_UNKNOWN`). `run` records `succeeded` with
  the result or `failed` with `"<ExceptionType>: <message>"`, also when the result cannot be
  stored; it only finishes a job that is still `running` under the same worker name, and returns
  the stored job.
- Grants: the application role gets `SELECT, INSERT, UPDATE` on `jobs` (no `DELETE`; jobs are a
  record of imports and exports).
- The server's worker (`<hostname>:<pid>`, 2 s poll) starts in the lifespan after the runtime
  lease is taken and is stopped (waiting up to 30 s for a running job) before the lease is
  released. An error while claiming or finishing is logged and the loop continues.
- `test_jobs_are_audited_by_their_handlers` is left to Tasks 4 and 5, as the plan says. Added
  tests: a row locked by another worker is skipped, a successful result, an unknown kind and the
  server's worker during the lifespan.

## Notes for Tasks 4–6

- Migration 0004 is unreleased: Task 4 adds `proposal_sets` and the `proposal_annotations`
  columns to the same file, as the plan says, plus their mappings in `storage/tables.py`.
- Use `ImportedProposals.dropped_basis` for the audit's `dropped_basis`, `Pin` for the pins, and
  `app.state.jobs.handlers` (a dict) for the handlers.
- Task 6 removes `POST /api/v1/ontologies` (see Task 2) and may delete `OntologyUploadService`.

## Open questions (user flow or domain logic)

- Imported axis values with `basis: defaulted` are stored as plain values (plan); a later export
  of the adopted proposal marks them `chosen`. Should defaulted values instead be dropped on import,
  so that they stay `defaulted` on export?
- The example HPO task profile offers `experiencer: patient | other` and
  `temporality: current | historical | future`; T1's `hpo-phenotype` profile has
  `patient | family_member | other | unknown` and `current | historical | unknown`. Import refuses
  values the project profile lacks (`T1_UNKNOWN_AXIS_VALUE`), export of `future` fails validation.
  Should project profiles for `hpo-phenotype` layers be aligned with T1's closed lists?
- Adopted and edited annotations in a review export name the reviewer as provenance actor, with
  the proposal in `source_refs`. Confirm (the alternative is to keep the producer as actor).

## Open risks

- `GET /api/v1/ontologies` parses every stored ontology in the worker that answers it (kept "as
  before"); with several large ontologies uploaded this costs memory per worker. T3's admin view
  could list `ontology_files` instead.
- A job whose process dies stays `running`; there is no recovery of stale jobs yet.
- Every start hashes each stored ontology once (`register_path`), a few hundred milliseconds per
  large file and worker.

## Gate

- `bash scripts/check.sh` at `81cc0f7`: all steps green ("All local checks passed.", 504 s).
  Backend 905 passed, 1 skipped (the POSIX-only recovery file permission test on Windows);
  vitest 321 passed in 33 files; Playwright 34 passed. The one pytest warning (Starlette's `httpx`
  test client deprecation) predates T2d. `frontend/node_modules` had to be installed in the new
  worktree first (`npm --prefix frontend ci`).

# Batch B (Tasks 4–6)

Worktree `.worktrees/t2d-ontologies-exchange`, from `36d80f3`. Entries marked
**[open question]** are user-flow or domain questions; the current behaviour was kept.

## Task 4: projects and T1 import

- Migration 0004 gained `proposal_sets` (append-only: triggers, `SELECT, INSERT` only) and the
  `proposal_annotations` columns `proposal_set_id` and `notes`, as planned. The unique key is
  named `uq_proposal_sets_identity` (the convention's name exceeds 63 characters).
- `Repository.create_project(key, name, description, profile, pins)` checks that every profile
  ontology is pinned with the profile's sha256 to a stored ontology file of the same release and
  that nothing else is pinned (`PIN_MISMATCH` with a `differences` list); an existing key is
  `PROJECT_EXISTS`. `ScopedRepository.create_project` needs `CREATE_PROJECT`, audits
  `project.create` for any actor (also `cli:`) and makes a creating user a member with every role.
  `project_pins` returns the `Pin`s; `add_documents_and_proposals` (needs `IMPORT_DOCUMENTS`)
  writes everything in one transaction and calls `on_done` there (the audit).
- New documents get positions after the existing ones, in delivery order.
- **Set kinds (user decision Q33):** `exchange/t1.py: IMPORTABLE_SET_KINDS` is the one place
  that decides: a kind with its rule (`tool_output`: every set actor is a tool). Empty sets of
  any kind create the document only. Any other non-empty set refuses the whole import with
  `T1_SET_KIND` (`units`, `set_kinds`, `accepted`). Implemented here for the CLI/job import; T3a
  can reuse `check_importable` for its upload.
- **Tool provenance (I3):** set actors of kind `tool` need `name` and `version`; an annotation's
  tool actor passes if it has both or names such a set actor by `actor_id` (the usual T1 shape).
- `PIN_MISMATCH` on import compares per layer the ontology id, the version (= release), the
  sha256 if given, the allowed roots (order matters) and also the T1 profile (not in the plan;
  a `generic` bundle for an `hpo-phenotype` pin would be read with other axis rules).
- Order of the checks: format (ontospan, without ontologies; `T1_INVALID` with codes), pins,
  set kinds, tool provenance, the Task 1 mapping (`T1_UNSUPPORTED`, `T1_UNKNOWN_*`), then
  validation against the pinned ontologies (`T1_INVALID`). The mapping comes before the
  ontology validation so that, e.g., a modifier is reported as `T1_UNSUPPORTED`.
- Jobs act for `jobs.requested_by` with that user's rights (an inactive user is refused); a job
  without a user is the CLI operator with system-admin rights (`exchange/jobs.py:
  operator_access`). The `project.import` details also carry `job_id` and `source_sha256`.
- CLI: `admin projects create` (the profile's sha256 is replaced by `--pin` before it is stored);
  `admin import` zips a directory bundle before storing it; with `--no-wait` it only queues.
  If a server worker claims the job first, the CLI waits for its outcome.

## Task 5: T1 export and the edit log

- `Repository.t1_export_content` reads profile, pins, documents, proposals, the latest
  submission per (document, annotator, mode) and the consenting contributors in one snapshot;
  `edit_log` returns the pseudonymised lines. Scoped versions need `EXPORT_ALL_WORK` and
  `EXPORT_EDIT_LOG`.
- "Latest": `latest_submissions` per origin, then the one recorded last (`recorded_at`, then
  draft revision) per (document, annotator, mode).
- A project without submissions fails the export job with `EXPORT_EMPTY` (ontospan refuses an
  empty bundle). A unit that does not validate fails with `T1_INVALID` and the ontospan codes.
- The export result and audit hold `sha256`, `bundle_id`, `units`, `contributors` and the
  counts; the edit-log result `sha256` and `events`. JSONL lines are compact JSON.
- CLI `admin export` / `admin export-edit-log` refuse an existing output file before running
  (`OUTPUT_EXISTS`) and write it exclusively.

## Task 6: retiring the v2 work package

- Removed from the product: `POST /api/v1/packages`, `GET /api/v1/workspaces/{id}/export`,
  `GET /api/v1/packages/{id}/export`, and now also `POST /api/v1/ontologies` (batch A kept it
  until here); `PackageImportService`, `OntologyUploadService`, `application/exports.py`,
  `application/analysis.py`, the CLI `analyze`, `scripts/create_demo_package.py`.
- Moved to `tests/support/`: `v2_reader.py`, `v2_writer.py`, `v2_exports.py` (plus
  `package_export_zip` / `workspace_export_zip`, which write what the removed routes wrote),
  `v2_import.py` (`PackageImportService`), `v2_samples.py` (the sample package helpers that
  other tests imported from the deleted `test_packages.py`) and `ontology_upload.py` (the old
  `OntologyUploadService`, still used by one registry concurrency test).
- `tests/fixtures/demo_package.zip` stays (used by `test_project_modes.py` and `test_api.py`);
  `tests/fixtures/legacy_v1/` is deleted.
- `auth_harness.upload_package(client, files=...)` imports as the client's user through the
  scoped repository and answers like the old route (403 `ADMIN_REQUIRED`, 413, 422);
  `add_ontology(app, path)` stores through `OntologyStore`.
- Tests deleted because they only covered removed HTTP behaviour: the two `ADMIN_REQUIRED`
  upload tests and the export cases of the identity tests (`test_auth_api.py`), the workspace
  export filename test and the upload size-cap test (`test_review_findings.py`), the ontology
  JSON upload answer (`test_translation_api.py`), the frontend `ontologyUpload.test.tsx`, the
  upload/import first-run tests and the export describe. The translation API tests now add files
  through the store; assertions on the removed answer text (`message`) are gone, the language
  checks use the store's `languages`.
- Frontend: the package and ontology/translation upload, the missing-ontology prompt, the
  dashboard "Export package (.zip)" button and both case-screen export buttons ("Export (.zip)"
  in the header was not in the plan's list but used the removed route) are gone; the guide
  reads "No projects are available to you yet. Ask an administrator to add you to a project."
- Browser server: every scenario project is seeded at start-up (in memory, through the test
  `PackageImportService`, so ontologies are prepared as before). Test users are no longer
  system admins (an admin sees every seeded project); `/__test_user__?projects=` grants every
  role. `/__test_translation__` and `/__test_import__` (T1 bundle into `t1-browser`, job inline)
  are POST routes. `importPackage(page, query, packageId, annotator)` keeps its signature.

## Resolved (2026-10-15, user)

The three open questions of batch A, decided after Tasks 4–6 and implemented as a final commit
(`feat(exchange): keep the basis of axis values and align HPO profiles with T1`):

1. **Basis of axis values is kept.** `Annotation.axes_defaulted` lists the axes whose value was
   defaulted; it enters the snapshot payload and hash only when not empty, so every existing
   version stays valid and no migration is needed (the payload is JSONB). Import stores the T1
   basis (`exchange/t1.py: imported_axis_values`); `Annotation.with_axes` (used by `set_axes`)
   keeps the flag of a value set again unchanged and makes only changed values chosen; export
   writes flagged values as `defaulted` (`_axes`). Adopting or editing a proposal keeps its
   defaults. The app applies no axis defaults while editing today; the only other default is the
   export's for empty HPO axes, already `defaulted`. The audit/result key `dropped_basis` is now
   `defaulted_axes`; `ExportCounts.defaulted_axes` counts every exported defaulted value.
2. **Project profiles are aligned to T1.** `exchange/t1.py: check_t1_profile`, called by
   `Repository.create_project`, refuses with `PROFILE_NOT_T1` (`problems`: layer, axis, the
   values not in T1, or `values: null` for an axis T1 lacks) any `hpo-phenotype` layer whose
   axes are not T1's or whose options are not a subset of T1's closed lists; hiding values is
   allowed. The example profile `profiles/hpo-context-example-v1.json` now offers
   experiencer `patient | family_member | other | unknown` and temporality
   `current | historical | unknown`. Seed packages (v2 test fixtures, no pins) are not checked;
   `STANDARD_CLINICAL_AXES` in `domain/axes.py` still has `future` and is used only by them.
3. **Reviewer as actor stays.** `exchange/t1.py: reviewed_provenance`; the proposal reference in
   `source_refs` is asserted by `test_t1_mapping.py::test_review_decisions_map_to_methods_and_counts`
   and `test_t1_export.py::test_review_submissions_export_adopted_and_edited_annotations`.

## Open questions

- None on user flow. A small one for T3: the import refuses a delivery whose layer `profile`
  differs from the pin's `t1_profile` (see Task 4); confirm when T3 shows pins.

## Gate

- `bash scripts/check.sh` at `eab4dbf` (Tasks 4–6): all steps green ("All local checks
  passed.", 521 s). Backend 907 passed, 1 skipped (POSIX-only); vitest 315 passed in 32 files;
  Playwright 34 passed.
- At `2c3c332` (decisions 1–3) the backend step failed: 3 cases of
  `test_review_validation_regressions.py::test_package_rejects_invalid_annotation_type_and_axes`
  forge versions from `model_dump()`, which then contained `axes_defaulted: []`. Fixed in
  `89f1fa5` (`exclude_if` on the empty list); those tests, `test_t1_mapping.py` and
  `test_domain.py` pass. The full gate was started again at `89f1fa5` but stopped on request
  (budget); its result is not recorded.

## Handoff (2026-10-15)

- **Done:** Tasks 4 (`756b924`), 5 (`b5e5e81`), 6 (`eab4dbf`), user decisions (1)–(3)
  (`2c3c332`, fix `89f1fa5`), this notes file. Nothing is uncommitted; no `wip` commit needed.
- **Remains:** only the confirmation run of the full gate at the head below.
- **Next steps:** `npm --prefix frontend ci` if needed, then `bash scripts/check.sh` in the
  worktree; if green, the branch is ready for review. If the backend step fails, look first at
  tests that compute snapshot versions from `model_dump()` (see Gate).
- **Failing tests known:** none after `89f1fa5` in the targeted runs.
- **Head:** the commit that adds this section (parent `89f1fa5`).
