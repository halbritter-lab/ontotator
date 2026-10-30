#!/usr/bin/env bash
# Take one recovery point of a running Ontotator Compose deployment:
# database.dump (pg_dump, custom format), data.tar (the /data volume, numeric
# owners), image-reference.txt and SHA256SUMS. This is the documented backup
# block of docs/operations.md ("Backups and restore") made safe to schedule.
#
# Usage, in the deployment directory (or with COMPOSE_PROJECT_NAME/COMPOSE_FILE):
#   bash backup.sh BACKUP_ROOT [--wait-jobs SECONDS] [--keep-days DAYS]
#
# - Waits up to --wait-jobs seconds (default 600) for running import/export
#   jobs to finish; gives up without touching the app if they do not.
# - Stops ontotator_app for the dump and archive and always starts it again,
#   also when the backup fails (an unattended run must not leave it down).
# - Writes into BACKUP_ROOT/<UTC timestamp>.partial and renames it to
#   BACKUP_ROOT/<UTC timestamp> only when complete and checksummed. Copy only
#   complete recovery points off the host.
# - --keep-days DAYS deletes complete recovery points (and stale .partial
#   directories) in BACKUP_ROOT older than DAYS; only names this script
#   creates are touched. Off by default.
# - Prints the path of the new recovery point as the last line on stdout.
#
# It does not copy anything off the host and does not encrypt: do both from
# the calling timer (see docs/operations.md). Run as a user that may use
# Docker; the recovery point is created with umask 077.
set -euo pipefail
umask 077

usage() {
    echo "Usage: bash backup.sh BACKUP_ROOT [--wait-jobs SECONDS] [--keep-days DAYS]" >&2
    exit 2
}

root="${1:-}"
[[ -n "$root" && "$root" != -* ]] || usage
shift
wait_jobs=600
keep_days=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --wait-jobs) [[ "${2:-}" =~ ^[0-9]+$ ]] || usage; wait_jobs="$2"; shift 2 ;;
        --keep-days) [[ "${2:-}" =~ ^[1-9][0-9]*$ ]] || usage; keep_days="$2"; shift 2 ;;
        *) usage ;;
    esac
done
if [[ ! -d "$root" ]]; then
    echo "Backup root $root does not exist; create it (private, mode 0700) first." >&2
    exit 1
fi

log() { echo "backup: $*" >&2; }

running_jobs() {
    docker compose exec -T ontotator_postgres psql -X -q --username=ontotator_bootstrap \
        --dbname=ontotator --tuples-only --no-align --set=ON_ERROR_STOP=1 \
        --command="SELECT count(*) FROM ontotator.jobs WHERE status = 'running'"
}

app_container="$(docker compose ps --all --quiet ontotator_app)"
if [[ -z "$app_container" ]]; then
    log "no ontotator_app container in this Compose project; run in the deployment directory"
    exit 1
fi
data_volume="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Destination "/data") (eq .Type "volume")}}{{.Name}}{{end}}{{end}}' "$app_container")"
helper_image="$(docker inspect --format '{{ .Config.Image }}' "$app_container")"
if [[ -z "$data_volume" || -z "$helper_image" ]]; then
    log "could not resolve the /data volume or the image of ontotator_app"
    exit 1
fi

deadline=$((SECONDS + wait_jobs))
while :; do
    count="$(running_jobs | tr -d '[:space:]')"
    [[ "$count" =~ ^[0-9]+$ ]] || { log "could not count running jobs (got '$count')"; exit 1; }
    [[ "$count" == 0 ]] && break
    if ((SECONDS >= deadline)); then
        log "$count job(s) still running after ${wait_jobs}s; no backup taken, app untouched"
        exit 75
    fi
    log "waiting for $count running job(s)"
    sleep 10
done

name="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$root/$name.partial"
final="$root/$name"
mkdir "$partial" # refuses an existing directory

restart_app() {
    local status=$?
    trap - EXIT
    docker compose up -d --wait ontotator_app >&2 ||
        log "ontotator_app did not come back healthy; check 'docker compose ps --all'"
    log "FAILED; incomplete recovery point left at $partial"
    exit $((status == 0 ? 1 : status))
}
trap restart_app EXIT

started=$SECONDS
docker compose stop ontotator_app >&2
count="$(running_jobs | tr -d '[:space:]')"
if [[ "$count" != 0 ]]; then
    # A job started between the check and the stop; the snapshot is still
    # consistent (nothing writes now), and the job is resumed after restart.
    log "warning: $count job(s) were interrupted by the stop"
fi
printf '%s\n' "$helper_image" > "$partial/image-reference.txt"
docker compose exec -T ontotator_postgres pg_dump --username=ontotator_bootstrap \
    --dbname=ontotator --format=custom > "$partial/database.dump"
docker run --rm --network none --read-only --user 0:0 --security-opt no-new-privileges \
    --mount "type=volume,src=$data_volume,dst=/source,readonly" \
    --entrypoint tar "$helper_image" --numeric-owner --create --file=- --directory=/source . \
    > "$partial/data.tar"
test -s "$partial/database.dump"
test -s "$partial/data.tar"
(cd "$partial" && sha256sum database.dump data.tar image-reference.txt > SHA256SUMS)
mv "$partial" "$final"
trap - EXIT
stopped=$((SECONDS - started))
if ! docker compose up -d --wait ontotator_app >&2; then
    log "recovery point $final is complete, but ontotator_app did not come back healthy"
    exit 1
fi
log "recovery point complete; app was stopped for ${stopped}s"

if [[ -n "$keep_days" ]]; then
    find "$root" -mindepth 1 -maxdepth 1 -type d -mtime "+$keep_days" \
        -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z(\.partial)?' \
        -print -exec rm -rf -- {} + >&2
fi
printf '%s\n' "$final"
