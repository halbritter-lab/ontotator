"""Text-change operations (spec "Backend and API: Text changes", plan O2b).

Each test builds a fresh project with a German text v1 and its correction v2
(the seizure sentence is rewritten, so a finding marked there cannot be
placed on v2; the hypotonia finding can) through the real import.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from browser_carry_fixture import (
    CORRECTED_DE,
    HYPOTONIA,
    HYPOTONIA_SPAN,
    SEIZURE,
    SEIZURE_SPAN,
    TEXT_DE,
    _create,
    _new_project,
    _span,
)
from browser_documents_scenarios import (
    Scenario,
    add_user,
    assign,
    finish_round,
    identity,
    import_texts,
    select,
    start_round,
)
from browser_server import ONTOLOGY
from fastapi.testclient import TestClient
from pg_harness import database_url_for
from sqlalchemy import func, update
from sqlalchemy import select as sa_select

from ontocurator.api.app import create_app
from ontocurator.config import AppConfig
from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError
from ontocurator.storage.final_tables import FinalSelectionRow
from ontocurator.storage.overview_tables import (
    DraftSnapshotRow,
    TextChangeResolutionRow,
)
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DraftRow,
    ProjectRow,
    SubmissionRow,
)
from ontocurator.storage.workflow_tables import (
    WorkflowCommandReceiptRow,
    WorkRoundRow,
)

CASE = "case-0042"
THIRD_DE = CORRECTED_DE + " Die Eltern sind gesund."


@pytest.fixture
def app(tmp_path: Path) -> Iterator[Any]:
    # One database per test (pg_harness); each test builds its own project.
    application = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "text-change.db"),
            ontology_paths=[ONTOLOGY],
        )
    )
    # The context starts the job worker; imports with corrections need it.
    with TestClient(application):
        yield application


@dataclass
class Env:
    scenario: Scenario
    docs: list[str]

    @property
    def db(self) -> Any:
        return self.scenario.db

    @property
    def repo(self) -> Repository:
        return Repository(self.db)

    @property
    def key(self) -> str:
        return self.scenario.key

    def service(self) -> Any:
        from ontocurator.application.text_changes import TextChangeService

        return TextChangeService(self.db, self.repo)

    def lead(self) -> tuple[Any, Any]:
        return identity(self.scenario, "lead")

    def user(self, name: str) -> str:
        return self.scenario.users[name]


def _env(app: Any, texts: list[str] | None = None) -> Env:
    from t1_builders import correction_unit, native_unit

    texts = texts or [TEXT_DE, CORRECTED_DE]
    scenario = _new_project(app, "text-change")
    units = [native_unit(CASE, "de", texts[0], case_id=CASE)]
    for text in texts[1:]:
        units.append(correction_unit(units[-1], text))
    docs = import_texts(scenario, units)
    add_user(scenario, "lead", ["lead"])
    for name in ("tom", "ana", "eva"):
        add_user(scenario, name, ["annotator"], languages=("de",))
    return Env(scenario, [docs[(CASE, "de", i + 1)] for i in range(len(texts))])


@pytest.fixture
def env(app: Any) -> Env:
    return _env(app)


def _started(env: Env, name: str = "tom") -> dict[str, Any]:
    """``name`` annotates v1: a seizure finding (unplaceable) and hypotonia."""
    assignment_id = assign(env.scenario, env.docs[0], name, "annotate")
    started = start_round(env.scenario, assignment_id, name)
    for term, part in ((SEIZURE, SEIZURE_SPAN), (HYPOTONIA, HYPOTONIA_SPAN)):
        _create(
            env.scenario,
            name,
            started.workspace_key,
            term,
            span=_span(TEXT_DE, part),
        )
    return {"assignment_id": assignment_id, "round": started}


def _submitted(env: Env, name: str = "tom") -> dict[str, Any]:
    work = _started(env, name)
    work["submission_id"] = finish_round(
        env.scenario, name, work["round"].workspace_key
    )
    return work


def _revision(env: Env, assignment_id: int) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                sa_select(AssignmentRow.workflow_revision).where(
                    AssignmentRow.id == assignment_id
                )
            ).scalar_one()
        )


def _move(env: Env, assignment_id: int, **overrides: Any) -> Any:
    access, actor = env.lead()
    arguments: dict[str, Any] = {
        "target_document_id": env.docs[-1],
        "expected_workflow_revision": _revision(env, assignment_id),
        "request_id": f"move-{uuid4().hex}",
    }
    arguments.update(overrides)
    return env.service().move_to_version(access, actor, assignment_id, **arguments)


def _carry(env: Env, submission_id: str, **overrides: Any) -> Any:
    access, actor = env.lead()
    arguments: dict[str, Any] = {
        "target_document_id": env.docs[-1],
        "mode": "author",
        "username": None,
        "confirm_language": False,
        "request_id": f"carry-{uuid4().hex}",
    }
    arguments.update(overrides)
    return env.service().carry(access, actor, env.key, submission_id, **arguments)


def _resolve(env: Env, assignment_id: int, resolution: str) -> None:
    access, actor = env.lead()
    env.service().resolve(
        access,
        actor,
        assignment_id,
        resolution=resolution,
        target_document_id=env.docs[-1],
    )


def _count(env: Env, column: Any, *where: Any) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(sa_select(func.count(column)).where(*where)).scalar_one()
        )


def _pid(env: Env) -> int:
    with env.db.transaction() as conn:
        return int(
            conn.execute(
                sa_select(ProjectRow.id).where(ProjectRow.project_key == env.key)
            ).scalar_one()
        )


def _counts(env: Env) -> dict[str, int]:
    pid = _pid(env)
    return {
        "assignments": _count(env, AssignmentRow.id, AssignmentRow.project_id == pid),
        "snapshots": _count(
            env, DraftSnapshotRow.id, DraftSnapshotRow.project_id == pid
        ),
        "resolutions": _count(
            env, TextChangeResolutionRow.id, TextChangeResolutionRow.project_id == pid
        ),
        "rounds": _count(env, WorkRoundRow.round_id, WorkRoundRow.project_id == pid),
        "drafts": _count(env, DraftRow.id, DraftRow.project_id == pid),
        "submissions": _count(
            env, SubmissionRow.submission_id, SubmissionRow.project_id == pid
        ),
        "finals": _count(
            env, FinalSelectionRow.id, FinalSelectionRow.project_id == pid
        ),
    }


def _resolutions(env: Env) -> list[Any]:
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                sa_select(TextChangeResolutionRow)
                .where(TextChangeResolutionRow.project_id == _pid(env))
                .order_by(TextChangeResolutionRow.id)
            )
        )


def _audits(env: Env, action: str) -> list[Any]:
    with env.db.transaction() as conn:
        return list(
            conn.execute(
                sa_select(AuditEventRow)
                .where(
                    AuditEventRow.project_id == _pid(env),
                    AuditEventRow.action == action,
                )
                .order_by(AuditEventRow.id)
            )
        )


def _assignment(env: Env, assignment_id: int) -> Any:
    with env.db.transaction() as conn:
        return conn.execute(
            sa_select(AssignmentRow).where(AssignmentRow.id == assignment_id)
        ).one()


def _draft(env: Env, key: Any) -> Any:
    """The stored draft of ``key``, also of a revoked assignment."""
    with env.db.transaction() as conn:
        return env.repo._open_draft(conn, key, None)


def _scoped(env: Env, name: str) -> Any:
    from ontocurator.authz.scoped import ScopedRepository

    access, actor = identity(env.scenario, name)
    return ScopedRepository(env.db, access, actor)


# --- preview ---------------------------------------------------------------- #


def test_preview_counts_placed_unplaced_and_changed_passages_without_writing(env):
    work = _started(env)
    before = _counts(env)
    access, actor = env.lead()
    preview = env.service().preview(
        access,
        actor,
        env.key,
        assignment_id=work["assignment_id"],
        submission_id=None,
        target_document_id=env.docs[1],
    )
    assert (preview.from_version, preview.to_version) == (1, 2)
    assert (preview.findings, preview.placed, preview.unplaced) == (2, 1, 1)
    assert preview.in_changed_passages == 1
    persons = {p.username: p for p in preview.persons}
    assert persons[env.user("tom")].author and persons[env.user("tom")].has_work
    assert not persons[env.user("ana")].author
    assert not persons[env.user("ana")].has_work
    assert env.user("lead") not in persons
    assert _counts(env) == before


# --- move --------------------------------------------------------------------- #


def test_move_snapshots_draft_creates_target_round_and_revokes_old(env):
    from ontocurator.domain.work_rounds import DraftSnapshotPayload

    work = _started(env)
    old_key = work["round"].workspace_key
    result = _move(env, work["assignment_id"])
    # The frozen draft: both findings with their evidence, on v1.
    with env.db.transaction() as conn:
        [snapshot] = conn.execute(
            sa_select(DraftSnapshotRow).where(DraftSnapshotRow.project_id == _pid(env))
        ).all()
    payload = DraftSnapshotPayload.model_validate(snapshot.payload)
    assert payload.origin_key == old_key
    assert (payload.document_version, snapshot.document_id) == (1, env.docs[0])
    assert len(payload.snapshots) == 2
    assert all(s.evidence for s in payload.snapshots)
    assert snapshot.assignment_id == work["assignment_id"]
    # A new assignment for the same person on v2 with a text_change round.
    new = _assignment(env, result.assignment_id)
    assert (new.document_id, new.user_id, new.task) == (
        env.docs[1],
        _assignment(env, work["assignment_id"]).user_id,
        "annotate",
    )
    assert result.round.kind == "text_change"
    assert result.round.input_submission_ids == []
    assert result.round.document_id == env.docs[1]
    inventory = env.repo.get_round_input_inventory(env.key, result.round.round_id)
    assert len(inventory) == 2
    for item in inventory:
        assert item["source_submission_id"] is None
        assert item["source_draft_snapshot_id"] == snapshot.id
        assert item["input_id"] == canonical_hash(
            {
                "round": result.round.round_id,
                "draft_snapshot": snapshot.id,
                "ref": item["source_ref"]["version"],
                "id": item["source_ref"]["annotation_id"],
            }
        )
    assert sorted(i["mapping_status"] for i in inventory) == ["carried", "needs_review"]
    # The new draft starts with the placed finding (workspace_input_snapshots).
    draft = _scoped(env, "tom").open_draft(result.round.workspace_key)
    carried = [i for i in inventory if i["target_snapshot"] is not None]
    assert [s.annotation.annotation_id for s in draft.annotations] == [
        carried[0]["target_snapshot"]["annotation"]["annotation_id"]
    ]
    assert [
        s.annotation.annotation_id
        for s in env.repo.workspace_input_snapshots(result.round.workspace_key)
    ] == [carried[0]["target_snapshot"]["annotation"]["annotation_id"]]
    # The old assignment is revoked with reason moved_to_version; its draft stays.
    assert _assignment(env, work["assignment_id"]).revoked_at is not None
    [revoke] = _audits(env, "assignment.revoke")
    assert revoke.details["reason"] == "moved_to_version"
    assert int(revoke.target_id) == work["assignment_id"]
    assert len(_draft(env, old_key).annotations) == 2
    [resolution] = _resolutions(env)
    assert (resolution.resolution, resolution.assignment_id, resolution.round_id) == (
        "moved",
        work["assignment_id"],
        result.round.round_id,
    )
    assert (resolution.from_document_id, resolution.to_document_id) == tuple(env.docs)


def test_move_unplaced_inputs_need_resolution_before_submit(env):
    from ontocurator.application.submissions import SubmissionService
    from ontocurator.application.work_rounds import RoundInputResolutionService
    from ontocurator.domain.workspace import MutationEnvelope

    work = _started(env)
    result = _move(env, work["assignment_id"])
    key = result.round.workspace_key
    scoped = _scoped(env, "tom")
    ontology = env.scenario.app.state.ontology_registry

    def envelope(payload: dict[str, Any]) -> MutationEnvelope:
        return MutationEnvelope(
            mutation_id=f"m-{uuid4().hex}",
            expected_revision=scoped.open_draft(key).revision,
            payload=payload,
        )

    with pytest.raises(DomainError, match="ROUND_INPUTS_INCOMPLETE"):
        SubmissionService(scoped, ontology).submit(
            key, envelope({"document_checked": True})
        )
    resolver = RoundInputResolutionService(scoped)
    for item in env.repo.get_round_input_inventory(env.key, result.round.round_id):
        target = item["target_snapshot"]
        if target is None:
            payload = {
                "input_id": item["input_id"],
                "outcome": "dismissed",
                "reason": "Not on the corrected text",
            }
        else:
            payload = {
                "input_id": item["input_id"],
                "outcome": "completed",
                "annotation_ref": {
                    "annotation_id": target["annotation"]["annotation_id"],
                    "version": target["version"],
                },
            }
        resolver.resolve(key, envelope(payload))
    submission = SubmissionService(scoped, ontology).submit(
        key, envelope({"document_checked": True})
    )
    assert len(submission.round_input_resolutions) == 2
    assert env.repo.get_round_for_submission(
        env.key, submission.submission_id
    ).kind == ("text_change")


def test_carry_round_submissions_have_kind_carry_forward():
    from ontocurator.domain.submission_labels import submission_kind

    for kind in ("carry_forward", "text_change", "handover"):
        assert submission_kind(kind, "independent") == "carry_forward"
    assert submission_kind("ordinary", "independent") == "annotation"


def test_create_in_writes_no_receipt_or_audit(env):
    work = _started(env)
    access, _actor = env.lead()
    before_receipts = _count(
        env,
        WorkflowCommandReceiptRow.request_id,
        WorkflowCommandReceiptRow.project_id == _pid(env),
    )
    result = _move(env, work["assignment_id"], request_id="the-move")
    with env.db.transaction() as conn:
        receipts = conn.execute(
            sa_select(WorkflowCommandReceiptRow).where(
                WorkflowCommandReceiptRow.project_id == _pid(env)
            )
        ).all()
    assert len(receipts) == before_receipts + 1
    [receipt] = [r for r in receipts if r.request_id == "the-move"]
    assert receipt.actor_key == str(access.user_id)
    assert receipt.response == result.model_dump(mode="json")
    created = [
        a for a in _audits(env, "round.create") if a.target_id == result.round.round_id
    ]
    assert created == []
    [move] = _audits(env, "text_change.move")
    assert move.details["round_id"] == result.round.round_id
    assert move.details["new_assignment_id"] == result.assignment_id


def test_move_refuses_held_task(env):
    work = _started(env)
    with env.db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == work["assignment_id"])
            .values(held=True, hold_reason="problem_report")
        )
    before = _counts(env)
    with pytest.raises(DomainError, match="TASK_HELD"):
        _move(env, work["assignment_id"])
    with pytest.raises(DomainError, match="TASK_HELD"):
        _resolve(env, work["assignment_id"], "withdrawn")
    assert _counts(env) == before


def test_move_refuses_stale_target(app):
    env = _env(app, [TEXT_DE, CORRECTED_DE, THIRD_DE])
    work = _started(env)
    with pytest.raises(DomainError) as refused:
        _move(env, work["assignment_id"], target_document_id=env.docs[1])
    assert refused.value.code == "TEXT_CHANGE_CHANGED"
    assert refused.value.details == {"reason": "target_changed"}
    # v1 → v3 is an exact two-step correction ancestry.
    assert _move(env, work["assignment_id"]).round.document_id == env.docs[2]


def test_move_not_ancestor_and_already_on_target(env, monkeypatch):
    from ontocurator.application import text_changes

    on_target = assign(env.scenario, env.docs[1], "tom", "annotate")
    with pytest.raises(DomainError) as refused:
        _move(env, on_target)
    assert refused.value.code == "TEXT_CHANGE_NOT_APPLICABLE"
    assert refused.value.details == {"reason": "already_on_target"}
    # A row whose counted target is older than the work (v2 rejected): v1.
    monkeypatch.setattr(text_changes, "_row_target", lambda chain: chain.versions[0])
    with pytest.raises(DomainError) as refused:
        _move(env, on_target, target_document_id=env.docs[0])
    assert refused.value.details == {"reason": "not_ancestor"}


def test_move_refuses_submitted_work(env):
    work = _submitted(env)
    with pytest.raises(DomainError) as refused:
        _move(env, work["assignment_id"])
    assert refused.value.details == {"reason": "not_open"}


def test_move_is_idempotent_and_conflicts_on_other_body(env):
    work = _started(env)
    revision = _revision(env, work["assignment_id"])
    first = _move(
        env,
        work["assignment_id"],
        request_id="same",
        expected_workflow_revision=revision,
    )
    before = _counts(env)
    again = _move(
        env,
        work["assignment_id"],
        request_id="same",
        expected_workflow_revision=revision,
    )
    assert again == first
    assert _counts(env) == before
    with pytest.raises(DomainError, match="WORKFLOW_REQUEST_CONFLICT"):
        _move(
            env,
            work["assignment_id"],
            request_id="same",
            expected_workflow_revision=revision + 1,
        )


def test_move_refuses_stale_revision(env):
    work = _started(env)
    with pytest.raises(DomainError, match="WORKFLOW_REVISION_CONFLICT"):
        _move(
            env,
            work["assignment_id"],
            expected_workflow_revision=_revision(env, work["assignment_id"]) + 1,
        )


# --- resolution -------------------------------------------------------------- #


def test_resolution_withdrawn_revokes_and_keeps_draft(env):
    work = _started(env)
    before = _counts(env)
    _resolve(env, work["assignment_id"], "withdrawn")
    assert _assignment(env, work["assignment_id"]).revoked_at is not None
    assert len(_draft(env, work["round"].workspace_key).annotations) == 2
    [resolution] = _resolutions(env)
    assert (resolution.resolution, resolution.assignment_id) == (
        "withdrawn",
        work["assignment_id"],
    )
    [revoke] = _audits(env, "assignment.revoke")
    assert revoke.details["reason"] == "text_change_withdrawn"
    after = _counts(env)
    assert after["assignments"] == before["assignments"]
    assert after["resolutions"] == before["resolutions"] + 1
    # Repeating the same decision changes nothing.
    _resolve(env, work["assignment_id"], "withdrawn")
    assert _counts(env) == after


def test_resolution_finish_then_carry_records_only(env):
    work = _started(env)
    before = _counts(env)
    _resolve(env, work["assignment_id"], "finish_then_carry")
    assert _assignment(env, work["assignment_id"]).revoked_at is None
    [resolution] = _resolutions(env)
    assert resolution.resolution == "finish_then_carry"
    assert resolution.decided_by == env.lead()[1].user_id
    assert _counts(env) == before | {"resolutions": before["resolutions"] + 1}
    [audit] = _audits(env, "text_change.resolve")
    assert audit.details["resolution"] == "finish_then_carry"
    with pytest.raises(DomainError) as refused:
        _resolve(env, work["assignment_id"], "withdrawn")
    assert refused.value.details == {"reason": "already_resolved"}
    # The decision "let finish" stands; a later move is refused.
    with pytest.raises(DomainError) as refused:
        _move(env, work["assignment_id"])
    assert refused.value.details == {"reason": "already_resolved"}


# --- carry -------------------------------------------------------------------- #


def test_carry_author_creates_assignment_and_carry_forward_round(env):
    work = _submitted(env)
    result = _carry(env, work["submission_id"])
    assert result.resolution == "carried"
    assert result.carried_findings == 2
    assert result.round.kind == "carry_forward"
    assert result.round.input_submission_ids == [work["submission_id"]]
    assert result.round.annotator_id == work["round"].annotator_id
    new = _assignment(env, result.assignment_id)
    assert (new.document_id, new.task) == (env.docs[1], "annotate")
    assert new.user_id == _assignment(env, work["assignment_id"]).user_id
    [resolution] = _resolutions(env)
    assert (resolution.resolution, resolution.assignment_id) == ("carried", None)
    assert (resolution.submission_id, resolution.round_id) == (
        work["submission_id"],
        result.round.round_id,
    )
    [audit] = _audits(env, "text_change.carry")
    assert audit.details["mode"] == "author"
    # The old submission stays the old assignment's result.
    assert _assignment(env, work["assignment_id"]).revoked_at is None


def test_carry_author_reuses_open_assignment_without_round(env):
    work = _submitted(env)
    waiting = assign(env.scenario, env.docs[1], "tom", "annotate")
    before = _counts(env)
    result = _carry(env, work["submission_id"])
    assert result.assignment_id == waiting
    assert result.round.assignment_id == waiting
    assert _counts(env)["assignments"] == before["assignments"]


def test_carry_author_refuses_target_assignment_with_round(env):
    work = _submitted(env)
    other = assign(env.scenario, env.docs[1], "tom", "annotate")
    start_round(env.scenario, other, "tom")
    with pytest.raises(DomainError, match="ASSIGNMENT_EXISTS"):
        _carry(env, work["submission_id"])


def test_carry_other_creates_handover_round(env):
    work = _submitted(env)
    result = _carry(env, work["submission_id"], mode="other", username=env.user("ana"))
    assert result.resolution == "handed_over"
    assert result.round.kind == "handover"
    ana = identity(env.scenario, "ana")[0]
    assert result.round.annotator_id == ana.pseudonym
    assert _assignment(env, result.assignment_id).user_id == ana.user_id
    draft = _scoped(env, "ana").open_draft(result.round.workspace_key)
    assert len(draft.annotations) == 1  # the placed hypotonia finding
    [resolution] = _resolutions(env)
    assert resolution.resolution == "handed_over"


@pytest.mark.parametrize("per_text", [1, 2])
def test_handover_refused_when_person_has_work_on_row(env, per_text):
    with env.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.id == _pid(env))
            .values(annotations_per_text=per_text)
        )
    work = _submitted(env)
    # Ana holds an open annotation on v1; Eva submitted on v1.
    assign(env.scenario, env.docs[0], "ana", "annotate")
    _submitted(env, "eva")
    before = _counts(env)
    for name in ("ana", "eva", "tom"):
        with pytest.raises(DomainError, match="HANDOVER_NOT_INDEPENDENT"):
            _carry(env, work["submission_id"], mode="other", username=env.user(name))
    assert _counts(env) == before


def test_carry_dismiss_records_only(env):
    work = _submitted(env)
    before = _counts(env)
    result = _carry(env, work["submission_id"], mode="dismiss")
    assert (result.resolution, result.assignment_id, result.round) == (
        "dismissed",
        None,
        None,
    )
    assert _counts(env) == before | {"resolutions": before["resolutions"] + 1}
    with pytest.raises(DomainError) as refused:
        _carry(env, work["submission_id"])
    assert refused.value.details == {"reason": "already_resolved"}


def test_carry_from_final_does_not_touch_the_final(env):
    work = _submitted(env)
    select(env.scenario, env.docs[0], work["submission_id"])
    with env.db.transaction() as conn:
        before = conn.execute(
            sa_select(
                FinalSelectionRow.document_id,
                FinalSelectionRow.submission_id,
                FinalSelectionRow.revision,
            ).where(FinalSelectionRow.project_id == _pid(env))
        ).one()
    result = _carry(env, work["submission_id"])
    assert result.round.kind == "carry_forward"
    with env.db.transaction() as conn:
        after = conn.execute(
            sa_select(
                FinalSelectionRow.document_id,
                FinalSelectionRow.submission_id,
                FinalSelectionRow.revision,
            ).where(FinalSelectionRow.project_id == _pid(env))
        ).one()
    assert tuple(after) == tuple(before)


def test_carry_refusals(env):
    from ontocurator.assignments.service import AssignmentService
    from ontocurator.auth.audit import Actor
    from ontocurator.domain.work_plans import OFF, RowKey
    from ontocurator.storage import work_plan_store

    work = _submitted(env)
    AssignmentService(env.db).reopen(Actor.cli(), work["assignment_id"])
    with pytest.raises(DomainError) as refused:
        _carry(env, work["submission_id"])
    assert refused.value.details == {"reason": "not_submitted"}
    newer = finish_round(env.scenario, "tom", work["round"].workspace_key)
    with pytest.raises(DomainError) as refused:
        _carry(env, work["submission_id"])
    assert refused.value.details == {"reason": "not_latest_in_round"}
    # A final from another person on the row: rule 3b does not apply.
    other = _submitted(env, "ana")
    select(env.scenario, env.docs[0], other["submission_id"])
    with pytest.raises(DomainError) as refused:
        _carry(env, newer)
    assert refused.value.details == {"reason": "final_exists"}
    with env.db.transaction() as conn:
        work_plan_store.write_rows(
            conn, _pid(env), {RowKey(CASE, "de"): OFF}, actor_id=None
        )
    with pytest.raises(DomainError, match="NOT_IN_WORK_PLAN"):
        _carry(env, other["submission_id"])


def test_carry_is_idempotent_per_request(env):
    work = _submitted(env)
    first = _carry(env, work["submission_id"], request_id="carry-once")
    before = _counts(env)
    assert _carry(env, work["submission_id"], request_id="carry-once") == first
    assert _counts(env) == before
    with pytest.raises(DomainError, match="WORKFLOW_REQUEST_CONFLICT"):
        _carry(env, work["submission_id"], request_id="carry-once", mode="dismiss")


def test_operations_are_lead_only(env):
    from ontocurator.domain.errors import AccessDenied

    work = _started(env)
    access, actor = identity(env.scenario, "tom")
    with pytest.raises(AccessDenied):
        env.service().move_to_version(
            access,
            actor,
            work["assignment_id"],
            target_document_id=env.docs[1],
            expected_workflow_revision=_revision(env, work["assignment_id"]),
            request_id="mine",
        )


# --- invariants ------------------------------------------------------------- #


def test_all_or_nothing_on_failure(env, monkeypatch):
    from ontocurator.application.work_rounds import WorkRoundService

    work = _started(env)
    before = _counts(env)

    def fail(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("forced failure after the snapshot")

    monkeypatch.setattr(WorkRoundService, "create_in", fail)
    with pytest.raises(RuntimeError, match="forced failure"):
        _move(env, work["assignment_id"])
    assert _counts(env) == before
    assert _assignment(env, work["assignment_id"]).revoked_at is None


def test_nothing_is_deleted(env):
    moved = _started(env, "tom")
    carried = _submitted(env, "ana")
    withdrawn = _started(env, "eva")
    counts = [_counts(env)]
    _move(env, moved["assignment_id"])
    counts.append(_counts(env))
    _carry(env, carried["submission_id"])
    counts.append(_counts(env))
    _resolve(env, withdrawn["assignment_id"], "withdrawn")
    counts.append(_counts(env))
    for earlier, later in pairwise(counts):
        for name in ("submissions", "drafts", "rounds", "finals", "assignments"):
            assert later[name] >= earlier[name], name
    assert len(_draft(env, moved["round"].workspace_key).annotations) == 2
    assert len(_draft(env, withdrawn["round"].workspace_key).annotations) == 2
