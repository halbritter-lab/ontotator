# Local checks

Run the complete required gate before integration:

```bash
bash scripts/check.sh
```

The gate runs its phases one after another. Backend tests run in four pytest-xdist workers that share one PostgreSQL test server; every worker migrates its own template database and every test gets its own copy. Playwright uses one browser worker. Keep other heavy test runs stopped when RAM is limited. Docker must be running for backend and browser checks unless `ONTOCURATOR_TEST_PG_URL` points to a disposable test server. Never point it at production.

The PostgreSQL test container runs with `fsync`, `synchronous_commit` and `full_page_writes` switched off. These settings are for throwaway test servers only: a crash loses data. Never copy them to a deployment.

Frontend unit tests default to at most two workers, with a minimum of one, to leave RAM available for other work. A dedicated machine can opt into four:

```bash
CHECK_VITEST_WORKERS=4 bash scripts/check.sh
```

`CHECK_VITEST_WORKERS` must be a positive integer. This bounds frontend unit tests; it does not increase backend or browser concurrency.

Backend and browser concurrency have their own settings:

```bash
CHECK_PYTEST_WORKERS=6 bash scripts/check.sh --only backend   # 0 or 1: serial
CHECK_PLAYWRIGHT_WORKERS=2 bash scripts/check.sh --only browser
```

`CHECK_PYTEST_WORKERS` defaults to 4 and must be a non-negative integer; 0 or 1 runs pytest serially without xdist. Plain `uv run pytest` stays serial; add `-n 4` for a parallel run. `CHECK_PLAYWRIGHT_WORKERS` defaults to 1 and must be a positive integer. More browser workers run spec files in parallel against the one fixture server; tests within a file stay serial because some specs change and restore the settings of shared seeded projects.

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
CHECK_CONTAINERS=1 CHECK_IMAGE=ontocurator:release bash scripts/check.sh
```

`--only containers` runs that phase directly. `CHECK_IMAGE` applies to either form. `bash scripts/check.sh --help` lists the phases without starting tools or services.
