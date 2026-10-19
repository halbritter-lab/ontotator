"""Current exact version refs, own-only history and proposal payload boundaries."""

from urllib.parse import quote

import pytest
from auth_harness import HARNESS
from sqlalchemy import insert
from test_case_api import BASE, CORRECTED, SOURCE, TARGET, path
from test_case_api import case_env as case_env

from ontocurator.assignments.service import AssignmentService
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import Submission, WorkspaceKey
from ontocurator.storage.repository import _key_str
from ontocurator.storage.tables import ProposalSetRow


def refs(client, document=TARGET, **params):
    response = client.get(path(document, "annotation-versions"), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def seed_submission(
    env, username, sid, document=SOURCE, timestamp="2026-10-16T10:00:00Z"
):
    user = env.app.state.accounts.get_by_username(username)
    key = WorkspaceKey(
        project_key="proj",
        document_id=document,
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
        created_at=timestamp,
    )
    with env.db.transaction() as conn:
        project_id = env.app.state.repo._require_project(conn, "proj")
        env.app.state.repo._insert_submission(
            conn, project_id, record, local_key=_key_str(key), imported=False
        )


def test_own_refs_are_newest_first_and_foreign_own_never_visible(case_env):
    env = case_env
    seed_submission(env, "alice", "own/old #é")
    seed_submission(env, "alice", "own/new #é", timestamp="2026-10-16T11:00:00Z")
    own = refs(env.alice, SOURCE)
    assert [row["id"] for row in own] == ["own/new #é", "own/old #é"]
    fetched = env.alice.get(
        path(SOURCE, f"annotation-versions/own/{quote('own/new #é', safe='')}")
    )
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["ref"]["id"] == "own/new #é"
    for client in (env.reviewer, env.lead, env.admin):
        assert not any(row["kind"] == "own" for row in refs(client, SOURCE))
        denied = client.get(
            path(SOURCE, f"annotation-versions/own/{quote('own/new #é', safe='')}")
        )
        assert (
            denied.status_code == 404 and denied.json()["code"] == "VERSION_NOT_FOUND"
        )


def test_review_proposals_are_exact_and_annotate_sibling_metadata_is_not_a_bypass(
    case_env,
):
    env = case_env
    selected = refs(env.reviewer)
    assert len(selected) == 1 and selected[0]["kind"] == "proposals"
    set_id = selected[0]["id"]
    payload = env.reviewer.get(path(TARGET, f"annotation-versions/proposals/{set_id}"))
    assert payload.status_code == 200 and len(payload.json()["annotations"]) == 1
    assert payload.json()["evidence"]
    assert refs(env.alice, SOURCE) == []
    assert env.alice.get(path(TARGET, "annotation-versions")).status_code == 404
    assert env.alice.get(f"{BASE}/proposal-sets/{set_id}").status_code == 404
    assert (
        env.reviewer.get(
            path(SOURCE, f"annotation-versions/proposals/{set_id}")
        ).status_code
        == 404
    )
    assert len(refs(env.lead)) == len(refs(env.admin)) == 1


@pytest.mark.parametrize(
    "kind,ident",
    [
        ("unknown", "1"),
        ("own", "missing"),
        ("proposals", "not-a-number"),
        ("proposals", "999999"),
        ("stage_result", "1"),
    ],
)
def test_forged_kind_or_id_is_version_not_found(case_env, kind, ident):
    response = case_env.lead.get(path(TARGET, f"annotation-versions/{kind}/{ident}"))
    assert (
        response.status_code == 404 and response.json()["code"] == "VERSION_NOT_FOUND"
    )


def test_assignment_hint_cannot_grant_foreign_or_sibling_proposals(case_env):
    env = case_env
    service = AssignmentService(env.db)
    row = service.list("proj", user="reviewer")[0]
    assert (
        env.alice.get(
            path(TARGET, "annotation-versions"), params={"assignment": row.id}
        ).status_code
        == 404
    )
    assert (
        env.reviewer.get(
            path(SOURCE, "annotation-versions"), params={"assignment": row.id}
        ).status_code
        == 404
    )
    assert refs(env.reviewer, assignment=row.id)
    service.revoke(HARNESS, row.id)
    assert (
        env.reviewer.get(
            path(TARGET, "annotation-versions"), params={"assignment": row.id}
        ).status_code
        == 404
    )


def test_payload_fetch_rechecks_current_authority_after_ref_listing(case_env):
    env = case_env
    offered = refs(env.reviewer)[0]
    AssignmentService(env.db).revoke(
        HARNESS, AssignmentService(env.db).list("proj", user="reviewer")[0].id
    )
    assert (
        env.reviewer.get(
            path(TARGET, f"annotation-versions/{offered['kind']}/{offered['id']}")
        ).status_code
        == 404
    )


def test_revoking_exact_assignment_removes_text_and_own_history(
    case_env,
):
    env = case_env
    service = AssignmentService(env.db)
    row = service.assign(
        HARNESS, "proj", TARGET, "alice", "annotate", confirm_language=True
    )
    seed_submission(env, "alice", "own-target", document=TARGET)
    assert refs(env.alice)[0]["id"] == "own-target"
    service.revoke(HARNESS, row.id)
    assert env.alice.get(path(TARGET, "text")).status_code == 404
    assert env.alice.get(path(TARGET, "annotation-versions")).status_code == 404
    response = env.alice.get(path(TARGET, "annotation-versions/own/own-target"))
    assert (
        response.status_code == 404 and response.json()["code"] == "VERSION_NOT_FOUND"
    )


def test_reanchor_label_uses_actual_predecessor_and_pending_carrier_is_typed(case_env):
    env = case_env
    pending = {
        "source_ref": {"annotation_id": "source-a", "version": "a" * 64},
        "term_id": "HP:0001250",
        "layer_id": "phenotype",
        "reason": "changed_cue",
        "old_mentions": [
            {
                "source_ref": {"evidence_id": "source-e", "version": "b" * 64},
                "segments": [{"start": 4, "end": 7, "text": "old"}],
                "cue_segments": [{"start": 0, "end": 2, "text": "no"}],
            }
        ],
        "old_context": {"start": 0, "end": 7, "text": "no  old"},
        "new_context": {"start": 0, "end": 7, "text": "yes old"},
        "diff": [
            {
                "op": "replace",
                "old_start": 0,
                "old_end": 2,
                "new_start": 0,
                "new_end": 3,
                "old_text": "no",
                "new_text": "yes",
            }
        ],
    }
    with env.db.transaction() as conn:
        pid = env.app.state.repo._require_project(conn, "proj")
        set_id = conn.execute(
            insert(ProposalSetRow)
            .values(
                project_id=pid,
                document_id=CORRECTED,
                annotation_set_id="fake-v999-set",
                set_kind="tool_output",
                actors=[
                    {
                        "actor_id": "tool",
                        "kind": "tool",
                        "name": "ontocurator-reanchor",
                        "version": "1",
                    }
                ],
                payload={},
                origin="reanchor",
                pending_items=[pending],
            )
            .returning(ProposalSetRow.id)
        ).scalar_one()
    offered = refs(env.lead, CORRECTED)
    assert offered[0]["label"] == "Carried over from version 1"
    metadata = env.lead.get(f"{BASE}/proposal-sets/{set_id}").json()
    assert metadata["origin"] == "reanchor" and metadata["source_version"] == 1
    response = env.lead.get(path(CORRECTED, "reanchor-items"))
    assert response.status_code == 200, response.text
    item = response.json()[0]
    assert (
        item["old_context"] == pending["old_context"]
        and item["diff"] == pending["diff"]
    )
    assert (
        item["old_segments"]
        == pending["old_mentions"][0]["segments"]
        + pending["old_mentions"][0]["cue_segments"]
    )
    assert env.alice.get(path(CORRECTED, "reanchor-items")).status_code == 404
    with env.db.transaction() as conn:
        conn.execute(
            insert(ProposalSetRow).values(
                project_id=pid,
                document_id=CORRECTED,
                annotation_set_id="malformed-pending",
                set_kind="tool_output",
                actors=[],
                payload={},
                origin="reanchor",
                pending_items=[
                    {
                        **pending,
                        "old_context": {"start": 3, "end": 6, "text": "wrong length"},
                    }
                ],
            )
        )
    assert env.lead.get(path(CORRECTED, "reanchor-items")).status_code == 404


def test_foreign_project_proposal_id_cannot_be_reused(case_env, tmp_path):
    from t1_builders import bundle, native_unit
    from t1_fixtures import create_project, run_import

    env = case_env
    offered = refs(env.admin)[0]
    create_project(env.db, "foreign")
    directory = tmp_path / "foreign"
    directory.mkdir()
    result = run_import(
        env.db,
        bundle(directory, [native_unit(TARGET, "en", "Foreign text")]),
        project="foreign",
    )
    assert result.status == "succeeded", result.error
    response = env.admin.get(
        path(TARGET, f"annotation-versions/proposals/{offered['id']}").replace(
            "/projects/proj/", "/projects/foreign/"
        )
    )
    assert (
        response.status_code == 404 and response.json()["code"] == "VERSION_NOT_FOUND"
    )


def test_internal_assisted_metadata_stays_exact_while_public_annotate_refs_are_blind(
    case_env,
):
    from ontocurator.authz.policy import Access
    from ontocurator.authz.scoped import ScopedRepository
    from ontocurator.domain.errors import DomainError

    env = case_env
    user = env.app.state.accounts.get_by_username("alice")
    scoped = ScopedRepository(
        env.db,
        Access(user.id, user.pseudonym, False, {"proj": frozenset({"annotator"})}),
    )
    assert scoped.proposal_metadata("proj", SOURCE)
    assert refs(env.alice, SOURCE) == []
    with pytest.raises(DomainError):
        scoped.proposal_metadata("proj", TARGET)


@pytest.mark.parametrize(
    "ident",
    [
        "own/annotation-versions/own/y/text",
        "own/annotation-versions/own/y/variant",
        "own /#é%2F/text",
    ],
)
def test_encoded_opaque_version_ids_keep_exact_identity(case_env, ident):
    env = case_env
    seed_submission(env, "alice", ident)
    url = path(SOURCE, f"annotation-versions/own/{quote(ident, safe='')}")
    response = env.alice.get(url)
    assert response.status_code == 200, response.text
    assert response.json()["ref"]["id"] == ident
    assert [row["id"] for row in refs(env.alice, SOURCE)] == [ident]
    assert env.lead.get(url).status_code == 404
    assert env.alice.get(url + "%2Fmissing").status_code == 404


def test_leads_see_every_submission_as_a_submission_ref_and_others_do_not(case_env):
    env = case_env
    seed_submission(env, "alice", "alice-1")
    lead_refs = refs(env.lead, SOURCE)
    assert any(r["kind"] == "submission" and r["id"] == "alice-1" for r in lead_refs)
    fetched = env.lead.get(path(SOURCE, "annotation-versions/submission/alice-1"))
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["ref"]["kind"] == "submission"
    for client in (env.alice, env.reviewer):
        assert not any(r["kind"] == "submission" for r in refs(client, SOURCE))
        assert (
            client.get(
                path(SOURCE, "annotation-versions/submission/alice-1")
            ).status_code
            == 404
        )
    # Non-lead history keeps its own path (review finding 8): the author opens an old
    # submission through the `own` ref, without broadened permissions.
    assert any(
        r["kind"] == "own" and r["id"] == "alice-1" for r in refs(env.alice, SOURCE)
    )
    assert (
        env.alice.get(path(SOURCE, "annotation-versions/own/alice-1")).status_code
        == 200
    )
    assert (
        env.reviewer.get(path(SOURCE, "annotation-versions/own/alice-1")).status_code
        == 404
    )
