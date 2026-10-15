"""Projects from the CLI and T1 imports as proposals (T2d Task 4)."""

from __future__ import annotations

import json
from pathlib import Path

import ontospan
import pytest
from pg_harness import database_for, database_url_for
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from t1_fixtures import (
    HP_PATH,
    HP_SHA,
    OPERATOR,
    TOOL,
    annotation,
    bundle,
    create_project,
    hpo_profile,
    layers,
    manifest_sha256,
    run_import,
    single,
    unit,
)
from typer.testing import CliRunner

from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.cli import app
from ontocurator.domain.errors import AccessDenied
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import (
    SCHEMA,
    AuditEventRow,
    DocumentRow,
    ProjectOntologyRow,
    ProposalAnnotationRow,
    ProposalSetRow,
)

runner = CliRunner()
OTHER_TEXT = "Kleinwuchs und Krampfanfälle seit der Geburt."


@pytest.fixture
def db(tmp_path: Path) -> Database:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    return db


def _rows(db: Database, *columns: object) -> list[tuple[object, ...]]:
    with db.transaction() as conn:
        return [tuple(row) for row in conn.execute(select(*columns)).all()]


def _two_units() -> list[ontospan.AnnotatedDocument]:
    return [
        unit("EN100017"),
        unit(
            "EN100018",
            text=OTHER_TEXT,
            annotations=[annotation("p1", (15, 28), text=OTHER_TEXT)],
        ),
    ]


def test_a_bundle_creates_documents_and_proposals(db: Database, tmp_path: Path) -> None:
    job = run_import(db, bundle(tmp_path / "b.zip", _two_units()))

    assert job.status == "succeeded", job.error
    assert job.result is not None
    assert job.result["documents_added"] == 2
    assert job.result["sets_added"] == 2
    assert job.result["proposals"] == 3
    assert job.result["defaulted_axes"] == 3
    repo = Repository(db)
    assert [d.document_id for d in repo.list_documents("proj")] == [
        "EN100017",
        "EN100018",
    ]
    proposals = repo.list_annotations_for_document("proj", "EN100017")
    assert sorted(p.annotation.annotation_id for p in proposals) == [
        "urn:ontospan:b-1:run-7-EN100017:p1",
        "urn:ontospan:b-1:run-7-EN100017:p2",
    ]
    assert {p.annotation.axes_values["experiencer"] for p in proposals} == {"patient"}
    notes = _rows(db, ProposalAnnotationRow.notes)
    assert notes == [(["score 0.91"],)] * 3


def test_reimporting_the_same_bundle_adds_nothing(db: Database, tmp_path: Path) -> None:
    path = bundle(tmp_path / "b.zip", _two_units())
    run_import(db, path)

    again = run_import(db, path)

    assert again.status == "succeeded", again.error
    assert again.result is not None
    assert again.result["documents_added"] == 0
    assert again.result["documents_skipped"] == 2
    assert again.result["sets_added"] == 0
    assert again.result["sets_skipped"] == 2
    assert again.result["proposals"] == 0
    assert len(_rows(db, ProposalSetRow.id)) == 2
    assert len(_rows(db, ProposalAnnotationRow.annotation_id)) == 3


def test_a_changed_text_under_a_known_id_is_refused(
    db: Database, tmp_path: Path
) -> None:
    run_import(db, bundle(tmp_path / "a.zip", [unit("EN100017")]))
    changed = unit(
        "EN100017",
        text=OTHER_TEXT,
        set_id="other-run",
        annotations=[annotation("p1", (15, 28), text=OTHER_TEXT)],
    )

    job = run_import(db, bundle(tmp_path / "b.zip", [changed, unit("EN100099")], "b-2"))

    assert job.status == "failed"
    assert job.error is not None and "DOCUMENT_CONFLICT" in job.error
    assert "EN100017" in job.error
    assert [r[0] for r in _rows(db, DocumentRow.document_id)] == ["EN100017"]
    assert len(_rows(db, ProposalSetRow.id)) == 1


def test_a_bundle_for_another_ontology_release_is_refused(
    db: Database, tmp_path: Path
) -> None:
    other = unit(layer_data=layers(version="2025-01-01"))

    job = run_import(db, bundle(tmp_path / "b.zip", [other]))

    assert job.status == "failed"
    assert job.error is not None and "PIN_MISMATCH" in job.error
    assert "'version'" in job.error and "2025-01-01" in job.error
    assert _rows(db, DocumentRow.document_id) == []


def test_allowed_roots_must_match_the_project(db: Database, tmp_path: Path) -> None:
    other = unit(layer_data=layers(roots=("HP:0000001",)))

    job = run_import(db, bundle(tmp_path / "b.zip", [other]))

    assert job.status == "failed"
    assert job.error is not None and "PIN_MISMATCH" in job.error
    assert "allowed_roots" in job.error
    assert _rows(db, DocumentRow.document_id) == []


def test_import_is_audited(db: Database, tmp_path: Path) -> None:
    job = run_import(db, bundle(tmp_path / "b.zip", _two_units()))

    with db.transaction() as conn:
        imports = conn.execute(
            select(
                AuditEventRow.actor_label,
                AuditEventRow.target_id,
                AuditEventRow.details,
            ).where(AuditEventRow.action == "project.import")
        ).all()
    assert len(imports) == 1
    label, target, details = imports[0]
    assert (label, target) == (OPERATOR.label, "proj")
    assert details["job_id"] == job.id
    assert details["units"] == 2
    assert details["documents_added"] == 2
    assert details["sets_added"] == 2
    assert details["proposals"] == 3
    assert details["defaulted_axes"] == 3
    assert details["documents_only"] == 0


def test_the_import_audit_names_the_bundle(db: Database, tmp_path: Path) -> None:
    path = bundle(tmp_path / "b.zip", _two_units())
    run_import(db, path)

    with db.transaction() as conn:
        details = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "project.import"
            )
        ).scalar_one()
    assert details["bundle_id"] == "b-1"
    assert details["manifest_sha256"] == manifest_sha256(path)
    assert details["producers"] == [
        {"name": "phentrieve", "version": "1.4.0", "model": "bge-m3", "run_id": "run-7"}
    ]


def test_the_cli_creates_a_project_and_imports(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ONTOCURATOR_DATA_DIR", str(tmp_path / "data"))
    url = database_url_for(tmp_path / "cli.db")
    profile = tmp_path / "profile.json"
    data = hpo_profile().model_dump(mode="json")
    data["ontologies"][0]["sha256"] = "0" * 64
    profile.write_text(json.dumps(data), encoding="utf-8")

    def admin(*args: str) -> object:
        return runner.invoke(app, ["admin", "--database-url", url, *args])

    added = admin("ontologies", "add", str(HP_PATH))
    assert added.exit_code == 0, added.output  # type: ignore[attr-defined]
    created = admin(
        "projects",
        "create",
        "cli-proj",
        "--name",
        "CLI project",
        "--profile",
        str(profile),
        "--pin",
        f"hp={HP_SHA}",
        "--allowed-roots",
        "hp=HP:0000118",
        "--t1-profile",
        "hp=hpo-phenotype",
    )
    assert created.exit_code == 0, created.output  # type: ignore[attr-defined]
    assert "Created project 'cli-proj'" in created.output  # type: ignore[attr-defined]

    imported = admin(
        "import", "cli-proj", str(bundle(tmp_path / "b.zip", _two_units()))
    )

    assert imported.exit_code == 0, imported.output  # type: ignore[attr-defined]
    lines = imported.output.splitlines()  # type: ignore[attr-defined]
    assert "documents_added: 2" in lines
    assert "proposals: 3" in lines
    db = database_for(tmp_path / "cli.db")
    assert _rows(
        db,
        ProjectOntologyRow.ontology_id,
        ProjectOntologyRow.sha256,
        ProjectOntologyRow.allowed_roots,
        ProjectOntologyRow.t1_profile,
    ) == [("hp", HP_SHA, ["HP:0000118"], "hpo-phenotype")]
    assert Repository(db).get_task_profile("cli-proj").ontologies[0].sha256 == HP_SHA
    actions = [r[0] for r in _rows(db, AuditEventRow.action)]
    assert "project.create" in actions and "project.import" in actions

    queued = admin(
        "import", "cli-proj", str(single(tmp_path / "u.json", unit("EN1"))), "--no-wait"
    )
    assert queued.exit_code == 0, queued.output  # type: ignore[attr-defined]
    assert queued.output.startswith("Queued job ")  # type: ignore[attr-defined]

    broken = admin(
        "import",
        "cli-proj",
        str(bundle(tmp_path / "c.zip", [unit(layer_data=layers(version="x"))], "b-3")),
    )
    assert broken.exit_code == 1
    assert "JOB_FAILED" in broken.output  # type: ignore[attr-defined]
    assert "PIN_MISMATCH" in broken.output  # type: ignore[attr-defined]


def test_a_project_needs_stored_pinned_ontologies(tmp_path: Path) -> None:
    db = database_for(tmp_path / "editor.db")
    repo = ScopedRepository(db, Access(0, "op", True), OPERATOR)
    from t1_fixtures import PIN

    with pytest.raises(Exception) as error:
        repo.create_project("p", "P", None, hpo_profile(), {"hp": PIN})

    assert getattr(error.value, "code", None) == "PIN_MISMATCH"
    assert "'file'" in str(error.value)


def test_only_leads_and_admins_import(db: Database) -> None:
    annotator = ScopedRepository(
        db,
        Access(
            user_id=5,
            pseudonym="ann-0005",
            is_system_admin=False,
            roles={"proj": frozenset({"annotator", "adjudicator"})},
        ),
    )
    with pytest.raises(AccessDenied) as error:
        annotator.add_documents_and_proposals("proj", [], [], source_sha256="0" * 64)
    assert error.value.code == "NOT_ALLOWED"
    with pytest.raises(AccessDenied):
        annotator.create_project("p2", "P", None, hpo_profile(), {})

    lead = ScopedRepository(
        db,
        Access(5, "ann-0005", False, roles={"proj": frozenset({"lead"})}),
    )
    counts = lead.add_documents_and_proposals("proj", [], [], source_sha256="0" * 64)
    assert counts["documents_added"] == 0


def test_an_imported_set_is_recorded_as_delivered(db: Database, tmp_path: Path) -> None:
    units = _two_units()
    path = bundle(tmp_path / "b.zip", units)
    run_import(db, path)

    with db.transaction() as conn:
        sets = conn.execute(
            select(ProposalSetRow.__table__).order_by(ProposalSetRow.document_id)
        ).all()
        links = conn.execute(
            select(
                ProposalAnnotationRow.annotation_id,
                ProposalAnnotationRow.proposal_set_id,
            )
        ).all()
    assert [s.document_id for s in sets] == ["EN100017", "EN100018"]
    for row, delivered in zip(sets, units, strict=True):
        assert row.bundle_id == "b-1"
        assert row.manifest_sha256 == manifest_sha256(path)
        assert row.set_kind == "tool_output"
        assert row.actors == [TOOL]
        assert ontospan.AnnotationSet.model_validate(row.payload) == (
            delivered.annotation_set
        )
        assert row.job_id is not None
    by_set = {s.id for s in sets}
    assert len(links) == 3
    assert {set_id for _id, set_id in links} == by_set


def test_an_empty_set_creates_only_the_document(db: Database, tmp_path: Path) -> None:
    empty = unit(
        "EN200001",
        set_kind="individual",
        actors=[{"actor_id": "ann-01", "kind": "human"}],
        annotations=[],
    )

    job = run_import(db, single(tmp_path / "u.json", empty))

    assert job.status == "succeeded", job.error
    assert job.result is not None
    assert job.result["documents_only"] == 1
    assert job.result["bundle_id"] is None
    assert job.result["manifest_sha256"] is None
    assert [r[0] for r in _rows(db, DocumentRow.document_id)] == ["EN200001"]
    assert _rows(db, ProposalSetRow.id) == []
    assert _rows(db, ProposalAnnotationRow.annotation_id) == []


def test_tool_actors_need_name_and_version(db: Database, tmp_path: Path) -> None:
    unnamed = {key: value for key, value in TOOL.items() if key != "version"}
    units = [
        unit("EN100017"),
        unit("EN100018", text=OTHER_TEXT, annotations=[], actors=[unnamed]),
    ]

    job = run_import(db, bundle(tmp_path / "b.zip", units))

    assert job.status == "failed"
    assert job.error is not None and "T1_TOOL_PROVENANCE" in job.error
    assert "EN100018" in job.error and "EN100017" not in job.error
    assert _rows(db, DocumentRow.document_id) == []


@pytest.mark.parametrize(
    ("set_kind", "actors"),
    [
        ("individual", [{"actor_id": "ann-01", "kind": "human"}]),
        ("adjudicated", [TOOL]),
        ("tool_output", [TOOL, {"actor_id": "ann-01", "kind": "human"}]),
    ],
)
def test_only_tool_output_sets_bring_proposals(
    db: Database, tmp_path: Path, set_kind: str, actors: list[dict[str, str]]
) -> None:
    """Q33: other non-empty sets refuse the whole import, naming the units."""
    units = [
        unit("EN100017"),
        unit(
            "EN100018",
            text=OTHER_TEXT,
            set_kind=set_kind,
            actors=actors,
            annotations=[annotation("p1", (15, 28), text=OTHER_TEXT)],
        ),
    ]

    job = run_import(db, bundle(tmp_path / "b.zip", units))

    assert job.status == "failed"
    assert job.error is not None and "T1_SET_KIND" in job.error
    assert "EN100018" in job.error and "EN100017" not in job.error
    assert _rows(db, DocumentRow.document_id) == []


def test_two_sets_for_one_document_are_kept_apart(db: Database, tmp_path: Path) -> None:
    run_import(db, bundle(tmp_path / "a.zip", [unit("EN100017")], "b-1"))
    run_import(db, bundle(tmp_path / "b.zip", [unit("EN100017")], "b-2"))

    sets = _rows(db, ProposalSetRow.bundle_id, ProposalSetRow.document_id)
    assert sorted(sets) == [("b-1", "EN100017"), ("b-2", "EN100017")]  # type: ignore[type-var]
    ids = {r[0] for r in _rows(db, ProposalAnnotationRow.annotation_id)}
    assert len(ids) == 4
    assert all(i.startswith(("urn:ontospan:b-1:", "urn:ontospan:b-2:")) for i in ids)  # type: ignore[union-attr]


def test_the_application_cannot_rewrite_imported_sets(
    db: Database, tmp_path: Path
) -> None:
    run_import(db, bundle(tmp_path / "b.zip", [unit()]))

    with (
        pytest.raises(DBAPIError, match="permission denied"),
        db.engine.begin() as conn,
    ):
        conn.execute(text(f"UPDATE {SCHEMA}.proposal_sets SET set_kind = 'release'"))


def test_unrepresentable_units_refuse_the_import(db: Database, tmp_path: Path) -> None:
    """Q11: a modifier cannot be represented; the whole import is refused."""
    bad = annotation("p9", (6, 19))
    bad["modifiers"] = [{"term_id": "HP:0012828", "segments": []}]

    job = run_import(
        db,
        bundle(tmp_path / "b.zip", [unit("EN100017"), unit("EN3", annotations=[bad])]),
    )

    assert job.status == "failed"
    assert job.error is not None and "T1_UNSUPPORTED" in job.error
    assert "p9" in job.error
    assert _rows(db, DocumentRow.document_id) == []


def test_a_project_profile_must_fit_its_t1_profile(tmp_path: Path) -> None:
    """Resolved 2026-10-15 (user): a profile may hide T1 values, not add any."""
    from t1_fixtures import PIN

    db = database_for(tmp_path / "editor.db")
    create_project(db, "ok")
    profile = hpo_profile()
    axes = profile.layers[0].annotation_types[0].axes
    axes[2] = axes[2].model_copy(update={"options": ["current", "future"]})
    repo = ScopedRepository(db, Access(0, "op", True), OPERATOR)

    with pytest.raises(Exception) as error:
        repo.create_project("bad", "Bad", None, profile, {"hp": PIN})

    assert getattr(error.value, "code", None) == "PROFILE_NOT_T1"
    assert "future" in str(error.value)
