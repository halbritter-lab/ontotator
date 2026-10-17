"""Review-scoped frozen pending inputs backed by the real producer and PostgreSQL."""

import pytest
from auth_harness import logged_in
from sqlalchemy import select, update
from test_reanchor_job import children, corrected, execute, generated
from test_reanchor_job import runtime as runtime

from ontocurator.domain.review import ReviewTargetSet
from ontocurator.storage.tables import DraftRow, ProposalSetRow


@pytest.fixture
def pending(runtime):
    corrected(runtime, "😀 Neue Befunde Ω")
    result = execute(runtime, children(runtime)[0])
    assert result.status == "succeeded", result.error
    runtime.output = generated(runtime)[0]
    runtime.reviewer = logged_in(
        runtime.app,
        "reviewer",
        projects={"proj": ["adjudicator"]},
        assignments=[("proj", runtime.output["document_id"], "review")],
    )
    return runtime


def opened(env, client=None, **extra):
    return (client or env.reviewer).post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "proj",
            "document_id": env.output["document_id"],
            "mode": "review",
            **extra,
        },
    )


def test_pending_inputs_frozen_on_first_review_open(pending):
    first = opened(pending)
    assert first.status_code == 200, first.text
    view = first.json()["view"]
    assert len(view["draft"]["reanchor_inputs"]) == 2
    assert len(view["pending_reanchor_items"]) == 2
    assert all(
        item["type_id"] == "phenotype" for item in view["pending_reanchor_items"]
    )
    assert view["draft"]["reanchor_inputs_initialized_at"]
    # A later producer set must not enter this already opened round.
    with pending.db.transaction() as conn:
        source = pending.output
        conn.execute(
            ProposalSetRow.__table__.insert().values(
                **{
                    k: v
                    for k, v in source.items()
                    if k not in {"id", "annotation_set_id"}
                },
                annotation_set_id="late-set",
            )
        )
    again = opened(pending).json()["view"]
    assert again["draft"] == view["draft"]
    assert again["pending_reanchor_items"] == view["pending_reanchor_items"]


def test_assignment_open_preserves_typed_pending_context(pending):
    task = pending.reviewer.get("/api/v1/me/tasks").json()[0]
    response = pending.reviewer.post(
        f"/api/v1/assignments/{task['assignment_id']}/open"
    )
    assert response.status_code == 200, response.text
    view = response.json()["view"]
    assert len(view["draft"]["reanchor_inputs"]) == 2
    assert view["pending_reanchor_items"][0]["old_segments"]
    assert view["pending_reanchor_items"][0]["type_id"] == "phenotype"


def test_explicit_empty_pending_selection_and_conflict(pending):
    targets = ReviewTargetSet.create([]).model_dump()
    missing = opened(pending, targets=targets)
    assert missing.status_code == 422
    first = opened(pending, targets=targets, pending_proposal_set_ids=[])
    assert first.status_code == 200, first.text
    assert first.json()["view"]["draft"]["reanchor_inputs"] == []
    conflict = opened(
        pending, targets=targets, pending_proposal_set_ids=[pending.output["id"]]
    )
    assert conflict.status_code == 422, conflict.text
    assert conflict.json()["code"] == "REANCHOR_INPUTS_CONFLICT"


def test_explicit_pending_selection_validates_set_document_and_origin(pending):
    targets = ReviewTargetSet.create([]).model_dump()
    foreign = opened(
        pending, targets=targets, pending_proposal_set_ids=[pending.output["id"] - 1]
    )
    assert foreign.status_code == 422, foreign.text
    assert foreign.json()["code"] == "INVALID_REANCHOR_ITEM"
    selected = opened(
        pending, targets=targets, pending_proposal_set_ids=[pending.output["id"]]
    )
    assert selected.status_code == 200, selected.text
    assert len(selected.json()["view"]["draft"]["reanchor_inputs"]) == 2


def test_legacy_first_open_initializes_once_under_lock(pending):
    first = opened(pending).json()["view"]
    with pending.db.transaction() as conn:
        conn.execute(
            update(DraftRow).values(
                reanchor_inputs=[], reanchor_inputs_initialized_at=None
            )
        )
    initialized = opened(pending).json()["view"]
    assert initialized["draft"]["reanchor_inputs"] == first["draft"]["reanchor_inputs"]
    assert initialized["draft"]["reanchor_inputs_initialized_at"]
    with pending.db.transaction() as conn:
        assert (
            conn.execute(
                select(ProposalSetRow.pending_items).where(
                    ProposalSetRow.id == pending.output["id"]
                )
            ).scalar_one()
            == pending.output["pending_items"]
        )


def test_independent_workspace_receives_no_pending_inputs(pending):
    person = logged_in(
        pending.app,
        "annotator",
        projects={"proj": ["annotator"]},
        assignments=[("proj", pending.output["document_id"], "annotate")],
    )
    response = opened(pending, person, mode="independent")
    assert response.status_code == 200, response.text
    assert response.json()["view"]["draft"]["reanchor_inputs"] == []
    assert response.json()["view"]["pending_reanchor_items"] == []


def test_upgrade_preserves_pending_producer_payloads(pending):
    from alembic import command
    from pg_harness import owner_engine
    from sqlalchemy import text

    from ontocurator.storage.schema import alembic_config, upgrade

    opened(pending)
    engine = owner_engine(pending.db)
    with engine.begin() as conn:
        before = conn.execute(
            text(
                "SELECT id, payload::text, pending_items::text FROM ontocurator.proposal_sets ORDER BY id"
            )
        ).all()
        snapshots = conn.execute(
            text(
                "SELECT annotation_id, version, payload::text FROM ontocurator.annotation_snapshots ORDER BY annotation_id, version"
            )
        ).all()
        command.downgrade(alembic_config(conn), "0007")
    upgrade(engine.url, "0008")
    with engine.begin() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT id, payload::text, pending_items::text FROM ontocurator.proposal_sets ORDER BY id"
                )
            ).all()
            == before
        )
        assert (
            conn.execute(
                text(
                    "SELECT annotation_id, version, payload::text FROM ontocurator.annotation_snapshots ORDER BY annotation_id, version"
                )
            ).all()
            == snapshots
        )
        assert conn.execute(
            text(
                "SELECT reanchor_inputs, reanchor_resolutions, reanchor_inputs_initialized_at FROM ontocurator.drafts"
            )
        ).one() == ([], [], None)
    assert len(opened(pending).json()["view"]["draft"]["reanchor_inputs"]) == 2
