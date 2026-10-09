"""Validated, immutable package search inputs and explicit execution identity.

Resources pin bytes, not fitted numerical weights. Historical capture identity
is kept even if a later execution uses a different application or runtime.
"""

from __future__ import annotations

import hashlib
import platform
import sys
from collections.abc import Iterable
from functools import lru_cache
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ontocurator import __version__
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, InvalidPackage
from ontocurator.domain.profiles import TaskProfile, resolve_layer, resolve_ontology
from ontocurator.ontology.translations import parse_translation_name

if TYPE_CHECKING:
    from ontocurator.packages.models import SearchEventRecord

Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Language = Annotated[str, Field(pattern=r"^[a-z]{2}$")]


class RuntimeIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    app_version: str = Field(min_length=1, max_length=128)
    app_artifact_sha256: Digest
    app_artifact_kind: Literal[
        "python-sources", "frozen-executable", "python-artifacts"
    ]
    python: str = Field(min_length=1, max_length=128)
    numpy: str = Field(min_length=1, max_length=128)
    scipy: str = Field(min_length=1, max_length=128)
    scikit_learn: str = Field(min_length=1, max_length=128)


@lru_cache(maxsize=1)
def current_runtime() -> RuntimeIdentity:
    """Identify actual shipped code, including dirty sources and frozen builds."""
    root = Path(__file__).resolve().parents[1]
    sources = sorted(root.rglob("*.py"))
    digest = hashlib.sha256()
    kind: Literal["python-sources", "frozen-executable", "python-artifacts"]
    if sources:
        kind = "python-sources"
        for path in sources:
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    elif getattr(sys, "frozen", False):
        kind = "frozen-executable"
        with Path(sys.executable).open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    else:
        kind = "python-artifacts"
        artifacts = sorted(root.rglob("*.pyc"))
        if not artifacts:
            raise RuntimeError("Cannot identify the running application artifact")
        for path in artifacts:
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
    return RuntimeIdentity(
        app_version=__version__,
        app_artifact_sha256=digest.hexdigest(),
        app_artifact_kind=kind,
        python=platform.python_version(),
        numpy=version("numpy"),
        scipy=version("scipy"),
        scikit_learn=version("scikit-learn"),
    )


class IndexConfiguration(BaseModel):
    """Declared defaults and application algorithms, separate from the runtime."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    algorithm: str = Field(default="selected-language-char-wb-tfidf/2", max_length=128)
    analyzer: Literal["char_wb"] = "char_wb"
    ngram_range: tuple[int, int] = (3, 5)
    sublinear_tf: bool = True
    lowercase: bool = True
    use_idf: bool = True
    smooth_idf: bool = True
    norm: Literal["l2"] = "l2"
    fitting_corpus: Literal["english-plus-selected-translations"] = (
        "english-plus-selected-translations"
    )
    term_aggregation: Literal["max-name-score"] = "max-name-score"
    id_normalization: str = "dominant_prefix_int_v1"
    ranking: str = "numpy-argsort-max400-k40-terms-k4/1"
    display_shuffle: str = "sha256-annotator-annotation-query-k-languages/1"


class TranslationResource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    filename: str = Field(min_length=1, max_length=128)
    sha256: Digest
    resource_path: str = Field(max_length=256)
    languages: list[Language] = Field(min_length=1, max_length=32)

    @model_validator(mode="after")
    def validate_path(self) -> TranslationResource:
        if parse_translation_name(self.filename) is None:
            raise ValueError("Invalid captured translation filename")
        if self.resource_path != f"search-resources/{self.sha256}/{self.filename}":
            raise ValueError("Translation resource path must be content-addressed")
        if self.languages != sorted(set(self.languages)):
            raise ValueError("Translation languages must be unique and sorted")
        return self


class SearchCondition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["ontocurator-search-condition/v1"] = (
        "ontocurator-search-condition/v1"
    )
    condition_id: Digest
    ontology_sha256: Digest
    translations: list[TranslationResource] = Field(
        default_factory=list, max_length=128
    )
    index: IndexConfiguration = Field(default_factory=IndexConfiguration)
    runtime: RuntimeIdentity

    @model_validator(mode="after")
    def validate_identity(self) -> SearchCondition:
        if self.condition_id != canonical_hash(
            self.model_dump(exclude={"condition_id"})
        ):
            raise ValueError("Search condition SHA-256 mismatch")
        filenames = [item.filename.lower() for item in self.translations]
        if len(filenames) != len(set(filenames)):
            raise ValueError("Duplicate translation filename in condition")
        return self


class SearchExecution(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    index: IndexConfiguration = Field(default_factory=IndexConfiguration)
    runtime: RuntimeIdentity
    fitting_languages: list[Language] = Field(default_factory=list, max_length=33)
    k: int | None = Field(default=None, ge=1, le=100)


def validate_resources(
    conditions: list[SearchCondition] | None,
    profile: TaskProfile,
    resources: dict[str, bytes],
) -> set[str]:
    """Validate complete declarations and return the translation archive paths."""
    declared: set[str] = set()
    seen: set[str] = set()
    ontologies = {ont.sha256.lower() for ont in profile.ontologies}
    for condition in conditions or []:
        # Revalidate even model_copy-created objects passed to the writer/importer.
        SearchCondition.model_validate(condition.model_dump())
        if condition.ontology_sha256 not in ontologies:
            raise InvalidPackage(
                "Search condition ontology is not bound to the task profile"
            )
        if condition.ontology_sha256 in seen:
            raise InvalidPackage("Duplicate search condition ontology binding")
        seen.add(condition.ontology_sha256)
        for item in condition.translations:
            declared.add(item.resource_path)
            data = resources.get(item.resource_path)
            if data is None:
                raise InvalidPackage(
                    f"Missing captured translation: '{item.resource_path}'"
                )
            if len(data) > 16 * 1024 * 1024:
                raise InvalidPackage("Captured translation exceeds 16 MiB limit")
            if hashlib.sha256(data).hexdigest() != item.sha256:
                raise InvalidPackage(
                    f"Captured translation SHA-256 mismatch: '{item.filename}'"
                )
    if conditions is not None and seen != ontologies:
        raise InvalidPackage("Captured conditions must cover every profile ontology")
    undeclared = {
        path for path in resources if path.startswith("search-resources/")
    } - declared
    if undeclared:
        raise InvalidPackage("Undeclared captured translation resources")
    return declared


def projected_conditions(
    conditions: list[SearchCondition] | None, profile: TaskProfile
) -> list[SearchCondition] | None:
    if conditions is None:
        return None
    digests = {ont.sha256.lower() for ont in profile.ontologies}
    return [
        condition for condition in conditions if condition.ontology_sha256 in digests
    ]


def validate_search_events(
    conditions: list[SearchCondition] | None,
    profile: TaskProfile,
    events: Iterable[SearchEventRecord],
) -> None:
    """Keep uncaptured history distinct and reject contradictory new metadata."""
    by_id = {condition.condition_id: condition for condition in conditions or []}
    for event in events:
        if event.search_condition_id is None:
            if event.execution is not None or event.runtime_drift is not None:
                raise InvalidPackage(
                    "Search execution metadata requires captured conditions"
                )
            continue
        condition = by_id.get(event.search_condition_id)
        if (
            condition is None
            or condition.ontology_sha256 != event.ontology_sha256.lower()
        ):
            raise InvalidPackage(
                "Search event condition is missing or bound to a different ontology"
            )
        try:
            layer = resolve_layer(profile, event.layer_id)
            ontology = resolve_ontology(profile, layer.ontology_id)
        except DomainError as exc:
            raise InvalidPackage(
                "Search event condition refers to an unknown layer"
            ) from exc
        if condition.ontology_sha256 != ontology.sha256.lower():
            raise InvalidPackage("Search event condition does not match its layer")
        execution = event.execution
        if execution is None or event.runtime_drift is None:
            raise InvalidPackage("Captured search event is missing execution identity")
        drift = (
            condition.runtime != execution.runtime or condition.index != execution.index
        )
        if event.runtime_drift != drift:
            raise InvalidPackage(
                "Search event runtime drift contradicts execution identity"
            )
        available = {"en"} | {
            code for resource in condition.translations for code in resource.languages
        }
        if (
            execution.fitting_languages != event.languages
            or not set(event.languages) <= available
        ):
            raise InvalidPackage(
                "Search event fitting languages contradict captured resources"
            )
