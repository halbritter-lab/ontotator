"""Per-text annotation-mode override through the plan routes (spec 2026-10-23
§1 Q3, plan P4): lock, refusal without proposals, atomic save, Undo, bulk."""

from proposal_check_support import BASE, assign, client, proposal_env
from sqlalchemy import select
from work_plan_support import revision_of

from ontotator.storage.tables import AuditEventRow


def patch(env, mode, case="c1", user=None, **flags):
    who = env.lead if user is None else client(env, user)
    return who.patch(
        f"{BASE}/work-plans/{case}/en",
        json={"annotation_mode": mode, "expected_revision": revision_of(env, case)}
        | flags,
    )


def stored_mode(env, case="c1"):
    """The row's stored override, read through a no-op PATCH."""
    response = patch(env, None, case=case)
    assert response.status_code == 200, response.text
    return response.json()["flags"]["annotation_mode"]


def bulk_body(mode, **change):
    # c1-en and c2-en are source rows: the bulk key is "source".
    return {
        "rows": [
            {"case_id": "c1", "language": "en"},
            {"case_id": "c2", "language": "en"},
        ],
        "languages": {"source": {"annotation_mode": mode} | change},
    }


def test_override_scratch_then_assignment_is_scratch(tmp_path):
    env = proposal_env(tmp_path)
    before = revision_of(env, "c1")
    response = patch(env, "scratch")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["flags"]["annotation_mode"] == "scratch"
    assert body["revision"] == before + 1
    assert body["undo"]["rows"] == [
        {
            "case_id": "c1",
            "language": "en",
            "review": False,
            "annotate": True,
            "restored_revision": None,
            "decided": True,
            "annotation_mode": None,
        }
    ]
    assert assign(env, env.c1, "anno")["annotation_mode"] == "scratch"


def test_mode_change_is_audited_beside_the_flags(tmp_path):
    env = proposal_env(tmp_path)
    assert patch(env, "scratch").status_code == 200
    with env.db.transaction() as conn:
        details = conn.execute(
            select(AuditEventRow.details)
            .where(AuditEventRow.action == "work_plan.update")
            .order_by(AuditEventRow.id.desc())
            .limit(1)
        ).scalar_one()
    [row] = details["rows"]
    assert row["annotation_mode"] == {"old": None, "new": "scratch"}


def test_unchanged_mode_writes_nothing(tmp_path):
    env = proposal_env(tmp_path)
    before = revision_of(env, "c1")
    response = patch(env, "project")
    assert response.status_code == 200, response.text
    assert response.json()["undo"]["rows"] == []
    assert revision_of(env, "c1") == before


def test_project_returns_to_the_project_setting(tmp_path):
    env = proposal_env(tmp_path)
    patch(env, "scratch")
    assert patch(env, "project").json()["flags"]["annotation_mode"] is None
    assert assign(env, env.c1, "anno")["annotation_mode"] == "proposals"


def test_change_is_refused_while_locked(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    refused = patch(env, "scratch")
    assert refused.status_code == 422, refused.text
    assert refused.json()["code"] == "ANNOTATION_MODE_LOCKED"
    assert patch(env, "proposals").status_code == 200
    assert patch(env, "project").status_code == 200


def test_a_refused_mode_saves_no_flags(tmp_path):
    """Flags and mode are one PATCH, one transaction (atomic save)."""
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    before = revision_of(env, "c1")
    refused = patch(env, "scratch", review=True)
    assert refused.json()["code"] == "ANNOTATION_MODE_LOCKED"
    assert revision_of(env, "c1") == before


def test_proposals_refused_without_proposals(tmp_path):
    env = proposal_env(tmp_path)
    assert patch(env, "proposals", case="c2").json()["code"] == "NO_TOOL_PROPOSALS"
    assert patch(env, "scratch", case="c2").status_code == 200


def test_undo_restores_the_previous_mode(tmp_path):
    env = proposal_env(tmp_path)
    undo = patch(env, "scratch").json()["undo"]
    restored = env.lead.put(
        f"{BASE}/work-plans/rows",
        json={
            "rows": undo["rows"],
            "expected_revisions": undo["revisions"],
            "undo": True,
        },
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["undo"]["rows"][0]["annotation_mode"] == "scratch"
    assert assign(env, env.c1, "anno")["annotation_mode"] == "proposals"


def test_undo_skips_a_mode_the_lock_refuses(tmp_path):
    env = proposal_env(tmp_path)
    undo = patch(env, "scratch").json()["undo"]
    assign(env, env.c1, "anno")  # locks "scratch"
    row = undo["rows"][0] | {"annotation_mode": "proposals"}
    restored = env.lead.put(
        f"{BASE}/work-plans/rows",
        json={
            "rows": [row],
            "expected_revisions": {"c1": revision_of(env, "c1")},
            "undo": True,
        },
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["mode_locked"] == [{"case_id": "c1", "language": "en"}]
    assert stored_mode(env) == "scratch"


def test_bulk_preview_and_save_skip_locked_rows(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    body = bulk_body("scratch")
    preview = env.lead.post(f"{BASE}/work-plans/bulk/preview", json=body)
    assert preview.status_code == 200, preview.text
    [language] = preview.json()["languages"]
    assert language["mode_locked"] == 1
    assert language["mode_no_proposals"] == 0
    assert language["will_change"] == 1
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json=body | {"expected_revisions": preview.json()["revisions"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["mode_locked"] == [{"case_id": "c1", "language": "en"}]
    assert saved.json()["mode_no_proposals"] == []
    assert saved.json()["changed_rows"] == 1
    assert saved.json()["undo"]["rows"][0]["annotation_mode"] is None
    assert stored_mode(env, "c2") == "scratch"
    assert stored_mode(env) is None


def test_bulk_proposals_skips_texts_without_proposals(tmp_path):
    env = proposal_env(tmp_path, mode="scratch")
    body = bulk_body("proposals")
    preview = env.lead.post(f"{BASE}/work-plans/bulk/preview", json=body).json()
    assert preview["languages"][0]["mode_no_proposals"] == 1
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json=body | {"expected_revisions": preview["revisions"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["mode_no_proposals"] == [{"case_id": "c2", "language": "en"}]
    assert assign(env, env.c1, "anno")["annotation_mode"] == "proposals"


def test_bulk_saves_the_flags_of_a_row_whose_mode_is_refused(tmp_path):
    env = proposal_env(tmp_path)
    assign(env, env.c1, "anno")
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk", json=bulk_body("scratch", annotate="off")
    )
    assert saved.status_code == 409, saved.text  # withdraws anno's task
    saved = env.lead.put(
        f"{BASE}/work-plans/bulk",
        json=bulk_body("scratch", annotate="off") | {"confirm": True},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["changed_rows"] == 2
    # The lock is judged on the state before the save (anno still assigned).
    assert saved.json()["mode_locked"] == [{"case_id": "c1", "language": "en"}]
    assert stored_mode(env) is None
    assert stored_mode(env, "c2") == "scratch"


def test_override_is_lead_only(tmp_path):
    env = proposal_env(tmp_path)
    assert patch(env, "scratch", user="anno").status_code == 403
