"""Explicit source Annotate on a translated case (spec D11, D16).

"Source annotated only when the text has no translation" is the import
default only. Once the lead turns the source's Annotate on, the source row is
in the plan everywhere: assignment eligibility, the next step and the Documents
row (no "en not in plan" line).
"""

from __future__ import annotations

from auth_harness import grant, logged_in
from document_rows_support import rows_of
from t1_builders import bundle, native_unit, translation_unit
from t1_fixtures import TEXT, create_project, run_import
from test_auth_api import _app
from work_plan_support import BASE, _user

CASE = "Case EN /7 #é"
SOURCE = "Dose /5 %é"


def _assign(lead, document_id: str) -> dict:
    response = lead.post(
        f"{BASE}/assignments",
        json={
            "task": "annotate",
            "rows": [{"document_id": document_id, "username": "anno"}],
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def _source_row(lead, **params: str) -> tuple[dict | None, list[str]]:
    page = lead.get(f"{BASE}/document-rows", params=params)
    assert page.status_code == 200, page.text
    groups = [g for g in page.json()["groups"] if g["case_id"] == CASE]
    hidden = groups[0]["not_in_plan_languages"] if groups else []
    return rows_of(page.json()).get((CASE, "en")), hidden


def test_explicit_source_annotate_on_a_translated_case_is_in_plan(tmp_path):
    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    source = native_unit(SOURCE, "en", f"{TEXT} en", case_id=CASE)
    units = [
        source,
        translation_unit(SOURCE, "de", f"{TEXT} de", source=source),
        translation_unit("Alternative /run", "de", f"{TEXT} de 2", source=source),
    ]
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    _user(app, "anno", "Anne Notator")
    assert grant(app, "anno", "proj", ["annotator"])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])

    # Import default: the translated case's source is not in the plan.
    row, hidden = _source_row(lead)
    assert row is not None and row["in_plan"] is False and hidden == ["en"]
    refused = _assign(lead, SOURCE)
    assert [r["code"] for r in refused["refused"]] == ["NOT_IN_WORK_PLAN"]

    saved = lead.put(
        f"{BASE}/work-plans/bulk",
        json={"case_ids": [CASE], "languages": {"source": {"annotate": "on"}}},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["changed_rows"] == 1

    # Explicit on wins over the default in every view.
    row, hidden = _source_row(lead)
    assert row is not None and row["in_plan"] is True and hidden == []
    assert row["next_step"]["code"] == "assign_annotation"
    created = _assign(lead, SOURCE)
    assert created["refused"] == [] and len(created["created"]) == 1
    row, hidden = _source_row(lead)
    assert row is not None and row["in_plan"] is True and hidden == []
    assert row["next_step"]["code"] == "annotation_in_progress"
    annotate_only, _ = _source_row(lead, plan="annotate")
    assert annotate_only is not None and annotate_only["in_plan"] is True

    # A repeated identical bulk request changes nothing and keeps the row in.
    again = lead.put(
        f"{BASE}/work-plans/bulk",
        json={"case_ids": [CASE], "languages": {"source": {"annotate": "on"}}},
    )
    assert again.status_code == 200 and again.json()["changed_rows"] == 0
    row, hidden = _source_row(lead)
    assert row is not None and row["in_plan"] is True and hidden == []
