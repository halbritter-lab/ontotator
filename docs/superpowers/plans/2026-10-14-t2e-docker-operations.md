# T2e: Docker, Health, Hardening and Load Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, configuration, checks and acceptance criteria per task. Implementers write the code test-first where code is involved; configuration that is a contract is given in full.

**Goal:** Ontocurator ships as a verified, hardened application image with a compose service contract (app, one-shot migration, PostgreSQL), following the Limin pattern (D1). Health probes, container checks, a browser smoke test against the stack and a load test show that it works and meets P9.

**Architecture:**
- **Production entry point:** `ontocurator serve --production` reads its configuration from the environment and secrets from `*_FILE`. It runs Uvicorn with N workers (D4) and honours forwarded headers only from the listed proxy addresses.
- **Probes:** `/livez` and `/readyz` sit outside `/api` and need no session. Readiness requires a reachable database, the schema at head and the pinned ontologies loaded.
- **Image and stack:** a multi-stage image (frontend build, uv sync with a BuildKit secret for the private `ontospan`, then a slim non-root runtime). Compose runs `postgres`, `migrate` (owner role, one shot; index D-d) and `app` (application role) with D1's hardening.
- **Verification:** a dev compose file for local work, a container check script, a Playwright smoke spec against the stack, and a Locust load test. An operations guide replaces the desktop README sections.

**Spec:** `docs/superpowers/specs/2026-10-14-t2-server-foundation-design.md` (D1, D4, P9, Testing). Limin references: `../limin/Dockerfile`, `../limin/docker-compose.web-staging.yml`, `../limin/docker/postgres-init.sh`, `../limin/.planning/docs/process/web-staging-operations.md`. Index: `docs/superpowers/plans/2026-10-14-t2-index.md`. Builds on T2d.

**Branch / worktree:** `feat/t2e-docker-operations` from `feat/t2d-ontologies-exchange`, worktree `.worktrees/t2e-docker-operations`. Baseline: `scripts/check.sh`. Docker Desktop with BuildKit (default) is required.

**No CI (index R2):** every check here is a local command. `scripts/check.sh` gains an opt-in container stage.

**Commit rule:** per task, `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit without AI attribution.

---

### Task 1: Health probes

**Create** `src/ontocurator/api/health.py`; **modify** `api/app.py` (include the router before the static mount).

**Interface:**
- `GET /livez` returns 200 `{"ok": true}`, or 503 while the app is draining (`app.state.draining`, set at shutdown).
- `GET /readyz` returns 200 `{"ok": true, "checks": {...}}` or 503 `{"ok": false, "checks": {...}}`. The checks:
  - `database`: `SELECT 1` succeeds within 2 s;
  - `schema`: `current_revision(conn) == head_revision()`;
  - `ontologies`: `app.state.ontologies_ready.is_set()` (T2d Task 2) and no failures among the pinned shas.
- The result is cached for 1 s, and concurrent probes share one evaluation (Limin: "coalesced and briefly cached so unauthenticated probes cannot fan out"). The check function runs in the thread pool.
- Both probes sit outside `/api`, so the session middleware does not apply.

**Tests:** `tests/test_health.py`.
- `test_livez_answers_without_a_session`.
- `test_readyz_is_ready_with_database_schema_and_ontologies`.
- `test_readyz_fails_while_ontologies_load` (`ontologies_ready` not set) and `test_readyz_fails_with_pending_migrations`. The second uses `pg_harness.unmigrated_database_url`, migrated only to `0001` with `command.upgrade(cfg, "0001")` through a helper.
- `test_readyz_fails_without_a_database`: an engine pointing to a closed port gives 503 with `checks.database == false` within 3 s.
- `test_readyz_is_cached`: two calls within 1 s run the check once (spy).

**Acceptance:** the tests pass. Commit: `feat(ops): liveness and readiness probes`.

---

### Task 2: The production entry point

**Create** `src/ontocurator/api/server.py`; **modify** `cli.py serve`, `settings.py` and `api/app.py`.

**`settings.server_settings(env) -> ServerSettings`:** a dataclass with these fields:

| Field | Source | Rule |
|---|---|---|
| `environment` | `ONTOCURATOR_ENV` (`development` or `production`; default `development`) | |
| `data_dir` | `ONTOCURATOR_DATA_DIR` (default `/data` in production) | |
| `public_origin` | `ONTOCURATOR_PUBLIC_ORIGIN` | required and `https://` in production; `canonical_origin` |
| `trusted_proxies` | `ONTOCURATOR_TRUSTED_PROXIES` | comma-separated exact IP addresses (`ipaddress.ip_address`); required in production; `*` and CIDR ranges are refused (Limin) |
| `workers` | `ONTOCURATOR_WORKERS` (default 2, D4) | 1..16 |
| `admin_password_hash` | `read_secret("ONTOCURATOR_ADMIN_PASSWORD_HASH")` | |
| database URL | `database_url()` (T2a) | in production the passwords must come from `*_FILE`: a direct `ONTOCURATOR_DATABASE_PASSWORD` is refused, as Limin refuses plaintext secrets |

**`api/server.py`:** `app_from_env() -> FastAPI` builds `AppConfig` from `server_settings`, with the embedded web assets, `public_origin` and the admin hash. In production FastAPI's `/docs` and `/openapi.json` are disabled: `create_app` gets `expose_docs: bool`.

**`cli.py serve --production`** reads only the environment and runs:

```python
uvicorn.run(
    "ontocurator.api.server:app_from_env", factory=True,
    host="0.0.0.0", port=8000, workers=settings.workers,
    proxy_headers=True, forwarded_allow_ips=",".join(settings.trusted_proxies),
    access_log=True, timeout_graceful_shutdown=30,
)
```

Without `--production`, `serve` behaves as before (development).

**Tests:** `tests/test_server_settings.py`.
- `test_production_needs_an_https_origin_and_exact_proxies`, with 4 cases: missing origin, `http://` origin, missing proxies, `*` as proxies. Each raises `SettingsError` naming the variable.
- `test_production_refuses_plaintext_database_passwords`.
- `test_development_defaults`.
- `test_app_from_env_hides_the_api_docs_in_production`: `/docs` gives 404.
- `test_forwarded_addresses_are_used_only_from_trusted_proxies`: with uvicorn's `ProxyHeadersMiddleware` configured as in `serve`, login attempts record the forwarded client address from a trusted peer and the peer address otherwise. This uses a `TestClient` with `client=(peer, port)` and wraps the app in the middleware, as the production path does.

**Acceptance:** the tests pass. Commit: `feat(ops): production settings, proxy trust and multi-worker serve`.

---

### Task 3: The image

**Create** `Dockerfile` and `.dockerignore`.

**`.dockerignore`** excludes `.git`, `.github`, `.worktrees`, `.venv`, `node_modules`, `frontend/node_modules`, `frontend/dist`, `**/__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `docs`, `tests`, `loadtest`, `*.db`, `*.sqlite*`, `**/secrets/` and `.env*`. It keeps `README.md` and `THIRD_PARTY_NOTICES.md`.

**Base images pinned by digest (D1).** Resolve each digest once and write it into the `FROM` line:

```bash
docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'
docker buildx imagetools inspect python:3.12-slim-bookworm --format '{{json .Manifest.Digest}}'
docker buildx imagetools inspect ghcr.io/astral-sh/uv:0.11 --format '{{json .Manifest.Digest}}'
```

Write each as `FROM <image>@sha256:<digest> AS <stage>`, and record the resolved tags and digests in `docs/operations.md`.

**Stages:** the structure is the contract.
1. `web`, on node: `npm ci` and `npm run build` in `frontend/`; the output is `/web/dist`.
2. `build`, on python with uv copied from the uv image:
   - `apt-get install --no-install-recommends git`;
   - copy `pyproject.toml`, `uv.lock`, `README.md`, `src/`, and `--from=web /web/dist` into `src/ontocurator/web/`;
   - install the dependencies without leaving the token in any layer:

```dockerfile
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN \
    --mount=type=cache,target=/root/.cache/uv \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:${GITHUB_TOKEN}@github.com/.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/" \
    uv sync --frozen --no-dev --no-editable --compile-bytecode
```

3. `runtime`, on python slim:
   - `apt-get install --no-install-recommends tini`; remove `pip`;
   - user and group `ontocurator` with uid/gid 1001, no shell;
   - copy `/app/.venv`; `ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 ONTOCURATOR_ENV=production ONTOCURATOR_DATA_DIR=/data`;
   - `mkdir /data && chown 1001:1001 /data`; `USER 1001:1001`; `EXPOSE 8000`; `VOLUME ["/data"]`; `STOPSIGNAL SIGTERM`;
   - healthcheck and entry point:

```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=4).status == 200 else 1)"]
ENTRYPOINT ["/usr/bin/tini", "--", "ontocurator"]
CMD ["serve", "--production"]
```

The start period is 60 s because HPO loads in about 5.5 s per worker (E11).

**Build command** (documented in `docs/operations.md`). The token needs read access to `janpower/ontospan` only:

```bash
gh auth token > "$TEMP/gh_token"     # or a fine-grained PAT with contents:read on ontospan
docker build --secret id=github_token,src="$TEMP/gh_token" -t ontocurator:dev .
rm "$TEMP/gh_token"
```

**Acceptance:**
- the build succeeds;
- `docker run --rm --entrypoint id ontocurator:dev -u` prints `1001`;
- `docker history --no-trunc ontocurator:dev | grep -i token` prints nothing.

Commit: `build: hardened multi-stage application image`.

---

### Task 4: The compose service contract, dev compose and PostgreSQL bootstrap

**Create** `docker-compose.yml`, `docker-compose.dev.yml`, `docker/postgres-init.sh` and `docker/env.example`.

**`docker/postgres-init.sh`** follows Limin; the roles and grants are the contract:

```sh
#!/bin/sh
set -eu
owner_password="$(cat /run/postgres/owner-password)"
app_password="$(cat /run/postgres/app-password)"
for value in "$owner_password" "$app_password"; do
  case "$value" in ''|*[!a-f0-9]*) echo 'Invalid generated credential (hex expected)' >&2; exit 1;; esac
done
case "$POSTGRES_DB" in ''|*[!a-z0-9_]*) echo 'Invalid database identifier' >&2; exit 1;; esac
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<SQL
CREATE ROLE ontocurator_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$owner_password';
CREATE ROLE ontocurator_app   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO ontocurator_owner, ontocurator_app;
CREATE SCHEMA ontocurator AUTHORIZATION ontocurator_owner;
GRANT USAGE ON SCHEMA ontocurator TO ontocurator_app;
SQL
```

These are the same statements as `tests/pg_harness.py` (T2a); a comment in each file points to the other.

**`docker-compose.yml`** is the deployable contract, without TLS or a proxy (D1). The rules:
- **Anchor `x-runtime`:** `restart: unless-stopped`, `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, json-file logging with `max-size: 10m` and `max-file: "3"`.
- **`postgres`:**
  - image `postgres:16.15-alpine3.24@sha256:<digest>`, resolved as in Task 3; user `70:70`;
  - `POSTGRES_DB=ontocurator`, `POSTGRES_USER=ontocurator_bootstrap`, `POSTGRES_PASSWORD_FILE=/run/postgres/bootstrap-password`;
  - volumes `postgres-data:/var/lib/postgresql/data`, `./secrets/postgres:/run/postgres:ro`, `./docker/postgres-init.sh:/docker-entrypoint-initdb.d/10-ontocurator.sh:ro`;
  - tmpfs `/tmp:size=64m` and `/var/run/postgresql:size=16m,uid=70,gid=70`;
  - `mem_limit: 1g`, `cpus: 1.0`, `pids_limit: 256`;
  - healthcheck `pg_isready -U ontocurator_bootstrap -d ontocurator`;
  - network `backend` only.
- **`migrate`:**
  - image `${ONTOCURATOR_IMAGE:?Set the verified image}`, `command: ["db", "upgrade"]`, `restart: "no"`;
  - env `ONTOCURATOR_MIGRATION_DATABASE_URL=postgresql://ontocurator_owner@postgres:5432/ontocurator`, `ONTOCURATOR_MIGRATION_DATABASE_PASSWORD_FILE=/run/secrets/owner-password`;
  - secrets volume `./secrets/app:/run/secrets:ro`, holding only `owner-password`;
  - `depends_on: postgres: {condition: service_healthy}`; network `backend`; limits 512m, 1 cpu.
- **`app`:**
  - image `${ONTOCURATOR_IMAGE:?}`; `init: false` (tini is PID 1);
  - `depends_on: postgres healthy, migrate: {condition: service_completed_successfully}`;
  - env `ONTOCURATOR_ENV=production`, `ONTOCURATOR_PUBLIC_ORIGIN=${ONTOCURATOR_PUBLIC_ORIGIN:?}`, `ONTOCURATOR_TRUSTED_PROXIES=${ONTOCURATOR_TRUSTED_PROXIES:?}`, `ONTOCURATOR_WORKERS=${ONTOCURATOR_WORKERS:-2}`, `ONTOCURATOR_DATABASE_URL=postgresql://ontocurator_app@postgres:5432/ontocurator`, `ONTOCURATOR_DATABASE_PASSWORD_FILE=/run/secrets/app-password`, `ONTOCURATOR_ADMIN_PASSWORD_HASH_FILE=/run/secrets/admin-password-hash`;
  - volumes `ontocurator-data:/data` and `./secrets/app:/run/secrets:ro`; tmpfs `/tmp:size=256m,mode=1777`;
  - `mem_limit: 2g` (2 workers × ≈150 MB HPO plus headroom; D4), `cpus: 2.0`, `pids_limit: 256`, `stop_grace_period: 35s`;
  - healthcheck `/readyz` as in the image;
  - networks `edge` (the proxy network, `name: ${ONTOCURATOR_EDGE_NETWORK:-ontocurator-edge}`) and `backend` (`internal: true`);
  - **no `ports:`**: the app port is never published (D1); the external proxy joins `edge`.
- **Secret files:** `secrets/postgres/{bootstrap-password,owner-password,app-password}` and `secrets/app/{owner-password,app-password,admin-password-hash}`, each mode 0600 and owned by the service UID (Limin). `docker/env.example` documents every variable.

> The `migrate` service mounts the owner password, while `app` and `migrate` share `./secrets/app`. Keep `owner-password` out of the app's view by giving `migrate` its own directory `./secrets/migrate` with only `owner-password`. The app directory then holds only `app-password` and `admin-password-hash`. Use this split; the operations guide documents it.

**`docker-compose.dev.yml`** is a standalone development stack:
- it builds the image locally (`build: { context: ., secrets: [github_token] }`, with `secrets.github_token.file: ${GITHUB_TOKEN_FILE:?}`);
- `ONTOCURATOR_ENV=development`;
- plaintext dev passwords inline, marked "development only";
- `ports: ["127.0.0.1:8000:8000"]` for the app and `["127.0.0.1:55432:5432"]` for PostgreSQL;
- the same migrate step;
- no read-only and limits relaxation beyond `read_only: true`, which stays to catch writes outside `/data` and `/tmp` early.

**Acceptance:**
- `docker compose -f docker-compose.yml config` validates with a filled `.env`;
- `docker compose -f docker-compose.dev.yml up -d --build --wait` brings `app` to `healthy`;
- `curl -fsS http://127.0.0.1:8000/readyz` gives `{"ok": true, …}`.

Commit: `build: compose service contract, dev stack and PostgreSQL role bootstrap`.

---

### Task 5: Container checks

**Create** `scripts/container_check.py`, run with `uv run python scripts/container_check.py [--image ontocurator:dev]`. It drives `docker` with `subprocess` and the dev compose file under a unique project name (`-p ontocheck<random>`). It prints PASS/FAIL per check, exits non-zero on any failure and tears the stack down at the end.

| Check | How | Expected |
|---|---|---|
| non-root | `docker compose exec app id -u` | `1001` |
| read-only root filesystem | `exec app sh -c 'touch /app/x'` | fails with "Read-only file system" |
| writable data and tmp | `exec app sh -c 'touch /data/x /tmp/x'` | succeeds |
| capabilities dropped | `docker inspect` of app: `HostConfig.CapDrop` | `["ALL"]` |
| no published app port (production contract) | `docker compose -f docker-compose.yml config --format json` | `services.app.ports` absent |
| `/readyz` without a database | `docker compose stop postgres`, then `exec app python -c …/readyz` | 503, `checks.database == false`; start postgres again |
| `/readyz` with pending migrations | run a fresh stack whose `migrate` is replaced by `db upgrade` to `0001` (`ONTOCURATOR_MIGRATE_TARGET=0001`, add this optional argument to `db upgrade`) | 503, `checks.schema == false` |
| app role cannot write history | `exec postgres psql -U ontocurator_app -c "UPDATE ontocurator.submissions SET mode='x'"` | `permission denied` |
| migrations never run as the app | `exec app ontocurator db upgrade` (no owner secret) | exit 1, `ONTOCURATOR_MIGRATION_DATABASE_URL is not set` |

`scripts/check.sh` gains a final stage that runs only when `CHECK_CONTAINERS=1` is set:

```bash
if [ "${CHECK_CONTAINERS:-0}" = "1" ]; then uv run python scripts/container_check.py; fi
```

**Acceptance:** `CHECK_CONTAINERS=1 scripts/check.sh` passes. Commit: `test(ops): container checks for the image and the compose contract`.

---

### Task 6: Browser smoke test against the compose stack

**Create:**
- `scripts/seed_stack.py`: it runs `docker compose -f docker-compose.dev.yml exec app ontocurator admin …` to
  - create `smoke-admin` (system admin) and `smoke-annotator`;
  - redeem their setup codes through `POST /api/v1/auth/redeem-code` with `Origin: http://127.0.0.1:8000`;
  - add `tests/fixtures/hp.json` with `admin ontologies add` (copied into the container through `docker compose cp`);
  - create project `smoke` from `tests/fixtures/smoke-profile.json` (a new fixture: the HP layer of `tests/layered_fixtures.py` scenario A as `TaskProfile` JSON);
  - add the annotator role;
  - import `tests/fixtures/smoke-bundle.zip`, a new fixture made with `ontospan.write_bundle` by `scripts/make_smoke_bundle.py` (committed together with the script; two documents, one tool proposal).
- `frontend/playwright.stack.config.ts`: `testDir: "./browser-stack"`, `baseURL: "http://127.0.0.1:8000"`, no `webServer`, `workers: 1`.
- `frontend/browser-stack/smoke.spec.ts` with one test, "stack smoke: log in, open the project, annotate, submit":
  - log in as `smoke-annotator`;
  - the dashboard lists `smoke`;
  - open the first case;
  - create an annotation through the search (`Hypotonia`, HP:0001252);
  - submit with "Entire text checked";
  - the dashboard shows the case as Completed.
- `package.json` script: `"test:stack": "playwright test -c playwright.stack.config.ts"`.

**Run:**

```bash
docker compose -f docker-compose.dev.yml up -d --build --wait
uv run python scripts/seed_stack.py
npm --prefix frontend run test:stack
docker compose -f docker-compose.dev.yml down -v
```

**Acceptance:** the smoke test passes against the stack. `scripts/check.sh` runs these steps inside the `CHECK_CONTAINERS=1` stage. Commit: `test(browser): smoke test against the compose stack with a seeded project`.

---

### Task 7: Load test (P9)

**Create** `loadtest/locustfile.py`, `loadtest/seed.py` and `loadtest/README.md`; `uv add --dev "locust>=2.32,<3"`.

**Seed (`loadtest/seed.py`):** against the dev stack it creates
- 30 users `load-01` … `load-30`, all annotators of project `load`;
- 1 000 synthetic documents of 1 500–3 000 characters, built from HPO labels and filler text with a fixed seed;
- for each document, 3 tool proposals;
- the ontology is the real HPO (`--hpo PATH` to `hp.json` 2026-06-23 or newer). Without it, the script refuses: measurements on the fixture ontology are not representative (E11).

**Workload** (`locustfile.py`, one `HttpUser` per seeded user; each logs in once with CSRF):

| Task (weight) | Request | P9 target (p95) |
|---|---|---|
| search (5) | `POST /api/v1/search` with a random 4–12 character query from HPO labels, `route="auto"`, on the user's open draft | < 150 ms |
| open (2) | `POST /api/v1/workspaces/open` for a random document | < 300 ms |
| write (4) | `POST /workspaces/{id}/commands` with `create_annotation`, then `set_axes` on it (expected revision tracked per draft) | < 150 ms |
| dashboard (1) | `GET /api/v1/packages/load/documents?mode=independent` | < 500 ms (index risk "dashboard listing") |

**Run** (stack limits as in `docker-compose.yml`: app 2 CPU / 2 GiB, 2 workers; PostgreSQL 1 CPU / 1 GiB):

```bash
uv run locust -f loadtest/locustfile.py --headless -u 30 -r 5 -t 5m \
  --host http://127.0.0.1:8000 --csv loadtest/results/$(date +%Y%m%d) --html loadtest/results/$(date +%Y%m%d).html
```

`locustfile.py` checks the targets in a `quitting` event handler: it sets `environment.process_exit_code = 1` if any p95 exceeds its target, and prints a table of the p50, p95 and p99 values per task.

**Record:** `docs/operations/load-test-2026-10.md` (create the folder). It records:
- the machine (CPU, RAM), Docker Desktop version and image digest;
- the workload above, the HPO release, the document count and the compose resource limits;
- the Locust table and whether each P9 target was met.

The spec requires recording workload and limits.

**If a target is missed:** do not tune blindly. Record the result, profile the slowest endpoint (`py-spy dump` in the container or PostgreSQL `EXPLAIN ANALYZE` of its queries) and stop; the follow-up is a separate decision. The dashboard listing already has a known batched-status alternative (index, risks).

**Acceptance:** the run completes, and the result file exists with the four measurements. Commit: `perf: Locust load test with P9 targets and recorded results`.

---

### Task 8: Operations guide and README

**Create** `docs/operations.md`; **rewrite** the user-facing parts of `README.md` (server only, E1). The guide covers:

1. **What this repository ships:** the image and the compose contract; TLS, the proxy (Nginx Proxy Manager), DNS and the host belong to the deployment repository (D1).
2. **Building:** the BuildKit secret for `ontospan`; how to resolve and update base-image digests; the image digest as the deployment input.
3. **Secrets:**
   - generating `bootstrap`, `owner` and `app` passwords as 64 hex characters (`openssl rand -hex 32`), and the admin hash with `docker run --rm -i <image> admin hash-password`;
   - file modes 0600, owner = service UID (1001 for app files, 70 for PostgreSQL files);
   - the split `secrets/postgres`, `secrets/migrate`, `secrets/app`.
4. **First start:**
   - `docker compose up -d --wait`;
   - the admin logs in as `admin`;
   - remove `admin-password-hash` afterwards; it is ignored once used (D2).
5. **Users and projects** with the CLI (`docker compose exec app ontocurator admin …`):
   - users: create, reset code, deactivate;
   - ontologies add; projects create and members; import and export; edit-log export.

   Codes are shown once and handed over out of band.
6. **Upgrades:** pull or build the new image; `docker compose up -d` runs `migrate` first. Migrations are forward-only, and a newer database is refused by `/readyz` (schema not at head).
7. **Backups:** `pg_dump` of the database and a copy of the `ontocurator-data` volume (blobs, translations, exports), taken together; restore order.
8. **Lost admin password:** stop `app`; write the recovery JSON (0600); run `docker compose run --rm app admin recover-admin --input /run/recovery.json` with the file mounted read-only; start `app`.
9. **Proxy settings:** forward the Host header and `X-Forwarded-For`/`-Proto`; `ONTOCURATOR_TRUSTED_PROXIES` lists the proxy's exact address on `edge`; `ONTOCURATOR_PUBLIC_ORIGIN` is the exact HTTPS origin.
10. **Resource limits and workers** (D4): what `ONTOCURATOR_WORKERS` costs in memory.
11. **Local checks:** `scripts/check.sh`, `CHECK_CONTAINERS=1`, the load test.

**Acceptance:** `scripts/check.sh` passes (with `CHECK_CONTAINERS=1` too); the guide's commands match the files. Commit: `docs: operations guide for the server deployment`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| D1: image plus compose contract, no proxy/TLS; `PUBLIC_ORIGIN`; exact `TRUSTED_PROXIES`; app port not published | 2, 4 |
| D1: non-root, read-only root with volumes and tmpfs, `cap_drop: ALL`, `no-new-privileges`, init (tini), memory/CPU/PID limits, rotated logs, `unless-stopped` | 3, 4, 5 |
| D1: `/livez`, `/readyz` (database, migrations at head, ontologies loaded); Docker healthcheck on `/readyz` | 1, 3, 4 |
| D1: secrets via `*_FILE` only; base images pinned by digest | 2, 3, 4 |
| D1: bootstrap role creates a non-superuser application role and schema; app never superuser | 4 (owner/app split, index D-c, D-d) |
| D1: dev compose on 127.0.0.1 with dev credentials | 4 |
| D4: one container, configurable Uvicorn workers (default 2), sessions in DB | 2, 4 |
| Testing: container starts non-root on a read-only root; `/readyz` fails without DB or with pending migrations | 5 |
| Testing: Playwright against the dev compose stack with a seeded project | 6 |
| P9: load test against the Docker setup, results with workload and limits | 7 |
