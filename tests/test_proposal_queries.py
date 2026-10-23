"""The newest tool proposal set of a document (spec 2026-10-23 §1 Targets)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from auth_harness import logged_in
from pg_harness import database_for
from sqlalchemy import update
from t1_fixtures import annotation, bundle, create_project, run_import, unit
from test_auth_api import _app
from test_reanchor_resolutions import from_proposals
from test_reviews import _setup_review_test_env

from ontocurator.authz.policy import Access
from ontocurator.authz.versions import may_read_proposals
from ontocurator.storage.proposal_queries import (
    newest_proposal_counts,
    newest_proposal_refs,
    newest_proposal_set,
)
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import ProposalAnnotationRow

OTHER_TEXT = "Kleinwuchs und Krampfanfälle seit der Geburt."


def _pid(db, key: str) -> int:  # type: ignore[no-untyped-def]
    with db.transaction() as conn:
        pid = Repository._project_id(conn, key)
    assert pid is not None
    return pid


def test_newest_set_wins(tmp_path: Path) -> None:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    first = unit("EN100017", set_id="set-a")
    second = unit("EN100017", set_id="set-b", annotations=[annotation("p3", (63, 76))])
    assert (
        run_import(db, bundle(tmp_path / "a.zip", [first], "b-1")).status == "succeeded"
    )
    assert (
        run_import(db, bundle(tmp_path / "b.zip", [second], "b-2")).status
        == "succeeded"
    )
    pid = _pid(db, "proj")

    with db.transaction() as conn:
        refs = newest_proposal_refs(conn, pid, "EN100017")
        counts = newest_proposal_counts(conn, pid)
        newest = newest_proposal_set(conn, pid, "EN100017")

    assert [r.annotation_id for r in refs] == ["urn:ontospan:b-2:set-b:p3"]
    assert counts == {"EN100017": 1}
    assert newest is not None and newest.annotation_set_id == "set-b"
    assert newest.id is not None


def test_seed_proposals_without_a_set_form_one_set(tmp_path: Path) -> None:
    ctx = _setup_review_test_env(tmp_path)
    repo = ctx["repo"]
    pid = _pid(repo.db, "pkg-rev-1")

    with repo.db.transaction() as conn:
        refs = newest_proposal_refs(conn, pid, "doc-1")
        counts = newest_proposal_counts(conn, pid)
        newest = newest_proposal_set(conn, pid, "doc-1")

    every = repo.list_annotations_for_document("pkg-rev-1", "doc-1")
    assert [(r.annotation_id, r.version) for r in refs] == [
        (s.annotation.annotation_id, s.version) for s in every
    ]
    assert counts == {"doc-1": len(every)} and len(every) == 3
    assert newest is not None and newest.id is None and newest.annotation_set_id is None


def test_documents_without_proposals_are_absent_from_the_counts(tmp_path: Path) -> None:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    units = [unit("EN100017"), unit("EN100018", text=OTHER_TEXT, annotations=[])]
    assert run_import(db, bundle(tmp_path / "b.zip", units)).status == "succeeded"
    pid = _pid(db, "proj")

    with db.transaction() as conn:
        counts = newest_proposal_counts(conn, pid)
        refs = newest_proposal_refs(conn, pid, "EN100018")
        newest = newest_proposal_set(conn, pid, "EN100018")

    assert counts == {"EN100017": 2}
    assert refs == [] and newest is None


@pytest.fixture
def checker(tmp_path: Path) -> SimpleNamespace:
    """A T1 set on EN100017 and an annotator with a scratch annotate assignment."""
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    item = unit("EN100017", set_id="set-a")
    assert run_import(db, bundle(tmp_path / "a.zip", [item])).status == "succeeded"
    client = logged_in(
        app,
        "checker",
        projects={"proj": ["annotator"]},
        assignments=[("proj", "EN100017", "annotate")],
    )
    user = app.state.accounts.get_by_username("checker")
    access = Access(user.id, user.pseudonym, False, {"proj": frozenset({"annotator"})})
    return SimpleNamespace(app=app, db=db, client=client, access=access)


def test_seed_rows_drop_out_next_to_a_real_set(tmp_path: Path) -> None:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    item = unit("EN100017", set_id="set-a")
    assert run_import(db, bundle(tmp_path / "a.zip", [item])).status == "succeeded"
    pid = _pid(db, "proj")
    with db.transaction() as conn:
        everything = newest_proposal_refs(conn, pid, "EN100017")
        assert len(everything) == 2
        seed = everything[0]
        conn.execute(
            update(ProposalAnnotationRow)
            .where(
                ProposalAnnotationRow.project_id == pid,
                ProposalAnnotationRow.annotation_id == seed.annotation_id,
            )
            .values(proposal_set_id=None)
        )
        refs = newest_proposal_refs(conn, pid, "EN100017")
        counts = newest_proposal_counts(conn, pid)
        newest = newest_proposal_set(conn, pid, "EN100017")

    assert refs == everything[1:]
    assert counts == {"EN100017": 1}
    assert newest is not None and newest.annotation_set_id == "set-a"


def test_may_read_proposals_denies_an_annotator_from_scratch(checker) -> None:
    pid = _pid(checker.db, "proj")
    with checker.db.transaction() as conn:
        assert not may_read_proposals(conn, checker.access, pid, "proj", "EN100017")
    from_proposals(checker.db)
    with checker.db.transaction() as conn:
        assert may_read_proposals(conn, checker.access, pid, "proj", "EN100017")
