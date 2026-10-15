# T2b implementation notes

Deviations from `docs/superpowers/plans/2026-10-14-t2b-accounts-sessions.md` (kept in the `t2-plan`
worktree) found while executing it, plus decisions the plan left open.
Each entry: task, what the plan said, what was done instead, why.
Entries marked **[user-flow choice]** are user-flow or domain questions the plan and the index did not
answer; the least surprising option was taken and should be confirmed.

## Baseline

- Worktree `.worktrees/t2b-accounts-sessions`, branch `feat/t2b-accounts-sessions` from
  `feat/t2a-postgres-storage` at `6d9e98d`. The full gate was green there (745 backend, 328 frontend
  unit, 36 Playwright tests); it was not rerun before Task 1 to save time and memory.

## Deviations and decisions

- Task 1: the plan deleted `scripts/build_release.py` and `build_common.py` but `scripts/check.sh` ran
  `build_release.py --skip-frontend --skip-npm-ci` as its "release build (wheel contents)" step -> the
  step is now "wheel build (lock and contents)" and runs the new `scripts/check_wheel.py --out-dir
  build/check-wheel`: `uv lock --check`, `uv build --wheel`, then the same required-file check as before
  (`__init__.py`, `cli.py`, migrations `env.py`, `script.py.mako`, `ontocurator/web/index.html`, at
  least one `web/assets/*.js` and `*.css`). The migration list is now read from
  `storage/migrations/versions/`, so Task 2's `0002` is checked without editing the script. The old
  `test_build_release_wheel_check` moved to `tests/test_check_wheel.py`, because the gate keeps its value
  and the acceptance grep forbids `build_release` in `scripts`.
- Task 1: `tests/test_license_notices.py` kept `assert "pyinstaller" not in names` -> asserts
  `"mypy" not in names` instead (still a dev-only package), because the acceptance grep forbids
  `pyinstaller` in `tests`.
- Task 1: "keep `scripts/license_notices.py`" -> kept, but dropped the PyInstaller bootloader paragraph
  from `python-runtime.txt`, because there is no executable any more and the acceptance grep covers
  `scripts`. `THIRD_PARTY_NOTICES.md` says the same now (no platformdirs, no PyInstaller).
- Task 1: embedded web assets were to be rebuilt in Task 9 -> rebuilt now as well
  (`npm --prefix frontend run build`, `src/ontocurator/web/` replaced by `frontend/dist/`), because the
  acceptance grep covers `src` and the stale bundle still contained the provisioning and legacy-config
  calls. Task 9 rebuilds them again.
- Task 1: `tests/test_cli_db.py` was not listed -> its serve test now uses `--data-dir` and patches
  `ontocurator.cli.uvicorn.run`, because `-w`, `--no-browser` and `run_server` are gone.
- Task 1: `tests/conftest.py`: `isolate_test_config` removed entirely; after the legacy line only
  `ONTOCURATOR_CONFIG_PATH` was left, which nothing reads any more.
- Task 1: `application/preferences.py`: besides `LegacyConfigDecision` and the `legacy_config`
  field/methods, the internal `_StoredPreferences` subclass is gone too; it existed only to carry
  `legacy_config`. The store now reads and writes `Preferences` directly.
- Task 1: the plan's `serve` option list leaves out `--axes-config`, `--token`, `--package`,
  `--no-browser`, `--print-url`, `--workspace`, `--import-ontology` and `--provision-dir` -> all dropped
  (`AppConfig.axes_config` stays for tests and the API). `--host` is no longer restricted to loopback
  addresses in the CLI, because `ONTOCURATOR_HOST` is meant for server deployment; until Task 6 the
  security middleware still refuses non-loopback `Host` headers. A missing `--translations-dir` folder
  is refused with exit 1 like a missing `--web-dir`.
- Task 1: `ontocurator-settings.json` was only read from the provisioning folder -> `serve` no longer
  reads it, so `AppConfig.distribution` is always the default (all modes allowed) until T2c deletes
  `distribution_settings.py`. `GET /api/v1/settings` and its tests stay. **[user-flow choice]**: no
  replacement option was added, since T2c replaces the presets with project roles.
- Task 1: `ontology/discovery.py` (`discover_ontologies`) is no longer used by `src` (only by
  `tests/test_ontology_management.py`) -> left in place; `create_app` registers
  `<workspace>/ontologies/*.json` with `register_path` as the plan says, so a non-ontology `.json` there
  is reported as a failed load by `GET /api/v1/ontologies`.
- Task 1: README -> the launch and CLI-option sections describe the new `serve`/`db upgrade`, the
  "Standalone Portable Distribution" and "Preconfigured distribution" sections are removed and the
  `build_release.py` command is replaced by `check_wheel.py`. The SQLite storage/backup prose stays for
  T2e (as in T2a). `.github/workflows/ci.yml` still calls `scripts/build_release.py`; left untouched as
  instructed (no CI, index R2).
- Task 1 (review fix): the plan only said to register `<workspace>/ontologies/*.json` with
  `register_path` -> `create_app` skips entries that are not files and logs a warning for an entry that
  raises `OSError` or `DomainError`, because a folder named `*.json` or an unreadable file aborted the
  start. Tests: `test_a_broken_entry_in_the_ontologies_folder_does_not_stop_the_start` and
  `test_an_unreadable_stored_ontology_does_not_stop_the_start`. The same review also removed the dead
  `.legacy-config-*` CSS and the `--provision-dir` and `--axes-config` mentions in the docs.
  `scripts/check_wheel.py` now fails if it finds no migrations, and `tests/test_check_wheel.py` loads the
  script with `importlib` instead of changing `sys.path`.
