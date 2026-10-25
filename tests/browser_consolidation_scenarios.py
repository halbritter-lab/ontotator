"""Consolidation view browser scenario (acceptance fixes WP-E2a); test server
only, never shipped.

``POST /__test_consolidation__?started=false`` builds a fresh project whose
``case-0107`` en text has two submissions (ann-0001, ann-0002) forming the
spec's 8 groups: 4 match (kept automatically), 1 value, 1 span, 1 partial,
1 term (whose assertion differs too). The lead has no Adjudicator role. With ``started=true`` the lead has
already started the consolidation as consolidator (self-grant, start command).
``people=3`` adds ann-0003 (ann-0001's findings, but "hypotonia" as another
term), so the hypotonia group is a three-way term and assertion conflict.

``scenario=modifiers`` (modifiers plan M2) builds instead a project pinned
with ``MOD_PIN`` whose ``MOD_TEXT`` has two submissions (Ana Weber, Ben Roth)
with modifiers: S4 on "focal seizures" (Recurrent on "Recurrent" vs a
spanless Severe: Modifiers is its only conflicting row), S9 on the second
sentence's "seizures" and "hypotonia" (Severe on "Severe" on the other
finding each), S1 on "hearing loss" (both Bilateral on "Bilateral", kept
automatically) and S13 on "Reduced reflexes" (Ana only, spanless Bilateral).
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

from browser_documents_scenarios import (
    Scenario,
    add_user,
    assign,
    finish_round,
    identity,
    import_texts,
    new_project,
    result,
    start_round,
)
from fastapi import FastAPI, Query
from sqlalchemy import update

from ontocurator.storage.tables import ProjectRow

CASE = "case-0107"
TEXT = (
    "The patient had two seizures last week. No muscular hypotonia. "
    "Absent reflexes in both legs. Reduced hearing on the left. "
    "Prolonged seizure activity at night. Hearing loss on the right. "
    "Brief absence episodes. Weak muscle tone in the arms."
)
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
# (term, passage, axis changes) per annotator. Matches: seizures, hearing loss,
# absence episodes, muscle tone. Value: hypotonia (absent). Span: reflexes
# (overlapping spans: no text decision, "Keep").
# Partial: reduced hearing (ann-0001 only). Term: prolonged seizure activity
# (the terms and the assertion differ).
FINDINGS: dict[str, list[tuple[str, str, dict[str, str]]]] = {
    "ann-0001": [
        ("HP:0001250", "seizures", {}),
        ("HP:0001252", "muscular hypotonia", {}),
        ("HP:0001284", "Absent reflexes", {}),
        ("HP:0000365", "Reduced hearing", {}),
        ("HP:0002133", "Prolonged seizure activity", {}),
        ("HP:0000407", "Hearing loss", {}),
        ("HP:0011146", "Brief absence episodes", {}),
        ("HP:0001252", "Weak muscle tone", {}),
    ],
    "ann-0002": [
        ("HP:0001250", "seizures", {}),
        ("HP:0001252", "muscular hypotonia", {"assertion": "absent"}),
        ("HP:0001284", "Absent reflexes in both legs", {}),
        ("HP:0001250", "Prolonged seizure activity", {"assertion": "absent"}),
        ("HP:0000407", "Hearing loss", {}),
        ("HP:0011146", "Brief absence episodes", {}),
        ("HP:0001252", "Weak muscle tone", {}),
    ],
}
# The fixture ontology has no "Axial hypotonia"; another term overlapping
# ann-0001's span makes the term conflict.
THIRD: list[tuple[str, str, dict[str, str]]] = [
    ("HP:0000707", "hypotonia", {}) if finding[1] == "muscular hypotonia" else finding
    for finding in FINDINGS["ann-0001"]
]


# Modifier scenario: "seizures" occurs twice (``at(..., nth=1)``).
MOD_TEXT = (
    "Recurrent focal seizures. Severe seizures and hypotonia since birth. "
    "Bilateral hearing loss. Reduced reflexes."
)
SEVERE = "HP:0012828"
RECURRENT = "HP:0031796"
BILATERAL = "HP:0012832"
# (term, (words, nth), axis changes, [(modifier term, its words or None)]).
MOD_FINDINGS: dict[str, list[Any]] = {
    "ana": [
        ("HP:0007359", ("focal seizures", 0), {}, [(RECURRENT, "Recurrent")]),
        ("HP:0001250", ("seizures", 1), {}, [(SEVERE, "Severe")]),
        ("HP:0001252", ("hypotonia", 0), {}, []),
        ("HP:0000407", ("hearing loss", 0), {}, [(BILATERAL, "Bilateral")]),
        ("HP:0001284", ("Reduced reflexes", 0), {}, [(BILATERAL, None)]),
    ],
    "ben": [
        ("HP:0007359", ("focal seizures", 0), {}, [(SEVERE, None)]),
        ("HP:0001250", ("seizures", 1), {}, []),
        ("HP:0001252", ("hypotonia", 0), {}, [(SEVERE, "Severe")]),
        ("HP:0000407", ("hearing loss", 0), {}, [(BILATERAL, "Bilateral")]),
    ],
}


def at(words: str, nth: int = 0, text: str = TEXT) -> dict[str, int]:
    """The ``nth`` occurrence of ``words`` in ``text`` (code points)."""
    start = -1
    for _ in range(nth + 1):
        start = text.index(words, start + 1)
    return {"start": start, "end": start + len(words)}


def _annotate(
    scenario: Scenario,
    name: str,
    document_id: str,
    findings: list[Any],
    text: str = TEXT,
) -> str:
    """Assign, start round 1, mark the designed findings and submit.

    A finding is ``(term, words, axis changes)``; in the modifier scenario
    ``(term, (words, nth), axis changes, modifiers)``."""
    from ontocurator.application.editing import EditingService
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.workspace import MutationEnvelope

    assignment_id = assign(scenario, document_id, name, "annotate")
    key = start_round(scenario, assignment_id, name).workspace_key
    access, actor = identity(scenario, name)
    scoped = ScopedRepository(scenario.db, access, actor)
    editing = EditingService(scoped, scenario.app.state.ontology_registry)
    for term, words, changes, *rest in findings:
        annotation_id = f"ann-{uuid4().hex[:12]}"
        place = at(*words, text=text) if isinstance(words, tuple) else at(words)
        payloads: list[dict[str, Any]] = [
            {
                "command": "create_annotation",
                "annotation_id": annotation_id,
                "evidence_id": f"ev-{uuid4().hex[:12]}",
                "term_id": term,
                "layer_id": "hpo",
                "type_id": "phenotype",
                "segments": [place],
                "axes_values": {**AXES, **changes},
                "chosen_axis_ids": list(AXES),
            }
        ]
        for modifier, modifier_words in rest[0] if rest else []:
            payloads.append(
                {
                    "command": "add_modifier",
                    "annotation_id": annotation_id,
                    "term_id": modifier,
                    "segments": [at(modifier_words, text=text)]
                    if modifier_words
                    else [],
                }
            )
        for payload in payloads:
            editing.apply(
                key,
                MutationEnvelope(
                    mutation_id=f"cons-{uuid4().hex}",
                    expected_revision=scoped.open_draft(key).revision,
                    payload=payload,
                ),
            )
    return finish_round(scenario, name, key)


def start_as_lead(scenario: Scenario, document_id: str, sources: list[str]) -> Any:
    """The lead starts the consolidation as consolidator (self-grant)."""
    from ontocurator.application.consolidation_start import (
        ConsolidationStartService,
        StartConsolidation,
    )

    access, actor = identity(scenario, "lead")
    return (
        ConsolidationStartService(scenario.db)
        .start(
            actor,
            access,
            scenario.key,
            StartConsolidation(
                document_id=document_id,
                reviewer=scenario.users["lead"],
                source_submission_ids=sources,
                request_id=f"start-{uuid4().hex}",
            ),
        )
        .round
    )


def _modifier_project(app: FastAPI) -> Scenario:
    """A fresh project ``documents-mods-{uuid8}`` pinned with ``MOD_PIN``."""
    from modifier_fixtures import MOD_PATH, MOD_PIN, modifier_profile
    from t1_fixtures import ADMIN_ACCESS, OPERATOR

    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.ontology.modifiers import install_service_source
    from ontocurator.ontology.store import OntologyStore

    key = f"documents-mods-{uuid4().hex[:8]}"
    db = app.state.repo.db
    registry = app.state.ontology_registry
    # Stored through the app's registry, which classifies modifier terms for
    # the consolidation read (D-a): other scenarios' throwaway registries may
    # have taken over the process-wide source.
    store = OntologyStore(db, registry, db.data_dir)
    store.add(OPERATOR, MOD_PATH.name, MOD_PATH.read_bytes())
    install_service_source(registry.get_service)
    ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(
        key, "Modifiers", None, modifier_profile(), {"hp": MOD_PIN}
    )
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(annotate_accepted_translations_only=False)
        )
    return Scenario(app, key, {})


def build_modifiers(app: FastAPI, started: bool) -> dict[str, Any]:
    """The ``modifiers`` scenario (module docstring)."""
    from browser_lead_workflow_scenarios import person
    from modifier_fixtures import MOD_PIN, modifier_profile
    from t1_builders import native_unit

    from ontocurator.exchange.t1 import layers_for

    scenario = _modifier_project(app)
    unit = native_unit(CASE, "en", MOD_TEXT, case_id=CASE)
    layers = tuple(layers_for(modifier_profile(), {"hp": MOD_PIN}))
    unit = unit.model_copy(
        update={
            "annotation_set": unit.annotation_set.model_copy(update={"layers": layers})
        }
    )
    document_id = import_texts(scenario, [unit])[(CASE, "en", 1)]
    person(scenario, "lead", ["lead"])
    person(scenario, "ana", ["annotator"])
    person(scenario, "ben", ["annotator"])
    sources = [
        _annotate(scenario, name, document_id, items, MOD_TEXT)
        for name, items in MOD_FINDINGS.items()
    ]
    ids: dict[str, Any] = {}
    if started:
        round_view = start_as_lead(scenario, document_id, sources)
        ids = {
            "round_id": round_view.round_id,
            "assignment_id": round_view.assignment_id,
        }
    return result(
        scenario,
        [(CASE, "en")],
        case_id=CASE,
        document_id=document_id,
        submissions=sources,
        text=MOD_TEXT,
        **ids,
    )


def build(app: FastAPI, started: bool, people: int = 2) -> dict[str, Any]:
    from t1_builders import native_unit

    scenario = new_project(app, "C1")
    docs = import_texts(scenario, [native_unit(CASE, "en", TEXT, case_id=CASE)])
    document_id = docs[(CASE, "en", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    findings = dict(FINDINGS)
    if people == 3:
        add_user(scenario, "ann-0003", ["annotator"])
        findings["ann-0003"] = THIRD
        with scenario.db.transaction() as conn:
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.project_key == scenario.key)
                .values(annotations_per_text=3)
            )
    sources = [
        _annotate(scenario, name, document_id, items)
        for name, items in findings.items()
    ]
    ids: dict[str, Any] = {}
    if started:
        round_view = start_as_lead(scenario, document_id, sources)
        ids = {
            "round_id": round_view.round_id,
            "assignment_id": round_view.assignment_id,
        }
    return result(
        scenario,
        [(CASE, "en")],
        case_id=CASE,
        document_id=document_id,
        submissions=sources,
        text=TEXT,
        **ids,
    )


def register_consolidation_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_consolidation__`` ahead of the static frontend."""

    @app.post("/__test_consolidation__")
    def consolidation_scenario(
        started: bool = Query(False),
        people: int = Query(2, ge=2, le=3),
        scenario: Literal["default", "modifiers"] = Query("default"),
    ) -> dict[str, Any]:
        if scenario == "modifiers":
            return build_modifiers(app, started)
        return build(app, started, people)

    app.router.routes.insert(0, app.router.routes.pop())
