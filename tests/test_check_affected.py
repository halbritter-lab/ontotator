"""Affected-test selection of the inner-loop check through stubbed tools."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from test_check_script import bash_executable

ROOT = Path(__file__).resolve().parents[1]
STATIC = [
    "uv run ruff check .",
    "uv run ruff format --check .",
    "uv run mypy src",
    "uv run python scripts/export_openapi.py --check",
    "uv run python scripts/export_admin_error_codes.py --check",
    "npm --prefix frontend run typecheck",
    "npm --prefix frontend run api:check",
]


@pytest.fixture
def quick(tmp_path):
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for name in ["check.sh", "check-affected.sh"]:
        shutil.copyfile(ROOT / "scripts" / name, scripts / name)
    (tmp_path / "frontend/node_modules").mkdir(parents=True)
    files = {
        "src/ontocurator/auth/passwords.py": "",
        "src/ontocurator/auth/__init__.py": "",
        "src/ontocurator/orphan.py": "",
        "tests/test_passwords.py": "",
        "tests/test_passwords_policy.py": "",
        "tests/test_login.py": "from ontocurator.auth.passwords import x\n",
        "tests/test_cli.py": "from ontocurator.auth import sessions, passwords\n",
        "tests/test_other.py": "import ontocurator.storage\n",
        "tests/auth_harness.py": "",
        "tests/test_users.py": "from auth_harness import log_in\n",
        "frontend/src/a.ts": "",
        "frontend/tests/a.test.ts": "",
    }
    for name, content in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(content, encoding="utf-8")
    binaries = tmp_path / "bin"
    binaries.mkdir()
    log = tmp_path / "calls.log"
    for name in ["uv", "npm", "docker"]:
        stub = binaries / name
        stub.write_text(
            "#!/usr/bin/env bash\nprintf '%s\\n' \""
            + name
            + ' $*" >> "$CHECK_TEST_LOG"\n',
            encoding="utf-8",
            newline="\n",
        )
        stub.chmod(0o755)

    def run(*args, script="scripts/check-affected.sh", **extra):
        env = dict(os.environ)
        for name in [
            "CHECK_BASE",
            "CHECK_VITEST_WORKERS",
            "CHECK_PYTEST_WORKERS",
            "ONTOCURATOR_TEST_PG_URL",
        ]:
            env.pop(name, None)
        env.update(
            PATH=str(binaries) + os.pathsep + env["PATH"],
            CHECK_TEST_LOG=log.as_posix(),
            **extra,
        )
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), script, *args],
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
            timeout=60,
        )
        return result, log.read_text().splitlines() if log.exists() else []

    run.workspace = tmp_path
    return run


def test_changed_module_selects_named_and_importing_tests(quick):
    result, calls = quick("src/ontocurator/auth/passwords.py", "frontend/src/a.ts")
    assert result.returncode == 0, result.stderr
    assert calls[0] == "docker info"
    assert calls[1:8] == STATIC
    assert calls[8] == (
        "npm --prefix frontend run test:related --"
        " --maxWorkers=2 --minWorkers=1 src/a.ts"
    )
    backend = calls[9].split()
    assert backend[:6] == ["uv", "run", "pytest", "-q", "-n", "2"]
    assert sorted(backend[6:]) == [
        "tests/test_cli.py",
        "tests/test_login.py",
        "tests/test_passwords.py",
        "tests/test_passwords_policy.py",
    ]
    assert len(calls) == 10
    assert "partial gate" in result.stdout


def test_changed_test_and_helper_select_their_tests_serially_for_one_file(quick):
    result, calls = quick("tests/auth_harness.py", ONTOCURATOR_TEST_PG_URL="test-only")
    assert result.returncode == 0, result.stderr
    assert calls == [*STATIC, "uv run pytest -q tests/test_users.py"]


def test_unmapped_python_change_repeats_last_failures(quick):
    result, calls = quick("src/ontocurator/orphan.py", CHECK_PYTEST_WORKERS="4")
    assert result.returncode == 0, result.stderr
    assert calls[-1] == "uv run pytest -q --lf --last-failed-no-failures none"


def test_shared_test_setup_points_to_the_backend_stage(quick):
    result, calls = quick("tests/conftest.py", ONTOCURATOR_TEST_PG_URL="test-only")
    assert result.returncode == 0, result.stderr
    assert "--only backend" in result.stdout
    assert calls[-1] == "uv run pytest -q --lf --last-failed-no-failures none"


def test_docs_only_change_runs_static_checks_without_docker(quick):
    result, calls = quick("docs/readme.md")
    assert result.returncode == 0, result.stderr
    assert calls == STATIC


def test_check_sh_quick_delegates_with_arguments(quick):
    result, calls = quick(
        "--quick", "frontend/tests/a.test.ts", script="scripts/check.sh"
    )
    assert result.returncode == 0, result.stderr
    assert calls[-1].endswith("--minWorkers=1 tests/a.test.ts")


@pytest.mark.parametrize("arguments", [("--bad",), ("--base",)])
def test_bad_arguments_fail_before_invoking_tools(quick, arguments):
    result, calls = quick(*arguments)
    assert result.returncode != 0
    assert calls == []


def test_without_paths_uses_changes_against_the_base_ref(quick):
    if shutil.which("git") is None:
        pytest.skip("git is required")
    workspace = quick.workspace

    def git(*args):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.org", *args],
            cwd=workspace,
            check=True,
            capture_output=True,
        )

    git("init", "-q", "-b", "trunk")
    git("add", "-A")
    git("commit", "-qm", "base")
    git("checkout", "-qb", "work")
    (workspace / "tests/test_other.py").write_text("# changed\n", encoding="utf-8")
    git("commit", "-qam", "change")
    (workspace / "frontend/src/a.ts").write_text("// dirty\n", encoding="utf-8")

    result, calls = quick("--base", "trunk", ONTOCURATOR_TEST_PG_URL="test-only")
    assert result.returncode == 0, result.stderr
    assert calls[-2].endswith("--minWorkers=1 src/a.ts")
    assert calls[-1] == "uv run pytest -q tests/test_other.py"

    result, calls = quick("--base", "missing")
    assert result.returncode != 0
    assert calls == []
