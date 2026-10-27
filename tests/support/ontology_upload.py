"""The retired ontology upload service (T2d), kept for a registry concurrency test.

The product stores ontologies through ``OntologyStore``; this service wrote
them to a folder and registered them under the same registry lock.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from ontotator.application.uploads import MAX_ONTOLOGY_UPLOAD_BYTES, copy_limited
from ontotator.domain.documents import OntologyRef
from ontotator.domain.errors import DomainError
from ontotator.ontology.naming import content_addressed_name
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.service import OntologyService
from ontotator.vendor.hpo_span_annotator.hpo import OntologyError

_CHUNK_BYTES = 1024 * 1024


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
