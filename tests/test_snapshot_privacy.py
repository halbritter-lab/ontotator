"""Raw content-addressed reads do not bypass private human input boundaries."""

from sqlalchemy import insert
from test_work_rounds import create_consolidation_fixture
from test_work_rounds import rounds as rounds

from ontocurator.application.editing import EditingService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.authz.workflow import may_read_snapshot
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.packages.models import SearchEventRecord
from ontocurator.storage.tables import ProjectMembershipRow, UserLanguageRow, UserRow


def test_shared_document_does_not_grant_foreign_annotation_or_evidence(rounds):
    repo, owner, actor, assignment, ontology = rounds
    scoped = ScopedRepository(repo.db, owner, actor)
    item = WorkRoundService(repo.db).create(
        owner, actor, assignment.id, request_id="start", expected_workflow_revision=0
    )
    draft = EditingService(scoped, ontology).apply(
        item.workspace_key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "private",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "evidence_id": "private-e",
                "segments": [{"start": 27, "end": 36}],
            },
        ),
    )
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, "pkg-1")
        uid = conn.execute(
            insert(UserRow)
            .values(username="stranger", display_name="Stranger", pseudonym="stranger")
            .returning(UserRow.id)
        ).scalar_one()
        conn.execute(
            insert(ProjectMembershipRow).values(
                project_id=pid, user_id=uid, role="annotator"
            )
        )
        conn.execute(insert(UserLanguageRow).values(user_id=uid, language="en"))
    from auth_harness import harness_annotation

    with harness_annotation(repo.db, "pkg-1", "doc-1"):
        AssignmentService(repo.db).assign(
            Actor.cli(), "pkg-1", "doc-1", "stranger", "annotate"
        )
    stranger = Access(uid, "stranger", False, {"pkg-1": frozenset({"annotator"})})
    with repo.db.transaction() as conn:
        for kind, identity, version in [
            ("annotation", "private", draft.annotations[0].version),
            ("evidence", "private-e", draft.evidence[0].version),
        ]:
            assert may_read_snapshot(conn, owner, pid, "pkg-1", kind, identity, version)
            assert not may_read_snapshot(
                conn, stranger, pid, "pkg-1", kind, identity, version
            )
            assert not may_read_snapshot(
                conn, owner, pid, "pkg-1", kind, identity, "0" * 64
            )
    submission = SubmissionService(scoped, ontology).submit(
        item.workspace_key,
        MutationEnvelope(
            mutation_id="submit",
            expected_revision=draft.revision,
            payload={"document_checked": True},
        ),
    )
    other = ScopedRepository(repo.db, stranger, Actor.user(uid, "stranger"))
    assert [
        s.submission_id for s in scoped.get_submissions_for_document("pkg-1", "doc-1")
    ] == [submission.submission_id]
    assert other.get_submissions_for_document("pkg-1", "doc-1") == []
    event = SearchEventRecord(
        event_id="private-search",
        workspace_key=item.workspace_key,
        annotation_id="private",
        query="Private clinical query",
        route="lexical",
        candidates=[],
        ontology_release="test",
        index_identity="test",
        timestamp="2026-10-19T00:00:00Z",
    )
    repo.save_search_event(event)
    assert scoped.get_search_event(event.event_id, "pkg-1") == event
    assert other.get_search_event(event.event_id, "pkg-1") is None
    with repo.db.transaction() as conn:
        assert may_read_snapshot(
            conn,
            owner,
            pid,
            "pkg-1",
            "annotation",
            "private",
            submission.snapshots[0].version,
        )


def test_selected_human_input_grants_exact_snapshot_to_assigned_reviewer(rounds):
    repo, _, reviewer, _work_round, sources, _, _ = create_consolidation_fixture(rounds)
    assert {
        s.submission_id for s in reviewer.get_submissions_for_document("pkg-1", "doc-1")
    } == {s.submission_id for s in sources}
    with repo.db.transaction() as conn:
        pid = repo._require_project(conn, "pkg-1")
        for source in sources:
            snap = source.snapshots[0]
            assert may_read_snapshot(
                conn,
                reviewer.access,
                pid,
                "pkg-1",
                "annotation",
                snap.annotation.annotation_id,
                snap.version,
            )
