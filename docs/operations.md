# Server operations

This guide describes the image and Compose files in this repository. Commands run from the repository root. Shell blocks use Bash on the Linux deployment host unless labelled PowerShell; Git Bash is suitable for local checks. Replace example paths, image references and origins before use.

## Deployment boundary

`docker-compose.yml` provides PostgreSQL (`ontotator_postgres`), a one-shot `migrate` service and the app (`ontotator_app`); the development stack names them `postgres` and `app`. TLS, DNS, host provisioning and the reverse proxy belong to the host. The stack is designed to run behind Nginx Proxy Manager (NPM), possibly shared with other stacks: `ontotator_app` joins an external Docker network that NPM is also on (`NPM_SHARED_NETWORK_NAME`; recommended is a dedicated `ontotator_edge` network with NPM's address pinned, see [Reverse proxy settings](#reverse-proxy-settings)), so NPM forwards to `http://ontotator_app:8000`. The prefixed names avoid clashes on that shared network: NPM itself names its service `app`, and a plain `postgres` host could resolve to another stack's database. App has **no published host port**. PostgreSQL is only on the internal backend network. Compose does not create the NPM network; it must exist before `up`.

Services use read-only roots, writable data volumes and bounded tmpfs, dropped capabilities, `no-new-privileges`, rotated logs and resource limits. The image runs as UID/GID `1001:1001` with tini as PID 1. PostgreSQL runs as `70:70`. App and PostgreSQL restart unless stopped; migrations are one-shot. Connect PostgreSQL directly or use session-mode pooling: servers hold a PostgreSQL advisory runtime lease, which transaction-mode pooling would break.

## Build and verify an image

The Dockerfile builds the frontend and embeds it in the Python environment. `ontospan` is pinned to a Git commit in `pyproject.toml` and `uv.lock`. The build needs a GitHub token with read access to that private repository. Pass it only as the BuildKit secret `github_token`, never as a build argument, dependency URL or committed file.

With an existing authenticated GitHub CLI session, capture its token in process memory. Do not enable shell tracing or print the token. Bash:

```bash
GITHUB_TOKEN="$(gh auth token)" || exit 1
export GITHUB_TOKEN
docker build --secret id=github_token,env=GITHUB_TOKEN -t ontotator:release .
unset GITHUB_TOKEN
```

PowerShell:

```powershell
try {
    $env:GITHUB_TOKEN = gh auth token
    if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication failed' }
    docker build --secret id=github_token,env=GITHUB_TOKEN -t ontotator:release .
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

CI builds the image on pull requests (`.github/workflows/docker.yml`) and, on a pushed `vX.Y.Z` tag, publishes it (`.github/workflows/docker-publish.yml`) as `ghcr.io/halbritter-lab/ontotator` with tags `X.Y.Z`, `X.Y`, `sha-<commit>` and, for non-prerelease tags, `latest`; the run summary shows the `ONTOTATOR_IMAGE` digest reference. Set the GHCR package visibility once in the organization's package settings after the first publish. For manual or server-side publishing, publish an approved commit from a clean working tree with `bash scripts/publish-image.sh VERSION` (needs `docker login ghcr.io` with a token that may write packages; the build token comes from `GITHUB_TOKEN_FILE` or `gh auth token`). It refuses a VERSION that already exists in the registry, builds the image as above with tag `ghcr.io/halbritter-lab/ontotator:VERSION`, fails on fixable HIGH or CRITICAL findings from a pinned Trivy scan, pushes the tag and prints `ONTOTATOR_IMAGE=ghcr.io/halbritter-lab/ontotator@sha256:...`. The script pushes no `:latest` tag; put the digest reference in the private `.env.docker`. The image is built for the local machine's architecture; check it matches the server with `docker buildx imagetools inspect`. A local image ID is useful for local tests; a registry digest is the portable deployment input. Keep release identity and check results in the deployment record.

## Configuration and secrets

Copy `.env.docker.template` to `.env.docker`, link it as `.env` (`ln -sf .env.docker .env`, Compose reads `.env`) and set the verified image, exact HTTPS public origin, proxy network name and NPM's pinned address on it (see [Reverse proxy settings](#reverse-proxy-settings)). `.env.docker` holds private deployment configuration; passwords belong in separate files. Production secrets use the relevant `*_FILE` settings. App gets only its database password and initial admin hash. The schema owner's URL/password are available only to `migrate`; the bootstrap role is only for PostgreSQL initialization.

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

Each file must hold exactly 64 lowercase hex characters and a line feed. The PostgreSQL init script rejects anything else, including the carriage return that the MinGW `openssl` in Git Bash appends on Windows. There, pipe through `tr -d '\r'` (`openssl rand -hex 32 | tr -d '\r' > ...`).

Generate the admin Argon2id hash with the verified image. With `-i` and no TTY the CLI reads one password line from stdin; it does not provide a hidden prompt. Read with Bash's hidden input first, then pipe it, so neither command history nor a plaintext file holds the password:

```bash
read -r -s -p 'Initial admin password: ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | docker run --rm -i "$ONTOTATOR_IMAGE" admin hash-password > secrets/app/admin-password-hash
unset admin_password
```

Here `$ONTOTATOR_IMAGE` must also be exported in your shell; Compose's `.env` loading does not export shell variables. Check the hash command succeeded and output is a nonempty Argon2id hash before starting. Use a strong password meeting the CLI policy (at least 12 characters). On a real terminal, `docker run --rm -it "$ONTOTATOR_IMAGE" admin hash-password` asks twice without echo; mintty/Git Bash may need `winpty`. Do not type a password into visible stdin.

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

Provision the proxy/network configuration, `.env` and service secrets first. The PostgreSQL container runs as UID 70 and must be able to read the bind-mounted init script. A restrictive host umask (for example `027`) during checkout or copying leaves it mode `0640`, which that UID cannot read, so set the modes explicitly:

```bash
chmod 0755 docker
chmod 0644 docker/postgres-init.sh
docker compose config --quiet
docker compose up -d --wait
docker compose ps --all
```

PostgreSQL initialization creates separate non-superuser owner and app roles and the application schema. `migrate` upgrades that schema as owner, and only successful completion allows app to start.

If initialization fails, the data volume is left half-initialized: PostgreSQL restarts, reports healthy and skips initialization, but the roles `ontotator_owner` and `ontotator_app` and the `ontotator` schema are missing, so `migrate` fails (for example `password authentication failed` or `role "ontotator_owner" does not exist`) and app never starts. Look for the cause in the first lines of `docker compose logs ontotator_postgres`:

- `Invalid generated credential (hex expected)`: a password file is not 64 lowercase hex characters; see [Configuration and secrets](#configuration-and-secrets).
- `Permission denied` for `/docker-entrypoint-initdb.d/10-ontotator.sh`: the init script is not readable by UID 70; apply the `chmod` lines above.

Recovery is to delete the half-initialized volume and initialize again. This is safe **only on a brand-new deployment whose volume never held data**: `down --volumes` also deletes the app's data volume. Never run it on a deployment that has been in use; restore from a backup instead.

```bash
docker compose down --volumes
chmod 0755 docker && chmod 0644 docker/postgres-init.sh # and/or fix the secrets
docker compose up -d --wait
```

Sign in at your HTTPS origin as `admin` with the password used to generate the bootstrap hash.

After confirming admin exists and can sign in, remove `ONTOTATOR_ADMIN_PASSWORD_HASH_FILE` from app's environment in your **deployment copy** of the Compose configuration. Recreate ontotator_app with that revised configuration while the hash file still exists:

```bash
docker compose up -d --wait --force-recreate ontotator_app
```

Confirm sign-in still works, then remove `secrets/app/admin-password-hash` using the host's privileged file tools. Keep the environment-setting removal in your deployment configuration for future upgrades. The existing account ignores bootstrap content, but secret-file resolution happens before account bootstrap: deleting the file while its `_FILE` setting remains breaks a restart. Do not replace it with an empty setting or empty hash file.

`/livez` reports the HTTP process is alive. `/readyz` checks database reachability, schema equality to the image's migration head and ontology readiness, including failures affecting project pins. Docker health uses `/readyz`. A new empty server can be ready before its first ontology/project is added. Inspect `docker compose logs --tail 100 ontotator_app migrate ontotator_postgres` when startup or readiness fails; keep operational logs private.

## Users, ontologies and projects

Run administrative commands inside app; they inherit its application-role database configuration and `/data`. They act directly on the database and audit the CLI operator. No SMTP service is used. Setup/reset codes are printed once: give them to the user out of band. Setup codes last 24 hours; reset codes last 2 hours. Codes are groups of four letters and digits without look-alikes (no I, L, O, U); case, spaces and hyphens do not matter when typed.

```bash
docker compose exec ontotator_app ontotator admin users create alice --display-name 'Alice A.'
docker compose exec ontotator_app ontotator admin users reset-code alice
docker compose exec ontotator_app ontotator admin users deactivate alice
docker compose exec ontotator_app ontotator admin users activate alice
docker compose exec ontotator_app ontotator admin users list
docker compose exec ontotator_app ontotator admin users edit alice --email alice@example.org --languages de,en
docker compose exec ontotator_app ontotator admin audit --user alice --since 2026-10-01
```

`users list` shows e-mail, setup state ("setup pending" until the setup code is redeemed) and projects. `admin audit` prints the audit trail newest first (`--project`, `--limit`, `--json` for JSONL). To erase a person's data on request (GDPR Art. 17), deactivate the account, then run `ontotator admin users anonymise alice --confirm alice` (or use Anonymise on the Users page). It cannot be undone.

- Erased: display name (becomes "Anonymised user"), e-mail, ORCID and its consent, qualification, languages, editor preferences, the password hash, all setup/reset codes, the login attempts recorded under the username, the client address and browser of every past session, and the replay receipts of their edits. The username becomes `anonymised-<id>` and is replaced in the audit trail (actor, target and `details.username`) and in job labels. The audit trail is otherwise append-only; only this erasure may rewrite those fields, inside its own transaction.
- Kept: the account row with its id and pseudonym (`ann-NNNN`), the project memberships, and all research records written under the pseudonym (drafts, submissions, annotation and evidence versions, review decisions, consolidations, edit events) plus the audit events themselves, so exports and history remain complete.
- Not touched: free text a person typed into research records or problem reports, uploaded source documents, and export files already downloaded or stored. The export writers name people by pseudonym, not by username.

The username can be given to a new account afterwards; the new account does not inherit the erased history, which is tied to the account id.

Stage inputs on writable tmpfs, then register them into persistent storage. Stream incoming files through `exec -T`: the Docker daemon can refuse `docker compose cp` into a container with a read-only root even when the target is writable tmpfs. The helper below writes as app's UID 1001. Only use releases whose licenses permit your intended use.

```bash
stage_file() {
    docker compose exec -T ontotator_app python -c 'import sys; from pathlib import Path; Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())' "$2" < "$1"
}
stage_file ./hp.json /tmp/hp.json
stage_file ./hp-de.babelon.tsv /tmp/hp-de.babelon.tsv
docker compose exec ontotator_app ontotator admin ontologies add /tmp/hp.json /tmp/hp-de.babelon.tsv
docker compose exec ontotator_app ontotator admin ontologies list
stage_file ./profile.json /tmp/profile.json
```

`ontotator admin ontologies check-roots` lists project pins whose allowed roots are missing from the pinned release; findings of such a pin are not restricted until the roots are corrected.

To check a single file against the checksum its release publishes, add `--sha256 <hex>`: a different file is refused with `ONTOLOGY_DIGEST_MISMATCH` and nothing is stored.

Replace `ONTOLOGY_SHA256` with the full hash printed for the ontology JSON; the task profile must define ontology id `hp` and the intended layers. [smoke-profile.json](../tests/fixtures/smoke-profile.json) illustrates the JSON structure with synthetic fixtures; supply your own release identity, hash and protocol. See the [scientific workflow](scientific-workflow.md) for protocol guidance. Workers discover uploaded ontologies on use; no restart is needed for a new upload.

```bash
docker compose exec ontotator_app ontotator admin projects create ward-7 --name 'Ward 7' --profile /tmp/profile.json --pin hp=ONTOLOGY_SHA256 --allowed-roots hp=HP:0000118 --t1-profile hp=hpo-phenotype
docker compose exec ontotator_app ontotator admin projects add-member ward-7 alice --role annotator
docker compose exec ontotator_app ontotator admin projects members ward-7
```

To remove that membership later, use `docker compose exec ontotator_app ontotator admin projects remove-member ward-7 alice --role annotator`. Membership changes end the user's sessions. Project roles are `lead`, `annotator` and `consolidator` (stored and shown in the API as `adjudicator`, which the CLI also accepts); repeat `--role` to assign several.

Import T1 documents/proposals and export submissions/edit logs, then copy outputs off the container. Choose fresh output filenames: existing outputs are refused.

```bash
stage_file ./proposals.zip /tmp/proposals.zip
docker compose exec ontotator_app ontotator admin import ward-7 /tmp/proposals.zip
docker compose exec ontotator_app ontotator admin export ward-7 /tmp/results.zip
docker compose exec -T ontotator_app cat /tmp/results.zip > ./results.zip
docker compose exec ontotator_app ontotator admin export-edit-log ward-7 /tmp/edits.jsonl
docker compose exec -T ontotator_app cat /tmp/edits.jsonl > ./edits.jsonl
```

`docker compose cp` cannot copy out of app's `/tmp` either: it reads the container filesystem, not the tmpfs mount, and reports that the file is missing. Stream outputs out with `exec -T ... cat` in Bash, never through PowerShell redirection. Imports/exports are jobs, awaited by default; `--no-wait` queues them for a server worker. `/tmp` is ephemeral and limited to 256 MiB. For larger files use a provisioned private directory on `/data` or a deployment-managed writable staging mount, then clean up staged files after copying. Imported blobs and job outputs in persistent storage must remain with the database backup. Keep clinical exports private.

## Upgrades

Take a consistent database/data-volume backup first, as in [Backups and restore](#backups-and-restore), before every image switch (upgrade, downgrade or rollback). Build or pull the verified new digest, update `ONTOTATOR_IMAGE` in `.env`, and run:

```bash
docker compose pull
docker compose up -d --wait
docker compose ps --all
```

Compose runs the new image's `migrate` before the new app. For upgrades that cannot tolerate concurrent old workers, stop ontotator_app first. Confirm migration exited successfully and app becomes ready before resuming access.

Migrations are forward-only. `/readyz` refuses any schema differing from the image's head, including a newer database paired with an older image. An image downgrade alone is not a database rollback. Restore the matching pre-upgrade database and data snapshot with its matching image when rollback is required.

## Backups and restore

Back up PostgreSQL and the `ontotator-data` volume as one recovery point. PostgreSQL holds accounts, sessions, projects, annotations, ontology metadata and jobs; `/data` holds referenced blobs, ontology/translation files and exports. Neither half alone is complete.

**Drill 2026-10-27: passed.** The procedure below was executed end to end with this repository's `docker-compose.yml` on throwaway Compose projects (Docker Desktop 6 GiB VM, Git Bash, image `ontotator:integration-20261027` built from `integration/2026-10-27` at `2efbb38e`, one worker, synthetic seed data: three users, `hp` ontology with a German translation, one project with an imported bundle of two texts and one proposal, a committed text upload, four submissions from two annotators, a T1 export and an edit-log export). After `docker compose down --volumes` of the source, the restore into a fresh project with fresh role passwords gave: schema owner `ontotator_owner`, migrate exited 0 at the same revision (`0022`), app healthy, `/readyz` all checks true, logins of all three users and a rejected wrong password, row counts of all 62 tables equal, every `/data` file byte-identical with equal numeric owners and modes, an ontology search, the restored documents listing, a byte-identical edit-log export, a T1 `admin export` whose documents are byte-identical (only the manifest's `bundle_id`/`created_at` differ, as for any new export), and a new text upload committed after restore. The `DOCUMENT_NOT_FOUND` failure of `admin export` seen on the 2026-10-26 image (`5478ddd`) does not occur on this image, before backup or after restore. Logins, search and uploads went through a drill-only client inside app that acted as the trusted proxy on `127.0.0.1`, not through a real HTTPS proxy. Timings: first start 18 s, backup including app stop and restart 14 s, destroy 2 s, restore up to the ownership check 15 s, start of migrate and app 10 s. Repeat the drill on the real Linux host with production-sized data before relying on it; dump and archive times grow with the data.

Quiesce all writers: stop every app instance connected to this database, block new CLI writes, and wait for any running imports, exports or migration jobs to finish. Keep this maintenance restriction until both backup artifacts are complete. Leave PostgreSQL running. Use a new private backup directory for each recovery point. Run this block in Bash on the Linux deployment host against the intended source Compose project:

```bash
set -euo pipefail
umask 077
backup_dir=/private/backup/RECOVERY_POINT
mkdir "$backup_dir" # parent must exist; refuses an existing recovery point
docker compose stop ontotator_app
app_container="$(docker compose ps --all --quiet ontotator_app)"
test -n "$app_container"
data_volume="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$app_container")"
test -n "$data_volume"
helper_image="$(docker inspect --format '{{ .Config.Image }}' "$app_container")"
test -n "$helper_image"
printf '%s\n' "$helper_image" > "$backup_dir/image-reference.txt"
docker compose exec -T ontotator_postgres pg_dump --username=ontotator_bootstrap --dbname=ontotator --format=custom > "$backup_dir/database.dump"
docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges \
    --mount "type=volume,src=$data_volume,dst=/source,readonly" \
    --entrypoint tar "$helper_image" --numeric-owner --create --file=- --directory=/source . > "$backup_dir/data.tar"
test -s "$backup_dir/database.dump"
test -s "$backup_dir/data.tar"
(cd "$backup_dir" && sha256sum database.dump data.tar image-reference.txt > SHA256SUMS)
docker compose up -d --wait ontotator_app
```

Run the block in the source deployment directory (or set `COMPOSE_PROJECT_NAME` and the same `--file`/`--env-file` options) so every `docker compose` command addresses the source project. Keep the spaces in `{{ .Config.Image }}`: the Docker CLI on Windows turns a space-free `{{.Config.Image}}` passed from Git Bash into the literal `.Config.Image`. In Git Bash also set `MSYS_NO_PATHCONV=1`, otherwise container paths such as `/source` are rewritten into Windows paths. `image-reference.txt` holds the reference app was started with; it identifies the image only if `.env` pins a digest. The final `up` also reruns the one-shot `migrate`, which finds the schema current. The volume is resolved from app's actual `/data` mount, never guessed from a project name. The archive helper uses the same verified image, has no network, reads the source volume read-only and records numeric owners. If any command fails, app stays stopped; investigate before releasing the maintenance restriction. Keep deployed Compose settings, ontology release identities and protected role credentials with this recovery record. `pg_dump` does not back up role passwords. Protect backups as clinical data. Bash streams binary data safely; older PowerShell versions may corrupt native binary redirection.

Schedule this backup rather than relying on manual runs: run it nightly (it stops app for the duration of the dump and archive, so pick a quiet hour), copy each recovery point off the host, encrypted, together with its `SHA256SUMS`, and keep several recovery points. A backup that exists only on the deployment host is lost with the host. Run it additionally right before every image switch (see [Upgrades](#upgrades)). Check regularly that the newest off-host copy verifies with `sha256sum --check`, and rehearse a restore as below after any change to this procedure or to the Compose files.

Restore only into a **fresh isolated target**, using the same image digest and role names. Prepare a separate deployment directory containing the matching Compose file, `docker/postgres-init.sh` at the same relative path (the Compose file mounts it from `./docker/`), private `.env` and service-specific secrets in `./secrets/`. Generate fresh bootstrap/owner/app passwords for the target as in [Configuration and secrets](#configuration-and-secrets): the dump carries no role passwords, so initialization sets the target's roles from its own files, and the consuming files must match them. Remove app's bootstrap admin `_FILE` setting as described earlier: the restored database already contains admin. Configure a separate test origin/proxy; do not attach the target to the live proxy network or allow users/CLI writers during restoration.

The following block starts PostgreSQL alone so initialization provisions `ontotator_bootstrap`, `ontotator_owner` and `ontotator_app`. Creating app's stopped container resolves its actual data volume without starting app or migrations. It then restores blobs before streaming the paired dump into PostgreSQL. Choose a unique target project; the guards refuse existing project containers or labelled volumes.

```bash
set -euo pipefail
umask 077
backup_dir=/private/backup/RECOVERY_POINT
restore_dir=/absolute/private/isolated-restore
restore_project=ontotator-restore-unique
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
export ONTOTATOR_IMAGE="$(cat "$backup_dir/image-reference.txt")"
export NPM_SHARED_NETWORK_NAME="${restore_project}-npm" # never the live NPM network
docker network create "$NPM_SHARED_NETWORK_NAME"
restore_compose=(docker compose --project-name "$restore_project" --env-file "$restore_dir/.env" --file "$restore_dir/docker-compose.yml")
test -z "$("${restore_compose[@]}" ps --all --quiet)"
test -z "$(docker volume ls --quiet --filter "label=com.docker.compose.project=$restore_project")"
"${restore_compose[@]}" config --quiet
"${restore_compose[@]}" up -d --wait ontotator_postgres
"${restore_compose[@]}" create ontotator_app
restore_app="$("${restore_compose[@]}" ps --all --quiet ontotator_app)"
test -n "$restore_app"
restore_volume="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$restore_app")"
test -n "$restore_volume"
docker run --rm -i --network none --read-only --user 0:0 --security-opt no-new-privileges \
    --mount "type=volume,src=$restore_volume,dst=/restore" \
    --entrypoint tar "$ONTOTATOR_IMAGE" --numeric-owner --same-owner --preserve-permissions --extract --file=- --directory=/restore < "$backup_dir/data.tar"
"${restore_compose[@]}" exec -T ontotator_postgres pg_restore --username=ontotator_bootstrap --dbname=ontotator --clean --if-exists --exit-on-error < "$backup_dir/database.dump"
"${restore_compose[@]}" exec -T ontotator_postgres psql --username=ontotator_bootstrap --dbname=ontotator --set=ON_ERROR_STOP=1 \
    --command="SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'ontotator';"
```

The schema owner printed above must be `ontotator_owner`. `pg_restore` retains the dump's ownership and grants; do not add `--no-owner` or `--no-acl`. The bootstrap role restores as superuser inside PostgreSQL, while app continues to receive only its application-role secret. Archive extraction preserves numeric ownership (including app UID/GID 1001) and modes. Keep both app and migrations stopped if any restore command fails.

Only after both halves restore successfully, start the matching migration/app services and check status. Run this in the same shell: it needs `restore_compose` and the exported `ONTOTATOR_IMAGE`/`NPM_SHARED_NETWORK_NAME`. Later commands against the target need them too; without them Compose reads the network name from the target's `.env` and may address the live NPM network. After `down --volumes` of a test restore, remove the separate network with `docker network rm "$NPM_SHARED_NETWORK_NAME"`.

```bash
"${restore_compose[@]}" up -d --wait
"${restore_compose[@]}" ps --all
```

Require successful migration completion and healthy app. `docker compose logs migrate` must report the revision the source ran (`SELECT version_num FROM ontotator.alembic_version`); with the same image digest no migration runs. Then verify login, an ontology search, a restored project document and a new export through the isolated test origin. Upgrade only after the matched recovery point works.

Do not initialize or restore against the only copy of an existing deployment. A restored database containing admin does not need a bootstrap admin hash; keep its `_FILE` setting removed as described above.

## Lost admin password

Recovery is an offline, application-role CLI operation. Stop **all** app instances connected to the database. The runtime lease refuses recovery while a server runs. Generate a fresh Argon2id hash with the image's `admin hash-password`, then create a private UTF-8 JSON file with exactly these fields (at most 8 KiB):

```json
{"username":"admin","password_hash":"ARGON2ID_HASH","operator":"operator identity","reason":"lost password recovery"}
```

On the Linux host make the file owner `1001:1001`, mode `0600`, with a private parent directory. It contains a hash, never plaintext. Use an absolute path to a regular file, not a symlink. After applying the bootstrap environment cleanup above:

```bash
docker compose stop ontotator_app
docker compose run --rm --no-deps -v /absolute/private/recovery.json:/run/recovery.json:ro ontotator_app admin recover-admin --input /run/recovery.json
docker compose up -d --wait ontotator_app
```

Recovery audits operator/reason and ends all sessions for that administrator. Confirm login with the new password, then remove the recovery file according to host policy. Keep PostgreSQL reachable during recovery. Never give app owner/bootstrap database credentials.

## Reverse proxy settings

Set `ONTOTATOR_PUBLIC_ORIGIN` to the exact browser-facing HTTPS origin, for example `https://editor.example.org` (include a nondefault port if used). Set `ONTOTATOR_TRUSTED_PROXIES` to NPM's exact IP on the network app shares with it, never `*` or a subnet: other containers on that network could otherwise set `X-Forwarded-For` themselves.

That address must not change. Docker assigns container IPs dynamically, so after NPM is recreated (an image update, or a host reboot with a different start order) it can come back with another address. The app then no longer trusts NPM's forwarded headers and sees NPM itself as the client of every request. The login lockout counts failures per client address, so all users now share one address: 100 failed logins from anyone, or 5 for one username, lock every user (or that user) out of the server until the window ends. Pin NPM's address so this cannot happen.

The recommended way is a small dedicated network between NPM and this stack, created by the NPM stack with a fixed subnet and a pinned NPM address. NPM's existing network stays as it is: giving `npm_default` a fixed subnet instead would mean recreating it, which disconnects every stack on it. In the NPM stack's Compose file:

```yaml
# NPM stack, not this repository
services:
  app: # the NPM service
    networks:
      default: {}
      ontotator_edge: { ipv4_address: 10.89.0.2 } # = ONTOTATOR_TRUSTED_PROXIES
networks:
  default: { name: npm_default }
  ontotator_edge:
    name: ontotator_edge
    ipam:
      config:
        # ip_range keeps dynamic addresses (ontotator_app) away from NPM's pinned .2,
        # even if ontotator_app starts while NPM is down.
        - { subnet: 10.89.0.0/29, ip_range: 10.89.0.4/30 }
```

Pick a subnet that is unused on the host (compare `docker network inspect` of the existing networks and the host's own routes). Run `docker compose up -d` in the NPM stack, then set `NPM_SHARED_NETWORK_NAME=ontotator_edge` and `ONTOTATOR_TRUSTED_PROXIES=10.89.0.2` for this stack. NPM still reaches the app as `ontotator_app:8000`, and only NPM and this stack are on that network. Pinning NPM's address on its existing network works too, but only if that network already has an explicit subnet.

Check with `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' NPM_CONTAINER`. If NPM ever gets another IP, fix the pin; do not widen the trust.

NPM proxy host (Hosts, Proxy Hosts, Add Proxy Host):

- Details: domain `editor.example.org`, scheme `http`, forward hostname `ontotator_app`, port `8000`. "Websockets Support" is not needed (the app uses none); "Block Common Exploits" may be on.
- SSL: a Let's Encrypt certificate, "Force SSL" and "HTTP/2 Support" on. Leave NPM's "HSTS Enabled" off; the app sends its own HSTS header.
- NPM already sets `Host $host`, `X-Forwarded-Proto $scheme` and `X-Forwarded-For $remote_addr` (it overwrites the client's header, as required). Nothing must be added for correctness; the Advanced tab takes the hardening below.

`$remote_addr` is the client's real address only if NPM does not itself take it from a client-supplied header. NPM's nginx accepts `X-Real-IP` from connections coming from private address ranges and, with its Cloudflare/CloudFront range fetch, from those ranges too. The per-address login lockout counts whatever NPM forwards, so a client that can set `X-Real-IP` chooses the address it is counted under. On NPM:

- Set `IP_RANGES_FETCH_ENABLED: "false"` in NPM's environment unless the site really is behind Cloudflare or CloudFront.
- Check how IPv6 clients arrive. Without IPv6 on the Docker network, Docker's userland proxy forwards them to NPM from the bridge gateway, a private address: they all share that address, and NPM may accept their `X-Real-IP`. Serve IPv6 natively to NPM, or make sure the gateway address is not trusted for `X-Real-IP`.
- Verify from outside, over IPv4 and IPv6: NPM's access log must show your real public address, also for a request sent with a made-up `X-Real-IP` or `X-Forwarded-For` header.

For another proxy in front of app, forward the original `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. For nginx, configure `proxy_set_header Host $host;`, `proxy_set_header X-Forwarded-For $remote_addr;` (at the first proxy; `$proxy_add_x_forwarded_for` only behind another trusted proxy) and `proxy_set_header X-Forwarded-Proto $scheme;`. For a public nondefault port preserve its authority in Host. Ensure the first trusted proxy replaces untrusted incoming forwarded headers and any proxy chain is explicitly configured. Host validation, HTTPS session cookies, same-origin writes and per-client login throttling depend on these settings. Verify through the public origin after provisioning; TLS/proxy configuration is maintained outside this repository.

## Internet exposure

The app sets its own security headers (CSP with `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS for an https origin) and refuses request bodies over its limits with 413: 50 MiB for document uploads, 300 MiB for ontology uploads, about 116 MiB for the bulk selection routes of a project (work plans, batch assignment, selection summaries; derived from their 200,000-row maximum), 1 MiB for every other request. Unpacked, a web text upload may expand to at most 128 MiB (its preview runs in the app container); T1 bundles and `ontotator admin import` keep ontospan's 512 MiB bound; both allow at most 10,000 ZIP entries, counted before any entry is read. A login locks a username from one client address after 5 failures in 15 minutes, and a client address after 100 failures for any names; locks end with the window, so no CLI unlock exists (a locked user can still log in from another address; see Lost admin password otherwise). The proxy owner should still do the following. In NPM, `limit_req_zone` goes into `/data/nginx/custom/http_top.conf` in NPM's data volume and the rest into the proxy host's Advanced tab, where a `location` uses `include conf.d/include/proxy.conf;` instead of `proxy_pass`:

- Rate-limit `POST /api/v1/auth/login` and `/api/v1/auth/redeem-code` per client address, since the per-address lock does not stop attempts spread over many addresses, for example:
  ```nginx
  limit_req_zone $binary_remote_addr zone=ontotator_auth:10m rate=10r/m;
  location ~ ^/api/v1/auth/(login|redeem-code)$ { limit_req zone=ontotator_auth burst=10 nodelay; include conf.d/include/proxy.conf; }
  ```
- Set `client_max_body_size 1m;` by default and `300m` on `/api/v1/admin/ontologies` and `/api/v1/projects/` (uploads and bulk selections; the app enforces the exact limits).
- Overwrite, never append to, `X-Forwarded-For` at the first proxy (`proxy_set_header X-Forwarded-For $remote_addr;`), so clients cannot choose the address the lockout counts.
- Block `/livez` and `/readyz` from outside (`location ~ ^/(livez|readyz)$ { deny all; }`); Docker health checks reach them directly.
- Terminate TLS with a current configuration and redirect HTTP to HTTPS.

## Deploy on a VPS with an existing NPM

On the host, with NPM (and possibly other stacks) already running:

1. Network: create the dedicated edge network with NPM's pinned address as in [Reverse proxy settings](#reverse-proxy-settings); its name is the value for `NPM_SHARED_NETWORK_NAME`.
2. Files: take `docker-compose.yml`, `docker/postgres-init.sh` and `.env.docker.template` from the release you deploy, so the Compose file matches the image (for example `git clone --depth 1 --branch vX.Y.Z https://github.com/halbritter-lab/ontotator.git`, or download the three files from that tag). Nothing else from the repository is used on the host. Make the init script readable by PostgreSQL's UID 70 with `chmod 0755 docker && chmod 0644 docker/postgres-init.sh` (see [First start](#first-start)).
3. Secrets: create `secrets/` as in [Configuration and secrets](#configuration-and-secrets).
4. Settings: `cp .env.docker.template .env.docker && ln -sf .env.docker .env`, then set `ONTOTATOR_IMAGE` (the `ghcr.io/halbritter-lab/ontotator@sha256:...` digest reference of the release), `ONTOTATOR_PUBLIC_ORIGIN`, `NPM_SHARED_NETWORK_NAME` and `ONTOTATOR_TRUSTED_PROXIES` (NPM's pinned address).
5. Registry access: a public GHCR package needs no login. If the package is private, log in once as the user that runs Compose, with a GitHub personal access token (classic) that has only the `read:packages` scope: `docker login ghcr.io --username GITHUB_USER --password-stdin < /absolute/private/ghcr-read-token`. Docker stores the credential in that user's `~/.docker/config.json`; never put a token that may write packages or repositories on the server.
6. Start: `docker compose config --quiet && docker compose pull && docker compose up -d --wait && docker compose ps --all`, then finish the admin bootstrap as in [First start](#first-start).
7. NPM: add the proxy host as in [Reverse proxy settings](#reverse-proxy-settings), first without the Advanced hardening.
8. Verify: `curl -fsS https://editor.example.org/readyz` reports every check true, and sign-in works in a browser. Then add the Advanced hardening: `/readyz` must now answer 403 from outside while `docker compose ps` keeps app healthy.
9. Update: take the Compose files of the new release, set its digest in `.env.docker` and follow [Upgrades](#upgrades). Other stacks are not touched; they share only NPM.

### Managed hosting deployment

When the server is managed from a separate infrastructure ("hosting") repository with Ansible, as the maintainers' own deployment is, the steps above are expressed declaratively there instead of being done by hand on the host:

- Files: the hosting repository vendors `docker-compose.yml` and `docker/postgres-init.sh` of the pinned release into `server/apps/ontotator/`, and Ansible copies them to the host with mode `0644`, so the host umask cannot make the init script unreadable. Nothing is cloned on the server.
- Images: an override file pins `migrate` and `ontotator_app` as `ghcr.io/halbritter-lab/ontotator:X.Y.Z@sha256:...`, tag and digest together. PostgreSQL stays pinned in the vendored base file. Only numeric `X.Y.Z` releases are published for pinning; never pin `latest`, `X.Y` or `sha-...` tags.
- Project: the Compose project name is fixed (`project_name: ontotator`), so volume and container names stay the same across deployments. Changing it would start a new, empty project beside the old volumes.
- Proxy: the NPM proxy host is a declared `npm-hosts` entry forwarding to `ontotator_app:8000` with `hsts_enabled: false` (the app sends its own HSTS header), on the edge network from [Reverse proxy settings](#reverse-proxy-settings).
- Settings and secrets are still required as in [Configuration and secrets](#configuration-and-secrets): the base file needs `ONTOTATOR_IMAGE`, `ONTOTATOR_PUBLIC_ORIGIN`, `ONTOTATOR_TRUSTED_PROXIES` and `NPM_SHARED_NETWORK_NAME` set even when the override pins the images.

A release is deployed from the hosting repository, not on the server:

```bash
make pin APP=ontotator VERSION=X.Y.Z # vendors the release's files and pins its image digests
git add server/apps/ontotator && git commit # review the vendored diff first
make deploy APP=ontotator
```

Take a backup before `make deploy` switches the image, as in [Upgrades](#upgrades). Read the release notes for changes to the Compose file or init script; the PostgreSQL init script only runs on an empty volume, so changing it does not affect an existing database.

## Workers and resource limits

The production default is two Uvicorn workers (`ONTOTATOR_WORKERS=2`, supported range 1–6, so the connection pools stay under PostgreSQL's `max_connections=100`). Sessions are shared in PostgreSQL, so routing needs no sticky session. Each worker has its own interpreter, ontology registry and search indexes: memory rises with worker count and loaded ontology size. Measure representative workloads before increasing workers.

The app contract limits it to 2 CPUs / 2 GiB, PostgreSQL to 1 CPU / 1 GiB and migrations to 1 CPU / 512 MiB. Each has a 256-PID limit; app has a 35-second stop grace period. Temporary files also consume container memory. More workers under unchanged limits can cause memory pressure or worse latency; worker count is not a throughput guarantee.

## Local verification

Install dependencies with `uv sync --dev --locked`, `npm --prefix frontend ci` and `npm --prefix frontend exec -- playwright install chromium`. Private Git access is required for Python dependencies. Run from Git Bash, Linux or macOS with Docker available:

```bash
bash scripts/check.sh
CHECK_CONTAINERS=1 bash scripts/check.sh
CHECK_CONTAINERS=1 CHECK_IMAGE=ontotator:release bash scripts/check.sh
```

The base gate includes backend PostgreSQL and Playwright tests plus formatting, linting, typing, API drift and wheel checks. `ONTOTATOR_TEST_PG_URL` can target a disposable test superuser database; never production. `CHECK_VITEST_WORKERS` bounds frontend test parallelism (default 2; use 4 on a dedicated machine); `CHECK_PYTEST_WORKERS` sets the backend pytest-xdist workers (default 4; 0 or 1 is serial) and `CHECK_PLAYWRIGHT_WORKERS` the browser workers (default 1). See [focused local checks](operations/local-checks.md) for partial phases and prerequisites. There is no active CI gate.

`CHECK_CONTAINERS=1` adds the container checker and browser smoke on one shared stack. Set `CHECK_IMAGE` to reuse a verified local image for app and migrations; otherwise the checker builds the dev image with `GITHUB_TOKEN_FILE`. For the container checks and smoke alone, run:

```bash
uv run python scripts/container_check.py --image ontotator:release --smoke
```

The checker uses a unique disposable Compose project, temporary build placeholders for image reuse and cleans up that project's volumes. It seeds a project, runs browser smoke while the stack is healthy, then verifies readiness failures, permissions and production network settings. `--smoke` is optional for direct checker invocation. The seed/load-test harnesses stream inputs over stdin into writable `/tmp`; ontology uploads become searchable while workers remain running.

### Demo logins (loopback demo stacks only)

**Never for production.** For manual tests on a local loopback stack, `ONTOTATOR_DEMO_LOGINS_FILE` may name a JSON file of demo accounts:

```json
[
  {"username": "demo-lead", "password": "…", "label": "Project lead"},
  {"username": "demo-annotator", "password": "…", "label": "Annotator"}
]
```

The file is read once at startup. The login page then shows a "Demo accounts" section with one button per account; a button logs in through the normal `/api/v1/auth/login` (same rate limits, lockouts, audit and session). To do so, `GET /api/v1/auth/demo-logins` sends **every listed password in plain text to every browser that opens the login page**. Only list throwaway demo accounts, mount the file read-only and keep the stack bound to `127.0.0.1`.

Unset (the default), nothing changes: the endpoint answers 404 and the page has no demo section. The server refuses to start with the setting when `ONTOTATOR_ENV=production`, when the public origin is not a loopback address, or when `ontotator serve` binds a non-loopback address. A container binds `0.0.0.0` internally, so there only the public origin is checked; keep the published port on `127.0.0.1`. While it is on, every start logs the warning `DEMO LOGINS ARE ON`.

For representative performance measurements, follow [loadtest/README.md](../loadtest/README.md). Use a fresh separate dev project, real HPO release from 2026-06-23 or newer, 1,000 synthetic documents and 30 synthetic users. Warm separately, then measure five minutes under the actual two-worker app and Compose limits. Record CPU/RAM, Docker version, image identity, ontology SHA/release, workload, percentiles, errors and resource evidence. Strict p95 targets are search 150 ms, open 300 ms, write 150 ms and dashboard 500 ms; equality fails. Preserve failed results and profile before tuning. Full measurement and performance acceptance remain pending until an actual run and report exist; harness tests provide no performance evidence. Generated `loadtest/results/` artifacts stay local by default.
