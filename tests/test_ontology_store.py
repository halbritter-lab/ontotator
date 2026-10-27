"""Ontology files on the data volume, project pins and per-worker loading (T2d Task 2)."""

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from auth_harness import logged_in
from layered_fixtures import make_layered_package
from pg_harness import database_for, database_url_for
from sqlalchemy import insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ontotator.api.app import create_app
from ontotator.auth.audit import Actor
from ontotator.config import AppConfig
from ontotator.domain.errors import DomainError
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.storage.database import Database
from ontotator.storage.tables import (
    AuditEventRow,
    OntologyFileRow,
    ProjectOntologyRow,
    ProjectRow,
    StoredFileRow,
)

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
DE = FIXTURES / "hp-de.babelon.tsv"
HP_SHA = hashlib.sha256(HP.read_bytes()).hexdigest()
DE_SHA = hashlib.sha256(DE.read_bytes()).hexdigest()


def _db(tmp_path: Path) -> Database:
    workspace = tmp_path / "workspace"
    return database_for(workspace / "editor.db", data_dir=workspace)


def _store(db: Database) -> OntologyStore:
    return OntologyStore(db, OntologyRegistry(), db.data_dir)


def _config(tmp_path: Path) -> AppConfig:
    workspace = tmp_path / "workspace"
    return AppConfig(
        workspace_dir=workspace, database_url=database_url_for(workspace / "editor.db")
    )


def _audits(db: Database, action: str) -> list[Any]:
    with db.transaction() as conn:
        return list(
            conn.execute(
                select(
                    AuditEventRow.target_id,
                    AuditEventRow.details,
                    AuditEventRow.actor_label,
                ).where(AuditEventRow.action == action)
            ).all()
        )


def test_an_ontology_is_stored_once_by_hash(tmp_path: Path) -> None:
    db = _db(tmp_path)
    store = _store(db)

    stored = store.add(Actor.cli(), "hp.json", HP.read_bytes())

    assert (stored.sha256, stored.kind, stored.prefix, stored.release) == (
        HP_SHA,
        "ontology",
        "hp",
        "2026-06-23",
    )
    assert stored.filename == "hp.json"
    assert db.blobs.path(HP_SHA).read_bytes() == HP.read_bytes()
    [audit] = _audits(db, "ontology.add")
    assert audit.target_id == HP_SHA
    assert audit.details["prefix"] == "hp"
    assert audit.actor_label.startswith("cli:")

    again = store.add(Actor.cli(), "renamed.json", HP.read_bytes())
    assert again == stored
    assert len(_audits(db, "ontology.add")) == 1
    assert [item.sha256 for item in store.list()] == [HP_SHA]
    with db.transaction() as conn:
        assert list(conn.execute(select(StoredFileRow.sha256)).scalars()) == [HP_SHA]


def test_a_file_that_is_no_ontology_is_refused(tmp_path: Path) -> None:
    db = _db(tmp_path)
    with pytest.raises(DomainError) as excinfo:
        _store(db).add(Actor.cli(), "broken.json", b"{not json")
    assert excinfo.value.code == "INVALID_ONTOLOGY"
    assert _store(db).list() == []


def test_a_translation_needs_its_naming(tmp_path: Path) -> None:
    db = _db(tmp_path)
    store = _store(db)

    with pytest.raises(DomainError) as excinfo:
        store.add(Actor.cli(), "german.tsv", DE.read_bytes())
    assert excinfo.value.code == "INVALID_TRANSLATION"
    with pytest.raises(DomainError) as excinfo:
        store.add(Actor.cli(), "hp-de.babelon.tsv", b"no header\n")
    assert excinfo.value.code == "INVALID_TRANSLATION"
    assert store.list() == []

    stored = store.add(Actor.cli(), "HP-DE.babelon.tsv", DE.read_bytes())
    assert (stored.kind, stored.prefix, stored.language, stored.filename) == (
        "translation",
        "hp",
        "de",
        "hp-de.babelon.tsv",
    )
    assert (db.data_dir / "translations" / "hp-de.babelon.tsv").read_bytes() == (
        DE.read_bytes()
    )


def test_registered_ontologies_load_lazily(tmp_path: Path) -> None:
    db = _db(tmp_path)
    _store(db).add(Actor.cli(), "hp.json", HP.read_bytes())

    registry = OntologyRegistry()
    OntologyStore(db, registry, db.data_dir).register_all()

    assert registry.registered_path(HP_SHA) == db.blobs.path(HP_SHA)
    assert registry.services() == []
    service = registry.get_service(HP_SHA)
    assert service is not None
    assert [sha for sha, _ in registry.services()] == [HP_SHA]


def test_a_missing_blob_does_not_stop_the_start(tmp_path: Path) -> None:
    db = _db(tmp_path)
    _store(db).add(Actor.cli(), "hp.json", HP.read_bytes())
    _store(db).add(Actor.cli(), "hp-de.babelon.tsv", DE.read_bytes())
    db.blobs.path(HP_SHA).unlink()
    db.blobs.path(DE_SHA).unlink()
    (db.data_dir / "translations" / "hp-de.babelon.tsv").unlink()

    registry = OntologyRegistry()
    OntologyStore(db, registry, db.data_dir).register_all()

    assert registry.registered_path(HP_SHA) is None
    assert not (db.data_dir / "translations" / "hp-de.babelon.tsv").exists()


def _pin_hp(db: Database) -> None:
    """A seeded project that pins the stored HP file (Task 4 creates pins)."""
    from ontotator.storage.repository import Repository

    Repository(db).import_package(make_layered_package("single"))
    with db.transaction() as conn:
        project_id = conn.execute(select(ProjectRow.id)).scalar_one()
        conn.execute(
            insert(ProjectOntologyRow).values(
                project_id=project_id,
                ontology_id="hp",
                sha256=HP_SHA,
                allowed_roots=["HP:0000118"],
                t1_profile="hpo-phenotype",
            )
        )


def test_pinned_ontologies_are_preloaded(tmp_path: Path) -> None:
    db = _db(tmp_path)
    store = _store(db)
    store.add(Actor.cli(), "hp.json", HP.read_bytes())
    assert store.pinned_shas() == set()
    _pin_hp(db)
    assert store.pinned_shas() == {HP_SHA}

    app = create_app(_config(tmp_path))

    assert app.state.ontologies_ready.wait(30)
    registry: OntologyRegistry = app.state.ontology_registry
    assert [sha for sha, _ in registry.services()] == [HP_SHA]


def test_without_pins_nothing_is_preloaded(tmp_path: Path) -> None:
    _store(_db(tmp_path)).add(Actor.cli(), "hp.json", HP.read_bytes())

    app = create_app(_config(tmp_path))

    assert app.state.ontologies_ready.wait(30)
    registry: OntologyRegistry = app.state.ontology_registry
    assert registry.services() == []
    assert registry.registered_path(HP_SHA) is not None


@pytest.mark.parametrize("captured", [False, True])
def test_running_worker_searches_ontology_added_by_another_worker(
    tmp_path: Path, captured: bool
) -> None:
    from ontotator.storage.repository import Repository

    app = create_app(_config(tmp_path))
    assert app.state.ontologies_ready.wait(30)
    registry: OntologyRegistry = app.state.ontology_registry
    # A separate CLI process has its own database engine and registry.
    db = _db(tmp_path)
    writer = OntologyStore(db, OntologyRegistry(base_dir=db.data_dir), db.data_dir)
    writer.add(Actor.cli(), "hp.json", HP.read_bytes())
    _pin_hp(db)
    project_key = make_layered_package("single").manifest.package_id
    if captured:
        writer.registry.ensure_package_conditions(Repository(db), project_key)

    outsider = logged_in(app, "outsider")
    body = {
        "project_key": project_key,
        "document_id": "doc-alpha",
        "mode": "independent",
    }
    assert outsider.post("/api/v1/workspaces/open", json=body).status_code == 404
    assert registry.services() == []
    member = logged_in(app, "member", projects={project_key: ["annotator"]})
    opened = member.post("/api/v1/workspaces/open", json=body)
    assert opened.status_code == 200, opened.text
    searched = member.post(
        "/api/v1/search",
        json={
            "workspace_key": opened.json()["view"]["key"],
            "annotation_id": "new-annotation",
            "layer_id": "hpo-layer",
            "query": "HP:0001250",
            "route": "id",
            "k": 5,
        },
    )
    assert searched.status_code == 200, searched.text
    assert searched.json()["candidates"][0]["term_id"] == "HP:0001250"
    assert searched.json()["ontology_sha256"] == HP_SHA


def test_translations_are_found_after_a_restart(tmp_path: Path) -> None:
    first = create_app(_config(tmp_path))
    store: OntologyStore = first.state.ontology_store
    store.add(Actor.cli(), "hp.json", HP.read_bytes())
    store.add(Actor.cli(), "hp-de.babelon.tsv", DE.read_bytes())
    # The placed copy is gone (e.g. a new container on the same volume).
    (tmp_path / "workspace" / "translations" / "hp-de.babelon.tsv").unlink()

    second = create_app(_config(tmp_path))

    registry: OntologyRegistry = second.state.ontology_registry
    service = registry.get_service(HP_SHA)
    assert service is not None
    assert service.translation_counts == {"de": 4}
    assert [item.filename for item in service.translations] == ["hp-de.babelon.tsv"]


def test_the_list_shows_failures_of_pinned_files(tmp_path: Path) -> None:
    db = _db(tmp_path)
    broken = json.dumps({"graphs": [{"id": "x", "nodes": "not a list"}]}).encode()
    # Stored behind the store's back: a file that parses no more.
    sha = db.blobs.put(broken)
    _store(db).add(Actor.cli(), "hp.json", HP.read_bytes())
    with db.transaction() as conn:
        conn.execute(pg_insert(StoredFileRow).values(sha256=sha, size=len(broken)))
        conn.execute(
            pg_insert(OntologyFileRow).values(
                sha256=sha, kind="ontology", prefix="x", filename="x.json"
            )
        )
    _pin_hp(db)
    with db.transaction() as conn:
        conn.execute(
            insert(ProjectOntologyRow).values(
                project_id=conn.execute(select(ProjectRow.id)).scalar_one(),
                ontology_id="x",
                sha256=sha,
            )
        )

    app = create_app(_config(tmp_path))

    assert app.state.ontologies_ready.wait(30)
    registry: OntologyRegistry = app.state.ontology_registry
    assert [failure.sha256 for failure in registry.failures()] == [sha]
    assert [s for s, _ in registry.services()] == [HP_SHA]
