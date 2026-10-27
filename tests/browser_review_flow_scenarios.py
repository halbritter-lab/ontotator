"""Review flow and annotation loop browser scenarios.

``POST /__test_review_flow__?scenario=REVIEW_FLOW`` builds a fresh project
``lead-{scenario}-{uuid8}`` through the real services (the lead workflow
helpers: one import, ``WorkPlanService``, batch assignment) and returns the
lead scenario identities plus::

    {assignments: {name: assignment_id}, texts: {name: text}}

Test server only, never shipped.
"""

from __future__ import annotations

from typing import Any

from browser_documents_scenarios import Builder
from browser_lead_workflow_scenarios import (
    OFF,
    ON,
    REVIEW_AND_ANNOTATE,
    all_rows,
    batch_assign,
    import_units,
    lead_project,
    plan,
    result,
)
from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import update

from ontotator.auth.audit import Actor
from ontotator.storage.tables import ProjectRow

REVIEW_CASES = ("failed-translation", "second-translation")
SOURCE_TEXT = "\n\n".join(
    f"Paragraph {index + 1}. Dose 5 mg. "
    + "The patient describes symptoms and the clinician checks each detail. " * 18
    for index in range(14)
)
TARGET_TEXT = "\n\n".join(
    f"Absatz {index + 1}. Dosis 5 mg. "
    + "Die Patientin beschreibt Symptome und die Ärztin prüft jede Angabe. " * 18
    for index in range(14)
)
LOOP_TEXTS = {
    "loop-en": ("en", "The patient has a seizure and hypotonia."),
    "loop-de": ("de", "Der Patient hat einen Krampfanfall."),
    "loop-fr": ("fr", "Le patient a une crise."),
}
CREATION_DEFAULTS = {
    "hpo": {
        "phenotype": {
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        }
    }
}
TRANSLATION_FILE = "hp-de.babelon.tsv"


def build_review_flow(app: FastAPI) -> dict[str, Any]:
    """Rule on; two cases (en source, de machine translation) planned review +
    annotate. ``failed-translation`` has ``units_added`` failed; the reviews of
    both de texts go to Ana in this order."""
    from t1_builders import native_unit, translation_unit

    scenario = lead_project(app, "REVIEW_FLOW", rule_on=True)
    failing = (("units_added", False), ("numbers_changed", True))
    passing = (("units_added", True), ("numbers_changed", True))
    units: list[Any] = []
    for case, checks in zip(REVIEW_CASES, (failing, passing), strict=True):
        source = native_unit(case, "en", SOURCE_TEXT, case_id=case)
        units += [
            source,
            translation_unit(case, "de", TARGET_TEXT, source=source, checks=checks),
        ]
    import_units(scenario, units)
    plan(scenario, REVIEW_CASES, {"de": REVIEW_AND_ANNOTATE})
    assignments = {
        case: batch_assign(scenario, [case], "de", "translation_review", ["ana"])[0].id
        for case in REVIEW_CASES
    }
    return result(
        scenario,
        all_rows(REVIEW_CASES, ("de",)),
        assignments=assignments,
        texts={"source": SOURCE_TEXT, **dict.fromkeys(REVIEW_CASES, TARGET_TEXT)},
    )


def build_annotation_loop(app: FastAPI) -> dict[str, Any]:
    """Rule off; creation defaults for hpo/phenotype; German HPO names loaded;
    three native texts (en, de, fr) planned annotate and assigned to the
    annotator."""
    from browser_server import ROOT
    from t1_builders import native_unit

    scenario = lead_project(app, "ANNOTATION_LOOP", rule_on=False)
    with scenario.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(creation_defaults=CREATION_DEFAULTS)
        )
    app.state.ontology_store.add(
        Actor.cli(),
        TRANSLATION_FILE,
        (ROOT / "tests/fixtures" / TRANSLATION_FILE).read_bytes(),
    )
    import_units(
        scenario,
        [
            native_unit(case, language, text, case_id=case)
            for case, (language, text) in LOOP_TEXTS.items()
        ],
    )
    plan(scenario, list(LOOP_TEXTS), {"source": {"review": OFF, "annotate": ON}})
    assignments = {
        case: batch_assign(scenario, [case], language, "annotate", ["annotator"])[0].id
        for case, (language, _text) in LOOP_TEXTS.items()
    }
    return result(
        scenario,
        [(case, language) for case, (language, _text) in LOOP_TEXTS.items()],
        assignments=assignments,
        texts={case: text for case, (_language, text) in LOOP_TEXTS.items()},
    )


BUILDERS: dict[str, Builder] = {
    "REVIEW_FLOW": build_review_flow,
    "ANNOTATION_LOOP": build_annotation_loop,
}


def register_review_flow_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_review_flow__`` ahead of the static frontend."""

    @app.post("/__test_review_flow__")
    def review_flow_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = BUILDERS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown review flow scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
