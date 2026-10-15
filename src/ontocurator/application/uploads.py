"""Upload handling for translation files.

Uploads are copied in bounded chunks so an oversized body is rejected while it
is being read instead of after it has been loaded into memory. These services
are synchronous; FastAPI runs the calling (plain ``def``) endpoints in its
thread pool, so parsing never blocks the event loop.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from ontocurator.domain.errors import DomainError, PayloadTooLarge
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.ontology.translations import babelon_problem, parse_translation_name

MAX_ONTOLOGY_UPLOAD_BYTES = 512 * 1024 * 1024  # 512 MiB
MAX_TRANSLATION_UPLOAD_BYTES = 64 * 1024 * 1024  # 64 MiB
_CHUNK_BYTES = 1024 * 1024
_SPOOL_IN_MEMORY_BYTES = 8 * 1024 * 1024


def copy_limited(source: BinaryIO, target: BinaryIO, limit: int, what: str) -> str:
    """Copy ``source`` to ``target`` in chunks; return the SHA-256 hex digest.

    Raises PayloadTooLarge as soon as more than ``limit`` bytes were read.
    """
    digest = hashlib.sha256()
    total = 0
    while chunk := source.read(_CHUNK_BYTES):
        total += len(chunk)
        if total > limit:
            raise PayloadTooLarge(f"{what} exceeds the size limit of {limit} bytes")
        digest.update(chunk)
        target.write(chunk)
    return digest.hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class StoredTranslation:
    """Result of a translation upload."""

    path: Path
    prefix: str
    # The language in the file name.
    language: str
    # SHA-256 of the ontology -> its service, rebuilt with the new file. Empty
    # when no loaded ontology has the file's prefix.
    services: dict[str, OntologyService]
    # The languages the names of the file were loaded as, sorted. They come
    # from the file's ``translation_language`` column and need not be the one
    # in its name. Empty when no ontology was rebuilt.
    languages: tuple[str, ...] = ()


class TranslationUploadService:
    """Stores an uploaded babelon TSV and rebuilds the ontologies it belongs to.

    Unlike an ontology, a translation file is stored under its own name and a
    file of the same name is replaced: packages pin ontologies, not
    translations. The file only reaches its place after the ontologies were
    rebuilt with it, so a file that cannot be used changes nothing.
    """

    def __init__(self, registry: OntologyRegistry, directory: Path) -> None:
        self.registry = registry
        self.directory = directory

    def store(self, source: BinaryIO, filename: str | None) -> StoredTranslation:
        name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
        parsed = parse_translation_name(name)
        if parsed is None:
            raise DomainError(
                "INVALID_TRANSLATION",
                f"'{name}' is not a translation file name. Expected "
                "<prefix>-<language>.<kind>.tsv, e.g. hp-de.babelon.tsv.",
            )
        prefix, language = parsed

        self.directory.mkdir(parents=True, exist_ok=True)
        # Staged under its real name: the loader reads the language from it.
        staging = self.directory / f".upload-{uuid4().hex}"
        staging.mkdir()
        staged = staging / name
        try:
            with staged.open("wb") as handle:
                copy_limited(
                    source, handle, MAX_TRANSLATION_UPLOAD_BYTES, "Translation upload"
                )
            problem = babelon_problem(staged)
            if problem is not None:
                raise DomainError("INVALID_TRANSLATION", problem)

            # One change from here to the swap: the files in the folder are
            # read, the ontologies rebuilt, the file moved into place and the
            # new services published before any other change starts. Searches
            # do not wait for this; the old services answer them meanwhile.
            with self.registry.changing():
                rebuilt = self._rebuild_and_place(prefix, name, staged)
            return StoredTranslation(
                path=self.directory / name,
                prefix=prefix,
                language=language,
                services=rebuilt,
                languages=tuple(
                    sorted(
                        {
                            code
                            for service in rebuilt.values()
                            for item in service.translations
                            if item.filename == name
                            for code in item.languages
                        }
                    )
                ),
            )
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def _rebuild_and_place(
        self, prefix: str, name: str, staged: Path
    ) -> dict[str, OntologyService]:
        self.registry.load_registered()
        others = [
            path
            for path in self.registry.translation_files()
            if path.name.lower() != name
        ]
        try:
            rebuilt = self.registry.rebuild_for_prefix(prefix, [*others, staged])
        except Exception as exc:
            raise DomainError(
                "TRANSLATION_RELOAD_FAILED",
                f"The ontology could not be reloaded with '{name}': {exc}. "
                "The file was not stored; the search is unchanged.",
            ) from exc
        if rebuilt and not any(
            item.filename == name
            for service in rebuilt.values()
            for item in service.translations
        ):
            reasons = [
                item.reason
                for service in rebuilt.values()
                for item in service.skipped_translations
                if item.filename == name
            ]
            raise DomainError(
                "INVALID_TRANSLATION",
                reasons[0] if reasons else f"'{name}' holds no usable name.",
            )

        try:
            os.replace(staged, self.directory / name)
        except OSError as exc:
            # E.g. the old file is open in another program (Windows).
            raise DomainError(
                "TRANSLATION_STORE_FAILED",
                f"'{name}' could not be replaced: {exc}. "
                "The file was not stored; the search is unchanged.",
            ) from exc
        self.registry.publish(rebuilt)
        return rebuilt
