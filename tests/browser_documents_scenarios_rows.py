"""Documents browser scenarios S6, S7, S9, S10 and S12 (WP P2).

Builders use the helpers of ``browser_documents_scenarios``; the route there
merges this registry. Helpers only these scenarios need live here.
"""

from __future__ import annotations

from time import monotonic, sleep
from typing import Any
from uuid import uuid4

from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Builder,
    Scenario,
    accept_translation,
    add_user,
    assign,
    identity,
    import_texts,
    in_progress,
    new_project,
    result,
    select,
    submit,
)
from fastapi import FastAPI, HTTPException
from sqlalchemy import select as sa_select

from ontocurator.storage.tables import JobRow, ProjectRow

# --- Helpers of this module ---------------------------------------------------- #


def report(
    scenario: Scenario, name: str, assignment_id: int, round_id: str, reason: str
) -> Any:
    """``name`` reports a problem on its own task; the task is paused."""
    from ontocurator.application.problem_reports import ProblemReportService
    from ontocurator.assignments.service import AssignmentService

    access, actor = identity(scenario, name)
    with scenario.db.transaction() as conn:
        revision = AssignmentService._get(conn, assignment_id).workflow_revision
    return ProblemReportService(scenario.db).report(
        access,
        actor,
        assignment_id,
        request_id=f"report-{uuid4().hex}",
        expected_workflow_revision=revision,
        reason=reason,
        round_id=round_id,
    )


def act(
    scenario: Scenario,
    report_view: Any,
    action: str,
    reason: str,
    assignment_ids: list[int] | None = None,
    name: str = "lead",
) -> Any:
    """The lead acts on a report (``resolve`` keeps every pause)."""
    from ontocurator.application.problem_reports import ProblemReportService

    access, actor = identity(scenario, name)
    return ProblemReportService(scenario.db).act(
        access,
        actor,
        report_view.report_id,
        request_id=f"act-{uuid4().hex}",
        expected_revision=report_view.revision,
        action=action,  # type: ignore[arg-type]
        reason=reason,
        assignment_ids=assignment_ids,
    )


def review_translation(
    scenario: Scenario,
    document_id: str,
    name: str,
    decision: str,
    *,
    text: str | None = None,
) -> Any:
    """A qualified reviewer submits ``decision`` for ``document_id``.

    ``rejected`` and ``query`` carry a clinical change; ``accepted_corrected``
    needs the changed ``text`` and creates an accepted child correction.
    """
    from ontocurator.application.translation_reviews import TranslationReviewService

    assignment_id = assign(scenario, document_id, name, "translation_review")
    access, _actor = identity(scenario, name)
    review = TranslationReviewService(scenario.db, scenario.app.state.jobs)
    opened = review.open(access, assignment_id)
    clinical = decision in {"rejected", "query"}
    form: dict[str, Any] = {"decision": decision, "clinical_change": clinical}
    if clinical:
        form |= {"categories": ["omission"], "rationale": "A finding is missing."}
    revision = review.save_draft(
        access,
        assignment_id,
        expected_revision=opened.draft.revision,
        text=text if text is not None else opened.text,
        form=form,
    )
    return review.submit(access, assignment_id, expected_revision=revision)


def wait_for_jobs(scenario: Scenario, timeout: float = 30) -> None:
    """Wait until no job of the project is queued or running."""
    deadline = monotonic() + timeout
    while True:
        with scenario.db.transaction() as conn:
            states = list(
                conn.execute(
                    sa_select(JobRow.status)
                    .join(ProjectRow, JobRow.project_id == ProjectRow.id)
                    .where(ProjectRow.project_key == scenario.key)
                ).scalars()
            )
        if "failed" in states:
            raise HTTPException(500, {"error": "A scenario job failed"})
        if all(state == "succeeded" for state in states):
            return
        if monotonic() >= deadline:
            raise HTTPException(500, {"error": "Scenario jobs did not finish"})
        sleep(0.05)


# --- S6, S7, S9, S10, S12 ------------------------------------------------------- #

S6_REASON = (
    "The German text drops the second seizure episode; please check the "
    "translation before I continue the annotation."
)


def build_s6(app: FastAPI) -> dict[str, Any]:
    """``case-0390`` de: ann-0001 reports a problem on its open work; the
    report is open and the task is paused."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S6")
    case = "case-0390"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    target = translation_unit(case, "de", SYNTHETIC_DE, source=source)
    docs = import_texts(scenario, [source, target])
    de = docs[(case, "de", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    work = in_progress(scenario, de, "ann-0001")
    filed = report(
        scenario, "ann-0001", work["assignment_id"], work["round_id"], S6_REASON
    )
    return result(
        scenario,
        [(case, "de"), (case, "en")],
        case_id=case,
        documents={"en": docs[(case, "en", 1)], "de": de},
        assignment_id=work["assignment_id"],
        report_id=filed.report_id,
        reason=S6_REASON,
    )


S7_TEXTS = 300
# Texts whose German machine translation failed its automatic check.
S7_ISSUE_CASES = ("case-0007", "case-0150", "case-0299")


def build_s7(app: FastAPI) -> dict[str, Any]:
    """300 English texts (6 pages of 50); three also have a German machine
    translation that failed its automatic check. One import for all."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S7")
    units = []
    for index in range(1, S7_TEXTS + 1):
        case = f"case-{index:04d}"
        source = native_unit(case, "en", f"{SYNTHETIC} Text {index}.", case_id=case)
        units.append(source)
        if case in S7_ISSUE_CASES:
            units.append(
                translation_unit(
                    case,
                    "de",
                    f"{SYNTHETIC_DE} Text {index}.",
                    source=source,
                    checks=(("units_added", False),),
                )
            )
    import_texts(scenario, units)
    add_user(scenario, "lead", ["lead"])
    rows = [(f"case-{index:04d}", "en") for index in range(1, S7_TEXTS + 1)]
    rows += [(case, "de") for case in S7_ISSUE_CASES]
    return result(scenario, rows, issue_cases=list(S7_ISSUE_CASES), text_count=S7_TEXTS)


def build_s9(app: FastAPI) -> dict[str, Any]:
    """``case-0420`` fr: two machine translation roots with the same provider
    and model; the chain names add the root's external id."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S9")
    case = "case-0420"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    first = translation_unit(
        "case-0420-a", "fr", f"{SYNTHETIC} (fr A)", source=source, provider="Provider A"
    )
    second = translation_unit(
        "case-0420-b",
        "fr",
        f"{SYNTHETIC} (fr B)",
        source=source,
        provider="Provider A",
        run_id="run-2",
    )
    docs = import_texts(scenario, [source, first, second])
    add_user(scenario, "lead", ["lead"])
    return result(
        scenario,
        [(case, "fr"), (case, "en")],
        case_id=case,
        documents={
            "en": docs[(case, "en", 1)],
            "a": docs[("case-0420-a", "fr", 1)],
            "b": docs[("case-0420-b", "fr", 1)],
        },
        chain_names={
            "a": "Provider A m1 · case-0420-a",
            "b": "Provider A m1 · case-0420-b",
        },
    )


def build_s10(app: FastAPI) -> dict[str, Any]:
    """``case-0444`` de, three chains.

    Chain A (final on v1): v2 rejected, v3 queried, v4 accepted_corrected
    with its accepted child v5. Chain B: newest v2 rejected. Chain C: newest
    v2 queried.
    """
    from t1_builders import correction_unit, native_unit, translation_unit

    scenario = new_project(app, "S10")
    case = "case-0444"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    units = [source]
    for chain, provider in (
        ("a", "Provider A"),
        ("b", "Provider B"),
        ("c", "Provider C"),
    ):
        current = translation_unit(
            f"{case}-{chain}",
            "de",
            f"{SYNTHETIC_DE} ({chain})",
            source=source,
            provider=provider,
            run_id=f"run-{chain}",
        )
        units.append(current)
        for version in range(2, (5 if chain == "a" else 3)):
            current = correction_unit(
                current, f"{SYNTHETIC_DE} ({chain}) Korrektur {version}."
            )
            units.append(current)
    docs = import_texts(scenario, units)

    def doc(chain: str, version: int) -> str:
        return docs[(f"{case}-{chain}", "de", version)]

    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "translator", ["annotator"], qualification="Physician")
    accept_translation(scenario, doc("a", 1), "translator")
    review_translation(scenario, doc("a", 2), "translator", "rejected")
    review_translation(scenario, doc("a", 3), "translator", "query")
    corrected = review_translation(
        scenario,
        doc("a", 4),
        "translator",
        "accepted_corrected",
        text=f"{SYNTHETIC_DE} (a) Korrektur 4, geprüft.",
    )
    review_translation(scenario, doc("b", 2), "translator", "rejected")
    review_translation(scenario, doc("c", 2), "translator", "query")
    work = submit(scenario, doc("a", 1), "ann-0001")
    select(scenario, doc("a", 1), work["submission_id"])
    wait_for_jobs(scenario)
    return result(
        scenario,
        [(case, "de"), (case, "en")],
        case_id=case,
        documents={
            "en": docs[(case, "en", 1)],
            **{f"a{version}": doc("a", version) for version in range(1, 5)},
            "a5": corrected.created_variant_id,
            **{f"{chain}{v}": doc(chain, v) for chain in "bc" for v in (1, 2)},
        },
        submissions={"selected": work["submission_id"]},
    )


S12_REASON_RESOLVED = "The German source sentence is ambiguous; please clarify."
S12_REASON_OPEN = "The English text contradicts the French and German versions."


def build_s12(app: FastAPI) -> dict[str, Any]:
    """``case-0512``: de report resolved with its pause kept (orphan pause);
    an open report on en whose ``extend_hold`` also pauses the fr work."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S12")
    case = "case-0512"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    german = translation_unit(case, "de", SYNTHETIC_DE, source=source)
    french = translation_unit(case, "fr", f"{SYNTHETIC} (fr)", source=source)
    docs = import_texts(scenario, [source, german, french])
    en, de, fr = (docs[(case, language, 1)] for language in ("en", "de", "fr"))
    add_user(scenario, "lead", ["lead"])
    for name in ("ann-0001", "ann-0002", "ann-0003"):
        add_user(scenario, name, ["annotator"])
    de_work = in_progress(scenario, de, "ann-0001")
    fr_work = in_progress(scenario, fr, "ann-0002")
    en_work = in_progress(scenario, en, "ann-0003")
    resolved = report(
        scenario,
        "ann-0001",
        de_work["assignment_id"],
        de_work["round_id"],
        S12_REASON_RESOLVED,
    )
    act(scenario, resolved, "resolve", "Clarified with the reporter.")
    opened = report(
        scenario,
        "ann-0003",
        en_work["assignment_id"],
        en_work["round_id"],
        S12_REASON_OPEN,
    )
    extended = act(
        scenario,
        opened,
        "extend_hold",
        "Pause the French work until the English text is checked.",
        [fr_work["assignment_id"]],
    )
    return result(
        scenario,
        [(case, "de"), (case, "fr"), (case, "en")],
        case_id=case,
        documents={"en": en, "de": de, "fr": fr},
        assignments={
            "de": de_work["assignment_id"],
            "fr": fr_work["assignment_id"],
            "en": en_work["assignment_id"],
        },
        reports={"resolved": resolved.report_id, "open": extended.report_id},
    )


BUILDERS: dict[str, Builder] = {
    "S6": build_s6,
    "S7": build_s7,
    "S9": build_s9,
    "S10": build_s10,
    "S12": build_s12,
}
