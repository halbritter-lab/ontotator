"""Annotations per text is enforced on every assign path (spec "Small fixes")."""

from __future__ import annotations

from typing import Any

import pytest
from proposal_check_support import BASE, assign, proposal_env, refused_code

from ontocurator.assignments.service import AssignmentService
from ontocurator.auth.audit import Actor
from ontocurator.domain.errors import DomainError


def _lead_actor(env: Any) -> Actor:
    lead = env.app.state.accounts.get_by_username("leader")
    return Actor(lead.id, "user:leader")


def _submit_and_revoke(env: Any, username: str) -> None:
    from work_plan_support import submit

    first = assign(env, env.c1, username)
    submit(env, first["id"], f"sub-{username}")
    response = env.lead.post(f"/api/v1/assignments/{first['id']}/revoke", json={})
    assert response.status_code == 200, response.text


def test_single_assign_refuses_above_the_limit(tmp_path):
    env = proposal_env(tmp_path, per_text=2)
    assign(env, env.c1, "anno")
    assign(env, env.c1, "anno2")
    assert refused_code(env, env.c1, "tom") == "ANNOTATIONS_PER_TEXT_REACHED"
    with pytest.raises(DomainError) as refused:
        AssignmentService(env.db).assign(
            _lead_actor(env), "proj", env.c1, "tom", "annotate", confirm_language=True
        )
    assert refused.value.code == "ANNOTATIONS_PER_TEXT_REACHED"
    assert refused.value.details == {"limit": 2, "assigned": 2}


def test_reassign_keeps_the_count(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    first = assign(env, env.c1, "anno")
    response = env.lead.post(
        f"/api/v1/assignments/{first['id']}/reassign",
        json={"username": "anno2", "confirm_language": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["annotation_mode"] == "proposals"


def test_removed_assignments_free_the_slot(tmp_path):
    env = proposal_env(tmp_path, per_text=1)
    first = assign(env, env.c1, "anno")
    removed = env.lead.post(f"/api/v1/assignments/{first['id']}/remove")
    assert removed.status_code == 200, removed.text
    assert assign(env, env.c1, "anno2")["annotation_mode"] == "proposals"


def test_revoked_submitted_work_still_counts(tmp_path):
    """Revoke (not remove) a submitted assignment with per_text=1: the next
    assign is refused."""
    env = proposal_env(tmp_path, per_text=1)
    _submit_and_revoke(env, "anno")
    assert refused_code(env, env.c1, "anno2") == "ANNOTATIONS_PER_TEXT_REACHED"


def test_distribution_confirmation_respects_the_limit(tmp_path):
    """A confirmed distribution with three people on c1 (per_text=2): the
    third row is refused with ANNOTATIONS_PER_TEXT_REACHED."""
    env = proposal_env(tmp_path, per_text=2)
    proposal = env.lead.post(
        f"{BASE}/assignments/proposal",
        json={
            "document_ids": [env.c1],
            "task": "annotate",
            "per_document": 3,
            "seed": 7,
        },
    )
    assert proposal.status_code == 200, proposal.text
    response = env.lead.post(
        f"{BASE}/assignments",
        json={
            "rows": [
                {"document_id": env.c1, "username": name}
                for name in ("anno", "anno2", "tom")
            ],
            "task": "annotate",
            "context": proposal.json()["context"],
            "seed": 7,
            "confirm_language": True,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["created"]) == 2
    assert [row["code"] for row in body["refused"]] == ["ANNOTATIONS_PER_TEXT_REACHED"]


def _batch(env: Any, path: str, **extra: Any) -> Any:
    return env.lead.post(
        f"{BASE}/assignments/{path}",
        json={
            "task": "annotate",
            "language": "en",
            "case_ids": ["c1", "c2"],
            "mode": "one",
            "usernames": ["anno2"],
            **extra,
        },
    )


def test_batch_counts_revoked_submitted_work_like_single_assign(tmp_path):
    """per_text=1: anno submits on c1, the lead revokes it. A batch annotate
    assign over c1 and c2 offers c1 no slot in its preview and saves c2 (no
    ANNOTATIONS_PER_TEXT_REACHED, so the batch is not rolled back)."""
    env = proposal_env(tmp_path, per_text=1)
    _submit_and_revoke(env, "anno")
    preview = _batch(env, "batch/preview")
    assert preview.status_code == 200, preview.text
    targets = {t["case_id"] for t in preview.json()["targets"]}
    assert targets == {"c2"}
    saved = _batch(
        env,
        "batch",
        confirm_language=True,
        expected_preview_digest=preview.json()["digest"],
    )
    assert saved.status_code == 200, saved.text
    assert [c["document_id"] for c in saved.json()["created"]] == [env.c2]
