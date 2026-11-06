"""Restore drill script through a stub docker; no real containers."""

import os
import subprocess
from pathlib import Path

import pytest
from test_check_script import bash_executable

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/restore-check.sh"

# The stub answers the calls scripts/restore-check.sh makes. STUB_EXISTING makes
# the target project look taken, STUB_OWNER is the schema owner, STUB_ROWS the
# restored row count of ontotator.users, STUB_MODE the mode of the restored
# file, STUB_FAIL names a step that fails.
DOCKER_STUB = r"""#!/usr/bin/env bash
printf '%s\n' "docker $*" | tr '\n' ' ' >> "$STUB_LOG"; echo >> "$STUB_LOG"
case "$*" in
  *" ps --all --quiet ontotator_app") echo restore123 ;;
  *" ps --all --quiet") [[ -n "${STUB_EXISTING:-}" ]] && echo old456; true ;;
  "volume ls "*) true ;;
  "network inspect "*) exit 1 ;;
  "network create "*|"network rm "*) true ;;
  *" config --quiet") true ;;
  *" up -d --wait ontotator_postgres"|*" create ontotator_app") true ;;
  "inspect --format "*) echo ontotator-restore_ontotator-data ;;
  "run "*"--directory=/restore"*) cat > /dev/null ;;
  *"pg_restore --username"*)
    cat > /dev/null; [[ "${STUB_FAIL:-}" == restore ]] && exit 3; true ;;
  *"pg_restore --data-only"*)
    cat > /dev/null
    printf 'SET x;\nCOPY ontotator.users (id, name) FROM stdin;\n1\ta\n2\tb\n\\.\n'
    printf 'COPY ontotator."jobs" (id) FROM stdin;\n\\.\n'
    printf 'COPY ontotator.alembic_version (version_num) FROM stdin;\n0022\n\\.\n' ;;
  *"psql"*"nspowner"*) echo "${STUB_OWNER:-ontotator_owner}" ;;
  *"psql"*"alembic_version"*) echo 0022 ;;
  *"psql"*"information_schema"*)
    printf 'ontotator.users %s\nontotator.jobs 0\nontotator.alembic_version 1\n' \
      "${STUB_ROWS:-2}" ;;
  "run "*"--to-command"*)
    cat > /dev/null; echo "aaa 1001:1001 0600 ./ontologies/hp.json" ;;
  "run "*"--entrypoint find"*)
    echo "aaa 1001:1001 ${STUB_MODE:-0600} ./ontologies/hp.json" ;;
  *" up -d --wait") [[ "${STUB_FAIL:-}" == up ]] && exit 5; true ;;
  *"exec -T ontotator_app python"*) echo '{"ready": true}' ;;
  *" ps --all") true ;;
  *" down --volumes --remove-orphans") true ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
"""


def _make_point(directory: Path) -> Path:
    directory.mkdir()
    (directory / "database.dump").write_bytes(b"PGDMP-dump")
    (directory / "data.tar").write_bytes(b"tar-bytes")
    (directory / "image-reference.txt").write_text("ghcr.io/x/ontotator@sha256:abc\n")
    subprocess.run(
        "sha256sum database.dump data.tar image-reference.txt > SHA256SUMS",
        shell=True,
        cwd=directory,
        check=True,
    )
    return directory


@pytest.fixture
def drill(tmp_path):
    binaries = tmp_path / "bin"
    binaries.mkdir()
    stub = binaries / "docker"
    stub.write_text(DOCKER_STUB, encoding="utf-8", newline="\n")
    stub.chmod(0o755)
    point = _make_point(tmp_path / "20261106T033000Z")
    target = tmp_path / "isolated-restore"
    (target / "docker").mkdir(parents=True)
    (target / "secrets").mkdir()
    for name in ("docker-compose.yml", ".env", "docker/postgres-init.sh"):
        (target / name).write_text("")
    log = tmp_path / "calls.log"

    def run(*args, point=point, **extra):
        env = dict(os.environ)
        env.update(PATH=str(binaries) + os.pathsep + env["PATH"], STUB_LOG=str(log))
        env.update(extra)
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), str(SCRIPT), str(point), str(target), *args],
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        calls = log.read_text().splitlines() if log.exists() else []
        return result, [call.strip() for call in calls]

    run.point = point
    return run


def _index(calls, fragment):
    return next(i for i, call in enumerate(calls) if fragment in call)


def test_restores_checks_and_removes_the_isolated_project(drill):
    result, calls = drill("--project", "drill-one")
    assert result.returncode == 0, result.stderr
    assert "result:         passed" in result.stdout
    assert "row counts of 3 tables equal (3 rows)" in result.stderr
    assert "1 files byte-identical" in result.stderr
    assert '{"ready": true}' in result.stderr
    assert all(
        "--project-name drill-one" in call
        for call in calls
        if call.startswith("docker compose")
    )
    network = _index(calls, "network create drill-one-npm")
    postgres = _index(calls, "up -d --wait ontotator_postgres")
    extract = _index(calls, "--directory=/restore")
    restore = _index(calls, "pg_restore --username")
    counts = _index(calls, "information_schema")
    hashes = _index(calls, "--entrypoint find")
    start = next(i for i, c in enumerate(calls) if c.endswith(" up -d --wait"))
    down = _index(calls, "down --volumes")
    removed = _index(calls, "network rm drill-one-npm")
    assert network < postgres < extract < restore < counts < hashes < start < down
    assert down < removed == len(calls) - 1
    assert "--network none" in calls[extract]
    assert "dst=/restore,readonly" in calls[hashes]
    assert "ghcr.io/x/ontotator@sha256:abc" in calls[extract]


def test_a_point_that_does_not_verify_touches_no_container(drill):
    (drill.point / "data.tar").write_bytes(b"changed")
    result, calls = drill()
    assert result.returncode == 1
    assert "SHA256SUMS does not verify" in result.stderr
    assert calls == []


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        ({"STUB_ROWS": "1"}, "row counts differ"),
        ({"STUB_MODE": "0644"}, "/data differs"),
        ({"STUB_OWNER": "ontotator_bootstrap"}, "owned by 'ontotator_bootstrap'"),
        ({"STUB_FAIL": "restore"}, "result:         FAILED"),
    ],
)
def test_a_failed_check_never_starts_the_app_and_still_cleans_up(drill, extra, message):
    result, calls = drill(**extra)
    assert result.returncode != 0
    assert message in result.stderr + result.stdout
    assert "result:         FAILED" in result.stdout
    assert not any(call.endswith(" up -d --wait") for call in calls)
    assert any("down --volumes --remove-orphans" in call for call in calls)
    assert calls[-1].startswith("docker network rm ")


def test_an_app_that_does_not_start_fails_and_cleans_up(drill):
    result, calls = drill(STUB_FAIL="up")
    assert result.returncode == 5
    assert "result:         FAILED" in result.stdout
    assert any("down --volumes --remove-orphans" in call for call in calls)


def test_refuses_a_project_that_already_exists_and_leaves_it_alone(drill):
    result, calls = drill("--project", "ontotator", STUB_EXISTING="1")
    assert result.returncode == 1
    assert "already has containers" in result.stderr
    assert not any("down" in call or "network create" in call for call in calls)


def test_keep_leaves_the_project_for_inspection(drill):
    result, calls = drill("--keep")
    assert result.returncode == 0, result.stderr
    assert "--keep" in result.stderr
    assert not any("down" in call or "network rm" in call for call in calls)


def test_refuses_an_incomplete_recovery_point(drill, tmp_path):
    partial = _make_point(tmp_path / "20261106T033000Z.partial")
    result, calls = drill(point=partial)
    assert result.returncode == 1
    assert "incomplete recovery point" in result.stderr
    assert calls == []


@pytest.mark.parametrize(
    "args",
    [
        (),
        ("POINT",),
        ("POINT", "POINT", "--project", "Bad Name"),
        ("POINT", "POINT", "--bogus"),
    ],
)
def test_refuses_bad_arguments(tmp_path, args):
    args = [str(tmp_path) if arg == "POINT" else arg for arg in args]
    result = subprocess.run(
        [bash_executable(), str(SCRIPT), *args],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 2
    assert "Usage" in result.stderr
