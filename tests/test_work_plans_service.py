"""Work plan service: saves, consequences, undo, acceptance, discard (WP L0b)."""

from __future__ import annotations

from typing import Any

import pytest
from auth_harness import logged_in
from sqlalchemy import func, select, update
from tests_support_reviews import insert_review
from work_plan_support import (
    BASE,
    assign,
    doc,
    flags_of,
    plan_env,
    preflight,
    revision_of,
    select_final,
    service,
    set_rule,
    submit,
    write,
)

from ontocurator.api.work_plan_routes import (
    AcceptExternalReview,
    BulkAcceptance,
    BulkPlanRequest,
    LanguageChangeView,
    PlanRowPatch,
    PlanRowsSet,
    UndoRowView,
)
from ontocurator.assignments.service import AssignmentService
from ontocurator.domain.errors import DomainError
from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    TranslationReviewRow,
)


@pytest.fixture
def env(tmp_path):
    return plan_env(tmp_path)


def refused(call: Any) -> DomainError:
    with pytest.raises(DomainError) as caught:
        call()
    return caught.value


def revoked(env: Any, assignment_id: int) -> bool:
    with env.db.transaction() as conn:
        return (
            conn.execute(
                select(AssignmentRow.revoked_at).where(
                    AssignmentRow.id == assignment_id
                )
            ).scalar_one()
            is not None
        )


def audits(env: Any, action: str) -> list[dict[str, Any]]:
    with env.db.transaction() as conn:
        return [
            dict(row)
            for row in conn.execute(
                select(AuditEventRow.details)
                .where(AuditEventRow.action == action)
                .order_by(AuditEventRow.id)
            ).scalars()
        ]


def status_of(env: Any, document_id: str) -> str:
    with env.db.transaction() as conn:
        return str(
            conn.execute(
                select(DocumentRow.translation_status).where(
                    DocumentRow.document_id == document_id
                )
            ).scalar_one()
        )


def set_status(env: Any, document_id: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document_id)
            .values(translation_status=status)
        )


def final_with_submission(env: Any, case: str = "c1", language: str = "en") -> None:
    aid = assign(env, doc(case, language), "anno", "annotate")
    submit(env, aid, f"s-{case}-{language}")
    select_final(env, doc(case, language), f"s-{case}-{language}")


def report(env: Any, username: str, assignment_id: int) -> str:
    client = logged_in(env.app, username, assignments=[])
    with env.db.transaction() as conn:
        revision = AssignmentService._get(conn, assignment_id).workflow_revision
    created = client.post(
        f"/api/v1/assignments/{assignment_id}/problem-reports",
        json={
            "request_id": f"report-{assignment_id}",
            "expected_workflow_revision": revision,
            "reason": "The text is cut off",
        },
    )
    assert created.status_code == 200, created.text
    return str(created.json()["report_id"])


def codes(state: dict[str, Any]) -> set[str]:
    return {w["cause_id"] or w["code"] for w in state["warnings"]}


def test_patch_without_consequences_saves_and_returns_undo(env):
    result = service(env).patch_row(
        "proj", "c1", "de", PlanRowPatch(review=True, expected_revision=2)
    )
    assert result["revision"] == 3
    assert result["flags"]["review"] is True and result["flags"]["annotate"] is False
    assert result["flags"]["review_applicable"] is True
    assert result["undo"]["rows"] == [
        {
            "case_id": "c1",
            "language": "de",
            "review": False,
            "annotate": False,
            "restored_revision": None,
            "decided": True,
            "annotation_mode": None,
        }
    ]
    assert result["undo"]["revisions"] == {"c1": 3}
    assert result["withdrawn"] == [] and result["accepted_document_ids"] == []
    assert flags_of(env, "c1", "de") == PlanFlags(True, False)


def test_patch_with_open_review_requires_confirmation(env):
    write(env, {RowKey("c1", "de"): PlanFlags(True, False)})
    aid = assign(env, doc("c1", "de"), "ana", "translation_review")
    change = PlanRowPatch(review=False, expected_revision=3)
    error = refused(lambda: service(env).patch_row("proj", "c1", "de", change))
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    (withdrawn,) = error.details["withdrawn"]
    assert withdrawn["assignment_id"] == aid
    assert withdrawn["task"] == "translation_review"
    assert withdrawn["person"]["display_name"] == "Ana Weber"
    assert withdrawn["person"]["pseudonym"]
    assert not revoked(env, aid)
    result = service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(review=False, expected_revision=3, confirm=True),
    )
    assert [w["assignment_id"] for w in result["withdrawn"]] == [aid]
    assert revoked(env, aid)
    assert status_of(env, doc("c1", "de")) == "ready_for_review"
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(func.count()).select_from(TranslationReviewRow)
            ).scalar_one()
            == 0
        )


def test_annotate_off_keeps_drafts_and_final_but_leaves_export(env):
    final_with_submission(env)
    change = PlanRowPatch(annotate=False, expected_revision=2)
    error = refused(lambda: service(env).patch_row("proj", "c1", "en", change))
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    assert error.details["finals_leaving"] == [{"case_id": "c1", "language": "en"}]
    assert error.details["withdrawn"] == []
    service(env).patch_row(
        "proj",
        "c1",
        "en",
        PlanRowPatch(annotate=False, expected_revision=2, confirm=True),
    )
    with env.db.transaction() as conn:
        assert (
            conn.execute(
                select(FinalSelectionRow.submission_id).where(
                    FinalSelectionRow.case_id == "c1",
                    FinalSelectionRow.language == "en",
                )
            ).scalar_one()
            == "s-c1-en"
        )
    state = preflight(env)
    assert state["not_in_plan"] == [{"case_id": "c1", "language": "en"}]
    assert all(
        (s["case_id"], s["language"]) != ("c1", "en") for s in state["selections"]
    )
    assert all((w["case_id"], w["language"]) != ("c1", "en") for w in state["warnings"])


def test_annotate_on_with_earlier_final_sets_plan_restored(env):
    final_with_submission(env)
    service(env).patch_row(
        "proj",
        "c1",
        "en",
        PlanRowPatch(annotate=False, expected_revision=2, confirm=True),
    )
    change = PlanRowPatch(annotate=True, expected_revision=3)
    error = refused(lambda: service(env).patch_row("proj", "c1", "en", change))
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    assert error.details["restored"] == [{"case_id": "c1", "language": "en"}]
    result = service(env).patch_row(
        "proj",
        "c1",
        "en",
        PlanRowPatch(annotate=True, expected_revision=3, confirm=True),
    )
    revision = result["revision"]
    cause_id = f"PLAN_RESTORED:c1:en:{revision}"
    with env.db.transaction() as conn:
        assert store.restored(conn, env.pid) == {RowKey("c1", "en"): revision}
    state = preflight(env)
    (warning,) = [w for w in state["warnings"] if w["code"] == "PLAN_RESTORED"]
    assert warning["cause_id"] == cause_id
    assert (warning["case_id"], warning["language"]) == ("c1", "en")
    kept = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": doc("c1", "en"),
            "submission_id": "s-c1-en",
            "expected_revision": 1,
            "acknowledged_cause_ids": [cause_id],
        },
    )
    assert kept.status_code == 200, kept.text
    assert not [w for w in preflight(env)["warnings"] if w["code"] == "PLAN_RESTORED"]


def test_invalid_annotate_without_accepted_translation(env):
    change = PlanRowPatch(annotate=True, expected_revision=2)
    error = refused(lambda: service(env).patch_row("proj", "c1", "de", change))
    assert error.code == "WORK_PLAN_INVALID"
    assert error.details["reason"] == "annotate_not_accepted"
    assert error.details["rows"] == [
        {
            "case_id": "c1",
            "language": "de",
            "not_accepted": 1,
            "not_acceptable": 0,
            "marked_in_package": 0,
        }
    ]
    result = service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(
            annotate=True,
            expected_revision=2,
            accept_external_review=AcceptExternalReview(reason="checked externally"),
        ),
    )
    assert result["accepted_document_ids"] == [doc("c1", "de")]
    assert status_of(env, doc("c1", "de")) == "accepted"
    lead = env.app.state.accounts.get_by_username("leader")
    with env.db.transaction() as conn:
        acceptance = store.acceptances(conn, env.pid)[doc("c1", "de")]
    assert acceptance["source"] == "lead"
    assert acceptance["reason"] == "checked externally"
    assert acceptance["accepted_by"] == lead.id
    (audit,) = audits(env, "translation.accept_external_review")
    assert audit["document_id"] == doc("c1", "de")
    assert audit["reason"] == "checked externally"
    assert flags_of(env, "c1", "de") == PlanFlags(False, True)


def test_source_row_never_gets_review(env):
    change = PlanRowPatch(review=True, expected_revision=2)
    error = refused(lambda: service(env).patch_row("proj", "c1", "en", change))
    assert error.code == "WORK_PLAN_INVALID"
    assert error.details["reason"] == "source_review"
    assert flags_of(env, "c1", "en") == PlanFlags(False, True)


def test_stale_revision_is_refused(env):
    change = PlanRowPatch(review=True, expected_revision=1)
    error = refused(lambda: service(env).patch_row("proj", "c1", "de", change))
    assert error.code == "WORK_PLAN_CHANGED"
    assert error.details == {"cases": [{"case_id": "c1", "revision": 2}]}


def test_bulk_preview_counts_mixed_and_will_change(env):
    set_rule(env.db, False)
    write(env, {RowKey("c1", "de"): PlanFlags(True, False)})
    preview = service(env).bulk_preview(
        "proj",
        BulkPlanRequest(
            case_ids=["c1", "c2"],
            languages={"de": LanguageChangeView(review="keep", annotate="on")},
        ),
    )
    languages = {item["key"]: item for item in preview["languages"]}
    assert set(languages) == {"source", "de", "fr"}
    de = languages["de"]
    assert de["review"] == {"on": 1, "off": 1}
    assert de["annotate"] == {"on": 0, "off": 2}
    assert de["will_change"] == 2 and de["cases_in_selection"] == 2
    assert languages["source"]["source_languages"] == ["en"]
    assert languages["source"]["review"] is None
    assert languages["fr"]["will_change"] == 0
    assert preview["cases"] == 2 and preview["changes"] == 2
    assert preview["to_assign"] == {"annotate": 2}
    assert preview["consequences"] == {
        "withdrawn": [],
        "finals_leaving": [],
        "restored": [],
        "open_reports": [],
    }
    assert preview["invalid"] == [] and preview["rule_on"] is False
    assert preview["revisions"] == {"c1": 3, "c2": 2}
    assert flags_of(env, "c2", "de") == PlanFlags(False, False)  # never writes


def test_bulk_save_is_all_or_nothing(env):
    set_rule(env.db, False)
    request = BulkPlanRequest(
        case_ids=["c1", "c2"],
        languages={"de": LanguageChangeView(review="on", annotate="on")},
        expected_revisions={"c1": 2, "c2": 1},
    )
    error = refused(lambda: service(env).bulk_save("proj", request))
    assert error.code == "WORK_PLAN_CHANGED"
    assert error.details == {"cases": [{"case_id": "c2", "revision": 2}]}
    assert flags_of(env, "c1", "de") == PlanFlags(False, False)
    assert revision_of(env, "c1") == 2
    result = service(env).bulk_save(
        "proj", request.model_copy(update={"expected_revisions": {"c1": 2, "c2": 2}})
    )
    assert result["changed_rows"] == 2
    assert result["revisions"] == {"c1": 3, "c2": 3}
    assert flags_of(env, "c2", "de") == PlanFlags(True, True)


def test_bulk_preset_annotate_only_with_rule_on_reports_invalid(env):
    write(
        env,
        {RowKey(case, "de"): PlanFlags(True, False) for case in ("c1", "c2")},
    )
    request = BulkPlanRequest(case_ids=["c1", "c2"], preset="annotate_only")
    preview = service(env).bulk_preview("proj", request)
    assert preview["invalid"] == [
        {"case_id": "c1", "language": "fr"},
        {"case_id": "c2", "language": "fr"},
    ]
    fr = next(item for item in preview["languages"] if item["key"] == "fr")
    assert fr["not_accepted"] == 2 and fr["not_acceptable"] == 0
    error = refused(lambda: service(env).bulk_save("proj", request))
    assert error.code == "WORK_PLAN_INVALID"
    assert error.details["reason"] == "annotate_not_accepted"
    result = service(env).bulk_save(
        "proj",
        request.model_copy(
            update={
                "accept_external_review": BulkAcceptance(
                    languages=["fr"], reason="Reviewed by the pipeline team"
                )
            }
        ),
    )
    assert result["changed_rows"] == 4
    with env.db.transaction() as conn:
        records = store.acceptances(conn, env.pid)
    assert {d: r["source"] for d, r in records.items()} == {
        doc("c1", "fr"): "lead",
        doc("c2", "fr"): "lead",
    }
    assert flags_of(env, "c1", "de") == PlanFlags(True, True)
    assert flags_of(env, "c2", "fr") == PlanFlags(False, True)


def test_rows_set_restores_exact_flags_for_undo(env):
    write(env, {RowKey("c1", "de"): PlanFlags(True, False)})
    aid = assign(env, doc("c1", "de"), "ana", "translation_review")
    result = service(env).bulk_save(
        "proj",
        BulkPlanRequest(
            case_ids=["c1", "c2"],
            languages={"de": LanguageChangeView(review="off")},
            confirm=True,
        ),
    )
    assert [w["assignment_id"] for w in result["withdrawn"]] == [aid]
    undo = result["undo"]
    assert undo["rows"] == [
        {
            "case_id": "c1",
            "language": "de",
            "review": True,
            "annotate": False,
            "restored_revision": None,
            "decided": True,
            "annotation_mode": None,
        }
    ]
    restored = service(env).set_rows(
        "proj",
        PlanRowsSet(
            rows=[UndoRowView(**row) for row in undo["rows"]],
            expected_revisions=undo["revisions"],
            undo=True,
        ),
    )
    assert restored["changed_rows"] == 1
    assert flags_of(env, "c1", "de") == PlanFlags(True, False)
    assert revoked(env, aid)


def test_undo_restores_exact_state_without_plan_restored(env):
    final_with_submission(env)
    off = service(env).patch_row(
        "proj",
        "c1",
        "en",
        PlanRowPatch(annotate=False, expected_revision=2, confirm=True),
    )
    service(env).set_rows(
        "proj",
        PlanRowsSet(
            rows=[UndoRowView(**row) for row in off["undo"]["rows"]],
            expected_revisions=off["undo"]["revisions"],
            undo=True,
        ),
    )
    assert flags_of(env, "c1", "en") == PlanFlags(False, True)
    with env.db.transaction() as conn:
        assert store.restored(conn, env.pid) == {}
    assert not [w for w in preflight(env)["warnings"] if w["code"] == "PLAN_RESTORED"]
    # Annotate off -> on raises PLAN_RESTORED; its Undo clears it exactly.
    second = service(env).patch_row(
        "proj",
        "c1",
        "en",
        PlanRowPatch(annotate=False, expected_revision=4, confirm=True),
    )
    on = service(env).patch_row(
        "proj",
        "c1",
        "en",
        PlanRowPatch(annotate=True, expected_revision=second["revision"], confirm=True),
    )
    assert [w for w in preflight(env)["warnings"] if w["code"] == "PLAN_RESTORED"]
    service(env).set_rows(
        "proj",
        PlanRowsSet(
            rows=[UndoRowView(**row) for row in on["undo"]["rows"]],
            expected_revisions=on["undo"]["revisions"],
            undo=True,
        ),
    )
    assert flags_of(env, "c1", "en") == PlanFlags(False, False)
    with env.db.transaction() as conn:
        assert store.restored(conn, env.pid) == {}
    assert not [w for w in preflight(env)["warnings"] if w["code"] == "PLAN_RESTORED"]


def test_undo_after_intervening_assignment_needs_confirmation(env):
    on = service(env).patch_row(
        "proj", "c1", "de", PlanRowPatch(review=True, expected_revision=2)
    )
    aid = assign(env, doc("c1", "de"), "ana", "translation_review")
    request = PlanRowsSet(
        rows=[UndoRowView(**row) for row in on["undo"]["rows"]],
        expected_revisions=on["undo"]["revisions"],
        undo=True,
    )
    stale = refused(
        lambda: service(env).set_rows(
            "proj", request.model_copy(update={"expected_revisions": {"c1": 2}})
        )
    )
    assert stale.code == "WORK_PLAN_CHANGED"
    error = refused(lambda: service(env).set_rows("proj", request))
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    assert [w["person"]["display_name"] for w in error.details["withdrawn"]] == [
        "Ana Weber"
    ]
    assert not revoked(env, aid)
    service(env).set_rows("proj", request.model_copy(update={"confirm": True}))
    assert revoked(env, aid)
    assert flags_of(env, "c1", "de") == PlanFlags(False, False)


def test_external_acceptance_refused_for_rejected_queried_or_in_review(env):
    write(env, {RowKey("c1", "fr"): PlanFlags(True, False)})
    assign(env, doc("c1", "fr"), "ana", "translation_review")
    for document_id, decision in (
        (doc("c1", "de"), "rejected"),
        (doc("c2", "de"), "query"),
    ):
        set_status(env, document_id, "reviewed")
        insert_review(env.db, "proj", document_id, decision)
    accept = AcceptExternalReview(reason="checked externally")
    for case, language, expected in (
        ("c1", "de", 3),
        ("c2", "de", 2),
        ("c1", "fr", 3),
    ):
        error = refused(
            lambda case=case, language=language, expected=expected: service(
                env
            ).patch_row(
                "proj",
                case,
                language,
                PlanRowPatch(
                    review=False,
                    annotate=True,
                    expected_revision=expected,
                    accept_external_review=accept,
                ),
            )
        )
        assert error.code == "WORK_PLAN_INVALID", (case, language, error.details)
        assert error.details["reason"] == "not_acceptable"
    preview = service(env).bulk_preview(
        "proj",
        BulkPlanRequest(
            case_ids=["c1", "c2"],
            languages={
                "de": LanguageChangeView(annotate="on"),
                "fr": LanguageChangeView(review="off", annotate="on"),
            },
        ),
    )
    languages = {item["key"]: item for item in preview["languages"]}
    assert languages["de"]["not_accepted"] == 2
    assert languages["de"]["not_acceptable"] == 2
    assert languages["de"]["in_review"] == 0
    assert languages["fr"]["not_accepted"] == 2
    assert languages["fr"]["not_acceptable"] == 1
    assert languages["fr"]["in_review"] == 1


def test_consequences_list_open_reports_and_keep_them_listed(env):
    set_rule(env.db, False)
    write(env, {RowKey("c1", "fr"): PlanFlags(False, True)})
    aid = assign(env, doc("c1", "fr"), "anno", "annotate")
    anno = logged_in(env.app, "anno", assignments=[])
    with env.db.transaction() as conn:
        revision = AssignmentService._get(conn, aid).workflow_revision
    created = anno.post(
        f"/api/v1/assignments/{aid}/problem-reports",
        json={
            "request_id": "report-1",
            "expected_workflow_revision": revision,
            "reason": "The French text is cut off",
        },
    )
    assert created.status_code == 200, created.text
    report_id = created.json()["report_id"]
    request = BulkPlanRequest(
        case_ids=["c1"], languages={"fr": LanguageChangeView(annotate="off")}
    )
    preview = service(env).bulk_preview("proj", request)
    assert preview["consequences"]["open_reports"] == [
        {
            "report_id": report_id,
            "case_id": "c1",
            "language": "fr",
            "assignment_id": aid,
            "held": True,
        }
    ]
    assert [w["assignment_id"] for w in preview["consequences"]["withdrawn"]] == [aid]
    error = refused(lambda: service(env).bulk_save("proj", request))
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    assert error.details["open_reports"][0]["report_id"] == report_id
    service(env).bulk_save("proj", request.model_copy(update={"confirm": True}))
    listed = env.lead.get(f"{BASE}/problem-reports")
    assert listed.status_code == 200, listed.text
    (report,) = [r for r in listed.json() if r["report_id"] == report_id]
    assert report["state"] == "open"


def test_new_review_of_externally_accepted_translation(env):
    service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(
            annotate=True,
            expected_revision=2,
            accept_external_review=AcceptExternalReview(reason="checked externally"),
        ),
    )
    before = len(audits(env, "work_plan.update"))
    refusal = refused(lambda: assign(env, doc("c1", "de"), "ana", "translation_review"))
    assert refusal.code == "NOT_A_TRANSLATION"
    assign(
        env,
        doc("c1", "de"),
        "ana",
        "translation_review",
        review_accepted_translation=True,
    )
    assert flags_of(env, "c1", "de") == PlanFlags(True, True)
    assert len(audits(env, "work_plan.update")) == before + 1
    # An override acceptance qualifies; a package acceptance does not.
    lead = env.app.state.accounts.get_by_username("leader")
    for document_id, source in (
        (doc("c2", "fr"), "override"),
        (doc("c2", "de"), "package"),
    ):
        set_status(env, document_id, "accepted")
        with env.db.transaction() as conn:
            store.add_acceptance(
                conn,
                env.pid,
                document_id,
                source=source,
                reason=None if source == "package" else "import override",
                accepted_by=None if source == "package" else lead.id,
            )
    assign(
        env,
        doc("c2", "fr"),
        "ana",
        "translation_review",
        review_accepted_translation=True,
    )
    assert flags_of(env, "c2", "fr").review is True
    package = refused(
        lambda: assign(
            env,
            doc("c2", "de"),
            "ana",
            "translation_review",
            review_accepted_translation=True,
        )
    )
    assert package.code == "NOT_A_TRANSLATION"
    assert flags_of(env, "c2", "de").review is False


def test_annotation_target_preview_counts_rows_over_target(env):
    assign(env, doc("c1", "en"), "anno", "annotate")
    assign(env, doc("c1", "en"), "anno2", "annotate")
    assign(env, doc("c2", "en"), "anno", "annotate")
    assert service(env).annotation_target_preview("proj", 1) == {"rows_over_target": 1}
    assert service(env).annotation_target_preview("proj", 2) == {"rows_over_target": 0}


def test_settings_change_without_new_fields_keeps_stored_values(env):
    saved = env.lead.patch(
        f"{BASE}/settings", json={"annotations_per_text": 2, "import_plan": "nothing"}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["annotations_per_text"] == 2
    kept = env.lead.patch(
        f"{BASE}/settings",
        json={"name": "Project", "annotations_per_text": None, "import_plan": None},
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["annotations_per_text"] == 2
    assert kept.json()["import_plan"] == "nothing"
    again = env.lead.patch(f"{BASE}/settings", json={"name": "Project"})
    assert again.json()["annotations_per_text"] == 2


# "c2" in fullwidth letters; NFKC folds it to ASCII.
FULLWIDTH_C2 = "".join(chr(ord(c) + 0xFEE0) for c in "c2")


def test_case_id_lookup_normalises_and_reports_unknown(env):
    result = service(env).lookup_case_ids(
        "proj", [" c1\n", "c1", FULLWIDTH_C2, "x9", " "]
    )
    assert result == {"found": ["c1", "c2"], "unknown": ["x9"]}
    error = refused(
        lambda: service(env).lookup_case_ids("proj", [f"x{i}" for i in range(5001)])
    )
    assert error.code == "CASE_IDS_TOO_MANY"


def test_discard_sets_flags_off_and_never_deletes(env):
    set_rule(env.db, False)
    write(env, {RowKey("c1", "de"): PlanFlags(True, True)})
    aid = assign(env, doc("c1", "de"), "ana", "translation_review")
    with env.db.transaction() as conn:
        documents = conn.execute(
            select(func.count()).select_from(DocumentRow)
        ).scalar_one()
    blank = refused(lambda: service(env).discard("proj", doc("c1", "de"), " ", False))
    assert blank.code == "DISCARD_REASON_REQUIRED"
    error = refused(
        lambda: service(env).discard("proj", doc("c1", "de"), "Wrong text", False)
    )
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    assert [w["assignment_id"] for w in error.details["withdrawn"]] == [aid]
    result = service(env).discard("proj", doc("c1", "de"), "Wrong text", True)
    assert result["discarded_document_ids"] == [doc("c1", "de")]
    assert result["flags"]["discarded"] is True
    assert flags_of(env, "c1", "de") == PlanFlags(False, False)
    assert revoked(env, aid)
    with env.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(DocumentRow)).scalar_one()
            == documents
        )
        assert conn.execute(
            select(DiscardedVariantRow.document_id, DiscardedVariantRow.reason)
        ).all() == [(doc("c1", "de"), "Wrong text")]
    again = refused(
        lambda: service(env).discard("proj", doc("c1", "de"), "Wrong text", True)
    )
    assert again.code == "VARIANT_ALREADY_DISCARDED"


def test_discard_one_of_two_roots_keeps_the_row_flags(env, tmp_path):
    from t1_builders import bundle, native_unit, translation_unit
    from t1_fixtures import TEXT, run_import

    set_rule(env.db, False)
    source = native_unit(doc("c2", "en"), "en", f"{TEXT} c2", case_id="c2")
    second = translation_unit(
        "c2-fr-b", "fr", f"{TEXT} c2 fr b", source=source, provider="other-mt"
    )
    (tmp_path / "second").mkdir()
    result = run_import(env.db, bundle(tmp_path / "second", [second]))
    assert result.status == "succeeded", result.error
    write(env, {RowKey("c2", "fr"): PlanFlags(True, True)})
    first_task = assign(env, doc("c2", "fr"), "ana", "translation_review")
    second_task = assign(env, "c2-fr-b", "ben", "translation_review")
    final_with_submission(env, "c2", "fr")
    open_task = assign(env, doc("c2", "fr"), "anno2", "annotate")
    report_id = report(env, "anno2", open_task)
    error = refused(
        lambda: service(env).discard(
            "proj", doc("c2", "fr"), "Duplicate delivery", False
        )
    )
    assert error.code == "WORK_PLAN_CONFIRMATION_REQUIRED"
    assert error.details["finals_leaving"] == [{"case_id": "c2", "language": "fr"}]
    assert [r["report_id"] for r in error.details["open_reports"]] == [report_id]
    assert {w["assignment_id"] for w in error.details["withdrawn"]} == {
        first_task,
        open_task,
    }
    service(env).discard("proj", doc("c2", "fr"), "Duplicate delivery", True)
    assert flags_of(env, "c2", "fr") == PlanFlags(True, True)
    assert revoked(env, first_task) and not revoked(env, second_task)
    service(env).discard("proj", "c2-fr-b", "Also wrong", True)
    assert flags_of(env, "c2", "fr") == PlanFlags(False, False)
    assert revoked(env, second_task)


def test_every_change_is_audited(env):
    service(env).patch_row(
        "proj", "c1", "de", PlanRowPatch(review=True, expected_revision=2)
    )
    aid = assign(env, doc("c1", "de"), "ana", "translation_review")
    service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(review=False, expected_revision=3, confirm=True),
    )
    first, second = audits(env, "work_plan.update")
    assert first["case_id"] == "c1" and first["withdrawn"] == []
    assert first["rows"] == [
        {
            "language": "de",
            "old": {"review": False, "annotate": False},
            "new": {"review": True, "annotate": False},
        }
    ]
    assert second["rows"][0]["old"] == {"review": True, "annotate": False}
    assert second["rows"][0]["new"] == {"review": False, "annotate": False}
    assert second["withdrawn"] == [aid]
    assert second["revision"] == 4


def test_new_final_choice_clears_plan_restored(env):
    final_with_submission(env)
    for annotate, expected in ((False, 2), (True, 3)):
        service(env).patch_row(
            "proj",
            "c1",
            "en",
            PlanRowPatch(annotate=annotate, expected_revision=expected, confirm=True),
        )
    assert [w for w in preflight(env)["warnings"] if w["code"] == "PLAN_RESTORED"]
    revision = revision_of(env, "c1")
    other = assign(env, doc("c1", "en"), "anno2", "annotate")
    submit(env, other, "s-c1-en-2")
    chosen = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": doc("c1", "en"),
            "submission_id": "s-c1-en-2",
            "expected_revision": 1,
        },
    )
    assert chosen.status_code == 200, chosen.text
    with env.db.transaction() as conn:
        assert store.restored(conn, env.pid) == {}
    assert revision_of(env, "c1") == revision
    assert not [w for w in preflight(env)["warnings"] if w["code"] == "PLAN_RESTORED"]


def test_no_flag_turns_on_for_a_discarded_row(env):
    set_rule(env.db, False)
    service(env).discard("proj", doc("c1", "de"), "Wrong text", True)
    revision = revision_of(env, "c1")
    for change in (
        PlanRowPatch(review=True, expected_revision=revision),
        PlanRowPatch(annotate=True, expected_revision=revision),
    ):
        error = refused(
            lambda change=change: service(env).patch_row("proj", "c1", "de", change)
        )
        assert error.code == "WORK_PLAN_INVALID"
        assert error.details["reason"] == "discarded"
        assert error.details["rows"][0]["case_id"] == "c1"
    rows = PlanRowsSet(
        rows=[UndoRowView(case_id="c1", language="de", review=True, annotate=False)],
        expected_revisions={"c1": revision},
    )
    error = refused(lambda: service(env).set_rows("proj", rows))
    assert error.code == "WORK_PLAN_INVALID"
    assert error.details["reason"] == "discarded"
    # Bulk skips discarded rows: nothing changes, nothing is refused.
    saved = service(env).bulk_save(
        "proj",
        BulkPlanRequest(
            case_ids=["c1"],
            languages={"de": LanguageChangeView(review="on", annotate="on")},
            expected_revisions={"c1": revision},
        ),
    )
    assert saved["changed_rows"] == 0
    assert flags_of(env, "c1", "de") == PlanFlags(False, False)


def test_bulk_save_treats_unlisted_cases_as_stale(env):
    set_rule(env.db, False)
    request = BulkPlanRequest(
        case_ids=["c1", "c2"],
        languages={"de": LanguageChangeView(review="on")},
        expected_revisions={"c1": 2},
    )
    error = refused(lambda: service(env).bulk_save("proj", request))
    assert error.code == "WORK_PLAN_CHANGED"
    assert error.details == {"cases": [{"case_id": "c2", "revision": 2}]}
    assert flags_of(env, "c1", "de") == PlanFlags(False, False)
    unchecked = service(env).bulk_save(
        "proj", request.model_copy(update={"expected_revisions": None})
    )
    assert unchecked["changed_rows"] == 2


def test_no_op_patch_writes_nothing(env):
    result = service(env).patch_row(
        "proj", "c1", "de", PlanRowPatch(review=False, expected_revision=2)
    )
    assert result["revision"] == 2
    assert result["undo"] == {"rows": [], "revisions": {"c1": 2}}
    assert revision_of(env, "c1") == 2
    assert audits(env, "work_plan.update") == []


def test_process_actor_cannot_discard(env):
    from auth_harness import HARNESS

    from ontocurator.domain.errors import AccessDenied

    process = service(env)
    process.actor = HARNESS
    with pytest.raises(AccessDenied):
        process.discard("proj", doc("c1", "de"), "Wrong text", True)


def correct(env: Any, document_id: str, username: str = "ana") -> Any:
    from ontocurator.application.translation_workflow import (
        TranslationWorkflowService,
    )
    from ontocurator.auth.audit import Actor

    lead = env.app.state.accounts.get_by_username("leader")
    variant = env.app.state.repo.get_variant("proj", document_id)
    return TranslationWorkflowService(env.db, env.app.state.jobs).assign_correction(
        Actor(lead.id, "user:leader"),
        "proj",
        document_id,
        username,
        expected_text_sha256=variant.text_sha256,
        reason="Check the wording",
        confirm_language=True,
    )


def test_correction_turns_review_on(env):
    """D26: a correction on a row with Review off turns Review on (audited)."""
    service(env).patch_row(
        "proj",
        "c1",
        "de",
        PlanRowPatch(
            annotate=True,
            expected_revision=2,
            accept_external_review=AcceptExternalReview(reason="checked externally"),
        ),
    )
    before = audits(env, "work_plan.update")
    created = correct(env, doc("c1", "de"))
    assert flags_of(env, "c1", "de") == PlanFlags(True, True)
    (audit,) = audits(env, "work_plan.update")[len(before) :]
    assert audit["rows"] == [
        {
            "language": "de",
            "old": {"review": False, "annotate": True},
            "new": {"review": True, "annotate": True},
        }
    ]
    assert audit["withdrawn"] == []
    # The idempotent retry of an open correction returns before the plan step.
    write(env, {RowKey("c1", "de"): PlanFlags(False, True)})
    revision = revision_of(env, "c1")
    again = correct(env, doc("c1", "de"))
    assert again.id == created.id
    assert flags_of(env, "c1", "de") == PlanFlags(False, True)
    assert revision_of(env, "c1") == revision
    assert len(audits(env, "work_plan.update")) == len(before) + 1


def test_correction_with_review_on_changes_no_plan(env):
    set_rule(env.db, False)
    write(env, {RowKey("c1", "de"): PlanFlags(True, False)})
    set_status(env, doc("c1", "de"), "accepted")
    revision = revision_of(env, "c1")
    correct(env, doc("c1", "de"))
    assert revision_of(env, "c1") == revision
    assert audits(env, "work_plan.update") == []
