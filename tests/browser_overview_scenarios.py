"""Documents overview browser scenarios (plan O10a); test server only.

``POST /__test_overview__?scenario=S7a`` builds a fresh project
``ovw-{scenario}-{uuid8}`` through the real services (import jobs, work plan,
assignments, translation reviews, work rounds, submissions, problem reports,
text changes and final results) and returns::

    {project, users: {lead, ana, tom, luc}, display_names, rows: [{case_id,
     language}], assignments: {name: assignment_id}, documents?, submissions?,
     bundle_path?}

``S1`` to ``S16`` (``S7a`` and ``S7b`` separately) hold the facts of the
plan's "Scenario table"; ``WALKTHROUGH`` is the empty project of the spec's
acceptance walkthrough with the bundle the lead imports in the browser.

``POST /__test_overview_act__`` with ``{project, actor, action, case_id,
language, preset?}`` performs one step of another person (never the lead's
clicks) through the same services; see ``ACTIONS``.
"""

from __future__ import annotations

import tempfile
from collections.abc import Callable, Iterable, Sequence
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from browser_documents_scenarios import (
    SYNTHETIC,
    Builder,
    Scenario,
    _wait_for_children,
    finish_round,
    identity,
    select,
    start_round,
)
from browser_documents_scenarios_rows import report, wait_for_jobs
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select as sa_select
from sqlalchemy import update

from ontotator.auth.audit import Actor
from ontotator.storage.tables import AssignmentRow, ProjectRow, UserRow

LANGUAGES = ("en", "de", "fr")
PEOPLE = {
    "lead": "Mia Kühn",
    "ana": "Ana Weber",
    "tom": "Tom Reis",
    "luc": "Luc Martin",
}
# Roles and qualification per person: Ana and Luc review translations and
# annotations (adjudicator), Tom annotates.
ROLES: dict[str, tuple[tuple[str, ...], str | None]] = {
    "lead": (("lead",), None),
    "ana": (("annotator", "adjudicator"), "Physician"),
    "tom": (("annotator",), None),
    "luc": (("annotator", "adjudicator"), "Physician"),
}
ON = "on"
OFF = "off"
BOTH = {"review": ON, "annotate": ON}

# Spanless findings by preset; every axis chosen (no "unconfirmed values").
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
SHARED = ("HP:0001250", "HP:0001252", "HP:0001284", "HP:0000365", "HP:0002133")
PRESETS: dict[str, tuple[str, ...]] = {
    # Walkthrough: Tom's v1 submission, Luc's v1 draft, and both v2
    # submissions (5 shared findings + 1 own each: "5 of 7 findings match",
    # Only here 1 / 1).
    "tom_v1": SHARED[:3],
    "luc_v1": SHARED[:2],
    "tom_v2": (*SHARED, "HP:0011146"),
    "luc_v2": (*SHARED, "HP:0000407"),
    # Scenario 7a: "3 findings".
    "three": SHARED[:3],
}
FINDING_NOTE = "Stated in the text as a whole."
CORRECTED_SUFFIX = " Korrigiert."
CORRECTION_REASON = "Dosis prüfen"
REPORT_REASON = (
    "Satz 3 unvollständig: die Dosisangabe fehlt im deutschen Text, bitte die "
    "Übersetzung prüfen."
)
# The lead's previous visit moves back past the 30-minute visit window (VD6).
VISIT_AGE = timedelta(minutes=31)


# --- Project, people, texts --------------------------------------------------- #


def overview_project(
    app: FastAPI,
    name: str,
    *,
    per_text: int = 1,
    import_plan: str = "nothing",
    rule_on: bool = True,
) -> Scenario:
    """A fresh project ``ovw-{name}-{uuid8}`` with Mia, Ana, Tom and Luc."""
    from t1_fixtures import create_project

    key = f"ovw-{name.lower().replace('_', '-')}-{uuid4().hex[:8]}"
    create_project(app.state.repo.db, key)
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(
                import_plan=import_plan,
                annotate_accepted_translations_only=rule_on,
                annotations_per_text=per_text,
            )
        )
    scenario = Scenario(app, key, {})
    for person in PEOPLE:
        add_person(scenario, person)
    return scenario


def add_person(scenario: Scenario, name: str) -> str:
    """User ``{project}-{name}`` with display name ``PEOPLE[name]``."""
    from browser_server import TEST_PASSWORD

    accounts = scenario.app.state.accounts
    username = f"{scenario.key}-{name}"
    issued = accounts.create_user(Actor.cli(), username, PEOPLE[name])
    accounts.redeem_code(username, issued.code, TEST_PASSWORD)
    roles, qualification = ROLES[name]
    scenario.app.state.memberships.add(Actor.cli(), scenario.key, username, list(roles))
    accounts.set_languages(Actor.cli(), username, list(LANGUAGES))
    if qualification:
        accounts.update_profile(Actor.cli(), username, qualification=qualification)
    scenario.users[name] = username
    return username


def existing(app: FastAPI, project: str) -> Scenario:
    """The scenario of an already built project (act route)."""
    return Scenario(app, project, {name: f"{project}-{name}" for name in PEOPLE})


def units(case: str, languages: Sequence[str]) -> list[Any]:
    """An ``en`` source of ``case`` and machine translations; a ``languages``
    entry ``"de!"`` fails its automatic check."""
    from t1_builders import native_unit, translation_unit

    source = native_unit(case, "en", f"{SYNTHETIC} ({case})", case_id=case)
    result = [source]
    for entry in languages:
        language = entry.rstrip("!")
        checks = (("units_added", not entry.endswith("!")),)
        result.append(
            translation_unit(
                case,
                language,
                f"{SYNTHETIC} ({case}, {language})",
                source=source,
                checks=checks,
            )
        )
    return result


def write_bundle(folder: Path, name: str, items: list[Any]) -> Path:
    from t1_fixtures import bundle

    return bundle(folder / f"{name}.zip", items, f"bundle-{name}")


def import_bundle(scenario: Scenario, items: list[Any]) -> Docs:
    """One real import job (unique bundle id); returns every document id."""
    from browser_server import run_fixture_import

    with tempfile.TemporaryDirectory() as folder:
        path = write_bundle(Path(folder), f"{scenario.key}-{uuid4().hex[:6]}", items)
        job = run_fixture_import(scenario.app, path, scenario.key)
    if job.status != "succeeded":
        raise HTTPException(500, job.error)
    _wait_for_children(scenario, job.id)
    return documents(scenario)


Docs = dict[tuple[str, str, int], str]


def documents(scenario: Scenario) -> Docs:
    return {
        (row.case_id, row.language, row.version): row.document_id
        for row in scenario.app.state.repo.list_variants(scenario.key)
    }


def newest(scenario: Scenario, case: str, language: str) -> str:
    """The newest version of the row (one chain per row in these scenarios)."""
    rows = [
        row
        for row in scenario.app.state.repo.list_variants(scenario.key)
        if (row.case_id, row.language) == (case, language)
    ]
    if not rows:
        raise HTTPException(404, f"No text {case} · {language}")
    return max(rows, key=lambda row: row.version).document_id


# --- Lead services ------------------------------------------------------------ #


def plan(scenario: Scenario, cases: Sequence[str], languages: dict[str, Any]) -> None:
    """Save a bulk plan as the lead (``{"de": {"review": "on", ...}}``)."""
    from ontotator.api.work_plan_routes import BulkPlanRequest
    from ontotator.application.work_plans import WorkPlanService

    access, actor = identity(scenario, "lead")
    WorkPlanService(scenario.db, actor, access).bulk_save(
        scenario.key,
        BulkPlanRequest.model_validate(
            {"case_ids": list(cases), "languages": languages, "confirm": True}
        ),
    )


def set_rows(
    scenario: Scenario, rows: dict[tuple[str, str], tuple[bool, bool]]
) -> None:
    """Exact (review, annotate) flags per row as the lead: the row counts as
    decided even when its flags do not change (a bulk save skips those)."""
    from ontotator.api.work_plan_routes import PlanRowsSet
    from ontotator.application.work_plans import WorkPlanService
    from ontotator.storage import work_plan_store

    access, actor = identity(scenario, "lead")
    cases = sorted({case for case, _language in rows})
    with scenario.db.transaction() as conn:
        pid = conn.execute(
            sa_select(ProjectRow.id).where(ProjectRow.project_key == scenario.key)
        ).scalar_one()
        revisions = work_plan_store.revisions(conn, pid, cases)
    WorkPlanService(scenario.db, actor, access).set_rows(
        scenario.key,
        PlanRowsSet.model_validate(
            {
                "rows": [
                    {
                        "case_id": case,
                        "language": language,
                        "review": review,
                        "annotate": annotate_on,
                    }
                    for (case, language), (review, annotate_on) in rows.items()
                ],
                "expected_revisions": revisions,
                "confirm": True,
            }
        ),
    )


def assign(scenario: Scenario, document_id: str, name: str, task: str) -> int:
    """The lead assigns ``task`` on ``document_id`` to ``name``."""
    from ontotator.assignments.service import AssignmentService

    _access, actor = identity(scenario, "lead")
    service = AssignmentService(scenario.db)
    if task == "review":
        # D1: the consolidator's task, created the way a consolidation start does.
        from sqlalchemy import select

        from ontotator.storage.tables import ProjectRow

        with scenario.db.transaction() as conn:
            project = (
                conn.execute(
                    select(ProjectRow).where(ProjectRow.project_key == scenario.key)
                )
                .mappings()
                .one()
            )
            target = service._target(conn, scenario.users[name])
            return service._assign_locked(
                conn, actor, project, document_id, target, "review", False
            ).id
    from auth_harness import harness_annotation

    with harness_annotation(scenario.db, scenario.key, document_id, task):
        return service.assign(
            actor,
            scenario.key,
            document_id,
            scenario.users[name],
            task,  # type: ignore[arg-type]
            confirm_unreviewed_translation=True,
        ).id


def batch_assign(
    scenario: Scenario, case: str, language: str, task: str, names: Sequence[str]
) -> list[int]:
    """Preview and commit a batch assignment of one text as the lead."""
    from ontotator.assignments.batch import BatchAssignmentService, BatchSpec

    access, actor = identity(scenario, "lead")
    service = BatchAssignmentService(scenario.db, actor, access)
    spec = BatchSpec(
        task=task,  # type: ignore[arg-type]
        language=language,
        case_ids=(case,),
        mode="one" if len(names) == 1 else "split",
        usernames=tuple(scenario.users[name] for name in names),
    )
    preview = service.preview(scenario.key, spec)
    return [
        item.id
        for item in service.commit(
            scenario.key,
            spec,
            expected_digest=preview["digest"],
            confirm_unreviewed_translation=True,
        )
    ]


def request_correction(scenario: Scenario, document_id: str, name: str) -> int:
    """The lead asks ``name`` to correct an accepted translation (D26)."""
    from ontotator.application.translation_workflow import (
        TranslationWorkflowService,
    )

    _access, actor = identity(scenario, "lead")
    variant = scenario.app.state.repo.get_variant(scenario.key, document_id)
    return int(
        TranslationWorkflowService(scenario.db, scenario.app.state.jobs)
        .assign_correction(
            actor,
            scenario.key,
            document_id,
            scenario.users[name],
            expected_text_sha256=variant.text_sha256,
            reason=CORRECTION_REASON,
            confirm_language=True,
        )
        .id
    )


def move_to_newest(scenario: Scenario, assignment_id: int, target: str) -> int:
    """Handle text change… → Move to v2: returns the new assignment id."""
    from ontotator.application.text_changes import TextChangeService

    access, actor = identity(scenario, "lead")
    with scenario.db.transaction() as conn:
        revision = conn.execute(
            sa_select(AssignmentRow.workflow_revision).where(
                AssignmentRow.id == assignment_id
            )
        ).scalar_one()
    return (
        TextChangeService(scenario.db, scenario.app.state.repo)
        .move_to_version(
            access,
            actor,
            assignment_id,
            target_document_id=target,
            expected_workflow_revision=int(revision),
            request_id=f"move-{uuid4().hex}",
        )
        .assignment_id
    )


def carry_to_author(scenario: Scenario, submission_id: str, target: str) -> Any:
    """Carry to v2… → the author continues on ``target``."""
    from ontotator.application.text_changes import TextChangeService

    access, actor = identity(scenario, "lead")
    return TextChangeService(scenario.db, scenario.app.state.repo).carry(
        access,
        actor,
        scenario.key,
        submission_id,
        target_document_id=target,
        mode="author",
        username=None,
        confirm_language=False,
        confirm_unreviewed_translation=True,
        request_id=f"carry-{uuid4().hex}",
    )


def start_consolidation(
    scenario: Scenario, document_id: str, name: str, sources: list[str]
) -> int:
    """Consolidate… → reviewer ``name`` → Start consolidation (as the lead)."""
    review = assign(scenario, document_id, name, "review")
    start_round(
        scenario, review, name, kind="consolidation", sources=sources, by="lead"
    )
    return review


# --- Other people's steps ------------------------------------------------------- #


def review_translation(
    scenario: Scenario,
    assignment_id: int,
    name: str,
    decision: str,
) -> Any:
    """``name`` submits ``decision`` on its open translation review;
    ``accepted_corrected`` appends ``CORRECTED_SUFFIX`` (accepted child v2)."""
    from ontotator.application.translation_reviews import TranslationReviewService

    access, _actor = identity(scenario, name)
    review = TranslationReviewService(scenario.db, scenario.app.state.jobs)
    opened = review.open(access, assignment_id)
    clinical = decision in {"rejected", "query"}
    form: dict[str, Any] = {"decision": decision, "clinical_change": clinical}
    if clinical:
        form |= {"categories": ["omission"], "rationale": "A finding is missing."}
    text = opened.text
    if decision == "accepted_corrected":
        text += CORRECTED_SUFFIX
    revision = review.save_draft(
        access,
        assignment_id,
        expected_revision=opened.draft.revision,
        text=text,
        form=form,
    )
    submitted = review.submit(access, assignment_id, expected_revision=revision)
    if decision == "accepted_corrected":
        wait_for_jobs(scenario)
    return submitted


def decide_translation(
    scenario: Scenario, document_id: str, name: str, decision: str
) -> int:
    """The lead assigns the translation review; ``name`` decides it."""
    assignment_id = assign(scenario, document_id, name, "translation_review")
    review_translation(scenario, assignment_id, name, decision)
    return assignment_id


def _scoped(scenario: Scenario, name: str) -> Any:
    from ontotator.authz.scoped import ScopedRepository

    access, actor = identity(scenario, name)
    return ScopedRepository(scenario.db, access, actor)


def _envelope(scoped: Any, workspace_key: Any, payload: dict[str, Any]) -> Any:
    from ontotator.domain.workspace import MutationEnvelope

    return MutationEnvelope(
        mutation_id=f"ovw-{uuid4().hex}",
        expected_revision=scoped.open_draft(workspace_key).revision,
        payload=payload,
    )


def _workspace(scenario: Scenario, assignment_id: int, name: str) -> Any:
    """The open round of the assignment (started now if it has none)."""
    with scenario.db.transaction() as conn:
        round_id = conn.execute(
            sa_select(AssignmentRow.active_round_id).where(
                AssignmentRow.id == assignment_id
            )
        ).scalar_one()
    if round_id is None:
        return start_round(scenario, assignment_id, name).workspace_key
    return scenario.app.state.repo.get_work_round(scenario.key, round_id).workspace_key


def add_findings(
    scenario: Scenario, name: str, workspace_key: Any, terms: Iterable[str]
) -> None:
    """Spanless findings for each of ``terms`` the draft does not hold yet."""
    from ontotator.application.editing import EditingService

    scoped = _scoped(scenario, name)
    present = {
        snapshot.annotation.term_id
        for snapshot in scoped.open_draft(workspace_key).annotations
    }
    editing = EditingService(scoped, scenario.app.state.ontology_registry)
    for term in terms:
        if term in present:
            continue
        payload = {
            "command": "create_annotation",
            "annotation_id": f"ann-{uuid4().hex[:12]}",
            "term_id": term,
            "layer_id": "hpo",
            "type_id": "phenotype",
            "axes_values": dict(AXES),
            "chosen_axis_ids": list(AXES),
            # Spanless findings need a note (rule spanless_note_required).
            "note": FINDING_NOTE,
        }
        editing.apply(workspace_key, _envelope(scoped, workspace_key, payload))
        present.add(term)


def resolve_inputs(scenario: Scenario, name: str, workspace_key: Any) -> int:
    """Check every carried or moved finding of the round: complete it where it
    is in the draft, dismiss it where it could not be placed."""
    from ontotator.application.work_rounds import RoundInputResolutionService
    from ontotator.domain.work_rounds import CARRY_ROUND_KINDS

    round_id = workspace_key.round_id
    repo = scenario.app.state.repo
    if (
        round_id is None
        or repo.get_work_round(scenario.key, round_id).kind not in CARRY_ROUND_KINDS
    ):
        return 0
    inputs = repo.get_round_input_inventory(scenario.key, round_id)
    for item in inputs:
        scoped = _scoped(scenario, name)
        target = item.get("target_snapshot")
        payload: dict[str, Any] = {"input_id": item["input_id"], "outcome": "dismissed"}
        if target is not None:
            carried_id = target["annotation"]["annotation_id"]
            carried = next(
                (
                    snapshot
                    for snapshot in scoped.open_draft(workspace_key).annotations
                    if snapshot.annotation.annotation_id == carried_id
                ),
                None,
            )
            if carried is not None:
                payload = {
                    "input_id": item["input_id"],
                    "outcome": "completed",
                    "annotation_ref": {
                        "annotation_id": carried_id,
                        "version": carried.version,
                    },
                }
        RoundInputResolutionService(scoped).resolve(
            workspace_key, _envelope(scoped, workspace_key, payload)
        )
    return len(inputs)


def annotate(
    scenario: Scenario,
    assignment_id: int,
    name: str,
    terms: Iterable[str] = (),
    *,
    submit: bool = True,
) -> dict[str, Any]:
    """Work on an annotate assignment: resolve carried inputs, add ``terms``
    and (``submit``) submit the round."""
    workspace_key = _workspace(scenario, assignment_id, name)
    resolved = resolve_inputs(scenario, name, workspace_key)
    add_findings(scenario, name, workspace_key, terms)
    result: dict[str, Any] = {
        "assignment_id": assignment_id,
        "round_id": workspace_key.round_id,
        "resolved_inputs": resolved,
    }
    if submit:
        result["submission_id"] = finish_round(scenario, name, workspace_key)
    return result


def assign_and_annotate(
    scenario: Scenario,
    document_id: str,
    name: str,
    terms: Iterable[str] = (),
    *,
    submit: bool = True,
) -> dict[str, Any]:
    return annotate(
        scenario,
        assign(scenario, document_id, name, "annotate"),
        name,
        terms,
        submit=submit,
    )


def open_assignment(
    scenario: Scenario, name: str, case: str, language: str, task: str
) -> int:
    """``name``'s open, unrevoked ``task`` assignment on the row (newest first)."""
    variants = {
        row.document_id: row.version
        for row in scenario.app.state.repo.list_variants(scenario.key)
        if (row.case_id, row.language) == (case, language)
    }
    with scenario.db.transaction() as conn:
        rows = conn.execute(
            sa_select(AssignmentRow.id, AssignmentRow.document_id)
            .join(ProjectRow, ProjectRow.id == AssignmentRow.project_id)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(
                ProjectRow.project_key == scenario.key,
                UserRow.username == scenario.users[name],
                AssignmentRow.task == task,
                AssignmentRow.revoked_at.is_(None),
                AssignmentRow.status != "submitted",
                AssignmentRow.document_id.in_(list(variants)),
            )
        ).all()
    if not rows:
        raise HTTPException(
            409, f"{PEOPLE[name]} has no open {task} task on {case} · {language}"
        )
    return int(max(rows, key=lambda row: (variants[row.document_id], row.id)).id)


def submit_consolidation(
    scenario: Scenario, name: str, case: str, language: str
) -> str:
    """``name`` confirms every input finding of its consolidation and submits."""
    from ontotator.application.reviews import ReviewService
    from ontotator.application.workspaces import WorkspaceService

    assignment_id = open_assignment(scenario, name, case, language, "review")
    workspace_key = _workspace(scenario, assignment_id, name)
    scoped = _scoped(scenario, name)
    view = WorkspaceService(scoped, scenario.app.state.ontology_registry).open(
        workspace_key
    )
    for target in view.targets.targets:
        ReviewService(scoped).decide(
            workspace_key,
            _envelope(
                scoped,
                workspace_key,
                {"target": target.model_dump(), "outcome": "confirmed"},
            ),
        )
    return finish_round(scenario, name, workspace_key)


def report_problem(scenario: Scenario, name: str, assignment_id: int) -> Any:
    """``name`` reports ``REPORT_REASON`` on its started annotate task."""
    workspace_key = _workspace(scenario, assignment_id, name)
    return report(scenario, name, assignment_id, workspace_key.round_id, REPORT_REASON)


def age_visit(scenario: Scenario) -> int:
    """Move the lead's last Documents visit back past the visit window."""
    from ontotator.storage.overview_tables import DocumentsVisitRow

    with scenario.db.transaction() as conn:
        pid = conn.execute(
            sa_select(ProjectRow.id).where(ProjectRow.project_key == scenario.key)
        ).scalar_one()
        uid = conn.execute(
            sa_select(UserRow.id).where(UserRow.username == scenario.users["lead"])
        ).scalar_one()
        moved = conn.execute(
            update(DocumentsVisitRow)
            .where(
                DocumentsVisitRow.project_id == pid,
                DocumentsVisitRow.user_id == uid,
            )
            .values(last_seen_at=DocumentsVisitRow.last_seen_at - VISIT_AGE)
        )
    return int(moved.rowcount)


# --- Result ---------------------------------------------------------------------- #


def result(
    scenario: Scenario,
    rows: Iterable[tuple[str, str]],
    assignments: dict[str, int] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "project": scenario.key,
        "users": dict(scenario.users),
        "display_names": {name: PEOPLE[name] for name in scenario.users},
        "rows": [{"case_id": case, "language": lang} for case, lang in rows],
        "assignments": dict(assignments or {}),
        **extra,
    }


# --- Scenarios 1-16 ---------------------------------------------------------------- #


def build_s1(app: FastAPI) -> dict[str, Any]:
    """case-101: "Nothing planned"; de undecided (system row), en decided by
    the lead with Annotate off."""
    scenario = overview_project(app, "S1")
    import_bundle(scenario, units("case-101", ("de",)))
    set_rows(scenario, {("case-101", "en"): (False, False)})
    return result(scenario, [("case-101", "de"), ("case-101", "en")])


def build_s2(app: FastAPI) -> dict[str, Any]:
    """case-102 de: Review on, automatic check failed, no reviewer."""
    scenario = overview_project(app, "S2")
    import_bundle(scenario, units("case-102", ("de!",)))
    plan(scenario, ["case-102"], {"de": BOTH})
    return result(scenario, [("case-102", "de")])


def build_s3(app: FastAPI) -> dict[str, Any]:
    """case-103 de: translation review open, Ana."""
    scenario = overview_project(app, "S3")
    docs = import_bundle(scenario, units("case-103", ("de",)))
    plan(scenario, ["case-103"], {"de": BOTH})
    review = assign(scenario, docs[("case-103", "de", 1)], "ana", "translation_review")
    return result(scenario, [("case-103", "de")], {"ana_review": review})


def build_s4(app: FastAPI) -> dict[str, Any]:
    """case-104: Ana rejected de, Luc queried fr."""
    scenario = overview_project(app, "S4")
    docs = import_bundle(scenario, units("case-104", ("de", "fr")))
    plan(scenario, ["case-104"], {"de": BOTH, "fr": BOTH})
    rejected = decide_translation(
        scenario, docs[("case-104", "de", 1)], "ana", "rejected"
    )
    queried = decide_translation(scenario, docs[("case-104", "fr", 1)], "luc", "query")
    return result(
        scenario,
        [("case-104", "de"), ("case-104", "fr")],
        {"ana_review": rejected, "luc_review": queried},
    )


def build_s5(app: FastAPI) -> dict[str, Any]:
    """case-105 de, per text 2: Ana accepted with corrections (v2), no
    annotate assignment."""
    scenario = overview_project(app, "S5", per_text=2)
    docs = import_bundle(scenario, units("case-105", ("de",)))
    plan(scenario, ["case-105"], {"de": BOTH})
    review = decide_translation(
        scenario, docs[("case-105", "de", 1)], "ana", "accepted_corrected"
    )
    return result(scenario, [("case-105", "de")], {"ana_review": review})


def _accepted(
    name: str, case: str, *, per_text: int = 1, app: FastAPI
) -> tuple[Scenario, str]:
    """A project whose ``case`` de translation Ana accepted unchanged."""
    scenario = overview_project(app, name, per_text=per_text)
    docs = import_bundle(scenario, units(case, ("de",)))
    plan(scenario, [case], {"de": BOTH})
    de = docs[(case, "de", 1)]
    decide_translation(scenario, de, "ana", "accepted_unchanged")
    return scenario, de


def build_s6(app: FastAPI) -> dict[str, Any]:
    """case-106 de, per text 2: accepted; Ana submitted, Tom open."""
    scenario, de = _accepted("S6", "case-106", per_text=2, app=app)
    ana = assign_and_annotate(scenario, de, "ana", PRESETS["three"])
    tom = assign_and_annotate(scenario, de, "tom", submit=False)
    return result(
        scenario,
        [("case-106", "de")],
        {"ana": ana["assignment_id"], "tom": tom["assignment_id"]},
        submissions={"ana": ana["submission_id"]},
    )


def build_s7a(app: FastAPI) -> dict[str, Any]:
    """case-107 de, per text 1: accepted; Ana submitted 3 findings, no final."""
    scenario, de = _accepted("S7a", "case-107", app=app)
    ana = assign_and_annotate(scenario, de, "ana", PRESETS["three"])
    return result(
        scenario,
        [("case-107", "de")],
        {"ana": ana["assignment_id"]},
        submissions={"ana": ana["submission_id"]},
    )


def build_s7b(app: FastAPI) -> dict[str, Any]:
    """case-107 en source, per text 2: Ana and Tom submitted the same three
    findings (all match, the row reads "Accept result…"), no final."""
    scenario = overview_project(app, "S7b", per_text=2)
    docs = import_bundle(scenario, units("case-107", ()))
    plan(scenario, ["case-107"], {"source": {"annotate": ON}})
    en = docs[("case-107", "en", 1)]
    ana = assign_and_annotate(scenario, en, "ana", PRESETS["three"])
    tom = assign_and_annotate(scenario, en, "tom", PRESETS["tom_v1"])
    return result(
        scenario,
        [("case-107", "en")],
        {"ana": ana["assignment_id"], "tom": tom["assignment_id"]},
        submissions={"ana": ana["submission_id"], "tom": tom["submission_id"]},
    )


def build_s8(app: FastAPI) -> dict[str, Any]:
    """case-108 de, per text 2: accepted, two submissions, a consolidation
    open by Luc (D1: was an annotation review)."""
    scenario, de = _accepted("S8", "case-108", per_text=2, app=app)
    ana = assign_and_annotate(scenario, de, "ana", PRESETS["three"])
    tom = assign_and_annotate(scenario, de, "tom", PRESETS["tom_v1"])
    review = start_consolidation(
        scenario, de, "luc", [ana["submission_id"], tom["submission_id"]]
    )
    return result(
        scenario,
        [("case-108", "de")],
        {
            "ana": ana["assignment_id"],
            "tom": tom["assignment_id"],
            "luc_review": review,
        },
    )


def build_s9(app: FastAPI) -> dict[str, Any]:
    """case-109 de: accepted; Tom's annotate task held by his open report."""
    scenario, de = _accepted("S9", "case-109", app=app)
    tom = assign_and_annotate(scenario, de, "tom", submit=False)
    filed = report_problem(scenario, "tom", tom["assignment_id"])
    return result(
        scenario,
        [("case-109", "de")],
        {"tom": tom["assignment_id"]},
        report_id=filed.report_id,
        report_reason=REPORT_REASON,
    )


def build_s10(app: FastAPI) -> dict[str, Any]:
    """case-110 de: Review on, Annotate off; accepted unchanged."""
    scenario = overview_project(app, "S10")
    docs = import_bundle(scenario, units("case-110", ("de",)))
    plan(scenario, ["case-110"], {"de": {"review": ON, "annotate": OFF}})
    review = decide_translation(
        scenario, docs[("case-110", "de", 1)], "ana", "accepted_unchanged"
    )
    return result(scenario, [("case-110", "de")], {"ana_review": review})


def build_s11(app: FastAPI) -> dict[str, Any]:
    """case-111, per text 2: de final Round 1 · Ana; fr final a consolidation
    by Luc (of Ana's and Tom's submissions); en Annotate off."""
    scenario = overview_project(app, "S11", per_text=2)
    docs = import_bundle(scenario, units("case-111", ("de", "fr")))
    plan(scenario, ["case-111"], {"de": BOTH, "fr": BOTH})
    set_rows(scenario, {("case-111", "en"): (False, False)})
    de, fr = docs[("case-111", "de", 1)], docs[("case-111", "fr", 1)]
    for document in (de, fr):
        decide_translation(scenario, document, "ana", "accepted_unchanged")
    de_ana = assign_and_annotate(scenario, de, "ana", PRESETS["three"])
    assign_and_annotate(scenario, de, "tom", PRESETS["tom_v1"])
    select(scenario, de, de_ana["submission_id"])
    fr_inputs = [
        assign_and_annotate(scenario, fr, name, PRESETS["three"])["submission_id"]
        for name in ("ana", "tom")
    ]
    review = start_consolidation(scenario, fr, "luc", fr_inputs)
    consolidation = submit_consolidation(scenario, "luc", "case-111", "fr")
    select(scenario, fr, consolidation)
    return result(
        scenario,
        [("case-111", "de"), ("case-111", "fr"), ("case-111", "en")],
        {"luc_review": review},
        submissions={"de_final": de_ana["submission_id"], "fr_final": consolidation},
    )


def build_s12(app: FastAPI) -> dict[str, Any]:
    """case-112 de: Tom's annotation open on v1; a re-review by Ana then
    accepted a correction (v2)."""
    scenario, de = _accepted("S12", "case-112", app=app)
    tom = assign_and_annotate(scenario, de, "tom", PRESETS["luc_v1"], submit=False)
    review = request_correction(scenario, de, "ana")
    review_translation(scenario, review, "ana", "accepted_corrected")
    return result(
        scenario,
        [("case-112", "de")],
        {"tom": tom["assignment_id"], "ana_review": review},
        documents={"v1": de, "v2": newest(scenario, "case-112", "de")},
    )


def build_s13(app: FastAPI) -> dict[str, Any]:
    """case-113 de: Ana submitted on v1 (no final); then correction v2 accepted."""
    scenario, de = _accepted("S13", "case-113", app=app)
    ana = assign_and_annotate(scenario, de, "ana", PRESETS["three"])
    review = request_correction(scenario, de, "ana")
    review_translation(scenario, review, "ana", "accepted_corrected")
    return result(
        scenario,
        [("case-113", "de")],
        {"ana": ana["assignment_id"], "ana_review": review},
        documents={"v1": de, "v2": newest(scenario, "case-113", "de")},
        submissions={"ana": ana["submission_id"]},
    )


def build_s14(app: FastAPI) -> dict[str, Any]:
    """case-114 de: final Round 1 · Ana on v1; then correction v2 accepted
    (``SELECTED_TEXT_CORRECTED``)."""
    scenario, de = _accepted("S14", "case-114", app=app)
    ana = assign_and_annotate(scenario, de, "ana", PRESETS["three"])
    select(scenario, de, ana["submission_id"])
    review = request_correction(scenario, de, "ana")
    review_translation(scenario, review, "ana", "accepted_corrected")
    return result(
        scenario,
        [("case-114", "de")],
        {"ana": ana["assignment_id"], "ana_review": review},
        documents={"v1": de, "v2": newest(scenario, "case-114", "de")},
        submissions={"final": ana["submission_id"]},
    )


def build_s15(app: FastAPI) -> dict[str, Any]:
    """case-115: de v1 accepted, Tom submitted, final chosen; then the en
    source is corrected (v2) by a second import."""
    from t1_builders import correction_unit

    scenario = overview_project(app, "S15")
    items = units("case-115", ("de",))
    docs = import_bundle(scenario, items)
    plan(scenario, ["case-115"], {"de": BOTH})
    set_rows(scenario, {("case-115", "en"): (False, False)})
    de = docs[("case-115", "de", 1)]
    decide_translation(scenario, de, "ana", "accepted_unchanged")
    tom = assign_and_annotate(scenario, de, "tom", PRESETS["tom_v1"])
    select(scenario, de, tom["submission_id"])
    source = items[0]
    import_bundle(
        scenario,
        [correction_unit(source, f"{source.document.text} She also has a rash.")],
    )
    return result(
        scenario,
        [("case-115", "en"), ("case-115", "de")],
        {"tom": tom["assignment_id"]},
        submissions={"final": tom["submission_id"]},
    )


def build_s16(app: FastAPI) -> dict[str, Any]:
    """case-116 de: accepted v1; Tom's annotation open on v1; a correction
    re-review by Ana ("Dosis prüfen") open."""
    scenario, de = _accepted("S16", "case-116", app=app)
    tom = assign_and_annotate(scenario, de, "tom", submit=False)
    review = request_correction(scenario, de, "ana")
    return result(
        scenario,
        [("case-116", "de")],
        {"tom": tom["assignment_id"], "ana_review": review},
    )


WALKTHROUGH_CASE = "case-201"


def build_walkthrough(app: FastAPI) -> dict[str, Any]:
    """Per text 2, rule on, "Review and annotate all translations"; case-201
    (en source, de machine translation) not imported: the bundle is returned
    for the lead's browser upload."""
    scenario = overview_project(
        app,
        "WALKTHROUGH",
        per_text=2,
        import_plan="review_and_annotate_translations",
    )
    # A real-looking name for the handbook images (the default is "Project").
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(name="Neuro cohort 2026")
        )
    folder = Path(tempfile.mkdtemp(prefix=f"{scenario.key}-"))
    path = write_bundle(folder, scenario.key, units(WALKTHROUGH_CASE, ("de",)))
    return result(
        scenario,
        [(WALKTHROUGH_CASE, "en"), (WALKTHROUGH_CASE, "de")],
        bundle_path=str(path.resolve()),
        case_id=WALKTHROUGH_CASE,
    )


BUILDERS: dict[str, Builder] = {
    "S1": build_s1,
    "S2": build_s2,
    "S3": build_s3,
    "S4": build_s4,
    "S5": build_s5,
    "S6": build_s6,
    "S7a": build_s7a,
    "S7b": build_s7b,
    "S8": build_s8,
    "S9": build_s9,
    "S10": build_s10,
    "S11": build_s11,
    "S12": build_s12,
    "S13": build_s13,
    "S14": build_s14,
    "S15": build_s15,
    "S16": build_s16,
    "WALKTHROUGH": build_walkthrough,
}


# --- Act route ------------------------------------------------------------------- #


class ActRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project: str
    actor: str
    action: str
    case_id: str = WALKTHROUGH_CASE
    language: str = "de"
    preset: str | None = None


def _terms(body: ActRequest) -> tuple[str, ...]:
    if body.preset is None:
        return ()
    if body.preset not in PRESETS:
        raise HTTPException(422, f"Unknown preset {body.preset!r}")
    return PRESETS[body.preset]


def _act_accept(scenario: Scenario, body: ActRequest) -> dict[str, Any]:
    review = open_assignment(
        scenario, body.actor, body.case_id, body.language, "translation_review"
    )
    review_translation(scenario, review, body.actor, "accepted_unchanged")
    return {"assignment_id": review}


def _act_correct(scenario: Scenario, body: ActRequest) -> dict[str, Any]:
    review = open_assignment(
        scenario, body.actor, body.case_id, body.language, "translation_review"
    )
    review_translation(scenario, review, body.actor, "accepted_corrected")
    return {
        "assignment_id": review,
        "document_id": newest(scenario, body.case_id, body.language),
    }


def _act_annotate(submit: bool) -> Callable[[Scenario, ActRequest], dict[str, Any]]:
    def act(scenario: Scenario, body: ActRequest) -> dict[str, Any]:
        assignment_id = open_assignment(
            scenario, body.actor, body.case_id, body.language, "annotate"
        )
        return annotate(
            scenario, assignment_id, body.actor, _terms(body), submit=submit
        )

    return act


def _act_consolidation(scenario: Scenario, body: ActRequest) -> dict[str, Any]:
    return {
        "submission_id": submit_consolidation(
            scenario, body.actor, body.case_id, body.language
        )
    }


def _act_report(scenario: Scenario, body: ActRequest) -> dict[str, Any]:
    assignment_id = open_assignment(
        scenario, body.actor, body.case_id, body.language, "annotate"
    )
    filed = report_problem(scenario, body.actor, assignment_id)
    return {"assignment_id": assignment_id, "report_id": filed.report_id}


def _act_age_visit(scenario: Scenario, body: ActRequest) -> dict[str, Any]:
    return {"visits": age_visit(scenario)}


Act = Callable[[Scenario, ActRequest], dict[str, Any]]
ACTIONS: dict[str, Act] = {
    # Ana: accepted unchanged / accepted with corrections (→ v2).
    "accept_review": _act_accept,
    "correct_translation": _act_correct,
    # Start (if needed), add the preset's findings and submit.
    "submit_annotation": _act_annotate(True),
    # Start (if needed) and add the preset's findings as a draft (Luc's v1
    # draft the move carries to v2).
    "draft_annotation": _act_annotate(False),
    # Check every carried or moved finding, add the preset's and submit.
    "resolve_carried_and_submit": _act_annotate(True),
    "submit_consolidation": _act_consolidation,
    "report_problem": _act_report,
    # The lead's previous visit 31 minutes back (NEW after the next visit).
    "age_visit": _act_age_visit,
}


def act(app: FastAPI, body: ActRequest) -> dict[str, Any]:
    perform = ACTIONS.get(body.action)
    if perform is None:
        raise HTTPException(404, f"Unknown overview action {body.action!r}")
    if body.actor not in PEOPLE:
        raise HTTPException(422, f"Unknown person {body.actor!r}")
    if body.actor == "lead" and body.action != "age_visit":
        raise HTTPException(422, "The lead's steps are browser clicks")
    return {"action": body.action, **perform(existing(app, body.project), body)}


def register_overview_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_overview__`` and ``POST /__test_overview_act__``
    ahead of the static frontend."""

    @app.post("/__test_overview__")
    def overview_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = BUILDERS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown overview scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())

    @app.post("/__test_overview_act__")
    def overview_act(body: ActRequest) -> dict[str, Any]:
        return act(app, body)

    app.router.routes.insert(0, app.router.routes.pop())
