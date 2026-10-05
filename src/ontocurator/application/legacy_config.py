"""Settings left behind by an earlier (per-user) Ontocurator installation.

A portable copy keeps its settings in its own folder. An older installation may
have left a settings file in the per-user config folder (e.g.
``%APPDATA%\\ontocurator\\config.json``). Its content is NEVER imported
automatically: the dashboard shows a notice and the person decides to import
it, ignore it (remembered per file content, see ``LegacyConfigDecision``),
open its folder or delete it.

A preconfigured bundle (one with ``ontocurator-settings.json``) ignores the old
file entirely. The workspace of the old installation is never taken over.
"""

from __future__ import annotations

import contextlib
import hashlib
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from ontocurator.application.preferences import PreferencesStore
from ontocurator.application.provisioning import store_ontology_copy
from ontocurator.config_store import (
    PersistentConfig,
    load_persistent_config,
    same_path,
    save_persistent_config,
)
from ontocurator.domain.errors import DomainError
from ontocurator.ontology.registry import OntologyRegistry


class LegacyConfigNotFound(DomainError):
    """No settings file of an earlier installation is available (404)."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__(
            "LEGACY_CONFIG_NOT_FOUND",
            details or "No settings from an earlier installation were found.",
        )


class LegacyConfigInUse(DomainError):
    """The 'old' settings file is the one this installation uses (409)."""

    def __init__(self, details: str | dict[str, Any] | None = None) -> None:
        super().__init__(
            "LEGACY_CONFIG_IN_USE",
            details
            or "This settings file is the one Ontocurator currently uses; it is "
            "not deleted.",
        )


class LegacyOntology(BaseModel):
    """An ontology file named in the old settings."""

    path: str
    # found: can be imported; missing: file not found, will be skipped;
    # in_use: the same file content is already available here.
    status: Literal["found", "missing", "in_use"]


class LegacyConfigStatus(BaseModel):
    """``GET /api/v1/legacy-config``: whether to show the notice, and details."""

    found: bool = False
    path: str | None = None
    folder: str | None = None
    ontologies: list[LegacyOntology] = Field(default_factory=list)
    # Only values that differ from the current settings (None: nothing to change).
    port: int | None = None
    auto_open_browser: bool | None = None


class SkippedOntology(BaseModel):
    path: str
    reason: str


class LegacyImportResult(BaseModel):
    """What ``POST /api/v1/legacy-config/import`` took over."""

    imported_ontologies: list[str] = Field(default_factory=list)
    skipped_ontologies: list[SkippedOntology] = Field(default_factory=list)
    port: int | None = None
    auto_open_browser: bool | None = None
    # Port and auto-open take effect at the next start.
    restart_required: bool = False


class LegacyConfigDeleted(BaseModel):
    deleted: str


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


# (path, size, mtime_ns) -> sha256; ontology files are large, hash them once.
_DIGESTS: dict[tuple[str, int, int], str] = {}


def _cached_sha256(path: Path) -> str | None:
    try:
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
        if key not in _DIGESTS:
            _DIGESTS[key] = _sha256(path)
        return _DIGESTS[key]
    except OSError:
        return None


def delete_legacy_config(legacy_path: Path, active_config_path: Path) -> Path:
    """Delete only the old settings file (and its folder if that is then empty).

    Refuses the settings file this installation uses. Workspaces, annotations
    and ontology files are never touched.
    """
    if same_path(legacy_path, active_config_path):
        raise LegacyConfigInUse()
    if not legacy_path.is_file():
        raise LegacyConfigNotFound()
    legacy_path.unlink()
    folder = legacy_path.parent
    with contextlib.suppress(OSError):
        if not any(folder.iterdir()):
            folder.rmdir()
    return legacy_path


class LegacyConfigService:
    """Detect, import, dismiss and delete an earlier installation's settings."""

    def __init__(
        self,
        *,
        legacy_path: Path | None,
        active_config_path: Path | None,
        preconfigured: bool,
        workspace_dir: Path,
        preferences: PreferencesStore,
        registry: OntologyRegistry | None = None,
    ) -> None:
        self.legacy_path = legacy_path
        self.active_config_path = active_config_path
        self.preconfigured = preconfigured
        self.workspace_dir = workspace_dir
        self.preferences = preferences
        self.registry = registry

    # ---- detection -------------------------------------------------------- #

    def _candidate(self) -> tuple[Path, Path]:
        """(legacy file, active config file) or raise."""
        legacy, active = self.legacy_path, self.active_config_path
        if self.preconfigured or legacy is None or active is None:
            raise LegacyConfigNotFound()
        if same_path(legacy, active):
            raise LegacyConfigInUse()
        if not legacy.is_file():
            raise LegacyConfigNotFound()
        return legacy, active

    def _in_use(self, path: Path, current: PersistentConfig) -> bool:
        resolved = path.resolve()
        if any(same_path(resolved, p) for p in current.ontology_paths):
            return True
        if self.registry is None:
            return False
        digest = _cached_sha256(path)
        return digest is not None and self.registry.has_ontology(digest)

    def _details(self, legacy: Path, active: Path) -> LegacyConfigStatus:
        old = load_persistent_config(legacy)
        current = load_persistent_config(active)
        ontologies = []
        for path in old.ontology_paths:
            if not path.is_file():
                status: Literal["found", "missing", "in_use"] = "missing"
            elif self._in_use(path, current):
                status = "in_use"
            else:
                status = "found"
            ontologies.append(LegacyOntology(path=str(path), status=status))
        port = (
            old.port
            if "port" in old.model_fields_set and old.port != current.port
            else None
        )
        auto_open = (
            old.auto_open_browser
            if "auto_open_browser" in old.model_fields_set
            and old.auto_open_browser != current.auto_open_browser
            else None
        )
        differs = (
            any(o.status == "found" for o in ontologies)
            or port is not None
            or auto_open is not None
        )
        return LegacyConfigStatus(
            found=differs,
            path=str(legacy),
            folder=str(legacy.parent),
            ontologies=ontologies,
            port=port,
            auto_open_browser=auto_open,
        )

    def status(self) -> LegacyConfigStatus:
        try:
            legacy, active = self._candidate()
        except (LegacyConfigNotFound, LegacyConfigInUse):
            return LegacyConfigStatus()
        decision = self.preferences.legacy_decision()
        if decision is not None and decision.sha256 == _sha256(legacy):
            return LegacyConfigStatus()
        details = self._details(legacy, active)
        return details if details.found else LegacyConfigStatus()

    # ---- actions ------------------------------------------------------------ #

    def dismiss(self) -> LegacyConfigStatus:
        legacy, _ = self._candidate()
        self.preferences.record_legacy_config(_sha256(legacy), "dismissed")
        return self.status()

    def import_settings(self) -> LegacyImportResult:
        """Copy the old ontology files into the workspace and take over port and
        auto-open (effective at the next start). The workspace is not taken over."""
        legacy, active = self._candidate()
        legacy_sha = _sha256(legacy)
        details = self._details(legacy, active)
        current = load_persistent_config(active)
        result = LegacyImportResult()
        ontologies_dir = self.workspace_dir / "ontologies"

        for item in details.ontologies:
            src = Path(item.path)
            if item.status == "missing":
                result.skipped_ontologies.append(
                    SkippedOntology(path=item.path, reason="file not found")
                )
                continue
            if item.status == "in_use":
                continue
            try:
                dest, digest = store_ontology_copy(src, ontologies_dir)
            except (OSError, ValueError) as exc:
                result.skipped_ontologies.append(
                    SkippedOntology(path=item.path, reason=str(exc))
                )
                continue
            if self.registry is not None:
                self.registry.register_path(dest)
                self.registry.load_registered()
                if any(f.sha256 == digest for f in self.registry.failures()):
                    result.skipped_ontologies.append(
                        SkippedOntology(
                            path=item.path,
                            reason="could not be read as an ontology",
                        )
                    )
                    continue
            resolved = dest.resolve()
            if not any(same_path(resolved, p) for p in current.ontology_paths):
                current.ontology_paths.append(resolved)
            result.imported_ontologies.append(str(resolved))

        if details.port is not None:
            current.port = details.port
            result.port = details.port
            result.restart_required = True
        if details.auto_open_browser is not None:
            current.auto_open_browser = details.auto_open_browser
            result.auto_open_browser = details.auto_open_browser
            result.restart_required = True

        save_persistent_config(current, active)
        self.preferences.record_legacy_config(legacy_sha, "imported")
        return result

    def folder(self) -> Path:
        legacy, _ = self._candidate()
        return legacy.parent

    def delete(self) -> LegacyConfigDeleted:
        legacy, active = self.legacy_path, self.active_config_path
        if self.preconfigured or legacy is None or active is None:
            raise LegacyConfigNotFound()
        return LegacyConfigDeleted(deleted=str(delete_legacy_config(legacy, active)))
