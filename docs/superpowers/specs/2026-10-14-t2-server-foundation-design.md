# T2: Server Foundation (database, accounts, roles, Docker)

Date: 2026-10-14 · Status: **design agreed, file review pending** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E1, E2, E3, E6, E9, E11, E12)

T2 turns Ontotator from a local single-user tool into a multi-user web service. Workflows (T4), admin screens (T3) and translation review (T5) build on it.

## Starting point

- FastAPI app with a loopback-only guard and a fresh bearer token per launch (`api/security.py`), one instance per workspace (`.ontotator.lock`).
- SQLite `ontotator-workspace/v4` behind a ~1600-line raw-SQL `storage/repository.py`.
- Identity is typed initials; no users, roles or assignments.
- Domain (`domain/`), ontology/search (`ontology/`) and application services are reusable. `packages/` (ZIP v2) becomes obsolete per E6. Its import/export role moves to the T1 format.

## Proposed defaults (to be confirmed)

- **P1, evolve in place:** The work happens in this repository, keeping domain, ontology and search code and their tests. Replaced are the storage layer, `api/security.py`, `instance.py`, the PyInstaller/standalone build and the v2 package format.
- **P2, persistence:** SQLAlchemy 2.0 with typed ORM mappings and Alembic migrations, using PostgreSQL 16+. Immutable snapshots and submissions are stored as JSONB, and content hashes stay as they are today (RFC 8785).
  - Optimistic concurrency stays: a revision is checked on write, and a mismatch returns 409.
- **P3, sessions:** Sessions are server-side and stored in the database. The browser holds them in an HttpOnly, Secure, SameSite=Lax cookie, with a CSRF token for state-changing requests.
  - Sessions can be revoked immediately, for example when a user is deactivated.
  - There is no JWT refresh logic. The SPA is served same-origin by the backend.
- **P4, passwords:** Argon2id via `argon2-cffi`, with login throttling and lockout following the Phentrieve auth design.
- **P5, authorization:** One central policy layer, `can(user, action, resource)`, evaluates the global role (system admin) and the per-project roles (lead, annotator, adjudicator).
  - Every repository query for project data is scoped by project membership (E3).
  - An audit hook records every write.
- **P6, background work:** Imports, exports and agreement recomputation run as jobs in a `jobs` table and are executed in-process by a small worker loop. There is no Redis or Celery at this scale (E12).
- **P7, ontologies:** The system admin uploads ontologies (OBO Graph JSON plus translation files). Projects pin an ontology version by SHA-256.
  - Each worker process loads the pinned ontologies lazily and caches them.
- **P8, tests:** Tests use PostgreSQL through testcontainers locally (Docker is available) and a service container in CI. SQLite is not used as a test stand-in.
- **P9, performance targets** (E12, 30 concurrent users):
  - term search p95 < 150 ms;
  - document open p95 < 300 ms;
  - annotation write p95 < 150 ms.

  A load test (e.g. Locust) against the Docker setup verifies them.

## Decisions

- **D1, hosting follows the Limin pattern** (`../limin`: `docker-compose.web-staging.yml`, `Dockerfile`, `.planning/docs/process/web-staging-operations.md`).
  - **What this repository ships:** a verified application image and a compose service contract (app + PostgreSQL). It ships no reverse proxy, TLS or host provisioning.
  - **TLS:** terminated by an external Nginx Proxy Manager, the same as Phentrieve and Limin. Host deployment, DNS and certificates belong to a separate deployment repository.
  - **Proxy configuration:** `ONTOTATOR_PUBLIC_ORIGIN` is set to the exact public HTTPS origin. `ONTOTATOR_TRUSTED_PROXIES` lists the exact proxy peer addresses. Forwarded headers are honoured only from those peers. The app port is never published publicly.
  - **Hardened runtime:**
    - non-root user, `read_only` root filesystem with explicit volumes and tmpfs;
    - `cap_drop: [ALL]`, `no-new-privileges`, `init`;
    - bounded `mem_limit`, `cpus` and `pids_limit`, and rotated json-file logs;
    - `restart: unless-stopped`.
  - **Health:** `/livez` (process alive) and `/readyz` (database reachable, migrations at head, ontologies loaded). The Docker healthcheck uses `/readyz`.
  - **Secrets:** read via `*_FILE` variables from a read-only secrets volume, never as plain environment values in the service contract. Base images are pinned by digest.
  - **PostgreSQL roles:** a bootstrap role creates a non-superuser application role that owns a dedicated schema (init script as in `docker/postgres-init.sh`). The application never connects as superuser.
  - **Development:** a separate dev compose binds the app and PostgreSQL to `127.0.0.1` with dev-only credentials.
- **D2, account recovery without e-mail** (Limin pattern; resolves open question 2):
  - **First admin:** the first start creates `admin` from an Argon2id hash supplied once via `ONTOTATOR_ADMIN_PASSWORD_HASH_FILE`. Later starts ignore it.
  - **New users:** an administrator creates them, and they receive a single-use setup code (valid 24 h, because it is handed over out of band; shown only to that administrator).
  - **Password resets:** issued as single-use reset codes the same way (valid 15 min).
  - **Session revocation:** changing a password, role or activation status revokes the affected sessions.
  - **Lost admin password:** an offline recovery CLI (service stopped, private input file, operator and reason recorded).
  - SMTP is not needed. E-mail delivery can be added later as an optional transport for the same codes.
- **D3, files:** uploaded ontologies, translation files and import/export artifacts are stored on the `/data` volume, addressed by SHA-256. Their metadata lives in PostgreSQL. There is no object storage (S3), which this scale does not need.
- **D4, process model:** one application container. Uvicorn runs a configurable number of workers (default 2; ≈150 MB each for HPO). Sessions live in the database, so several workers need no cross-process invalidation. CPU-heavy work runs as jobs (P6).

- **D5, scope: the current editor as a web service.** After T2:
  - Logged-in project members annotate with the current editor (independent mode and the existing review mode) on PostgreSQL.
  - Projects, users, memberships, ontologies and documents are created by a CLI (`ontotator admin …`) until the admin UI arrives with T3. Documents and proposals are imported in the T1 format.
  - Submitted results are exported in the T1 format.
  - Not in T2: admin UI, assignments and distribution (T3); the stage-based workflows, merge, blind toggle and removal of the start-mode choice (T4); document variants (T5).
  - Dependency: the T1 package must exist before T2 import/export is implemented. This matches the roadmap order.

- **D6, provenance of every edit.** Today only submissions are fully traceable. Between two submissions the draft keeps just its current state: the content-addressed snapshots survive, but nothing records who replaced which version when, and the annotator ID is unauthenticated initials. In T2:
  - Every editing command is written to an append-only `edit_events` table in the same transaction as the change. This covers adding, deleting, changing a term or axis, resizing a span, adopting, deciding and submitting.
  - Each event records:
    - the authenticated user and session;
    - the timestamp;
    - the draft;
    - the revision before and after;
    - the command with its parameters;
    - the resulting snapshot versions.
  - The database role of the application gets only `INSERT` and `SELECT` on `edit_events`, `submissions`, `audit_events` and the snapshot tables. Even an application bug cannot rewrite history.
  - Administrative actions (users, roles, projects, imports, exports, releases) go to `audit_events` with the same guarantees.
  - Any earlier draft state can be reconstructed by replaying events over content-addressed snapshots. Every submission references the last event it contains.
  - **Export:** Releases contain only annotations in the T1 format. The project lead can additionally export the edit log as a separate, pseudonymised JSONL file. It is meant for method analyses such as editing time and number of corrections, and it uses the same pseudonyms as the T1 export (F10).

## Data model (first cut)

The model is new, as allowed by E6. Content-addressed snapshots, revisions and immutable submissions are kept from schema v4.

| Area | Tables |
|---|---|
| Identity | `users` (stable pseudonym per T1 F10, display name, optional ORCID + consent, status), `password_credentials`, `sessions`, `one_time_codes` (setup/reset) |
| Authorization | `projects`, `project_memberships` (user, project, roles: lead/annotator/adjudicator), global `users.is_system_admin` |
| Ontologies | `ontology_files` (sha256, kind ontology/translation, path on `/data`), `project_ontologies` (pinned per project, `allowed_roots`) |
| Documents | `documents` (project, `document_id`, language, canonical text, `text_sha256`, `source_text_sha256`), `document_order` |
| Annotation | `drafts` (user, document, mode, scope, revision), `draft_annotations` / `draft_evidence`, `annotation_snapshots`, `evidence_snapshots` (JSONB, content-addressed), `submissions` (immutable, JSONB payload), `review_decisions`, `search_events` |
| Operations | `jobs`, `edit_events` (append-only), `audit_events` (actor, action, target, timestamp, project), `mutation_receipts` (idempotency) |

Every project-owned table carries `project_id`. Repository methods take the caller's authorization context and filter by it. Detailed column definitions are part of the implementation plan.

## Testing

- Unit tests for the policy layer (`can`): every role × action, including denial for non-members.
- Repository tests against PostgreSQL (testcontainers), including project isolation: a user of project A never reads data of project B.
- Auth flow tests: login, lockout, session revocation on password/role/status change, CSRF rejection, setup and reset codes (single use, expiry).
- The existing domain, ontology and editor tests are kept and run against the new storage.
- The Playwright suite runs against the dev compose stack with a seeded project.
- Container checks: image starts as non-root on a read-only root filesystem; `/readyz` fails without a database or with pending migrations.
- Load test (P9) against the compose stack; results record workload and resource limits.

## Open questions

_(none at the moment)_
