"""Text-change and source-change steps in the Documents read model (plan O2a).

Spec V5, VD14, VD22: old-version work, its resolutions and unreviewed source
changes become steps and stage cells. Each test builds its own project
through the real services (``test_text_change_service`` for a German source
text v1 with its correction v2, the Documents scenario helpers for
translations).
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from browser_carry_fixture import CORRECTED_DE, TEXT_DE
from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Scenario,
    accept_translation,
    add_user,
    identity,
    import_texts,
    in_progress,
    new_project,
    select,
    submit,
)
from browser_documents_scenarios_rows import review_translation
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import insert, update
from sqlalchemy import select as sa_select
from test_text_change_service import (
    CASE,
    THIRD_DE,
    Env,
    _carry,
    _env,
    _move,
    _resolve,
    _started,
    _submitted,
)

from ontocurator.api.app import create_app
from ontocurator.application.document_rows import DocumentRowsService, RowQuery
from ontocurator.config import AppConfig
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.tables import ProjectRow


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Any]:
    # One database per test; the job worker runs the corrections' children.
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "text-change-steps.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    with TestClient(application):
        yield application


@pytest.fixture
def env(app: Any) -> Env:
    return _env(app)


def _rows(scenario: Scenario) -> dict[tuple[str, str], dict[str, Any]]:
    access, actor = identity(scenario, "lead")
    page = DocumentRowsService(scenario.db, actor, access).page(
        scenario.key, RowQuery()
    )
    return {
        (row["case_id"], row["language"]): row
        for group in page["groups"]
        for row in group["rows"]
    }


def _row(env: Env) -> dict[str, Any]:
    return _rows(env.scenario)[(CASE, "de")]


def _codes(row: dict[str, Any]) -> list[str]:
    return [step["code"] for step in row["steps"]]


def _cell(row: dict[str, Any], name: str) -> tuple[str, str]:
    cell = row["stages"][name]
    return cell["state"], cell["tone"]


# --- Rule 3a / 3b on a source text v1 -> v2 ---------------------------------- #


def test_open_v1_annotation_after_correction_shows_handle_text_change(env):
    work = _started(env)
    row = _row(env)
    assert _codes(row)[0] == "handle_text_change"
    assert "assign_annotation" not in _codes(row)
    step = row["steps"][0]
    assert (step["kind"], step["action"], step["badges"]) == (
        "decision",
        "handle_text_change",
        ["your_decision"],
    )
    assert step["assignment_id"] == work["assignment_id"]
    assert step["submission_id"] is None
    # The step targets v2; its detail names the old version.
    assert step["document_id"] == env.docs[1]
    assert step["detail"]["version"] == 1
    assert step["owner"]["kind"] == "you"
    assert _cell(row, "annotation") == ("old_text_open", "decision")
    detail = row["stages"]["annotation"]["detail"]
    assert (detail["from_version"], detail["version"]) == (1, 2)
    assert [p["pseudonym"] for p in detail["people"]] == [
        row["work"][0]["author_label"]
    ]


def test_submitted_v1_shows_carry_text_change(env):
    work = _submitted(env)
    row = _row(env)
    assert _codes(row) == ["carry_text_change"]
    step = row["steps"][0]
    assert step["submission_id"] == work["submission_id"]
    assert step["assignment_id"] == work["assignment_id"]
    assert step["document_id"] == env.docs[1]
    assert _cell(row, "annotation") == ("old_text_submitted", "decision")
    assert row["stages"]["annotation"]["detail"]["note"] == "v2_not_annotated"
    # Tom's v1 submission is not eligible for v2 (Final waits).
    assert _cell(row, "final") == ("after_annotation", "waiting")


def test_moved_work_item_reads_moved_to_version(env):
    work = _started(env)
    moved = _move(env, work["assignment_id"])
    row = _row(env)
    assert "handle_text_change" not in _codes(row)
    assert [item["assignment_id"] for item in row["work"]] == [moved.assignment_id]
    assert row["work"][0]["moved_to_version"] is None
    (old,) = row["moved_work"]
    assert (old["assignment_id"], old["version"], old["moved_to_version"]) == (
        work["assignment_id"],
        1,
        2,
    )
    assert _cell(row, "annotation") == ("in_progress", "running")


def test_old_open_and_old_submitted_on_one_row(env):
    # Scenario 14 order: the open item first, then the submitted one; both
    # people wait, so "Assign annotation" never appears (VD22).
    submitted = _submitted(env, "ana")
    started = _started(env, "tom")
    row = _row(env)
    lead = [s for s in row["steps"] if s["kind"] == "decision"]
    assert [(s["code"], s["assignment_id"]) for s in lead] == [
        ("handle_text_change", started["assignment_id"]),
        ("carry_text_change", submitted["assignment_id"]),
    ]
    assert lead[1]["submission_id"] == submitted["submission_id"]
    assert "assign_annotation" not in _codes(row)
    assert _cell(row, "annotation") == ("old_text_open", "decision")


def test_v1_to_v3_targets_v3(app):
    env = _env(app, [TEXT_DE, CORRECTED_DE, THIRD_DE])
    work = _started(env)
    row = _row(env)
    step = row["steps"][0]
    assert (step["code"], step["assignment_id"]) == (
        "handle_text_change",
        work["assignment_id"],
    )
    assert step["document_id"] == env.docs[2]
    detail = row["stages"]["annotation"]["detail"]
    assert (detail["from_version"], detail["version"]) == (1, 3)


def test_resolution_rows_suppress_steps(env):
    # moved: covered by test_moved_work_item_reads_moved_to_version.
    # carried: the author continues on v2, nothing waits.
    carried = _submitted(env, "ana")
    _carry(env, carried["submission_id"])
    row = _row(env)
    assert "carry_text_change" not in _codes(row)
    assert "assign_annotation" not in _codes(row)
    # dismissed: the lead assigns v2 anew.
    dismissed = _submitted(env, "tom")
    _carry(env, dismissed["submission_id"], mode="dismiss")
    row = _row(env)
    assert "carry_text_change" not in _codes(row)
    # Ana works on v2 now; Tom's dismissed v1 work no longer waits.
    assert _cell(row, "annotation") == ("in_progress", "running")
    assert "assign_annotation" not in _codes(row)


def test_dismissed_submission_frees_the_slot(env):
    work = _submitted(env)
    assert "assign_annotation" not in _codes(_row(env))
    _carry(env, work["submission_id"], mode="dismiss")
    assert _codes(_row(env)) == ["assign_annotation"]


def test_finish_then_carry_shows_finishing_on_old(env):
    work = _started(env)
    _resolve(env, work["assignment_id"], "finish_then_carry")
    row = _row(env)
    assert _codes(row) == ["annotation_in_progress"]
    assert _cell(row, "annotation") == ("finishing_on_old", "running")
    detail = row["stages"]["annotation"]["detail"]
    assert detail["note"] == "carried_on_submit"
    # Withdrawn: revoked, v2 needs a new annotation.
    other = _started(env, "ana")
    _resolve(env, other["assignment_id"], "withdrawn")
    assert "handle_text_change" not in _codes(_row(env))


# --- Translations: rejected / waiting corrections, discarded roots ---------- #


def _translation(
    app: Any, name: str, corrections: int = 1
) -> tuple[Scenario, list[str]]:
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, name)
    source = native_unit(CASE, "en", SYNTHETIC, case_id=CASE)
    current = translation_unit(CASE, "de", SYNTHETIC_DE, source=source)
    units = [source, current]
    for version in range(2, corrections + 2):
        current = correction_unit(current, f"{SYNTHETIC_DE} Korrektur {version}.")
        units.append(current)
    docs = import_texts(scenario, units)
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "tom", ["annotator"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    return scenario, [docs[(CASE, "de", v)] for v in range(1, corrections + 2)]


def test_correction_rejected_is_no_text_change(app):
    scenario, docs = _translation(app, "rejected")
    accept_translation(scenario, docs[0], "translator")
    review_translation(scenario, docs[1], "translator", "rejected")
    in_progress(scenario, docs[0], "tom")
    row = _rows(scenario)[(CASE, "de")]
    assert "handle_text_change" not in _codes(row)
    assert "resolve_rejected" in _codes(row)
    assert row["stages"]["annotation"]["state"] not in (
        "old_text_open",
        "old_text_submitted",
    )
    assert _cell(row, "review") == ("rejected", "rejected")


def test_correction_not_yet_acceptable_has_no_step_and_note(app):
    scenario, docs = _translation(app, "waiting")
    accept_translation(scenario, docs[0], "translator")
    in_progress(scenario, docs[0], "tom")
    with scenario.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(annotate_accepted_translations_only=True)
        )
    row = _rows(scenario)[(CASE, "de")]
    assert row["versions"][-1]["translation_status"] == "ready_for_review"
    assert "handle_text_change" not in _codes(row)
    assert "assign_annotation" not in _codes(row)
    annotation = row["stages"]["annotation"]
    assert annotation["state"] not in ("old_text_open", "old_text_submitted")
    assert annotation["detail"]["note"] == "text_change_waiting"


def test_discarded_root_work_is_ignored(app):
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, "discarded")
    source = native_unit(CASE, "en", SYNTHETIC, case_id=CASE)
    kept = translation_unit(
        f"{CASE}-a", "de", SYNTHETIC_DE, source=source, provider="A", run_id="a"
    )
    dropped = translation_unit(
        f"{CASE}-b",
        "de",
        f"{SYNTHETIC_DE} (b)",
        source=source,
        provider="B",
        run_id="b",
    )
    dropped_v2 = correction_unit(dropped, f"{SYNTHETIC_DE} (b) Korrektur.")
    docs = import_texts(scenario, [source, kept, dropped, dropped_v2])
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "tom", ["annotator"])
    in_progress(scenario, docs[(f"{CASE}-b", "de", 1)], "tom")
    lead, _actor = identity(scenario, "lead")
    with scenario.db.transaction() as conn:
        pid = conn.execute(
            sa_select(ProjectRow.id).where(ProjectRow.project_key == scenario.key)
        ).scalar_one()
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=pid,
                document_id=docs[(f"{CASE}-b", "de", 1)],
                reason="test",
                discarded_by=lead.user_id,
            )
        )
    row = _rows(scenario)[(CASE, "de")]
    assert "handle_text_change" not in _codes(row)
    assert row["stages"]["annotation"]["state"] != "old_text_open"


# --- Rule 6a: source changed ------------------------------------------------- #


def _source_changed(app: Any, name: str) -> tuple[Scenario, dict[str, str]]:
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, name)
    source = native_unit(CASE, "en", SYNTHETIC, case_id=CASE)
    translated = translation_unit(CASE, "de", SYNTHETIC_DE, source=source)
    changed = correction_unit(source, f"{SYNTHETIC} She also has a rash.")
    docs = import_texts(scenario, [source, translated, changed])
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "tom", ["annotator"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    return scenario, {
        "en1": docs[(CASE, "en", 1)],
        "en2": docs[(CASE, "en", 2)],
        "de": docs[(CASE, "de", 1)],
    }


def test_source_change_gives_review_source_change_on_translations(app):
    scenario, docs = _source_changed(app, "source")
    accept_translation(scenario, docs["de"], "translator")
    work = submit(scenario, docs["de"], "tom")
    select(scenario, docs["de"], work["submission_id"])
    rows = _rows(scenario)
    row = rows[(CASE, "de")]
    (step,) = [s for s in row["steps"] if s["code"] == "review_source_change"]
    assert (step["kind"], step["action"], step["badges"]) == (
        "assign",
        "assign_source_review",
        ["source_changed"],
    )
    assert step["document_id"] == docs["de"]
    assert _cell(row, "review") == ("source_changed", "decision")
    assert row["stages"]["review"]["detail"]["from_version"] == 1
    # Scenario 15: a final may be outdated; its action sits in Review.
    assert _cell(row, "final") == ("may_be_outdated", "waiting")
    # The source row itself has no translation review.
    assert "review_source_change" not in _codes(rows[(CASE, "en")])


def test_source_change_issue_only_with_review_applicable(app):
    # No final and no work on the translation: the obligation still shows.
    scenario, docs = _source_changed(app, "issue")
    rows = _rows(scenario)
    row = rows[(CASE, "de")]
    issues = [i for i in row["issues"] if i["code"] == "SOURCE_UPDATE_UNREVIEWED"]
    assert [(i["category"], i["document_id"]) for i in issues] == [
        ("translation", docs["de"])
    ]
    assert not [n for n in row["notes"] if n["code"] == "SOURCE_UPDATE_UNREVIEWED"]
    assert "translation" in row["categories"]
    assert "review_source_change" in _codes(row)
    source = rows[(CASE, "en")]
    assert not [
        i
        for i in source["issues"] + source["notes"]
        if i["code"] == "SOURCE_UPDATE_UNREVIEWED"
    ]
