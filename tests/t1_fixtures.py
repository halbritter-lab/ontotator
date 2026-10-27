"""T1 bundles and pinned projects for the import and export tests (T2d)."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ontospan

from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
)
from ontotator.exchange.jobs import HANDLERS, store_file
from ontotator.exchange.t1 import Pin, layers_for
from ontotator.jobs.queue import Job, JobQueue
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.storage.database import Database

FIXTURES = Path(__file__).parent / "fixtures"
HP_PATH = FIXTURES / "hp.json"
HP_SHA = hashlib.sha256(HP_PATH.read_bytes()).hexdigest()
HP_RELEASE = "2026-06-23"
TEXT = "Keine Krampfanfälle in der Neonatalzeit. Seit 2 Wochen schwere Krampfanfälle."
OPERATOR = Actor(None, "test:operator")
ADMIN_ACCESS = Access(user_id=0, pseudonym="operator", is_system_admin=True)
TOOL = {
    "actor_id": "phentrieve",
    "kind": "tool",
    "name": "phentrieve",
    "version": "1.4.0",
    "model": "bge-m3",
    "run_id": "run-7",
}


def hpo_profile() -> TaskProfile:
    """One HPO layer with the three T1 ``hpo-phenotype`` axes."""
    return TaskProfile(
        profile_id="hpo-t1/v1",
        version="1.0.0",
        ontologies=[
            OntologyDefinition(
                ontology_id="hp",
                label="Human Phenotype Ontology",
                release=HP_RELEASE,
                sha256=HP_SHA,
            )
        ],
        layers=[
            LayerDefinition(
                layer_id="hpo",
                label="Phenotypes",
                ontology_id="hp",
                access="editable",
                default_type_id="phenotype",
                annotation_types=[
                    AnnotationTypeDefinition(
                        type_id="phenotype",
                        label="Phenotype",
                        axes=[
                            AxisDefinition(
                                id="assertion",
                                label="Assertion",
                                options=["present", "absent", "uncertain"],
                            ),
                            AxisDefinition(
                                id="experiencer",
                                label="Experiencer",
                                options=[
                                    "patient",
                                    "family_member",
                                    "other",
                                    "unknown",
                                ],
                            ),
                            AxisDefinition(
                                id="temporality",
                                label="Temporality",
                                options=["current", "historical", "unknown"],
                            ),
                        ],
                    )
                ],
            )
        ],
        default_layer_id="hpo",
    )


PIN = Pin(sha256=HP_SHA, allowed_roots=("HP:0000118",), t1_profile="hpo-phenotype")


def create_project(db: Database, key: str = "proj", pin: Pin = PIN) -> None:
    """Store HP and create a project pinning it, as the operator."""
    OntologyStore(db, OntologyRegistry(), db.data_dir).add(
        OPERATOR, HP_PATH.name, HP_PATH.read_bytes()
    )
    ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(
        key, "Project", None, hpo_profile(), {"hp": pin}
    )


def layers(
    *, version: str = HP_RELEASE, roots: tuple[str, ...] = ("HP:0000118",)
) -> list[dict[str, Any]]:
    layer = layers_for(hpo_profile(), {"hp": PIN})[0]
    data = layer.model_dump(mode="json")
    data["ontology"]["version"] = version
    data["allowed_roots"] = list(roots)
    return [data]


def seg(text: str, start: int, end: int) -> dict[str, Any]:
    return {"start": start, "end": end, "text": text[start:end]}


def annotation(
    annotation_id: str,
    span: tuple[int, int],
    *,
    text: str = TEXT,
    term_id: str = "HP:0001250",
    actor: dict[str, Any] | None = None,
    assertion: str = "present",
) -> dict[str, Any]:
    return {
        "annotation_id": annotation_id,
        "layer_id": "hpo",
        "term_id": term_id,
        "axes": {
            "assertion": {"value": assertion, "basis": "chosen"},
            "experiencer": {"value": "patient", "basis": "defaulted"},
            "temporality": {"value": "current", "basis": "chosen"},
        },
        "mentions": [{"segments": [seg(text, *span)], "cue_segments": []}],
        "provenance": {
            "actor": actor or {"actor_id": TOOL["actor_id"], "kind": "tool"},
            "method": "tool",
            "source_refs": [],
            "notes": ["score 0.91"],
        },
    }


def unit(
    document_id: str = "EN100017",
    *,
    text: str = TEXT,
    set_id: str | None = None,
    set_kind: str = "tool_output",
    actors: list[dict[str, Any]] | None = None,
    annotations: list[dict[str, Any]] | None = None,
    layer_data: list[dict[str, Any]] | None = None,
) -> ontospan.AnnotatedDocument:
    """A unit with a tool's set; by default two proposals on ``TEXT``."""
    document = ontospan.make_document(document_id, "de", text)
    if annotations is None:
        annotations = [annotation("p1", (6, 19)), annotation("p2", (63, 76))]
    return ontospan.AnnotatedDocument.model_validate(
        {
            "document": document.model_dump(mode="json"),
            "annotation_set": {
                "annotation_set_id": set_id or f"run-7-{document_id}",
                "set_kind": set_kind,
                "actors": actors if actors is not None else [TOOL],
                "created_at": "2026-10-14T12:00:00Z",
                "layers": layer_data if layer_data is not None else layers(),
                "annotations": annotations,
            },
        }
    )


def bundle(
    target: Path, units: list[ontospan.AnnotatedDocument], bundle_id: str = "b-1"
) -> Path:
    """Write a ZIP bundle and return its path."""
    ontospan.write_bundle(
        target,
        units,
        bundle_id=bundle_id,
        created_at=datetime(2026, 10, 14, tzinfo=UTC),
    )
    return target


def single(target: Path, item: ontospan.AnnotatedDocument) -> Path:
    """Write one unit as a ``.json`` file."""
    target.write_bytes(ontospan.dump_json(item))
    return target


def run_import(
    db: Database, path: Path, project: str = "proj", actor: Actor = OPERATOR
) -> Job:
    """Store the file, enqueue ``t1_import`` and run it inline."""
    sha = store_file(db, path.read_bytes())
    queue = JobQueue(db, HANDLERS)
    job_id = queue.enqueue(
        "t1_import",
        {"project": project, "blob_sha256": sha, "filename": path.name},
        actor=actor,
    )
    claimed = queue.claim(job_id, "test")
    assert claimed is not None
    return queue.run(claimed, "test")


def manifest_sha256(path: Path) -> str:
    import zipfile

    with zipfile.ZipFile(path) as archive:
        return hashlib.sha256(archive.read("manifest.json")).hexdigest()


def as_json(value: Any) -> Any:
    return json.loads(json.dumps(value))
