# Local checks

Run the complete required gate before integration:

```bash
bash scripts/check.sh
```

The gate runs its phases one after another. Backend tests run in four pytest-xdist workers that share one PostgreSQL test server; every worker migrates its own template database and every test gets its own copy. Playwright uses three browser workers. Keep other heavy test runs stopped when RAM is limited. Docker must be running for backend and browser checks unless `ONTOTATOR_TEST_PG_URL` points to a disposable test server. Never point it at production.

The PostgreSQL test container runs with `fsync`, `synchronous_commit` and `full_page_writes` switched off. These settings are for throwaway test servers only: a crash loses data. Never copy them to a deployment.

Frontend unit tests default to at most two workers, with a minimum of one, to leave RAM available for other work. A dedicated machine can opt into four:

```bash
CHECK_VITEST_WORKERS=4 bash scripts/check.sh
```

`CHECK_VITEST_WORKERS` must be a positive integer. This bounds frontend unit tests; it does not increase backend or browser concurrency.

Backend and browser concurrency have their own settings:

```bash
CHECK_PYTEST_WORKERS=6 bash scripts/check.sh --only backend   # 0 or 1: serial
CHECK_PLAYWRIGHT_WORKERS=1 bash scripts/check.sh --only browser   # serial, for low RAM
```

`CHECK_PYTEST_WORKERS` defaults to 4 and must be a non-negative integer; 0 or 1 runs pytest serially without xdist. Plain `uv run pytest` stays serial; add `-n 4` for a parallel run. `CHECK_PLAYWRIGHT_WORKERS` defaults to 3 and must be a positive integer; a direct `npx playwright test` also uses three workers unless `--workers=N` or `PLAYWRIGHT_WORKERS=N` says otherwise. Workers run spec files in parallel against the one fixture server. This is safe because no two spec files use the same mutable project: `tests/browser_server.py` seeds one small fixture project per spec that needs it (`browser-fixture-<spec>`), and the other specs build fresh projects through test-only scenario routes. Tests within a file stay serial because some change and restore the settings of their own project. A new spec must follow the same rule: build its own project through a scenario route, or add itself to `FIXTURE_SPECS` in `tests/browser_server.py`; never reuse another spec's project.

Regenerate the user handbook images (`docs/handbook/images/`; without the variable the spec only walks the handbook steps): `HANDBOOK_SHOTS=1 npm --prefix frontend run test:e2e -- browser/handbook-screenshots.spec.ts --workers=1`.

## Inner loop

Use the quick path while iterating; run the full gate (`bash scripts/check.sh`) before merge:

```bash
bash scripts/check.sh --quick                         # changes against main
bash scripts/check.sh --quick --base feat/x           # changes against another ref
bash scripts/check.sh --quick src/ontotator/auth/passwords.py frontend/src/editor/autosave.ts
```

`--quick` runs `scripts/check-affected.sh`. It runs the static checks (Ruff lint/format, mypy, frontend types, OpenAPI/TypeScript/admin error catalog drift) and then only the affected tests. Without paths it uses the files changed since the merge base with the base ref (default `main`, or `CHECK_BASE`) plus uncommitted and untracked files.

- Backend: changed `tests/**/test_*.py`; `tests/test_<module>.py` and `tests/test_<module>_*.py` for a changed `src/ontotator/**/<module>.py`; `tests/test_<name>*.py` for a changed `<name>_routes.py`; test modules naming a changed migration's revision id (`"0019"`); and test modules that import a changed module or test helper. Backend changes without such tests (also `tests/conftest.py` and `tests/pg_harness.py`) are listed; when no backend test runs at all the quick check fails and asks for `--only backend`. Workers: `CHECK_PYTEST_WORKERS`, default 2, never more than the selected files.
- Frontend: `vitest related --run` for changed `frontend/src` and `frontend/tests` files; `CHECK_VITEST_WORKERS` bounds the workers (default 2). Frontend configuration changes ask for `--only frontend`.

The selection follows direct imports only, and it skips the wheel build and Playwright. It is a partial gate and never replaces the full gate. pytest-testmon is not used because it conflicts with pytest-xdist.

## Test speed settings

Outside `tests/test_passwords*`, `tests/test_accounts*`, `tests/test_sessions*` and `tests/test_admin_cli*`, an autouse fixture in `tests/conftest.py` switches the Argon2 hasher of `ontotator.auth.passwords` to t=1, m=8 MiB, p=1. Hashing, verification, `needs_rehash` and the supplied-hash policy switch together, so logins behave as in production without the cost. The parameters exist only in the test suite; production code has no switch for them. The excluded modules keep the production parameters because they test hashing, the hash policy and rehash on login.

Frontend unit tests without DOM access start with `// @vitest-environment node`; all others use jsdom. Add the comment only to tests that use neither DOM, browser storage, `fetch` nor Testing Library.

The default of four pytest-xdist workers stays: with 16 GB RAM and the PostgreSQL container, other work and parallel test runs need the headroom. Raise it per run with `CHECK_PYTEST_WORKERS` on a dedicated machine.

## Focused phases

Use an explicit phase during development to avoid repeating unrelated work:

```bash
bash scripts/check.sh --only static
bash scripts/check.sh --only frontend
bash scripts/check.sh --only backend
bash scripts/check.sh --only browser
bash scripts/check.sh --only containers
```

| Phase | Checks | Prerequisites |
| --- | --- | --- |
| `static` | Ruff lint/format, Python and frontend types, OpenAPI/TypeScript/admin error catalog drift, cheap source/wheel/harness contract tests, lock and wheel contents | uv, npm, installed frontend dependencies |
| `frontend` | All frontend unit/component tests | npm, installed frontend dependencies |
| `backend` | All backend tests, reporting the 20 slowest durations | uv, disposable PostgreSQL |
| `browser` | Frontend build and all Playwright tests | npm, installed frontend dependencies, disposable PostgreSQL |
| `containers` | Container checks and smoke tests | uv, npm, installed frontend dependencies, Docker |

Every `--only` invocation reports a **partial gate**. It does not establish full-gate success, cache results, or resume a previous run. A no-argument run still executes every required phase and alone reports "All local checks passed." Failures print elapsed times for completed steps and the failed step before stopping.

Cheap catalog/source/harness contract checks run before the long backend suite so catalog drift fails early. Backend duration reports help distinguish test execution from expensive fixture setup and cleanup; do not remove database isolation or authentication checks to improve timings.

Container checks remain opt-in for a full run:

```bash
CHECK_CONTAINERS=1 bash scripts/check.sh
CHECK_CONTAINERS=1 CHECK_IMAGE=ontotator:release bash scripts/check.sh
```

`--only containers` runs that phase directly. `CHECK_IMAGE` applies to either form. `bash scripts/check.sh --help` lists the phases without starting tools or services.
