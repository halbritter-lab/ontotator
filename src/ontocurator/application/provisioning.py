"""Start-up provisioning of a preconfigured distribution.

A distribution folder may contain ``ontologies/*.json`` and ``packages/*.zip``
next to the executable. On every start, before the server accepts requests:

1. every ontology file is copied content-addressed into
   ``<workspace>/ontologies`` and remembered in the settings file, and
2. every work package is imported (identical, already imported packages are
   skipped silently).

Imported packages are immutable and pinned by hash, so files in these folders
only ever *add* data. A package whose ``package_id`` is already imported with
different content is NOT imported; a warning is printed and shown in the web
UI. An ontology file whose name was provisioned before but whose content
changed is registered as an additional version (packages keep the version
they pin). ``<workspace>/provisioning.json`` records which source file was
provisioned with which SHA-256 to detect such changes.

Invalid files are reported and skipped; they never block a start.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import secrets
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from ontocurator.application.uploads import PackageImportService
from ontocurator.ontology.discovery import is_probable_obo_graph
from ontocurator.ontology.naming import content_addressed_name
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.packages.reader import PackageReader
from ontocurator.storage.repository import Repository

PROVISIONING_FILENAME = "provisioning.json"
ONTOLOGIES_DIRNAME = "ontologies"
PACKAGES_DIRNAME = "packages"

# (message, is_warning) -> printed on the console by the caller.
Reporter = Callable[[str, bool], None]


class ProvisioningNotice(BaseModel):
    """Something the people using this copy should know about the delivery."""

    level: Literal["warning", "info"]
    code: Literal["PACKAGE_CHANGED", "PACKAGE_INVALID", "ONTOLOGY_NEW_VERSION"]
    message: str
    file: str | None = None


class ProvisioningStatus(BaseModel):
    """Result of this start's provisioning (``GET /api/v1/provisioning``)."""

    notices: list[ProvisioningNotice] = Field(default_factory=list)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def store_ontology_copy(source: Path, ontologies_dir: Path) -> tuple[Path, str]:
    """Copy a validated OBO Graph JSON into the workspace (idempotent).

    Returns the stored path and the file's SHA-256.
    """
    if not is_probable_obo_graph(source):
        raise ValueError("not an OBO Graph JSON ontology file")
    digest = _sha256(source)
    ontologies_dir.mkdir(parents=True, exist_ok=True)
    # Same (sanitised) scheme as the upload endpoint.
    dest = ontologies_dir / content_addressed_name(source, digest)
    if dest.resolve() == source.resolve():
        return dest, digest
    if not dest.is_file():
        tmp = dest.with_name(f".{dest.name}.{secrets.token_hex(4)}.tmp")
        shutil.copyfile(source, tmp)
        tmp.replace(dest)
    return dest, digest


class ProvisioningLedger:
    """``<workspace>/provisioning.json``: source file name -> provisioned SHA-256."""

    def __init__(self, workspace: Path) -> None:
        self.path = workspace / PROVISIONING_FILENAME
        self.ontologies: dict[str, dict[str, str]] = {}
        self.packages: dict[str, dict[str, str]] = {}
        data: Any = None
        with contextlib.suppress(OSError, ValueError):
            data = json.loads(self.path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            self.ontologies = self._section(data.get("ontologies"))
            self.packages = self._section(data.get("packages"))

    @staticmethod
    def _section(value: Any) -> dict[str, dict[str, str]]:
        if not isinstance(value, dict):
            return {}
        return {
            str(name): {str(k): str(v) for k, v in entry.items()}
            for name, entry in value.items()
            if isinstance(entry, dict) and isinstance(entry.get("sha256"), str)
        }

    def save(self) -> None:
        data = {
            "format": "ontocurator-provisioning/v1",
            "ontologies": self.ontologies,
            "packages": self.packages,
        }
        tmp = self.path.with_name(f".{self.path.name}.{secrets.token_hex(4)}.tmp")
        try:
            tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            os.replace(tmp, self.path)
        finally:
            if tmp.exists():
                tmp.unlink()


def _files(folder: Path, suffix: str) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(
        (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == suffix),
        key=lambda p: p.name.lower(),
    )


def provision_ontologies(
    source_dir: Path,
    ontologies_dir: Path,
    ledger: ProvisioningLedger,
    status: ProvisioningStatus,
    report: Reporter,
) -> list[Path]:
    """Copy ``<source_dir>/ontologies/*.json`` into the workspace.

    Returns the stored workspace paths (to be registered and remembered).
    """
    folder = source_dir / ONTOLOGIES_DIRNAME
    stored: list[Path] = []
    for src in _files(folder, ".json"):
        try:
            dest, digest = store_ontology_copy(src, ontologies_dir)
        except Exception as exc:
            report(
                f"Warning: Skipping ontology file {src.name} in {folder}: {exc}.",
                True,
            )
            continue
        previous = ledger.ontologies.get(src.name)
        if previous is None:
            report(f"Registered ontology {src.name} from {folder}.", False)
        elif previous.get("sha256") != digest:
            message = (
                f"A new version of {src.name} was registered; existing packages "
                "keep using the version they were created with."
            )
            status.notices.append(
                ProvisioningNotice(
                    level="info",
                    code="ONTOLOGY_NEW_VERSION",
                    message=message,
                    file=src.name,
                )
            )
            report(f"Notice: {message}", False)
        ledger.ontologies[src.name] = {"sha256": digest, "stored_as": dest.name}
        stored.append(dest)
    return stored


def provision_packages(
    source_dir: Path,
    repo: Repository,
    registry: OntologyRegistry,
    ledger: ProvisioningLedger,
    status: ProvisioningStatus,
    report: Reporter,
) -> list[str]:
    """Import ``<source_dir>/packages/*.zip``; returns newly imported package IDs."""
    folder = source_dir / PACKAGES_DIRNAME
    importer = PackageImportService(repo, registry)
    imported: list[str] = []

    def invalid(src: Path, exc: Exception) -> None:
        message = (
            f"The work package file {src.name} in the packages folder could not "
            f"be imported: {exc}"
        )
        status.notices.append(
            ProvisioningNotice(
                level="warning", code="PACKAGE_INVALID", message=message, file=src.name
            )
        )
        report(f"Warning: {message}", True)

    for src in _files(folder, ".zip"):
        try:
            data = src.read_bytes()
        except OSError as exc:
            invalid(src, exc)
            continue
        digest = hashlib.sha256(data).hexdigest()
        previous = ledger.packages.get(src.name)
        if (
            previous is not None
            and previous.get("sha256") == digest
            and repo.manifest_hash(previous.get("package_id", "")) is not None
        ):
            continue  # unchanged file, already imported

        try:
            pkg = PackageReader.read_from_stream(io.BytesIO(data), registry=registry)
        except Exception as exc:
            invalid(src, exc)
            continue
        package_id = pkg.manifest.package_id
        existing = repo.manifest_hash(package_id)
        if existing is not None:
            if existing != repo.package_manifest_hash(pkg):
                message = (
                    f"Package '{package_id}' in the packages folder ({src.name}) "
                    "differs from the already imported version. The changed "
                    "version was NOT imported. To ship changed content, use a new "
                    "package ID."
                )
                status.notices.append(
                    ProvisioningNotice(
                        level="warning",
                        code="PACKAGE_CHANGED",
                        message=message,
                        file=src.name,
                    )
                )
                report(f"Warning: {message}", True)
                continue
        else:
            try:
                importer.import_package(pkg)
            except Exception as exc:
                invalid(src, exc)
                continue
            imported.append(package_id)
            report(f"Imported work package '{package_id}' from {src.name}.", False)
        ledger.packages[src.name] = {"sha256": digest, "package_id": package_id}
    return imported
