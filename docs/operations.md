# Server operations

This guide describes the image and Compose files in this repository. Commands run from the repository root. Shell blocks use Bash on the Linux deployment host unless labelled PowerShell; Git Bash is suitable for local checks. Replace example paths, image references and origins before use.

## Deployment boundary

`docker-compose.yml` provides PostgreSQL, a one-shot `migrate` service and `app`. TLS, DNS, host provisioning and the reverse proxy (such as Nginx Proxy Manager) belong in the deployment repository. The proxy must join the Compose `edge` network (`ontocurator-edge` by default). App listens on port 8000 inside that network and has **no published host port**. PostgreSQL is only on the internal backend network.

Services use read-only roots, writable data volumes and bounded tmpfs, dropped capabilities, `no-new-privileges`, rotated logs and resource limits. The image runs as UID/GID `1001:1001` with tini as PID 1. PostgreSQL runs as `70:70`. App and PostgreSQL restart unless stopped; migrations are one-shot. Connect PostgreSQL directly or use session-mode pooling: servers hold a PostgreSQL advisory runtime lease, which transaction-mode pooling would break.

## Build and verify an image

The Dockerfile builds the frontend and embeds it in the Python environment. `ontospan` is pinned to a Git commit in `pyproject.toml` and `uv.lock`. The build needs a GitHub token with read access to that private repository. Pass it only as the BuildKit secret `github_token`, never as a build argument, dependency URL or committed file.

With an existing authenticated GitHub CLI session, capture its token in process memory. Do not enable shell tracing or print the token. Bash:

```bash
GITHUB_TOKEN="$(gh auth token)" || exit 1
export GITHUB_TOKEN
docker build --secret id=github_token,env=GITHUB_TOKEN -t ontocurator:release .
unset GITHUB_TOKEN
```

PowerShell:

```powershell
try {
    $env:GITHUB_TOKEN = gh auth token
    if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication failed' }
    docker build --secret id=github_token,env=GITHUB_TOKEN -t ontocurator:release .
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
} finally {
    Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
}
```

For a private token file instead, use `--secret id=github_token,src=/absolute/private/token`; restrict it to its owner. The standalone development Compose build uses `GITHUB_TOKEN_FILE` for this form.

Base images are pinned by manifest digest in `Dockerfile` (Node, Python and uv) and both Compose files (PostgreSQL). To update them, choose the intended upstream release and inspect its registry manifest:

```bash
docker buildx imagetools inspect node:24-bookworm-slim
docker buildx imagetools inspect python:3.12-slim-bookworm
docker buildx imagetools inspect ghcr.io/astral-sh/uv:0.11
docker buildx imagetools inspect postgres:16.15-alpine3.24
```

Record the manifest digest, check the required architecture is present, update every corresponding `tag@sha256:...` reference and rebuild. Mutable tags alone are not verification. Run the local and container checks against the rebuilt image before approving it.

Publish the approved image through your deployment process, then inspect its registry digest with `docker buildx imagetools inspect REGISTRY/ontocurator:RELEASE`. Set `ONTOCURATOR_IMAGE=REGISTRY/ontocurator@sha256:VERIFIED_MANIFEST_DIGEST` in the private `.env`. A local image ID is useful for local tests; a registry digest is the portable deployment input. Keep release identity and check results in the deployment record.

## Configuration and secrets

Copy `docker/env.example` to `.env` and set the verified image, exact HTTPS public origin, exact proxy peer IPs and edge network name. `.env` holds private deployment configuration; passwords belong in separate files. Production secrets use the relevant `*_FILE` settings. App gets only its database password and initial admin hash. The schema owner's URL/password are available only to `migrate`; the bootstrap role is only for PostgreSQL initialization.

On the Linux host, generate three independent 64-character hexadecimal passwords, and copy the same role password into each consuming directory:

```bash
umask 077
mkdir -p secrets/postgres secrets/migrate secrets/app
openssl rand -hex 32 > secrets/postgres/bootstrap-password
openssl rand -hex 32 > secrets/postgres/owner-password
openssl rand -hex 32 > secrets/postgres/app-password
cp secrets/postgres/owner-password secrets/migrate/owner-password
cp secrets/postgres/app-password secrets/app/app-password
```

Generate the admin Argon2id hash with the verified image. With `-i` and no TTY the CLI reads one password line from stdin; it does not provide a hidden prompt. Read with Bash's hidden input first, then pipe it, so neither command history nor a plaintext file holds the password:

```bash
read -r -s -p 'Initial admin password: ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | docker run --rm -i "$ONTOCURATOR_IMAGE" admin hash-password > secrets/app/admin-password-hash
unset admin_password
```

Here `$ONTOCURATOR_IMAGE` must also be exported in your shell; Compose's `.env` loading does not export shell variables. Check the hash command succeeded and output is a nonempty Argon2id hash before starting. Use a strong password meeting the CLI policy (at least 12 characters). On a real terminal, `docker run --rm -it "$ONTOCURATOR_IMAGE" admin hash-password` asks twice without echo; mintty/Git Bash may need `winpty`. Do not type a password into visible stdin.

Set ownership on the actual Linux host. Every secret file must be mode `0600`; directories must be traversable by their service owner. Windows bind-mount ACLs are not a substitute for Linux production permissions.

```bash
sudo chown -R 70:70 secrets/postgres
sudo chown -R 1001:1001 secrets/migrate secrets/app
sudo chmod 700 secrets/postgres secrets/migrate secrets/app
sudo find secrets/postgres secrets/migrate secrets/app -type f -exec chmod 600 {} +
```

| Host directory | Files | Consumer UID/GID |
| --- | --- | --- |
| `secrets/postgres/` | `bootstrap-password`, `owner-password`, `app-password` | `70:70` |
| `secrets/migrate/` | `owner-password` | `1001:1001` |
| `secrets/app/` | `app-password`, initial `admin-password-hash` | `1001:1001` |

Keep these directories out of source control and public backups. Changing initialization password files after the database exists does not rotate PostgreSQL roles: initialization runs only on an empty PostgreSQL volume. Coordinate role changes with consuming files during planned rotation.

## First start

Provision the proxy/network configuration, `.env` and service secrets first:

```bash
docker compose config --quiet
docker compose up -d --wait
docker compose ps --all
```

PostgreSQL initialization creates separate non-superuser owner and app roles and the application schema. `migrate` upgrades that schema as owner, and only successful completion allows app to start. Sign in at your HTTPS origin as `admin` with the password used to generate the bootstrap hash.

After confirming admin exists and can sign in, remove `ONTOCURATOR_ADMIN_PASSWORD_HASH_FILE` from app's environment in your **deployment copy** of the Compose configuration. Recreate app with that revised configuration while the hash file still exists:

```bash
docker compose up -d --wait --force-recreate app
```

Confirm sign-in still works, then remove `secrets/app/admin-password-hash` using the host's privileged file tools. Keep the environment-setting removal in your deployment configuration for future upgrades. The existing account ignores bootstrap content, but secret-file resolution happens before account bootstrap: deleting the file while its `_FILE` setting remains breaks a restart. Do not replace it with an empty setting or empty hash file.

`/livez` reports the HTTP process is alive. `/readyz` checks database reachability, schema equality to the image's migration head and ontology readiness, including failures affecting project pins. Docker health uses `/readyz`. A new empty server can be ready before its first ontology/project is added. Inspect `docker compose logs --tail 100 app migrate postgres` when startup or readiness fails; keep operational logs private.

## Users, ontologies and projects

Run administrative commands inside app; they inherit its application-role database configuration and `/data`. They act directly on the database and audit the CLI operator. No SMTP service is used. Setup/reset codes are printed once: give them to the user out of band. Setup codes last 24 hours; reset codes last 2 hours. Codes are groups of four letters and digits without look-alikes (no I, L, O, U); case, spaces and hyphens do not matter when typed.

```bash
docker compose exec app ontocurator admin users create alice --display-name 'Alice A.'
docker compose exec app ontocurator admin users reset-code alice
docker compose exec app ontocurator admin users deactivate alice
docker compose exec app ontocurator admin users activate alice
docker compose exec app ontocurator admin users list
```

Stage inputs on writable tmpfs, then register them into persistent storage. Stream incoming files through `exec -T`: the Docker daemon can refuse `docker compose cp` into a container with a read-only root even when the target is writable tmpfs. The helper below writes as app's UID 1001. Only use releases whose licenses permit your intended use.

```bash
stage_file() {
    docker compose exec -T app python -c 'import sys; from pathlib import Path; Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())' "$2" < "$1"
}
stage_file ./hp.json /tmp/hp.json
stage_file ./hp-de.babelon.tsv /tmp/hp-de.babelon.tsv
docker compose exec app ontocurator admin ontologies add /tmp/hp.json /tmp/hp-de.babelon.tsv
docker compose exec app ontocurator admin ontologies list
stage_file ./profile.json /tmp/profile.json
```

Replace `ONTOLOGY_SHA256` with the full hash printed for the ontology JSON; the task profile must define ontology id `hp` and the intended layers. [smoke-profile.json](../tests/fixtures/smoke-profile.json) illustrates the JSON structure with synthetic fixtures; supply your own release identity, hash and protocol. See the [scientific workflow](scientific-workflow.md) for protocol guidance. Workers discover uploaded ontologies on use; no restart is needed for a new upload.

```bash
docker compose exec app ontocurator admin projects create ward-7 --name 'Ward 7' --profile /tmp/profile.json --pin hp=ONTOLOGY_SHA256 --allowed-roots hp=HP:0000118 --t1-profile hp=hpo-phenotype
docker compose exec app ontocurator admin projects add-member ward-7 alice --role annotator
docker compose exec app ontocurator admin projects members ward-7
```

To remove that membership later, use `docker compose exec app ontocurator admin projects remove-member ward-7 alice --role annotator`. Membership changes end the user's sessions. Project roles are `lead`, `annotator` and `consolidator` (stored and shown in the API as `adjudicator`, which the CLI also accepts); repeat `--role` to assign several.

Import T1 documents/proposals and export submissions/edit logs, then copy outputs off the container. Choose fresh output filenames: existing outputs are refused.

```bash
stage_file ./proposals.zip /tmp/proposals.zip
docker compose exec app ontocurator admin import ward-7 /tmp/proposals.zip
docker compose exec app ontocurator admin export ward-7 /tmp/results.zip
docker compose cp app:/tmp/results.zip ./results.zip
docker compose exec app ontocurator admin export-edit-log ward-7 /tmp/edits.jsonl
docker compose cp app:/tmp/edits.jsonl ./edits.jsonl
```

Imports/exports are jobs, awaited by default; `--no-wait` queues them for a server worker. `/tmp` is ephemeral and limited to 256 MiB. For larger files use a provisioned private directory on `/data` or a deployment-managed writable staging mount, then clean up staged files after copying. Imported blobs and job outputs in persistent storage must remain with the database backup. Keep clinical exports private.

## Upgrades

Take a consistent database/data-volume backup first. Build or pull the verified new digest, update `ONTOCURATOR_IMAGE` in `.env`, and run:

```bash
docker compose pull
docker compose up -d --wait
docker compose ps --all
```

Compose runs the new image's `migrate` before the new app. For upgrades that cannot tolerate concurrent old workers, stop app first. Confirm migration exited successfully and app becomes ready before resuming access.

Migrations are forward-only. `/readyz` refuses any schema differing from the image's head, including a newer database paired with an older image. An image downgrade alone is not a database rollback. Restore the matching pre-upgrade database and data snapshot with its matching image when rollback is required.

## Backups and restore

Back up PostgreSQL and the `ontocurator-data` volume as one recovery point. PostgreSQL holds accounts, sessions, projects, annotations, ontology metadata and jobs; `/data` holds referenced blobs, ontology/translation files and exports. Neither half alone is complete.

**Deployment validation pending: the following paired backup/restore procedure has not been executed against a deployment.** Syntax and tool options have been checked; validate a complete recovery on an isolated host before relying on it.

Quiesce all writers: stop every app instance connected to this database, block new CLI writes, and wait for any running imports, exports or migration jobs to finish. Keep this maintenance restriction until both backup artifacts are complete. Leave PostgreSQL running. Use a new private backup directory for each recovery point. Run this block in Bash on the Linux deployment host against the intended source Compose project:

```bash
set -euo pipefail
umask 077
backup_dir=/private/backup/RECOVERY_POINT
mkdir "$backup_dir" # parent must exist; refuses an existing recovery point
docker compose stop app
app_container="$(docker compose ps --all --quiet app)"
test -n "$app_container"
data_volume="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$app_container")"
test -n "$data_volume"
helper_image="$(docker inspect --format '{{.Config.Image}}' "$app_container")"
test -n "$helper_image"
printf '%s\n' "$helper_image" > "$backup_dir/image-reference.txt"
docker compose exec -T postgres pg_dump --username=ontocurator_bootstrap --dbname=ontocurator --format=custom > "$backup_dir/database.dump"
docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges \
    --mount "type=volume,src=$data_volume,dst=/source,readonly" \
    --entrypoint tar "$helper_image" --numeric-owner --create --file=- --directory=/source . > "$backup_dir/data.tar"
test -s "$backup_dir/database.dump"
test -s "$backup_dir/data.tar"
(cd "$backup_dir" && sha256sum database.dump data.tar image-reference.txt > SHA256SUMS)
docker compose up -d --wait app
```

The volume is resolved from app's actual `/data` mount, never guessed from a project name. The archive helper uses the same verified image, has no network, reads the source volume read-only and records numeric owners. If any command fails, app stays stopped; investigate before releasing the maintenance restriction. Keep deployed Compose settings, ontology release identities and protected role credentials with this recovery record. `pg_dump` does not back up role passwords. Protect backups as clinical data. Bash streams binary data safely; older PowerShell versions may corrupt native binary redirection.

Restore only into a **fresh isolated target**, using the same image digest and role names. Prepare a separate deployment directory containing the matching Compose file, private `.env` and service-specific secrets. Its bootstrap/owner/app credentials must initialize the roles and match that target's consuming files. Remove app's bootstrap admin `_FILE` setting as described earlier: the restored database already contains admin. Configure a separate test origin/proxy; do not attach the target to the live proxy network or allow users/CLI writers during restoration.

The following block starts PostgreSQL alone so initialization provisions `ontocurator_bootstrap`, `ontocurator_owner` and `ontocurator_app`. Creating app's stopped container resolves its actual data volume without starting app or migrations. It then restores blobs before streaming the paired dump into PostgreSQL. Choose a unique target project; the guards refuse existing project containers or labelled volumes.

```bash
set -euo pipefail
umask 077
backup_dir=/private/backup/RECOVERY_POINT
restore_dir=/absolute/private/isolated-restore
restore_project=ontocurator-restore-unique
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
export ONTOCURATOR_IMAGE="$(cat "$backup_dir/image-reference.txt")"
export ONTOCURATOR_EDGE_NETWORK="${restore_project}-edge"
restore_compose=(docker compose --project-name "$restore_project" --env-file "$restore_dir/.env" --file "$restore_dir/docker-compose.yml")
test -z "$("${restore_compose[@]}" ps --all --quiet)"
test -z "$(docker volume ls --quiet --filter "label=com.docker.compose.project=$restore_project")"
"${restore_compose[@]}" config --quiet
"${restore_compose[@]}" up -d --wait postgres
"${restore_compose[@]}" create app
restore_app="$("${restore_compose[@]}" ps --all --quiet app)"
test -n "$restore_app"
restore_volume="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$restore_app")"
test -n "$restore_volume"
docker run --rm -i --network none --read-only --user 0:0 --security-opt no-new-privileges \
    --mount "type=volume,src=$restore_volume,dst=/restore" \
    --entrypoint tar "$ONTOCURATOR_IMAGE" --numeric-owner --same-owner --preserve-permissions --extract --file=- --directory=/restore < "$backup_dir/data.tar"
"${restore_compose[@]}" exec -T postgres pg_restore --username=ontocurator_bootstrap --dbname=ontocurator --clean --if-exists --exit-on-error < "$backup_dir/database.dump"
"${restore_compose[@]}" exec -T postgres psql --username=ontocurator_bootstrap --dbname=ontocurator --set=ON_ERROR_STOP=1 \
    --command="SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'ontocurator';"
```

The schema owner printed above must be `ontocurator_owner`. `pg_restore` retains the dump's ownership and grants; do not add `--no-owner` or `--no-acl`. The bootstrap role restores as superuser inside PostgreSQL, while app continues to receive only its application-role secret. Archive extraction preserves numeric ownership (including app UID/GID 1001) and modes. Keep both app and migrations stopped if any restore command fails.

Only after both halves restore successfully, start the matching migration/app services and check status:

```bash
"${restore_compose[@]}" up -d --wait
"${restore_compose[@]}" ps --all
```

Require successful migration completion and healthy app, then verify login, an ontology search, a restored project document and a new export through the isolated test origin. This is the deployment validation still required for the procedure. Upgrade only after the matched recovery point works.

Do not initialize or restore against the only copy of an existing deployment. A restored database containing admin does not need a bootstrap admin hash; keep its `_FILE` setting removed as described above.

## Lost admin password

Recovery is an offline, application-role CLI operation. Stop **all** app instances connected to the database. The runtime lease refuses recovery while a server runs. Generate a fresh Argon2id hash with the image's `admin hash-password`, then create a private UTF-8 JSON file with exactly these fields (at most 8 KiB):

```json
{"username":"admin","password_hash":"ARGON2ID_HASH","operator":"operator identity","reason":"lost password recovery"}
```

On the Linux host make the file owner `1001:1001`, mode `0600`, with a private parent directory. It contains a hash, never plaintext. Use an absolute path to a regular file, not a symlink. After applying the bootstrap environment cleanup above:

```bash
docker compose stop app
docker compose run --rm --no-deps -v /absolute/private/recovery.json:/run/recovery.json:ro app admin recover-admin --input /run/recovery.json
docker compose up -d --wait app
```

Recovery audits operator/reason and ends all sessions for that administrator. Confirm login with the new password, then remove the recovery file according to host policy. Keep PostgreSQL reachable during recovery. Never give app owner/bootstrap database credentials.

## Reverse proxy settings

Set `ONTOCURATOR_PUBLIC_ORIGIN` to the exact browser-facing HTTPS origin, for example `https://editor.example.org` (include a nondefault port if used). Set `ONTOCURATOR_TRUSTED_PROXIES` to comma-separated exact proxy peer IPs on `edge`, never `*` or a subnet. Allocate stable peer addresses in the deployment network so replacement does not silently change trust.

Forward the original `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. For nginx, configure `proxy_set_header Host $host;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and `proxy_set_header X-Forwarded-Proto $scheme;`. For a public nondefault port preserve its authority in Host. Ensure the first trusted proxy replaces untrusted incoming forwarded headers and any proxy chain is explicitly configured. Host validation, HTTPS session cookies, same-origin writes and per-client login throttling depend on these settings. Verify through the public origin after provisioning; TLS/proxy configuration is maintained outside this repository.

## Workers and resource limits

The production default is two Uvicorn workers (`ONTOCURATOR_WORKERS=2`, supported range 1–16). Sessions are shared in PostgreSQL, so routing needs no sticky session. Each worker has its own interpreter, ontology registry and search indexes: memory rises with worker count and loaded ontology size. Measure representative workloads before increasing workers.

The app contract limits it to 2 CPUs / 2 GiB, PostgreSQL to 1 CPU / 1 GiB and migrations to 1 CPU / 512 MiB. Each has a 256-PID limit; app has a 35-second stop grace period. Temporary files also consume container memory. More workers under unchanged limits can cause memory pressure or worse latency; worker count is not a throughput guarantee.

## Local verification

Install dependencies with `uv sync --dev --locked`, `npm --prefix frontend ci` and `npm --prefix frontend exec -- playwright install chromium`. Private Git access is required for Python dependencies. Run from Git Bash, Linux or macOS with Docker available:

```bash
bash scripts/check.sh
CHECK_CONTAINERS=1 bash scripts/check.sh
CHECK_CONTAINERS=1 CHECK_IMAGE=ontocurator:release bash scripts/check.sh
```

The base gate includes backend PostgreSQL and Playwright tests plus formatting, linting, typing, API drift and wheel checks. `ONTOCURATOR_TEST_PG_URL` can target a disposable test superuser database; never production. `CHECK_VITEST_WORKERS` bounds frontend test parallelism (default 2; use 4 on a dedicated machine); `CHECK_PYTEST_WORKERS` sets the backend pytest-xdist workers (default 4; 0 or 1 is serial) and `CHECK_PLAYWRIGHT_WORKERS` the browser workers (default 1). See [focused local checks](operations/local-checks.md) for partial phases and prerequisites. There is no active CI gate.

`CHECK_CONTAINERS=1` adds the container checker and browser smoke on one shared stack. Set `CHECK_IMAGE` to reuse a verified local image for app and migrations; otherwise the checker builds the dev image with `GITHUB_TOKEN_FILE`. For the container checks and smoke alone, run:

```bash
uv run python scripts/container_check.py --image ontocurator:release --smoke
```

The checker uses a unique disposable Compose project, temporary build placeholders for image reuse and cleans up that project's volumes. It seeds a project, runs browser smoke while the stack is healthy, then verifies readiness failures, permissions and production network settings. `--smoke` is optional for direct checker invocation. The seed/load-test harnesses stream inputs over stdin into writable `/tmp`; ontology uploads become searchable while workers remain running.

### Demo logins (loopback demo stacks only)

**Never for production.** For manual tests on a local loopback stack, `ONTOCURATOR_DEMO_LOGINS_FILE` may name a JSON file of demo accounts:

```json
[
  {"username": "demo-lead", "password": "…", "label": "Project lead"},
  {"username": "demo-annotator", "password": "…", "label": "Annotator"}
]
```

The file is read once at startup. The login page then shows a "Demo accounts" section with one button per account; a button logs in through the normal `/api/v1/auth/login` (same rate limits, lockouts, audit and session). To do so, `GET /api/v1/auth/demo-logins` sends **every listed password in plain text to every browser that opens the login page**. Only list throwaway demo accounts, mount the file read-only and keep the stack bound to `127.0.0.1`.

Unset (the default), nothing changes: the endpoint answers 404 and the page has no demo section. The server refuses to start with the setting when `ONTOCURATOR_ENV=production`, when the public origin is not a loopback address, or when `ontocurator serve` binds a non-loopback address. A container binds `0.0.0.0` internally, so there only the public origin is checked; keep the published port on `127.0.0.1`. While it is on, every start logs the warning `DEMO LOGINS ARE ON`.

For representative performance measurements, follow [loadtest/README.md](../loadtest/README.md). Use a fresh separate dev project, real HPO release from 2026-06-23 or newer, 1,000 synthetic documents and 30 synthetic users. Warm separately, then measure five minutes under the actual two-worker app and Compose limits. Record CPU/RAM, Docker version, image identity, ontology SHA/release, workload, percentiles, errors and resource evidence. Strict p95 targets are search 150 ms, open 300 ms, write 150 ms and dashboard 500 ms; equality fails. Preserve failed results and profile before tuning. Full measurement and performance acceptance remain pending until an actual run and report exist; harness tests provide no performance evidence. Generated `loadtest/results/` artifacts stay local by default.
