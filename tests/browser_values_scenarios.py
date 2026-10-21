"""Values block browser scenarios.

``POST /__test_values__?scenario=VALUES_STANDARD`` builds a fresh project
``values-{scenario}-{uuid8}`` whose ``hpo``/``phenotype`` type carries exactly
the scenario's axes, with the lead workflow's four people, one native ``en``
text planned annotate and assigned to the annotator. It returns the review
flow shape::

    {project, users, display_names, pseudonyms, rows,
     assignments: {name: assignment_id}, texts: {name: text}}

The pin uses the ``generic`` T1 profile: the ``hpo-phenotype`` profile's closed
axis lists know neither temporality ``future`` nor the axis ``certainty``.
Test server only, never shipped.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from browser_documents_scenarios import Builder, Scenario
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

from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.axes import STANDARD_CLINICAL_AXES, AxisDefinition
from ontocurator.domain.profiles import TaskProfile
from ontocurator.exchange.t1 import Pin, layers_for
from ontocurator.ontology.registry import OntologyRegistry
from ontocurator.ontology.store import OntologyStore
from ontocurator.storage.tables import ProjectRow

CASE = "values"
TEXT = "The patient has a seizure and hypotonia."
LONG_AXES = [
    STANDARD_CLINICAL_AXES[0],
    AxisDefinition(
        id="certainty",
        label="Diagnostic certainty",
        options=[
            "confirmed_by_genetic_testing",
            "clinically_suspected_only",
            "excluded_after_workup",
        ],
        allow_empty=True,
    ),
]


def values_pin() -> Pin:
    from t1_fixtures import HP_SHA

    return Pin(sha256=HP_SHA, allowed_roots=("HP:0000118",), t1_profile="generic")


def values_profile(axes: list[AxisDefinition]) -> TaskProfile:
    """``hpo_profile()`` with ``axes`` on its ``phenotype`` type."""
    from t1_fixtures import hpo_profile

    profile = hpo_profile()
    layer = profile.layers[0]
    kind = layer.annotation_types[0].model_copy(update={"axes": list(axes)})
    return profile.model_copy(
        update={"layers": [layer.model_copy(update={"annotation_types": [kind]})]}
    )


def values_project(
    app: FastAPI, name: str, axes: list[AxisDefinition], defaults: dict[str, str]
) -> tuple[Scenario, TaskProfile]:
    """A fresh project pinning HP (generic) with ``axes``, the four people and
    ``defaults`` as hpo/phenotype creation defaults."""
    from t1_fixtures import ADMIN_ACCESS, HP_PATH, OPERATOR

    db = app.state.repo.db
    key = f"values-{name.lower().replace('_', '-')}-{uuid4().hex[:8]}"
    profile = values_profile(axes)
    OntologyStore(db, OntologyRegistry(), db.data_dir).add(
        OPERATOR, HP_PATH.name, HP_PATH.read_bytes()
    )
    ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(
        key, "Project", None, profile, {"hp": values_pin()}
    )
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(
                import_plan="nothing",
                annotate_accepted_translations_only=False,
                creation_defaults={"hpo": {"phenotype": defaults}},
            )
        )
    scenario = Scenario(app, key, {})
    person(scenario, "lead", ["lead"])
    person(scenario, "ana", ["annotator"], qualification="Physician")
    person(scenario, "ben", ["annotator"], qualification="Physician")
    person(scenario, "annotator", ["annotator"])
    return scenario, profile


def build_values(
    app: FastAPI, name: str, axes: list[AxisDefinition], defaults: dict[str, str]
) -> dict[str, Any]:
    """One native ``en`` text planned annotate and assigned to the annotator."""
    from t1_builders import native_unit

    scenario, profile = values_project(app, name, axes, defaults)
    unit = native_unit(CASE, "en", TEXT, case_id=CASE)
    # The unit's layer must describe the project's generic pin.
    layers = tuple(layers_for(profile, {"hp": values_pin()}))
    unit = unit.model_copy(
        update={
            "annotation_set": unit.annotation_set.model_copy(update={"layers": layers})
        }
    )
    import_units(scenario, [unit])
    plan(scenario, [CASE], {"source": {"review": OFF, "annotate": ON}})
    assignment = batch_assign(scenario, [CASE], "en", "annotate", ["annotator"])[0]
    return result(
        scenario,
        [(CASE, "en")],
        assignments={CASE: assignment.id},
        texts={CASE: TEXT},
    )


def build_values_standard(app: FastAPI) -> dict[str, Any]:
    """``STANDARD_CLINICAL_AXES``: three segmented axes with long labels."""
    return build_values(
        app,
        "VALUES_STANDARD",
        STANDARD_CLINICAL_AXES,
        {"assertion": "present", "experiencer": "patient", "temporality": "current"},
    )


def build_values_long(app: FastAPI) -> dict[str, Any]:
    """Assertion plus ``certainty`` with long raw option values."""
    return build_values(
        app,
        "VALUES_LONG",
        LONG_AXES,
        {"assertion": "present", "certainty": "clinically_suspected_only"},
    )


BUILDERS: dict[str, Builder] = {
    "VALUES_STANDARD": build_values_standard,
    "VALUES_LONG": build_values_long,
}


def register_values_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_values__`` ahead of the static frontend."""

    @app.post("/__test_values__")
    def values_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = BUILDERS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown values scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
