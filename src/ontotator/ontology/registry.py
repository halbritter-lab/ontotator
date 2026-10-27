from __future__ import annotations

import copy
import hashlib
import logging
import threading
from collections import OrderedDict
from collections.abc import Iterable, Sequence
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TYPE_CHECKING

from ontotator.domain.documents import OntologyRef
from ontotator.domain.errors import DomainError
from ontotator.domain.profiles import (
    OntologyDefinition,
    TaskProfile,
    resolve_layer,
    resolve_ontology,
)
from ontotator.ontology.conditions import SearchCondition, validate_resources
from ontotator.ontology.service import OntologyService
from ontotator.ontology.translations import (
    LanguageLexicalIndex,
    discover_translation_files,
    parse_translation_name,
)
from ontotator.storage.blobs import BlobStore
from ontotator.vendor.hpo_span_annotator.hpo import OntologyError

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from ontotator.storage.repository import Repository


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

    Whatever changes *which* ontologies and translation files are loaded (a
    load, an upload, a package import) runs under a second lock,
    :meth:`changing`: it looks at the translation files, builds services and
    publishes them as one step, so no change is built on a set of files another
    change is replacing. Looking up a loaded service never takes that lock, so
    searches are answered by the current services while a change is under way.
    """

    def __init__(
        self,
        base_dir: Path | str | None = None,
        translation_dirs: Iterable[Path | str] = (),
    ) -> None:
        self._services: dict[str, OntologyService] = {}
        self._package_services: OrderedDict[str, OntologyService] = OrderedDict()
        self._package_builds: dict[str, Future[OntologyService]] = {}
        self._registered_paths: dict[str, Path] = {}
        self._failures: dict[str, OntologyLoadFailure] = {}
        self._unavailable: set[str] = set()
        self._lock = threading.RLock()
        # Serialises changes; see the class docstring. Always taken before
        # ``_lock`` and the per-digest load locks, never while holding them.
        self._change_lock = threading.RLock()
        # Counts the swaps of :meth:`publish`, i.e. the times the translation
        # files changed under the loaded ontologies.
        self.translation_generation = 0
        self._load_locks: dict[str, threading.Lock] = {}
        # Relative ``resource_path`` entries resolve against this directory
        # (the workspace), never against the process working directory.
        self.base_dir = Path(base_dir).resolve() if base_dir is not None else None
        # The folders ontologies are looked for in. Translation files
        # (hp-de.babelon.tsv) lie next to the ontologies there.
        self.translation_dirs = [Path(d) for d in translation_dirs]

    def changing(self) -> threading.RLock:
        """The lock for a change to the loaded ontologies or translations.

        Hold it (``with registry.changing():``) from reading
        :meth:`translation_files` until the services built with them are
        registered or published. It is re-entrant.
        """
        return self._change_lock

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
            self.translation_generation += 1

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
        # A first load reads the translation files, so it is a change too: an
        # upload that is replacing a file must not be overtaken by it.
        with self._change_lock, load_lock:
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
                self._unavailable.discard(sha)
                self._load_locks.pop(sha, None)
            return service

    def register_service(self, service: OntologyService) -> None:
        """Register an already-instantiated OntologyService."""
        sha = service.ref.sha256.lower()
        with self._lock:
            self._services[sha] = service
            self._failures.pop(sha, None)
            self._unavailable.discard(sha)

    @staticmethod
    def load_resource(
        data: bytes,
        expected: OntologyDefinition,
        translation_paths: Iterable[Path] = (),
    ) -> OntologyService:
        """Validate and parse archive bytes without retaining a temporary path."""
        with TemporaryDirectory(prefix="ontotator-ontology-") as directory:
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
        self,
        profile: TaskProfile,
        resources: dict[str, bytes],
        conditions: list[SearchCondition] | None = None,
    ) -> list[OntologyService]:
        """Parse all resources before package commit; publish services only afterward."""
        validate_resources(conditions, profile, resources)
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
        if conditions is not None:
            services = {service.ref.sha256.lower(): service for service in prepared}
            for condition in conditions:
                self._pinned_service(
                    services[condition.ontology_sha256], condition, resources
                )
        return prepared

    @staticmethod
    def _pinned_service(
        base: OntologyService, condition: SearchCondition, resources: dict[str, bytes]
    ) -> OntologyService:
        """Pin a matching view, or rebuild using only captured translation files."""
        captured = sorted(
            (
                item.filename,
                item.sha256,
                tuple(item.languages),
                resources[item.resource_path],
            )
            for item in condition.translations
        )
        loaded = sorted(
            (item.filename, item.sha256, item.languages, item.content)
            for item in base.translations
        )
        with TemporaryDirectory(prefix="ontotator-search-") as directory:
            paths = []
            for item in condition.translations:
                path = Path(directory) / item.filename
                path.write_bytes(resources[item.resource_path])
                paths.append(path)
            service = (
                base.pinned_view(paths)
                if captured == loaded
                else base.with_translations(paths)
            )
        actual = [
            (t.filename, t.sha256, list(t.languages)) for t in service.translations
        ]
        expected = [(t.filename, t.sha256, t.languages) for t in condition.translations]
        if sorted(actual) != sorted(expected) or service.skipped_translations:
            raise DomainError(
                "INVALID_SEARCH_CONDITION",
                "Captured translations do not match their declared ontology/languages",
            )
        service.search_condition = condition
        return service

    def ensure_package_conditions(
        self, repo: Repository, project_key: str
    ) -> list[SearchCondition]:
        from ontotator.projects.runtime import project_state

        conditions = repo.get_search_conditions(project_key)
        if conditions is not None:
            return conditions
        with repo.db.transaction() as conn:
            structure = project_state(conn, project_key)[0]
        profile = repo.get_task_profile(project_key)
        resources: dict[str, bytes] = {}
        # Capture immutable loaded content while an upload cannot swap services.
        # Release the change lock before acquiring a database write transaction.
        with self.changing():
            conditions = []
            seen: set[str] = set()
            for ont in profile.ontologies:
                if ont.sha256.lower() in seen:
                    continue
                seen.add(ont.sha256.lower())
                service = self._for_definition(ont)
                condition = service.capture_condition()
                conditions.append(condition)
                resources.update(
                    {
                        f"search-resources/{item.sha256}/{item.filename}": item.content
                        for item in service.translations
                    }
                )
        return repo.capture_search_conditions(
            project_key, conditions, resources, expected_structure=structure
        )

    def for_package_layer(
        self, repo: Repository, project_key: str, layer_id: str
    ) -> OntologyService:
        """Resolve a package layer against its first-use/imported immutable pins."""
        profile = repo.get_task_profile(project_key)
        layer = resolve_layer(profile, layer_id)
        definition = resolve_ontology(profile, layer.ontology_id)
        return self._package_ontology(repo, project_key, definition)

    def for_package_ontology(
        self, repo: Repository, project_key: str, ontology_id: str
    ) -> OntologyService:
        definition = resolve_ontology(repo.get_task_profile(project_key), ontology_id)
        return self._package_ontology(repo, project_key, definition)

    def warm(
        self,
        repo: Repository,
        project_key: str,
        definitions: Iterable[OntologyDefinition],
        languages: Sequence[str],
    ) -> threading.Thread | None:
        """Build a project's pinned search views in the background (U15).

        Only when the project's search conditions already exist: warming never
        captures them, so the translations are not frozen before the first real
        search. The build joins the single-flight ``_package_builds``; a search
        arriving meanwhile waits for the same build instead of starting another.
        The language subset lands in the existing per-view LRU.
        """
        conditions = repo.get_search_conditions(project_key)
        if conditions is None:
            return None
        thread = threading.Thread(
            target=self._warm,
            args=(repo, project_key, list(definitions), conditions, list(languages)),
            name=f"search-warm-up-{project_key}",
            daemon=True,
        )
        thread.start()
        return thread

    def _warm(
        self,
        repo: Repository,
        project_key: str,
        definitions: list[OntologyDefinition],
        conditions: list[SearchCondition],
        languages: list[str],
    ) -> None:
        captured = {condition.ontology_sha256 for condition in conditions}
        seen: set[str] = set()
        for definition in definitions:
            sha = definition.sha256.lower()
            if sha in seen or sha not in captured:
                continue
            seen.add(sha)
            try:
                service = self._package_ontology(
                    repo, project_key, definition, conditions
                )
                self.warm_languages(service, languages)
            except Exception as exc:  # a warm-up must never surface
                logger.info("Search warm-up of %s skipped: %s", project_key, exc)

    @staticmethod
    def warm_languages(service: OntologyService, languages: Sequence[str]) -> None:
        """Fit the language subset a search with ``languages`` would use."""
        lexical = service.engine.lexical
        if isinstance(lexical, LanguageLexicalIndex) and lexical.ready:
            lexical.search("warm-up", 1, languages=service.active_languages(languages))

    def _package_ontology(
        self,
        repo: Repository,
        project_key: str,
        definition: OntologyDefinition,
        conditions: list[SearchCondition] | None = None,
    ) -> OntologyService:
        if conditions is None:
            conditions = self.ensure_package_conditions(repo, project_key)
        condition = next(
            c for c in conditions if c.ontology_sha256 == definition.sha256.lower()
        )
        with self._lock:
            service = self._package_services.get(condition.condition_id)
            if service is not None:
                self._package_services.move_to_end(condition.condition_id)
        if service is not None:
            return self._bind_release(service, definition)
        with self._lock:
            # A builder may have published between the first lookup and joining
            # its flight. Only in-flight entries are retained, including errors.
            service = self._package_services.get(condition.condition_id)
            if service is not None:
                self._package_services.move_to_end(condition.condition_id)
                return self._bind_release(service, definition)
            flight = self._package_builds.get(condition.condition_id)
            owner = flight is None
            if flight is None:
                flight = Future()
                self._package_builds[condition.condition_id] = flight
        if not owner:
            return self._bind_release(flight.result(), definition)
        try:
            # No map lock is held while building or waiting. Callers that mutate
            # drafts must resolve these services before opening their transaction.
            base = self._for_definition(definition)
            service = self._pinned_service(
                base, condition, repo.get_embedded_files(project_key)
            )
            with self._lock:
                self._package_services[condition.condition_id] = service
                self._package_services.move_to_end(condition.condition_id)
                if len(self._package_services) > 8:
                    self._package_services.popitem(last=False)
                flight.set_result(service)
                self._package_builds.pop(condition.condition_id)
        except BaseException as exc:
            with self._lock:
                flight.set_exception(exc)
                self._package_builds.pop(condition.condition_id)
            raise
        return self._bind_release(service, definition)

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
            self._load_or_record(sha, path)
        return self.failures()

    def preload(self, shas: Iterable[str], *, retry_unavailable: bool = False) -> None:
        """Parse the registered ontologies of ``shas`` now; record failures.

        Discover cold persisted pins by their expected digest. Readiness may
        retry absent/unreadable or hash-mismatched files after a volume repair;
        malformed ontology content stays failed. Loaded services do no file IO.
        """
        for sha in sorted(s.lower() for s in shas):
            with self._lock:
                if sha in self._services:
                    continue
                path = self._registered_paths.get(sha)
                skip = sha in self._failures and not (
                    retry_unavailable and sha in self._unavailable
                )
            if path is None and self.base_dir is not None:
                path = BlobStore(self.base_dir / "blobs").path(sha)
                with self._lock:
                    self._registered_paths.setdefault(sha, path)
            if not skip and path is not None:
                # A background preload must survive any malformed file.
                self._load_or_record(sha, path, Exception)

    def _load_or_record(
        self,
        sha: str,
        path: Path,
        expected: type[Exception] | tuple[type[Exception], ...] = (
            DomainError,
            OntologyError,
            OSError,
            ValueError,
            KeyError,
        ),
    ) -> None:
        try:
            self.get_service(sha)
        except expected as exc:
            failure = OntologyLoadFailure(sha256=sha, path=path, error=str(exc))
            with self._lock:
                self._failures[sha] = failure
                if isinstance(exc, OSError) or (
                    isinstance(exc, DomainError)
                    and exc.code in {"ONTOLOGY_NOT_FOUND", "ONTOLOGY_HASH_MISMATCH"}
                ):
                    self._unavailable.add(sha)
                else:
                    self._unavailable.discard(sha)
            logger.warning("Could not load ontology %s (sha256 %s): %s", path, sha, exc)

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
        return self._for_definition(ont_def, layer_id)

    def _for_definition(
        self, ont_def: OntologyDefinition, layer_id: str = ""
    ) -> OntologyService:
        """Definitions can be declared without a layer, or alias another digest."""
        sha = ont_def.sha256.lower()

        with self._lock:
            cached = self._services.get(sha)
            registered = self._registered_paths.get(sha)
        if cached is not None:
            return self._bind_release(cached, ont_def)
        if registered is None and self.base_dir is not None:
            # Another worker/CLI may have stored this pinned digest since our
            # startup. Discover only its content-addressed file on a cold miss;
            # _load_once validates the hash and serialises parsing as usual.
            try:
                persisted = BlobStore(self.base_dir / "blobs").path(sha)
            except ValueError:
                persisted = None
            if persisted is not None and persisted.is_file():
                registered = persisted
        if registered is not None:
            ref = OntologyRef(release=ont_def.release, sha256=ont_def.sha256)
            service = self._load_once(sha, registered, ref)
            with self._lock:
                self._registered_paths.setdefault(sha, registered)
            return self._bind_release(service, ont_def)
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
