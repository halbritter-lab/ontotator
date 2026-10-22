"""Consolidation view browser scenario (acceptance fixes WP-E2a); test server
only, never shipped.

``POST /__test_consolidation__?started=false`` builds a fresh project whose
``case-0107`` en text has two submissions (ann-0001, ann-0002) forming the
spec's 8 groups: 4 match (kept automatically), 1 value, 1 span, 1 partial,
1 term (whose assertion differs too). The lead has no Adjudicator role. With ``started=true`` the lead has
already started the consolidation as consolidator (self-grant, start command).
"""

from __future__ import annotations

from typing import Any
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

CASE = "case-0107"
TEXT = (
    "The patient had two seizures last week. No muscular hypotonia. "
    "Absent reflexes in both legs. Reduced hearing on the left. "
    "Prolonged seizure activity at night. Hearing loss on the right. "
    "Brief absence episodes. Weak muscle tone in the arms."
)
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
# (term, passage, axis changes) per annotator. Matches: seizures, hearing loss,
# absence episodes, muscle tone. Value: hypotonia (absent). Span: reflexes.
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


def at(words: str) -> dict[str, int]:
    start = TEXT.index(words)
    return {"start": start, "end": start + len(words)}


def _annotate(scenario: Scenario, name: str, document_id: str) -> str:
    """Assign, start round 1, mark the designed findings and submit."""
    from ontocurator.application.editing import EditingService
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.workspace import MutationEnvelope

    assignment_id = assign(scenario, document_id, name, "annotate")
    key = start_round(scenario, assignment_id, name).workspace_key
    access, actor = identity(scenario, name)
    scoped = ScopedRepository(scenario.db, access, actor)
    editing = EditingService(scoped, scenario.app.state.ontology_registry)
    for term, words, changes in FINDINGS[name]:
        payload: dict[str, Any] = {
            "command": "create_annotation",
            "annotation_id": f"ann-{uuid4().hex[:12]}",
            "evidence_id": f"ev-{uuid4().hex[:12]}",
            "term_id": term,
            "layer_id": "hpo",
            "type_id": "phenotype",
            "segments": [at(words)],
            "axes_values": {**AXES, **changes},
            "chosen_axis_ids": list(AXES),
        }
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


def build(app: FastAPI, started: bool) -> dict[str, Any]:
    from t1_builders import native_unit

    scenario = new_project(app, "C1")
    docs = import_texts(scenario, [native_unit(CASE, "en", TEXT, case_id=CASE)])
    document_id = docs[(CASE, "en", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    sources = [_annotate(scenario, name, document_id) for name in FINDINGS]
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
    def consolidation_scenario(started: bool = Query(False)) -> dict[str, Any]:
        return build(app, started)

    app.router.routes.insert(0, app.router.routes.pop())
