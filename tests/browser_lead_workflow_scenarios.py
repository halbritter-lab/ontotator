"""Lead workflow browser scenarios (spec "Testing > Browser (Playwright)", D15).

``POST /__test_lead_workflow__?scenario=D15`` builds a fresh project
``lead-{scenario}-{uuid8}`` through the real services (one import per
scenario, ``WorkPlanService``, assignment, translation review, problem report
and final result services) and returns its identities::

    {project, users: {lead, ana, ben, annotator}, display_names, pseudonyms,
     bundle_path?, case_ids: {de?: [...], fr?: [...]}, rows: [{case_id, language}]}

Upload scenarios (``D15``, ``DEFAULT_IMPORT``) start empty and return the
absolute path of a bundle for ``page.setInputFiles``; their ``rows`` are the
rows the import will create. Test server only, never shipped.
"""

from __future__ import annotations

import tempfile
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any
from uuid import uuid4

from browser_documents_scenarios import (
    SYNTHETIC,
    Builder,
    Scenario,
    _wait_for_children,
    assign,
    identity,
    in_progress,
    select,
    submit,
)
from browser_documents_scenarios_rows import report, review_translation
from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import update

from ontotator.auth.audit import Actor
from ontotator.storage.tables import ProjectRow

LANGUAGES = ("en", "de", "fr")
PEOPLE = {
    "lead": "Project Lead",
    "ana": "Ana Weber",
    "ben": "Ben Roth",
    "annotator": "Cy Annotator",
}


def cases(first: int, count: int) -> tuple[str, ...]:
    return tuple(f"case-{n:04d}" for n in range(first, first + count))


D15_CASES = cases(101, 50)
D15_DE = D15_CASES[:20]
D15_FR = D15_CASES[20:]


# --- Project, people, units, import ------------------------------------------ #


def lead_project(
    app: FastAPI, name: str, *, import_plan: str = "nothing", rule_on: bool = True
) -> Scenario:
    """A fresh project with the lead, two reviewers and an annotator."""
    from t1_fixtures import create_project

    key = f"lead-{name.lower().replace('_', '-')}-{uuid4().hex[:8]}"
    create_project(app.state.repo.db, key)
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == key)
            .values(
                import_plan=import_plan, annotate_accepted_translations_only=rule_on
            )
        )
    scenario = Scenario(app, key, {})
    person(scenario, "lead", ["lead"])
    # Translation reviews need a qualification; both reviewers read en, de, fr.
    person(scenario, "ana", ["annotator"], qualification="Physician")
    person(scenario, "ben", ["annotator"], qualification="Physician")
    person(scenario, "annotator", ["annotator"])
    return scenario


def person(
    scenario: Scenario,
    name: str,
    roles: Iterable[str],
    *,
    qualification: str | None = None,
) -> str:
    """User ``{project}-{name}`` with display name ``PEOPLE[name]``."""
    from browser_server import TEST_PASSWORD

    accounts = scenario.app.state.accounts
    username = f"{scenario.key}-{name}"
    issued = accounts.create_user(Actor.cli(), username, PEOPLE[name])
    accounts.redeem_code(username, issued.code, TEST_PASSWORD)
    scenario.app.state.memberships.add(Actor.cli(), scenario.key, username, list(roles))
    languages = list(LANGUAGES) if name != "lead" else [*LANGUAGES, "es"]
    accounts.set_languages(Actor.cli(), username, languages)
    if qualification:
        accounts.update_profile(Actor.cli(), username, qualification=qualification)
    scenario.users[name] = username
    return username


def case_units(
    case_ids: Sequence[str],
    languages: Sequence[str],
    *,
    marked: Iterable[str] = (),
) -> list[Any]:
    """Per case an ``en`` source and machine translations (``marked`` cases
    carry ``translation.review.status == "reviewed"``, format 1.3)."""
    from t1_builders import native_unit, translation_unit

    marked = set(marked)
    units: list[Any] = []
    for case in case_ids:
        source = native_unit(case, "en", f"{SYNTHETIC} ({case})", case_id=case)
        units.append(source)
        for language in languages:
            unit = translation_unit(
                case, language, f"{SYNTHETIC} ({case}, {language})", source=source
            )
            units.append(package_reviewed(unit) if case in marked else unit)
    return units


def package_reviewed(unit: Any) -> Any:
    """The unit as format 1.3 with ``translation.review`` marked as reviewed;
    ontospan 1.2 reads a newer minor version leniently and keeps the field."""
    import ontospan

    translation = unit.document.translation.model_dump(mode="json")
    translation["review"] = {
        "status": "reviewed",
        "reviewer": "R. Roe",
        "reviewed_at": "2026-10-01T10:00:00Z",
    }
    return unit.model_copy(
        update={
            "schema_version": "1.3.0",
            "document": unit.document.model_copy(
                update={"translation": ontospan.Translation.model_validate(translation)}
            ),
        }
    )


def write_bundle(scenario: Scenario, units: list[Any]) -> Path:
    """A bundle in a fresh temp directory (kept for the browser upload)."""
    from t1_fixtures import bundle

    folder = Path(tempfile.mkdtemp(prefix=f"{scenario.key}-"))
    return bundle(folder / f"{scenario.key}.zip", units, f"bundle-{scenario.key}")


def import_units(scenario: Scenario, units: list[Any]) -> dict[tuple[str, str], str]:
    """One real import job; returns version-1 document ids by (case, language)."""
    from browser_server import run_fixture_import

    with tempfile.TemporaryDirectory() as folder:
        from t1_fixtures import bundle

        job = run_fixture_import(
            scenario.app, bundle(Path(folder) / "lead.zip", units), scenario.key
        )
    if job.status != "succeeded":
        raise HTTPException(500, job.error)
    _wait_for_children(scenario, job.id)
    return {
        (row.case_id, row.language): row.document_id
        for row in scenario.app.state.repo.list_variants(scenario.key)
        if row.version == 1
    }


# --- Services ------------------------------------------------------------------ #


def plan(
    scenario: Scenario,
    case_ids: Sequence[str],
    languages: dict[str, dict[str, str]],
) -> None:
    """Save a bulk plan as the lead (``{"de": {"review": "on", ...}}``)."""
    from ontotator.api.work_plan_routes import BulkPlanRequest
    from ontotator.application.work_plans import WorkPlanService

    access, actor = identity(scenario, "lead")
    WorkPlanService(scenario.db, actor, access).bulk_save(
        scenario.key,
        BulkPlanRequest.model_validate(
            {"case_ids": list(case_ids), "languages": languages, "confirm": True}
        ),
    )


def batch_assign(
    scenario: Scenario,
    case_ids: Sequence[str],
    language: str,
    task: str,
    names: Sequence[str],
) -> list[Any]:
    """Preview and commit a batch assignment as the lead."""
    from ontotator.assignments.batch import BatchAssignmentService, BatchSpec

    access, actor = identity(scenario, "lead")
    service = BatchAssignmentService(scenario.db, actor, access)
    spec = BatchSpec(
        task=task,  # type: ignore[arg-type]
        language=language,
        case_ids=tuple(case_ids),
        mode="one" if len(names) == 1 else "split",
        usernames=tuple(scenario.users[name] for name in names),
    )
    preview = service.preview(scenario.key, spec)
    return service.commit(scenario.key, spec, expected_digest=preview["digest"])


def accept_review(scenario: Scenario, assignment_id: int, name: str) -> None:
    """``name`` submits ``accepted_unchanged`` on its open translation review."""
    from ontotator.application.translation_reviews import TranslationReviewService

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


def result(
    scenario: Scenario,
    rows: Iterable[tuple[str, str]],
    **extra: Any,
) -> dict[str, Any]:
    accounts = scenario.app.state.accounts
    return {
        "project": scenario.key,
        "users": dict(scenario.users),
        "display_names": {name: PEOPLE[name] for name in scenario.users},
        "pseudonyms": {
            name: accounts.get_by_username(username).pseudonym
            for name, username in scenario.users.items()
        },
        "rows": [{"case_id": case, "language": lang} for case, lang in rows],
        **extra,
    }


def all_rows(
    case_ids: Sequence[str], languages: Sequence[str]
) -> list[tuple[str, str]]:
    return [(case, lang) for case in case_ids for lang in ("en", *languages)]


ON = "on"
OFF = "off"
REVIEW_AND_ANNOTATE = {"review": ON, "annotate": ON}


# --- Scenarios ------------------------------------------------------------------ #


def build_d15(app: FastAPI) -> dict[str, Any]:
    """Empty project ("Nothing planned", rule on) and a bundle of 50 cases with
    de, fr and es machine translations; 20 cases to plan for de, 30 for fr."""
    scenario = lead_project(app, "D15")
    languages = ("de", "fr", "es")
    path = write_bundle(scenario, case_units(D15_CASES, languages))
    return result(
        scenario,
        all_rows(D15_CASES, languages),
        bundle_path=str(path.resolve()),
        case_ids={"de": list(D15_DE), "fr": list(D15_FR)},
    )


def build_default_import(app: FastAPI) -> dict[str, Any]:
    """Empty project with "Review and annotate all translations" and a bundle
    of 3 cases (en source, de and fr machine translations)."""
    scenario = lead_project(
        app, "DEFAULT_IMPORT", import_plan="review_and_annotate_translations"
    )
    case_ids = cases(101, 3)
    path = write_bundle(scenario, case_units(case_ids, ("de", "fr")))
    return result(
        scenario,
        all_rows(case_ids, ("de", "fr")),
        bundle_path=str(path.resolve()),
        case_ids={"de": list(case_ids), "fr": list(case_ids)},
    )


def build_annotation_batch(app: FastAPI) -> dict[str, Any]:
    """20 de cases planned review + annotate, all reviews with Ana; 14 accepted
    (annotation "To assign"), 6 still in review ("waiting for review")."""
    scenario = lead_project(app, "ANNOTATION_BATCH")
    case_ids = cases(101, 20)
    import_units(scenario, case_units(case_ids, ("de",)))
    plan(scenario, case_ids, {"de": REVIEW_AND_ANNOTATE})
    created = batch_assign(scenario, case_ids, "de", "translation_review", ["ana"])
    by_case = {item.document_id.split("~")[0]: item.id for item in created}
    accepted = case_ids[:14]
    for case in accepted:
        accept_review(scenario, by_case[case], "ana")
    return result(
        scenario,
        all_rows(case_ids, ("de",)),
        case_ids={"de": list(case_ids)},
        accepted=list(accepted),
        in_review=list(case_ids[14:]),
    )


def build_fr_off(app: FastAPI) -> dict[str, Any]:
    """10 cases with fr review + annotate; open reviews by Ana (case-0101) and
    Ben (case-0102); a fr final result on case-0108."""
    scenario = lead_project(app, "FR_OFF")
    case_ids = cases(101, 10)
    docs = import_units(scenario, case_units(case_ids, ("fr",)))
    plan(scenario, case_ids, {"fr": REVIEW_AND_ANNOTATE})
    open_reviews = {"ana": "case-0101", "ben": "case-0102"}
    for name, case in open_reviews.items():
        assign(scenario, docs[(case, "fr")], name, "translation_review")
    final_case = "case-0108"
    final_doc = docs[(final_case, "fr")]
    review_translation(scenario, final_doc, "ana", "accepted_unchanged")
    work = submit(scenario, final_doc, "annotator")
    select(scenario, final_doc, work["submission_id"])
    return result(
        scenario,
        all_rows(case_ids, ("fr",)),
        case_ids={"fr": list(case_ids)},
        open_reviews=open_reviews,
        final_case=final_case,
        final_submission_id=work["submission_id"],
    )


def build_acceptance(app: FastAPI) -> dict[str, Any]:
    """Rule on, nothing planned; 30 fr translations, 18 marked as reviewed in
    the package (imported accepted), 12 not."""
    scenario = lead_project(app, "ACCEPTANCE")
    case_ids = cases(101, 30)
    marked = case_ids[:18]
    import_units(scenario, case_units(case_ids, ("fr",), marked=marked))
    return result(
        scenario,
        all_rows(case_ids, ("fr",)),
        case_ids={"fr": list(case_ids)},
        marked=list(marked),
        not_marked=list(case_ids[18:]),
    )


ROWS_CASES = {
    # fr Review only: one chip click turns review off (Undo restores).
    "chip": "case-0111",
    # fr review + annotate (rule on): Review off asks for the acceptance instead.
    "acceptance": "case-0101",
    "rejected": "case-0102",
    "report": "case-0103",
    "choose_final": "case-0104",
    "review_changes": "case-0105",
    "not_in_plan": "case-0126",
}
ROWS_REPORT = "The German text drops the second seizure episode; please check it."


def build_rows(app: FastAPI) -> dict[str, Any]:
    """30 cases (en, de, fr) with mixed plans: 0101-0110 de + fr review and
    annotate, 0111-0120 fr review only, 0121-0125 en annotate only, 0126-0130
    not in plan. de rows: 0102 rejected translation, 0103 open problem report,
    0104 annotation submitted (choose final), 0105 final restored to the plan
    (review changes)."""
    scenario = lead_project(app, "ROWS")
    case_ids = cases(101, 30)
    docs = import_units(scenario, case_units(case_ids, ("de", "fr")))
    plan(
        scenario, case_ids[:10], {"de": REVIEW_AND_ANNOTATE, "fr": REVIEW_AND_ANNOTATE}
    )
    plan(scenario, case_ids[10:20], {"fr": {"review": ON, "annotate": OFF}})
    plan(scenario, case_ids[20:25], {"source": {"annotate": ON}})

    def de(name: str) -> str:
        return docs[(ROWS_CASES[name], "de")]

    review_translation(scenario, de("rejected"), "ana", "rejected")
    for name in ("report", "choose_final", "review_changes"):
        review_translation(scenario, de(name), "ana", "accepted_unchanged")
    work = in_progress(scenario, de("report"), "annotator")
    filed = report(
        scenario, "annotator", work["assignment_id"], work["round_id"], ROWS_REPORT
    )
    submit(scenario, de("choose_final"), "annotator")
    final = submit(scenario, de("review_changes"), "annotator")
    select(scenario, de("review_changes"), final["submission_id"])
    # Annotate off and on again: the final returns with PLAN_RESTORED.
    restored = [ROWS_CASES["review_changes"]]
    plan(scenario, restored, {"de": {"annotate": OFF}})
    plan(scenario, restored, {"de": {"annotate": ON}})
    return result(
        scenario,
        all_rows(case_ids, ("de", "fr")),
        case_ids={"de": list(case_ids[:10]), "fr": list(case_ids[:20])},
        cases=dict(ROWS_CASES),
        report_id=filed.report_id,
        report_reason=ROWS_REPORT,
    )


LEAD_CORRECTION_CASES = {
    "rejected": "case-0101",
    "queried": "case-0102",
    "to_assign": "case-0103",
}


def rejected_translation_for_lead(app: FastAPI) -> dict[str, Any]:
    """Rule on, 3 cases with de review + annotate (spec F1): Ana rejected the
    de translation of case-0101 and queried case-0102 (both "your decision",
    no open review), case-0103 waits for its review. The lead (en, de, fr, es)
    has a qualification, so a lead correction starts without a prompt."""
    scenario = lead_project(app, "REJECTED_TRANSLATION_FOR_LEAD")
    scenario.app.state.accounts.update_profile(
        Actor.cli(), scenario.users["lead"], qualification="Physician"
    )
    case_ids = cases(101, 3)
    docs = import_units(scenario, case_units(case_ids, ("de",)))
    plan(scenario, case_ids, {"de": REVIEW_AND_ANNOTATE})
    for name, decision in (("rejected", "rejected"), ("queried", "query")):
        case = LEAD_CORRECTION_CASES[name]
        review_translation(scenario, docs[(case, "de")], "ana", decision)
    return result(
        scenario,
        all_rows(case_ids, ("de",)),
        case_ids={"de": list(case_ids)},
        cases=dict(LEAD_CORRECTION_CASES),
    )


BUILDERS: dict[str, Builder] = {
    "D15": build_d15,
    "DEFAULT_IMPORT": build_default_import,
    "ANNOTATION_BATCH": build_annotation_batch,
    "FR_OFF": build_fr_off,
    "ACCEPTANCE": build_acceptance,
    "ROWS": build_rows,
    "REJECTED_TRANSLATION_FOR_LEAD": rejected_translation_for_lead,
}


def register_lead_workflow_scenario_route(app: FastAPI) -> None:
    """Register ``POST /__test_lead_workflow__`` ahead of the static frontend."""

    @app.post("/__test_lead_workflow__")
    def lead_workflow_scenario(scenario: str = Query(...)) -> dict[str, Any]:
        builder = BUILDERS.get(scenario)
        if builder is None:
            raise HTTPException(404, f"Unknown lead workflow scenario {scenario!r}")
        return builder(app)

    app.router.routes.insert(0, app.router.routes.pop())
