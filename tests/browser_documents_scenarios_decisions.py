"""Documents browser scenarios S11, S13, S14 and S15 (WP P3).

Builders use the helpers of ``browser_documents_scenarios``; the route there
merges this registry. Helpers only these scenarios need live here.
"""

from __future__ import annotations

from typing import Any

from browser_documents_scenarios import (
    SYNTHETIC,
    SYNTHETIC_DE,
    Builder,
    Scenario,
    add_user,
    assign,
    finish_round,
    import_texts,
    in_progress,
    new_project,
    result,
    select,
    start_round,
    submit,
)
from fastapi import FastAPI
from sqlalchemy import update

from ontocurator.auth.audit import Actor
from ontocurator.storage.tables import ProjectRow

# --- Helpers of this module ---------------------------------------------------- #


def reopen(scenario: Scenario, assignment_id: int, reason: str) -> None:
    """Reopen a submitted assignment; its active round becomes editable again."""
    from ontocurator.assignments.service import AssignmentService

    AssignmentService(scenario.db).reopen(Actor.cli(), assignment_id, reason)


def separate_adjudication(scenario: Scenario) -> None:
    """Turn the project rule ``adjudicator_not_annotator`` on."""
    with scenario.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == scenario.key)
            .values(adjudicator_not_annotator=True)
        )


# --- S11, S13, S14, S15 --------------------------------------------------------- #


def build_s11(app: FastAPI) -> dict[str, Any]:
    """``case-0611`` en: ann-0001's Round 1 has two submissions (the first is
    selected, the reopened round was submitted again); ann-0002 submits on its
    own assignment after the selection."""
    from t1_builders import native_unit

    scenario = new_project(app, "S11")
    case = "case-0611"
    docs = import_texts(scenario, [native_unit(case, "en", SYNTHETIC, case_id=case)])
    doc = docs[(case, "en", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    first = submit(scenario, doc, "ann-0001")
    select(scenario, doc, first["submission_id"])
    reopen(scenario, first["assignment_id"], "Add the missing seizure finding")
    workspace_key = _workspace_key(scenario, first["round_id"])
    revised = finish_round(scenario, "ann-0001", workspace_key)
    newer = submit(scenario, doc, "ann-0002")
    return result(
        scenario,
        [(case, "en")],
        case_id=case,
        documents={"en": doc},
        assignments={
            "ann-0001": first["assignment_id"],
            "ann-0002": newer["assignment_id"],
        },
        rounds={"round1": first["round_id"]},
        submissions={
            "selected": first["submission_id"],
            "revised": revised,
            "newer": newer["submission_id"],
        },
    )


def _workspace_key(scenario: Scenario, round_id: str) -> Any:
    return scenario.app.state.repo.get_work_round(scenario.key, round_id).workspace_key


def build_s13(app: FastAPI) -> dict[str, Any]:
    """``case-0713`` en: ann-0001 and ann-0002 submit on v1 and the lead
    consolidates both; ann-0001 carries its result forward to correction v2."""
    from t1_builders import correction_unit, native_unit

    scenario = new_project(app, "S13")
    case = "case-0713"
    v1_unit = native_unit(case, "en", SYNTHETIC, case_id=case)
    v2_unit = correction_unit(v1_unit, SYNTHETIC + " She also has microcephaly.")
    docs = import_texts(scenario, [v1_unit, v2_unit])
    v1, v2 = docs[(case, "en", 1)], docs[(case, "en", 2)]
    add_user(scenario, "lead", ["lead", "adjudicator"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    inputs = [
        submit(scenario, v1, name)["submission_id"] for name in ("ann-0001", "ann-0002")
    ]
    review = assign(scenario, v1, "lead", "review")
    consolidation = start_round(
        scenario, review, "lead", kind="consolidation", sources=inputs
    )
    consolidated = finish_round(scenario, "lead", consolidation.workspace_key)
    carry_assignment = assign(scenario, v2, "ann-0001", "annotate")
    carried = start_round(
        scenario,
        carry_assignment,
        "ann-0001",
        kind="carry_forward",
        sources=[inputs[0]],
    )
    carried_submission = finish_round(scenario, "ann-0001", carried.workspace_key)
    return result(
        scenario,
        [(case, "en")],
        case_id=case,
        documents={"v1": v1, "v2": v2},
        submissions={
            "inputs": inputs,
            "consolidation": consolidated,
            "carry_forward": carried_submission,
        },
        rounds={
            "consolidation": consolidation.round_id,
            "carry_forward": carried.round_id,
        },
    )


def build_s14(app: FastAPI) -> dict[str, Any]:
    """``case-0814``: de has a final result and an open translation review
    (waiting line); en was selected early while ann-0002's work is still open."""
    from t1_builders import native_unit, translation_unit

    scenario = new_project(app, "S14")
    case = "case-0814"
    source = native_unit(case, "en", SYNTHETIC, case_id=case)
    target = translation_unit(case, "de", SYNTHETIC_DE, source=source)
    docs = import_texts(scenario, [source, target])
    en, de = docs[(case, "en", 1)], docs[(case, "de", 1)]
    add_user(scenario, "lead", ["lead"])
    add_user(scenario, "ann-0001", ["annotator"])
    add_user(scenario, "ann-0002", ["annotator"])
    add_user(scenario, "reviewer", ["annotator"], qualification="Physician")
    de_work = submit(scenario, de, "ann-0001")
    select(scenario, de, de_work["submission_id"])
    open_review = assign(scenario, de, "reviewer", "translation_review")
    en_work = submit(scenario, en, "ann-0001")
    select(scenario, en, en_work["submission_id"])
    still_open = in_progress(scenario, en, "ann-0002")
    return result(
        scenario,
        [(case, "de"), (case, "en")],
        case_id=case,
        documents={"en": en, "de": de},
        submissions={
            "de": de_work["submission_id"],
            "en": en_work["submission_id"],
        },
        open_review_assignment_id=open_review,
        open_assignment_id=still_open["assignment_id"],
    )


S15_TEXTS = 55
S15_CASE = "case-0001"


def build_s15(app: FastAPI) -> dict[str, Any]:
    """55 English texts (two pages); ``adjudicator_not_annotator`` is on and
    the lead (also an annotator) and ann-0001 both submitted on case-0001."""
    from t1_builders import native_unit

    scenario = new_project(app, "S15")
    separate_adjudication(scenario)
    units = [
        native_unit(
            f"case-{index:04d}",
            "en",
            f"{SYNTHETIC} Text {index}.",
            case_id=f"case-{index:04d}",
        )
        for index in range(1, S15_TEXTS + 1)
    ]
    docs = import_texts(scenario, units)
    doc = docs[(S15_CASE, "en", 1)]
    add_user(scenario, "lead", ["lead", "annotator"])
    add_user(scenario, "ann-0001", ["annotator"])
    own = submit(scenario, doc, "lead")
    other = submit(scenario, doc, "ann-0001")
    return result(
        scenario,
        [(f"case-{index:04d}", "en") for index in range(1, S15_TEXTS + 1)],
        case_id=S15_CASE,
        documents={"en": doc},
        submissions={"own": own["submission_id"], "other": other["submission_id"]},
        text_count=S15_TEXTS,
    )


BUILDERS: dict[str, Builder] = {
    "S11": build_s11,
    "S13": build_s13,
    "S14": build_s14,
    "S15": build_s15,
}
