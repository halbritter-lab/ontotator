"""Documents browser scenarios (spec "Testing"); test server only, never shipped.

``POST /__test_documents__?scenario=S3`` builds a fresh project through the real
services and returns its identities. Each builder is ``build(app) -> dict`` and
returns at least ``{project, users: {lead, ...}, rows: [{case_id, language}]}``.
This module holds the route, the shared helpers and S0 to S5 and S8; the rows
and decisions modules add their own ``BUILDERS``.
"""

from __future__ import annotations

import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from time import monotonic, sleep
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import select as sa_select
from sqlalchemy import update

from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.storage.tables import JobRow, ProjectMembershipRow, ProjectRow

Builder = Callable[[FastAPI], dict[str, Any]]


@dataclass(frozen=True)
class Scenario:
    """One fresh project of a scenario and the users created in it."""

    app: FastAPI
    key: str
    users: dict[str, str]

    @property
    def db(self) -> Any:
        return self.app.state.repo.db


# --- Shared helpers ------------------------------------------------------------ #


def new_project(app: FastAPI, scenario: str) -> Scenario:
    """A fresh project ``documents-{scenario}-{uuid8}`` that also annotates
    texts whose translation is not yet accepted (the scenarios need that)."""
    from t1_fixtures import create_project

    key = f"documents-{scenario.lower()}-{uuid4().hex[:8]}"
    db = app.state.repo.db
    create_project(db, key)
    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(annotate_accepted_translations_only=False)
        )
    return Scenario(app, key, {})


def add_user(
    scenario: Scenario,
    name: str,
    roles: Iterable[str],
    *,
    languages: Iterable[str] = ("en", "de", "fr", "es", "it", "nl", "pt"),
    qualification: str | None = None,
) -> str:
    """A user ``{project}-{name}`` with the browser password and these roles."""
    from browser_server import TEST_PASSWORD

    accounts = scenario.app.state.accounts
    username = f"{scenario.key}-{name}"
    issued = accounts.create_user(Actor.cli(), username, username)
    accounts.redeem_code(username, issued.code, TEST_PASSWORD)
    scenario.app.state.memberships.add(Actor.cli(), scenario.key, username, list(roles))
    accounts.set_languages(Actor.cli(), username, list(languages))
    if qualification:
        accounts.update_profile(Actor.cli(), username, qualification=qualification)
    scenario.users[name] = username
    return username


def identity(scenario: Scenario, name: str) -> tuple[Access, Actor]:
    """The user's current project roles as an ``Access`` and its ``Actor``."""
    username = scenario.users[name]
    user = scenario.app.state.accounts.get_by_username(username)
    with scenario.db.transaction() as conn:
        roles = frozenset(
            conn.execute(
                sa_select(ProjectMembershipRow.role)
                .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
                .where(
                    ProjectRow.project_key == scenario.key,
                    ProjectMembershipRow.user_id == user.id,
                )
            ).scalars()
        )
    access = Access(user.id, user.pseudonym, False, {scenario.key: roles})  # type: ignore[arg-type]
    return access, Actor.user(user.id, username)


def import_texts(
    scenario: Scenario, units: list[Any]
) -> dict[tuple[str, str, int], str]:
    """Import every unit with one real import job and wait for its children.

    Returns the document ids keyed by ``(external_id, language, version)``.
    """
    from browser_server import run_fixture_import
    from t1_builders import bundle

    with tempfile.TemporaryDirectory() as folder:
        job = run_fixture_import(
            scenario.app, bundle(Path(folder), units), scenario.key
        )
    if job.status != "succeeded":
        raise HTTPException(500, job.error)
    _wait_for_children(scenario, job.id)
    from work_plan_support import plan_all

    # Every imported language version in the plan (review on translations).
    plan_all(scenario.db, scenario.key)
    return {
        (row.external_id, row.language, row.version): row.document_id
        for row in scenario.app.state.repo.list_variants(scenario.key)
    }


def _wait_for_children(scenario: Scenario, job_id: int, timeout: float = 30) -> None:
    """Corrections start re-anchor jobs; the scenario continues once all are done."""
    deadline = monotonic() + timeout
    while True:
        with scenario.db.transaction() as conn:
            states = list(
                conn.execute(
                    sa_select(JobRow.status, JobRow.error)
                    .join(ProjectRow, JobRow.project_id == ProjectRow.id)
                    .where(
                        ProjectRow.project_key == scenario.key,
                        JobRow.kind == "reanchor",
                        JobRow.payload["producer"]["kind"].as_string() == "import",
                        JobRow.payload["producer"]["job_id"].as_integer() == job_id,
                    )
                )
            )
        if any(state.status == "failed" for state in states):
            raise HTTPException(500, {"import_job_id": job_id, "children": "failed"})
        if all(state.status == "succeeded" for state in states):
            return
        if monotonic() >= deadline:
            raise HTTPException(500, {"error": "Import children did not finish"})
        sleep(0.05)


def assign(scenario: Scenario, document_id: str, name: str, task: str) -> int:
    from ontocurator.assignments.service import AssignmentService

    if task == "review":
        # D1: the consolidator's task, as a consolidation start creates it.
        from work_plan_support import review_task

        return int(
            review_task(scenario.db, scenario.key, document_id, scenario.users[name]).id
        )
    from auth_harness import harness_annotation

    with harness_annotation(scenario.db, scenario.key, document_id, task):
        return (
            AssignmentService(scenario.db)
            .assign(Actor.cli(), scenario.key, document_id, scenario.users[name], task)  # type: ignore[arg-type]
            .id
        )


def start_round(
    scenario: Scenario,
    assignment_id: int,
    name: str,
    *,
    kind: str = "ordinary",
    sources: list[str] | None = None,
    by: str | None = None,
    reason: str | None = None,
) -> Any:
    """Start a work round on ``assignment_id`` as ``by`` (default its owner)."""
    from ontocurator.application.work_rounds import WorkRoundService
    from ontocurator.assignments.service import AssignmentService

    access, actor = identity(scenario, by or name)
    with scenario.db.transaction() as conn:
        revision = AssignmentService._get(conn, assignment_id).workflow_revision
    return WorkRoundService(scenario.db).create(
        access,
        actor,
        assignment_id,
        request_id=f"round-{uuid4().hex}",
        expected_workflow_revision=revision,
        kind=kind,  # type: ignore[arg-type]
        source_submission_ids=sources or [],
        reason=reason,
    )


def finish_round(scenario: Scenario, name: str, workspace_key: Any) -> str:
    """Submit the round's (unchanged) draft as its owner; returns the submission id."""
    from ontocurator.application.submissions import SubmissionService
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.workspace import MutationEnvelope

    access, actor = identity(scenario, name)
    scoped = ScopedRepository(scenario.db, access, actor)
    draft = scoped.open_draft(workspace_key)
    return (
        SubmissionService(scoped, scenario.app.state.ontology_registry)
        .submit(
            workspace_key,
            MutationEnvelope(
                mutation_id=f"submit-{uuid4().hex}",
                expected_revision=draft.revision,
                payload={"document_checked": True},
            ),
        )
        .submission_id
    )


def submit(
    scenario: Scenario, document_id: str, name: str, task: str = "annotate"
) -> dict[str, Any]:
    """Assign, start round 1 and submit it; returns the ids of that work."""
    assignment_id = assign(scenario, document_id, name, task)
    started = start_round(scenario, assignment_id, name)
    submission_id = finish_round(scenario, name, started.workspace_key)
    return {
        "assignment_id": assignment_id,
        "round_id": started.round_id,
        "submission_id": submission_id,
    }


def in_progress(
    scenario: Scenario, document_id: str, name: str, task: str = "annotate"
) -> dict[str, Any]:
    """Assign and start round 1 without submitting it."""
    assignment_id = assign(scenario, document_id, name, task)
    started = start_round(scenario, assignment_id, name)
    return {"assignment_id": assignment_id, "round_id": started.round_id}


def select(
    scenario: Scenario, document_id: str, submission_id: str, name: str = "lead"
) -> dict[str, Any]:
    """Choose ``submission_id`` as the row's final result as lead ``name``."""
    from ontocurator.application.final_results import FinalResultService
    from ontocurator.storage.final_tables import FinalSelectionRow
    from ontocurator.storage.tables import DocumentRow

    access, actor = identity(scenario, name)
    with scenario.db.transaction() as conn:
        row = conn.execute(
            sa_select(DocumentRow.case_id, DocumentRow.language)
            .join(ProjectRow, ProjectRow.id == DocumentRow.project_id)
            .where(
                ProjectRow.project_key == scenario.key,
                DocumentRow.document_id == document_id,
            )
        ).one()
        revision = conn.execute(
            sa_select(FinalSelectionRow.revision)
            .join(ProjectRow, ProjectRow.id == FinalSelectionRow.project_id)
            .where(
                ProjectRow.project_key == scenario.key,
                FinalSelectionRow.case_id == row.case_id,
                FinalSelectionRow.language == row.language,
            )
        ).scalar_one_or_none()
    return FinalResultService(scenario.db, actor, access).select(
        scenario.key, document_id, submission_id, revision or 0, []
    )


def accept_translation(scenario: Scenario, document_id: str, name: str) -> int:
    """A qualified reviewer submits ``accepted_unchanged`` for ``document_id``."""
    from ontocurator.application.translation_reviews import TranslationReviewService

    assignment_id = assign(scenario, document_id, name, "translation_review")
    access, _actor = identity(scenario, name)
    review = TranslationReviewService(scenario.db, scenario.app.state.jobs)
    opened = review.open(access, assignment_id)
    revision = review.save_draft(
        access,
        assignment_id,
        expected_revision=opened.draft.revision,
        text=opened.text,
        form={"decision": "accepted_unchanged", "clinical_change": False},
    )
    review.submit(access, assignment_id, expected_revision=revision)
    return assignment_id


def result(
    scenario: Scenario,
    rows: list[tuple[str, str]],
    **ids: Any,
) -> dict[str, Any]:
    return {
        "project": scenario.key,
        "users": dict(scenario.users),
        "rows": [{"case_id": case, "language": language} for case, language in rows],
        **ids,
    }


# --- S0 to S5 ---------------------------------------------------------------------- #

SYNTHETIC = (
    "The patient is a 14-month-old girl with developmental delay and recurrent "
    "seizures. On examination she shows generalized hypotonia."
)
SYNTHETIC_DE = (
    "Die Patientin ist ein 14 Monate altes Mädchen mit Entwicklungsverzögerung und "
    "wiederkehrenden Anfällen. Bei der Untersuchung zeigt sie eine Hypotonie."
)


def build_s0(app: FastAPI) -> dict[str, Any]:
    """``synthetic-accepted``: en unassigned; de MT accepted with a selected
    Round 1 result, an unreviewed correction v2, open carry-forward work by the
    same annotator on v2 and a submitted review."""
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, "S0")
    case = "synthetic-accepted"
    source = native_unit("synthetic-accepted", "en", SYNTHETIC, case_id=case)
    target = translation_unit(
        "synthetic-accepted", "de", SYNTHETIC_DE, source=source, provider="Provider A"
    )
    corrected = correction_unit(target, SYNTHETIC_DE + " Korrigiert.")
    docs = import_texts(scenario, [source, target, corrected])
    v1, v2 = (
        docs[("synthetic-accepted", "de", 1)],
        docs[("synthetic-accepted", "de", 2)],
    )
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0004", ["annotator"])
    add_user(scenario, "ann-0003", ["adjudicator"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    accept_translation(scenario, v1, "translator")
    first = submit(scenario, v1, "ann-0004")
    select(scenario, v1, first["submission_id"])
    # The same annotator carries the selected result to the correction (open).
    carry_assignment = assign(scenario, v2, "ann-0004", "annotate")
    carried = start_round(
        scenario,
        carry_assignment,
        "ann-0004",
        kind="carry_forward",
        sources=[first["submission_id"]],
    )
    return result(
        scenario,
        [(case, "de"), (case, "en")],
        case_id=case,
        documents={"en": docs[("synthetic-accepted", "en", 1)], "v1": v1, "v2": v2},
        submissions={
            "selected": first["submission_id"],
        },
        rounds={"selected": first["round_id"], "carried": carried.round_id},
    )


def build_s1(app: FastAPI) -> dict[str, Any]:
    """``case-0042``: en native, two annotators submitted, final chosen."""
    from t1_builders import native_unit

    scenario = new_project(app, "S1")
    case = "case-0042"
    docs = import_texts(scenario, [native_unit(case, "en", SYNTHETIC, case_id=case)])
    doc = docs[(case, "en", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    first = submit(scenario, doc, "ann-0001")
    second = submit(scenario, doc, "ann-0002")
    select(scenario, doc, first["submission_id"])
    return result(
        scenario,
        [(case, "en")],
        case_id=case,
        documents={"en": doc},
        submissions={
            "selected": first["submission_id"],
            "other": second["submission_id"],
        },
    )


S2_LANGUAGES = ("de", "fr", "es", "it", "nl", "pt")


def build_s2(app: FastAPI) -> dict[str, Any]:
    """``case-0108``: en source and six MT languages; de failed its automatic
    check; finals on en, fr, es and it (4 of 7)."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S2")
    case = "case-0108"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    units = [source]
    for language in S2_LANGUAGES:
        checks = (
            (("units_added", False),) if language == "de" else (("units_added", True),)
        )
        units.append(
            translation_unit(
                case,
                language,
                f"{SYNTHETIC} ({language})",
                source=source,
                checks=checks,
                provider="Provider A",
            )
        )
    docs = import_texts(scenario, units)
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    submissions = {}
    for language in ("en", "fr", "es", "it"):
        done = submit(scenario, docs[(case, language, 1)], "ann-0001")
        select(scenario, docs[(case, language, 1)], done["submission_id"])
        submissions[language] = done["submission_id"]
    languages = ("en", *S2_LANGUAGES)
    return result(
        scenario,
        [(case, language) for language in languages],
        case_id=case,
        documents={language: docs[(case, language, 1)] for language in languages},
        submissions=submissions,
    )


def build_s3(app: FastAPI) -> dict[str, Any]:
    """``case-0211`` de chain: v1 MT accepted with the final on its Round 2,
    v2 correction accepted, v3 correction with an open translation review."""
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, "S3")
    case = "case-0211"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    v1_unit = translation_unit(case, "de", SYNTHETIC_DE, source=source)
    v2_unit = correction_unit(v1_unit, SYNTHETIC_DE + " Erste Korrektur.")
    v3_unit = correction_unit(v2_unit, SYNTHETIC_DE + " Zweite Korrektur.")
    docs = import_texts(scenario, [source, v1_unit, v2_unit, v3_unit])
    v1, v2, v3 = (docs[(case, "de", version)] for version in (1, 2, 3))
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    add_user(scenario, "reviewer", ["annotator"], qualification="Physician")
    accept_translation(scenario, v1, "translator")
    accept_translation(scenario, v2, "translator")
    work = submit(scenario, v1, "ann-0001")
    # Round 2: the lead restarts the work and the annotator submits again.
    restarted = start_round(
        scenario,
        work["assignment_id"],
        "ann-0001",
        kind="clean_restart",
        by="lead",
        reason="Restart after the source review",
    )
    final = finish_round(scenario, "ann-0001", restarted.workspace_key)
    select(scenario, v1, final)
    open_review = assign(scenario, v3, "reviewer", "translation_review")
    return result(
        scenario,
        [(case, "de"), (case, "en")],
        case_id=case,
        documents={"en": docs[(case, "en", 1)], "v1": v1, "v2": v2, "v3": v3},
        submissions={"round1": work["submission_id"], "selected": final},
        rounds={"round1": work["round_id"], "selected": restarted.round_id},
        open_review_assignment_id=open_review,
    )


def build_s4(app: FastAPI) -> dict[str, Any]:
    """``case-0305`` fr: two independent MT roots (Provider A, Provider B),
    one annotator in progress on each."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S4")
    case = "case-0305"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    first = translation_unit(
        "case-0305-a", "fr", f"{SYNTHETIC} (fr A)", source=source, provider="Provider A"
    )
    second = translation_unit(
        "case-0305-b",
        "fr",
        f"{SYNTHETIC} (fr B)",
        source=source,
        provider="Provider B",
        run_id="run-2",
    )
    docs = import_texts(scenario, [source, first, second])
    root_a, root_b = docs[("case-0305-a", "fr", 1)], docs[("case-0305-b", "fr", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    work_a = in_progress(scenario, root_a, "ann-0001")
    work_b = in_progress(scenario, root_b, "ann-0002")
    return result(
        scenario,
        [(case, "fr"), (case, "en")],
        case_id=case,
        documents={"en": docs[(case, "en", 1)], "a": root_a, "b": root_b},
        assignments={"a": work_a["assignment_id"], "b": work_b["assignment_id"]},
    )


def build_s5(app: FastAPI) -> dict[str, Any]:
    """``case-0377`` en: three annotation submissions and the lead's selected
    consolidation of two of them."""
    from t1_builders import native_unit

    scenario = new_project(app, "S5")
    case = "case-0377"
    docs = import_texts(scenario, [native_unit(case, "en", SYNTHETIC, case_id=case)])
    doc = docs[(case, "en", 1)]
    add_user(scenario, "lead", ["lead", "adjudicator"])
    names = ("ann-0001", "ann-0002", "ann-0003")
    for name in names:
        add_user(scenario, name, ["annotator"])
    inputs = [submit(scenario, doc, name)["submission_id"] for name in names]
    review = assign(scenario, doc, "lead", "review")
    consolidation = start_round(
        scenario, review, "lead", kind="consolidation", sources=inputs[:2]
    )
    output = finish_round(scenario, "lead", consolidation.workspace_key)
    select(scenario, doc, output)
    return result(
        scenario,
        [(case, "en")],
        case_id=case,
        documents={"en": doc},
        submissions={"inputs": inputs, "consolidation": output},
        rounds={"consolidation": consolidation.round_id},
    )


BUILDERS: dict[str, Builder] = {
    "S0": build_s0,
    "S1": build_s1,
    "S2": build_s2,
    "S3": build_s3,
    "S4": build_s4,
    "S5": build_s5,
    # S8 is the S0 data at a 390 px viewport.
    "S8": build_s0,
}


def registry() -> dict[str, Builder]:
    """Every scenario of the three builder modules (imported here: they use the
    helpers above)."""
    import browser_documents_scenarios_decisions as decisions
    import browser_documents_scenarios_rows as rows

    merged: dict[str, Builder] = {}
    for builders in (BUILDERS, rows.BUILDERS, decisions.BUILDERS):
        overlap = merged.keys() & builders.keys()
        if overlap:
            raise RuntimeError(f"Scenario defined twice: {sorted(overlap)}")
        merged.update(builders)
    return merged


def register_documents_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_documents__`` ahead of the static frontend."""

    @app.post("/__test_documents__")
    def documents_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = registry().get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown Documents scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
