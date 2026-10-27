#!/usr/bin/env bash
# Serial local checks. The default is the complete required gate.
set -euo pipefail
cd "$(dirname "$0")/.."

summary=()
total_started=$SECONDS
selected=""

usage() {
    cat <<'HELP'
Usage: bash scripts/check.sh [--only STAGE]
       bash scripts/check.sh --quick [--base REF] [PATH...]

Without arguments, run the complete local gate serially.
--only runs a partial gate: static | frontend | backend | browser | containers
  static      lint, format, types, contracts, cheap contract tests, wheel
  frontend    frontend unit tests
  backend     complete backend tests with the 20 slowest durations
  browser     frontend build and complete Playwright suite
  containers  opt-in container checks and smoke tests
--quick runs the inner-loop partial gate (scripts/check-affected.sh): static
  checks plus only the tests affected by PATH or by the changes against REF.

CHECK_VITEST_WORKERS: positive integer, default 2; use 4 on a dedicated machine.
CHECK_PYTEST_WORKERS: backend pytest-xdist workers, default 4; 0 or 1 runs serially.
CHECK_PLAYWRIGHT_WORKERS: positive integer, default 3 (spec files use separate projects).
CHECK_CONTAINERS=1 adds containers to the complete gate; CHECK_IMAGE selects image.
ONTOTATOR_TEST_PG_URL may select a disposable PostgreSQL test server.
HELP
}

fail() {
    echo "" >&2
    echo "check.sh: $*" >&2
    exit 1
}

if [ "$#" -gt 0 ]; then
    case "$1" in
        --help|-h)
            [ "$#" -eq 1 ] || fail "--help accepts no other arguments."
            usage
            exit 0
            ;;
        --quick)
            shift
            exec bash scripts/check-affected.sh "$@"
            ;;
        --only)
            [ "$#" -eq 2 ] || fail "Use --only with exactly one stage; see --help."
            selected="$2"
            case "$selected" in
                static|frontend|backend|browser|containers) ;;
                *) fail "Unknown stage '$selected'; see --help." ;;
            esac
            ;;
        *) fail "Unknown argument '$1'; see --help." ;;
    esac
fi

runs() { [ -z "$selected" ] || [ "$selected" = "$1" ]; }

vitest_workers="${CHECK_VITEST_WORKERS:-2}"
if runs frontend; then
    [[ "$vitest_workers" =~ ^[1-9][0-9]*$ ]] \
        || fail "CHECK_VITEST_WORKERS must be a positive integer."
fi
pytest_workers="${CHECK_PYTEST_WORKERS:-4}"
if runs backend; then
    [[ "$pytest_workers" =~ ^[0-9]+$ ]] \
        || fail "CHECK_PYTEST_WORKERS must be a non-negative integer."
fi
playwright_workers="${CHECK_PLAYWRIGHT_WORKERS:-3}"
if runs browser; then
    [[ "$playwright_workers" =~ ^[1-9][0-9]*$ ]] \
        || fail "CHECK_PLAYWRIGHT_WORKERS must be a positive integer."
fi

if runs static || runs backend || [ "$selected" = containers ]; then
    command -v uv >/dev/null 2>&1 || fail "uv is not on PATH; install it from https://docs.astral.sh/uv/."
fi
if runs static || runs frontend || runs browser || [ "$selected" = containers ]; then
    command -v npm >/dev/null 2>&1 || fail "npm is not on PATH; install Node.js 20 or later."
    [ -d frontend/node_modules ] || fail "frontend dependencies are missing; run 'npm --prefix frontend ci' first."
fi
if [ "$selected" = containers ] || { [ -z "$selected" ] && [ "${CHECK_CONTAINERS:-0}" = 1 ]; } \
    || { { runs backend || runs browser; } && [ -z "${ONTOTATOR_TEST_PG_URL:-}" ]; }; then
    command -v docker >/dev/null 2>&1 \
        || fail "docker is not on PATH. Start Docker or set ONTOTATOR_TEST_PG_URL for PostgreSQL checks."
    docker info >/dev/null 2>&1 \
        || fail "Docker is not reachable. Start Docker Desktop or the Docker daemon."
fi

print_summary() {
    echo ""
    echo "Summary:"
    if [ "${#summary[@]}" -gt 0 ]; then
        printf '  %s\n' "${summary[@]}"
    fi
    echo "  total $((SECONDS - total_started))s"
}

step() {
    local name="$1"
    shift
    local started=$SECONDS
    echo ""
    echo "==> ${name}"
    if "$@"; then
        summary+=("ok      $(printf '%4ds' $((SECONDS - started)))  ${name}")
    else
        local status=$?
        summary+=("failed  $(printf '%4ds' $((SECONDS - started)))  ${name}")
        print_summary
        fail "FAILED: ${name} (exit ${status}; command: $*)"
    fi
}

# Only the static phase creates this disposable build directory.
wheel_dir=build/check-wheel
if runs static; then
    trap 'rm -rf "$wheel_dir"' EXIT
    step "ruff check" uv run ruff check .
    step "ruff format --check" uv run ruff format --check .
    step "mypy" uv run mypy src
    step "OpenAPI drift" uv run python scripts/export_openapi.py --check
    step "admin error catalog drift" uv run python scripts/export_admin_error_codes.py --check
    step "source and wheel contract preflight" uv run pytest \
        tests/test_admin_error_codes.py tests/test_check_wheel.py tests/test_check_script.py -q
    step "frontend typecheck" npm --prefix frontend run typecheck
    step "TypeScript API drift" npm --prefix frontend run api:check
    step "wheel build (lock and contents)" uv run python scripts/check_wheel.py \
        --out-dir "$wheel_dir"
fi
if runs frontend; then
    # Keep RAM available for Docker and other work; callers can override explicitly.
    step "frontend unit tests" npm --prefix frontend test -- \
        --maxWorkers="$vitest_workers" --minWorkers=1
fi
if runs backend; then
    # pytest-xdist workers share one PostgreSQL server (tests/pg_harness.py).
    if [ "$((10#$pytest_workers))" -gt 1 ]; then
        step "backend tests (PostgreSQL)" uv run pytest -q -n "$((10#$pytest_workers))" \
            --durations=20
    else
        step "backend tests (PostgreSQL)" uv run pytest -q --durations=20
    fi
fi
if runs browser; then
    step "browser tests (Playwright)" npm --prefix frontend run test:e2e -- \
        --workers="$((10#$playwright_workers))"
fi
if [ "$selected" = containers ] || { [ -z "$selected" ] && [ "${CHECK_CONTAINERS:-0}" = 1 ]; }; then
    container_args=(--smoke)
    if [ -n "${CHECK_IMAGE:-}" ]; then
        container_args+=(--image "$CHECK_IMAGE")
    fi
    step "container checks and browser smoke" uv run python scripts/container_check.py \
        "${container_args[@]}"
fi

print_summary
if [ -z "$selected" ]; then
    echo "All local checks passed."
else
    echo "Selected stage checks passed (partial gate: ${selected})."
fi
