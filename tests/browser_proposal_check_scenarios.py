"""Proposal-check browser scenarios (plan T1); test server only, never shipped.

``POST /__test_proposal_check__?scenario=FRESH`` builds a fresh project
``lead-proposal-check-{uuid8}`` through the real services: three native ``en``
texts (``EN100024`` and ``EN100031`` with three tool proposals, ``EN100017``
without), the project setting "Annotate from proposals", two annotations per
text and a plan override ``scratch`` on ``EN100031``. It returns::

    {project, users: {lead, tom, mia, ali, ...}, display_names, pseudonyms,
     rows, cases: {case: document_id}, assignments: {name: id},
     submissions: {name: id}, round_id?}

``ONE_ASSIGNED`` assigns Tom to ``EN100024`` (from proposals, not started),
``CHECKED`` has Tom and Mia submit their proposal checks of ``EN100024``, and
``CONSOLIDATING`` adds the lead's consolidation round.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from browser_consolidation_scenarios import start_as_lead
from browser_documents_scenarios import Scenario, identity, start_round
from browser_lead_workflow_scenarios import (
    OFF,
    ON,
    PEOPLE,
    batch_assign,
    import_units,
    lead_project,
    person,
    plan,
    result,
)
from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import update

from ontocurator.domain.errors import DomainError
from ontocurator.storage.tables import ProjectRow

PEOPLE.update({"tom": "Tom Reis", "mia": "Mia Berg", "ali": "Ali Kaya"})
WITH_PROPOSALS = "EN100024"
WITHOUT = "EN100017"
OVERRIDDEN = "EN100031"
CASES = (WITH_PROPOSALS, WITHOUT, OVERRIDDEN)
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
# Tom corrects p3 to this term (the fixture ontology has no HP:0002069).
CORRECTED_TERM = "HP:0002133"
# Outcome per proposal (p1, p2, p3); "changed" is a correction.
CHECKS = {
    "tom": ("confirmed", "rejected", "changed"),
    "mia": ("confirmed", "confirmed", "confirmed"),
}


def text_of(case: str) -> str:
    from t1_fixtures import TEXT

    return f"{TEXT} ({case})"


def proposals(text: str) -> list[dict[str, Any]]:
    """The three proposals of ``tests/proposal_check_support.py``."""
    from t1_fixtures import annotation

    word = "Krampfanfälle"
    first, second = text.index(word), text.rindex(word)
    period = text.index("Neonatalzeit")
    return [
        annotation("p1", (first, first + len(word)), text=text),
        annotation(
            "p2",
            (period, period + len("Neonatalzeit")),
            text=text,
            term_id="HP:0001250",
        ),
        annotation("p3", (second, second + len(word)), text=text, assertion="absent"),
    ]


def fresh(app: FastAPI) -> tuple[Scenario, dict[str, str]]:
    from t1_builders import native_unit

    scenario = lead_project(
        app,
        "proposal-check",
        import_plan="review_and_annotate_translations",
        rule_on=False,
    )
    for name in ("tom", "mia", "ali"):
        person(scenario, name, ["annotator"])
    with scenario.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(annotations_per_text=2, tool_proposal_mode="proposals")
        )
    units = [
        native_unit(
            case,
            "en",
            text_of(case),
            case_id=case,
            annotations=[] if case == WITHOUT else proposals(text_of(case)),
        )
        for case in CASES
    ]
    documents = import_units(scenario, units)
    plan(scenario, CASES, {"source": {"review": OFF, "annotate": ON}})
    plan(scenario, [OVERRIDDEN], {"source": {"annotation_mode": "scratch"}})
    return scenario, {case: documents[(case, "en")] for case in CASES}


def check_and_submit(
    scenario: Scenario, assignment_id: int, name: str, outcomes: tuple[str, ...]
) -> str:
    """Start the proposal check, decide every proposal and submit it."""
    from ontocurator.application.editing import EditingService
    from ontocurator.application.reviews import ReviewService
    from ontocurator.application.submissions import SubmissionService
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.annotations import AnnotationRef
    from ontocurator.domain.workspace import MutationEnvelope

    key = start_round(scenario, assignment_id, name).workspace_key
    if key.mode != "proposal_check":
        raise HTTPException(500, f"expected a proposal check, got {key.mode!r}")
    access, actor = identity(scenario, name)
    scoped = ScopedRepository(scenario.db, access, actor)
    registry = scenario.app.state.ontology_registry

    def envelope(payload: dict[str, Any]) -> MutationEnvelope:
        return MutationEnvelope(
            mutation_id=f"pc-{uuid4().hex}",
            expected_revision=scoped.open_draft(key).revision,
            payload=payload,
        )

    targets = sorted(
        scoped.open_draft(key).targets.targets,
        key=lambda ref: ref.annotation_id.rsplit(":", 1)[-1],
    )
    # p3's span: the correction marks the same words with another term.
    start = text_of(WITH_PROPOSALS).rindex("Krampfanfälle")
    span = {"start": start, "end": start + len("Krampfanfälle")}
    for target, outcome in zip(targets, outcomes, strict=True):
        replacement = None
        if outcome == "changed":
            annotation_id = f"ann-{uuid4().hex[:12]}"
            draft = EditingService(scoped, registry).apply(
                key,
                envelope(
                    {
                        "command": "create_annotation",
                        "annotation_id": annotation_id,
                        "evidence_id": f"ev-{uuid4().hex[:12]}",
                        "term_id": CORRECTED_TERM,
                        "layer_id": "hpo",
                        "type_id": "phenotype",
                        "segments": [span],
                        "axes_values": AXES,
                        "chosen_axis_ids": list(AXES),
                    }
                ),
            )
            created = next(
                a
                for a in draft.annotations
                if a.annotation.annotation_id == annotation_id
            )
            replacement = AnnotationRef(
                annotation_id=annotation_id, version=created.version
            ).model_dump()
        ReviewService(scoped, registry=registry).decide(
            key,
            envelope(
                {
                    "target": target.model_dump(),
                    "outcome": outcome,
                    "replacement": replacement,
                }
            ),
        )
    submissions = SubmissionService(scoped, registry)
    payload: dict[str, Any] = {"document_checked": True}
    try:
        return submissions.submit(key, envelope(payload)).submission_id
    except DomainError as error:
        if error.code != "AXIS_CONFIRMATION_WARNING":
            raise
        # Confirmed proposals leave axes unchosen; acknowledge as the editor does.
        assert isinstance(error.details, dict)
        payload["warning_acknowledgement"] = error.details["acknowledgement"]
        return submissions.submit(key, envelope(payload)).submission_id


def build(app: FastAPI, scenario_name: str) -> dict[str, Any]:
    scenario, cases = fresh(app)
    assignments: dict[str, int] = {}
    submissions: dict[str, str] = {}
    extra: dict[str, Any] = {}
    checkers = {"ONE_ASSIGNED": ("tom",)}.get(scenario_name, tuple(CHECKS))
    if scenario_name != "FRESH":
        for name in checkers:
            assignments[name] = batch_assign(
                scenario, [WITH_PROPOSALS], "en", "annotate", [name]
            )[0].id
    if scenario_name in {"CHECKED", "CONSOLIDATING"}:
        for name, outcomes in CHECKS.items():
            submissions[name] = check_and_submit(
                scenario, assignments[name], name, outcomes
            )
    if scenario_name == "CONSOLIDATING":
        round_view = start_as_lead(
            scenario, cases[WITH_PROPOSALS], list(submissions.values())
        )
        extra = {
            "round_id": round_view.round_id,
            "consolidation_assignment_id": round_view.assignment_id,
        }
    return result(
        scenario,
        [(case, "en") for case in CASES],
        cases=cases,
        assignments=assignments,
        submissions=submissions,
        **extra,
    )


SCENARIOS = ("FRESH", "ONE_ASSIGNED", "CHECKED", "CONSOLIDATING")


def register_proposal_check_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_proposal_check__`` ahead of the static frontend."""

    @app.post("/__test_proposal_check__")
    def proposal_check_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        if scenario not in SCENARIOS:
            raise HTTPException(404, f"Unknown proposal check scenario {scenario!r}")
        return build(app, scenario)

    app.router.routes.insert(0, app.router.routes.pop())
