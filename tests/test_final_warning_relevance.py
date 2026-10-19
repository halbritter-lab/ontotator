"""Final warnings follow exact selected correction chains and current work."""

import pytest
from auth_harness import HARNESS
from sqlalchemy import insert
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import run_import
from test_annotation_versions import seed_submission
from test_case_api import BASE, CORRECTED, SOURCE, TARGET
from test_translation_review_task import assigned
from test_work_rounds import create_consolidation_fixture

from ontocurator.application.final_results import FinalResultService
from ontocurator.application.reviews import ReviewService
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import WorkRoundService
from ontocurator.application.workspaces import WorkspaceService
from ontocurator.assignments.service import AssignmentService
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import RevisionConflict
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.storage.tables import ProjectMembershipRow

pytest_plugins = ("test_work_rounds", "test_translation_review_task")


def pending(state):
    return [w for w in state["warnings"] if w["code"] == "ROUND_REVIEW_PENDING"]


def test_empty_carry_forward_is_pending_until_immutable_submission(rounds):
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
    rounds_service = WorkRoundService(repo.db)
    initial = rounds_service.create(
        lead, actor, assignment.id, request_id="initial", expected_workflow_revision=0
    )
    original = SubmissionService(scoped, ontology).submit(
        initial.workspace_key,
        MutationEnvelope(
            mutation_id="original",
            expected_revision=0,
            payload={"document_checked": True},
        ),
    )
    final = FinalResultService(repo.db, actor, lead)
    final.select("pkg-1", "doc-1", original.submission_id, 0, [])
    assert pending(final.preflight("pkg-1")) == []
    current = AssignmentService(repo.db)._get
    with repo.db.transaction() as conn:
        revision = current(conn, assignment.id).workflow_revision
    carried = rounds_service.create(
        lead,
        actor,
        assignment.id,
        request_id="carry",
        expected_workflow_revision=revision,
        kind="carry_forward",
        source_submission_ids=[original.submission_id],
    )
    (warning,) = pending(final.preflight("pkg-1"))
    assert warning["cause_id"].endswith(carried.round_id)
    SubmissionService(scoped, ontology).submit(
        carried.workspace_key,
        MutationEnvelope(
            mutation_id="carried",
            expected_revision=0,
            payload={"document_checked": True},
        ),
    )
    assert pending(final.preflight("pkg-1")) == []


def test_pending_consolidation_warns_until_submit_and_invalidates_acknowledgement(
    rounds,
):
    repo, ontology, reviewer, work_round, sources, lead, actor = (
        create_consolidation_fixture(rounds)
    )
    service = FinalResultService(
        repo.db,
        actor,
        Access(
            lead.user_id,
            lead.pseudonym,
            False,
            {"pkg-1": frozenset({"lead", "annotator"})},
        ),
    )
    service.select("pkg-1", "doc-1", sources[0].submission_id, 0, [])
    original = service.preflight("pkg-1")
    (warning,) = pending(original)
    assert service.preflight("pkg-1") == original
    view = WorkspaceService(reviewer, ontology).open(work_round.workspace_key)
    draft = view.draft
    for index, target in enumerate(view.targets.targets):
        draft = ReviewService(reviewer).decide(
            work_round.workspace_key,
            MutationEnvelope(
                mutation_id=f"review-{index}",
                expected_revision=draft.revision,
                payload={"target": target.model_dump(), "outcome": "confirmed"},
            ),
        )
    ready = service.preflight("pkg-1")
    (current,) = pending(ready)
    assert current["id"] == warning["id"]
    assert current["cause_revision"] > warning["cause_revision"]
    with pytest.raises(RevisionConflict):
        service.freeze(
            "pkg-1",
            {
                "request_id": "stale-review",
                "state_digest": original["state_digest"],
                "acknowledged_warnings": [
                    {"id": w["id"], "cause_revision": w["cause_revision"]}
                    for w in original["warnings"]
                ],
                "accepted_omissions": original["omissions"],
            },
        )
    SubmissionService(reviewer, ontology).submit(
        work_round.workspace_key,
        MutationEnvelope(
            mutation_id="complete-review",
            expected_revision=draft.revision,
            payload={"document_checked": True},
        ),
    )
    assert pending(service.preflight("pkg-1")) == []


def test_translation_pending_is_exact_selected_chain_and_clears_on_submission(case_env):
    env = case_env
    row = assigned(env)
    seed_submission(env, "alice", "selected-source", document=SOURCE)
    assert (
        env.lead.put(
            f"{BASE}/final-selections",
            json={
                "document_id": SOURCE,
                "submission_id": "selected-source",
                "expected_revision": 0,
            },
        ).status_code
        == 200
    )
    assert pending(env.lead.post(f"{BASE}/exports/final/preflight").json()) == []
    seed_submission(env, "alice", "selected-german", document=CORRECTED)
    assert (
        env.lead.put(
            f"{BASE}/final-selections",
            json={
                "document_id": CORRECTED,
                "submission_id": "selected-german",
                "expected_revision": 0,
            },
        ).status_code
        == 200
    )
    before = env.lead.get(f"{BASE}/workflow-warnings").json()
    assert len(pending(before)) == 1
    assert env.lead.post(f"{BASE}/exports/final/preflight").json() == before
    url = f"/api/v1/translation-reviews/{row['id']}"
    opened = env.alice.get(url).json()
    assert (
        env.alice.patch(
            "/api/v1/me/profile", json={"qualification": "Reviewer"}
        ).status_code
        == 200
    )
    saved = env.alice.put(
        url + "/draft",
        json={
            "expected_revision": 0,
            "text": opened["text"],
            "form": {"decision": "accepted_unchanged", "clinical_change": False},
        },
    )
    assert saved.status_code == 200, saved.text
    done = env.alice.post(
        url + "/submit", json={"expected_revision": saved.json()["revision"]}
    )
    assert done.status_code == 200, done.text
    assert pending(env.lead.post(f"{BASE}/exports/final/preflight").json()) == []


def test_unrelated_source_obligation_requires_selected_chain_or_active_work(
    case_env, tmp_path
):
    env = case_env
    source = native_unit("source-B", "en", "Independent source", case_id="case")
    translated = translation_unit(
        "translation-B", "de", "Independent translation", source=source
    )
    changed = correction_unit(source, "Changed independent source")
    corrected_translation = correction_unit(
        translated, "Corrected independent translation"
    )
    extra = tmp_path / "unrelated"
    extra.mkdir()
    imported = run_import(
        env.db, bundle(extra, [source, translated, corrected_translation, changed])
    )
    assert imported.status == "succeeded", imported.error
    seed_submission(env, "alice", "selected-A", document=TARGET)
    assert (
        env.lead.put(
            f"{BASE}/final-selections",
            json={
                "document_id": TARGET,
                "submission_id": "selected-A",
                "expected_revision": 0,
            },
        ).status_code
        == 200
    )
    all_causes = env.app.state.repo.list_workflow_causes("proj")
    cause = next(
        c
        for c in all_causes
        if c["code"] == "SOURCE_UPDATE_UNREVIEWED"
        and c["document_id"] == "translation-B~de~v2"
    )
    inactive = env.lead.post(f"{BASE}/exports/final/preflight").json()
    assert cause["cause_id"] not in {w.get("cause_id") for w in inactive["warnings"]}
    task = assigned(env, document="translation-B")
    active = env.lead.post(f"{BASE}/exports/final/preflight").json()
    assert cause["cause_id"] in {w.get("cause_id") for w in active["warnings"]}
    assert pending(active) == []
    AssignmentService(env.db).revoke(HARNESS, task["id"])
    assert env.lead.post(f"{BASE}/exports/final/preflight").json() == inactive
    seed_submission(env, "alice", "selected-B", document="translation-B")
    assert (
        env.lead.put(
            f"{BASE}/final-selections",
            json={
                "document_id": "translation-B",
                "submission_id": "selected-B",
                "expected_revision": 1,
            },
        ).status_code
        == 200
    )
    selected = env.lead.post(f"{BASE}/exports/final/preflight").json()
    assert cause["cause_id"] in {w.get("cause_id") for w in selected["warnings"]}
