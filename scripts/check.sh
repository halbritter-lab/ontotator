#!/usr/bin/env bash
# The complete local gate. There is no CI (T2 index R2); run this before a merge.
# Docker must be running: the backend and browser tests use PostgreSQL containers
# (or set ONTOCURATOR_TEST_PG_URL to a throwaway server's superuser URL).
# Works in Git Bash on Windows and on Linux and macOS. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

summary=()

fail() {
    echo "" >&2
    echo "check.sh: $*" >&2
    exit 1
}

step() {
    local name="$1"
    shift
    local started=$SECONDS
    echo ""
    echo "==> ${name}"
    if ! "$@"; then
        fail "FAILED: ${name} (command: $*)"
    fi
    summary+=("ok  $(printf '%4ds' $((SECONDS - started)))  ${name}")
}

command -v uv >/dev/null 2>&1 || fail "uv is not on PATH; install it from https://docs.astral.sh/uv/."
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH; install Node.js 20 or later."
[ -d frontend/node_modules ] || fail "frontend dependencies are missing; run 'npm --prefix frontend ci' first."

if [ -z "${ONTOCURATOR_TEST_PG_URL:-}" ]; then
    command -v docker >/dev/null 2>&1 \
        || fail "docker is not on PATH. The tests need PostgreSQL: install and start Docker (Desktop), or set ONTOCURATOR_TEST_PG_URL."
    docker info >/dev/null 2>&1 \
        || fail "Docker is not reachable. Start Docker Desktop (or the Docker daemon) and run this script again, or set ONTOCURATOR_TEST_PG_URL."
fi

# The release build check writes its wheel here (build/ is ignored by Git).
wheel_dir=build/check-wheel
trap 'rm -rf "$wheel_dir"' EXIT

total_started=$SECONDS

step "ruff check" uv run ruff check .
step "ruff format --check" uv run ruff format --check .
step "mypy" uv run mypy src
step "OpenAPI drift" uv run python scripts/export_openapi.py --check
step "frontend typecheck" npm --prefix frontend run typecheck
step "TypeScript API drift" npm --prefix frontend run api:check
# Packages the committed web assets: no npm ci, no rewrite of src/ontocurator/web.
step "release build (wheel contents)" uv run python scripts/build_release.py \
    --skip-frontend --skip-npm-ci --out-dir "$wheel_dir"
# Bounded workers: one jsdom worker per core exhausted memory on a 16 GB machine
# with Docker running. Override with CHECK_VITEST_WORKERS.
step "frontend unit tests" npm --prefix frontend test -- \n    --maxWorkers="${CHECK_VITEST_WORKERS:-4}" --minWorkers=1
step "backend tests (PostgreSQL)" uv run pytest -q
step "browser tests (Playwright)" npm --prefix frontend run test:e2e

echo ""
echo "Summary:"
printf '  %s\n' "${summary[@]}"
echo "  total $((SECONDS - total_started))s"
echo "All local checks passed."
