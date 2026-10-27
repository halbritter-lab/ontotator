"""The retired v2 package upload service, kept for the round-trip tests."""

from __future__ import annotations

import tempfile
from typing import BinaryIO, cast

from ontotator.application.uploads import copy_limited
from ontotator.ontology.registry import OntologyRegistry
from ontotator.packages.models import PackageManifest, ValidatedPackage
from ontotator.storage.repository import Repository
from support.v2_reader import MAX_COMPRESSED_BYTES, PackageReader

MAX_PACKAGE_UPLOAD_BYTES = MAX_COMPRESSED_BYTES
_SPOOL_IN_MEMORY_BYTES = 8 * 1024 * 1024


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
                pkg.manifest.task_profile,
                pkg.embedded_files,
                pkg.manifest.search_conditions,
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
