#!/usr/bin/env bash
# Inner-loop check: static checks plus only the tests affected by a change.
# This is not the required gate; run scripts/check.sh before integration.
set -euo pipefail
cd "$(dirname "$0")/.."

summary=()
total_started=$SECONDS
base="${CHECK_BASE:-main}"
paths=()

usage() {
    cat <<'HELP'
Usage: bash scripts/check-affected.sh [--base REF] [PATH...]
       bash scripts/check.sh --quick [--base REF] [PATH...]

Inner-loop check for work packages; it is a partial gate, never the full one.
Runs the static checks (lint, format, types, OpenAPI/TypeScript/admin catalog
drift) and then only the tests affected by PATH, or without PATH by the files
changed against REF (committed since the merge base, uncommitted, untracked).

Backend: changed tests/test_*.py, tests named after a changed module
(tests/test_<module>*.py; for <name>_routes.py also tests/test_<name>*.py),
tests naming a changed migration's revision ("0019") and tests importing a
changed module or test helper. Backend changes without such tests are listed;
when no backend test runs at all the check fails: run
'bash scripts/check.sh --only backend'.
Frontend: vitest related for changed frontend/src and frontend/tests files.

--base REF            base ref, default main (or CHECK_BASE)
CHECK_PYTEST_WORKERS  backend xdist workers, default 2; never more than files
CHECK_VITEST_WORKERS  frontend workers, default 2
HELP
}

fail() {
    echo "" >&2
    echo "check-affected.sh: $*" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --base)
            [ "$#" -ge 2 ] || fail "--base needs a ref; see --help."
            base="$2"
            shift 2
            ;;
        --) shift; paths+=("$@"); break ;;
        -*) fail "Unknown argument '$1'; see --help." ;;
        *) paths+=("$1"); shift ;;
    esac
done

pytest_workers="${CHECK_PYTEST_WORKERS:-2}"
[[ "$pytest_workers" =~ ^[0-9]+$ ]] \
    || fail "CHECK_PYTEST_WORKERS must be a non-negative integer."
pytest_workers=$((10#$pytest_workers))
vitest_workers="${CHECK_VITEST_WORKERS:-2}"
[[ "$vitest_workers" =~ ^[1-9][0-9]*$ ]] \
    || fail "CHECK_VITEST_WORKERS must be a positive integer."

command -v uv >/dev/null 2>&1 || fail "uv is not on PATH; install it from https://docs.astral.sh/uv/."
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH; install Node.js 20 or later."
[ -d frontend/node_modules ] || fail "frontend dependencies are missing; run 'npm --prefix frontend ci' first."

if [ "${#paths[@]}" -eq 0 ]; then
    command -v git >/dev/null 2>&1 || fail "git is not on PATH; pass the changed files explicitly."
    git rev-parse --verify -q "${base}^{commit}" >/dev/null \
        || fail "Unknown base ref '$base'; use --base REF or pass files."
    mapfile -t paths < <(
        {
            git diff --name-only "${base}...HEAD"
            git diff --name-only HEAD
            git ls-files --others --exclude-standard
        } | sort -u
    )
fi

backend_tests=()
frontend_files=()
unmapped=()
notes=()

add_backend_test() {
    local candidate
    for candidate in "$@"; do
        [ -f "$candidate" ] || continue
        case " ${backend_tests[*]-} " in
            *" $candidate "*) ;;
            *) backend_tests+=("$candidate") ;;
        esac
    done
}

# Test modules whose source matches an extended regular expression.
tests_matching() {
    find tests -name 'test_*.py' -type f -print0 2>/dev/null \
        | xargs -0 -r grep -lE "$1" 2>/dev/null || true
}

escape() { printf '%s' "$1" | sed 's/[.]/\\./g'; }

for raw in "${paths[@]}"; do
    path="${raw//\\//}"
    path="${path#./}"
    case "$path" in
        tests/conftest.py|tests/pg_harness.py)
            unmapped+=("$path (shared test setup)")
            ;;
        tests/*test_*.py)
            name="${path##*/}"
            if [[ "$name" == test_*.py ]]; then
                add_backend_test "$path"
            else
                unmapped+=("$path")
            fi
            ;;
        tests/*.py)
            stem="${path##*/}"
            stem="${stem%.py}"
            mapfile -t found < <(tests_matching \
                "^[[:space:]]*(from|import)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*\.)*${stem}([[:space:]]|\.|,|$)")
            add_backend_test "${found[@]}"
            [ "${#found[@]}" -gt 0 ] || unmapped+=("$path")
            ;;
        src/ontocurator/*.py)
            module="${path#src/}"
            module="${module%.py}"
            module="${module//\//.}"
            module="${module%.__init__}"
            stem="${module##*.}"
            parent="${module%.*}"
            mapfile -t found < <(
                tests_matching "(^|[^A-Za-z0-9_.])$(escape "$module")([^A-Za-z0-9_]|$)|^[[:space:]]*from[[:space:]]+$(escape "$parent")[[:space:]]+import[[:space:]].*\b${stem}\b"
                compgen -G "tests/test_${stem}.py" || true
                compgen -G "tests/test_${stem}_*.py" || true
                # A route module is tested by its feature's API tests.
                if [[ "$stem" == *_routes ]]; then
                    compgen -G "tests/test_${stem%_routes}*.py" || true
                fi
                # A migration is named by its revision id ("0019").
                if [[ "$path" == */migrations/versions/* && "$stem" =~ ^([0-9]{4})_ ]]; then
                    tests_matching "[\"']${BASH_REMATCH[1]}[\"']"
                fi
            )
            add_backend_test "${found[@]}"
            [ "${#found[@]}" -gt 0 ] || unmapped+=("$path")
            ;;
        src/*|pyproject.toml|uv.lock|alembic.ini)
            unmapped+=("$path")
            ;;
        frontend/src/*.ts|frontend/src/*.tsx|frontend/tests/*.ts|frontend/tests/*.tsx)
            if [ -f "$path" ]; then
                frontend_files+=("${path#frontend/}")
            fi
            ;;
        frontend/*)
            notes+=("$path is frontend configuration; run 'bash scripts/check.sh --only frontend'.")
            ;;
    esac
done

needs_docker=0
if [ "${#backend_tests[@]}" -gt 0 ] && [ -z "${ONTOCURATOR_TEST_PG_URL:-}" ]; then
    needs_docker=1
fi
if [ "$needs_docker" = 1 ]; then
    command -v docker >/dev/null 2>&1 \
        || fail "docker is not on PATH. Start Docker or set ONTOCURATOR_TEST_PG_URL for PostgreSQL checks."
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
    local status=0
    "$@" || status=$?
    if [ "$status" -eq 0 ]; then
        summary+=("ok      $(printf '%4ds' $((SECONDS - started)))  ${name}")
    else
        summary+=("failed  $(printf '%4ds' $((SECONDS - started)))  ${name}")
        print_summary
        fail "FAILED: ${name} (exit ${status}; command: $*)"
    fi
}

step "ruff check" uv run ruff check .
step "ruff format --check" uv run ruff format --check .
step "mypy" uv run mypy src
step "OpenAPI drift" uv run python scripts/export_openapi.py --check
step "admin error catalog drift" uv run python scripts/export_admin_error_codes.py --check
step "frontend typecheck" npm --prefix frontend run typecheck
step "TypeScript API drift" npm --prefix frontend run api:check

if [ "${#frontend_files[@]}" -gt 0 ]; then
    step "frontend related tests (${#frontend_files[@]} changed files)" \
        npm --prefix frontend run test:related -- \
        --maxWorkers="$vitest_workers" --minWorkers=1 "${frontend_files[@]}"
fi

if [ "${#backend_tests[@]}" -gt 0 ]; then
    workers=$pytest_workers
    [ "$workers" -le "${#backend_tests[@]}" ] || workers=${#backend_tests[@]}
    if [ "$workers" -gt 1 ]; then
        step "backend affected tests (${#backend_tests[@]} files)" \
            uv run pytest -q -n "$workers" "${backend_tests[@]}"
    else
        step "backend affected tests (${#backend_tests[@]} files)" \
            uv run pytest -q "${backend_tests[@]}"
    fi
elif [ "${#unmapped[@]}" -gt 0 ]; then
    print_summary
    printf '  %s\n' "${unmapped[@]}" >&2
    fail "no backend tests ran for the backend changes above; run 'bash scripts/check.sh --only backend'."
fi
if [ "${#unmapped[@]}" -gt 0 ]; then
    notes+=("no tests mapped for: ${unmapped[*]}; run 'bash scripts/check.sh --only backend' to cover them.")
fi

if [ "${#notes[@]}" -gt 0 ]; then
    echo ""
    printf 'Note: %s\n' "${notes[@]}"
fi
print_summary
echo "Affected checks passed (partial gate; run 'bash scripts/check.sh' before merge)."
