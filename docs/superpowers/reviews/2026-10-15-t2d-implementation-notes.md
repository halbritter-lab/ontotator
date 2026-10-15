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
