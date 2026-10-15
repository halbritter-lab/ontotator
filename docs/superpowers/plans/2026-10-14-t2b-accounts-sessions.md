# T2b: Accounts and Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is written in the lean format: each task gives files, interfaces, tables, test cases and acceptance criteria. Implementers write the code test-first. Code appears only where it defines a contract or is easy to get wrong.

**Goal:** People log in with an administrator-assigned username and a password. Every editor request acts as the logged-in user. The desktop launcher, its bearer token and the typed-in initials are gone.

**Architecture:**
- **Desktop retirement:** remove the desktop-only parts first (P1, E1).
- **Data:** new tables hold users, Argon2id credentials, single-use codes, server-side sessions, login attempts, user preferences and an append-only `audit_events`.
- **Services:** `AccountService` (users, codes, first admin, recovery) and `SessionService` (login, throttling, expiry) implement D2.
- **HTTP:** a middleware resolves the session cookie, enforces CSRF and Origin, and binds every workspace to the principal's pseudonym.
- **CLI:** `ontocurator admin …` manages users and recovers a lost admin password offline.
- **Frontend:** a login gate replaces the token link and the initials field.

**Spec:** `docs/superpowers/specs/2026-10-14-t2-server-foundation-design.md` (P3, P4, P5, D2; E2 refined by R1). Index, decisions D-a…D-n, open questions Q1–Q14: `docs/superpowers/plans/2026-10-14-t2-index.md`. Builds on T2a.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, argon2-cffi, Typer · React 18, TypeScript, Vitest, Playwright.

**Branch / worktree:** `feat/t2b-accounts-sessions` from `feat/t2a-postgres-storage`, worktree `.worktrees/t2b-accounts-sessions`. Set up with `uv sync`, `npm --prefix frontend ci` and `npx --prefix frontend playwright install chromium`. Start Docker Desktop, then establish the baseline with `scripts/check.sh` (expected: `All local checks passed.`).

**Resolved decision R1:** the login identifier is a username assigned by the administrator. E-mail is an optional contact field (`users.email`).

**Commit rule:** after each task run `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then make one conventional commit. No AI attribution.

---

### Task 1: Retire the desktop distribution

**Delete:**
- `src/ontocurator/{instance,config_store,file_manager}.py`, `src/ontocurator/application/{legacy_config,provisioning}.py`;
- `scripts/{build_standalone,build_release,build_common,provision_bundle}.py`;
- `tests/{test_cli_standalone,test_followup_standalone,test_standalone_packaging,test_bundle_preload,test_config_store,test_legacy_config,test_release,test_cli_console}.py`;
- `frontend/src/app/LegacyConfigNotice.tsx`, `frontend/tests/legacyConfig.test.tsx`, `frontend/browser/legacy-config.spec.ts`.

Then `uv remove platformdirs` and `uv remove --dev pyinstaller`. Keep `scripts/license_notices.py` and `scripts/create_demo_package.py`; the latter goes in T2d.

**Rewrite `src/ontocurator/cli.py`** with these commands:
- `serve` with options:
  - `--data-dir` (env `ONTOCURATOR_DATA_DIR`, default `data`), passed as `AppConfig.workspace_dir`;
  - `--database-url`, `-o/--ontology` (repeatable), `--translations-dir` (repeatable);
  - `--host` (env `ONTOCURATOR_HOST`), `--port` (env `ONTOCURATOR_PORT`), `--web-dir`, `--verbose`.

  It refuses a missing ontology file (exit 1, "Ontology file not found"). It builds `AppConfig` and runs `uvicorn.run(app, host=…, port=…)`. Until Task 6 it still generates a session token and prints `http://host:port/#token=…`.
- `analyze`: unchanged, copied verbatim.
- `db upgrade`: from T2a.
- `version`.
- `main()` is just `app()`; the positional-argument routing of the launcher is removed.

**Other source changes:**
- `config.py`: drop `config_path`, `legacy_config_path` and `preconfigured`.
- `api/app.py`:
  - drop the legacy-config and provisioning state and their exception handlers;
  - register `<workspace_dir>/ontologies/*.json` with `registry.register_path` before `registry.load_registered()`. Uploaded ontologies were remembered in the per-user config file before.
- `api/routes.py`: drop `/provisioning` and `/legacy-config*` and their imports; `upload_ontology` no longer calls `uploads.persist`.
- `application/uploads.py`: drop `persist`.
- `application/preferences.py`: drop `LegacyConfigDecision` and every `legacy_config` field and method.

**Test changes:**
- New `tests/test_license_notices.py`: move the two licence tests from the deleted `test_standalone_packaging.py`. Replace `platformdirs` by `sqlalchemy` in the runtime-dependency assertion.
- Rewrite `tests/test_cli.py`:
  - `test_version_comes_from_package_metadata`;
  - `test_help_lists_the_commands` (serve, db, analyze, version);
  - `test_serve_refuses_a_missing_ontology`;
  - `test_serve_starts_the_app_on_the_given_address`: patches `ontocurator.cli.uvicorn.run`; asserts the port and that HP is loaded.
- `tests/test_distribution.py`: delete the provisioning and settings-file/CLI tests:
  - `test_provisioning_registers_ontologies_and_imports_packages`, `test_changed_package_with_same_id_is_not_imported_and_warns`, `test_new_ontology_version_is_registered_alongside_old`, `test_invalid_provisioning_files_are_skipped_without_blocking`;
  - `test_settings_file_is_applied_and_open_package_in_url`, `test_invalid_settings_file_warns_and_uses_defaults`, `test_browser_precedence_cli_over_settings_over_config`;
  - `test_missing_provision_dir_is_an_error`, `test_frozen_app_dir_is_used_for_provisioning`, `test_no_provisioning_from_source_without_flag`, `test_translation_files_next_to_the_ontologies_are_loaded`.

  Also delete the `config_store` import and the `/provisioning` assertion in `test_settings_endpoint_defaults`.
- `tests/test_demo_fixture.py`: delete `test_demo_fixture_opens_via_dropped_zip`.
- `tests/test_ontology_management.py`: rename `test_ontologies_listed_on_app_startup_from_persistent_config` to `test_uploaded_ontologies_are_listed_after_a_restart`. It no longer uses `load_persistent_config`; the second app finds the upload in `ws/ontologies`.
- `tests/test_review_findings.py`: drop the two `persisted` lines in `test_ontology_upload_is_content_addressed_and_never_overwrites`.
- `tests/test_preferences_api.py`: drop `"legacy_config": None` from the stored-file expectation.
- `tests/conftest.py`: drop the legacy-config env line; drop `isolate_test_config` if only `ONTOCURATOR_CONFIG_PATH` remains.
- `tests/browser_server.py`: drop provisioning, the legacy fixture, `file_manager` and the config-path arguments.
- `frontend/browser/workflow.spec.ts`: delete the "provisioning: …" test.

**Frontend changes:**
- `api/client.ts`: delete the types `ProvisioningStatus`, `ProvisioningNotice`, `LegacyConfig*` and the six legacy/provisioning methods.
- `App.tsx`: delete the provisioning and legacy state, loaders and JSX blocks; `bootstrap` awaits only `loadSettings()`.
- `tests/distribution.test.tsx`: drop the `getProvisioning` mock and the tests "shows provisioning warnings…" and "works with older servers without settings or provisioning endpoints".
- Regenerate the contract: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`.

**Acceptance:**
- `grep -rnE "config_store|legacy_config|LegacyConfig|[Pp]rovisioning|file_manager|platformdirs|pyinstaller|build_standalone|build_release" src tests frontend/src frontend/tests frontend/browser scripts pyproject.toml` prints nothing.
- `scripts/check.sh` passes.
- Commit: `refactor: retire the desktop distribution (launcher, provisioning, legacy settings, standalone build)`.

---

### Task 2: Identity tables (migration 0002)

**Modify** `storage/tables.py` and **create** `storage/migrations/versions/0002_identity.py`. Add `"audit_events"` to `APPEND_ONLY_TABLES`. All timestamps are `timestamptz`.

| Table | Columns (NOT NULL unless "null") | Keys / indexes |
|---|---|---|
| `users` | `id` bigint identity; `username` text; `display_name` text; `email` text null; `pseudonym` text; `orcid` text null; `orcid_consent` bool default false; `is_system_admin` bool default false; `active` bool default true; `credential_generation` int default 1; `created_at`, `updated_at` default now() | PK id; UNIQUE username; UNIQUE pseudonym |
| `password_credentials` | `user_id` → users; `password_hash` text; `changed_at` default now() | PK user_id |
| `sessions` | `id` identity; `user_id` → users; `token_sha256` text; `csrf_token` text; `created_at` default now(); `last_seen_at`; `expires_at`; `revoked_at` null; `revoked_reason` null; `client_ip` null; `user_agent` null | PK id; UNIQUE token_sha256; ix (user_id, revoked_at) |
| `one_time_codes` | `id` identity; `user_id` → users; `purpose` text ('setup' or 'reset'); `code_sha256` text; `issued_by` → users null; `credential_generation` int; `created_at` default now(); `expires_at`; `used_at` null | PK id; UNIQUE code_sha256 |
| `login_attempts` | `id` identity; `username` text; `client_ip` text; `succeeded` bool; `at` | ix (username, at); ix (client_ip, at) |
| `audit_events` (append-only) | `id` identity; `at` default now(); `actor_user_id` → users null; `actor_label` text; `action` text; `target_type` text; `target_id` text; `project_id` → projects null; `details` jsonb default '{}' | PK id; ix (project_id, at) |
| `user_preferences` | `user_id` → users; `preferences` jsonb | PK user_id |
| `instance_state` | `key` text; `value` jsonb; `updated_at` default now() | PK key |

The migration also creates `SEQUENCE ontocurator.pseudonym_seq`, which yields the pseudonyms `ann-0001`, `ann-0002`, … These parts define the contract and must match exactly:

```python
op.execute(f"CREATE SEQUENCE {SCHEMA}.pseudonym_seq")
# ... create_table calls, names as in tables.py (pk_users, uq_users_username, ...)
op.execute(f"CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON {SCHEMA}.audit_events"
           f" FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.forbid_history_change()")
op.execute(f"CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON {SCHEMA}.audit_events"
           f" FOR EACH STATEMENT EXECUTE FUNCTION {SCHEMA}.forbid_history_change()")
for table in ("users", "password_credentials", "sessions", "one_time_codes",
              "login_attempts", "user_preferences", "instance_state"):
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SCHEMA}.{table} TO {APP_ROLE}")
op.execute(f"GRANT SELECT, INSERT ON {SCHEMA}.audit_events TO {APP_ROLE}")
# New sequences (pseudonym_seq and identity sequences) need the grant again:
op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {SCHEMA} TO {APP_ROLE}")
```

`downgrade()` raises `NotImplementedError` (forward-only, D-d).

> **Resolved Q1:** one stable pseudonym per user, used in every project.

**Tests:** none new. `tests/test_schema.py` must now report `16 passed`: the mapping/migration comparison holds, and the append-only parametrisation also covers `audit_events`.

**Acceptance:** `uv run pytest tests/test_schema.py -q` passes. Commit: `feat(auth): identity, session, code, throttling and audit tables`.

---

### Task 3: Passwords

**Create** `src/ontocurator/auth/__init__.py` and `src/ontocurator/auth/passwords.py`; `uv add "argon2-cffi>=23.1,<26"`.

**Interface:**
- `MEMORY_COST = 19_456`, `TIME_COST = 2`, `PARALLELISM = 1` (OWASP; Limin `ARGON2ID_POLICY`); `MIN_LENGTH = 12`, `MAX_LENGTH = 256`.
- `class PasswordRuleError(ValueError)`.
- `check_password_rules(username, password) -> None`: length 12..256, and not equal to the username (casefold, stripped).
- `hash_password(password) -> str`: an Argon2id PHC string.
- `verify_password(stored_hash: str | None, password) -> bool`: always runs Argon2 once. With `None` it verifies against a module-level dummy hash and returns False (timing equaliser, index D-j). It never raises.
- `needs_rehash(hash) -> bool`.
- `assert_policy(hash) -> None`: a supplied hash must match `^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$…\$…$` with every parameter at least our cost. Otherwise `PasswordRuleError("… Argon2id …")` or `("… at least …")`.

> **Resolved Q7 (technical):** 12 to 256 characters, not equal to the username, no composition rules.

**Tests:** `tests/test_passwords.py`, expected 8 passed.
- `test_a_hash_verifies_its_password_only`: the prefix is `$argon2id$v=19$m=19456,t=2,p=1$`; it rejects a wrong password.
- `test_an_unknown_user_never_verifies`: `verify_password(None, …)` is False.
- `test_a_broken_hash_does_not_verify`.
- `test_passwords_that_break_the_rules_are_refused` (3 cases): `"short"` gives "at least 12"; 257 characters give "at most 256"; `"Alice.Example"` for user `alice.example` gives "differ from the username".
- `test_a_long_passphrase_is_accepted`.
- `test_a_supplied_hash_must_be_argon2id_with_our_parameters`: our hash passes; `PasswordHasher(t=1, m=8192)` fails with "at least"; a bcrypt string fails with "Argon2id".

Commit: `feat(auth): Argon2id password hashing, supplied-hash policy and password rules`.

---

### Task 4: Accounts, codes, the first admin, recovery and the audit hook

**Create** `src/ontocurator/auth/audit.py`, `src/ontocurator/auth/accounts.py`. **Modify** `domain/errors.py`.

**Errors:**
- `class AccessDenied(DomainError)`, mapped to HTTP 403.
- `class LoginFailed(DomainError)`, mapped to HTTP 401. Its code is `LOGIN_FAILED` and its fixed message "Username or password is wrong, or the account is locked for 15 minutes." (Q8).

**`audit.py`:**
- `@dataclass(frozen=True) class Actor(user_id: int | None, label: str)`, with `Actor.cli()` giving the label `cli:<os user>`.
- `record_audit(conn, actor, action, *, target_type, target_id, project_id=None, details=None)`: inserts one `audit_events` row in the caller's transaction.

**`accounts.py`:**
- `User` dataclass: `id, username, display_name, email, pseudonym, is_system_admin, active`.
- `IssuedCode`: `user, purpose ('setup' or 'reset'), code (clear text, the only time it exists), expires_at`.
- `CODE_LIFETIME = {"setup": 24 h, "reset": 15 min}` (D2).
- `normalize_username(value)`: strip and lower-case; must match `[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]`. Otherwise `DomainError("USERNAME_INVALID")`.
- `AccountService(db, *, now=lambda: datetime.now(UTC))`:
  - **reading:** `get_by_username`, `list_users`;
  - **`create_user(actor, username, display_name, *, email=None, system_admin=False, pseudonym=None) -> IssuedCode`:**
    - raises `USERNAME_TAKEN`;
    - the pseudonym is `ann-%04d` from the sequence, or the given one validated by `normalize_annotator_id` (else `PSEUDONYM_INVALID`);
    - audits `user.create` and issues the setup code;
  - **`issue_reset_code(actor, username)`:** the user must be active (`USER_INACTIVE`); audits `user.reset_code`;
  - **`_issue_code`:** deletes the unused codes of the same user and purpose; the code is `secrets.token_urlsafe(32)`; it stores `sha256(code)`, `credential_generation` and `expires_at`;
  - **`redeem_code(username, code, new_password) -> User`:**
    - checks the password rules first (`PASSWORD_RULES`);
    - otherwise every failure is `CODE_INVALID` with one message: unknown, used, expired, another user's code, stale generation, or an inactive user;
    - on success: marks the code used, upserts the credential, increments `credential_generation`, revokes all sessions and audits `user.password_set` with the user as actor;
  - **`set_system_admin(actor, username, on)`, `set_active(actor, username, active)`:** update the flag, increment the generation, revoke the sessions (D2) and audit `user.system_admin` or `user.active`;
  - **`bootstrap_admin(password_hash | None) -> "created" | "already_done" | "not_configured"`:**
    - runs under an advisory transaction lock;
    - with the `instance_state['admin_bootstrapped']` key present it returns `already_done`; with no hash, `not_configured`;
    - otherwise it calls `assert_policy` (`PASSWORD_RULES` on failure), creates `admin` (display "Administrator", system admin) if missing, sets the password, writes the instance key and audits `user.bootstrap` with the actor label `system:bootstrap`;
  - **`recover_admin(username, password_hash, operator, reason)`:**
    - needs an operator and a reason (`RECOVERY_INCOMPLETE`) and a hash that passes `assert_policy`;
    - the user must be an active system admin (`NOT_AN_ACTIVE_ADMIN`);
    - sets the password, which revokes the sessions and bumps the generation;
    - audits `user.recovered` with the actor label `recovery:<operator>` and the details `{reason}`.

> **Resolved Q9:** a user redeems a code on the login page ("I have a setup or reset code") with username, code and new password, and is then logged in.

**Tests:** `tests/test_accounts.py`, 16 tests. They use a fake `Clock` and `database_for`.
- `test_a_new_user_gets_a_pseudonym_and_a_setup_code`: `Alice` becomes `alice`; the pseudonyms are `ann-0001` and `ann-0002`; the setup code expires after +24 h; the e-mail is stored.
- `test_usernames_are_short_lowercase_words` (5 cases: `ab`, `with space`, `UPPER!`, `-start`, 65×`x`) raise `USERNAME_INVALID`.
- `test_a_username_is_taken_once`: `ALICE` after `alice`.
- `test_a_setup_code_sets_the_password_once`: login works afterwards; a second redemption gives `CODE_INVALID`.
- `test_an_expired_or_foreign_code_is_refused`.
- `test_a_reset_code_lives_fifteen_minutes_and_replaces_older_codes`: the old setup code becomes invalid.
- `test_the_password_rules_apply_when_a_code_is_redeemed`: a short password gives `PASSWORD_RULES` and the code stays usable.
- `test_changes_revoke_sessions`: `set_system_admin` and `set_active(False)` make `resolve(token)` return None.
- `test_the_first_admin_is_created_once_from_a_hash`: `not_configured`, then `created`, then `already_done`; then `admin` logs in as a system admin.
- `test_a_weak_bootstrap_hash_is_refused`.
- `test_recovery_sets_a_new_admin_password_and_records_the_operator`: the old session is revoked, the new password works, and `user.recovered` is in the audit log.
- `test_every_change_is_audited`: the sorted actions are `{user.active, user.create, user.reset_code, user.system_admin}`.

Task 4 needs `revoke_user_sessions` from Task 5. Implement both tasks before running the tests, and commit them together.

---

### Task 5: Sessions and login throttling

**Create** `src/ontocurator/auth/sessions.py`.

**Interface:**
- `SessionPolicy(idle=12 h, absolute=14 days, window=15 min, failures_per_account=5, failures_per_address=30)`.
- `Principal(user_id, username, display_name, pseudonym, is_system_admin, session_id, csrf_token)`, frozen.
- `revoke_user_sessions(conn, user_id, reason, at)`: sets `revoked_at` on every open session of the user.
- `SessionService(db, policy=None, *, now=…)`:
  - `login(username, password, *, client_ip, user_agent=None) -> (token, Principal)`;
  - `resolve(token) -> Principal | None`;
  - `logout(session_id)`.

**`login` semantics:** these are easy to get wrong, so they are fixed here.
- Look up the user and credential, then count the failed attempts of this username and of this address within `window`.
- Run `verify_password(hash if the user is active else None, password)` always.
- `succeeded = matches and not locked and user exists`.
- Insert the `login_attempts` row inside the transaction, and **raise `LoginFailed` only after the transaction has committed**, so the failure stays recorded.
- On success, rehash if `needs_rehash`. Create the session with `token = secrets.token_urlsafe(32)`, storing only its SHA-256, a `csrf_token = secrets.token_urlsafe(32)`, and `expires_at = now + absolute`.

**`resolve` semantics:**
- Only open sessions of active users resolve.
- A session that is past `expires_at`, or idle longer than `idle`, is revoked with the reason `expired` and returns None.
- `last_seen_at` is updated at most every 60 s.

> **Resolved Q6 (technical):** sessions expire after 12 h idle or 14 days after login.

> **Resolved Q8 (technical):** 5 failures of one account within 15 min lock it for the rest of that window, and 30 failures from one address lock the address. The message never says whether an account is locked.

**Tests:** `tests/test_sessions.py`, 10 tests.
- `test_a_login_creates_a_session_that_resolves_to_the_user`: `" Alice "` is normalised; `resolve` equals the principal; the CSRF token has at least 40 characters.
- `test_every_failure_looks_the_same` (3 cases: wrong password, unknown user, empty password): all are `LOGIN_FAILED`.
- `test_five_failures_lock_the_account_for_the_window`: after 5 failures the correct password fails from another address; it works again after +15 min 1 s.
- `test_many_failures_from_one_address_lock_that_address`: 30 failures with unknown names lock `10.0.0.9`, while another address still logs in.
- `test_a_failed_attempt_is_recorded_even_though_the_login_fails`: `count_rows(…, "login_attempts") == 1`.
- `test_sessions_expire_when_idle_and_after_their_lifetime`:
  - idle: +12 h 1 s gives None;
  - absolute: 30 steps of 11 h stay valid, a further +7 h (337 h in total) gives None.
- `test_logout_ends_only_this_session`.
- `test_an_unknown_token_resolves_to_nobody`.

**Acceptance:** `uv run pytest tests/test_accounts.py tests/test_sessions.py -q` gives `26 passed`. Commit: `feat(auth): accounts, single-use codes, first admin, recovery, sessions and login throttling`.

---

### Task 6: Sessions on the HTTP API and identity binding

**Create:** `api/security.py` (rewritten), `api/identity.py`, `api/auth_routes.py`, `auth/preferences.py`, `tests/auth_harness.py`, `tests/test_auth_api.py`. Rewrite `tests/test_preferences_api.py`.

**Modify:**
- `settings.py`: add `canonical_origin(value) -> "scheme://host[:port]"`. The value must be http(s) with a host and no path, query or credentials; otherwise `SettingsError`.
- `config.py`: drop `session_token`; add `public_origin: str | None = None` and `admin_password_hash: str | None = None`.
- `api/app.py`:
  - builds `AccountService`, `SessionService` and `UserPreferencesStore(db)`;
  - calls `accounts.bootstrap_admin(config.admin_password_hash)` and logs a warning if the result is `already_done` and a hash was given;
  - sets `app.state.secure_cookies = public_origin startswith https`;
  - calls `install_security(app, sessions, public_origin)`;
  - includes the auth router;
  - maps `AccessDenied` to 403 and `LoginFailed` to 401 with `{code, details}`, before the generic `DomainError` handler;
  - removes the old bearer middleware.
- `api/routes.py`: identity binding (see the table below); preferences per user.
- `application/preferences.py`: keep only the models and `normalize_annotator_id`; delete the file store.
- `cli.py serve`: no token; option `--public-origin` (env `ONTOCURATOR_PUBLIC_ORIGIN`); `admin_password_hash=settings.read_secret("ONTOCURATOR_ADMIN_PASSWORD_HASH")`, which also reads the `_FILE` form (D1); prints `http://host:port/`.

**Security middleware:** this is the contract; implement it as shown.

```python
SESSION_COOKIE = "ontocurator_session"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
PUBLIC_PATHS = frozenset({"/api/v1/auth/login", "/api/v1/auth/redeem-code"})
current_principal: ContextVar[Principal | None] = ContextVar("ontocurator_principal", default=None)

def expected_origin(request, public_origin):
    return public_origin or f"{request.url.scheme}://{request.headers.get('host', '')}"

def cross_site(request, public_origin, *, fail_closed: bool) -> bool:
    origin = request.headers.get("origin"); fetch_site = request.headers.get("sec-fetch-site")
    if origin is not None and origin != expected_origin(request, public_origin): return True
    if fetch_site is not None and fetch_site not in ("same-origin", "none"): return True
    return fail_closed and origin is None and fetch_site is None   # Limin: fail closed

def install_security(app, sessions, public_origin):
    @app.middleware("http")
    async def authenticate(request, call_next):
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        unsafe = request.method in UNSAFE_METHODS
        if path in PUBLIC_PATHS:                       # no session yet
            if unsafe and cross_site(request, public_origin, fail_closed=True):
                return _error(403, "CROSS_SITE_REQUEST", "...")
            return await call_next(request)
        token = request.cookies.get(SESSION_COOKIE)
        principal = await run_in_threadpool(sessions.resolve, token) if token else None
        if principal is None:
            return _error(401, "NOT_AUTHENTICATED", "Log in to continue.")
        if unsafe:
            if cross_site(request, public_origin, fail_closed=False):
                return _error(403, "CROSS_SITE_REQUEST", "...")
            sent = request.headers.get(CSRF_HEADER, "")
            if not secrets.compare_digest(sent.encode(), principal.csrf_token.encode()):
                return _error(403, "CSRF_FAILED", "The page is out of date; reload it.")
        request.state.principal = principal
        reset = current_principal.set(principal)      # index D-k: visible below the routes
        try:
            return await call_next(request)
        finally:
            current_principal.reset(reset)
```

**Auth routes** (`/api/v1/auth`):

| Route | Behaviour |
|---|---|
| `POST /login {username, password}` | Returns `CurrentUser` and sets the cookie |
| `POST /redeem-code {username, code, new_password}` | Redeems the code, then logs in as for `/login` |
| `POST /logout` | Returns 204 and deletes the cookie |
| `GET /me` | Returns `CurrentUser` |

`CurrentUser` is `{username, display_name, pseudonym, is_system_admin, csrf_token}`. The cookie is set with `response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=app.state.secure_cookies, samesite="lax", path="/", max_age=policy.absolute)`. The client address is `request.client.host`; in production it is the proxy-resolved address (T2e).

**`api/identity.py`:**
- `principal_of(request)` and `PrincipalDep`;
- `own_annotator(principal, requested, *, may_read_others=False)`;
- `own_key(principal, key)`, which raises `AccessDenied("IDENTITY_MISMATCH")`;
- `require_system_admin(principal)`, which raises `ADMIN_REQUIRED`.

> **Resolved Q4:** a system admin may *read* other annotators' document status and exports (`may_read_others=True`), but always works under their own pseudonym.

| Route | Binding |
|---|---|
| `get/put /preferences` | `app.state.preferences.load/update(principal.user_id, …)` |
| `POST /packages`, `POST /ontologies` | `require_system_admin` (until T2d replaces the uploads) |
| `GET /packages/{id}/documents` | `annotator_id = own_annotator(…, may_read_others=True)` |
| `POST /workspaces/review-inputs`, `POST /workspaces/open` | `annotator_id: str \| None = None` in the request models; `own_annotator(principal, req.annotator_id)` |
| `/workspaces/{id}/commands`, `/decisions`, `/submit`, `/submissions/{sid}`, `/export` | `key = own_key(principal, decode_workspace_id(id))` |
| `GET /packages/{id}/export` | `annotator_id` optional; `own_annotator(…, may_read_others=True)` |
| search and tree (`layer_ontology`) | first statement `own_key(principal_of(request), workspace_key)` |

**`auth/preferences.py`:** `UserPreferencesStore(db)` with `load(user_id) -> Preferences` and `update(user_id, change) -> Preferences`. The merge semantics stay those of the old file store: omitted fields are kept, and modes and search languages merge per key. The update does a `SELECT … FOR UPDATE` and then an upsert.

**Test harness `tests/auth_harness.py`:** this decides how the existing tests survive, so its behaviour is fixed here.
- `PASSWORD = "test-only passphrase"`, `ORIGIN = {"Origin": "http://testserver"}`.
- `ensure_user(app, username, *, system_admin=False, pseudonym=None)`: creates the user and redeems its setup code with `PASSWORD`.
- `log_in(client, username) -> CurrentUser json`: sets `client.headers["X-CSRF-Token"]`.
- `logged_in(app, username, *, system_admin=False, pseudonym=None) -> TestClient`.
- `class AutoLoginClient(TestClient)`: overrides `request(method, url, **kw)`. For every non-`/api/v1/auth/` request it determines the annotator, in this order:
  1. `json["annotator_id"]`;
  2. `json["workspace_key"]["annotator_id"]`;
  3. `params["annotator_id"]`, or `annotator_id` in the URL query;
  4. `decode_workspace_id(<id>)` for a `/api/v1/workspaces/<id>/…` path;
  5. otherwise the current user, or `"tester"`.

  If that differs from the logged-in user, it calls `login_as(annotator)`. That creates the user once as a system admin, with the username `u-<sha256(annotator)[:16]>` and the pseudonym = the annotator, and logs in through the real endpoint. Every request therefore passes the real cookie, CSRF and identity checks.

**Converting the existing tests:** run a one-off script (keep it outside the repo):
- replace `TestClient(<app>, headers={"Authorization": …}[, rest])` with `AutoLoginClient(<app>[, rest])` and add `from auth_harness import AutoLoginClient`;
- delete `session_token=…` keyword arguments.

Then delete the tests of the old model:
- `test_api.py::test_auth_and_host_validation`;
- `test_review_findings.py`: `_raw_request`, `test_non_ascii_bearer_token_is_rejected_not_crashing`, `test_test_client_host_is_only_trusted_when_flag_is_set`;
- the `conftest.py` fixture `trust_in_process_test_client`.

Acceptance check: `grep -rnE "Authorization|Bearer|SESSION_TOKEN|ALLOW_TEST_CLIENT_HOST|session_token|verify_security" src tests` prints nothing.

**New tests `tests/test_auth_api.py`** (14):
- `test_the_api_needs_a_session`: 401 `NOT_AUTHENTICATED`.
- `test_login_sets_a_strict_cookie_and_me_names_the_user`: the cookie has HttpOnly, `SameSite=lax` and `Path=/` but no Secure on http; `/me` returns the pseudonym and the same CSRF token.
- `test_the_cookie_is_secure_behind_an_https_origin`.
- `test_a_login_must_come_from_the_page` (3 cases: no headers, a foreign Origin, `Sec-Fetch-Site: cross-site`): 403 `CROSS_SITE_REQUEST`.
- `test_every_failed_login_gives_the_same_answer`: a wrong password and an unknown user give identical 401 bodies.
- `test_a_write_needs_the_csrf_token`: without the header, 403 `CSRF_FAILED`; with it, 200.
- `test_logout_ends_the_session`: 204, then `/me` gives 401.
- `test_a_setup_code_logs_the_new_user_in`.
- `test_a_deactivated_user_is_logged_out_at_once`.
- `test_the_first_admin_comes_from_the_configured_hash`.
- `test_nobody_works_under_another_identity`:
  - alice opens a workspace (key annotator = alice);
  - bob opening with `annotator_id: "alice"` gets 403;
  - bob sending a command to alice's workspace ID gets 403 `IDENTITY_MISMATCH`.
- `test_only_a_system_admin_uploads_packages`: 403 `ADMIN_REQUIRED`.

**`tests/test_preferences_api.py`** (rewritten, 6 tests):
- `test_preferences_start_empty`;
- `test_updates_merge_per_package_and_survive`;
- `test_search_languages_merge_per_annotator`: `["de","DE"]` is stored as `["de"]`;
- `test_each_user_has_their_own_preferences`;
- `test_invalid_values_are_refused`: both cases give 422;
- `test_preferences_need_a_session`: 401.

> **Resolved Q10:** `/auth/me` returns the display name and the pseudonym. The dashboard shows "display name · pseudonym", and the editor shows "Annotating as *display name* (pseudonym)".

**Acceptance:**
- `uv run pytest -q` passes completely.
- Regenerate the contract: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`.
- The browser suite is expected to fail until Task 8; do not run it in between.
- Commit: `feat(auth): session cookie, CSRF and origin checks, identity binding and per-user preferences`.

---

### Task 7: Admin CLI, runtime lease and offline recovery

**Create** `src/ontocurator/storage/lease.py` and `tests/test_admin_cli.py`. **Modify** `api/app.py` and `cli.py`.

**Runtime lease:** running servers hold it, and recovery needs it exclusively. This is the contract:

```python
RUNTIME_LEASE = 7_011_337_422

class RuntimeLease:                      # held shared by every server process
    def __init__(self, engine): ...
    def acquire(self):                   # dedicated AUTOCOMMIT connection, kept open
        conn = self.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        conn.execute(text("SELECT pg_advisory_lock_shared(:k)"), {"k": RUNTIME_LEASE})
    def release(self): ...               # pg_advisory_unlock_shared, close the connection

@contextmanager
def exclusive_lease(engine) -> Iterator[bool]:   # True only if no server holds the lease
    # AUTOCOMMIT connection; pg_try_advisory_lock(k); unlock on exit if acquired
```

`api/app.py` gets a FastAPI `lifespan` that acquires `app.state.runtime_lease` (a `RuntimeLease(db.engine)`) in a thread pool and releases it at shutdown. `TestClient` runs the lifespan only inside `with TestClient(app):`.

**CLI** (`ontocurator admin [--database-url URL] …`). The callback stores the URL in `ctx.obj`; the database is `Database(settings.resolve_database_url(url, None), data_dir=$ONTOCURATOR_DATA_DIR or data)`.

| Command | Output / effect |
|---|---|
| `users create USERNAME --display-name NAME [--email] [--system-admin] [--pseudonym]` | `Created user 'u' (pseudonym ann-0001).` followed by the code block below |
| `users reset-code USERNAME` | the code block |
| `users deactivate` / `activate USERNAME` | `'u': active=…, system admin=….` |
| `users set-admin USERNAME --on/--off` | the same |
| `users list` | one line per user: `username\tpseudonym\tdisplay name\tactive[, admin]` |
| `hash-password` | reads the password with a getpass prompt twice on a TTY, otherwise one line from stdin; checks the rules; prints the PHC hash |
| `recover-admin --input FILE` | see below |

The code block is: `<Setup|Reset> code for 'u' (single use, valid until YYYY-MM-DD HH:MM UTC):`, then the code indented by two spaces on its own line, then `Hand it to the user out of band. It is not shown again.`

Errors are `Error: <CODE>: <details>` with exit 1. All actions use `Actor.cli()`.

`recover-admin`:
- the input file must be private (`st_mode & 0o077 == 0` on POSIX), at most 8 KiB, and contain exactly `{username, password_hash, operator, reason}`;
- under `exclusive_lease`; if the lease is held it refuses with "Stop the Ontocurator service first; it is still running.";
- otherwise it calls `AccountService.recover_admin` and prints `Recovered 'admin'; all of its sessions were ended.`;
- no plaintext password is ever written to disk (D2).

**Tests:** `tests/test_admin_cli.py`, 6 tests. They use `CliRunner` with `--database-url database_url_for(tmp_path/"editor.db")`.
- `test_create_prints_the_pseudonym_and_a_single_use_code`: the printed code can be redeemed; the audit actor label starts with `cli:`.
- `test_a_taken_username_is_an_error`: exit 1 with `USERNAME_TAKEN`.
- `test_reset_deactivate_and_admin_flag`.
- `test_hash_password_prints_an_argon2id_hash`: stdin input; `verify_password` accepts the result.
- `test_recovery_waits_for_the_service_to_stop`: with a held `RuntimeLease` it gives exit 1; after `release()` it gives exit 0 and the new password logs in.
- `test_recovery_refuses_a_readable_input_file`: skipped on Windows.

**Acceptance:** `6 passed`, or `5 passed, 1 skipped` on Windows. Commit: `feat(auth): user administration CLI, password hashing and offline admin recovery`.

---

### Task 8: The login gate in the frontend

**Create:** `frontend/src/app/AuthGate.tsx`, `frontend/src/app/LoginScreen.tsx`, `frontend/tests/session.ts` (helper) and `frontend/tests/session.test.tsx`. **Delete** `frontend/src/app/SessionLostScreen.tsx`. **Modify** `api/client.ts`, `App.tsx`, `app/CaseScreen.tsx` and `main.tsx` (render `<AuthGate />`).

**`api/client.ts`:**
- **Removed:** the token machinery (`initSessionToken`, `parseLaunchHash`, `parseTokenInput`, `takeLaunchPackageId`, `get/setActiveSessionToken`, `onSessionLost`, `sessionLostReasonOf`, `isSessionLostError`) and the `token` option.
- **Added:**
  - `type CurrentUser`;
  - `AuthError(message, details?, code="FORBIDDEN", status=403)`;
  - `onSessionExpired(listener) -> unsubscribe` and `isSessionExpired(err)`;
  - on `ApiClient`: `setCsrfToken(t)`, `me()`, `login(u, p)`, `redeemCode(u, code, newPassword)` and `logout()`. `me`, `login` and `redeemCode` store the CSRF token.
- `request()` must behave exactly like this:

```ts
const method = (options.method ?? "GET").toUpperCase();
if (method !== "GET" && method !== "HEAD" && this.csrfToken && !headers.has("X-CSRF-Token")) {
  headers.set("X-CSRF-Token", this.csrfToken);
}
const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
// errors:
if (response.status === 401) {
  if (!endpoint.startsWith("/api/v1/auth/")) notifySessionExpired();   // a failed login is no expiry
  throw new AuthError(message, details, code ?? "NOT_AUTHENTICATED", 401);
}
if (response.status === 403) throw new AuthError(message, details, code);
// success:
if (response.status === 204) return undefined as T;
```

  Downloads use `fetch(url, { credentials: "same-origin" })`; a 401 there also notifies.

**`LoginScreen`:**
- A form named "Log in to Ontocurator" with the labels "Username" and "Password" and the button "Log in".
- The toggle button "I have a setup or reset code" switches to the form "Set your password". It has the labels "Username", "Setup or reset code", "New password" (hint "At least 12 characters.") and "Repeat the new password", and the button "Set password and log in". "Back to login" switches back.
- Errors are shown as `role="alert"`. "The two passwords differ." is checked on the client.
- It reuses the `.session-lost` and `.session-lost-card` styles.

**`AuthGate`:**
- States: checking, anonymous (optional notice) and ready(user).
- `api.me()` decides the state.
- `onSessionExpired` leads to anonymous with the notice "Your session has ended. Please log in again."
- Ready renders `<App user={user} onLogout={…} />`. Logout calls `api.logout()` and goes back to anonymous.

**`App.tsx`:**
- New props `{ user?: CurrentUser | null; onLogout?: () => void }`. Without `user` (component tests) the app calls `api.me()` itself and falls back to null.
- The annotator is always `user.pseudonym`.
- Removed: the initials field, the "You are annotating as" dialog, the preset `annotatorId` of the settings, the launch hash and the session-lost screen.
- The header shows `data-testid="current-user"` with "display name · pseudonym" and a "Log out" button.
- The upload controls (ontology button, import button, file inputs, guide import) are shown only if `is_system_admin`. The guide for other users reads "No work packages are available yet. Ask an administrator to add one."
- "Open case" is disabled without a user, with the hint "Log in to open cases."
- `openWorkspace` still sends `annotator_id` (the pseudonym), and `listDocuments` sends `annotator_id` and `mode` as before, so existing spies keep matching.

**`CaseScreen`:** a new optional prop `annotatorName`. The badge reads `Annotating as <strong>{annotatorName ? "name (pseudonym)" : pseudonym}</strong>`, with the title "…saved under this pseudonym".

**Test helper `tests/session.ts`:**
- `testUser(pseudonym, overrides)`: username derived from the pseudonym, system admin, `csrf_token: "csrf-test"`.
- `loggedInAs(pseudonym)`: `vi.spyOn(api, "me").mockResolvedValue(testUser(...))`.

**New `tests/session.test.tsx`** (4):
- "sends cookies, and the CSRF token on writes but not on reads";
- "reports an ended session on 401, but not a failed login": the listener sees exactly one event;
- "shows the login form without a session and the app after logging in": the header reads "Alice · ann-0007", and "Log out" is present;
- "redeems a setup code after checking that both passwords match".

**Changes to the existing frontend tests:** these follow from the inventory of every test that depended on the token, the initials or the presets.

| File | Change |
|---|---|
| `apiClient.test.ts` | Delete "extracts token from URL hash…" and "adds Authorization header…"; `new ApiClient({token})` becomes `new ApiClient()`. |
| `firstRun.test.tsx` | Remove the token imports and `beforeEach`. Delete the describe "session token: restart detection", and the tests "shows a 3-step guide…", "has no default identity…", "asks to confirm the identity once…", "prefills the last identity…" and "rejects identities with control characters…". Remaining tests call `loggedInAs("annotator-1")` before `render`; "offers a single primary 'Open case' action" uses `loggedInAs("JPL")`. |
| `dashboard.test.tsx`, `review-findings.test.tsx`, `workflow-regressions.test.tsx` | `asAnnotator(id)` first calls `loggedInAs(id)`. `confirmIdentity` becomes `async () => {}`. Remove the token imports and calls. |
| `review-findings.test.tsx` | Delete "parses #token=T&package_id=P…", "preselects the package passed in the launch link" and "does not refetch on every keystroke…". The export filename test uses `new ApiClient()` and asserts `fetchMock.mock.calls[0][1]` equals `{ credentials: "same-origin" }`. |
| `workflow-regressions.test.tsx` | Delete "restores the tab token on reload and downloads exports with authorization". |
| `distribution.test.tsx` | Remove the token import and call; delete "prefills a preset identity but still asks for confirmation". |
| `caseTree.test.tsx` | "is docked whatever an older workspace has stored…": add `loggedInAs("dr-a")` and remove the "Yes, continue" click. |
| `ontologyUpload.test.tsx` | `loggedInAs("annotator-1")` before every `render(<App />)`. |

**Acceptance:**
- `grep -rnE "initSessionToken|setActiveSessionToken|parseLaunchHash|takeLaunchPackageId|parseTokenInput|getActiveSessionToken|SessionLost|onSessionLost|Yes, continue|Change initials|Your initials|dashboard-identity" frontend/src frontend/tests` prints nothing.
- `npm --prefix frontend run typecheck && npm --prefix frontend test` passes.
- Commit: `feat(frontend): log in with username and password; the identity comes from the session`.

---

### Task 9: Browser tests with real logins, embedded assets and the gate

**`tests/browser_server.py`:**
- remove the token from `AppConfig`;
- add `TEST_PASSWORD = "browser test passphrase"`;
- add the test-only route `POST /__test_user__?username=&pseudonym=&setup=false`:
  - it creates a system admin with that pseudonym;
  - with `setup=true` it returns `{"code": …}` instead of redeeming;
  - otherwise it redeems the code with `TEST_PASSWORD`;
  - it is idempotent;
- keep two `app.router.routes.insert(0, app.router.routes.pop())` lines, so both test routes precede the static mount.

**`frontend/browser/helpers.ts`:**
- `LAUNCH_URL = "/"`, `TEST_PASSWORD`.
- `loginAs(page, pseudonym)`:
  - the username is the pseudonym lower-cased, with characters outside `[a-z0-9._-]` replaced by `-`;
  - POST `/__test_user__`;
  - `goto("/")`;
  - fill the form "Log in to Ontocurator";
  - expect `current-user` to contain the pseudonym.
- `openCase(page, _opts)`: clicks "Open case"; no dialog.
- `importPackage(page, query, packageId, annotator)`: `loginAs` replaces the token link and the initials; the upload stays as before.

**Specs:**
- `workflow.spec.ts`: replace the "first run" test with two tests:
  - "first run: log in, import from the guide, open a case without typing initials": the guide contains no "initials"; after opening, `annotator-identity` contains `first-run`;
  - "login: a wrong password is refused; a setup code sets the password and logs in": an alert contains "Username or password is wrong"; after the code flow `current-user` is shown; "Log out" brings back the login form.
- `tree.spec.ts`: replace the `dashboard-identity` check with `expect(page.getByTestId("current-user")).toBeVisible()`. The cookie survives the reload.
- Other specs are unchanged; they go through `importPackage` and `openCase`.

**Embedded assets:** `npm --prefix frontend run build`, then replace `src/ontocurator/web/` with `frontend/dist/` (remove the old `assets/`).

**Acceptance:**
- `grep -rnE "#token=|Your initials|dashboard-identity|Yes, continue" frontend/browser` prints nothing.
- `scripts/check.sh` passes.
- Commit: `test(browser): log in through the login screen; rebuild embedded assets`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| P1: loopback guard, bearer token, `instance.py`, standalone build replaced | 1, 6 |
| P3: DB sessions; HttpOnly, Secure on HTTPS, SameSite=Lax; CSRF on writes; immediate revocation; no JWT; same-origin SPA | 5, 6 |
| P4: Argon2id, throttling and lockout | 3, 5 (D-i, D-j, Q7, Q8) |
| D2: first admin from `*_HASH_FILE` once; setup 24 h and reset 15 min, single use, shown once; revocation on password, role or status change; offline recovery with operator and reason; no SMTP | 4, 6, 7 |
| E2 refined by R1: username login, optional e-mail | 2, 8 |
| P5: audit hook for administrative writes | 4 (project actions in T2c) |
| Spec testing: login, lockout, revocation, CSRF rejection, codes single use and expiry | 4, 5, 6 |
| Roles per project, `can()`, project scoping, edit events | T2c |
