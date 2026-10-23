"""Review-scoped frozen pending inputs backed by the real producer and PostgreSQL."""

import pytest
from auth_harness import logged_in
from sqlalchemy import select, update
from test_reanchor_job import children, corrected, execute, generated
from test_reanchor_job import runtime as runtime

from ontocurator.domain.review import ReviewTargetSet
from ontocurator.storage.tables import AssignmentRow, DraftRow, ProposalSetRow


@pytest.fixture
def pending(runtime):
    corrected(runtime, "😀 Neue Befunde Ω")
    result = execute(runtime, children(runtime)[0])
    assert result.status == "succeeded", result.error
    runtime.output = generated(runtime)[0]
    runtime.reviewer = logged_in(
        runtime.app,
        "reviewer",
        projects={"proj": ["annotator"]},
        assignments=[("proj", runtime.output["document_id"], "annotate")],
    )
    from_proposals(runtime.db)
    return runtime


def from_proposals(db):
    """Annotate assignments start from proposals (P3 sets this when assigning)."""
    with db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.task == "annotate")
            .values(annotation_mode="proposals")
        )


def from_scratch(db):
    """Annotate assignments start from scratch: a further annotator then gets a
    scratch assignment (the text's newest set holds only pending items, so a
    text locked "from proposals" refuses NO_PROPOSALS_ON_VERSION, P3)."""
    with db.transaction() as conn:
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.task == "annotate")
            .values(annotation_mode="scratch")
        )


def opened(env, client=None, **extra):
    return (client or env.reviewer).post(
        "/api/v1/workspaces/open",
        json={
            "project_key": "proj",
            "document_id": env.output["document_id"],
            "mode": "proposal_check",
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
    from_scratch(pending.db)
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


def test_upgrade_preserves_pending_producer_payloads(pending, tmp_path):
    from pg_harness import unmigrated_database_url
    from sqlalchemy import MetaData, Table, create_engine, insert, text

    from ontocurator.storage.schema import upgrade
    from ontocurator.storage.tables import AnnotationSnapshotRow, DocumentRow

    assert len(opened(pending).json()["view"]["draft"]["reanchor_inputs"]) == 2
    # Seed a genuine old schema with real producer output. The current head has
    # forward-only migrations and must not be downgraded to manufacture it.
    proposal_query = text(
        "SELECT annotation_set_id, payload::text, pending_items::text FROM ontocurator.proposal_sets ORDER BY annotation_set_id"
    )
    snapshot_query = text(
        "SELECT annotation_id, version, payload::text FROM ontocurator.annotation_snapshots ORDER BY annotation_id, version"
    )
    with pending.db.transaction() as conn:
        before = conn.execute(proposal_query).all()
        snapshots = conn.execute(snapshot_query).all()
        documents = [dict(row) for row in conn.execute(select(DocumentRow)).mappings()]
        records = {
            table.__tablename__: [
                dict(row) for row in conn.execute(select(table)).mappings()
            ]
            for table in (ProposalSetRow, AnnotationSnapshotRow, DraftRow)
        }
    url = unmigrated_database_url(tmp_path / "reanchor-before-0008.db")
    upgrade(url, "0007")
    engine = create_engine(url)
    try:
        metadata = MetaData(schema="ontocurator")
        tables = {
            name: Table(name, metadata, autoload_with=engine)
            for name in ("projects", "documents", *records)
        }
        with engine.begin() as conn:
            pid = conn.execute(
                insert(tables["projects"])
                .values(
                    project_key="migration",
                    name="migration",
                    manifest={},
                    manifest_sha256="m",
                    task_profile={},
                    task_profile_sha256="p",
                )
                .returning(tables["projects"].c.id)
            ).scalar_one()

            def copy_row(name, row):
                table = tables[name]
                values = {
                    column.name: row[column.name]
                    for column in table.c
                    if column.name in row and column.name != "id"
                }
                values["project_id"] = pid
                for optional in (
                    "created_by",
                    "updated_by",
                    "imported_by",
                    "job_id",
                    "source_sha256",
                ):
                    if optional in values:
                        values[optional] = None
                conn.execute(insert(table).values(**values))

            copied = set()
            while documents:
                ready = [
                    row
                    for row in documents
                    if row["derived_from"] is None or row["derived_from"] in copied
                ]
                assert ready, "Producer documents must have complete acyclic ancestry"
                for row in ready:
                    copy_row("documents", row)
                    copied.add(row["document_id"])
                    documents.remove(row)
            for name, rows in records.items():
                for row in rows:
                    copy_row(name, row)
            assert conn.execute(proposal_query).all() == before
            assert conn.execute(snapshot_query).all() == snapshots
        upgrade(url, "0008")
        with engine.connect() as conn:
            assert conn.execute(proposal_query).all() == before
            assert conn.execute(snapshot_query).all() == snapshots
            assert conn.execute(
                text(
                    "SELECT reanchor_inputs, reanchor_resolutions, reanchor_inputs_initialized_at FROM ontocurator.drafts"
                )
            ).one() == ([], [], None)
        upgrade(url)
        with engine.connect() as conn:
            assert conn.execute(proposal_query).all() == before
            assert conn.execute(snapshot_query).all() == snapshots
    finally:
        engine.dispose()
