"""Guideline version stamp at submit and on result views (G1a)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import pytest
from auth_harness import HARNESS
from sqlalchemy import insert, select
from test_annotation_versions import seed_submission
from test_case_api import BASE, CASE, SOURCE, path
from test_case_api import case_env as case_env
from test_editing import _setup_test_env
from test_lead_correction import decide, start, submit_as_lead
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save
from test_work_rounds import create_consolidation_fixture
from test_work_rounds import rounds as rounds

from ontocurator.application.editing import EditingService
from ontocurator.application.guidelines import GuidelineService
from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import (
    RoundInputResolutionService,
    WorkRoundService,
)
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import MutationEnvelope, Submission, WorkspaceKey
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import (
    ProjectMembershipRow,
    ProjectRow,
    SubmissionRow,
    TranslationReviewRow,
    UserRow,
)

CREATE = {
    "command": "create_annotation",
    "annotation_id": "a",
    "term_id": "HP:0001252",
    "axes_values": {"assertion": "present"},
    "chosen_axis_ids": ["assertion"],
    "note": "Source",
}


class Guidelines:
    """Publishes and withdraws versions through the real service as a lead."""

    def __init__(self, db: Database, key: str, actor: Actor | None = None) -> None:
        self.svc = GuidelineService(db)
        self.key = key
        self.latest: int | None = None
        if actor is None:
            with db.transaction() as conn:
                pid = conn.execute(
                    select(ProjectRow.id).where(ProjectRow.project_key == key)
                ).scalar_one()
                uid = conn.execute(
                    insert(UserRow)
                    .values(
                        username="gl-lead", display_name="Gl Lead", pseudonym="gl-lead"
                    )
                    .returning(UserRow.id)
                ).scalar_one()
                conn.execute(
                    insert(ProjectMembershipRow).values(
                        project_id=pid, user_id=uid, role="lead"
                    )
                )
            actor = Actor.user(uid, "gl-lead")
        self.actor = actor

    def publish(self, text: str) -> int:
        summary = self.svc.upload(
            self.actor,
            self.key,
            filename="rules.md",
            data=text.encode("utf-8"),
            change_note=None,
            expected_latest_version=self.latest,
        )
        self.latest = summary.version
        return summary.version

    def withdraw(self, version: int) -> None:
        assert self.latest is not None
        self.svc.withdraw(
            self.actor,
            self.key,
            version,
            reason=None,
            expected_latest_version=self.latest,
        )


def stamp(db: Database, submission_id: str) -> int | None:
    with db.transaction() as conn:
        return conn.execute(
            select(SubmissionRow.guideline_version).where(
                SubmissionRow.submission_id == submission_id
            )
        ).scalar_one()


def review_stamp(db: Database, record_id: int) -> int | None:
    with db.transaction() as conn:
        return conn.execute(
            select(TranslationReviewRow.guideline_version).where(
                TranslationReviewRow.id == record_id
            )
        ).scalar_one()


# --- the local submit paths ------------------------------------------------- #

Submit = Callable[[], Submission]


def _plain(tmp_path, mode: str) -> tuple[Repository, Submit]:
    """Independent or review submit on an unscoped repository."""
    repo, ontology, workspaces, _editor, _document = _setup_test_env(tmp_path)
    targets = ReviewTargetSet.create([])
    key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id=f"{mode}-annotator",
        mode=mode,
        target_set_id=targets.target_set_id if mode == "review" else "targets-0",
    )
    if mode == "review":
        view = workspaces.open(key, targets, pending_proposal_set_ids=[])
    else:
        view = workspaces.open(key)
    opened = view.key
    draft = EditingService(repo, ontology).apply(
        opened,
        MutationEnvelope(mutation_id="create", expected_revision=0, payload=CREATE),
    )

    def submit() -> Submission:
        return SubmissionService(repo, ontology).submit(
            opened,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=draft.revision,
                payload={"document_checked": True},
            ),
        )

    return repo, submit


def _consolidation(request) -> tuple[Repository, Submit]:
    fixture = request.getfixturevalue("rounds")
    repo, ontology, reviewer, result, _inputs, _lead, _actor = (
        create_consolidation_fixture(fixture)
    )

    def submit() -> Submission:
        view = WorkspaceService(reviewer, ontology).open(result.workspace_key)
        draft = view.draft
        for index, target in enumerate(view.targets.targets):
            draft = ReviewService(reviewer).decide(
                result.workspace_key,
                MutationEnvelope(
                    mutation_id=f"decision-{index}",
                    expected_revision=draft.revision,
                    payload={"target": target.model_dump(), "outcome": "confirmed"},
                ),
            )
        return SubmissionService(reviewer, ontology).submit(
            result.workspace_key,
            MutationEnvelope(
                mutation_id="submit",
                expected_revision=draft.revision,
                payload={"document_checked": True},
            ),
        )

    return repo, submit


def _carry_forward(request) -> tuple[Repository, Submit]:
    repo, access, actor, assignment, ontology = request.getfixturevalue("rounds")
    scoped = ScopedRepository(repo.db, access, actor)
    rounds_service = WorkRoundService(repo.db)
    first = rounds_service.create(
        access,
        actor,
        assignment.id,
        request_id="ordinary",
        expected_workflow_revision=0,
    )
    created = EditingService(scoped, ontology).apply(
        first.workspace_key,
        MutationEnvelope(mutation_id="create", expected_revision=0, payload=CREATE),
    )
    source = SubmissionService(scoped, ontology).submit(
        first.workspace_key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=created.revision,
            payload={"document_checked": True},
        ),
    )
    carried = rounds_service.create(
        access,
        actor,
        assignment.id,
        request_id="carry",
        expected_workflow_revision=1,
        kind="carry_forward",
        source_submission_ids=[source.submission_id],
    )

    def submit() -> Submission:
        draft = scoped.open_draft(carried.workspace_key)
        item = repo.get_round_input_inventory("pkg-1", carried.round_id)[0]
        done = RoundInputResolutionService(scoped).resolve(
            carried.workspace_key,
            MutationEnvelope(
                mutation_id="complete",
                expected_revision=0,
                payload={
                    "input_id": item["input_id"],
                    "outcome": "completed",
                    "annotation_ref": {
                        "annotation_id": draft.annotations[0].annotation.annotation_id,
                        "version": draft.annotations[0].version,
                    },
                },
            ),
        )
        final = SubmissionService(scoped, ontology).submit(
            carried.workspace_key,
            MutationEnvelope(
                mutation_id="finish",
                expected_revision=done.revision,
                payload={"document_checked": True},
            ),
        )
        assert repo.get_work_round("pkg-1", carried.round_id).kind == "carry_forward"
        return final

    return repo, submit


@pytest.mark.parametrize(
    "path_name",
    ["independent", "review", "consolidation", "carry_forward"],
)
def test_each_submit_path_stamps_the_current_version(
    tmp_path, request, path_name: str
) -> None:
    if path_name == "consolidation":
        repo, submit = _consolidation(request)
    elif path_name == "carry_forward":
        repo, submit = _carry_forward(request)
    else:
        repo, submit = _plain(tmp_path, path_name)
    guidelines = Guidelines(repo.db, "pkg-1")
    guidelines.publish("First rules")
    guidelines.publish("Second rules")
    submission = submit()
    assert stamp(repo.db, submission.submission_id) == 2


def test_translation_review_and_lead_correction_stamp(review_env) -> None:
    env = review_env
    guidelines = Guidelines(
        env.db, "proj", Actor.user(env.accesses["leader"].user_id, "leader")
    )
    guidelines.publish("First rules")
    AssignmentService(env.db).revoke(HARNESS, env.ids["bob"])
    revision = save(
        env,
        "rejected",
        clinical_change=True,
        categories=["omission"],
        rationale="Missing",
    )
    rejected = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    assert rejected.guideline_version == 1
    assert review_stamp(env.db, rejected.id) == 1
    guidelines.publish("Second rules")
    correction = start(env)
    record = submit_as_lead(env, correction.id, "accepted_corrected", "Korrigiert")
    assert record.guideline_version == 2
    assert record.guideline_withdrawn is False
    assert review_stamp(env.db, record.id) == 2


def test_no_version_in_force_stamps_null(tmp_path) -> None:
    repo, submit = _plain(tmp_path, "independent")
    assert stamp(repo.db, submit().submission_id) is None


def test_no_version_in_force_stamps_null_on_translation_reviews(review_env) -> None:
    # The current version withdrawn: no fallback to an earlier one (G25).
    env = review_env
    guidelines = Guidelines(
        env.db, "proj", Actor.user(env.accesses["leader"].user_id, "leader")
    )
    guidelines.publish("First rules")
    guidelines.publish("Second rules")
    guidelines.withdraw(2)
    decide(env, "accepted_unchanged")
    with env.db.transaction() as conn:
        assert conn.execute(select(TranslationReviewRow.guideline_version)).all() == [
            (None,)
        ]


def test_current_version_withdrawn_stamps_null_on_submissions(tmp_path) -> None:
    repo, submit = _plain(tmp_path, "independent")
    guidelines = Guidelines(repo.db, "pkg-1")
    guidelines.publish("First rules")
    guidelines.withdraw(1)
    assert stamp(repo.db, submit().submission_id) is None


def test_imported_submissions_stay_null(tmp_path) -> None:
    repo, submit = _plain(tmp_path, "independent")
    Guidelines(repo.db, "pkg-1").publish("First rules")
    submission = submit()
    assert stamp(repo.db, submission.submission_id) == 1
    package = repo.export_package("pkg-1")
    cloned = package.model_copy(
        update={"manifest": package.manifest.model_copy(update={"package_id": "copy"})}
    )
    repo.import_package(cloned)
    assert repo.get_submission(submission.submission_id, "copy") == submission
    with repo.db.transaction() as conn:
        copied = conn.execute(
            select(SubmissionRow.guideline_version)
            .join(ProjectRow, ProjectRow.id == SubmissionRow.project_id)
            .where(
                ProjectRow.project_key == "copy",
                SubmissionRow.submission_id == submission.submission_id,
            )
        ).scalar_one()
    assert copied is None


def test_draft_started_under_v2_submitted_under_v3_records_v3(tmp_path) -> None:
    repo, ontology, workspaces, _editor, _document = _setup_test_env(tmp_path)
    guidelines = Guidelines(repo.db, "pkg-1")
    guidelines.publish("First rules")
    guidelines.publish("Second rules")
    key = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="drafter",
            mode="independent",
            target_set_id="targets-0",
        )
    ).key
    draft = EditingService(repo, ontology).apply(
        key, MutationEnvelope(mutation_id="create", expected_revision=0, payload=CREATE)
    )
    guidelines.publish("Third rules")
    submission = SubmissionService(repo, ontology).submit(
        key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=draft.revision,
            payload={"document_checked": True},
        ),
    )
    assert stamp(repo.db, submission.submission_id) == 3


def _stamped_seed(env: Any, username: str, sid: str, version: int) -> None:
    """A submission row as ``seed_submission`` writes it, stamped with ``version``."""
    from ontocurator.storage.repository import _key_str

    user = env.app.state.accounts.get_by_username(username)
    key = WorkspaceKey(
        project_key="proj",
        document_id=SOURCE,
        annotator_id=user.pseudonym,
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
        created_at="2026-10-16T12:00:00Z",
    )
    with env.db.transaction() as conn:
        project_id = env.app.state.repo._require_project(conn, "proj")
        env.app.state.repo._insert_submission(
            conn,
            project_id,
            record,
            local_key=_key_str(key),
            imported=False,
            guideline_version=version,
        )


def test_stamp_survives_withdrawal_and_views_mark_it(case_env) -> None:
    env = case_env
    leader = env.app.state.accounts.get_by_username("leader")
    guidelines = Guidelines(env.db, "proj", Actor.user(leader.id, "leader"))
    for text in ("First", "Second", "Third"):
        guidelines.publish(text)
    _stamped_seed(env, "alice", "under-v2", 2)
    seed_submission(env, "alice", "unstamped")
    guidelines.withdraw(2)

    listing = env.lead.get(path(SOURCE, "submissions"))
    assert listing.status_code == 200, listing.text
    by_id = {item["submission_id"]: item for item in listing.json()}
    assert by_id["under-v2"]["guideline_version"] == 2
    assert by_id["under-v2"]["guideline_withdrawn"] is True
    assert by_id["unstamped"]["guideline_version"] is None
    assert by_id["unstamped"]["guideline_withdrawn"] is False
    detail = env.lead.get(path(SOURCE, "submissions/under-v2"))
    assert detail.status_code == 200, detail.text
    assert detail.json()["summary"]["guideline_version"] == 2
    assert detail.json()["summary"]["guideline_withdrawn"] is True

    rows = env.lead.get(f"{BASE}/document-rows/{quote(CASE, safe='')}/en/submissions")
    assert rows.status_code == 200, rows.text
    lines = {item["submission_id"]: item for item in rows.json()["submissions"]}
    assert lines["under-v2"]["guideline_version"] == 2
    assert lines["under-v2"]["guideline_withdrawn"] is True
    assert lines["unstamped"]["guideline_version"] is None
    assert lines["unstamped"]["guideline_withdrawn"] is False


def test_stamp_survives_withdrawal_on_translation_review_records(review_env) -> None:
    renv = review_env
    reviews = Guidelines(
        renv.db, "proj", Actor.user(renv.accesses["leader"].user_id, "leader")
    )
    reviews.publish("First")
    reviews.publish("Second")
    decide(renv, "accepted_unchanged")
    reviews.publish("Third")
    reviews.withdraw(2)
    (record,) = renv.service.records(renv.accesses["leader"], "proj", "target")
    assert record.guideline_version == 2
    assert record.guideline_withdrawn is True
    opened = renv.service.open(renv.accesses["alice"], renv.ids["alice"])
    assert opened.submitted_record is not None
    assert opened.submitted_record.guideline_version == 2
    assert opened.submitted_record.guideline_withdrawn is True


def test_stamp_is_not_part_of_the_payload(tmp_path) -> None:
    repo, submit = _plain(tmp_path, "independent")
    Guidelines(repo.db, "pkg-1").publish("First rules")
    submission = submit()
    assert stamp(repo.db, submission.submission_id) == 1
    with repo.db.transaction() as conn:
        payload = conn.execute(
            select(SubmissionRow.payload).where(
                SubmissionRow.submission_id == submission.submission_id
            )
        ).scalar_one()
    assert "guideline" not in str(payload)
    assert Submission.model_validate(payload) == submission
    assert repo.get_submission(submission.submission_id, "pkg-1") == submission
    assert submission.submission_id == Submission.model_validate(payload).submission_id
