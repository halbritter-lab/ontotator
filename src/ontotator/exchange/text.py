"""Strict UTF-8 document uploads, with bounded ZIP expansion."""

from __future__ import annotations

import hashlib
import io
import lzma
import re
import zipfile
import zlib
from collections.abc import Sequence
from pathlib import PurePosixPath

import ontospan
from ontospan.bundle import MAX_TOTAL_BYTES

from ontotator.domain.documents import Document
from ontotator.exchange.plan import IncomingUnit, Issue

DOCUMENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def read_text_upload(
    files: Sequence[tuple[str, bytes]],
    language: str,
    *,
    languages: Sequence[str] = (),
) -> tuple[list[IncomingUnit], list[Issue]]:
    """Canonicalize text, preserving the hash of each file's original bytes.

    ``languages`` is the project's current allowlist; an empty list is unrestricted.
    ZIP limits use the pinned ontospan reader's expansion bound, across all files.
    """
    units: list[IncomingUnit] = []
    issues: list[Issue] = []
    seen: set[str] = set()
    expanded = 0

    def error(code: str, label: str, message: str) -> None:
        issues.append(Issue(code=code, unit=label, message=message))

    if languages and language not in languages:
        error(
            "LANGUAGE_NOT_IN_PROJECT",
            "",
            f"Language {language!r} is not in the project",
        )
        return [], issues

    def text(label: str, name: str, data: bytes) -> None:
        if PurePosixPath(name).suffix.lower() != ".txt":
            error("UNSUPPORTED_FILE", label, "Expected a .txt file")
            return
        document_id = PurePosixPath(name).stem
        if not DOCUMENT_ID.fullmatch(document_id):
            error("DOCUMENT_ID_INVALID", label, f"Invalid document ID {document_id!r}")
            return
        if document_id in seen:
            error(
                "DUPLICATE_DOCUMENT_ID", label, f"Duplicate document ID {document_id!r}"
            )
            return
        seen.add(document_id)
        try:
            decoded = data.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            error("TEXT_NOT_UTF8", label, "Text is not strict UTF-8")
            return
        canonical = ontospan.canonical_text(decoded.removeprefix("\ufeff"))
        if not canonical:
            error("TEXT_EMPTY", label, "Text is empty")
            return
        units.append(
            IncomingUnit(
                label=label,
                document=Document(
                    document_id=document_id,
                    language=language,
                    text=canonical,
                    text_sha256=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
                ),
                source_text_sha256=hashlib.sha256(data).hexdigest(),
                normalised=canonical != decoded,
            )
        )

    for name, data in files:
        if PurePosixPath(name).suffix.lower() != ".zip":
            expanded += len(data)
            if expanded > MAX_TOTAL_BYTES:
                error("too_large", name, "Upload exceeds the expanded size limit")
                continue
            text(name, name, data)
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                infos = [
                    i
                    for i in archive.infolist()
                    if not i.is_dir() and not i.filename.startswith("__MACOSX/")
                ]
                expanded += sum(i.file_size for i in infos)
                if expanded > MAX_TOTAL_BYTES:
                    error("too_large", name, "Upload exceeds the expanded size limit")
                    continue
                names: set[str] = set()
                valid = True
                for info in infos:
                    entry = info.filename
                    label = f"{name}/{entry}"
                    path = PurePosixPath(entry)
                    if (
                        path.is_absolute()
                        or ".." in path.parts
                        or "\\" in entry
                        or re.match(r"^[A-Za-z]:", entry)
                    ):
                        error("unsafe_path", label, "Path escapes the archive")
                        valid = False
                    if entry in names:
                        error("duplicate_entry", label, "ZIP holds this name twice")
                        valid = False
                    names.add(entry)
                if valid:
                    for info in infos:
                        text(
                            f"{name}/{info.filename}", info.filename, archive.read(info)
                        )
        except (
            zipfile.BadZipFile,
            zlib.error,
            lzma.LZMAError,
            EOFError,
            RuntimeError,
            NotImplementedError,
        ) as exc:
            error("invalid_archive", name, f"Cannot decode ZIP archive: {exc}")
    return units, issues
