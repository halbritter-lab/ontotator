"""Upload handling for ontology files and work package archives.

Uploads are copied in bounded chunks so an oversized body is rejected while it
is being read instead of after it has been loaded into memory. These services
are synchronous; FastAPI runs the calling (plain ``def``) endpoints in its
thread pool, so parsing never blocks the event loop.
"""

from __future__ import annotations

import hashlib
import os
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
from ontocurator.packages.models import PackageManifest, ValidatedPackage
from ontocurator.packages.reader import MAX_COMPRESSED_BYTES, PackageReader
from ontocurator.storage.repository import Repository
from ontocurator.vendor.hpo_span_annotator.hpo import OntologyError

MAX_ONTOLOGY_UPLOAD_BYTES = 512 * 1024 * 1024  # 512 MiB
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

            service = self._loaded_service(digest)
            if service is None:
                try:
                    service = OntologyService.load(
                        tmp_path, OntologyRef(release="uploaded", sha256=digest)
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
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

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
        services = self.registry.prepare_package(
            pkg.manifest.task_profile, pkg.embedded_files
        )
        self.repo.import_package(pkg)
        for service in services:
            self.registry.register_service(service)
        return pkg.manifest
