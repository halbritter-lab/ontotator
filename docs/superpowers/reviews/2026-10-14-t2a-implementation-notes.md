# T2a implementation notes

Deviations from `docs/superpowers/plans/2026-10-14-t2a-postgres-storage.md` found while executing it.
Each entry: task, what the plan said, what was done instead, why.

## Baseline (Task 0)

- Worktree from `main` at `50cee7e`. Baseline: 661 backend tests, 323 frontend tests, all passing.
- `docker version --format '{{.Server.Version}}'` prints the literal template in Git Bash on this machine; `docker version` without `--format` shows the server (Docker Desktop 4.95.0, engine 29.8.2).

## Deviations

- Task 4: `test_even_the_schema_owner_cannot_change_history` ran `TRUNCATE annotation_snapshots` -> runs `TRUNCATE annotation_snapshots CASCADE`, because PostgreSQL rejects a plain truncate of a table referenced by `proposal_annotations` with a foreign-key error before the append-only trigger fires; CASCADE reaches the trigger, which still rejects it.
- Task 4: `tests/pg_harness.py` imported `testcontainers.postgres` -> imports `testcontainers.community.postgres` with a fallback to the old path, because testcontainers 4.15 deprecates the old module with a DeprecationWarning.
- Task 4: `tables.py` declared `type_annotation_map = {...}` -> `type_annotation_map: ClassVar[dict[Any, Any]] = {...}`, because ruff RUF012 rejects the unannotated mutable class attribute.
- Task 4: the plan left `tests/test_review_findings.py::test_fresh_schema_contains_ontology_resources_and_no_legacy_migrations` untouched until Task 8 -> its assertion `not (storage/migrations).exists()` now checks that `storage/migrations` holds no `*.sql` files, because the Alembic environment lives in that directory and the full suite must stay green; the legacy SQLite migrations were `*.sql` files there. Task 8 still deletes the test.
