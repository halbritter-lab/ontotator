"""Check the user handbook (docs/handbook) against the UI source and changed code.

Label check: every bold span ``**...**`` in docs/handbook/*.md must occur literally
in a frontend/src *.ts or *.tsx file. A line carrying ``<!-- handbook: not-a-label -->``
is skipped (bold text there is emphasis, not a UI label).

Coverage check (with ``--base REF``): docs/handbook/coverage.toml maps source globs
to chapters; a chapter whose mapped files changed in ``REF...HEAD`` must change too,
unless a commit in ``REF..HEAD`` carries the trailer line ``Handbook: unchanged``.

Without docs/handbook both checks pass. `--check` is accepted for symmetry with the
export scripts; this script only checks.
"""

import fnmatch
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOLD = re.compile(r"\*\*(.+?)\*\*")
OPT_OUT = "<!-- handbook: not-a-label -->"
TRAILER = "Handbook: unchanged"


def missing_labels(root: Path) -> list[str]:
    handbook = root / "docs" / "handbook"
    if not handbook.is_dir():
        return []
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for pattern in ("*.ts", "*.tsx")
        for path in (root / "frontend" / "src").rglob(pattern)
    )
    missing = []
    for chapter in sorted(handbook.glob("*.md")):
        lines = chapter.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, start=1):
            if OPT_OUT in line:
                continue
            for label in BOLD.findall(line):
                if label not in source:
                    where = chapter.relative_to(root).as_posix()
                    missing.append(
                        f"{where}:{number}: label not in frontend/src: {label}"
                    )
    return missing


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def stale_chapters(root: Path, base: str) -> list[str]:
    coverage = root / "docs" / "handbook" / "coverage.toml"
    if not coverage.is_file():
        return []
    log = _git(root, "log", "--format=%B", f"{base}..HEAD")
    if any(line.strip() == TRAILER for line in log.splitlines()):
        return []
    changed = _git(root, "diff", "--name-only", f"{base}...HEAD").splitlines()
    entries = tomllib.loads(coverage.read_text(encoding="utf-8")).get("map", [])
    stale = []
    for entry in entries:
        chapter = f"docs/handbook/{entry['chapter']}"
        # fnmatch: "*" also crosses "/", so "dir/**" matches everything below dir.
        hits = [path for path in changed if fnmatch.fnmatch(path, entry["glob"])]
        if hits and chapter not in changed and chapter not in stale:
            stale.append(chapter)
    return [
        f"{chapter}: mapped source changed but the chapter did not "
        f"(update it, or add the commit trailer '{TRAILER}')"
        for chapter in stale
    ]


def check_handbook(root: Path, base: str | None = None) -> None:
    problems = missing_labels(root)
    if base is not None:
        problems += stale_chapters(root, base)
    if problems:
        raise SystemExit("\n".join(["Handbook check failed:", *problems]))
    print("Handbook is in sync with the UI source")


if __name__ == "__main__":
    args = sys.argv[1:]
    base = args[args.index("--base") + 1] if "--base" in args else None
    check_handbook(ROOT, base)
