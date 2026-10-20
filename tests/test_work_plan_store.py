"""Work-plan store on real PostgreSQL (spec "Work plan", data model)."""

from typing import Any

import pytest
from pg_harness import database_for
from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError

from ontocurator.domain.work_plans import (
    LanguageVersion,
    OpenReport,
    OpenTask,
    PlanFlags,
    RowKey,
)
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    TranslationReviewRow,
    UserRow,
)
from ontocurator.storage.workflow_tables import (
    ProblemReportRow,
    ProblemReportStateRow,
    TaskHoldRow,
    TaskHoldStateRow,
)

ON_ON, OFF_ON = PlanFlags(True, True), PlanFlags(False, True)
ON_OFF, OFF_OFF = PlanFlags(True, False), PlanFlags(False, False)


class Env:
    def __init__(self, db: Any, pid: int, lead: int, ann: int) -> None:
        self.db, self.pid, self.lead, self.ann = db, pid, lead, ann

    def doc(
        self,
        document_id: str,
        case: str,
        language: str,
        origin: str = "machine_translation",
        status: str | None = "ready_for_review",
        *,
        derived_from: str | None = None,
        version: int = 1,
        external_id: str | None = None,
    ) -> None:
        if origin == "native":
            status = None
        if origin != "native" and derived_from is None:
            derived_from = f"{case}-en"
        with self.db.transaction() as conn:
            conn.execute(
                insert(DocumentRow).values(
                    project_id=self.pid,
                    document_id=document_id,
                    case_id=case,
                    external_id=external_id or document_id,
                    version=version,
                    origin=origin,
                    derived_from=derived_from,
                    translation_status=status,
                    language=language,
                    text=document_id,
                    text_sha256="a" * 64,
                )
            )

    def assign(
        self, document_id: str, task: str, status: str = "open", **values: Any
    ) -> int:
        with self.db.transaction() as conn:
            return int(
                conn.execute(
                    insert(AssignmentRow)
                    .values(
                        project_id=self.pid,
                        document_id=document_id,
                        user_id=values.pop("user_id", self.ann),
                        task=task,
                        status=status,
                        **values,
                    )
                    .returning(AssignmentRow.id)
                ).scalar_one()
            )

    def review(self, document_id: str, decision: str) -> None:
        aid = self.assign(document_id, "translation_review", "submitted")
        with self.db.transaction() as conn:
            conn.execute(
                insert(TranslationReviewRow).values(
                    project_id=self.pid,
                    document_id=document_id,
                    assignment_id=aid,
                    reviewer_user_id=self.ann,
                    reviewer_pseudonym="ann-0001",
                    reviewer_qualification="q",
                    reviewer_languages=[],
                    decision=decision,
                    clinical_change=False,
                    machine_text_sha256="h",
                    proposed_text="x",
                    proposed_text_sha256="h",
                    status_before="ready_for_review",
                    status_after="reviewed",
                    review_policy="p",
                )
            )

    def discard(self, document_id: str) -> None:
        with self.db.transaction() as conn:
            conn.execute(
                insert(DiscardedVariantRow).values(
                    project_id=self.pid,
                    document_id=document_id,
                    reason="wrong text",
                    discarded_by=self.lead,
                )
            )

    def run(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        with self.db.transaction() as conn:
            return fn(conn, self.pid, *args, **kwargs)


@pytest.fixture
def env(tmp_path) -> Env:
    db = database_for(tmp_path / "work-plan-store.db")
    with db.transaction() as conn:
        pid = conn.execute(
            insert(ProjectRow)
            .values(
                project_key="p",
                name="P",
                manifest={},
                manifest_sha256="m",
                task_profile={},
                task_profile_sha256="t",
            )
            .returning(ProjectRow.id)
        ).scalar_one()
        ids = [
            conn.execute(
                insert(UserRow)
                .values(username=name, display_name=name, pseudonym=pseudonym)
                .returning(UserRow.id)
            ).scalar_one()
            for name, pseudonym in (("lead", "lead-0001"), ("ann", "ann-0001"))
        ]
    return Env(db, pid, ids[0], ids[1])


def test_language_versions_detect_source_accepted_and_parallel_roots(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    env.doc("c1-fr-a", "c1", "fr", status="accepted")
    env.doc("c1-fr-b", "c1", "fr")
    env.doc("c2-en", "c2", "en", "native")
    got = env.run(store.language_versions)
    assert set(got) == {RowKey("c1", "en"), RowKey("c1", "fr"), RowKey("c2", "en")}
    assert got[RowKey("c1", "en")] == LanguageVersion("c1", "en", True, False, False)
    assert got[RowKey("c1", "fr")] == LanguageVersion("c1", "fr", False, False, False)

    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == "c1-fr-b")
            .values(translation_status="accepted")
        )
    fr = env.run(store.language_versions, ["c1"])[RowKey("c1", "fr")]
    assert fr.accepted and not fr.marked_in_package

    env.run(
        store.add_acceptance, "c1-fr-a", source="package", reason=None, accepted_by=None
    )
    assert not env.run(store.language_versions)[RowKey("c1", "fr")].marked_in_package
    env.run(
        store.add_acceptance, "c1-fr-b", source="package", reason=None, accepted_by=None
    )
    assert env.run(store.language_versions)[RowKey("c1", "fr")].marked_in_package
    assert list(env.run(store.language_versions, ["c2"])) == [RowKey("c2", "en")]


def test_language_versions_skip_discarded_roots(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    env.doc("c1-fr-a", "c1", "fr", status="accepted")
    env.doc("c1-fr-b", "c1", "fr", status="reviewed")
    env.review("c1-fr-b", "rejected")
    fr = env.run(store.language_versions)[RowKey("c1", "fr")]
    assert (fr.accepted, fr.review_blocked, fr.discarded) == (False, True, False)

    env.discard("c1-fr-b")
    fr = env.run(store.language_versions)[RowKey("c1", "fr")]
    assert (fr.accepted, fr.review_blocked, fr.discarded) == (True, False, False)

    env.discard("c1-fr-a")
    fr = env.run(store.language_versions)[RowKey("c1", "fr")]
    assert fr.discarded and not fr.accepted
    assert set(env.run(store.discarded)) == {"c1-fr-a", "c1-fr-b"}


def test_language_versions_flag_review_blocked(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    # de: v1 accepted after correction; the correction v2 was rejected.
    env.doc("c1-de", "c1", "de", status="accepted")
    env.doc(
        "c1-de-2",
        "c1",
        "de",
        "correction",
        "reviewed",
        derived_from="c1-de",
        version=2,
        external_id="c1-de",
    )
    env.review("c1-de-2", "rejected")
    # it: an open translation review; es: queried; nl: accepted.
    env.doc("c1-it", "c1", "it")
    env.assign("c1-it", "translation_review")
    env.doc("c1-es", "c1", "es", status="reviewed")
    env.review("c1-es", "query")
    env.doc("c1-nl", "c1", "nl", status="accepted")
    got = env.run(store.language_versions)
    de = got[RowKey("c1", "de")]
    assert de.accepted and de.review_blocked  # newest that counts is v1
    assert got[RowKey("c1", "it")].review_blocked
    assert got[RowKey("c1", "es")].review_blocked
    assert not got[RowKey("c1", "es")].accepted
    assert not got[RowKey("c1", "nl")].review_blocked
    assert not got[RowKey("c1", "en")].review_blocked


def test_revisions_default_to_1_and_write_rows_stores_current_plus_one(env) -> None:
    de, fr = RowKey("c1", "de"), RowKey("c1", "fr")
    assert env.run(store.revisions, ["c1", "c2"]) == {"c1": 1, "c2": 1}
    assert env.run(store.write_rows, {de: ON_ON}, actor_id=env.lead) == {"c1": 2}
    assert env.run(store.write_rows, {de: OFF_ON, fr: ON_ON}, actor_id=None) == {
        "c1": 3
    }
    assert env.run(store.revisions, ["c1"]) == {"c1": 3}
    assert env.run(store.plan_rows) == {de: OFF_ON, fr: ON_ON}
    assert env.run(store.plan_rows, ["c2"]) == {}


def test_write_rows_sets_and_clears_restored_revision_exactly(env) -> None:
    de, fr = RowKey("c1", "de"), RowKey("c1", "fr")
    env.run(
        store.write_rows,
        {de: ON_ON, fr: ON_ON},
        actor_id=env.lead,
        restored={de: 2, fr: 2},
    )
    assert env.run(store.restored) == {de: 2, fr: 2}
    # Annotate stays on: kept; annotate turns off: cleared.
    env.run(store.write_rows, {de: OFF_ON, fr: ON_OFF}, actor_id=env.lead)
    assert env.run(store.restored) == {de: 2}
    # An exact value (Undo) is written as given, None clears it.
    env.run(
        store.write_rows,
        {de: ON_ON, fr: ON_ON},
        actor_id=None,
        restored={de: None, fr: 7},
    )
    assert env.run(store.restored) == {fr: 7}


def test_ensure_rows_inserts_only_missing(env) -> None:
    de, fr, en = RowKey("c1", "de"), RowKey("c1", "fr"), RowKey("c2", "en")
    env.run(store.write_rows, {de: OFF_OFF}, actor_id=env.lead)
    assert env.run(store.ensure_rows, {de: ON_ON, fr: ON_ON, en: OFF_ON}) == 2
    assert env.run(store.ensure_rows, {de: ON_ON, fr: OFF_OFF}) == 0
    assert env.run(store.plan_rows) == {de: OFF_OFF, fr: ON_ON, en: OFF_ON}
    assert env.run(store.revisions, ["c1", "c2"]) == {"c1": 2, "c2": 1}


def test_effective_plan_falls_back_to_project_default(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    env.doc("c1-de", "c1", "de")
    env.doc("c1-fr", "c1", "fr", status="accepted")
    env.doc("c2-en", "c2", "en", "native")
    env.run(
        store.add_acceptance, "c1-fr", source="package", reason=None, accepted_by=None
    )
    env.run(store.write_rows, {RowKey("c1", "de"): OFF_OFF}, actor_id=env.lead)
    assert env.run(store.effective_plan) == {
        RowKey("c1", "en"): OFF_OFF,
        RowKey("c1", "de"): OFF_OFF,  # stored
        RowKey("c1", "fr"): OFF_ON,  # marked in the package
        RowKey("c2", "en"): OFF_ON,  # source without translation
    }
    with env.db.transaction() as conn:
        conn.execute(update(ProjectRow).values(import_plan="nothing"))
    assert env.run(store.effective_plan, ["c1"]) == {
        RowKey("c1", "en"): OFF_OFF,
        RowKey("c1", "de"): OFF_OFF,
        RowKey("c1", "fr"): OFF_OFF,
    }


def test_open_tasks_excludes_revoked_and_submitted(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    env.doc("c1-fr", "c1", "fr")
    env.doc("c1-de", "c1", "de")
    review = env.assign("c1-fr", "translation_review")
    annotate = env.assign("c1-fr", "annotate", "in_progress", user_id=env.lead)
    env.assign("c1-fr", "review", "submitted")
    revoked = env.assign("c1-de", "annotate")
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == revoked)
            .values(revoked_at=AssignmentRow.created_at)
        )
    keys = [RowKey("c1", "fr"), RowKey("c1", "de")]
    got = env.run(store.open_tasks, keys)
    assert got == [
        OpenTask(review, "c1", "fr", "translation_review", env.ann),
        OpenTask(annotate, "c1", "fr", "annotate", env.lead),
    ]
    assert revoked not in {t.assignment_id for t in got}
    assert env.run(store.open_tasks, keys, lock=True) == got
    assert env.run(store.open_tasks, []) == []


def test_open_reports_lists_open_reports_and_active_holds(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    env.doc("c1-fr", "c1", "fr")
    task = env.assign("c1-fr", "annotate")
    with env.db.transaction() as conn:
        for report_id, state in (("r1", "open"), ("r2", "resolved"), ("r3", "open")):
            conn.execute(
                insert(ProblemReportRow).values(
                    report_id=report_id,
                    project_id=env.pid,
                    assignment_id=task,
                    reporter_id=env.ann,
                    reason="broken",
                    created_at=_now(conn),
                )
            )
            conn.execute(
                insert(ProblemReportStateRow).values(
                    report_id=report_id, state=state, revision=1
                )
            )
        for hold_id, report_id, active in (("h1", "r1", True), ("h3", "r3", False)):
            conn.execute(
                insert(TaskHoldRow).values(
                    hold_id=hold_id,
                    project_id=env.pid,
                    assignment_id=task,
                    report_id=report_id,
                    reason="broken",
                    created_by=env.ann,
                    created_at=_now(conn),
                )
            )
            conn.execute(
                insert(TaskHoldStateRow).values(hold_id=hold_id, active=active)
            )
    assert env.run(store.open_reports, [RowKey("c1", "fr"), RowKey("c1", "en")]) == [
        OpenReport("r1", "c1", "fr", task, True),
        OpenReport("r3", "c1", "fr", task, False),
    ]
    assert env.run(store.open_reports, [RowKey("c1", "en")]) == []


def test_final_keys(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    with env.db.transaction() as conn:
        conn.execute(
            insert(FinalSelectionRow).values(
                project_id=env.pid,
                case_id="c1",
                language="en",
                document_id="c1-en",
                submission_id="s",
                revision=1,
                actor_id=env.lead,
                acknowledged_cause_ids=[],
            )
        )
    assert env.run(store.final_keys) == frozenset({RowKey("c1", "en")})


def test_acceptance_requires_reason_except_package(env) -> None:
    env.doc("c1-en", "c1", "en", "native")
    env.doc("c1-fr", "c1", "fr", status="accepted")
    env.run(
        store.add_acceptance,
        "c1-fr",
        source="package",
        reason=None,
        accepted_by=None,
        metadata={"reviewer": "R"},
    )
    env.run(
        store.add_acceptance,
        "c1-fr",
        source="lead",
        reason="Checked",
        accepted_by=env.lead,
    )
    newest = env.run(store.acceptances)["c1-fr"]
    assert (newest["source"], newest["reason"], newest["accepted_by"]) == (
        "lead",
        "Checked",
        env.lead,
    )
    for source in ("lead", "override"):
        with pytest.raises(IntegrityError, match="ck_translation_acceptances_reason"):
            env.run(
                store.add_acceptance,
                "c1-fr",
                source=source,
                reason=None,
                accepted_by=env.lead,
            )
    with pytest.raises(IntegrityError, match="ck_translation_acceptances_source"):
        env.run(
            store.add_acceptance, "c1-fr", source="vendor", reason="x", accepted_by=None
        )


def _now(conn: Any) -> Any:
    return conn.execute(select(func.now())).scalar_one()
