"""Exports name the release recorded with the work, not the current pin (#81)."""

from pathlib import Path

import ontospan
import pytest
from pg_harness import database_for
from t1_fixtures import HP_SHA, OPERATOR, bundle, create_project, run_import, unit
from test_project_repin import _annotation, _newer
from test_t1_export import DOC, _run, _submit

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontotator.projects.service import ProjectService
from ontotator.storage.database import Database
from ontotator.storage.repository import Repository

GONE = "HP:0000365"  # unknown to the newer release


@pytest.fixture
def db(tmp_path: Path) -> Database:
    db = database_for(tmp_path / "editor.db", data_dir=tmp_path)
    create_project(db)
    job = run_import(db, bundle(tmp_path / "in.zip", [unit(DOC)]))
    assert job.status == "succeeded", job.error
    return db


def _move(db: Database) -> str:
    store, sha, pins = _newer(db)
    service = ProjectService(db, store)
    report = service.preview_pins(OPERATOR, "proj", pins)
    service.apply_pins(OPERATOR, "proj", pins, report.report_sha256)
    return sha


def _under_current_release(db: Database, annotation_id: str) -> AnnotationSnapshot:
    repo = Repository(db)
    document = repo.get_document("proj", DOC)
    assert document is not None
    return snapshot(
        Annotation(
            annotation_id=annotation_id,
            document_id=DOC,
            layer_id="hpo",
            type_id="phenotype",
            term_id="HP:0001250",
            provenance=Provenance(
                actor=ActorRef(actor_id="alice", kind="human"), method="manual"
            ),
        ),
        [],
        document,
        repo.get_task_profile("proj"),
    )


def _bundle(
    db: Database,
) -> tuple[ontospan.Manifest, dict[str, ontospan.AnnotatedDocument]]:
    job = _run(db, "t1_export")
    assert job.status == "succeeded", job.error
    assert job.result is not None
    manifest, units = ontospan.read_bundle(db.blobs.path(job.result["sha256"]))
    return manifest, {
        unit.annotation_set.annotation_set_id.split(":")[-1]: unit for unit in units
    }


def test_work_from_before_a_move_names_its_own_release(db: Database) -> None:
    _submit(
        db,
        "alice",
        "independent",
        [_annotation(db, "old", GONE)],
        submission_id="s-old",
    )
    _move(db)
    manifest, units = _bundle(db)

    [layer] = manifest.layers
    assert layer.layer_id == "hpo"
    assert (layer.ontology.version, layer.ontology.sha256) == ("2026-06-23", HP_SHA)
    assert units["s-old"].annotation_set.layers == (layer,)


def test_texts_of_two_releases_each_state_their_own(db: Database) -> None:
    _submit(
        db,
        "alice",
        "independent",
        [_annotation(db, "old", "HP:0001250")],
        submission_id="s-old",
    )
    sha = _move(db)
    _submit(
        db,
        "bob",
        "independent",
        [_under_current_release(db, "new")],
        submission_id="s-new",
    )
    manifest, units = _bundle(db)

    named = {layer.layer_id: layer.ontology for layer in manifest.layers}
    older = f"hpo@{HP_SHA[:12]}"
    assert set(named) == {"hpo", older}
    assert (named["hpo"].version, named["hpo"].sha256) == ("2026-09-01", sha)
    assert (named[older].version, named[older].sha256) == ("2026-06-23", HP_SHA)
    assert named["hpo"].id == named[older].id == "hp"
    assert [a.layer_id for a in units["s-new"].annotation_set.annotations] == ["hpo"]
    assert [a.layer_id for a in units["s-old"].annotation_set.annotations] == [older]


def test_a_submission_counts_under_the_newest_release_it_holds(db: Database) -> None:
    kept = _annotation(db, "kept", "HP:0001250")
    sha = _move(db)
    _submit(
        db,
        "alice",
        "independent",
        [kept, _under_current_release(db, "new")],
        submission_id="s-mixed",
    )
    manifest, _units = _bundle(db)
    [layer] = manifest.layers
    assert (layer.layer_id, layer.ontology.sha256) == ("hpo", sha)


def test_without_a_move_an_export_is_unchanged(db: Database) -> None:
    _submit(
        db,
        "alice",
        "independent",
        [_annotation(db, "old", "HP:0001250")],
        submission_id="s-old",
    )
    manifest, _units = _bundle(db)
    [layer] = manifest.layers
    assert (layer.layer_id, layer.ontology.sha256) == ("hpo", HP_SHA)
