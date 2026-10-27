"""Local gate dispatch through lightweight tools; no real services or test runners."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def bash_executable():
    if os.name == "nt":
        for candidate in [
            Path(os.environ.get("PROGRAMFILES", "C:/Program Files"))
            / "Git/bin/bash.exe",
            Path.home() / "scoop/apps/git/current/bin/bash.exe",
        ]:
            if candidate.is_file():
                return str(candidate)
    executable = shutil.which("bash")
    if executable is None:
        pytest.skip("The local gate requires Bash")
    return executable


@pytest.fixture
def gate(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copyfile(
        Path(os.environ.get("CHECK_SCRIPT_UNDER_TEST", ROOT / "scripts/check.sh")),
        scripts / "check.sh",
    )
    (tmp_path / "frontend/node_modules").mkdir(parents=True)
    binaries = tmp_path / "bin"
    binaries.mkdir()
    log = tmp_path / "calls.log"
    for name in ["uv", "npm", "docker"]:
        stub = binaries / name
        stub.write_text(
            "#!/usr/bin/env bash\nprintf '%s\\n' \""
            + name
            + ' $*" >> "$CHECK_TEST_LOG"\n'
            + 'if [[ -n "${CHECK_TEST_FAIL:-}" && "'
            + name
            + ' $*" == *"$CHECK_TEST_FAIL"* ]]; then exit 9; fi\n',
            encoding="utf-8",
            newline="\n",
        )
        stub.chmod(0o755)

    def run(*args, **extra):
        env = dict(os.environ)
        for name in [
            "CHECK_CONTAINERS",
            "CHECK_IMAGE",
            "CHECK_VITEST_WORKERS",
            "CHECK_PYTEST_WORKERS",
            "CHECK_PLAYWRIGHT_WORKERS",
            "ONTOTATOR_TEST_PG_URL",
            "CHECK_TEST_FAIL",
        ]:
            env.pop(name, None)
        env.update(
            PATH=str(binaries) + os.pathsep + env["PATH"],
            CHECK_TEST_LOG=log.as_posix(),
            **extra,
        )
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), "scripts/check.sh", *args],
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        return result, log.read_text().splitlines() if log.exists() else []

    run.workspace = tmp_path
    return run


def test_default_runs_every_required_phase_serially_with_bounded_workers(gate):
    result, calls = gate()
    assert result.returncode == 0, result.stderr
    assert any("test_admin_error_codes.py" in call for call in calls)
    assert any("pytest -q -n 4 --durations=20" in call for call in calls)
    assert any("--maxWorkers=2 --minWorkers=1" in call for call in calls)
    assert calls == [
        "docker info",
        "uv run ruff check .",
        "uv run ruff format --check .",
        "uv run mypy src",
        "uv run python scripts/export_openapi.py --check",
        "uv run python scripts/export_admin_error_codes.py --check",
        "uv run pytest tests/test_admin_error_codes.py tests/test_check_wheel.py tests/test_check_script.py -q",
        "npm --prefix frontend run typecheck",
        "npm --prefix frontend run api:check",
        "uv run python scripts/check_wheel.py --out-dir build/check-wheel",
        "npm --prefix frontend test -- --maxWorkers=2 --minWorkers=1",
        "uv run pytest -q -n 4 --durations=20",
        "npm --prefix frontend run test:e2e -- --workers=3",
    ]
    assert "All local checks passed." in result.stdout
    assert "partial" not in result.stdout.lower()


@pytest.mark.parametrize(
    "stage, expected, forbidden",
    [
        ("static", "ruff check", "docker"),
        ("frontend", "--maxWorkers=2", "docker"),
        ("backend", "pytest -q -n 4 --durations=20", "npm"),
        ("browser", "run test:e2e", "uv"),
        ("containers", "container_check.py --smoke", "npm"),
    ],
)
def test_selected_stage_runs_only_its_tools_and_reports_partial(
    gate, stage, expected, forbidden
):
    result, calls = gate("--only", stage)
    assert result.returncode == 0, result.stderr
    assert any(expected in call for call in calls)
    assert not any(call.startswith(forbidden) for call in calls)
    assert "partial" in result.stdout.lower()
    assert "All local checks passed." not in result.stdout


@pytest.mark.parametrize(
    "arguments",
    [
        ("--only",),
        ("--only", "unknown"),
        ("--bad",),
        ("--only", "backend", "--only", "browser"),
    ],
)
def test_bad_arguments_fail_before_invoking_tools(gate, arguments):
    result, calls = gate(*arguments)
    assert result.returncode != 0
    assert calls == []


def test_help_does_not_invoke_tools(gate):
    result, calls = gate("--help")
    assert result.returncode == 0
    assert all(
        stage in result.stdout
        for stage in ["static", "frontend", "backend", "browser", "containers"]
    )
    assert calls == []


def test_failure_reports_completed_and_failed_timings_without_later_phases(gate):
    result, calls = gate(CHECK_TEST_FAIL="ruff format")
    assert result.returncode != 0
    assert "Summary:" in result.stdout
    assert "ruff check" in result.stdout
    assert "failed" in result.stdout.lower()
    assert "ruff format --check" in result.stdout
    assert not any("mypy" in call for call in calls)
    assert "All local checks passed." not in result.stdout


def test_worker_override_and_opt_in_container_stage_are_preserved(gate):
    result, calls = gate(
        CHECK_VITEST_WORKERS="4", CHECK_CONTAINERS="1", CHECK_IMAGE="local:test"
    )
    assert result.returncode == 0, result.stderr
    assert any("--maxWorkers=4 --minWorkers=1" in call for call in calls)
    assert calls[-1].endswith("container_check.py --smoke --image local:test")


@pytest.mark.parametrize("workers", ["0", "-1", "many", "1.5"])
def test_worker_override_requires_positive_integer_before_tools(gate, workers):
    result, calls = gate("--only", "frontend", CHECK_VITEST_WORKERS=workers)
    assert result.returncode != 0
    assert "CHECK_VITEST_WORKERS" in result.stderr
    assert calls == []


def test_external_postgres_does_not_require_docker_for_backend(gate):
    result, calls = gate("--only", "backend", ONTOTATOR_TEST_PG_URL="test-only")
    assert result.returncode == 0, result.stderr
    assert not any(call.startswith("docker") for call in calls)


def test_backend_does_not_require_frontend_dependencies(gate):
    (gate.workspace / "frontend/node_modules").rmdir()
    result, calls = gate("--only", "backend", ONTOTATOR_TEST_PG_URL="test-only")
    assert result.returncode == 0, result.stderr
    assert calls == ["uv run pytest -q -n 4 --durations=20"]
    result, calls = gate("--only", "frontend")
    assert result.returncode != 0
    assert "frontend dependencies are missing" in result.stderr
    assert calls == []


def test_container_smoke_requires_frontend_dependencies_before_docker(gate):
    (gate.workspace / "frontend/node_modules").rmdir()
    result, calls = gate("--only", "containers")
    assert result.returncode != 0
    assert "frontend dependencies are missing" in result.stderr
    assert calls == []


@pytest.mark.parametrize(
    "workers, expected",
    [
        ("0", "uv run pytest -q --durations=20"),
        ("1", "uv run pytest -q --durations=20"),
        ("6", "uv run pytest -q -n 6 --durations=20"),
        ("08", "uv run pytest -q -n 8 --durations=20"),
    ],
)
def test_backend_worker_override_runs_serially_at_one_or_less(gate, workers, expected):
    result, calls = gate(
        "--only",
        "backend",
        ONTOTATOR_TEST_PG_URL="test-only",
        CHECK_PYTEST_WORKERS=workers,
    )
    assert result.returncode == 0, result.stderr
    assert calls == [expected]


def test_browser_worker_override_reaches_playwright(gate):
    result, calls = gate("--only", "browser", CHECK_PLAYWRIGHT_WORKERS="2")
    assert result.returncode == 0, result.stderr
    assert calls[-1] == "npm --prefix frontend run test:e2e -- --workers=2"


@pytest.mark.parametrize(
    "stage, variable, workers",
    [
        ("backend", "CHECK_PYTEST_WORKERS", "-1"),
        ("backend", "CHECK_PYTEST_WORKERS", "many"),
        ("browser", "CHECK_PLAYWRIGHT_WORKERS", "0"),
        ("browser", "CHECK_PLAYWRIGHT_WORKERS", "1.5"),
    ],
)
def test_backend_and_browser_worker_overrides_are_validated_before_tools(
    gate, stage, variable, workers
):
    result, calls = gate("--only", stage, **{variable: workers})
    assert result.returncode != 0
    assert variable in result.stderr
    assert calls == []
