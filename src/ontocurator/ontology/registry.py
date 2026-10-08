from __future__ import annotations

import copy
import hashlib
import logging
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import (
    OntologyDefinition,
    TaskProfile,
    resolve_layer,
    resolve_ontology,
)
from ontocurator.ontology.service import OntologyService
from ontocurator.ontology.translations import (
    discover_translation_files,
    parse_translation_name,
)
from ontocurator.vendor.hpo_span_annotator.hpo import OntologyError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OntologyLoadFailure:
    """A registered ontology file that could not be parsed."""

    sha256: str
    path: Path
    error: str


class OntologyRegistry:
    """Manages and caches loaded ontology services bound to TaskProfiles and SHA-256 digests.

    Request handlers run in a thread pool, so every access to the shared maps
    goes through one re-entrant lock. Parsing an ontology can take seconds, so
    it happens outside that lock under a per-digest load lock: other requests
    keep being served while a file loads, and two threads never parse the same
    digest twice (double-checked insert).
    """

    def __init__(
        self,
        base_dir: Path | str | None = None,
        translation_dirs: Iterable[Path | str] = (),
    ) -> None:
        self._services: dict[str, OntologyService] = {}
        self._registered_paths: dict[str, Path] = {}
        self._failures: dict[str, OntologyLoadFailure] = {}
        self._lock = threading.RLock()
        self._load_locks: dict[str, threading.Lock] = {}
        # Relative ``resource_path`` entries resolve against this directory
        # (the workspace), never against the process working directory.
        self.base_dir = Path(base_dir).resolve() if base_dir is not None else None
        # The folders ontologies are looked for in. Translation files
        # (hp-de.babelon.tsv) lie next to the ontologies there.
        self.translation_dirs = [Path(d) for d in translation_dirs]

    def translation_files(self) -> list[Path]:
        """Every translation file in the ontology folders, as of now."""
        return discover_translation_files(self.translation_dirs)

    def services_for_prefix(self, prefix: str) -> list[tuple[str, OntologyService]]:
        """Loaded ontologies whose dominant id prefix is ``prefix`` (lower case)."""
        return [
            (sha, service)
            for sha, service in self.services()
            if (service.ontology.dominant_prefix or "").lower() == prefix
        ]

    def unassigned_translations(self) -> list[Path]:
        """Translation files whose prefix matches no loaded ontology."""
        loaded = {
            (service.ontology.dominant_prefix or "").lower()
            for _, service in self.services()
        }
        unassigned = []
        for path in self.translation_files():
            parsed = parse_translation_name(path.name)
            if parsed is not None and parsed[0] not in loaded:
                unassigned.append(path)
        return unassigned

    def rebuild_for_prefix(
        self, prefix: str, translation_paths: Iterable[Path]
    ) -> dict[str, OntologyService]:
        """New services for the ontologies of a prefix; nothing is published.

        The caller looks at the result and hands it to :meth:`publish`. Until
        then, and if this raises, the current services keep answering.
        """
        paths = list(translation_paths)
        return {
            sha: service.with_translations(paths)
            for sha, service in self.services_for_prefix(prefix)
        }

    def publish(self, services: dict[str, OntologyService]) -> None:
        """Swap in rebuilt services, all at once."""
        with self._lock:
            self._services.update(services)

    def register(self, path: Path | str, expected: OntologyDefinition) -> None:
        """Register and validate an ontology artifact against an expected OntologyDefinition."""
        p = Path(path)
        if not p.is_file():
            raise DomainError(
                "ONTOLOGY_NOT_FOUND",
                f"Ontology file not found at: {p}",
            )

        raw = p.read_bytes()
        digest = hashlib.sha256(raw).hexdigest().lower()
        expected_sha = expected.sha256.lower()
        if digest != expected_sha:
            raise DomainError(
                "ONTOLOGY_HASH_MISMATCH",
                f"Ontology hash mismatch for '{p}': expected {expected.sha256}, got {digest}",
            )

        if expected.format != "obo-graph-json":
            raise DomainError(
                "UNSUPPORTED_ONTOLOGY_FORMAT",
                f"Unsupported ontology format '{expected.format}'. Only 'obo-graph-json' is supported.",
            )

        with self._lock:
            self._registered_paths[expected_sha] = p
        self._load_once(
            expected_sha,
            p,
            OntologyRef(release=expected.release, sha256=expected.sha256),
        )

    def _load_once(self, sha: str, path: Path, ref: OntologyRef) -> OntologyService:
        """Return the cached service for ``sha`` or parse ``path`` exactly once.

        The shared lock is only held for map access, never while parsing.
        """
        with self._lock:
            cached = self._services.get(sha)
            if cached is not None:
                return cached
            load_lock = self._load_locks.setdefault(sha, threading.Lock())
        with load_lock:
            with self._lock:
                cached = self._services.get(sha)
            if cached is not None:
                return cached
            service = OntologyService.load(
                path, ref, translation_paths=self.translation_files()
            )
            with self._lock:
                service = self._services.setdefault(sha, service)
                self._failures.pop(sha, None)
                self._load_locks.pop(sha, None)
            return service

    def register_service(self, service: OntologyService) -> None:
        """Register an already-instantiated OntologyService."""
        sha = service.ref.sha256.lower()
        with self._lock:
            self._services[sha] = service
            self._failures.pop(sha, None)

    @staticmethod
    def load_resource(
        data: bytes,
        expected: OntologyDefinition,
        translation_paths: Iterable[Path] = (),
    ) -> OntologyService:
        """Validate and parse archive bytes without retaining a temporary path."""
        with TemporaryDirectory(prefix="ontocurator-ontology-") as directory:
            path = Path(directory) / "ontology.json"
            path.write_bytes(data)
            try:
                return OntologyService.load(
                    path,
                    OntologyRef(release=expected.release, sha256=expected.sha256),
                    translation_paths=translation_paths,
                )
            except DomainError:
                raise
            except (ValueError, KeyError, TypeError, OntologyError) as exc:
                raise DomainError("INVALID_ONTOLOGY", str(exc)) from exc

    def prepare_package(
        self, profile: TaskProfile, resources: dict[str, bytes]
    ) -> list[OntologyService]:
        """Parse all resources before package commit; publish services only afterward."""
        prepared = []
        for ont in profile.ontologies:
            if ont.resource_path and ont.resource_path in resources:
                prepared.append(
                    self.load_resource(
                        resources[ont.resource_path], ont, self.translation_files()
                    )
                )
            else:
                service = self.get_service(ont.sha256)
                if service is None:
                    raise DomainError(
                        "ONTOLOGY_NOT_FOUND", f"Missing ontology '{ont.ontology_id}'"
                    )
                prepared.append(service)
        return prepared

    def register_path(self, path: Path | str) -> str:
        """Inspect and register a local ontology file without prior expected metadata, returning its SHA-256."""
        p = Path(path)
        if not p.is_file():
            raise DomainError("ONTOLOGY_NOT_FOUND", f"Ontology file not found at: {p}")
        digest = hashlib.sha256(p.read_bytes()).hexdigest().lower()
        with self._lock:
            self._registered_paths[digest] = p
        return digest

    def registered_path(self, sha256: str) -> Path | None:
        """Return the file registered for a digest, if any."""
        with self._lock:
            return self._registered_paths.get(sha256.lower())

    def load_registered(self) -> list[OntologyLoadFailure]:
        """Eagerly parse every registered file; record and log failures."""
        with self._lock:
            pending = [
                (sha, path)
                for sha, path in self._registered_paths.items()
                # A failed digest stays failed: fixed content has a new digest.
                if sha not in self._services and sha not in self._failures
            ]
        for sha, path in pending:
            try:
                self.get_service(sha)
            except (DomainError, OntologyError, OSError, ValueError, KeyError) as exc:
                failure = OntologyLoadFailure(sha256=sha, path=path, error=str(exc))
                with self._lock:
                    self._failures[sha] = failure
                logger.warning(
                    "Could not load ontology %s (sha256 %s): %s", path, sha, exc
                )
        return self.failures()

    def failures(self) -> list[OntologyLoadFailure]:
        """Registered ontologies that failed to load, in registration order."""
        with self._lock:
            return list(self._failures.values())

    def services(self) -> list[tuple[str, OntologyService]]:
        """Snapshot of loaded services keyed by SHA-256."""
        with self._lock:
            return list(self._services.items())

    @staticmethod
    def _bind_release(
        svc: OntologyService, ont_def: OntologyDefinition
    ) -> OntologyService:
        """Return a view carrying the pinned release label without mutating the
        shared cached service, which other profiles may pin differently."""
        if svc.ref.release in ("unknown", "pinned") and ont_def.release:
            bound = copy.copy(svc)
            bound.ref = OntologyRef(release=ont_def.release, sha256=ont_def.sha256)
            return bound
        return svc

    def _resource_file(self, resource_path: str) -> Path | None:
        """Resolve a profile resource path inside the workspace directory."""
        candidate = Path(resource_path)
        if candidate.is_absolute():
            return candidate if candidate.is_file() else None
        if self.base_dir is None:
            return None
        resolved = (self.base_dir / candidate).resolve()
        if not resolved.is_relative_to(self.base_dir):
            raise DomainError(
                "INVALID_RESOURCE_PATH",
                f"Ontology resource path '{resource_path}' escapes the workspace",
            )
        return resolved if resolved.is_file() else None

    def for_layer(self, profile: TaskProfile, layer_id: str) -> OntologyService:
        """Retrieve or load the exact OntologyService bound to the specified layer of a TaskProfile."""
        layer = resolve_layer(profile, layer_id)
        ont_def = resolve_ontology(profile, layer.ontology_id)
        sha = ont_def.sha256.lower()

        with self._lock:
            cached = self._services.get(sha)
            registered = self._registered_paths.get(sha)
        if cached is not None:
            return self._bind_release(cached, ont_def)
        if registered is not None:
            ref = OntologyRef(release=ont_def.release, sha256=ont_def.sha256)
            return self._bind_release(self._load_once(sha, registered, ref), ont_def)
        if ont_def.resource_path:
            res_p = self._resource_file(ont_def.resource_path)
            if res_p is not None:
                self.register(res_p, ont_def)
                with self._lock:
                    return self._services[sha]

        raise DomainError(
            "ONTOLOGY_NOT_FOUND",
            f"Ontology '{ont_def.ontology_id}' ({ont_def.label}, release: {ont_def.release}, SHA-256: {ont_def.sha256}) "
            f"for layer '{layer_id}' is not available. Please provide it via '--ontology PATH'.",
        )

    def has_ontology(self, sha256: str) -> bool:
        """Check if an ontology with the given SHA-256 is registered or loaded."""
        sha = sha256.lower()
        with self._lock:
            return sha in self._services or sha in self._registered_paths

    def get_service(self, sha256: str) -> OntologyService | None:
        """Return cached or registered OntologyService by SHA-256, if available."""
        sha = sha256.lower()
        with self._lock:
            cached = self._services.get(sha)
            registered = self._registered_paths.get(sha)
        if cached is not None:
            return cached
        if registered is None:
            return None
        return self._load_once(
            sha, registered, OntologyRef(release="unknown", sha256=sha256)
        )
