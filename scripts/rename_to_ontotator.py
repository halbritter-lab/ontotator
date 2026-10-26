"""Rename the project "ontocurator" to "ontotator" in the current checkout.

Run from anywhere inside the repository:

    uv run python scripts/rename_to_ontotator.py

Idempotent: a second run finds nothing to do. Afterwards run `uv run ruff
format .` (shorter names reflow some lines), rebuild the web
bundle (npm run build in frontend/), run `uv lock` and `uv sync`.

- Tracked files whose path contains the old name are moved with `git mv`.
- Tracked text files get the content replaced, case preserved:
  ontocurator -> ontotator, Ontocurator/OntoCurator -> Ontotator,
  ONTOCURATOR -> ONTOTATOR; "onto-curator" forms likewise.
  The duplicate CLI alias `onto-curator` in pyproject.toml is dropped.
- Skipped: binary files, the built bundle under src/*/web/ (rebuilt), uv.lock
  except the project's own name entry (regenerate with `uv lock`), and this
  script. Absolute paths of the local checkout (".../Development/ontocurator")
  are left as they are, because the checkout directory is not renamed here.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import re
import subprocess
import sys
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

PATTERN = re.compile(
    # Keep local checkout paths such as C:/Users/.../Development/ontocurator.
    r"(?<!evelopment/)(?<!evelopment\\)(?<!evelopment-)onto-?curator",
    re.IGNORECASE,
)
SELF = "scripts/rename_to_ontotator.py"
CLI_ALIAS = re.compile(r'^onto-curator = "ontocurator\.cli:main"\r?\n', re.MULTILINE)
LOCK_NAME = re.compile(r'^name = "ontocurator"(?=\r?$)', re.MULTILINE)


def new_word(match: re.Match[str]) -> str:
    old = match.group(0)
    if old.isupper():
        return "ONTOTATOR"
    if old[0].isupper():
        return "Ontotator"
    return "ontotator"


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def tracked(root: Path) -> list[str]:
    return [p for p in git(root, "ls-files", "-z").split("\0") if p]


def move_paths(root: Path) -> int:
    """`git mv` every tracked file whose path contains the old name.

    Files, not directories: moving a directory onto an existing one (e.g. a
    leftover __pycache__-only src/ontotator) would nest it inside.
    """
    moved = 0
    by_dir: dict[str, list[str]] = {}
    for path in tracked(root):
        new = PATTERN.sub(new_word, path)
        if new == path:
            continue
        moved += 1
        if new.rpartition("/")[2] != path.rpartition("/")[2]:
            (root / new).parent.mkdir(parents=True, exist_ok=True)
            git(root, "mv", path, new)
            print(f"git mv {path} -> {new}")
        else:
            by_dir.setdefault(new.rpartition("/")[0], []).append(path)
    for dst, sources in by_dir.items():
        (root / dst).mkdir(parents=True, exist_ok=True)
        git(root, "mv", *sources, dst)
    if by_dir:
        n = sum(map(len, by_dir.values()))
        print(f"git mv {n} files into {len(by_dir)} renamed directories")
    # shortcut: old directories keep only ignored files (__pycache__); delete by hand.
    return moved


def is_built_bundle(path: str) -> bool:
    return path.startswith("src/") and "/web/" in path


def rename_text(path: str, text: str, counts: Counter[str]) -> str:
    if path == "uv.lock":
        text, n = LOCK_NAME.subn('name = "ontotator"', text)
        counts["ontocurator"] += n
        return text
    if path == "pyproject.toml":
        text, n = CLI_ALIAS.subn("", text)
        counts["onto-curator (alias dropped)"] += n
    for m in PATTERN.finditer(text):
        counts[m.group(0)] += 1
    return PATTERN.sub(new_word, text)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_hash(obj: object) -> str:
    # shortcut: JSON without floats/non-ASCII keys only, where RFC 8785 equals
    # sorted compact json.dumps; checked against the stored value before use.
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(text.encode("utf-8"))


def json_objects(data: bytes) -> list[dict[str, Any]]:
    """The JSON object of a .json member or each line of a .jsonl member."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return []
    try:
        docs = [json.loads(text)]
    except ValueError:
        try:
            docs = [json.loads(line) for line in text.splitlines() if line.strip()]
        except ValueError:
            return []
    return [d for d in docs if isinstance(d, dict)]


def stored_hashes(obj: dict[str, Any]) -> list[tuple[str, str]]:
    """(stored, recomputed) content hashes of package records."""
    pairs = []
    if "task_profile_sha256" in obj and "task_profile" in obj:
        pairs.append((obj["task_profile_sha256"], canonical_hash(obj["task_profile"])))
    if str(obj.get("schema_version", "")).endswith("-annotation/v3"):
        content = {k: v for k, v in obj.items() if k != "version"}
        pairs.append((obj["version"], canonical_hash(content)))
    return pairs


def rename_zip(path: str, raw: bytes, counts: Counter[str]) -> bytes:
    """Rewrite text members of a zip fixture, keeping order and metadata.

    Content hashes inside the package (task_profile_sha256, annotation
    snapshot versions, manifest file_hashes) follow the renamed contents.
    """
    with zipfile.ZipFile(io.BytesIO(raw)) as src:
        infos = src.infolist()
        old = [src.read(info) for info in infos]
    for data in old:
        for obj in json_objects(data):
            for stored, computed in stored_hashes(obj):
                if stored != computed:
                    raise SystemExit(f"{path}: cannot reproduce hash {stored}")
    new = []
    for data in old:
        with contextlib.suppress(UnicodeDecodeError):
            data = rename_text(path, data.decode("utf-8"), counts).encode("utf-8")
        new.append(data)
    # Snapshots may reference each other's versions: repeat until stable.
    while stale := {
        stored: computed
        for data in new
        for obj in json_objects(data)
        for stored, computed in stored_hashes(obj)
        if stored != computed
    }:
        new = [replace_hex(data, stale) for data in new]
    files = {sha256(a): sha256(b) for a, b in zip(old, new, strict=True) if a != b}
    new = [replace_hex(data, files) for data in new]
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for info, data in zip(infos, new, strict=True):
            dst.writestr(info, data)
    return out.getvalue()


def replace_hex(data: bytes, digests: dict[str, str]) -> bytes:
    for old_hex, new_hex in digests.items():
        data = data.replace(old_hex.encode(), new_hex.encode())
    return data


def replace_contents(
    root: Path,
) -> tuple[Counter[str], list[str], list[str], dict[str, str]]:
    counts: Counter[str] = Counter()
    changed: list[str] = []
    skipped: list[str] = []
    digests: dict[str, str] = {}  # old sha256 -> new sha256 of changed files
    for path in tracked(root):
        if path == SELF or is_built_bundle(path):
            continue
        file = root / path
        if not file.is_file():
            continue
        raw = file.read_bytes()
        if raw[:4] == b"PK\x03\x04" and zipfile.is_zipfile(file):
            before = sum(counts.values())
            new = rename_zip(path, raw, counts)
            if sum(counts.values()) == before:
                continue  # unchanged zip: keep the original bytes
        elif b"\0" in raw:
            continue
        else:
            try:
                new = rename_text(path, raw.decode("utf-8"), counts).encode("utf-8")
            except UnicodeDecodeError:
                if re.search(rb"(?i)onto-?curator", raw):
                    skipped.append(path)
                continue
        if new != raw:
            file.write_bytes(new)
            changed.append(path)
            digests[sha256(raw)] = sha256(new)
    return counts, changed, skipped, digests


def update_digests(root: Path, digests: dict[str, str]) -> list[str]:
    """Replace recorded sha256 values of changed files (manifests, docs)."""
    if not digests:
        return []
    pattern = re.compile("|".join(digests))
    updated = []
    for path in tracked(root):
        file = root / path
        if path == SELF or is_built_bundle(path) or not file.is_file():
            continue
        raw = file.read_bytes()
        if b"\0" in raw:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        new = pattern.sub(lambda m: digests[m.group(0)], text)
        if new != text:
            file.write_bytes(new.encode("utf-8"))
            updated.append(path)
    return updated


def main() -> int:
    root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").strip())
    assert PATTERN.sub(new_word, "ONTOCURATOR_X Ontocurator ontocuratorX") == (
        "ONTOTATOR_X Ontotator ontotatorX"
    )
    assert PATTERN.sub(new_word, "Development/ontocurator curator") == (
        "Development/ontocurator curator"
    )
    moves = move_paths(root)
    counts, changed, skipped, digests = replace_contents(root)
    hashed = update_digests(root, digests)
    print(f"\nPaths moved: {moves}")
    print(f"Files with replaced content: {len(changed)}")
    for word, n in counts.most_common():
        print(f"  {word}: {n}")
    print(f"  total: {sum(counts.values())}")
    zips = [p for p in changed if p.endswith(".zip")]
    if zips:
        print("Zip fixtures rewritten: " + ", ".join(zips))
    if hashed:
        print("Recorded sha256 values updated in: " + ", ".join(hashed))
    if skipped:
        print("Not UTF-8, left unchanged (check by hand):")
        for path in skipped:
            print(f"  {path}")
    print(
        "\nNext: `uv run ruff format .`, rebuild the web bundle, `uv lock`, `uv sync`."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
