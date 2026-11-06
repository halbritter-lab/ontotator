#!/usr/bin/env bash
# Restore drill: restore one recovery point made by scripts/backup.sh into a
# fresh, isolated Compose project, check it and remove it again. This is the
# documented restore block of docs/operations.md ("Restore") plus the checks
# of the recorded drill, as one command.
#
# Usage:
#   bash restore-check.sh RECOVERY_POINT RESTORE_DIR [--project NAME] [--keep]
#
# RECOVERY_POINT is a complete directory written by backup.sh (not .partial).
# RESTORE_DIR is a prepared isolated target as in docs/operations.md
# ("Restore"): docker-compose.yml, docker/postgres-init.sh, .env and fresh
# secrets in ./secrets/, with the bootstrap admin hash setting removed. It is
# never the live deployment directory.
#
# - Verifies SHA256SUMS before anything else; refuses a recovery point that
#   does not verify.
# - Uses the Compose project NAME (default ontotator-restore-check-<UTC time>)
#   and its own network NAME-npm, never the live NPM network. Refuses a project
#   that already has containers or labelled volumes, and an existing network.
# - Before migrate or app start: compares the row count of every table in the
#   ontotator schema with the rows in database.dump, compares every /data file
#   (SHA-256, numeric owner, mode) with data.tar, and checks the schema owner.
# - Then starts migrate and app, waits until app is healthy and /readyz
#   answers inside the container.
# - Always removes the target project (containers, volumes, network) at the
#   end, also when a check fails, unless --keep is given. Only the project this
#   run created is touched; RESTORE_DIR itself is left as it is.
# - Prints a summary for the drill record (size, timings, result) and exits 0
#   only if every check passed.
#
# Run as a user that may use Docker, on the host, with no users or CLI writers
# on the target. It reads the recovery point; it never writes to it.
set -euo pipefail
umask 077

usage() {
    echo "Usage: bash restore-check.sh RECOVERY_POINT RESTORE_DIR [--project NAME] [--keep]" >&2
    exit 2
}

point="${1:-}"
restore_dir="${2:-}"
given_point="$point"
given_restore_dir="$restore_dir"
[[ -n "$point" && "$point" != -* && -n "$restore_dir" && "$restore_dir" != -* ]] || usage
shift 2
project="ontotator-restore-check-$(date -u +%Y%m%dt%H%M%Sz)"
keep=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project) [[ "${2:-}" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || usage; project="$2"; shift 2 ;;
        --keep) keep=1; shift ;;
        *) usage ;;
    esac
done

log() { echo "restore-check: $*" >&2; }
fail() { log "FAILED: $*"; exit 1; }

point="$(cd "$point" 2>/dev/null && pwd)" || fail "recovery point $given_point does not exist"
restore_dir="$(cd "$restore_dir" 2>/dev/null && pwd)" || fail "restore directory $given_restore_dir does not exist"
[[ "$point" != *.partial ]] || fail "$point is an incomplete recovery point (.partial)"
for file in SHA256SUMS database.dump data.tar image-reference.txt; do
    [[ -f "$point/$file" ]] || fail "$point/$file is missing"
done
for file in docker-compose.yml .env docker/postgres-init.sh; do
    [[ -f "$restore_dir/$file" ]] || fail "$restore_dir/$file is missing; prepare the target as in docs/operations.md (Restore)"
done
[[ -d "$restore_dir/secrets" ]] || fail "$restore_dir/secrets is missing"

started=$SECONDS
phase_start=$SECONDS
timings=()
phase() {
    timings+=("$1 $((SECONDS - phase_start))s")
    phase_start=$SECONDS
}

log "verifying $point/SHA256SUMS"
(cd "$point" && sha256sum --check --quiet SHA256SUMS) >&2 || fail "SHA256SUMS does not verify"
phase verify

ONTOTATOR_IMAGE="$(head -n 1 "$point/image-reference.txt")"
[[ -n "$ONTOTATOR_IMAGE" ]] || fail "image-reference.txt is empty"
NPM_SHARED_NETWORK_NAME="${project}-npm" # never the live NPM network
export ONTOTATOR_IMAGE NPM_SHARED_NETWORK_NAME
target=(docker compose --project-name "$project" --env-file "$restore_dir/.env"
    --file "$restore_dir/docker-compose.yml" --project-directory "$restore_dir")

# Guards: only a project this run creates is ever taken down.
[[ -z "$("${target[@]}" ps --all --quiet)" ]] || fail "project $project already has containers"
[[ -z "$(docker volume ls --quiet --filter "label=com.docker.compose.project=$project")" ]] ||
    fail "project $project already has volumes"
if docker network inspect "$NPM_SHARED_NETWORK_NAME" > /dev/null 2>&1; then
    fail "network $NPM_SHARED_NETWORK_NAME already exists"
fi
"${target[@]}" config --quiet

result=FAILED
work="$(mktemp -d)"
cleanup() {
    local status=$?
    trap - EXIT
    rm -rf -- "$work"
    if [[ -n "$keep" ]]; then
        log "kept project $project and network $NPM_SHARED_NETWORK_NAME (--keep); remove them with:"
        log "  ONTOTATOR_IMAGE=... NPM_SHARED_NETWORK_NAME=$NPM_SHARED_NETWORK_NAME ${target[*]} down --volumes"
        log "  docker network rm $NPM_SHARED_NETWORK_NAME"
    else
        "${target[@]}" down --volumes --remove-orphans >&2 ||
            log "could not remove project $project; check 'docker compose --project-name $project ps --all'"
        docker network rm "$NPM_SHARED_NETWORK_NAME" > /dev/null ||
            log "could not remove network $NPM_SHARED_NETWORK_NAME"
    fi
    phase cleanup
    echo "Restore drill summary"
    echo "  recovery point: $point"
    echo "  image:          $ONTOTATOR_IMAGE"
    echo "  data size:      $(du -sh "$point" | cut -f1) (database.dump $(du -h "$point/database.dump" | cut -f1), data.tar $(du -h "$point/data.tar" | cut -f1))"
    echo "  timings:        ${timings[*]}; total $((SECONDS - started))s"
    echo "  result:         $result"
    [[ "$result" == passed ]] || exit $((status == 0 ? 1 : status))
    exit "$status"
}
docker network create "$NPM_SHARED_NETWORK_NAME" > /dev/null
trap cleanup EXIT

log "restoring into project $project"
"${target[@]}" up -d --wait ontotator_postgres >&2
"${target[@]}" create ontotator_app >&2
restore_app="$("${target[@]}" ps --all --quiet ontotator_app)"
[[ -n "$restore_app" ]] || fail "no ontotator_app container in $project"
restore_volume="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$restore_app")"
[[ -n "$restore_volume" ]] || fail "could not resolve the /data volume of $project"
helper=(docker run --rm -i --network none --read-only --user 0:0 --security-opt no-new-privileges)
"${helper[@]}" --mount "type=volume,src=$restore_volume,dst=/restore" \
    --entrypoint tar "$ONTOTATOR_IMAGE" --numeric-owner --same-owner --preserve-permissions \
    --extract --file=- --directory=/restore < "$point/data.tar"
"${target[@]}" exec -T ontotator_postgres pg_restore --username=ontotator_bootstrap \
    --dbname=ontotator --clean --if-exists --exit-on-error < "$point/database.dump"
phase restore

psql=("${target[@]}" exec -T ontotator_postgres psql -X -q --username=ontotator_bootstrap
    --dbname=ontotator --tuples-only --no-align --field-separator=' ' --set=ON_ERROR_STOP=1)
owner="$("${psql[@]}" --command="SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'ontotator'" | tr -d '[:space:]')"
[[ "$owner" == ontotator_owner ]] || fail "schema ontotator is owned by '$owner', not ontotator_owner"
revision="$("${psql[@]}" --command="SELECT version_num FROM ontotator.alembic_version" | tr -d '[:space:]')"

# Rows per table: COPY blocks of the dump (one line per row in COPY text
# format) against count(*) in the restored database.
"${target[@]}" exec -T ontotator_postgres pg_restore --data-only --file=- < "$point/database.dump" |
    awk '/^COPY ontotator\./ { table = $2; gsub(/"/, "", table); rows[table] = 0; next }
         table != "" && /^\\\.$/ { table = ""; next }
         table != "" { rows[table]++ }
         END { for (t in rows) print t, rows[t] }' | LC_ALL=C sort > "$work/dump-rows"
"${psql[@]}" --command="SELECT 'ontotator.' || table_name,
        (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM ontotator.%I', table_name), false, true, '')))[1]::text
    FROM information_schema.tables WHERE table_schema = 'ontotator' AND table_type = 'BASE TABLE'" |
    LC_ALL=C sort > "$work/restored-rows"
[[ -s "$work/dump-rows" ]] || fail "found no ontotator tables in database.dump"
if ! diff "$work/dump-rows" "$work/restored-rows" >&2; then
    fail "row counts differ between database.dump (<) and the restored database (>)"
fi
tables="$(wc -l < "$work/dump-rows" | tr -d '[:space:]')"
rows="$(awk '{ n += $2 } END { print n + 0 }' "$work/dump-rows")"
log "row counts of $tables tables equal ($rows rows)"

# /data files: SHA-256, numeric owner and mode from data.tar against the volume.
# shellcheck disable=SC2016 # expanded by the helper's shell, not here
"${helper[@]}" --entrypoint tar "$ONTOTATOR_IMAGE" --extract --file=- \
    --to-command='sh -c '\''printf "%s %s %s %s\n" "$(sha256sum | cut -c1-64)" "$TAR_UID:$TAR_GID" "$TAR_MODE" "$TAR_FILENAME"'\''' \
    < "$point/data.tar" | LC_ALL=C sort > "$work/tar-files"
# shellcheck disable=SC2016 # expanded by the helper's shell, not here
"${helper[@]}" --mount "type=volume,src=$restore_volume,dst=/restore,readonly" --workdir /restore \
    --entrypoint find "$ONTOTATOR_IMAGE" . -type f -exec sh -c \
    'for f; do printf "%s %s %s\n" "$(sha256sum < "$f" | cut -c1-64)" "$(stat -c "%u:%g %#a" "$f")" "$f"; done' sh {} + < /dev/null |
    LC_ALL=C sort > "$work/restored-files"
if ! diff "$work/tar-files" "$work/restored-files" >&2; then
    fail "/data differs between data.tar (<) and the restored volume (>)"
fi
log "/data: $(wc -l < "$work/tar-files" | tr -d '[:space:]') files byte-identical with equal owners and modes"
phase compare

log "starting migrate and app"
"${target[@]}" up -d --wait >&2
"${target[@]}" exec -T ontotator_app python -c \
    "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=10).read().decode())" \
    > "$work/readyz" || fail "/readyz did not answer"
log "/readyz: $(cat "$work/readyz")"
"${target[@]}" ps --all >&2
phase start

log "passed: schema owner ontotator_owner, revision $revision, $tables tables and /data equal, app ready"
result=passed
