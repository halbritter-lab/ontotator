"""File naming shared by every path that stores an ontology in the workspace."""

from __future__ import annotations

import re
from pathlib import Path

_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]")


def content_addressed_name(filename: str | Path | None, sha256: str) -> str:
    """``<stem>-<sha256[:12]>.json`` with the stem reduced to ``[A-Za-z0-9._-]``.

    Used by the upload endpoint and by files dropped onto the executable, so
    both store the same bytes under the same name. Idempotent: a name that
    already ends in the digest prefix is not suffixed again.
    """
    stem = Path(filename or "ontology.json").stem
    suffix = f"-{sha256[:12]}"
    if stem.endswith(suffix):
        stem = stem[: -len(suffix)]
    stem = _UNSAFE_NAME_CHARS.sub("_", stem).strip("._") or "ontology"
    return f"{stem}{suffix}.json"
