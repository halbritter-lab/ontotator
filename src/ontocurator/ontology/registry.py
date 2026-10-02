from __future__ import annotations

import hashlib
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
from ontocurator.vendor.hpo_span_annotator.hpo import OntologyError


class OntologyRegistry:
    """Manages and caches loaded ontology services bound to TaskProfiles and SHA-256 digests."""

    def __init__(self) -> None:
        self._services: dict[str, OntologyService] = {}
        self._registered_paths: dict[str, Path] = {}

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

        self._registered_paths[expected_sha] = p
        if expected_sha not in self._services:
            ref = OntologyRef(release=expected.release, sha256=expected.sha256)
            self._services[expected_sha] = OntologyService.load(p, ref)

    def register_service(self, service: OntologyService) -> None:
        """Register an already-instantiated OntologyService."""
        self._services[service.ref.sha256.lower()] = service

    @staticmethod
    def load_resource(data: bytes, expected: OntologyDefinition) -> OntologyService:
        """Validate and parse archive bytes without retaining a temporary path."""
        with TemporaryDirectory(prefix="ontocurator-ontology-") as directory:
            path = Path(directory) / "ontology.json"
            path.write_bytes(data)
            try:
                return OntologyService.load(
                    path, OntologyRef(release=expected.release, sha256=expected.sha256)
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
                prepared.append(self.load_resource(resources[ont.resource_path], ont))
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
        raw = p.read_bytes()
        digest = hashlib.sha256(raw).hexdigest().lower()
        self._registered_paths[digest] = p
        return digest

    def for_layer(self, profile: TaskProfile, layer_id: str) -> OntologyService:
        """Retrieve or load the exact OntologyService bound to the specified layer of a TaskProfile."""
        layer = resolve_layer(profile, layer_id)
        ont_def = resolve_ontology(profile, layer.ontology_id)
        sha = ont_def.sha256.lower()

        if sha in self._services:
            svc = self._services[sha]
            if svc.ref.release in ("unknown", "pinned") and ont_def.release:
                svc.ref = OntologyRef(release=ont_def.release, sha256=ont_def.sha256)
            return svc

        if sha in self._registered_paths:
            ref = OntologyRef(release=ont_def.release, sha256=ont_def.sha256)
            svc = OntologyService.load(self._registered_paths[sha], ref)
            self._services[sha] = svc
            return svc

        if ont_def.resource_path:
            res_p = Path(ont_def.resource_path)
            if res_p.is_file():
                self.register(res_p, ont_def)
                return self._services[sha]

        raise DomainError(
            "ONTOLOGY_NOT_FOUND",
            f"Ontology '{ont_def.ontology_id}' ({ont_def.label}, release: {ont_def.release}, SHA-256: {ont_def.sha256}) "
            f"for layer '{layer_id}' is not available. Please provide it via '--ontology PATH'.",
        )

    def has_ontology(self, sha256: str) -> bool:
        """Check if an ontology with the given SHA-256 is registered or loaded."""
        sha = sha256.lower()
        return sha in self._services or sha in self._registered_paths

    def get_service(self, sha256: str) -> OntologyService | None:
        """Return cached or registered OntologyService by SHA-256, if available."""
        sha = sha256.lower()
        if sha in self._services:
            return self._services[sha]
        if sha in self._registered_paths:
            ref = OntologyRef(release="unknown", sha256=sha256)
            svc = OntologyService.load(self._registered_paths[sha], ref)
            self._services[sha] = svc
            return svc
        return None
