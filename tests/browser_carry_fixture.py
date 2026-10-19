"""Carried-review browser scenarios (editor plan F10); test server only, never shipped.

``POST /__test_carry_forward__?scenario=t5|corrected|rounds3`` builds a fresh
project ``carry-{scenario}-{uuid8}`` through the real services
(``WorkRoundService``, ``EditingService``, ``RoundInputResolutionService``,
``SubmissionService``) and returns its identities. One annotator
(``annotator``, the plan's ann-0004) works on a German text of
``case-0042``; pseudonyms are unique per server, so the person label is
returned in ``labels`` (assert against it, never against "ann-0004").

Scenarios:

- ``t5``: Round 1 submitted with one spanless finding "Seizure"; Round 2
  continues from it (open) and has one added finding "Hypotonia" with a span.
- ``corrected``: Round 1 submitted on v1 with "Seizure" on a span; v2
  corrects that span's text, so the Round 2 carry-forward on v2 cannot place
  it (needs-review input with a stored ``review_reason``).
- ``rounds3``: Round 1 submitted (replaced), Round 2 continued from it,
  checked and submitted (replaced), Round 3 continued from Round 2 (open).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

from browser_documents_scenarios import (
    Scenario,
    add_user,
    assign,
    finish_round,
    identity,
    import_texts,
    start_round,
)
from fastapi import FastAPI, HTTPException, Query

CASE = "case-0042"
SEIZURE = "HP:0001250"
HYPOTONIA = "HP:0001252"
# Every axis chosen: no defaulted values, so no "unconfirmed values" items.
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
TEXT_DE = (
    "Die Patientin ist ein 14 Monate altes Mädchen mit Entwicklungsverzögerung. "
    "Seit dem Sommer hat sie Krampfanfälle. Bei der Untersuchung zeigt sie eine "
    "Hypotonie."
)
# The correction rewrites the seizure sentence, so its span cannot be placed.
CORRECTED_DE = TEXT_DE.replace(
    "Seit dem Sommer hat sie Krampfanfälle.",
    "Seit dem Sommer treten epileptische Anfälle auf.",
)
SEIZURE_NOTE = "Reported by the parents at the first visit."
SEIZURE_SPAN = "Krampfanfälle"
HYPOTONIA_SPAN = "Hypotonie"


def _span(text: str, part: str) -> dict[str, int]:
    start = text.index(part)
    return {"start": start, "end": start + len(part)}


def _new_project(app: FastAPI, name: str) -> Scenario:
    """A fresh project ``carry-{name}-{uuid8}`` (annotates unreviewed texts)."""
    from sqlalchemy import update
    from t1_fixtures import create_project

    from ontocurator.storage.tables import ProjectRow

    key = f"carry-{name}-{uuid4().hex[:8]}"
    db = app.state.repo.db
    create_project(db, key)
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(annotate_accepted_translations_only=False)
        )
    return Scenario(app, key, {})


def _scoped(scenario: Scenario, name: str) -> Any:
    from ontocurator.authz.scoped import ScopedRepository

    access, actor = identity(scenario, name)
    return ScopedRepository(scenario.db, access, actor)


def _envelope(scoped: Any, workspace_key: Any, payload: dict[str, Any]) -> Any:
    from ontocurator.domain.workspace import MutationEnvelope

    return MutationEnvelope(
        mutation_id=f"carry-{uuid4().hex}",
        expected_revision=scoped.open_draft(workspace_key).revision,
        payload=payload,
    )


def _create(
    scenario: Scenario,
    name: str,
    workspace_key: Any,
    term_id: str,
    *,
    span: dict[str, int] | None = None,
    note: str | None = None,
) -> Any:
    """Create one finding with every axis chosen; returns its snapshot."""
    from ontocurator.application.editing import EditingService

    scoped = _scoped(scenario, name)
    annotation_id = f"ann-{uuid4().hex[:12]}"
    payload: dict[str, Any] = {
        "command": "create_annotation",
        "annotation_id": annotation_id,
        "term_id": term_id,
        "layer_id": "hpo",
        "type_id": "phenotype",
        "axes_values": dict(AXES),
        "chosen_axis_ids": list(AXES),
    }
    if span is not None:
        payload["evidence_id"] = f"ev-{uuid4().hex[:12]}"
        payload["segments"] = [span]
    if note is not None:
        payload["note"] = note
    draft = EditingService(scoped, scenario.app.state.ontology_registry).apply(
        workspace_key, _envelope(scoped, workspace_key, payload)
    )
    return next(
        s for s in draft.annotations if s.annotation.annotation_id == annotation_id
    )


def _inputs(scenario: Scenario, round_id: str) -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = scenario.app.state.repo.get_round_input_inventory(
        scenario.key, round_id
    )
    return inventory


def _check_all(scenario: Scenario, name: str, work: Any) -> None:
    """Mark every carried input of ``work`` as checked against its carried finding."""
    from ontocurator.application.work_rounds import RoundInputResolutionService

    for item in _inputs(scenario, work.round_id):
        target = item["target_snapshot"]
        if target is None:
            raise HTTPException(500, "rounds3 expects every input to be carried")
        scoped = _scoped(scenario, name)
        draft = scoped.open_draft(work.workspace_key)
        carried = next(
            s
            for s in draft.annotations
            if s.annotation.annotation_id == target["annotation"]["annotation_id"]
        )
        RoundInputResolutionService(scoped).resolve(
            work.workspace_key,
            _envelope(
                scoped,
                work.workspace_key,
                {
                    "input_id": item["input_id"],
                    "outcome": "completed",
                    "annotation_ref": {
                        "annotation_id": carried.annotation.annotation_id,
                        "version": carried.version,
                    },
                },
            ),
        )


def _setup(app: FastAPI, name: str, texts: list[str]) -> tuple[Scenario, list[str]]:
    """Project, the German text versions of ``texts`` (v1, corrections) and the annotator."""
    from t1_builders import correction_unit, native_unit

    scenario = _new_project(app, name)
    units = [native_unit(CASE, "de", texts[0], case_id=CASE)]
    for text in texts[1:]:
        units.append(correction_unit(units[-1], text))
    docs = import_texts(scenario, units)
    add_user(scenario, "annotator", ["annotator"], languages=("de",))
    return scenario, [docs[(CASE, "de", index + 1)] for index in range(len(texts))]


def _first_round(
    scenario: Scenario, document_id: str, *, span: dict[str, int] | None
) -> dict[str, Any]:
    """Round 1 with one "Seizure" finding, submitted."""
    assignment_id = assign(scenario, document_id, "annotator", "annotate")
    first = start_round(scenario, assignment_id, "annotator")
    _create(
        scenario,
        "annotator",
        first.workspace_key,
        SEIZURE,
        span=span,
        note=SEIZURE_NOTE,
    )
    submission_id = finish_round(scenario, "annotator", first.workspace_key)
    return {
        "assignment_id": assignment_id,
        "round_id": first.round_id,
        "submission_id": submission_id,
    }


def _result(
    scenario: Scenario, assignment_id: int, documents: list[str], **extra: Any
) -> dict[str, Any]:
    from browser_server import TEST_PASSWORD

    accounts = scenario.app.state.accounts
    username = scenario.users["annotator"]
    return {
        "project": scenario.key,
        "case_id": CASE,
        "language": "de",
        "documents": documents,
        "assignment_id": assignment_id,
        "username": username,
        "password": TEST_PASSWORD,
        "users": dict(scenario.users),
        "labels": {
            name: accounts.get_by_username(user).pseudonym
            for name, user in scenario.users.items()
        },
        **extra,
    }


def build_t5(app: FastAPI) -> dict[str, Any]:
    scenario, documents = _setup(app, "t5", [TEXT_DE])
    first = _first_round(scenario, documents[0], span=None)
    carried = start_round(
        scenario,
        first["assignment_id"],
        "annotator",
        kind="carry_forward",
        sources=[first["submission_id"]],
    )
    added = _create(
        scenario,
        "annotator",
        carried.workspace_key,
        HYPOTONIA,
        span=_span(TEXT_DE, HYPOTONIA_SPAN),
    )
    inputs = _inputs(scenario, carried.round_id)
    if len(inputs) != 1 or inputs[0]["target_snapshot"] is None:
        raise HTTPException(
            500, {"error": "Expected one carried input", "inputs": inputs}
        )
    return _result(
        scenario,
        first["assignment_id"],
        documents,
        text=TEXT_DE,
        submissions={"round1": first["submission_id"]},
        rounds={"round1": first["round_id"], "round2": carried.round_id},
        carried_annotation_id=inputs[0]["target_snapshot"]["annotation"][
            "annotation_id"
        ],
        added_annotation_id=added.annotation.annotation_id,
        added_span=_span(TEXT_DE, HYPOTONIA_SPAN),
        note=SEIZURE_NOTE,
    )


def build_corrected(app: FastAPI) -> dict[str, Any]:
    scenario, documents = _setup(app, "corrected", [TEXT_DE, CORRECTED_DE])
    first = _first_round(scenario, documents[0], span=_span(TEXT_DE, SEIZURE_SPAN))
    # The same annotator continues on the corrected text (v2).
    assignment_id = assign(scenario, documents[1], "annotator", "annotate")
    carried = start_round(
        scenario,
        assignment_id,
        "annotator",
        kind="carry_forward",
        sources=[first["submission_id"]],
    )
    inputs = _inputs(scenario, carried.round_id)
    if (
        len(inputs) != 1
        or inputs[0]["mapping_status"] != "needs_review"
        or not inputs[0].get("review_reason")
    ):
        raise HTTPException(
            500, {"error": "Expected one needs-review input", "inputs": inputs}
        )
    return _result(
        scenario,
        assignment_id,
        documents,
        text=CORRECTED_DE,
        old_text=TEXT_DE,
        submissions={"round1": first["submission_id"]},
        rounds={"round1": first["round_id"], "round2": carried.round_id},
        review_reason=inputs[0]["review_reason"],
        # Where "Mark in text" re-creates the finding on v2.
        recreate_span=_span(CORRECTED_DE, "epileptische Anfälle"),
    )


def build_rounds3(app: FastAPI) -> dict[str, Any]:
    scenario, documents = _setup(app, "rounds3", [TEXT_DE])
    first = _first_round(scenario, documents[0], span=None)
    assignment_id = first["assignment_id"]
    second = start_round(
        scenario,
        assignment_id,
        "annotator",
        kind="carry_forward",
        sources=[first["submission_id"]],
    )
    _check_all(scenario, "annotator", second)
    second_submission = finish_round(scenario, "annotator", second.workspace_key)
    third = start_round(
        scenario,
        assignment_id,
        "annotator",
        kind="carry_forward",
        sources=[second_submission],
    )
    return _result(
        scenario,
        assignment_id,
        documents,
        text=TEXT_DE,
        submissions={"round1": first["submission_id"], "round2": second_submission},
        rounds={
            "round1": first["round_id"],
            "round2": second.round_id,
            "round3": third.round_id,
        },
    )


Builder = Callable[[FastAPI], dict[str, Any]]

SCENARIOS: dict[str, Builder] = {
    "t5": build_t5,
    "corrected": build_corrected,
    "rounds3": build_rounds3,
}


def register_carry_forward_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_carry_forward__`` ahead of the static frontend."""

    @app.post("/__test_carry_forward__")
    def carry_forward_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = SCENARIOS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown carry-forward scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
