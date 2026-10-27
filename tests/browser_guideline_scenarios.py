"""Project guideline browser scenarios (spec "Testing > Browser (Playwright)").

``POST /__test_guidelines__?scenario=EMPTY`` builds a fresh project
``guide-{scenario}-{uuid8}`` through the real services (one import,
``WorkPlanService``, batch assignment, ``GuidelineService``) and returns the
lead scenario identities plus::

    {assignments: {name: assignment_id}, files: {name: absolute path}}

``files`` are guideline files in a fresh temp directory for
``page.setInputFiles``. Each call builds its own project, so specs never share
state. Test server only, never shipped.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

from browser_documents_scenarios import Builder, Scenario, identity
from browser_lead_workflow_scenarios import (
    OFF,
    ON,
    batch_assign,
    import_units,
    person,
    plan,
    result,
)
from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import update

from ontotator.storage.tables import ProjectRow

ANNOTATE_CASES = ("guide-0001", "guide-0002")
REVIEW_CASE = ANNOTATE_CASES[0]
TEXTS = {
    "guide-0001": "The patient has a seizure and hypotonia.",
    "guide-0002": "The child shows global developmental delay.",
}
DE_TEXT = "Der Patient hat einen Krampfanfall und eine Hypotonie."
FIRST_NOTE = "First version"

V1 = """# Annotation guideline

Annotate every phenotype the text states about the patient.

## Assertions

| Assertion | When |
| --- | --- |
| present | The text states the finding. |
| absent | The text rules the finding out. |

<script>alert("guideline")</script>

Read the [HPO browser](javascript:alert(1)) before you start.

![Example span](https://example.org/span.png)
"""
V2 = """# Annotation guideline

Version 2: also annotate family history findings with experiencer "family".
"""
# Over the 256 KiB upload limit.
BIG = "This guideline line repeats to exceed the size limit.\n" * 6000
BAD_PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n"


def guide_project(app: FastAPI, name: str) -> Scenario:
    """A fresh project ``guide-{name}-{uuid8}`` with the lead, Ana and Ben."""
    from t1_fixtures import create_project

    key = f"guide-{name.lower().replace('_', '-')}-{uuid4().hex[:8]}"
    create_project(app.state.repo.db, key)
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(import_plan="nothing", annotate_accepted_translations_only=False)
        )
    scenario = Scenario(app, key, {})
    person(scenario, "lead", ["lead"])
    # Translation reviews need a qualification.
    person(scenario, "ana", ["annotator"], qualification="Physician")
    person(scenario, "ben", ["annotator"], qualification="Physician")
    return scenario


def write_files(scenario: Scenario) -> dict[str, str]:
    """The guideline files in a fresh temp directory (kept for the upload)."""
    folder = Path(tempfile.mkdtemp(prefix=f"{scenario.key}-"))
    contents: dict[str, bytes] = {
        "v1.md": V1.encode("utf-8"),
        "v2.md": V2.encode("utf-8"),
        "big.txt": BIG.encode("utf-8"),
        "bad.pdf": BAD_PDF,
    }
    files: dict[str, str] = {}
    for name, data in contents.items():
        path = folder / name
        path.write_bytes(data)
        files[name] = str(path.resolve())
    return files


def build_empty_project(app: FastAPI, name: str) -> tuple[Scenario, dict[str, Any]]:
    """Two native en texts annotated by Ana, one de translation reviewed by Ben."""
    from t1_builders import native_unit, translation_unit

    scenario = guide_project(app, name)
    sources = {
        case: native_unit(case, "en", text, case_id=case)
        for case, text in TEXTS.items()
    }
    units = [
        *sources.values(),
        translation_unit(REVIEW_CASE, "de", DE_TEXT, source=sources[REVIEW_CASE]),
    ]
    import_units(scenario, units)
    plan(scenario, ANNOTATE_CASES, {"source": {"annotate": ON}})
    plan(scenario, [REVIEW_CASE], {"de": {"review": ON, "annotate": OFF}})
    annotate = batch_assign(scenario, ANNOTATE_CASES, "en", "annotate", ["ana"])
    by_case = {item.document_id.split("~")[0]: item.id for item in annotate}
    (review,) = batch_assign(
        scenario, [REVIEW_CASE], "de", "translation_review", ["ben"]
    )
    assignments = {
        f"annotate-{index}": by_case[case]
        for index, case in enumerate(ANNOTATE_CASES, start=1)
    }
    assignments["review-de"] = review.id
    rows = [(case, "en") for case in ANNOTATE_CASES] + [(REVIEW_CASE, "de")]
    return scenario, result(
        scenario, rows, assignments=assignments, files=write_files(scenario)
    )


def build_empty(app: FastAPI) -> dict[str, Any]:
    """Tasks for Ana and Ben, no guideline yet."""
    _scenario, built = build_empty_project(app, "EMPTY")
    return built


def build_published(app: FastAPI) -> dict[str, Any]:
    """As ``EMPTY`` plus v1 published by the lead; Ana and Ben have not seen it."""
    from ontotator.application.guidelines import GuidelineService

    scenario, built = build_empty_project(app, "PUBLISHED")
    _access, actor = identity(scenario, "lead")
    GuidelineService(scenario.db).upload(
        actor,
        scenario.key,
        filename="v1.md",
        data=Path(built["files"]["v1.md"]).read_bytes(),
        change_note=FIRST_NOTE,
        expected_latest_version=None,
    )
    return built


BUILDERS: dict[str, Builder] = {
    "EMPTY": build_empty,
    "PUBLISHED": build_published,
}


def register_guideline_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_guidelines__`` ahead of the static frontend."""

    @app.post("/__test_guidelines__")
    def guideline_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = BUILDERS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown guideline scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
