"""Pure rules of the project guidelines (spec G11, G13, G17, G20, G25).

A guideline is an uploaded UTF-8 file; its kind follows the file extension.
The current version is the highest one unless that one is withdrawn, in which
case no guideline is in force (no fallback to an earlier version).
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from ontocurator.domain.errors import DomainError

GuidelineKind = Literal["markdown", "text"]
MAX_GUIDELINE_BYTES = 262_144
MAX_NOTE_CHARS = 280
NOTICE_LIMIT = 5

_BOM = b"\xef\xbb\xbf"
_KINDS: dict[str, GuidelineKind] = {
    "md": "markdown",
    "markdown": "markdown",
    "txt": "text",
}


def kind_for_filename(filename: str) -> GuidelineKind:
    """The kind by extension (G11): the extension decides, not the content."""
    stem, dot, extension = filename.rpartition(".")
    kind = _KINDS.get(extension.lower()) if dot and stem else None
    if kind is None:
        raise DomainError("GUIDELINE_FILE_TYPE", {"filename": filename})
    return kind


def decode_body(data: bytes) -> str:
    """The text of an uploaded file (G13); one leading BOM is dropped."""
    if len(data) > MAX_GUIDELINE_BYTES + len(_BOM):
        raise DomainError("GUIDELINE_TOO_LARGE", {"max_bytes": MAX_GUIDELINE_BYTES})
    if data.startswith(_BOM):
        data = data[len(_BOM) :]
    if len(data) > MAX_GUIDELINE_BYTES:
        raise DomainError("GUIDELINE_TOO_LARGE", {"max_bytes": MAX_GUIDELINE_BYTES})
    if b"\x00" in data:
        raise DomainError("GUIDELINE_ENCODING")
    try:
        body = data.decode("utf-8")
    except UnicodeDecodeError:
        raise DomainError("GUIDELINE_ENCODING") from None
    if not body.strip():
        raise DomainError("GUIDELINE_EMPTY")
    return body


def validate_note(
    value: str | None, *, field: Literal["change_note", "reason"]
) -> str | None:
    """A change note or withdrawal reason: optional, one line, at most 280 chars."""
    if value is None:
        return None
    note = value.strip()
    if not note:
        return None
    if len(note) > MAX_NOTE_CHARS or "\n" in note or "\r" in note:
        raise DomainError("GUIDELINE_NOTE_INVALID", {"field": field})
    return note


def body_sha256(body: str) -> str:
    """SHA-256 of the body encoded as UTF-8 (hex)."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def guideline_ref(project_key: str, version: int, sha256: str) -> str:
    """The export reference of a recorded version (G20)."""
    return f"urn:ontocurator:{project_key}:guidelines:v{version}#sha256={sha256}"


@dataclass(frozen=True)
class VersionFact:
    version: int
    created_at: datetime
    change_note: str | None
    withdrawn: bool


def current_version(versions: Sequence[VersionFact]) -> int | None:
    """The highest version if it is not withdrawn, else none (G25)."""
    if not versions:
        return None
    latest = max(versions, key=lambda fact: fact.version)
    return None if latest.withdrawn else latest.version


@dataclass(frozen=True)
class Notice:
    from_version: int | None  # S, None for first exposure
    to_version: int  # L
    changes: tuple[VersionFact, ...]  # versions in (S, L], newest first
    more: int  # versions in (S, L] beyond NOTICE_LIMIT


def compute_notice(versions: Sequence[VersionFact], seen: int | None) -> Notice | None:
    """The notice for a user whose highest notified or opened version is ``seen``."""
    latest = current_version(versions)
    if latest is None or (seen is not None and seen >= latest):
        return None
    floor = 0 if seen is None else seen
    unseen = sorted(
        (fact for fact in versions if floor < fact.version <= latest),
        key=lambda fact: fact.version,
        reverse=True,
    )
    return Notice(
        from_version=seen,
        to_version=latest,
        changes=tuple(unseen[:NOTICE_LIMIT]),
        more=max(len(unseen) - NOTICE_LIMIT, 0),
    )
