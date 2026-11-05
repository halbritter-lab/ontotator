"""Imported tool sets without any finding (``empty_proposal_sets``, #321).

The import keeps no proposal set for a unit whose tool set is empty, but it
records that the tool ran on the text: the recall in proposals.csv counts
the text for that tool. A newer empty set never becomes the newest proposal
set of a text.
"""

from __future__ import annotations

from pathlib import Path

from pg_harness import database_for
from sqlalchemy import func, select
from t1_fixtures import TOOL, annotation, bundle, create_project, run_import, unit

from ontotator.exchange.proposal_checks import proposal_set_chances
from ontotator.storage.proposal_queries import (
    newest_proposal_refs,
    newest_proposal_set,
)
from ontotator.storage.repository import Repository
from ontotator.storage.tables import (
    DocumentRow,
    EmptyProposalSetRow,
    ProposalSetRow,
)

TAGGER = ("phentrieve", TOOL["version"])
OTHER = {"actor_id": "other", "kind": "tool", "name": "other-tool", "version": "2"}


def _pid(db) -> int:  # type: ignore[no-untyped-def]
    with db.transaction() as conn:
        pid = Repository._project_id(conn, "proj")
    assert pid is not None
    return pid


def _count(db, table) -> int:  # type: ignore[no-untyped-def]
    with db.transaction() as conn:
        return int(conn.execute(select(func.count()).select_from(table)).scalar_one())


def _single_tool_bundle(tmp_path: Path, name: str = "a.zip", bundle_id: str = "b-1"):
    """One tool's run: proposals on EN100017, nothing on EN100024."""
    units = [unit("EN100017"), unit("EN100024", annotations=[])]
    return bundle(tmp_path / name, units, bundle_id)


def test_a_silent_unit_of_a_single_tool_bundle_counts_for_the_tool(
    tmp_path: Path,
) -> None:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    assert run_import(db, _single_tool_bundle(tmp_path)).status == "succeeded"
    pid = _pid(db)

    with db.transaction() as conn:
        stored = conn.execute(
            select(
                EmptyProposalSetRow.document_id,
                EmptyProposalSetRow.bundle_id,
                EmptyProposalSetRow.annotation_set_id,
                EmptyProposalSetRow.set_kind,
                EmptyProposalSetRow.actors,
            )
        ).all()
        # The silent text is still imported documents-only: no proposal set.
        with_sets = set(conn.execute(select(ProposalSetRow.document_id)).scalars())
        chances = proposal_set_chances(conn, pid, ["EN100017", "EN100024"])
    assert [tuple(r) for r in stored] == [
        ("EN100024", "b-1", "run-7-EN100024", "tool_output", [TOOL])
    ]
    assert with_sets == {"EN100017"}
    assert chances == {TAGGER: {"EN100017": True, "EN100024": False}}


def test_a_reimport_records_the_silent_set_once(tmp_path: Path) -> None:
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    path = _single_tool_bundle(tmp_path)
    assert run_import(db, path).status == "succeeded"
    again = run_import(db, path)
    assert again.status == "succeeded", again.error

    assert _count(db, EmptyProposalSetRow) == 1
    assert _count(db, ProposalSetRow) == 1
    with db.transaction() as conn:
        chances = proposal_set_chances(conn, _pid(db), ["EN100017", "EN100024"])
    assert chances == {TAGGER: {"EN100017": True, "EN100024": False}}


def test_an_empty_set_of_a_person_is_no_tool_run(tmp_path: Path) -> None:
    """Only a set an import would take with findings (a tool set) counts."""
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    person = {"actor_id": "p1", "kind": "human"}
    units = [
        unit("EN100017", annotations=[], actors=[person]),
        unit("EN100024", annotations=[], set_kind="adjudicated", actors=[TOOL]),
    ]
    assert run_import(db, bundle(tmp_path / "a.zip", units)).status == "succeeded"

    assert _count(db, EmptyProposalSetRow) == 0


def test_a_newer_empty_set_leaves_the_newest_proposal_set(tmp_path: Path) -> None:
    """A later run of the tool that found nothing on EN100017 is recorded,
    but rounds keep the proposals of the newest set with findings; a later
    set with findings still replaces it."""
    db = database_for(tmp_path / "editor.db")
    create_project(db)
    assert run_import(db, _single_tool_bundle(tmp_path)).status == "succeeded"
    silent = bundle(tmp_path / "b.zip", [unit("EN100017", annotations=[])], "b-2")
    assert run_import(db, silent).status == "succeeded"
    pid = _pid(db)

    with db.transaction() as conn:
        newest = newest_proposal_set(conn, pid, "EN100017")
        refs = newest_proposal_refs(conn, pid, "EN100017")
        chances = proposal_set_chances(conn, pid, ["EN100017"])
    assert newest is not None and newest.annotation_set_id == "run-7-EN100017"
    assert [r.annotation_id for r in refs] == [
        "urn:ontospan:b-1:run-7-EN100017:p1",
        "urn:ontospan:b-1:run-7-EN100017:p2",
    ]
    # It proposed on the text in one of its sets.
    assert chances == {TAGGER: {"EN100017": True}}

    later = unit("EN100017", set_id="set-c", annotations=[annotation("p3", (63, 76))])
    assert run_import(db, bundle(tmp_path / "c.zip", [later], "b-3")).status == (
        "succeeded"
    )
    with db.transaction() as conn:
        newest = newest_proposal_set(conn, pid, "EN100017")
        refs = newest_proposal_refs(conn, pid, "EN100017")
    assert newest is not None and newest.annotation_set_id == "set-c"
    assert [r.annotation_id for r in refs] == ["urn:ontospan:b-3:set-c:p3"]


def test_a_silent_set_of_an_earlier_version_counts_for_its_correction(
    tmp_path: Path,
) -> None:
    from t1_builders import bundle as variant_bundle
    from t1_builders import correction_unit, native_unit

    db = database_for(tmp_path / "editor.db")
    create_project(db)
    first = native_unit("c2-en", "en", "Seizures since birth.", case_id="c2")
    corrected = correction_unit(first, "Seizures since the first week.")
    corrected = corrected.model_copy(
        update={
            "annotation_set": corrected.annotation_set.model_copy(
                update={"actors": [OTHER]}
            )
        }
    )
    assert run_import(db, variant_bundle(tmp_path, [first, corrected])).status == (
        "succeeded"
    )
    pid = _pid(db)
    with db.transaction() as conn:
        [new_id] = conn.execute(
            select(DocumentRow.document_id).where(DocumentRow.origin == "correction")
        ).scalars()
        chances = proposal_set_chances(conn, pid, [new_id])
    assert new_id != "c2-en"
    assert chances == {
        ("test-tool", "1"): {new_id: False},
        ("other-tool", "2"): {new_id: False},
    }
