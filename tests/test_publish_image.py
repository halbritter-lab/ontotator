"""Image publishing through stub tools; no real build, registry or GitHub access."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from test_check_script import bash_executable

ROOT = Path(__file__).resolve().parents[1]
DIGEST = "sha256:" + "a" * 64
STUBS = {
    "gh": "echo stub-token",
    # The existence check (no --format) finds no tag unless STUB_EXISTS is set.
    "docker": 'if [[ "$1" == buildx ]]; then [[ "$*" == *--format* ]] '
    '&& echo "${STUB_DIGEST}" || [[ -n "${STUB_EXISTS:-}" ]]; fi',
}


@pytest.fixture
def publish(tmp_path):
    # A real throwaway repository: Git Bash puts its own git ahead of PATH stubs.
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copyfile(
        ROOT / "scripts/publish-image.sh", repo / "scripts/publish-image.sh"
    )
    for command in [
        ["init", "-q"],
        ["add", "."],
        ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "t"],
    ]:
        subprocess.run(["git", *command], cwd=repo, check=True)
    binaries = tmp_path / "bin"
    binaries.mkdir()
    log = tmp_path / "calls.log"
    for name, body in STUBS.items():
        stub = binaries / name
        stub.write_text(
            f'#!/usr/bin/env bash\nprintf "%s\\n" "{name} $*" >> "$STUB_LOG"\n{body}\n',
            encoding="utf-8",
            newline="\n",
        )
        stub.chmod(0o755)

    def run(*args, **extra):
        env = dict(os.environ)
        env.pop("GITHUB_TOKEN_FILE", None)
        env.update(
            PATH=str(binaries) + os.pathsep + env["PATH"],
            STUB_LOG=log.as_posix(),
            STUB_DIGEST=DIGEST,
        )
        env.update(extra)
        log.unlink(missing_ok=True)
        result = subprocess.run(
            [bash_executable(), "scripts/publish-image.sh", *args],
            cwd=repo,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        return result, log.read_text().splitlines() if log.exists() else []

    run.workspace = repo
    return run


def test_builds_scans_pushes_the_version_tag_and_prints_digest_reference(publish):
    result, calls = publish("0.4.0")
    assert result.returncode == 0, result.stderr
    docker = [call for call in calls if call.startswith("docker")]
    assert (
        docker[0]
        == "docker buildx imagetools inspect ghcr.io/halbritter-lab/ontotator:0.4.0"
    )
    assert docker[1].startswith(
        "docker build --load --secret id=github_token,env=GITHUB_TOKEN"
    )
    assert docker[1].endswith("-t ghcr.io/halbritter-lab/ontotator:0.4.0 .")
    assert docker[2].startswith("docker run --rm") and "aquasec/trivy" in docker[2]
    assert docker[3] == "docker push ghcr.io/halbritter-lab/ontotator:0.4.0"
    assert docker[4].startswith(
        "docker buildx imagetools inspect ghcr.io/halbritter-lab/ontotator:0.4.0 --format"
    )
    assert not any(":latest" in call for call in docker)
    assert f"ONTOTATOR_IMAGE=ghcr.io/halbritter-lab/ontotator@{DIGEST}" in result.stdout
    assert "stub-token" not in result.stdout + result.stderr


def test_token_file_replaces_github_cli(publish):
    result, calls = publish("0.4.0", GITHUB_TOKEN_FILE="/private/token")
    assert result.returncode == 0, result.stderr
    assert not any(call.startswith("gh") for call in calls)
    assert any("--secret id=github_token,src=/private/token" in call for call in calls)


@pytest.mark.parametrize("args", [(), ("latest",), ("bad/tag",)])
def test_refuses_bad_version_before_building(publish, args):
    result, calls = publish(*args)
    assert result.returncode == 2
    assert calls == []


def test_refuses_dirty_tree_before_building(publish):
    (publish.workspace / "untracked").write_text("x")
    result, calls = publish("0.4.0")
    assert result.returncode == 1
    assert "uncommitted" in result.stderr
    assert calls == []


def test_refuses_an_existing_tag_before_building(publish):
    result, calls = publish("0.4.0", STUB_EXISTS="1")
    assert result.returncode == 1
    assert "already exists" in result.stderr
    assert not any(call.startswith(("docker build ", "docker push")) for call in calls)


def test_rejects_missing_digest(publish):
    result, _ = publish("0.4.0", STUB_DIGEST="")
    assert result.returncode != 0
    assert "ONTOTATOR_IMAGE=" not in result.stdout
