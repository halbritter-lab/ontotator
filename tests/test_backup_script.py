"""Scheduled backup script through a stub docker; no real containers."""

import os
import subprocess
from pathlib import Path

import pytest
from test_check_script import bash_executable

ROOT = Path(__file__).resolve().parents[1]

# The stub answers the calls scripts/backup.sh makes, in that order. STUB_RUNNING
# is the running-job count; STUB_FAIL names a step that fails.
DOCKER_STUB = r"""#!/usr/bin/env bash
printf '%s\n' "docker $*" >> "$STUB_LOG"
case "$*" in
  "compose ps --all --quiet ontotator_app") echo container123 ;;
  "inspect --format {{ .Config.Image }} container123") echo "ghcr.io/x/ontotator@sha256:abc" ;;
  "inspect --format "*) echo ontotator_ontotator-data ;;
  *"psql"*) echo "${STUB_RUNNING:-0}" ;;
  *"pg_dump"*) [[ "${STUB_FAIL:-}" == dump ]] && exit 3; printf 'PGDMP-dump' ;;
  "run "*) [[ "${STUB_FAIL:-}" == tar ]] && exit 4; printf 'tar-bytes' ;;
  "compose up -d --wait ontotator_app") [[ "${STUB_FAIL:-}" == up ]] && exit 5; true ;;
esac
"""


@pytest.fixture
def backup(tmp_path):
    binaries = tmp_path / "bin"
    binaries.mkdir()
    stub = binaries / "docker"
    stub.write_text(DOCKER_STUB, encoding="utf-8", newline="\n")
    stub.chmod(0o755)
    root = tmp_path / "backups"
    root.mkdir()
    log = tmp_path / "calls.log"

    def run(*args, **extra):
        env = dict(os.environ)
        env.update(PATH=str(binaries) + os.pathsep + env["PATH"], STUB_LOG=str(log))
        env.update(extra)
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), str(ROOT / "scripts/backup.sh"), str(root), *args],
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    run.root = root
    return run


def test_takes_a_checksummed_recovery_point_and_restarts_the_app(backup):
    result, calls = backup()
    assert result.returncode == 0, result.stderr
    point = Path(result.stdout.strip().splitlines()[-1])
    assert point.parent == backup.root and not point.name.endswith(".partial")
    assert sorted(p.name for p in point.iterdir()) == [
        "SHA256SUMS",
        "data.tar",
        "database.dump",
        "image-reference.txt",
    ]
    assert (point / "database.dump").read_bytes() == b"PGDMP-dump"
    assert (point / "image-reference.txt").read_text() == (
        "ghcr.io/x/ontotator@sha256:abc\n"
    )
    check = subprocess.run(
        ["sha256sum", "--check", "SHA256SUMS"], cwd=point, capture_output=True
    )
    assert check.returncode == 0
    stop = calls.index("docker compose stop ontotator_app")
    dump = next(i for i, c in enumerate(calls) if "pg_dump" in c)
    archive = next(i for i, c in enumerate(calls) if c.startswith("docker run "))
    up = calls.index("docker compose up -d --wait ontotator_app")
    assert stop < dump < archive < up
    assert "src=ontotator_ontotator-data,dst=/source,readonly" in calls[archive]
    assert "--network none" in calls[archive]


def test_running_jobs_past_the_wait_leave_the_app_untouched(backup):
    result, calls = backup("--wait-jobs", "0", STUB_RUNNING="2")
    assert result.returncode == 75
    assert "2 job(s) still running" in result.stderr
    assert not any("stop" in call or "pg_dump" in call for call in calls)
    assert list(backup.root.iterdir()) == []


@pytest.mark.parametrize("step", ["dump", "tar"])
def test_a_failed_backup_still_restarts_the_app_and_stays_partial(backup, step):
    result, calls = backup(STUB_FAIL=step)
    assert result.returncode != 0
    assert calls[-1] == "docker compose up -d --wait ontotator_app"
    assert "FAILED" in result.stderr
    (left,) = backup.root.iterdir()
    assert left.name.endswith(".partial")


def test_a_complete_point_is_kept_when_the_restart_fails(backup):
    result, _ = backup(STUB_FAIL="up")
    assert result.returncode == 1
    assert "did not come back healthy" in result.stderr
    (point,) = backup.root.iterdir()
    assert (point / "SHA256SUMS").is_file()


def test_retention_removes_only_old_points_this_script_created(backup):
    old = backup.root / "20200101T000000Z"
    stale = backup.root / "20200101T000000Z.partial"
    foreign = backup.root / "keep-me"
    for directory in (old, stale, foreign):
        directory.mkdir()
        os.utime(directory, (0, 0))
    result, _ = backup("--keep-days", "14")
    assert result.returncode == 0, result.stderr
    names = sorted(p.name for p in backup.root.iterdir())
    assert "keep-me" in names
    assert old.name not in names and stale.name not in names
    assert len(names) == 2


@pytest.mark.parametrize(
    "args",
    [
        (),
        ("--wait-jobs", "5"),
        ("ROOT", "--wait-jobs", "x"),
        ("ROOT", "--keep-days", "0"),
        ("ROOT", "--bogus"),
    ],
)
def test_refuses_bad_arguments(tmp_path, args):
    args = [str(tmp_path) if arg == "ROOT" else arg for arg in args]
    result = subprocess.run(
        [bash_executable(), str(ROOT / "scripts/backup.sh"), *args],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        timeout=30,
    )
    assert result.returncode == 2
    assert "Usage" in result.stderr
