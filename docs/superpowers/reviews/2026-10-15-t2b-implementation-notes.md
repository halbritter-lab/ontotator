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
- Task 6 (re-review): on a loopback `--host` other than the three names (e.g. `127.0.0.2`) the
  bound address itself was not trusted, so the server refused its own address -> `_trusted_hosts`
  adds the normalised bound address (IPv6 in compressed form) to `localhost`, `127.0.0.1`, `::1`.
  Test: `test_serve_on_another_loopback_address_trusts_that_address`.
- Task 6 (re-review): the `RequestValidationError` handler repeated each error's `input`, which can
  be a password -> it drops `input` like the `ValidationError` handler; the rest of FastAPI's
  `{"detail": [...]}` body is unchanged. Test: `test_a_validation_error_does_not_repeat_the_password`
  (an over-long password), and the surrogate test checks that nothing is echoed.
- Task 6 (re-review): an internationalised host never matched, since browsers send punycode ->
  `settings.ascii_host` lower-cases and IDNA-encodes a non-ASCII name (Python's `idna` codec,
  IDNA 2003); `canonical_origin` and `AppConfig.trusted_hosts` use it, so
  `https://Bücher.Example` becomes `https://xn--bcher-kva.example`. The Host header itself is only
  lower-cased (it arrives in punycode). Tests: a canonical-origin case and
  `test_a_trusted_host_is_matched_by_its_canonical_name` (upper-case Host, `[::1]:8000`, punycode,
  a trusted host configured in Unicode).
- Task 6 (re-review): README -> a reverse proxy must forward the original `Host` header
  (`proxy_set_header Host $host;`), or every request gets 400 `HOST_NOT_ALLOWED`.
- Task 7: `hash-password` "checks the rules" without a username -> `check_password_rules` takes
  `username: str | None` and skips the username comparison for `None`, because an empty username
  would refuse a whitespace-only password as "must differ from the username" (the length rule
  refuses it anyway). On a TTY it prompts twice with `getpass` and refuses a mismatch with
  `PASSWORD_MISMATCH`; otherwise it reads one line and strips only a trailing `\n` or `\r\n`.
- Task 7 **[user-flow choice]**: the plan wrote `'u': active=…, system admin=….` -> the values are
  `yes`/`no`; `users list` writes `inactive` for a deactivated user (`inactive, admin` for an admin)
  and prints nothing when there are no users. Usernames are shown normalised (`Alice` -> `alice`).
- Task 7: unspecified error codes -> `SETTINGS_INVALID` (no or a bad database URL),
  `DATABASE_UNAVAILABLE` (connection failed; psycopg's message, never the URL),
  `DATABASE_NOT_MIGRATED` (with the `ontocurator db upgrade` hint, like `serve`), `SERVICE_RUNNING`
  (the plan's lease message), `PASSWORD_MISMATCH`, `PASSWORD_RULES`, and for the recovery file
  `RECOVERY_INPUT_UNREADABLE`, `RECOVERY_INPUT_NOT_PRIVATE`, `RECOVERY_INPUT_TOO_LARGE` and
  `RECOVERY_INPUT_INVALID` (not a regular file, not UTF-8, not JSON, or not exactly the four string
  fields). These errors name the file, never its content or the hash. The file may start with a
  UTF-8 BOM (Windows editors write one). The private-file check applies on POSIX only; the input is
  checked before the database is opened.
- Task 7 (technical): every admin command opens its own `Database` (pool 2 + 2) and closes it on
  every exit, including errors; it checks the schema revision first. The admin data folder is
  `$ONTOCURATOR_DATA_DIR` or `data` and is not created (the CLI writes no files).
- Task 7 (technical): `RuntimeLease.release()` is idempotent and safe before `acquire()`;
  `acquire()` is a no-op while held. A lease connection whose unlock fails is invalidated instead
  of returned to the pool, since a pooled session would keep the advisory lock. The FastAPI
  lifespan only acquires and releases `app.state.runtime_lease` (set by `create_app`, which keeps
  doing all set-up eagerly, so apps without `with TestClient(app)` behave as before); a failed
  release is logged, and closing the engine ends the session anyway. A server that starts during a
  recovery waits for it to finish. Extra tests (not in the plan's 6): `tests/test_lease.py` (shared
  leases block the exclusive one, release is safe twice, the app holds the lease only inside
  `with TestClient(app)`), and `admin` in the CLI help test.
- Task 7: the plan did not mention the README -> a "User administration" section documents the
  `admin` commands and the offline recovery, since the start-up warning (Task 6) points there.
- Task 7 (review fix): a lost lease session (database restart, idle timeout, dropped connection)
  silently ended the lease, so `recover-admin` could run beside a live server -> the lifespan runs a
  background task that calls `RuntimeLease.check()` every `check_interval` seconds (default
  `CHECK_INTERVAL = 60`, a constructor argument); `check` runs `SELECT 1` on the lease connection
  and, if that fails, logs an error, discards the connection and takes the lease again on a fresh
  one (a failed re-acquire is logged and retried at the next check). The task is cancelled before
  the release at shutdown. A recovery can still slip into the gap of up to one interval between the
  loss and the next check; accepted, since both need the service mostly idle and the window is
  short. The README says a transaction-mode pooler (PgBouncer) must not sit in front of the app.
  Tests: `test_a_lost_lease_connection_is_noticed_and_replaced`,
  `test_the_running_app_takes_a_lost_lease_again` (the session is ended with
  `pg_terminate_backend`; the holders are read from `pg_locks`).
- Task 7 (review fix): acquiring the lease first tries `pg_try_advisory_lock_shared`; if a recovery
  holds it, it logs "Waiting for an offline admin recovery to finish..." (ASCII dots, for Windows
  consoles) and then blocks. The server waits for a running recovery without a timeout; accepted,
  because a recovery holds the lock for milliseconds. Test:
  `test_a_server_start_waits_for_a_running_recovery`.
- Task 7 (review fix): an SQLAlchemy error repeated the statement's parameters (for recovery, the
  new hash) -> `Database` creates its engine with `hide_parameters=True` (server logs too), and the
  admin commands map any `SQLAlchemyError` to `Error: DATABASE_ERROR: <driver class>: <first message
  line>` with exit 1. Tests: `test_a_failed_statement_does_not_show_its_parameters`,
  `test_a_database_error_shows_no_parameters`.
- Task 7 (review fix): the recovery file was checked with `stat` and then opened -> it is opened
  first (`O_NOFOLLOW | O_NONBLOCK` on POSIX, so a symlink is refused and a FIFO does not block;
  plainly on Windows) and the regular-file, permission and size checks use `fstat` of the open
  file; at most 8 KiB + 1 bytes are read.
- Task 7 (review fix): under Git Bash (mintty) `stdin.isatty()` is false, so `hash-password` reads
  the password as a visible line -> documented in the README (`winpty`, PowerShell/`cmd`, or a
  pipe); no code change.
- Task 7 (review fix): new tests `test_recovery_input_is_checked_without_showing_it` (10 cases:
  bad JSON, not UTF-8, not an object, a missing, an extra or a non-text field, too large, not an
  active admin, a weak hash, and a BOM file that is accepted) and
  `test_an_unreachable_database_is_a_short_error`; `tests/test_admin_cli.py` now has 18 tests
  (17 pass and 1 is skipped on Windows), `tests/test_lease.py` 5.
- Task 8: `isSessionExpired(err)` was not defined further -> it is true only for an `AuthError`
  with status 401 and code `NOT_AUTHENTICATED`, so a refused login (`LOGIN_FAILED`) or a 403 is never
  taken for an ended session. A 401 on a download notifies like `request()` and throws that
  `AuthError`; a 403 on a download stays the plain `Export failed (403): ...` error.
- Task 8: `last_annotator_id` (preferences) and `annotator_id` (`GET /settings` presets) -> the
  frontend no longer reads or writes either (no prefill, no write on opening a case); the backend
  models and the contract are unchanged, because backend changes are out of scope for this task.
  Both can go in the backend later (T2c replaces the presets).
- Task 8: `tests/session.ts` -> `testUser` derives the username as `user-<pseudonym>` (lower-cased,
  other characters as `-`) and uses the pseudonym as display name. `dashboard.test.tsx` had no token
  imports or calls to remove. Otherwise the inventory table matched the tests.
- Task 8 (review fix) **[user-flow choice]**: the plan's gate states were checking, anonymous and
  ready, and an ended session unmounted the editor -> a fourth state `expired(user)` keeps `<App>`
  mounted and shows the login as a modal dialog over it (`role="dialog"`, `aria-modal`, focus on the
  username field, notice "Your session has ended. Please log in again."). Logging in again as the same
  username returns to `ready` with the new user (new CSRF token) without remounting, and
  `notifySessionRestored()` (new in `client.ts`, with `onSessionRestored`) makes the open case retry
  its queue like its `online` handler. Another username gets a fresh editor (`<App key={username}>`),
  so the previous person's unsaved edits are dropped, since they cannot be saved under the new
  identity. A deliberate logout still unmounts the editor.
- Task 8 (review fix): the autosave queue treated a 401 as a refused command and dropped it and every
  later edit -> `isSessionProblem(err)` (a 401 `NOT_AUTHENTICATED` or a 403 `CSRF_FAILED`, new in
  `client.ts`) is checked before the 4xx branch and handled like a transport error: the operation and
  its caller stay pending, `lastError` is set and the state is `error`. The case status then reads
  "Session ended – changes kept", and `UnsavedChangesError` (submit, export, leaving the case) says
  "Your session has ended; your changes are kept and will be saved after you log in again." instead of
  "server unreachable"; the leave dialog adds "Leaving now discards N edit(s)."
- Task 8 (review fix): a late 401 for a request sent before a new login ended the new session ->
  `request()` and downloads remember the CSRF token they were sent with and notify an expiry (or a
  CSRF failure) only if the client still holds that token when the answer arrives. The gate clears the
  token on expiry, so further 401s of the old session stay silent.
- Task 8 (review fix) **[user-flow choice]**: another tab logging in swaps the cookie, so this tab's
  writes get 403 `CSRF_FAILED` -> the client announces it (`onCsrfRejected`) and the gate calls
  `me()` once (no parallel checks): the same username stores the new token and restores as above (the
  refused write itself is not repeated, except queued case edits); another user gets a fresh editor
  with the notice "You are now logged in as <display name> (from another tab)." (dismissable,
  `role="status"`, new `App` prop `sessionNotice`); a 401 from `me()` opens the login dialog
  (`expired`); any other failure changes nothing (the queue keeps its Retry button).
- Task 8 (review fix): when `/redeem-code` sets the password but its login answers 401 (e.g. a
  lockout), the form switches to the login view, keeps the username and says "Your password is set.
  Log in with it now." Switching between the login and the code view moves the focus to the new
  heading (`tabIndex=-1`). The dialog backdrop is `.login-overlay` (translucent, editor visible).
- Task 8 (review fix): new tests: `tests/session.test.tsx` (now 12) adds the late 401, the redeem
  401, the `me()` network-error notice, the logout, expiry with a re-login as the same user (the
  queued `check_layer` is sent again with the new token and the case stays open), a re-login as
  another user (fresh dashboard, the edit is not sent again) and both `CSRF_FAILED` outcomes;
  `tests/autosave.test.ts` adds the 401 and `CSRF_FAILED` cases (`it.each`, 2). Full vitest: 316 in
  33 files.
- Task 8 **[user-flow choice]**: a `me()` failure that is not an `AuthError` (server unreachable)
  shows the login form with "Ontocurator could not check your session: ...". A failed logout other
  than 401 still returns to the login screen, with "Logging out failed (...). Your session may still
  be open." While the session is checked, a plain "Checking your session..." card is shown.
- Task 8 **[user-flow choice]**: the current user and "Log out" appear in the dashboard header only
  (the case header shows the "Annotating as name (pseudonym)" badge); "Log out" is rendered only
  when the app has an `onLogout` (from the gate). The admin's first-run guide has two steps (import,
  open a case) instead of three; the identity column of the dashboard grid is gone; the package
  export button's hint without a user reads "Log in to export". The "Package ... from the launch link
  was not found" error is gone with the launch link. The login trims the username, not the password.
- Task 8: the dead `.session-lost-advanced` CSS was replaced by `.login-card`, `.login-form`,
  `.login-link` and `.current-user`. The Playwright specs in `frontend/browser` still use the launch
  token and the initials, and the embedded web assets were not rebuilt; both are Task 9. Counts:
  `tests/session.test.tsx` 4, full vitest 306 in 33 files (17 tests deleted per the table, 4 added).
- Task 8 (re-review fix): the login dialog over the editor did not block it, so the case's window
  shortcuts ("1"-"4" decisions, Alt+Arrow leaving the case) still ran from the dialog's buttons ->
  the gate wraps `<App>` in a `div.app-shell` that is always in the tree (so the editor is never
  remounted by it) and sets `inert` on it while the dialog is open, through the DOM in a layout
  effect, because React 18's types have no `inert` prop. The dialog root stops key events from
  propagating (React's `stopPropagation` also stops the native bubble before `window`), and both
  CaseScreen window shortcut handlers ignore keys while the case's root has an `[inert]` ancestor or
  the key comes from an `aria-modal` dialog outside the case. TextPane's capture-phase Escape
  listener (cancel attaching a mention) is left alone; it only changes local selection state.
  Test: `keeps the case out of reach of keys pressed in the login dialog`.
- Task 8 (re-review fix): a `CSRF_FAILED` that does not come from a stale token (e.g. a proxy drops
  the header) looped: `me()`, same user, restore, retry, `CSRF_FAILED` -> the gate notes the refused
  token (`api.getCsrfToken()`, new) before `me()` and restores only if the new token differs;
  otherwise it shows "The page is out of date; reload it." and the queue stays in its error state
  (Retry button; each manual retry costs one `me()`). Test: `does not retry for ever when a CSRF
  failure persists with the same token`.
- Task 8 (re-review fix): the gate's notices ("... (from another tab).", "The page is out of date;
  reload it.") moved from an `App` prop to a fixed, dismissable `role="status"` banner rendered by
  the gate (`.session-notice`), so they show over the case view as well; `App` has no
  `sessionNotice` prop any more. Counts: `tests/session.test.tsx` 14, full vitest 318 in 33 files.
- Task 9: "remove the token from `AppConfig`" in `tests/browser_server.py` -> nothing left to do,
  because Task 6 had already removed it.
- Task 9: `/__test_user__` "is idempotent" -> a new user gets `display_name` = pseudonym; for an
  existing user `setup=false` changes nothing (no new password, so its open sessions stay valid) and
  `setup=true` issues a reset code, which `redeem-code` accepts like a setup code. Every user is
  created and coded through `AccountService` with `Actor.cli()`, so the audit trail is the CLI's.
- Task 9: the login test only checks that "Log out" brings back the form -> it also checks that
  `current-user` is gone after the refused login and after the logout.
- Task 9 (Q10): the case badge "Annotating as name (pseudonym)" (Task 8) made the case header need
  a third line at 1025 px, the narrowest three-column window, so `tree.spec.ts` "in the three-column
  layout the tree is under the annotation panel at every width" failed (annotation panel 242 px
  instead of at least 250; header 114 px instead of 84). The test was right (it guards the layout),
  so the app changed, keeping Q10's text -> the display name sits in `span.identity-name`
  (`inline-block`, `max-width: 16ch`, `6ch` below 1280 px, ellipsis), the pseudonym is never cut, and
  the identity badge is not upper-cased (`text-transform: none`, normal letter spacing); the title
  reads "<name> (<pseudonym>): your annotations and decisions are saved under this pseudonym".
  Measured with a throw-away probe spec at 1025 px: an upper-cased badge needs a third line even with
  the name cut to 4ch (246 px badge; the limit is about 217 px), the sentence-case badge with 12ch
  does too (231-262 px), with 6ch it fits (217 px, header 84 px, as before T2b); at 1100, 1279, 1280
  and 1440 px a long name changes no header height. An interim version that showed the pseudonym
  alone was replaced, because it dropped Q10's display name. `/__test_user__` takes an optional
  `display_name`, and the 1025 px layout test now runs as "Maximiliane Schmidt-Rottluff"; new unit
  test "shows the display name with the pseudonym; only the name has a bounded width"
  (`review-findings.test.tsx`).
- Task 9: the browser server logs "There is no user yet, so nobody can log in." at start, because
  its users only appear through `/__test_user__`; left as is.
- Task 9: after the rebuild, `grep -rnE "Authorization|Bearer|SESSION_TOKEN|ALLOW_TEST_CLIENT_HOST|session_token|verify_security" src tests --exclude-dir=__pycache__`
  prints nothing (the Task 6 entry above expected this).
- Final review: `serve --forwarded-allow-ips` (env `ONTOCURATOR_FORWARDED_ALLOW_IPS`) is passed to
  `uvicorn.run(..., proxy_headers=True, forwarded_allow_ips=…)`; unset passes `None`, which keeps
  uvicorn's default (`FORWARDED_ALLOW_IPS` or 127.0.0.1). Login throttling keeps reading
  `request.client.host`, which uvicorn then sets from `X-Forwarded-For` of a trusted proxy.
- Final review: the unreachable fallback in `identity.principal_of` raises the new
  `NotAuthenticated` domain error, mapped to 401 `NOT_AUTHENTICATED` like the middleware, instead
  of a 403 `AccessDenied`.
- Final review: `create_app(None)` (schema export) now installs the security middleware with no
  session service, which answers every `/api/` request, login included, with 401
  `NOT_AUTHENTICATED`; `/openapi.json` and the schema are unchanged.
- Final review: `openCase` in `frontend/browser/helpers.ts` takes no identity argument any more,
  and `App.tsx` drops the `identity` option of `openCase`, the `identity` of the round selection
  and the parameter of `handleOpenWorkspace`; the identity is read from the logged-in user only.
- Final review: the inline style of the case header's identity badge (background, colour, font
  size) moved into `.identity-badge`; embedded assets rebuilt.
- Final review: README (intro, architecture diagram, proxy note, `--forwarded-allow-ips` row) and
  `docs/scientific-workflow.md` describe the login model; the annotator ID is the logged-in user's
  pseudonym. The README's "Persistence & Storage" section and the "V4 Workspace Storage" bullet
  still describe SQLite (T2a material, not part of this cleanup).

## Open risks

- Deactivating or demoting the last active system admin is not prevented. Accepted, because the CLI
  `admin users activate`/`set-admin` (Task 7) can undo it with database access.
- `login_attempts` is never pruned; it grows by one row per attempt until a retention job exists.
- `/docs` and `/openapi.json` are public (no session needed); they describe the API but expose no
  data. Upload bodies (`POST /packages`, `POST /ontologies`) are spooled to a temporary file before
  the route's admin check runs, so any logged-in user can make the server receive up to the size
  limit. The `Secure` cookie flag needs `--public-origin https://…`; behind a TLS-terminating proxy
  without it the cookie is sent without `Secure` (the deployment contract is T2e).
- A client may still create an annotation with `actor_kind="tool"` and any `actor_id`, i.e.
  attribute work to a tool or model. Restricting tool provenance belongs to T2c's roles and policy.
- `.github/workflows/ci.yml` still calls the deleted `scripts/build_release.py` and would need a
  PostgreSQL service; left untouched by instruction (no CI, index R2).
- The backend still has `last_annotator_id` (preferences) and the `/settings` presets; the
  frontend no longer needs them. T2c should remove them.
- The browser fixture (`/__test_user__`) creates only system admins, so Playwright never exercises
  the non-admin UI; that is covered by unit tests only.
- Behind a reverse proxy, `--forwarded-allow-ips` must name the proxy's address. Otherwise login
  throttling sees every client as the proxy's single address, and 30 failed logins within 15
  minutes, from anyone, lock everyone out. The deployment contract is finalised in T2e.
