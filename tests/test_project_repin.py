"""Moving a project to another release of its ontology (#81)."""

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from pg_harness import database_for
from sqlalchemy import select
from t1_fixtures import (
    HP_PATH,
    HP_SHA,
    OPERATOR,
    PIN,
    bundle,
    create_project,
    hpo_profile,
    run_import,
    unit,
)
from test_t1_export import DOC, _submit

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationSnapshot,
    Modifier,
    Provenance,
    snapshot,
)
from ontotator.domain.errors import DomainError
from ontotator.domain.review import ReviewTargetSet
from ontotator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontotator.exchange.t1 import Pin
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.projects.repin import term_outcome
from ontotator.projects.service import ProjectService
from ontotator.storage.database import Database
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    AuditEventRow,
    EditEventRow,
    ProjectOntologyRow,
    SubmissionRow,
)
from ontotator.vendor.hpo_span_annotator.hpo import load

OBO = "http://purl.obolibrary.org/obo/"


def _iri(term: str) -> str:
    return OBO + term.replace(":", "_")


def newer_release() -> bytes:
    """hp.json as a later release that retires and merges terms.

    * HP:0011146 is obsolete, replaced by HP:0001250;
    * HP:0000407 is obsolete, replaced by HP:0011146 (a chain to HP:0001250);
    * HP:0002133 is gone, merged into HP:0001250 as an alternative id;
    * HP:0001252 is obsolete with only a ``consider`` suggestion;
    * HP:0001284 is obsolete with two successors (none is single);
    * HP:0000365 is gone without a trace.
    """
    data = json.loads(HP_PATH.read_bytes())
    graph = data["graphs"][0]
    graph["meta"]["version"] = OBO + "hp/releases/2026-09-01/hp.json"
    nodes = {node["id"]: node for node in graph["nodes"]}

    def props(term: str, *values: tuple[str, str]) -> None:
        meta = nodes[_iri(term)].setdefault("meta", {})
        meta["basicPropertyValues"] = [{"pred": p, "val": v} for p, v in values]

    def retire(term: str) -> None:
        nodes[_iri(term)]["meta"] = {"deprecated": True}

    for term in ("HP:0011146", "HP:0000407", "HP:0001252", "HP:0001284"):
        retire(term)
    props("HP:0011146", ("IAO:0100001", "HP:0001250"))
    props("HP:0000407", ("IAO:0100001", "HP:0011146"))
    props("HP:0001252", ("oboInOwl:consider", "HP:0001284"))
    props("HP:0001284", ("IAO:0100001", "HP:0001250"), ("IAO:0100001", "HP:0000707"))
    props("HP:0001250", ("oboInOwl:hasAlternativeId", "HP:0002133"))
    gone = {_iri("HP:0002133"), _iri("HP:0000365")}
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] not in gone]
    graph["edges"] = [
        e for e in graph["edges"] if e["sub"] not in gone and e["obj"] not in gone
    ]
    return json.dumps(data, indent=1).encode()


def test_terms_map_through_one_successor_or_a_merge(tmp_path: Path) -> None:
    path = tmp_path / "hp.json"
    path.write_bytes(newer_release())
    ontology = load(path)
    seizure = term_outcome(ontology, "HP:0011146")
    assert (seizure.kind, seizure.term_id, seizure.reason) == (
        "rewrite",
        "HP:0001250",
        "replaced_by",
    )
    chain = term_outcome(ontology, "HP:0000407")
    assert (chain.kind, chain.term_id) == ("rewrite", "HP:0001250")
    merged = term_outcome(ontology, "HP:0002133")
    assert (merged.kind, merged.term_id, merged.reason) == (
        "rewrite",
        "HP:0001250",
        "alt_id",
    )
    consider = term_outcome(ontology, "HP:0001252")
    assert (consider.kind, consider.status, consider.consider) == (
        "flag",
        "obsolete",
        ("HP:0001284",),
    )
    two = term_outcome(ontology, "HP:0001284")
    assert (two.kind, two.replaced_by) == ("flag", ("HP:0001250", "HP:0000707"))
    assert term_outcome(ontology, "HP:0000365").status == "unknown"
    assert term_outcome(ontology, "HP:0001250").kind == "keep"


def _store(db: Database) -> OntologyStore:
    return OntologyStore(db, OntologyRegistry(), db.data_dir)


@pytest.fixture
def db(tmp_path: Path) -> Database:
    db = database_for(tmp_path / "editor.db", data_dir=tmp_path)
    create_project(db)
    job = run_import(db, bundle(tmp_path / "in.zip", [unit(DOC)]))
    assert job.status == "succeeded", job.error
    return db


def _annotation(
    db: Database, annotation_id: str, term_id: str, modifiers: list[str] = ()
) -> AnnotationSnapshot:
    document = Repository(db).get_document("proj", DOC)
    assert document is not None
    annotation = Annotation(
        annotation_id=annotation_id,
        document_id=DOC,
        layer_id="hpo",
        type_id="phenotype",
        term_id=term_id,
        modifiers=[Modifier(term_id=m) for m in modifiers],
        provenance=Provenance(
            actor=ActorRef(actor_id="alice", kind="human"), method="manual"
        ),
    )
    return snapshot(annotation, [], document, hpo_profile())


def _key(annotator: str = "alice") -> WorkspaceKey:
    return WorkspaceKey(
        project_key="proj",
        document_id=DOC,
        annotator_id=annotator,
        mode="independent",
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


def _draft(db: Database, snaps: list[AnnotationSnapshot]) -> Draft:
    repo = Repository(db)
    key = _key()
    draft = repo.open_draft(key)

    def operation(current: Draft) -> Draft:
        current.annotations = snaps
        current.checked_layer_ids = ["hpo"]
        return current

    result = repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id="seed", expected_revision=draft.revision, payload={}
        ),
        operation,
    )
    assert isinstance(result, Draft)
    return result


def _seed_draft(db: Database) -> Draft:
    return _draft(
        db,
        [
            _annotation(db, "a-replaced", "HP:0011146"),
            _annotation(db, "a-chain", "HP:0000407"),
            _annotation(db, "a-merged", "HP:0002133"),
            _annotation(db, "a-consider", "HP:0001252"),
            _annotation(db, "a-two", "HP:0001284"),
            _annotation(db, "a-gone", "HP:0000365"),
            _annotation(db, "a-same", "HP:0001250", ["HP:0002133"]),
        ],
    )


def _newer(db: Database) -> tuple[OntologyStore, str, dict[str, Pin]]:
    store = _store(db)
    stored = store.add(OPERATOR, "hp-2026-09-01.json", newer_release())
    pins = {"hp": Pin(stored.sha256, PIN.allowed_roots, PIN.t1_profile)}
    return store, stored.sha256, pins


def _terms(draft: Draft) -> dict[str, tuple[str, list[str]]]:
    return {
        s.annotation.annotation_id: (
            s.annotation.term_id,
            [m.term_id for m in s.annotation.modifiers],
        )
        for s in draft.annotations
    }


def test_the_dry_run_lists_rewrites_and_flags_and_changes_nothing(db: Database) -> None:
    seeded = _seed_draft(db)
    store, sha, pins = _newer(db)
    service = ProjectService(db, store)
    report = service.preview_pins(OPERATOR, "proj", pins)

    assert not report.locked
    [change] = report.changes
    assert (change.from_sha256, change.to_sha256) == (HP_SHA, sha)
    assert (change.from_release, change.to_release) == ("2026-06-23", "2026-09-01")
    rewrites = {
        (r.annotation_id, r.role, r.old_term_id, r.new_term_id, r.reason)
        for r in report.rewrites
    }
    assert rewrites == {
        ("a-replaced", "finding", "HP:0011146", "HP:0001250", "replaced_by"),
        ("a-chain", "finding", "HP:0000407", "HP:0001250", "replaced_by"),
        ("a-merged", "finding", "HP:0002133", "HP:0001250", "alt_id"),
        ("a-same", "modifier", "HP:0002133", "HP:0001250", "alt_id"),
    }
    assert {r.new_label for r in report.rewrites} == {"Seizure"}
    flags = {(f.annotation_id, f.term_id, f.status) for f in report.flagged}
    assert flags == {
        ("a-consider", "HP:0001252", "obsolete"),
        ("a-two", "HP:0001284", "obsolete"),
        ("a-gone", "HP:0000365", "unknown"),
    }
    consider = next(f for f in report.flagged if f.annotation_id == "a-consider")
    assert consider.consider == ["HP:0001284"]
    assert all(f.annotator_id == "alice" for f in report.flagged)

    # A dry run: the pin and the draft are as before.
    assert Repository(db).project_pins("proj")["hp"].sha256 == HP_SHA
    assert Repository(db).open_draft(_key()).revision == seeded.revision
    # The same state gives the same report.
    assert service.preview_pins(OPERATOR, "proj", pins) == report


def test_applying_rewrites_drafts_with_an_audit_entry(db: Database) -> None:
    seeded = _seed_draft(db)
    store, sha, pins = _newer(db)
    service = ProjectService(db, store)
    report = service.preview_pins(OPERATOR, "proj", pins)

    with pytest.raises(DomainError) as stale:
        service.apply_pins(OPERATOR, "proj", pins, "0" * 64)
    assert stale.value.code == "REPIN_REPORT_STALE"
    assert Repository(db).project_pins("proj")["hp"].sha256 == HP_SHA

    settings = service.apply_pins(OPERATOR, "proj", pins, report.report_sha256)
    assert [p.sha256 for p in settings.pins] == [sha]
    assert settings.pins[0].release == "2026-09-01"
    assert settings.profile.ontologies[0].sha256 == sha

    draft = Repository(db).open_draft(_key())
    assert draft.revision == seeded.revision + 1
    assert _terms(draft) == {
        "a-replaced": ("HP:0001250", []),
        "a-chain": ("HP:0001250", []),
        "a-merged": ("HP:0001250", []),
        "a-consider": ("HP:0001252", []),
        "a-two": ("HP:0001284", []),
        "a-gone": ("HP:0000365", []),
        "a-same": ("HP:0001250", ["HP:0001250"]),
    }
    by_id = {s.annotation.annotation_id: s for s in draft.annotations}
    # Rewritten snapshots bind the new release; flagged ones stay as they were.
    assert by_id["a-replaced"].ontology_sha256 == sha
    assert by_id["a-gone"].ontology_sha256 == HP_SHA
    # The layer must be checked again.
    assert draft.checked_layer_ids == []

    with db.transaction() as conn:
        event = conn.execute(
            select(EditEventRow.command, EditEventRow.kind)
            .where(EditEventRow.revision_after == draft.revision)
            .order_by(EditEventRow.id.desc())
        ).first()
        audit = conn.execute(
            select(AuditEventRow.details).where(AuditEventRow.action == "project.repin")
        ).scalar_one()
        superseded = conn.execute(
            select(ProjectOntologyRow.superseded_sha256)
        ).scalar_one()
    assert event is not None and event.kind == "edit"
    assert event.command["command"] == "move_to_release"
    assert {
        (c["annotation_id"], c["from"], c["to"]) for c in event.command["rewrites"]
    } == {
        ("a-replaced", "HP:0011146", "HP:0001250"),
        ("a-chain", "HP:0000407", "HP:0001250"),
        ("a-merged", "HP:0002133", "HP:0001250"),
        ("a-same", "HP:0002133", "HP:0001250"),
    }
    assert audit["report_sha256"] == report.report_sha256
    assert len(audit["rewrites"]) == 4 and audit["flagged"] == 3
    assert superseded == [HP_SHA]
    assert Repository(db).superseded_pins("proj") == {"hp": {HP_SHA}}

    # The existing submit check still refuses the flagged terms.
    from ontotator.application.submissions import validate_draft_terms

    new_service = store.service(sha)
    assert new_service is not None
    with pytest.raises(DomainError) as refused:
        validate_draft_terms(draft, settings.profile, new_service)
    assert refused.value.code in {"OBSOLETE_TERM", "UNKNOWN_TERM"}


def _submitted(db: Database) -> list[Any]:
    with db.transaction() as conn:
        return [
            copy.deepcopy(payload)
            for payload in conn.execute(
                select(SubmissionRow.payload).order_by(SubmissionRow.submission_id)
            ).scalars()
        ]


def test_a_started_project_moves_and_keeps_its_submissions(db: Database) -> None:
    _submit(
        db,
        "bob",
        "independent",
        [_annotation(db, "b-1", "HP:0011146"), _annotation(db, "b-2", "HP:0000365")],
        submission_id="s1",
    )
    _seed_draft(db)
    store, sha, pins = _newer(db)
    service = ProjectService(db, store)
    assert service.settings("proj").locked
    # The old path stays closed.
    with pytest.raises(DomainError, match="PROJECT_IN_USE"):
        service.update_pins(OPERATOR, "proj", pins)
    # Only the release may change.
    with pytest.raises(DomainError, match="PROJECT_IN_USE"):
        service.preview_pins(OPERATOR, "proj", {"hp": Pin(sha, (), PIN.t1_profile)})

    before = _submitted(db)
    report = service.preview_pins(OPERATOR, "proj", pins)
    assert report.locked
    [submitted] = report.submitted
    assert submitted.model_dump() == {
        "ontology_id": "hp",
        "annotations": 2,
        "rewritable": 1,
        "obsolete": 0,
        "unknown": 1,
    }
    settings = service.apply_pins(OPERATOR, "proj", pins, report.report_sha256)
    assert settings.locked and settings.pins[0].sha256 == sha
    # Submitted work is never rewritten.
    assert _submitted(db) == before
    assert _terms(Repository(db).open_draft(_key()))["a-replaced"][0] == "HP:0001250"


def test_moving_back_drops_the_digest_from_the_history(db: Database) -> None:
    store, sha, pins = _newer(db)
    service = ProjectService(db, store)
    report = service.preview_pins(OPERATOR, "proj", pins)
    service.apply_pins(OPERATOR, "proj", pins, report.report_sha256)
    back = {"hp": PIN}
    report = service.preview_pins(OPERATOR, "proj", back)
    service.apply_pins(OPERATOR, "proj", back, report.report_sha256)
    assert Repository(db).superseded_pins("proj") == {"hp": {sha}}


def test_the_lead_api_previews_and_applies(tmp_path: Path) -> None:
    from auth_harness import logged_in
    from test_auth_api import _app
    from test_projects_api import create_project as create_via_api

    from ontotator.auth.audit import Actor

    app = _app(tmp_path)
    admin = logged_in(app, "root", system_admin=True)
    project = create_via_api(app, admin)
    stored = app.state.ontology_store.add(
        Actor.cli(), "hp-2026-09-01.json", newer_release()
    )
    pins = [
        {**{k: v for k, v in pin.items() if k != "release"}, "sha256": stored.sha256}
        for pin in project["pins"]
    ]
    preview = admin.post("/api/v1/projects/phenotypes/pins/preview", json=pins)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["changes"][0]["to_release"] == "2026-09-01"
    assert body["rewrites"] == [] and body["flagged"] == []

    stale = admin.post(
        "/api/v1/projects/phenotypes/pins/apply",
        json={"pins": pins, "report_sha256": "0" * 64},
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "REPIN_REPORT_STALE"

    applied = admin.post(
        "/api/v1/projects/phenotypes/pins/apply",
        json={"pins": pins, "report_sha256": body["report_sha256"]},
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["pins"][0]["sha256"] == stored.sha256
    assert hashlib.sha256(newer_release()).hexdigest() == stored.sha256


def test_proposals_made_under_the_old_release_stay_review_targets(
    db: Database,
) -> None:
    from ontotator.application.workspaces import WorkspaceService

    store, _sha, pins = _newer(db)
    service = ProjectService(db, store)
    report = service.preview_pins(OPERATOR, "proj", pins)
    service.apply_pins(OPERATOR, "proj", pins, report.report_sha256)

    repo = Repository(db)
    workspaces = WorkspaceService(repo, store.registry)
    inputs = workspaces.get_review_inputs("proj", DOC)
    assert inputs and {i.ontology_sha256 for i in inputs} == {HP_SHA}
    view = workspaces.open(
        WorkspaceKey(
            project_key="proj",
            document_id=DOC,
            annotator_id="carol",
            mode="review",
            target_set_id="targets-0",
        )
    )
    assert len(view.targets.targets) == len(inputs)

    # Without the history the old digest is refused, as before #81.
    with db.transaction() as conn:
        conn.execute(ProjectOntologyRow.__table__.update().values(superseded_sha256=[]))
    with pytest.raises(DomainError, match="INVALID_REVIEW_TARGET"):
        workspaces.open(
            WorkspaceKey(
                project_key="proj",
                document_id=DOC,
                annotator_id="dave",
                mode="review",
                target_set_id="targets-0",
            )
        )
