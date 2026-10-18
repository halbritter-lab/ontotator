"""T1 export of submissions and the pseudonymised edit log (T2d Task 5)."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Any

import ontospan
import pytest
from pg_harness import database_for, database_url_for
from sqlalchemy import select, update
from t1_fixtures import (
    HP_PATH,
    OPERATOR,
    bundle,
    create_project,
    hpo_profile,
    run_import,
    unit,
)
from typer.testing import CliRunner

from ontocurator.auth.accounts import AccountService
from ontocurator.cli import app
from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    AnnotationSnapshot,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    Segment,
    snapshot_evidence,
)
from ontocurator.domain.profiles import AxisDefinition
from ontocurator.domain.review import ReviewDecision, ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, Submission, WorkspaceKey
from ontocurator.exchange.jobs import HANDLERS
from ontocurator.jobs.queue import Job, JobQueue
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import AuditEventRow, UserRow

runner = CliRunner()
DOC = "EN100017"


@pytest.fixture
def db(tmp_path: Path) -> Database:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    job = run_import(db, bundle(tmp_path / "in.zip", [unit(DOC)]))
    assert job.status == "succeeded", job.error
    return db


def _run(db: Database, kind: str, project: str = "proj") -> Job:
    queue = JobQueue(db, HANDLERS)
    job_id = queue.enqueue(kind, {"project": project}, actor=OPERATOR)
    claimed = queue.claim(job_id, "test")
    assert claimed is not None
    return queue.run(claimed, "test")


def _document(db: Database) -> Document:
    document = Repository(db).get_document("proj", DOC)
    assert document is not None
    return document


def _own(
    db: Database,
    annotator: str,
    annotation_id: str,
    span: tuple[int, int] | None,
    axes: dict[str, str | None],
) -> AnnotationSnapshot:
    document = _document(db)
    evidence = []
    refs = []
    if span is not None:
        ev = snapshot_evidence(
            EvidenceMention(
                evidence_id=f"{annotation_id}-e",
                segments=[Segment(start=span[0], end=span[1])],
            ),
            document,
        )
        evidence.append(ev)
        refs.append(EvidenceRef(evidence_id=ev.mention.evidence_id, version=ev.version))
    annotation = Annotation(
        annotation_id=annotation_id,
        document_id=DOC,
        layer_id="hpo",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values=axes,
        evidence_refs=refs,
        provenance=Provenance(
            actor=ActorRef(actor_id=annotator, kind="human"), method="manual"
        ),
    )
    return snapshot(annotation, evidence, document, hpo_profile())


def _submit(
    db: Database,
    annotator: str,
    mode: str,
    snapshots: list[AnnotationSnapshot],
    *,
    submission_id: str,
    decisions: list[ReviewDecision] | None = None,
    targets: list[AnnotationRef] | None = None,
) -> Submission:
    """One edit and the submit, through the repository's mutation path."""
    repo = Repository(db)
    target_set = ReviewTargetSet.create(targets or [])
    key = WorkspaceKey(
        project_key="proj",
        document_id=DOC,
        annotator_id=annotator,
        mode=mode,  # type: ignore[arg-type]
        target_set_id=target_set.target_set_id,
    )
    draft = repo.open_draft(key, target_set if mode == "review" else None)
    payload = {"command": "check_layer", "layer_id": "hpo", "checked": True}
    repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id=f"{submission_id}-edit",
            expected_revision=draft.revision,
            payload=payload,
        ),
        lambda current: current,
    )
    submission = Submission(
        submission_id=submission_id,
        origin_key=key,
        targets=target_set,
        draft_revision=draft.revision + 2,
        snapshots=snapshots,
        decisions=decisions or [],
        created_at="2026-10-15T09:30:00Z",
    )
    result = repo.run_mutation(
        key,
        MutationEnvelope(
            mutation_id=submission_id,
            expected_revision=draft.revision + 1,
            payload={"document_checked": True, "command": "submit_workspace"},
        ),
        lambda _current: submission,
    )
    assert isinstance(result, Submission)
    return submission


def _read(
    db: Database, job: Job
) -> tuple[ontospan.Manifest, list[ontospan.AnnotatedDocument]]:
    assert job.status == "succeeded", job.error
    assert job.result is not None
    path = db.blobs.path(job.result["sha256"])
    return ontospan.read_bundle(path, {"hp": ontospan.ObographOntology.load(HP_PATH)})


def _proposals(db: Database) -> list[AnnotationSnapshot]:
    return sorted(
        Repository(db).list_annotations_for_document("proj", DOC),
        key=lambda s: s.annotation.annotation_id,
    )


def test_submissions_export_as_a_valid_bundle(db: Database) -> None:
    full = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
    _submit(
        db,
        "ann-0001",
        "independent",
        [_own(db, "ann-0001", "a1", (6, 19), full)],
        submission_id="s-old",
    )
    _submit(
        db,
        "ann-0001",
        "independent",
        [_own(db, "ann-0001", "a1", (63, 76), full)],
        submission_id="s-new",
    )
    _submit(
        db,
        "ann-0002",
        "assisted",
        [_own(db, "ann-0002", "b1", None, full)],
        submission_id="s-b",
    )

    manifest, units = _read(db, _run(db, "t1_export"))

    sets = {u.annotation_set.annotation_set_id: u.annotation_set for u in units}
    assert sorted(sets) == [
        "proj:ann-0001:independent:s-new",
        "proj:ann-0002:assisted:s-b",
    ]
    independent = sets["proj:ann-0001:independent:s-new"]
    assert independent.set_kind == "individual"
    assert independent.blind is True
    assert independent.stage == "independent"
    assert independent.annotations[0].mentions[0].segments[0].start == 63
    assisted = sets["proj:ann-0002:assisted:s-b"]
    assert assisted.blind is False
    assert assisted.annotations[0].document_level is True
    assert manifest.bundle_id.startswith("proj-")


def test_review_submissions_export_adopted_and_edited_annotations(db: Database) -> None:
    first, second = _proposals(db)
    targets = [
        AnnotationRef(annotation_id=s.annotation.annotation_id, version=s.version)
        for s in (first, second)
    ]
    changed = _own(
        db,
        "ann-0003",
        "r1",
        (63, 76),
        {"assertion": "absent", "experiencer": "patient", "temporality": "current"},
    )
    decisions = [
        ReviewDecision(
            decision_id="d1",
            target=targets[0],
            outcome="confirmed",
            reviewer_id="ann-0003",
        ),
        ReviewDecision(
            decision_id="d2",
            target=targets[1],
            outcome="changed",
            replacement=AnnotationRef(annotation_id="r1", version=changed.version),
            reviewer_id="ann-0003",
        ),
    ]
    _submit(
        db,
        "ann-0003",
        "review",
        [changed],
        submission_id="s-r",
        decisions=decisions,
        targets=targets,
    )

    job = _run(db, "t1_export")
    _manifest, units = _read(db, job)

    (only,) = units
    methods = {
        a.annotation_id: (
            a.provenance.method,
            a.provenance.actor.actor_id,
            a.provenance.source_refs,
        )
        for a in only.annotation_set.annotations
    }
    assert methods[first.annotation.annotation_id] == (
        "adopted",
        "ann-0003",
        (first.annotation.annotation_id,),
    )
    assert methods["r1"] == ("edited", "ann-0003", (second.annotation.annotation_id,))
    assert only.annotation_set.blind is False
    # The imported default stays defaulted through adoption (resolved 2026-10-15).
    adopted = next(
        a
        for a in only.annotation_set.annotations
        if a.annotation_id == first.annotation.annotation_id
    )
    assert adopted.axes["experiencer"].basis == "defaulted"
    assert adopted.axes["assertion"].basis == "chosen"
    assert job.result is not None
    assert job.result["counts"]["rejected"] == 0


def test_only_consenting_contributors_are_named(db: Database) -> None:
    accounts = AccountService(db)
    for username, pseudonym in (("alice", "ann-0001"), ("bob", "ann-0002")):
        accounts.create_user(OPERATOR, username, username.title(), pseudonym=pseudonym)
    with db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.username == "alice")
            .values(orcid="0000-0002-1825-0097", orcid_consent=True)
        )
        conn.execute(
            update(UserRow)
            .where(UserRow.username == "bob")
            .values(orcid="0000-0001-5109-3700", orcid_consent=False)
        )
    full = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
    for annotator in ("ann-0001", "ann-0002"):
        _submit(
            db,
            annotator,
            "independent",
            [_own(db, annotator, f"{annotator}-1", (6, 19), full)],
            submission_id=f"s-{annotator}",
        )

    manifest, _units = _read(db, _run(db, "t1_export"))

    assert [c.model_dump() for c in manifest.contributors] == [
        {"actor_id": "ann-0001", "name": "Alice", "orcid": "0000-0002-1825-0097"}
    ]


def test_an_export_that_does_not_fit_the_profile_fails_with_codes(
    db: Database,
) -> None:
    profile = hpo_profile()
    axes = profile.layers[0].annotation_types[0].axes
    axes[2] = axes[2].model_copy(update={"options": [*axes[2].options, "future"]})
    snap = _own(db, "ann-0001", "a1", (6, 19), {"assertion": "present"})
    future = snap.annotation.model_copy(
        update={"axes_values": {"assertion": "present", "temporality": "future"}}
    )
    snap = snapshot(future, snap.evidence, _document(db), profile)
    _submit(db, "ann-0001", "independent", [snap], submission_id="s-f")

    job = _run(db, "t1_export")

    assert job.status == "failed"
    assert job.error is not None and "T1_INVALID" in job.error
    assert "temporality" in job.error


def test_an_export_outside_the_pinned_roots_fails_without_an_artifact(
    db: Database,
) -> None:
    original = _own(db, "ann-0001", "a1", None, {"assertion": "present"})
    outside = snapshot(
        original.annotation.model_copy(update={"term_id": "HP:0000001"}),
        original.evidence,
        _document(db),
        hpo_profile(),
    )
    _submit(db, "ann-0001", "independent", [outside], submission_id="s-outside")

    job = _run(db, "t1_export")

    assert job.status == "failed"
    assert job.error is not None and "T1_INVALID" in job.error
    assert "outside_allowed_roots" in job.error
    assert job.result is None
    with db.transaction() as conn:
        assert (
            conn.execute(
                select(AuditEventRow.id).where(AuditEventRow.action == "project.export")
            ).first()
            is None
        )


def test_an_export_without_submissions_fails(db: Database) -> None:
    job = _run(db, "t1_export")

    assert job.status == "failed"
    assert job.error is not None and "EXPORT_EMPTY" in job.error


def test_the_edit_log_is_pseudonymised(db: Database) -> None:
    full = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
    _submit(
        db,
        "ann-0002",
        "independent",
        [_own(db, "ann-0002", "a1", (6, 19), full)],
        submission_id="s-2",
    )
    _submit(
        db,
        "ann-0001",
        "assisted",
        [_own(db, "ann-0001", "a2", (6, 19), full)],
        submission_id="s-1",
    )

    job = _run(db, "edit_log_export")

    assert job.status == "succeeded", job.error
    assert job.result is not None
    lines = [
        json.loads(line)
        for line in db.blobs.get(job.result["sha256"]).decode("utf-8").splitlines()
    ]
    assert job.result["events"] == len(lines) == 4
    assert [line["event"] for line in lines] == sorted(line["event"] for line in lines)
    assert [line["annotator"] for line in lines] == ["ann-0002"] * 2 + ["ann-0001"] * 2
    assert [line["kind"] for line in lines] == ["edit", "submit"] * 2
    for line in lines:
        assert set(line) == {
            "event",
            "at",
            "document_id",
            "annotator",
            "mode",
            "kind",
            "revision_before",
            "revision_after",
            "command",
            "state",
            "submission_id",
        }
        assert line["at"].endswith("Z") and len(line["at"]) == 20
    assert lines[1]["submission_id"] == "s-2"


def test_exports_are_audited(db: Database) -> None:
    full = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
    _submit(
        db,
        "ann-0001",
        "independent",
        [_own(db, "ann-0001", "a1", (6, 19), full)],
        submission_id="s-1",
    )

    export = _run(db, "t1_export")
    log = _run(db, "edit_log_export")

    with db.transaction() as conn:
        rows = conn.execute(
            select(
                AuditEventRow.action, AuditEventRow.actor_label, AuditEventRow.details
            )
            .where(
                AuditEventRow.action.in_(["project.export", "project.edit_log_export"])
            )
            .order_by(AuditEventRow.id)
        ).all()
    assert [(r.action, r.actor_label) for r in rows] == [
        ("project.export", OPERATOR.label),
        ("project.edit_log_export", OPERATOR.label),
    ]
    assert export.result is not None and log.result is not None
    assert rows[0].details["sha256"] == export.result["sha256"]
    assert rows[0].details["units"] == 1
    assert rows[1].details["events"] == 2


def test_the_cli_refuses_to_overwrite(
    db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ONTOCURATOR_DATA_DIR", str(db.data_dir))
    url = database_url_for(tmp_path / "editor.db")
    full = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
    _submit(
        db,
        "ann-0001",
        "independent",
        [_own(db, "ann-0001", "a1", (6, 19), full)],
        submission_id="s-1",
    )

    def admin(*args: str) -> Any:
        return runner.invoke(app, ["admin", "--database-url", url, *args])

    out = tmp_path / "out.zip"
    first = admin("export", "proj", str(out))
    assert first.exit_code == 0, first.output
    assert "1 unit" in first.output
    with zipfile.ZipFile(out) as archive:
        assert "manifest.json" in archive.namelist()
    before = out.read_bytes()

    again = admin("export", "proj", str(out))
    assert again.exit_code == 1
    assert "OUTPUT_EXISTS" in again.output
    assert out.read_bytes() == before

    log = tmp_path / "log.jsonl"
    written = admin("export-edit-log", "proj", str(log))
    assert written.exit_code == 0, written.output
    assert len(log.read_text(encoding="utf-8").splitlines()) == 2
    assert admin("export-edit-log", "proj", str(log)).exit_code == 1


def test_only_leads_and_admins_export(db: Database) -> None:
    from ontocurator.authz.policy import Access
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.errors import AccessDenied

    annotator = ScopedRepository(
        db, Access(5, "ann-0005", False, roles={"proj": frozenset({"annotator"})})
    )
    for call in (annotator.t1_export_content, annotator.edit_log):
        with pytest.raises(AccessDenied) as error:
            call("proj")
        assert error.value.code == "NOT_ALLOWED"
    lead = ScopedRepository(
        db, Access(5, "ann-0005", False, roles={"proj": frozenset({"lead"})})
    )
    assert lead.edit_log("proj") == []


@pytest.mark.parametrize("note", [None, "Clinical review needed"])
def test_unresolved_bundle_includes_flag_and_historical_warning(db, note):
    target = _proposals(db)[1]
    ref = AnnotationRef(
        annotation_id=target.annotation.annotation_id, version=target.version
    )
    _submit(
        db,
        "ann-0003",
        "review",
        [],
        submission_id="s-unresolved",
        decisions=[
            ReviewDecision(
                decision_id="u",
                target=ref,
                outcome="uncertain",
                reviewer_id="ann-0003",
                note=note,
            )
        ],
        targets=[ref],
    )
    job = _run(db, "t1_export")
    _, [exported] = _read(db, job)
    [item] = exported.annotation_set.annotations
    assert item.review_resolution.note == note
    assert item.review_resolution.reviewer.actor_id == "ann-0003"
    assert item.axes["assertion"].value == target.annotation.axes_values["assertion"]
    assert job.result["counts"]["uncertain"] == 1
    assert job.result["warnings"] == (
        []
        if note
        else [
            {
                "code": "LEGACY_UNRESOLVED_NOTE_MISSING",
                "annotation_id": ref.annotation_id,
                "version": ref.version,
            }
        ]
    )


@pytest.mark.parametrize("invalid", ["unknown", "obsolete", "profile"])
def test_historical_unresolved_invalid_target_fails_without_artifact(db, invalid):
    from ontocurator.authz.scoped import ScopedRepository

    target = _proposals(db)[1]
    ref = AnnotationRef(
        annotation_id=target.annotation.annotation_id, version=target.version
    )
    _submit(
        db,
        "ann-0003",
        "review",
        [],
        submission_id="s-invalid",
        decisions=[
            ReviewDecision(
                decision_id="u",
                target=ref,
                outcome="uncertain",
                reviewer_id="ann-0003",
                note="Check",
            )
        ],
        targets=[ref],
    )
    # A historical exact target is resolved from immutable proposal storage.
    # Substitute content at the repository boundary without changing stored hashes.
    from unittest.mock import patch

    original = ScopedRepository.t1_export_content

    def content(repo, project):
        result = original(repo, project)
        if invalid == "profile":
            result.profile.layers[0].annotation_types[0].axes.append(
                AxisDefinition(
                    id="required-extra",
                    label="Extra",
                    options=["yes"],
                    allow_empty=False,
                )
            )
        else:
            changed = target.model_copy(
                update={
                    "annotation": target.annotation.model_copy(
                        update={
                            "term_id": "HP:9999999"
                            if invalid == "unknown"
                            else "HP:0000123"
                        }
                    )
                }
            )
            result.proposals[(ref.annotation_id, ref.version)] = changed
        return result

    with patch.object(ScopedRepository, "t1_export_content", content):
        job = _run(db, "t1_export")
    assert job.status == "failed", job.result
    assert job.result is None
    assert any(
        code in job.error
        for code in {"UNKNOWN_TERM", "OBSOLETE_TERM", "INCOMPLETE_AXES"}
    )
