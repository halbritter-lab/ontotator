"""The handbook check: bold UI labels exist in frontend/src; chapters follow code."""

import importlib.util
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_handbook.py"
_spec = importlib.util.spec_from_file_location("check_handbook", SCRIPT)
assert _spec is not None and _spec.loader is not None
check_handbook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_handbook)

COVERAGE = (
    '[[map]]\nglob = "frontend/src/consolidation/**"\nchapter = "consolidator.md"\n'
)


def write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.email", "t@example.org")
    git(tmp_path, "config", "user.name", "T")
    write(tmp_path, "frontend/src/consolidation/Panel.tsx", "<b>Accept</b>\n")
    write(tmp_path, "docs/handbook/coverage.toml", COVERAGE)
    write(tmp_path, "docs/handbook/consolidator.md", "Click **Accept**.\n")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-q", "-m", "base")
    git(tmp_path, "checkout", "-q", "-b", "topic")
    return tmp_path


def commit(root: Path, relative: str, message: str) -> None:
    write(root, relative, (root / relative).read_text(encoding="utf-8") + "x\n")
    git(root, "commit", "-q", "-am", message)


def test_without_handbook_both_checks_pass(tmp_path: Path) -> None:
    assert check_handbook.missing_labels(tmp_path) == []
    assert check_handbook.stale_chapters(tmp_path, "main") == []


def test_missing_labels_are_reported_with_file_and_line(tmp_path: Path) -> None:
    write(tmp_path, "frontend/src/a.tsx", "<button>Accept result</button>")
    write(tmp_path, "frontend/src/b.ts", "export const t = 'Next task';")
    write(
        tmp_path,
        "docs/handbook/lead.md",
        "Press **Accept result**.\n"
        "Then **Gone label** and **Next task**.\n"
        "This is **important**. <!-- handbook: not-a-label -->\n",
    )

    assert check_handbook.missing_labels(tmp_path) == [
        "docs/handbook/lead.md:2: label not in frontend/src: Gone label"
    ]
    with pytest.raises(SystemExit, match=r"lead\.md:2"):
        check_handbook.check_handbook(tmp_path)


def test_mapped_change_without_chapter_change_fails(repo: Path) -> None:
    commit(repo, "frontend/src/consolidation/Panel.tsx", "feat: tweak")

    assert check_handbook.stale_chapters(repo, "main") == [
        "docs/handbook/consolidator.md: mapped source changed but the chapter did not "
        "(update it, or add the commit trailer 'Handbook: unchanged')"
    ]


def test_chapter_change_or_trailer_satisfies_coverage(repo: Path) -> None:
    commit(repo, "frontend/src/consolidation/Panel.tsx", "feat: tweak")
    commit(repo, "docs/handbook/consolidator.md", "docs: follow")
    assert check_handbook.stale_chapters(repo, "main") == []

    git(repo, "reset", "-q", "--hard", "HEAD~1")
    commit(
        repo,
        "frontend/src/consolidation/Panel.tsx",
        "refactor: x\n\nHandbook: unchanged",
    )
    assert check_handbook.stale_chapters(repo, "main") == []


def test_unmapped_change_needs_no_chapter(repo: Path) -> None:
    write(repo, "src/other.py", "x = 1\n")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "chore: other")

    assert check_handbook.stale_chapters(repo, "main") == []
