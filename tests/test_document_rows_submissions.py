"""Documents submissions view (service level)."""

import pytest
from document_rows_support import service
from sqlalchemy import insert, select, update
from test_annotation_versions import seed_submission
from test_case_api import CASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env
from test_translation_review_task import assigned
from test_work_rounds import create_consolidation_fixture

from ontotator.application.document_rows import DocumentRowsService
from ontotator.application.reviews import ReviewService
from ontotator.application.submissions import SubmissionService
from ontotator.application.work_rounds import WorkRoundService
from ontotator.application.workspaces import WorkspaceService
from ontotator.assignments.service import AssignmentService
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Access
from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.errors import DomainError
from ontotator.domain.workspace import MutationEnvelope
from ontotator.storage.tables import DocumentRow, ProjectMembershipRow, ProjectRow

pytest_plugins = ("test_work_rounds", "test_translation_review_task")


def _lead_service(repo, access, actor):
    lead = Access(
        access.user_id,
        access.pseudonym,
        False,
        {"pkg-1": frozenset({"lead", "annotator"})},
    )
    return DocumentRowsService(repo.db, actor, lead)


def _row_of(repo, document_id):
    with repo.db.transaction() as conn:
        return conn.execute(
            select(DocumentRow.case_id, DocumentRow.language).where(
                DocumentRow.document_id == document_id
            )
        ).one()


def _submit_consolidation(ontology, reviewer, result):
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


def test_submissions_cover_all_versions_with_kinds_ordinals_and_counts(rounds):
    repo, ontology, reviewer, result, inputs, access, actor = (
        create_consolidation_fixture(rounds)
    )
    case_id, language = _row_of(repo, "doc-1")
    svc = _lead_service(repo, access, actor)

    before = svc.submissions("pkg-1", case_id, language)
    open_round = next(r for r in before["rounds"] if r["round_id"] == result.round_id)
    assert open_round["kind"] == "consolidation" and open_round["submitted"] is False
    assert open_round["author_label"] == "reviewer"
    assert len(before["submissions"]) == 2

    output = _submit_consolidation(ontology, reviewer, result)
    after = svc.submissions("pkg-1", case_id, language)
    assert after["case_id"] == case_id and after["language"] == language
    subs = after["submissions"]
    kinds = [s["kind"] for s in subs]
    assert kinds.count("annotation") == 2 and kinds[-1] == "consolidation"
    assert subs[-1]["submission_id"] == output.submission_id
    assert subs[-1]["round_id"] == result.round_id
    assert subs[-1]["round_state"] == "submitted"
    assert all(s["round_ordinal"] == 1 for s in subs if s["kind"] == "annotation")
    assert [s["recorded_at"] for s in subs] == sorted(s["recorded_at"] for s in subs)
    assert all(isinstance(s["finding_count"], int) for s in subs)
    # Decided in the editor without the consolidation view: nothing automatic.
    assert all(s["kept_automatically"] == 0 for s in subs)
    assert {s["finding_count"] for s in subs if s["kind"] == "annotation"} == {1}
    assert all(s["is_latest_in_round"] is None for s in subs)
    assert all(s["chain_name"] is None for s in subs)
    assert all(s["document_id"] == "doc-1" for s in subs)
    mine = [s for s in subs if s["is_me"]]
    assert [s["submission_id"] for s in mine] == [inputs[0].submission_id]
    assert mine[0]["author_label"] == access.pseudonym

    assert all(r["mode"] is not None for r in after["rounds"])
    assert len(after["rounds"]) == 3
    assert all(r["submitted"] for r in after["rounds"])
    assert all(r["round_ordinal"] == 1 for r in after["rounds"])
    assert after["open_translation_reviews"] == []
    assert after["adjudicator_not_annotator"] is False


def test_current_project_rule_is_reported(rounds):
    repo, _ontology, _reviewer, _result, _inputs, access, actor = (
        create_consolidation_fixture(rounds)
    )
    with repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "pkg-1")
            .values(adjudicator_not_annotator=True)
        )
    case_id, language = _row_of(repo, "doc-1")
    result = _lead_service(repo, access, actor).submissions("pkg-1", case_id, language)
    assert result["adjudicator_not_annotator"] is True


def test_submission_without_round_has_no_ordinal(case_env):
    seed_submission(case_env, "alice", "loose", document=SOURCE)
    result = service(case_env).submissions("proj", CASE, "en")
    loose = next(s for s in result["submissions"] if s["submission_id"] == "loose")
    assert loose["round_id"] is None and loose["round_ordinal"] is None
    assert loose["round_state"] is None and loose["is_latest_in_round"] is None
    assert loose["finding_count"] == 0
    assert loose["kind"] == "annotation" and loose["is_me"] is False
    assert loose["version"] == 1


def test_unknown_row_is_case_not_found(case_env):
    with pytest.raises(DomainError) as caught:
        service(case_env).submissions("proj", "missing-case", "de")
    assert caught.value.code == "CASE_NOT_FOUND"


def test_open_translation_review_is_listed_and_its_round_is_not(case_env):
    row = assigned(case_env)
    case_env.alice.get(f"/api/v1/translation-reviews/{row['id']}")
    result = service(case_env).submissions("proj", CASE, "de")
    (review,) = result["open_translation_reviews"]
    assert review["assignment_id"] == row["id"]
    assert review["document_id"] == TARGET and review["version"] == 1
    alice = case_env.app.state.accounts.get_by_username("alice")
    assert review["reviewer_label"] == alice.pseudonym and review["is_me"] is False
    assert review["chain_name"] is None
    assert all(r["mode"] is not None for r in result["rounds"])


def test_resubmitted_round_marks_latest_submission(rounds):
    repo, access, actor, assignment, ontology = rounds
    with repo.db.transaction() as conn:
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=repo._require_project(conn, "pkg-1"),
                user_id=access.user_id,
                role="lead",
            )
        )
    lead = Access(
        access.user_id,
        access.pseudonym,
        False,
        {"pkg-1": frozenset({"lead", "annotator"})},
    )
    scoped = ScopedRepository(repo.db, lead, actor)
    created = WorkRoundService(repo.db).create(
        lead, actor, assignment.id, request_id="r1", expected_workflow_revision=0
    )
    submit = SubmissionService(scoped, ontology).submit
    first = submit(
        created.workspace_key,
        MutationEnvelope(
            mutation_id="first", expected_revision=0, payload={"document_checked": True}
        ),
    )
    AssignmentService(repo.db).reopen(Actor.cli(), assignment.id, "again")
    second = submit(
        created.workspace_key,
        MutationEnvelope(
            mutation_id="second",
            expected_revision=1,
            payload={"document_checked": True},
        ),
    )
    assert first.submission_id != second.submission_id
    case_id, language = _row_of(repo, "doc-1")
    result = DocumentRowsService(repo.db, actor, lead).submissions(
        "pkg-1", case_id, language
    )
    by_id = {s["submission_id"]: s for s in result["submissions"]}
    assert by_id[first.submission_id]["round_id"] == created.round_id
    assert by_id[second.submission_id]["round_id"] == created.round_id
    assert by_id[first.submission_id]["is_latest_in_round"] is False
    assert by_id[second.submission_id]["is_latest_in_round"] is True
    assert by_id[second.submission_id]["is_me"] is True
    (listed,) = result["rounds"]
    assert listed["round_id"] == created.round_id and listed["submitted"] is True
    assert listed["round_ordinal"] == 1 and listed["is_me"] is True


def test_submissions_of_every_version_oldest_first(case_env):
    seed_submission(
        case_env, "alice", "on-v2", document=CORRECTED, timestamp="2026-10-16T09:00:00Z"
    )
    seed_submission(case_env, "alice", "on-v1", document=TARGET)
    result = service(case_env).submissions("proj", CASE, "de")
    subs = result["submissions"]
    assert [s["submission_id"] for s in subs] == ["on-v2", "on-v1"]
    assert [s["version"] for s in subs] == [2, 1]
    assert [s["document_id"] for s in subs] == [CORRECTED, TARGET]
    assert all(s["chain_name"] is None for s in subs)
