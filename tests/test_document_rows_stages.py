"""Documents rows: stage cells, version markers, Waiting-on people and the
decided flag in the rows read model (documents overview spec "Stage cells",
"Waiting on", V10, VD3, VD8)."""

from __future__ import annotations

from typing import Any

import pytest
from document_rows_support import rows_of
from document_rows_support import service as rows_service
from sqlalchemy import insert, select, update
from test_document_rows_next_step import SECOND, add_correction, second_root
from test_document_rows_submissions import (
    _lead_service,
    _row_of,
    _submit_consolidation,
)
from test_work_rounds import create_consolidation_fixture
from tests_support_reviews import insert_review
from work_plan_support import assign, doc, plan_env, select_final, submit, write
from work_plan_support import service as plan_service

from ontotator.application.document_rows import RowQuery
from ontotator.domain.work_plans import PlanFlags, RowKey
from ontotator.storage import work_plan_store
from ontotator.storage.plan_tables import WorkPlanFlagsRow
from ontotator.storage.tables import (
    AssignmentRow,
    DocumentRow,
    ProjectRow,
    SubmissionRow,
    TranslationReviewRow,
    UserRow,
)

pytest_plugins = ("test_work_rounds",)

BOTH = PlanFlags(True, True)
REVIEW = PlanFlags(True, False)
ANNOTATE = PlanFlags(False, True)
OFF = PlanFlags(False, False)
DETAIL_KEYS = {
    "people",
    "assigned",
    "target",
    "submitted",
    "total",
    "version",
    "from_version",
    "at",
    "findings",
    "excerpt",
    "reason",
    "note",
    "matching",
    "compared",
    "causes",
    "round_ordinal",
}


def set_status(env: Any, document_id: str, status: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == document_id)
            .values(translation_status=status)
        )


@pytest.fixture
def env(tmp_path):
    env = plan_env(tmp_path)
    for case in ("c1", "c2"):
        for language in ("de", "fr"):
            set_status(env, doc(case, language), "ready_for_review")
    return env


def plan(env: Any, **flags: PlanFlags) -> None:
    write(
        env,
        {
            RowKey(*name.split("_", 1)): value  # type: ignore[call-arg]
            for name, value in flags.items()
        },
    )


def page(env: Any, **query: Any) -> dict[str, Any]:
    return rows_service(env).page("proj", RowQuery(**query))


def rows(env: Any, **query: Any) -> dict[tuple[str, str], dict[str, Any]]:
    return rows_of(page(env, **query))


def pseudonym(env: Any, username: str) -> str:
    return str(env.app.state.accounts.get_by_username(username).pseudonym)


def undecide(env: Any, *keys: tuple[str, str], import_plan: str = "nothing") -> None:
    """System-written, not decided plan rows (VD3) under ``import_plan``."""
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == env.pid)
            .values(import_plan=import_plan)
        )
        for case_id, language in keys:
            conn.execute(
                update(WorkPlanFlagsRow)
                .where(
                    WorkPlanFlagsRow.project_id == env.pid,
                    WorkPlanFlagsRow.case_id == case_id,
                    WorkPlanFlagsRow.language == language,
                )
                .values(review=False, annotate=False, decided=False)
            )


def correct(env: Any, document_id: str, username: str, reason: str) -> Any:
    """A re-review with a reason (correction request, D26)."""
    from ontotator.application.translation_workflow import (
        TranslationWorkflowService,
    )
    from ontotator.auth.audit import Actor

    lead = env.app.state.accounts.get_by_username("leader")
    variant = env.app.state.repo.get_variant("proj", document_id)
    return TranslationWorkflowService(env.db, env.app.state.jobs).assign_correction(
        Actor(lead.id, "user:leader"),
        "proj",
        document_id,
        username,
        expected_text_sha256=variant.text_sha256,
        reason=reason,
        confirm_language=True,
    )


def test_rows_carry_three_stage_cells(env):
    plan(env, c1_de=BOTH)
    result = rows(env)
    stages = result[("c1", "de")]["stages"]
    review = stages["review"]
    assert (review["state"], review["tone"]) == ("unassigned", "todo")
    assert review["detail"]["note"] == "machine_translation"
    assert review["detail"]["version"] == 1
    assert set(review["detail"]) == DETAIL_KEYS
    assert review["detail"]["people"] == []
    annotation = stages["annotation"]
    assert (annotation["state"], annotation["tone"]) == ("after_review", "waiting")
    assert (stages["final"]["state"], stages["final"]["tone"]) == ("none", "none")
    source = result[("c1", "en")]["stages"]
    assert source["review"]["state"] == "source"
    assert (source["annotation"]["state"], source["annotation"]["tone"]) == (
        "unassigned",
        "todo",
    )
    off = result[("c1", "fr")]["stages"]
    assert (off["review"]["state"], off["annotation"]["state"]) == (
        "not_planned",
        "not_planned",
    )


def test_owner_lists_people_up_to_all(env):
    for username in ("anno", "anno2", "ana"):
        assign(env, doc("c1", "en"), username, "annotate")
    en = rows(env)[("c1", "en")]
    owner = en["next_step"]["owner"]
    assert owner["kind"] == "people" and owner["count"] == 3
    assert [p["pseudonym"] for p in owner["people"]] == [
        pseudonym(env, name) for name in ("anno", "anno2", "ana")
    ]
    annotation = en["stages"]["annotation"]
    assert annotation["state"] == "in_progress"
    assert [p["display_name"] for p in annotation["detail"]["people"]] == [
        "Anne Notator",
        "Arne Notator",
        "Ana Weber",
    ]
    # Decision and assign steps belong to the lead.
    lead = rows(env)[("c2", "en")]["next_step"]["owner"]
    assert lead["kind"] == "you" and [p["is_me"] for p in lead["people"]] == [True]


def test_in_progress_owner_joins_every_in_progress_step(env):
    """Scenario 16: re-review by Ana with a reason while Anne annotates v1."""
    plan(env, c1_de=BOTH)
    set_status(env, doc("c1", "de"), "accepted")
    assign(env, doc("c1", "de"), "anno", "annotate")
    correct(env, doc("c1", "de"), "ana", "Dosis prüfen")
    de = rows(env)[("c1", "de")]
    assert [s["code"] for s in de["steps"]] == [
        "translation_review_in_progress",
        "annotation_in_progress",
    ]
    owner = de["next_step"]["owner"]
    assert owner["kind"] == "people" and owner["count"] == 2
    assert [p["pseudonym"] for p in owner["people"]] == [
        pseudonym(env, "ana"),
        pseudonym(env, "anno"),
    ]
    review = de["stages"]["review"]
    assert (review["state"], review["tone"]) == ("re_review", "running")
    assert review["detail"]["note"] == "correction"
    assert review["detail"]["reason"] == "Dosis prüfen"
    assert [p["display_name"] for p in review["detail"]["people"]] == ["Ana Weber"]
    annotation = de["stages"]["annotation"]
    assert annotation["state"] == "in_progress"
    assert annotation["detail"]["note"] == "may_change"
    # Waiting on: both people match the owner filter.
    assert ("c1", "de") in rows(env, owner=pseudonym(env, "anno"))


def insert_version(env: Any, parent: str, document_id: str, version: int) -> None:
    """Another, newer root of the parent's row (not a correction)."""
    with env.db.transaction() as conn:
        row = dict(
            conn.execute(
                select(*DocumentRow.__table__.c).where(
                    DocumentRow.project_id == env.pid,
                    DocumentRow.document_id == parent,
                )
            )
            .mappings()
            .one()
        )
        conn.execute(
            insert(DocumentRow).values(
                {
                    **row,
                    "document_id": document_id,
                    "external_id": document_id,
                    "version": version,
                    "origin": "human_translation",
                    "position": None,
                }
            )
        )


def test_version_marker(env, tmp_path):
    add_correction(env, doc("c1", "de"), "c1-de-v2", "accepted")
    insert_version(env, doc("c2", "fr"), "c2-fr-v2", 2)
    plan_service(env).discard("proj", doc("c2", "fr"), "Older text", True)
    second_root(env, tmp_path)
    result = rows(env)
    assert result[("c1", "de")]["version_marker"] == {"kind": "corrected", "version": 2}
    assert result[("c2", "fr")]["version_marker"] == {"kind": "version", "version": 2}
    assert result[("c1", "fr")]["version_marker"] == {"kind": "parallel", "version": 2}
    assert result[("c2", "de")]["version_marker"] is None


def test_undecided_row_counts_as_decision_not_assign(env):
    plan(env, c1_de=REVIEW)
    before = page(env)["bar"]
    undecide(env, ("c2", "fr"))
    result = page(env)
    bar = result["bar"]
    assert bar["needs_decision"] == before["needs_decision"] + 1
    assert bar["to_assign"] == before["to_assign"]
    assert (before["not_decided"], bar["not_decided"]) == (0, 1)
    fr = rows_of(result)[("c2", "fr")]
    step = fr["next_step"]
    assert (step["code"], step["kind"], step["action"]) == (
        "decide_plan",
        "decision",
        "plan",
    )
    assert step["owner"]["kind"] == "you"
    assert fr["in_plan"] is False
    assert fr["stages"]["review"]["state"] == "undecided"
    assert fr["stages"]["annotation"]["state"] == "undecided"
    assert (fr["stages"]["review"]["tone"], fr["stages"]["final"]["state"]) == (
        "undecided",
        "none",
    )
    # Only the project's current "Nothing planned" makes the row undecided.
    undecide(env, ("c2", "fr"), import_plan="review_and_annotate_translations")
    fr = rows(env)[("c2", "fr")]
    assert fr["next_step"] is None and fr["plan_row"]["decided"] is True


def test_decided_flag_on_plan_row(env):
    plan(env, c1_de=BOTH)
    undecide(env, ("c2", "fr"))
    result = rows(env)
    assert result[("c1", "de")]["plan_row"]["decided"] is True
    assert result[("c1", "fr")]["plan_row"]["decided"] is True  # lead wrote it
    assert result[("c2", "fr")]["plan_row"]["decided"] is False
    # A lead write decides the row.
    plan(env, c2_fr=OFF)
    assert rows(env)[("c2", "fr")]["plan_row"]["decided"] is True


def names(cell: dict[str, Any]) -> list[str | None]:
    return [person["display_name"] for person in cell["detail"]["people"]]


def test_consolidation_round_shows_consolidating_then_counts_in_final(rounds):
    """Walkthrough steps 10-11: the consolidator works, then the lead chooses
    among two annotations and the consolidation ("3 submissions")."""
    repo, ontology, reviewer, result, _inputs, access, actor = (
        create_consolidation_fixture(rounds)
    )
    key = tuple(_row_of(repo, "doc-1"))
    lead = _lead_service(repo, access, actor)

    def stages() -> dict[str, Any]:
        found = rows_of(lead.page("pkg-1", RowQuery()))
        return dict(found[(key[0], key[1])]["stages"])

    annotation = stages()["annotation"]
    assert (annotation["state"], annotation["tone"]) == ("consolidating", "running")
    assert [p["pseudonym"] for p in annotation["detail"]["people"]] == ["reviewer"]
    assert stages()["final"]["state"] == "after_review"
    _submit_consolidation(ontology, reviewer, result)
    after = stages()
    assert (after["final"]["state"], after["final"]["detail"]["submitted"]) == (
        "choose",
        3,
    )
    # The Annotation cell names the two annotators only.
    assert after["annotation"]["state"] == "submitted"
    assert [p["pseudonym"] for p in after["annotation"]["detail"]["people"]] == [
        "anna",
        "ben",
    ]


def test_accepted_in_package_and_outside(env):
    plan(env, c1_de=REVIEW, c2_de=REVIEW)
    lead = env.app.state.accounts.get_by_username("leader")
    with env.db.transaction() as conn:
        for case, source in (("c1", "package"), ("c2", "lead")):
            work_plan_store.add_acceptance(
                conn,
                env.pid,
                doc(case, "de"),
                source=source,
                reason="Reviewed outside Ontotator",
                accepted_by=lead.id,
            )
    for case in ("c1", "c2"):
        set_status(env, doc(case, "de"), "accepted")
    result = rows(env)
    notes = {
        case: (
            result[(case, "de")]["stages"]["review"]["state"],
            result[(case, "de")]["stages"]["review"]["detail"]["note"],
        )
        for case in ("c1", "c2")
    }
    assert notes == {"c1": ("accepted", "in_package"), "c2": ("accepted", "outside")}


def reviewed(env: Any, document_id: str, decision: str) -> Any:
    """A finished translation review of ``document_id`` by the project's
    first assignee; returns the decision's time."""
    review_id = insert_review(env.db, "proj", document_id, decision)
    accepted = decision.startswith("accepted")
    set_status(env, document_id, "accepted" if accepted else "reviewed")
    with env.db.transaction() as conn:
        return conn.execute(
            select(TranslationReviewRow.created_at).where(
                TranslationReviewRow.id == review_id
            )
        ).scalar_one()


def finish(env: Any, assignment_id: int) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted")
        )


def test_rejected_and_query_name_who_decided_and_when(env):
    """Scenario 4: Rejected / Query name the reviewer and the decision time."""
    plan(env, c1_de=BOTH, c2_de=BOTH)
    finish(env, assign(env, doc("c1", "de"), "ana", "translation_review"))
    rejected_at = reviewed(env, doc("c1", "de"), "rejected")
    query_at = reviewed(env, doc("c2", "de"), "query")
    result = rows(env)
    for case, state, tone, at in (
        ("c1", "rejected", "rejected", rejected_at),
        ("c2", "query", "decision", query_at),
    ):
        review = result[(case, "de")]["stages"]["review"]
        assert (review["state"], review["tone"]) == (state, tone), case
        assert names(review) == ["Ana Weber"], case
        assert review["detail"]["at"] == at, case


def test_parallel_roots_name_the_rejected_root(env, tmp_path):
    second_root(env, tmp_path)
    plan(env, c1_fr=REVIEW)
    finish(env, assign(env, doc("c1", "fr"), "ana", "translation_review"))
    reviewed(env, doc("c1", "fr"), "accepted_unchanged")
    rejected_at = reviewed(env, SECOND, "rejected")
    review = rows(env)[("c1", "fr")]["stages"]["review"]
    assert review["state"] == "rejected"
    assert review["detail"]["at"] == rejected_at


def submit_with_findings(env: Any, assignment_id: int, sid: str, count: int) -> None:
    """``submit`` with ``count`` snapshots in the stored payload (submissions
    are append-only, so the row is written once with them)."""
    from ontotator.domain.review import ReviewTargetSet
    from ontotator.domain.workspace import Submission, WorkspaceKey
    from ontotator.storage.repository import _key_str, _submission_payload

    with env.db.transaction() as conn:
        row = conn.execute(
            select(AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    key = WorkspaceKey(
        project_key="proj",
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=sid,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-10-16T10:00:00Z",
    )
    payload = {**_submission_payload(record), "snapshots": [{}] * count}
    with env.db.transaction() as conn:
        conn.execute(
            insert(SubmissionRow).values(
                project_id=env.pid,
                submission_id=sid,
                local_key=_key_str(key),
                origin_key=_key_str(key),
                document_id=row.document_id,
                annotator_id=row.pseudonym,
                mode="independent",
                draft_revision=1,
                payload=payload,
                created_at=record.created_at,
            )
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted", last_submission_id=sid)
        )


def test_findings_on_a_single_submission_only(env):
    submit_with_findings(env, assign(env, doc("c1", "en"), "anno", "annotate"), "s1", 2)
    annotation = rows(env)[("c1", "en")]["stages"]["annotation"]
    assert (annotation["state"], annotation["detail"]["findings"]) == (
        "submitted",
        2,
    )
    assert names(annotation) == ["Anne Notator"]
    submit(env, assign(env, doc("c1", "en"), "anno2", "annotate"), "s2")
    annotation = rows(env)[("c1", "en")]["stages"]["annotation"]
    assert annotation["detail"]["findings"] is None


def test_final_cell_names_author_and_kind(env):
    submit(env, assign(env, doc("c1", "en"), "anno", "annotate"), "s1")
    select_final(env, doc("c1", "en"), "s1")
    final = rows(env)[("c1", "en")]["stages"]["final"]
    assert (final["state"], final["tone"]) == ("final", "done")
    assert names(final) == ["Anne Notator"]
    assert final["detail"]["note"] == "round"
    assert final["detail"]["version"] is None  # on the newest version
