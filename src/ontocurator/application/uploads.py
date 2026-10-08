"""Upload handling for ontology files and work package archives.

Uploads are copied in bounded chunks so an oversized body is rejected while it
is being read instead of after it has been loaded into memory. These services
are synchronous; FastAPI runs the calling (plain ``def``) endpoints in its
thread pool, so parsing never blocks the event loop.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, cast
from uuid import uuid4

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import DomainError, PayloadTooLarge
from ontocurator.ontology.naming import content_addressed_name
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.service import OntologyService
from ontocurator.ontology.translations import babelon_problem, parse_translation_name
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.packages.reader import MAX_COMPRESSED_BYTES, PackageReader
from ontocurator.storage.repository import Repository
from ontocurator.vendor.hpo_span_annotator.hpo import OntologyError

MAX_ONTOLOGY_UPLOAD_BYTES = 512 * 1024 * 1024  # 512 MiB
MAX_TRANSLATION_UPLOAD_BYTES = 64 * 1024 * 1024  # 64 MiB
MAX_PACKAGE_UPLOAD_BYTES = MAX_COMPRESSED_BYTES
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
class StoredOntology:
    """Result of an ontology upload."""

    service: OntologyService
    path: Path
    sha256: str


class OntologyUploadService:
    """Stores uploaded ontologies immutably under content-addressed names.

    Different releases routinely share a file name (every HPO release is
    ``hp.json``). Packages pin ontologies by SHA-256, so an upload never
    replaces an existing file: it is stored as ``<stem>-<sha256[:12]>.json``,
    and uploading identical bytes again is idempotent.
    """

    def __init__(self, registry: OntologyRegistry, directory: Path) -> None:
        self.registry = registry
        self.directory = directory

    def store(self, source: BinaryIO, filename: str | None) -> StoredOntology:
        self.directory.mkdir(parents=True, exist_ok=True)
        tmp_path = self.directory / f".upload-{uuid4().hex}.tmp"
        try:
            with tmp_path.open("wb") as handle:
                digest = copy_limited(
                    source, handle, MAX_ONTOLOGY_UPLOAD_BYTES, "Ontology upload"
                )

            # One change: the translation files are read, the ontology is
            # built with them and registered before any other change starts.
            with self.registry.changing():
                return self._register(tmp_path, filename, digest)
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

    def _register(
        self, tmp_path: Path, filename: str | None, digest: str
    ) -> StoredOntology:
        service = self._loaded_service(digest)
        if service is None:
            try:
                service = OntologyService.load(
                    tmp_path,
                    OntologyRef(release="uploaded", sha256=digest),
                    translation_paths=self.registry.translation_files(),
                )
            except DomainError:
                raise
            except (OntologyError, ValueError, KeyError, TypeError) as exc:
                raise DomainError("INVALID_ONTOLOGY", str(exc)) from exc

        dest_path = self._existing_copy(digest)
        if dest_path is None:
            dest_path = self.directory / content_addressed_name(filename, digest)
            if dest_path.exists():
                if _file_sha256(dest_path) != digest:
                    raise DomainError(
                        "ONTOLOGY_PATH_CONFLICT",
                        f"'{dest_path.name}' already exists with different content",
                    )
            else:
                os.replace(tmp_path, dest_path)

        self.registry.register_path(dest_path)
        self.registry.register_service(service)
        return StoredOntology(service=service, path=dest_path, sha256=digest)

    def _loaded_service(self, digest: str) -> OntologyService | None:
        try:
            return self.registry.get_service(digest)
        except (DomainError, OntologyError, OSError, ValueError, KeyError):
            # The previously registered file is unusable; parse the upload.
            return None

    def _existing_copy(self, digest: str) -> Path | None:
        """Reuse a stored file of this digest inside the upload directory."""
        registered = self.registry.registered_path(digest)
        if (
            registered is not None
            and registered.is_file()
            and registered.resolve().parent == self.directory.resolve()
            and _file_sha256(registered) == digest
        ):
            return registered
        return None

    @staticmethod
    def persist(path: Path) -> None:
        """Remember the stored file so it is registered again after restart."""
        from ontocurator.config_store import (
            load_persistent_config,
            save_persistent_config,
        )

        config = load_persistent_config()
        resolved = path.resolve()
        if resolved not in [p.resolve() for p in config.ontology_paths]:
            config.ontology_paths.append(resolved)
            save_persistent_config(config)


@dataclass(frozen=True)
class StoredTranslation:
    """Result of a translation upload."""

    path: Path
    prefix: str
    language: str
    # SHA-256 of the ontology -> its service, rebuilt with the new file. Empty
    # when no loaded ontology has the file's prefix.
    services: dict[str, OntologyService]


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

        os.replace(staged, self.directory / name)
        self.registry.publish(rebuilt)
        return rebuilt


class PackageImportService:
    """Validates and atomically imports an uploaded work package archive."""

    def __init__(self, repo: Repository, registry: OntologyRegistry) -> None:
        self.repo = repo
        self.registry = registry

    def import_upload(self, source: BinaryIO) -> PackageManifest:
        with tempfile.SpooledTemporaryFile(max_size=_SPOOL_IN_MEMORY_BYTES) as spool:
            stream = cast(BinaryIO, spool)
            copy_limited(source, stream, MAX_PACKAGE_UPLOAD_BYTES, "Package upload")
            stream.seek(0)
            pkg = PackageReader.read_from_stream(stream, registry=self.registry)
        return self.import_package(pkg)

    def import_package(self, pkg: ValidatedPackage) -> PackageManifest:
        """Import an already validated package (ontologies are parsed first)."""
        assert pkg.manifest.task_profile is not None
        with self.registry.changing():
            generation = self.registry.translation_generation
            services = self.registry.prepare_package(
                pkg.manifest.task_profile, pkg.embedded_files
            )
        # The database write is not part of the registry change: an edit that
        # holds the database and waits for an ontology to load must not meet an
        # import that holds the registry and waits for the database.
        self.repo.import_package(pkg)
        with self.registry.changing():
            if self.registry.translation_generation != generation:
                # A translation file arrived meanwhile. What was prepared was
                # built without it and would replace services that have it.
                files = self.registry.translation_files()
                services = [service.with_translations(files) for service in services]
            for service in services:
                self.registry.register_service(service)
        return pkg.manifest
