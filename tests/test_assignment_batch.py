"""Batch assignment preview/commit and the selection summary (lead workflow,
spec "Assign dialog: many cases" and "Backend and API: Bulk assignment")."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import func, insert, select, update
from tests_support_reviews import insert_review
from work_plan_support import _user, assign, set_rule, submit

from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage import work_plan_store as store
from ontotator.storage.plan_tables import DiscardedVariantRow
from ontotator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectRow,
    UserLanguageRow,
    UserRow,
)

BASE = "/api/v1/projects/proj"
CASES = [f"case-{n:04d}" for n in range(101, 121)]
BOTH = PlanFlags(True, True)
REVIEW = PlanFlags(True, False)
ANNOTATE = PlanFlags(False, True)
OFF = PlanFlags(False, False)
READS = {
    "ana": ("de", "en"),
    "ben": ("de", "en"),
    "cyd": ("en",),
    "adj": ("de", "en"),
    "leader": ("de", "en"),
}


def de(case: str) -> str:
    return f"{case}-de"


@pytest.fixture
def env(tmp_path):
    """20 cases (en source, de translation),
    de planned for review and annotation, rule on; reviewers ``ana`` and
    ``ben`` read de and en, annotator ``cyd`` reads only en, ``adj`` is an
    adjudicator. Every de translation is ready for review."""
    from auth_harness import grant, logged_in
    from t1_builders import bundle, native_unit, translation_unit
    from t1_fixtures import TEXT, create_project, run_import
    from test_auth_api import _app

    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    set_rule(db, True)
    units = []
    for case in CASES:
        source = native_unit(f"{case}-en", "en", f"{TEXT} {case}", case_id=case)
        units += [
            source,
            translation_unit(de(case), "de", f"{TEXT} {case} de", source=source),
        ]
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    for username, name, role in (
        ("ana", "Ana Weber", "annotator"),
        ("ben", "Ben Roth", "annotator"),
        ("cyd", "Cy Young", "annotator"),
        ("adj", "Ada Judicator", "adjudicator"),
    ):
        _user(app, username, name)
        assert grant(app, username, "proj", [role])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        for username, languages in READS.items():
            user = app.state.accounts.get_by_username(username)
            for language in languages:
                conn.execute(
                    insert(UserLanguageRow).values(user_id=user.id, language=language)
                )
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.project_id == pid, DocumentRow.language == "de")
            .values(translation_status="ready_for_review")
        )
        store.write_rows(
            conn,
            pid,
            {RowKey(case, "en"): OFF for case in CASES}
            | {RowKey(case, "de"): BOTH for case in CASES},
            actor_id=None,
        )
    return SimpleNamespace(app=app, db=db, pid=pid, lead=lead)


def plan(env: Any, flags: PlanFlags, *cases: str) -> None:
    with env.db.transaction() as conn:
        store.write_rows(
            conn, env.pid, {RowKey(c, "de"): flags for c in cases}, actor_id=None
        )


def set_status(env: Any, status: str, *cases: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id.in_([de(c) for c in cases]))
            .values(translation_status=status)
        )


def set_project(env: Any, **values: Any) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow).where(ProjectRow.id == env.pid).values(**values)
        )


def body(task: str, case_ids: list[str] | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "task": task,
        "language": "de",
        "case_ids": CASES if case_ids is None else case_ids,
        "mode": "one",
        **extra,
    }


def preview(env: Any, task: str, **extra: Any) -> dict[str, Any]:
    response = env.lead.post(
        f"{BASE}/assignments/batch/preview", json=body(task, **extra)
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def commit(env: Any, task: str, **extra: Any) -> Any:
    shown = {k: v for k, v in extra.items() if k != "confirm_language"}
    digest = preview(env, task, **shown)["digest"]
    return env.lead.post(
        f"{BASE}/assignments/batch",
        json=body(task, **extra) | {"expected_preview_digest": digest},
    )


def summary(env: Any, case_ids: list[str], **extra: Any) -> dict[str, Any]:
    response = env.lead.post(
        f"{BASE}/document-rows/selection-summary",
        json={"case_ids": case_ids, **extra},
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def assignment_count(env: Any) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                select(func.count())
                .select_from(AssignmentRow)
                .where(AssignmentRow.project_id == env.pid)
            ).scalar_one()
        )


def audits(env: Any, action: str) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                select(func.count())
                .select_from(AuditEventRow)
                .where(AuditEventRow.action == action)
            ).scalar_one()
        )


def skipped(result: dict[str, Any]) -> dict[str, str]:
    return {item["case_id"]: item["reason"] for item in result["skipped"]}


def people(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["username"]: item for item in result["people"]}


def import_correction(env: Any, tmp_path: Any, case: str) -> str:
    """A v2 correction of the de translation of ``case``; its document ID."""
    from t1_builders import bundle, correction_unit, native_unit, translation_unit
    from t1_fixtures import TEXT, run_import

    source = native_unit(f"{case}-en", "en", f"{TEXT} {case}", case_id=case)
    translation = translation_unit(de(case), "de", f"{TEXT} {case} de", source=source)
    folder = tmp_path / f"correction-{case}"
    folder.mkdir()
    result = run_import(
        env.db,
        bundle(folder, [correction_unit(translation, f"{TEXT} {case} de v2")]),
    )
    assert result.status == "succeeded", result.error
    with env.db.transaction() as conn:
        return str(
            conn.execute(
                select(DocumentRow.document_id).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.case_id == case,
                    DocumentRow.language == "de",
                    DocumentRow.version == 2,
                )
            ).scalar_one()
        )


def test_preview_targets_newest_version_per_root_and_skips_with_reasons(env, tmp_path):
    corrected = import_correction(env, tmp_path, CASES[0])
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.project_id == env.pid, DocumentRow.language == "de")
            .values(translation_status="accepted")
        )
    plan(env, BOTH, CASES[0])
    set_status(env, "ready_for_review", CASES[1])
    assign(env, de(CASES[1]), "ana", "translation_review")  # review still open
    plan(env, OFF, CASES[2])
    assign(env, de(CASES[3]), "ben", "annotate")
    submit(env, assign(env, de(CASES[4]), "cyd", "annotate"), "s-104")
    lead = env.app.state.accounts.get_by_username("leader")
    with env.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=env.pid,
                document_id=de(CASES[5]),
                reason="wrong source",
                discarded_by=lead.id,
            )
        )

    result = preview(env, "annotate", case_ids=[*CASES, "case-9999"])

    assert skipped(result) == {
        CASES[1]: "waiting_for_review",
        CASES[2]: "not_in_plan",
        CASES[3]: "already_assigned",
        CASES[4]: "step_differs",
        CASES[5]: "discarded",
        "case-9999": "not_in_plan",
    }
    targets = {t["case_id"]: t for t in result["targets"]}
    assert set(targets) == set(CASES) - {CASES[n] for n in range(1, 6)}
    assert (targets[CASES[0]]["document_id"], targets[CASES[0]]["version"]) == (
        corrected,
        2,
    )
    assert targets[CASES[6]] == {
        "case_id": CASES[6],
        "language": "de",
        "document_id": de(CASES[6]),
        "version": 1,
        "remaining": 1,
        "usernames": [],
        "unreviewed_translation": False,
    }
    assert result["versions"] == 15 and result["per_text"] == 1
    assert result["task"] == "annotate" and result["language"] == "de"


def test_preview_people_sorted_reads_then_open_tasks_then_name_with_reasons(env):
    assign(env, de(CASES[19]), "ana", "translation_review")
    result = preview(env, "translation_review")
    order = [item["username"] for item in result["people"]]
    # eligible, then language mismatch, then no role or inactive
    assert order.index("ben") < order.index("ana") < order.index("cyd")
    assert set(order[-2:]) == {"adj", "leader"}
    by_name = people(result)
    assert by_name["cyd"]["unavailable"] == "does_not_read"
    assert by_name["cyd"]["language_mismatch"] is True
    assert by_name["cyd"]["reads"] == ["en"]
    assert by_name["adj"]["unavailable"] == "role_missing"
    assert by_name["leader"]["unavailable"] == "role_missing"
    ana = by_name["ana"]
    assert ana["unavailable"] is None and ana["language_mismatch"] is False
    assert ana["reads"] == ["de", "en"]
    assert (ana["open_before"], ana["already_assigned"]) == (1, 1)
    assert ana["person"] == {
        "pseudonym": env.app.state.accounts.get_by_username("ana").pseudonym,
        "display_name": "Ana Weber",
        "is_me": False,
    }
    assert skipped(result) == {CASES[19]: "already_assigned"}


def test_preview_marks_system_administrators(env):
    """#177: a project's creator (a system admin) holds every role; the
    dialog marks such people instead of listing them like any member."""
    with env.db.transaction() as conn:
        conn.execute(
            update(UserRow)
            .where(UserRow.username == "ben")
            .values(is_system_admin=True)
        )
    by_name = people(preview(env, "translation_review"))
    assert by_name["ben"]["system_admin"] is True
    assert by_name["ben"]["unavailable"] is None
    assert {name for name, item in by_name.items() if item["system_admin"]} == {"ben"}


def test_preview_split_reports_blocks_and_open_totals(env):
    assign(env, de(CASES[0]), "ben", "translation_review")
    result = preview(env, "translation_review", mode="split", usernames=["ana", "ben"])
    targets = result["targets"]
    assert [t["case_id"] for t in targets] == CASES[1:]
    assert [t["usernames"] for t in targets] == [["ana"]] * 10 + [["ben"]] * 9
    by_name = people(result)
    assert {
        name: (
            by_name[name]["gets"],
            by_name[name]["first_case"],
            by_name[name]["last_case"],
            by_name[name]["open_before"],
            by_name[name]["open_after"],
        )
        for name in ("ana", "ben")
    } == {
        "ana": (10, CASES[1], CASES[10], 0, 10),
        "ben": (9, CASES[11], CASES[19], 1, 10),
    }
    assert by_name["cyd"]["gets"] == 0


def test_commit_creates_all_in_one_transaction(env):
    before = audits(env, "assignment.create")
    response = commit(env, "translation_review", usernames=["ana"])
    assert response.status_code == 200, response.text
    created = response.json()["created"]
    assert len(created) == 20
    assert {(c["document_id"], c["username"], c["task"]) for c in created} == {
        (de(case), "ana", "translation_review") for case in CASES
    }
    assert audits(env, "assignment.create") == before + 20
    assert assignment_count(env) == 20


def test_commit_is_all_or_nothing_on_refusal(env):
    set_status(env, "accepted", *CASES)
    set_project(env, adjudicator_not_annotator=True)
    from auth_harness import grant

    assert grant(env.app, "ben", "proj", ["annotator", "adjudicator"])
    assign(env, de(CASES[4]), "ben", "review")
    before = assignment_count(env)
    response = commit(env, "annotate", usernames=["ben"])
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ASSIGNMENT_BATCH_REFUSED"
    assert response.json()["details"]["refused"] == [
        {
            "case_id": CASES[4],
            "language": "de",
            "document_id": de(CASES[4]),
            "username": "ben",
            "code": "ADJUDICATOR_IS_ANNOTATOR",
        }
    ]
    assert assignment_count(env) == before


def test_commit_refuses_stale_digest(env):
    digest = preview(env, "translation_review", usernames=["ana"])["digest"]
    assign(env, de(CASES[0]), "ben", "translation_review")
    response = env.lead.post(
        f"{BASE}/assignments/batch",
        json=body("translation_review", usernames=["ana"])
        | {"expected_preview_digest": digest},
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ASSIGNMENT_BATCH_STALE"
    assert assignment_count(env) == 1


def test_language_mismatch_needs_confirm_language(env):
    assert people(preview(env, "translation_review", usernames=["cyd"]))["cyd"][
        "language_mismatch"
    ]
    response = commit(env, "translation_review", usernames=["cyd"])
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ASSIGNMENT_BATCH_REFUSED"
    refused = response.json()["details"]["refused"]
    assert len(refused) == 20
    assert {item["code"] for item in refused} == {"LANGUAGE_CONFIRMATION_REQUIRED"}
    assert assignment_count(env) == 0
    before = audits(env, "assignment.language_override")
    response = commit(
        env, "translation_review", usernames=["cyd"], confirm_language=True
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["created"]) == 20
    assert audits(env, "assignment.language_override") == before + 20


def test_no_listed_languages_is_unknown_not_a_mismatch(env):
    """#193: empty member languages need no Assign anyway."""
    with env.db.transaction() as conn:
        conn.execute(
            UserLanguageRow.__table__.delete().where(
                UserLanguageRow.user_id
                == env.app.state.accounts.get_by_username("cyd").id
            )
        )
    cyd = people(preview(env, "translation_review", usernames=["cyd"]))["cyd"]
    assert cyd["reads"] == []
    assert cyd["language_mismatch"] is False and cyd["unavailable"] is None
    before = audits(env, "assignment.language_override")
    response = commit(env, "translation_review", usernames=["cyd"])
    assert response.status_code == 200, response.text
    assert len(response.json()["created"]) == 20
    assert audits(env, "assignment.language_override") == before


def test_selection_summary_lists_assignable_steps_and_common_step(env):
    set_status(env, "accepted", *CASES[:14])
    for case in CASES[14:]:
        assign(env, de(case), "ana", "translation_review")
    result = summary(env, CASES)
    step = {"task": "annotate", "language": "de", "versions": 14, "cases": 14}
    assert result == {
        "cases": 20,
        "steps": [step],
        "skipped": {"waiting_for_review": 6},
        "common": step,
        "not_shown": 0,
        "skipped_rows": [],
    }


def test_task_matches_any_step_not_only_the_first(env):
    from auth_harness import logged_in

    set_project(env, annotations_per_text=2)
    set_status(env, "accepted", CASES[0])
    task_id = assign(env, de(CASES[0]), "cyd", "annotate")
    cy = logged_in(env.app, "cyd", assignments=[])
    current = cy.get(f"/api/v1/assignments/{task_id}").json()
    reported = cy.post(
        f"/api/v1/assignments/{task_id}/problem-reports",
        json={
            "request_id": "report-1",
            "expected_workflow_revision": current["workflow_revision"],
            "round_id": current["active_round_id"],
            "reason": "Text is cut off",
        },
    )
    assert reported.status_code == 200, reported.text
    rows = env.lead.get(f"{BASE}/document-rows", params={"case": CASES[0]}).json()
    (row,) = [r for g in rows["groups"] for r in g["rows"] if r["language"] == "de"]
    codes = [step["code"] for step in row["steps"]]
    assert codes[0] == "decide_report" and "assign_annotation" in codes

    result = preview(env, "annotate", case_ids=[CASES[0]])
    assert [(t["case_id"], t["remaining"]) for t in result["targets"]] == [
        (CASES[0], 1)
    ]
    assert summary(env, [CASES[0]])["steps"] == [
        {"task": "annotate", "language": "de", "versions": 1, "cases": 1}
    ]


def test_preview_orders_case_ids_by_documents_sort(env):
    with env.db.transaction() as conn:  # import order: the reverse of CASES
        for index, case in enumerate(CASES):
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.project_id == env.pid, DocumentRow.case_id == case)
                .values(position=100 - index)
            )
    scrambled = CASES[5:] + CASES[:5]
    scrambled = scrambled[::3] + scrambled[1::3] + scrambled[2::3]
    result = preview(
        env,
        "translation_review",
        case_ids=scrambled,
        sort="import",
        mode="split",
        usernames=["ana", "ben"],
    )
    imported = list(reversed(CASES))
    assert [t["case_id"] for t in result["targets"]] == imported
    assert [t["usernames"] for t in result["targets"]] == [["ana"]] * 10 + [
        ["ben"]
    ] * 10
    by_case = preview(env, "translation_review", case_ids=scrambled)
    assert [t["case_id"] for t in by_case["targets"]] == CASES


def test_selection_summary_counts_cases_not_shown_with_filters(env):
    plan(env, ANNOTATE, *CASES[:3])
    result = summary(env, CASES, filters={"plan": "review_and_annotate"})
    assert result["not_shown"] == 3
    assert summary(env, CASES)["not_shown"] == 0


def test_remaining_per_case_with_one_of_two_assigned(env):
    set_project(env, annotations_per_text=2)
    set_status(env, "accepted", *CASES[:4])
    assign(env, de(CASES[0]), "cyd", "annotate")
    result = preview(
        env,
        "annotate",
        case_ids=CASES[:4],
        mode="split",
        usernames=["ana", "ben"],
    )
    assert result["per_text"] == 2
    targets = {t["case_id"]: t for t in result["targets"]}
    assert targets[CASES[0]]["remaining"] == 1
    assert len(targets[CASES[0]]["usernames"]) == 1
    assert all(
        targets[c]["remaining"] == 2
        and sorted(targets[c]["usernames"]) == ["ana", "ben"]
        for c in CASES[1:4]
    )
    assert result["needs_people"] is None
    too_few = preview(
        env, "annotate", case_ids=CASES[:4], mode="split", usernames=["ana"]
    )
    assert all(t["usernames"] == [] for t in too_few["targets"])
    assert too_few["needs_people"] == 2
    response = commit(
        env, "annotate", case_ids=CASES[:4], mode="split", usernames=["ana"]
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ASSIGNMENT_BATCH_REFUSED"
    assert response.json()["details"] == {"refused": [], "needs_people": 2}


def test_each_mode_gives_every_case_to_every_person_up_to_the_limit(env):
    set_project(env, annotations_per_text=2)
    set_status(env, "accepted", *CASES[:3])
    assign(env, de(CASES[0]), "ana", "annotate")
    assign(env, de(CASES[1]), "ben", "annotate")
    assign(env, de(CASES[1]), "cyd", "annotate")
    shown = {"case_ids": CASES[:3], "mode": "each", "usernames": ["ana", "ben"]}
    result = preview(env, "annotate", **shown)
    assert {t["case_id"]: t["usernames"] for t in result["targets"]} == {
        CASES[0]: ["ben"],
        CASES[2]: ["ana", "ben"],
    }
    assert skipped(result) == {CASES[1]: "already_assigned"}
    assert result["needs_people"] is None
    response = commit(env, "annotate", **shown)
    assert response.status_code == 200, response.text
    assert len(response.json()["created"]) == 3


def test_review_accepted_translation_targets_externally_accepted_rows_only(env):
    lead = env.app.state.accounts.get_by_username("leader")
    set_status(env, "accepted", *CASES[:3])
    plan(env, ANNOTATE, CASES[0])
    with env.db.transaction() as conn:
        for case, source in zip(
            CASES[:3], ("lead", "override", "package"), strict=True
        ):
            store.add_acceptance(
                conn,
                env.pid,
                de(case),
                source=source,
                reason=None if source == "package" else "checked externally",
                accepted_by=None if source == "package" else lead.id,
            )
    extra: dict[str, Any] = {
        "case_ids": CASES[:3],
        "review_accepted_translation": True,
        "usernames": ["ana"],
    }
    result = preview(env, "translation_review", **extra)
    assert [t["case_id"] for t in result["targets"]] == CASES[:2]
    assert skipped(result) == {CASES[2]: "step_differs"}
    plain = preview(env, "translation_review", case_ids=CASES[:3])
    assert skipped(plain) == {
        CASES[0]: "step_differs",  # Review off, in the plan
        CASES[1]: "step_differs",
        CASES[2]: "step_differs",
    }
    response = commit(env, "translation_review", **extra)
    assert response.status_code == 200, response.text
    assert len(response.json()["created"]) == 2
    with env.db.transaction() as conn:
        flags = store.effective_plan(conn, env.pid, [CASES[0]])
    assert flags[RowKey(CASES[0], "de")] == BOTH


def test_review_accepted_translation_skips_versions_with_a_correction(env, tmp_path):
    """D25 as ``enable_review_for_accepted``: a version with a correction
    derived from it (here a rejected one, so v1 stays newest) is no target."""
    lead = env.app.state.accounts.get_by_username("leader")
    corrected = import_correction(env, tmp_path, CASES[0])
    set_status(env, "accepted", *CASES[:2])
    plan(env, ANNOTATE, *CASES[:2])
    assign(env, de(CASES[5]), "ana", "translation_review")
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == corrected)
            .values(translation_status="reviewed")
        )
        for case in CASES[:2]:
            store.add_acceptance(
                conn,
                env.pid,
                de(case),
                source="lead",
                reason="checked externally",
                accepted_by=lead.id,
            )
    insert_review(env.db, "proj", corrected, "rejected")
    result = preview(
        env,
        "translation_review",
        case_ids=CASES[:2],
        review_accepted_translation=True,
    )
    assert [t["case_id"] for t in result["targets"]] == [CASES[1]]
    assert skipped(result) == {CASES[0]: "step_differs"}


def test_open_tasks_count_paused_work_in_batch_and_members(env):
    task_id = assign(env, de(CASES[0]), "ana", "translation_review")
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == task_id)
            .values(status="submitted", held=True)
        )
    ana = people(preview(env, "annotate", case_ids=[CASES[1]]))["ana"]
    assert ana["open_before"] == 1
    members = env.lead.get(f"{BASE}/members").json()
    (member,) = [m for m in members if m["username"] == "ana"]
    assert member["open_tasks"]["translation_review"] == 1


def test_request_validation(env):
    response = env.lead.post(
        f"{BASE}/assignments/batch/preview",
        json=body("translation_review", usernames=["ana", "ben"]),
    )
    assert response.status_code == 422, response.text
    response = env.lead.post(
        f"{BASE}/assignments/batch",
        json=body("translation_review") | {"expected_preview_digest": "x"},
    )
    assert response.status_code == 422, response.text


def test_routes_are_lead_only(env):
    from auth_harness import logged_in

    ana = logged_in(env.app, "ana", assignments=[])
    for path, payload in (
        ("assignments/batch/preview", body("translation_review")),
        (
            "assignments/batch",
            body("translation_review", usernames=["ana"])
            | {"expected_preview_digest": "x"},
        ),
        ("document-rows/selection-summary", {"case_ids": CASES}),
    ):
        response = ana.post(f"{BASE}/{path}", json=payload)
        assert response.status_code == 403, (path, response.text)
    assert assignment_count(env) == 0


def test_summary_not_shown_respects_q_and_decision(env):
    set_status(env, "reviewed", CASES[0])
    from tests_support_reviews import insert_review

    assign(env, de(CASES[1]), "ana", "translation_review")
    insert_review(env.db, "proj", de(CASES[0]), "rejected")
    prefix = summary(env, CASES, filters={"q": CASES[0]})
    assert prefix["not_shown"] == len(CASES) - 1
    decision = summary(env, CASES, filters={"decision": "translation"})
    assert decision["not_shown"] == len(CASES) - 1
    # Filters never change the assignable steps.
    assert prefix["steps"] == decision["steps"] == summary(env, CASES)["steps"]


def test_preview_accepts_all_documents_filters(env):
    plain = preview(env, "translation_review", sort="import")
    filtered = preview(
        env,
        "translation_review",
        sort="import",
        filters={
            "q": CASES[0],
            "decision": "all",
            "step": ["assign_translation_review", "translation_review_in_progress"],
            "stage": ["translation_review"],
            "plan": ["review", "review_and_annotate"],
            "paused": "no",
        },
    )
    assert filtered["targets"] == plain["targets"]
    assert filtered["skipped"] == plain["skipped"]
    single = summary(
        env, CASES, filters={"step": "assign_translation_review", "final": "any"}
    )
    assert single["not_shown"] == len(CASES)


def test_decision_with_final_or_segment_is_422(env):
    for filters in (
        {"decision": "all", "final": "none"},
        {"decision": "all", "segment": "assign"},
    ):
        response = env.lead.post(
            f"{BASE}/document-rows/selection-summary",
            json={"case_ids": CASES, "filters": filters},
        )
        assert response.status_code == 422, response.text
        response = env.lead.post(
            f"{BASE}/assignments/batch/preview",
            json=body("translation_review", filters=filters),
        )
        assert response.status_code == 422, response.text
