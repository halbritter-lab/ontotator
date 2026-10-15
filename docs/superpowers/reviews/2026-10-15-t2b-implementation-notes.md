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
- Task 2: `tests/test_schema.py` "must now report `16 passed`" -> it reports `17 passed`, because the
  baseline was 14 (two mapping tests, 3 x 3 append-only cases, three single tests) and `audit_events`
  adds 3 statement cases to the append-only parametrisation, not 2.
- Task 2: the plan named the composite indexes only by their columns -> they are named after the
  `ix_<table>_<columns>` convention (`ix_sessions_user_id_revoked_at`, `ix_login_attempts_username_at`,
  `ix_login_attempts_client_ip_at`, `ix_audit_events_project_id_at`). Foreign keys use the default
  `NO ACTION` (users are deactivated, not deleted), `instance_state.value` is `NOT NULL` like every
  column the table does not mark "null", and `one_time_codes.purpose` has no `CHECK` constraint (the
  plan lists none; the service validates it). `pseudonym_seq` is not mapped in `tables.py`, since
  Alembic does not compare sequences.
- Task 3: the plan only said "never raises" -> `verify_password` also falls back to the dummy hash when
  the stored hash is unusable (any error other than a mismatch), so a broken hash costs the same Argon2
  run as a wrong password; `needs_rehash` returns `True` for an unparseable hash. The dummy hash is
  computed lazily once (`functools.cache`), not at import. `argon2-cffi` resolved to 25.1.0 (with
  `argon2-cffi-bindings`, `cffi`, `pycparser`, all MIT/BSD); `scripts/license_notices.py` derives the
  runtime closure from installed metadata, so neither it, `THIRD_PARTY_NOTICES.md` nor
  `tests/test_license_notices.py` needed a change.
- Task 2 (review fix): the earlier entry left `one_time_codes.purpose` without a constraint -> 0002 and
  `tables.py` now have `CHECK (purpose IN ('setup', 'reset'))` named `ck_one_time_codes_purpose`
  (`tables.py` gained the `ck_%(table_name)s_%(constraint_name)s` convention), because 0002 is not
  released yet. The mapping/migration comparison now also sets `compare_server_default=True`; it passed
  without changes. New tests: `test_the_application_role_draws_pseudonym_numbers` (the app role can
  `nextval('ontocurator.pseudonym_seq')`) and `test_a_one_time_code_is_for_setup_or_reset_only`.
  `tests/test_schema.py` now reports `19 passed`.
- Task 3 (review fix): `assert_policy` matched with `^…$`, so a hash with a trailing newline (as read
  from a secret file) or `m=019456` passed and then never verified -> it uses `fullmatch` and
  `[1-9]\d*` parameters, so both are refused as "not an Argon2id (v=19) PHC string".
- Task 3 (review fix): the plan set only lower bounds for a supplied hash -> it also has caps
  (`MAX_MEMORY_COST = 262_144` KiB, `MAX_TIME_COST = 10`, `MAX_PARALLELISM = 8`, refused with "at
  most"), because a supplied `m=4194304` would allocate 4 GiB per login. After the bounds,
  `assert_policy` verifies the empty password against the hash: a mismatch proves Argon2 decodes it;
  any other error becomes `PasswordRuleError("… cannot be decoded …")`.
- Task 3 (review fix): passwords UTF-8 cannot encode (a lone surrogate) -> `check_password_rules`
  refuses them ("not valid Unicode text"), and hashing and verification encode with `surrogatepass`,
  so `hash_password` never raises `UnicodeEncodeError` and a login with such a password still runs
  Argon2 exactly once. This replaces the earlier concern that such a password returned before Argon2 ran.
- Task 3 (review fix, technical decision): passwords are compared in Unicode NFC -> `hash_password`,
  `verify_password` and `check_password_rules` normalise to NFC first; lengths count characters after
  NFC, and the username comparison normalises the username as well. A composed and a decomposed
  spelling (for example of `é`) are the same password, because keyboards and operating systems differ in
  which they produce.
- Task 3 (review fix): the earlier entry computed the dummy hash lazily -> it is computed at import
  (`_DUMMY_HASH`), so the first unknown-user login costs one Argon2 run like the others. A test counts
  completed Argon2 runs (patched `verify_secret`) for a wrong password, `None`, broken, non-ASCII and
  undecodable hashes and surrogate passwords: always exactly one. `tests/test_passwords.py` now reports
  `26 passed` (adds `needs_rehash` and eight supplied-hash policy cases).
- Task 4: `_issue_code` "deletes the unused codes of the same user and purpose" -> it deletes all unused
  codes of the user, whatever their purpose, because the plan's own test
  (`test_a_reset_code_lives_fifteen_minutes_and_replaces_older_codes`) expects a reset code to end an
  unused setup code; a user has at most one usable code.
- Task 4: the advisory lock id helper `_lock_id` lived in `storage/repository.py` -> it moved to
  `storage/database.py` as `advisory_lock_id` (the repository keeps `_lock_id` as an alias), so
  `bootstrap_admin` can take `pg_advisory_xact_lock` without importing the repository.
- Task 4/5: `accounts.py` imports `revoke_user_sessions` and `token_digest` from `sessions.py`, and
  `sessions.py` imports `normalize_username` inside `_attempt_name`, because the two modules need each
  other and a top-level import both ways is circular.
- Task 4 (technical): every account change locks the user row (`FOR UPDATE`) first; `redeem_code` then
  locks the code row, so a code redeemed twice at once sets the password once. `create_user` checks the
  name and inserts with `ON CONFLICT DO NOTHING`, so a concurrent creation of the same name gives
  `USERNAME_TAKEN`, not an integrity error. Two extra tests cover both races
  (`test_a_code_redeemed_twice_at_once_sets_the_password_once`,
  `test_one_username_created_twice_at_once_is_taken_once`), so `tests/test_accounts.py` reports
  `18 passed` and both files `28 passed`.
- Task 4 (technical): all timestamps (`created_at`, `updated_at`, `changed_at`, `used_at`,
  `expires_at`, sessions, attempts and `audit_events.at`) come from the injected `now`, so
  `record_audit` gained an optional `at` argument; without it the database clock applies.
- Task 4: unspecified error codes -> `USER_NOT_FOUND` (reset code, admin flag, activation of an unknown
  user), `DISPLAY_NAME_INVALID` (empty display name) and `PSEUDONYM_TAKEN` (a given pseudonym already in
  use). A generated pseudonym skips numbers an admin already assigned by hand. `Actor.user(id, username)`
  gives the label `user:<username>`, used for `user.password_set` (details `{purpose}`).
  `audit_events.target_id` is the username, since usernames never change.
- Task 4 **[user-flow choice]**: `set_system_admin`/`set_active` with the value the user already has
  change nothing: no generation bump, no revoked sessions, no audit row.
- Task 4 **[user-flow choice]**: `bootstrap_admin` with an existing user `admin` (created by the CLI
  before the first start) makes it an active system admin and sets its password instead of failing.
- Task 4: `AccessDenied` (403) and `LoginFailed` (401) are defined in `domain/errors.py`; their HTTP
  handlers are left to Task 6, because `errors.py` has no status mapping (`api/app.py` has the handlers).
- Task 5 (technical): a failure is counted when it lies in `[now - window, now]`; an attempt while
  locked is itself recorded as a failure, so continued attempts keep the lock (as the plan's
  `succeeded = matches and not locked and user exists` implies). Attempts are not serialised per
  account, so concurrent logins may exceed the limit by the number in flight. An invalid username is
  recorded lower-cased and cut to 128 characters; a user agent is cut to 512.
- Task 5 (review fix): `login` read the user without a lock, so a password change committed while
  Argon2 ran found no session to revoke and the session inserted afterwards survived -> `login` locks
  the user row `FOR NO KEY UPDATE` before it reads the credential, counts attempts and verifies. A
  password change (`FOR UPDATE` on the user) now waits for such a login and revokes its session. This
  also serialises the logins of one account (the per-account limit can no longer be exceeded by
  parallel attempts; the address limit still can, since unknown names lock nothing) and gives a
  rehashing login and `redeem_code` the same lock order (user, then credential). Test:
  `test_a_login_during_a_password_change_leaves_no_old_session` (Argon2 held open while the redeem
  runs). This replaces the earlier note that attempts are not serialised per account.
- Task 5 (review fix): attempts refused because of a lock counted as failures and extended the lock
  indefinitely, against Q8 ("for the rest of that window") -> `login_attempts` has a new column
  `throttled boolean NOT NULL DEFAULT false` (in 0002, which is unreleased, and `tables.py`), set on
  every attempt made while the account or the address is locked; the lockout counts only
  `succeeded = false AND throttled = false`. The lock thus ends with the window of the failures that
  caused it. Test: `test_attempts_while_locked_do_not_extend_the_lock`. This replaces the earlier note
  that attempts while locked keep the lock.
- Task 5 (review fix): `login` refuses to run inside an open transaction of its context
  (`RuntimeError`, via the new `Database.in_transaction()`), because an outer rollback would erase the
  attempt row and with it the lockout.
- Task 3/5 (review fix): `needs_rehash` used argon2's `check_needs_rehash`, which is true for any other
  parameters -> it is true only for a hash weaker than ours (m, t, p, hash or salt length lower), of
  another type or version, or unparseable, because the first login of a bootstrapped or recovered admin
  would otherwise replace a stronger supplied hash with a cheaper one. `tests/test_passwords.py`
  (`test_only_weaker_or_unusable_hashes_need_a_rehash`) and two login tests cover both directions.
- Task 4/5 (review fix): the function-level import is gone -> `token_digest` and `revoke_user_sessions`
  live in the dependency-free `auth/tokens.py`; `sessions.py` re-exports `revoke_user_sessions` (the
  plan's interface) and imports `normalize_username` from `accounts.py` at the top. This replaces the
  earlier circular-import note.
- Tasks 4/5 (review fix): new tests for a code refused after a generation bump, the code of an inactive
  user, the correct password while locked, the 60 s `last_seen_at` throttle, both rehash directions,
  the lost-session race and the refused ambient transaction. Counts: `tests/test_accounts.py` 20,
  `tests/test_sessions.py` 17, `tests/test_passwords.py` 26, `tests/test_schema.py` 19.
- Task 6: the plan did not say what `/redeem-code` answers when the login after the redemption fails
  -> it answers the normal 401 `LOGIN_FAILED` of `/login` (for example while the account or the
  address is locked); the password is set anyway and the code is used, so the person logs in on
  the login page later, because the redemption commits before the login runs (a login cannot join
  an open transaction).
- Task 6: the acceptance grep "prints nothing" -> it still matches the embedded bundle
  `src/ontocurator/web/assets/index-*.js` (built from the frontend that still sends `Authorization:
  Bearer`) and binary `__pycache__` files; `grep -rnIE … src tests --exclude-dir=web` prints nothing.
  The bundle cannot be rebuilt before the frontend changes of Task 8; Task 9 rebuilds it.
- Task 6: `canonical_origin` "http(s), host, no path" -> it also accepts a lone trailing `/`,
  lower-cases scheme and host and drops the default port (`HTTPS://Editor.Example:443/` ->
  `https://editor.example`), so the value equals the `Origin` header a browser sends. `AppConfig`
  validates `public_origin` with it as well, so `create_app` cannot get a non-canonical origin;
  `serve` checks it first and exits 1 with the `SettingsError`. New tests: 12 cases in
  `tests/test_settings.py`, `test_serve_refuses_a_public_origin_with_a_path` in `tests/test_cli.py`
  (whose help test now also expects `--public-origin`).
- Task 6: `AccessDenied("IDENTITY_MISMATCH")` / `ADMIN_REQUIRED` without details -> both carry a
  sentence in `details` ("You can only work under your own pseudonym.", "Only a system administrator
  may do this."), so the 403 body is `{code, details}` like every other domain error.
  `own_annotator` compares the requested ID exactly (no trimming); a padded own pseudonym is refused.
- Task 6: `UserPreferencesStore.update` "does a `SELECT … FOR UPDATE` and then an upsert" -> it
  inserts an empty row if missing (`ON CONFLICT DO NOTHING`), then locks it with `SELECT … FOR
  UPDATE`, merges and updates, because a row that does not exist yet cannot be locked and two first
  updates would otherwise overwrite each other. Stored JSON is read tolerantly as the file store did
  (unknown keys and invalid entries are skipped and dropped by the next update); this has no own test
  any more, since the six planned preference tests replace the file-store tests.
- Task 6: "keep only the models" -> `Preferences`/`PreferencesUpdate` are unchanged, including
  `last_annotator_id`, because the frontend still reads and writes it until Task 8; `_clean_languages`
  became public (`clean_languages`) for the database store.
- Task 6: the converted `test_api_regressions.py::test_origin_must_match_bound_host_and_port` sent a
  foreign `Origin` on a GET -> it sends it on a write (`PUT /preferences`) and expects 403
  `CROSS_SITE_REQUEST`, because the plan's middleware checks origins on writes only (reads are
  covered by `SameSite=Lax`); a same-origin write still gives 200.
- Task 6: `AutoLoginClient` details the plan left open -> an annotator value that
  `normalize_annotator_id` refuses is skipped (the next rule applies), so a request meant to fail
  validation does not crash the harness; `ensure_user` keeps an existing user (a restarted app on the
  same database logs in again); the display name is the pseudonym (or the username); the session
  cookie is dropped before each harness login. Harness users log in once per annotator switch; the
  suite did not slow down noticeably. Every annotator ID used through the API is a valid pseudonym
  (including `dr. Müller/1`); the invalid ones (`"   "`, a zero-width space, `"  JPL "`) occur only
  in `tests/test_distribution.py` unit tests of the settings parser, which do not use the API, so no
  test needed a changed ID.
- Task 6: the conversion script (`%TEMP%/t2b_task6/convert_tests.py`, outside the repo) rewrote 10
  files (43 replacements); `tests/browser_server.py` lost its `session_token` by hand, and the
  `serve` test in `tests/test_cli.py` now expects the plain address and no `#token=`.
- Task 6: README -> the launch paragraph names the login and `ONTOCURATOR_ADMIN_PASSWORD_HASH[_FILE]`,
  the option table lists `--public-origin`, and the three security items about loopback binding,
  DNS rebinding and the bearer token are replaced by sessions, CSRF/origin and own identity. The
  start-up warning for an ignored admin hash points to `ontocurator admin`, which Task 7 adds.
- Task 6: login and redemption bodies are bounded (`username` 256, `password`/`code`/`new_password`
  1024 characters; longer gives 422 `VALIDATION_ERROR`), so an absurd body never reaches Argon2.
  `logout` deletes the cookie with the same attributes it was set with.
- Task 6: `npm --prefix frontend run typecheck` passed with the regenerated `generated.ts` unchanged
  otherwise; no frontend code was touched. The Playwright suite was not run (expected to fail until
  Task 9).
- Task 6 (review fix): a login whose username had a NUL gave a 500 (PostgreSQL cannot store NUL) ->
  `_attempt_name` and the stored user agent replace control characters and lone surrogates with
  U+FFFD instead of dropping them, because dropping could turn invalid input (`ali\0ce`) into a real
  username and log in as `alice`; U+FFFD can never occur in a username, so the answer stays the
  uniform 401 `LOGIN_FAILED` and the attempt is recorded. `/redeem-code` with a NUL in the username or
  the code already gave 422 `CODE_INVALID` (the username is normalised before any query); tests now
  pin both. `token_digest` encodes with `surrogatepass`, so a code with a lone surrogate gets a digest
  that matches nothing.
- Task 6 (review fix): a JSON body with a lone surrogate (`"\ud800"`) gave a 500 on every route,
  because FastAPI's 422 echoes the input and the response could not be encoded -> a
  `RequestValidationError` handler returns FastAPI's usual body `{"detail": [...]}` as ASCII JSON.
  Such a login is therefore a 422 (`string_unicode`), not a 401: it is refused before the route runs
  and is not recorded as an attempt. The body format of request-validation errors is unchanged.
- Task 6 (review fix): `CreateAnnotationCommand.actor_id` came from the client, so a human annotation
  could be attributed to another pseudonym -> `EditorService.apply` refuses `actor_kind == "human"`
  with an `actor_id` other than the workspace key's annotator with `AccessDenied("IDENTITY_MISMATCH")`
  (403). `AccessDenied` is a `DomainError` in `domain/errors.py`, so the application layer raises it
  directly; only `api/app.py` maps it to 403. `None` still means the workspace's annotator, and
  `tool` actors keep any ID. The frontend never sends `actor_id` (it only displays provenance), so the
  UI is unaffected. `test_create_annotation_and_provenance_equivalence[human]` now names the
  workspace's annotator; new test `test_a_human_annotation_cannot_name_another_annotator`.
- Task 6 (review fix): without `public_origin` the Host header was trusted, so a rebound DNS name
  passed the login origin check (and could lock out 127.0.0.1) -> `AppConfig.trusted_hosts:
  tuple[str, ...] | None = None` (lower-cased); when set, the security middleware answers every request
  (any path, before the session check) whose Host name, port ignored, is not in it with 400
  `{code: "HOST_NOT_ALLOWED", details}`. The middleware was chosen over Starlette's
  `TrustedHostMiddleware`, whose 400 is plain text. `serve` sets it: the host of `--public-origin`;
  without it on a loopback `--host` `localhost`, `127.0.0.1` and `::1`; without it on any other
  address it refuses to start (exit 1) and asks for `--public-origin`. Tests and the default config
  keep `None`. `auth_harness.log_in` now sends the client's own base URL as `Origin`, so a client on
  `http://127.0.0.1:8123` logs in (the CLI serve test uses it).
- Task 6 (review fix): `/login` and `/redeem-code` end the session of a valid cookie the request
  carried, after the new login succeeded (a failed login leaves it open), because the new cookie
  replaces it and it would otherwise stay usable until it expires.
- Task 6 (review fix): a start with no admin hash and no user at all logs a warning that nobody can
  log in and names `ONTOCURATOR_ADMIN_PASSWORD_HASH[_FILE]`.
- Task 6 (review fix): new tests close the review's gaps: a write with a valid CSRF token from a
  foreign Origin (403 `CROSS_SITE_REQUEST`); Q4 for the document list and the package export
  (another annotator: 403 for a non-admin, 200 for a system admin and for the annotator); `own_key`
  on workspace export, submission, decision, submit, search and tree (403 `IDENTITY_MISMATCH`);
  ontology upload by a non-admin (403 `ADMIN_REQUIRED`); the logout cookie deletion with `Path=/`;
  the re-login revocation; trusted hosts; the start warning; malformed login and redemption input.
  The identity tests passed without code changes; the binding was already in place.

## Open risks

- Deactivating or demoting the last active system admin is not prevented. Accepted, because the CLI
  `admin users activate`/`set-admin` (Task 7) can undo it with database access.
- `login_attempts` is never pruned; it grows by one row per attempt until a retention job exists.
- `/docs` and `/openapi.json` are public (no session needed); they describe the API but expose no
  data. Upload bodies (`POST /packages`, `POST /ontologies`) are spooled to a temporary file before
  the route's admin check runs, so any logged-in user can make the server receive up to the size
  limit. The `Secure` cookie flag needs `--public-origin https://…`; behind a TLS-terminating proxy
  without it the cookie is sent without `Secure` (the deployment contract is T2e).
