"""Problem report browser scenarios (plan WP9a); test server only, never shipped.

``POST /__test_problem_reports__?scenario=base`` builds a fresh project
``problems-{scenario}-{uuid8}`` through the real services and returns its
identities. Texts: case A in en (native source) and de (machine translation of
it), case B in de (native). Users (keys of ``users`` and ``labels``):

- ``lead``: project lead (plan name lead-0002);
- ``reporter``: annotator on A de (ann-0004), files the reports;
- ``same_text``: annotator on A en (ann-0005), same text as the reporter;
- ``other_text``: annotator on B de (ann-0006).

Pseudonyms are unique per server, so the actual person labels are assigned
by the account service and returned in ``labels`` (assert against those).

Scenarios:

- ``base``: one annotate task per annotator, each with Round 1 in progress.
- ``final``: as ``base``, plus a selected final result on A de: Round 1 of a
  further annotator (``earlier``), submitted and selected by the lead.
- ``translation``: A de is not yet reviewed; the reporter's task is a
  ``translation_review`` of A de with a saved draft text and form values.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Scenario,
    accept_translation,
    add_user,
    assign,
    identity,
    import_texts,
    in_progress,
    select,
    submit,
)
from fastapi import FastAPI, HTTPException, Query

CASE_A = "case-0042"
CASE_B = "case-0108"
TEXT_B = (
    "Der Patient ist ein 6 Jahre alter Junge mit Kleinwuchs. Bei der "
    "Untersuchung zeigt er eine Makrozephalie."
)
DRAFT_TEXT = SYNTHETIC_DE + " Entwurf der Prüferin: Hypotonie bestätigt."
DRAFT_FORM: dict[str, Any] = {
    "decision": "accepted_corrected",
    "clinical_change": False,
    "categories": [],
    "rationale": "Draft rationale before the restart",
}


def _project(app: FastAPI, name: str, *, accepted: bool) -> tuple[Scenario, dict]:
    """Fresh project with texts A en, A de and B de and the four users."""
    from t1_builders import native_unit, translation_unit

    scenario = _new_project(app, name)
    source = native_unit(CASE_A, "en", SYNTHETIC, case_id=CASE_A)
    target = translation_unit(CASE_A, "de", SYNTHETIC_DE, source=source)
    other = native_unit(CASE_B, "de", TEXT_B, case_id=CASE_B)
    docs = import_texts(scenario, [source, target, other])
    documents = {
        "a_en": docs[(CASE_A, "en", 1)],
        "a_de": docs[(CASE_A, "de", 1)],
        "b_de": docs[(CASE_B, "de", 1)],
    }
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "reporter", ["annotator"], qualification="Physician")
    add_user(scenario, "same_text", ["annotator"])
    add_user(scenario, "other_text", ["annotator"])
    if accepted:
        add_user(scenario, "translator", ["annotator"], qualification="Physician")
        accept_translation(scenario, documents["a_de"], "translator")
    return scenario, documents


def _new_project(app: FastAPI, name: str) -> Scenario:
    """A fresh project ``problems-{name}-{uuid8}`` (``new_project`` of the
    Documents scenarios, with this route's prefix)."""
    from sqlalchemy import update
    from t1_fixtures import create_project

    from ontotator.storage.tables import ProjectRow

    key = f"problems-{name}-{uuid4().hex[:8]}"
    db = app.state.repo.db
    create_project(db, key)
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(annotate_accepted_translations_only=False)
        )
    return Scenario(app, key, {})


def _annotate_tasks(
    scenario: Scenario, documents: dict[str, str], *, reporter: bool = True
) -> dict[str, int]:
    """One annotate task per annotator with Round 1 started (not submitted)."""
    owners = [("same_text", "a_en"), ("other_text", "b_de")]
    if reporter:
        owners.insert(0, ("reporter", "a_de"))
    return {
        name: in_progress(scenario, documents[doc], name)["assignment_id"]
        for name, doc in owners
    }


def _result(
    scenario: Scenario, documents: dict[str, str], tasks: dict[str, int], **extra: Any
) -> dict[str, Any]:
    accounts = scenario.app.state.accounts
    return {
        "project": scenario.key,
        "users": dict(scenario.users),
        "labels": {
            name: accounts.get_by_username(username).pseudonym
            for name, username in scenario.users.items()
        },
        "case_ids": {"a": CASE_A, "b": CASE_B},
        "documents": documents,
        "tasks": tasks,
        **extra,
    }


def build_base(app: FastAPI) -> dict[str, Any]:
    scenario, documents = _project(app, "base", accepted=True)
    return _result(scenario, documents, _annotate_tasks(scenario, documents))


def build_final(app: FastAPI) -> dict[str, Any]:
    scenario, documents = _project(app, "final", accepted=True)
    add_user(scenario, "earlier", ["annotator"])
    earlier = submit(scenario, documents["a_de"], "earlier")
    select(scenario, documents["a_de"], earlier["submission_id"])
    tasks = _annotate_tasks(scenario, documents)
    label = scenario.app.state.accounts.get_by_username(
        scenario.users["earlier"]
    ).pseudonym
    return _result(
        scenario,
        documents,
        tasks,
        final={
            "submission_id": earlier["submission_id"],
            # Time-independent parts of the label ("Annotation · Round 1 · ...").
            "label_parts": ["Annotation", "Round 1", label],
        },
    )


def build_translation(app: FastAPI) -> dict[str, Any]:
    from ontotator.application.translation_reviews import TranslationReviewService

    scenario, documents = _project(app, "translation", accepted=False)
    tasks = _annotate_tasks(scenario, documents, reporter=False)
    review_id = assign(scenario, documents["a_de"], "reporter", "translation_review")
    access, _actor = identity(scenario, "reporter")
    service = TranslationReviewService(scenario.db, scenario.app.state.jobs)
    opened = service.open(access, review_id)
    service.save_draft(
        access,
        review_id,
        expected_revision=opened.draft.revision,
        text=DRAFT_TEXT,
        form=DRAFT_FORM,
    )
    # The reporter's only task here is the review.
    tasks = {"reporter": review_id, **tasks}
    return _result(
        scenario,
        documents,
        tasks,
        translation={
            "assignment_id": review_id,
            "draft_text": DRAFT_TEXT,
            "form": DRAFT_FORM,
        },
    )


Builder = Callable[[FastAPI], dict[str, Any]]

SCENARIOS: dict[str, Builder] = {
    "base": build_base,
    "final": build_final,
    "translation": build_translation,
}


def register_problem_report_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_problem_reports__`` ahead of the static frontend."""

    @app.post("/__test_problem_reports__")
    def problem_report_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = SCENARIOS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown problem report scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
