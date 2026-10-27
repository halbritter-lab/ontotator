"""Distribution HTTP/confirmation contracts; PostgreSQL awaits coordinator token."""

from dataclasses import replace

import pytest
from test_distribution_context import stored as stored

from ontotator.assignments.confirmations import (
    ConfirmationRow,
    DistributionConfirmationService,
    validate_confirmation_rows,
)
from ontotator.assignments.proposals import DistributionContext
from ontotator.auth.audit import Actor
from ontotator.domain.errors import DomainError


def _per_text(db, project, limit):
    """Room for several annotators on one text (the limit holds since P3)."""
    from sqlalchemy import update

    from ontotator.storage.tables import ProjectRow

    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == project)
            .values(annotations_per_text=limit)
        )


def test_distribution_snapshot_is_json_native_without_changing_canonical_hash():
    import hashlib
    import json
    from copy import deepcopy
    from dataclasses import asdict

    from ontotator.assignments.proposals import (
        DistributionSnapshot,
        SnapshotDocument,
        SnapshotMember,
    )
    from ontotator.domain.variants import VariantInfo

    variant = VariantInfo(
        "target",
        "case",
        "external",
        "de",
        1,
        "machine_translation",
        "source",
        {
            "provider": "Übersetzer",
            "checks": [{"code": "units_added", "passed": False}],
        },
        "ready_for_review",
        None,
        "a" * 64,
    )
    snapshot = DistributionSnapshot(
        "p",
        False,
        (
            SnapshotDocument(
                "target", 1, "de", "a" * 64, (3, 1, 3), variant, ("de", "en")
            ),
        ),
        (
            SnapshotMember(
                1, "reader", "Reader", "R", True, False, ("annotator",), ("en", "de"), 0
            ),
        ),
        variants=(variant,),
    )
    original = deepcopy(snapshot)
    serialized = snapshot.as_dict()
    persisted = json.loads(json.dumps(serialized, ensure_ascii=False))
    # Reconstruct the previous canonical hash inputs independently of as_dict:
    # only these existing unordered member/exclusion fields were normalized.
    legacy_inputs = asdict(snapshot)
    legacy_inputs["documents"][0]["excluded_user_ids"] = [1, 3]
    legacy_inputs["members"][0]["roles"] = ["annotator"]
    legacy_inputs["members"][0]["languages"] = ["de", "en"]
    legacy_bytes = json.dumps(
        legacy_inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    # PostgreSQL JSON audit inputs must compare exactly with the advertised
    # representation, including complete lineage and nested language inputs.
    assert serialized == persisted
    assert serialized["documents"][0]["required_languages"] == ["de", "en"]
    assert serialized["documents"][0]["excluded_user_ids"] == [1, 3]
    assert serialized["variants"][0]["translation"] == variant.translation
    assert (
        json.dumps(
            serialized, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        == legacy_bytes
    )
    assert snapshot.state_sha256 == hashlib.sha256(legacy_bytes).hexdigest()
    assert snapshot == original


@pytest.fixture
def api(tmp_path):
    from pathlib import Path

    from auth_harness import HARNESS, ensure_user, grant, logged_in
    from layered_fixtures import make_layered_package
    from pg_harness import database_url_for

    from ontotator.api.app import create_app
    from ontotator.config import AppConfig

    app = create_app(
        AppConfig(
            workspace_dir=tmp_path,
            database_url=database_url_for(tmp_path / "distribution-api.db"),
            ontology_paths=[Path(__file__).parent / "fixtures/hp.json"],
        )
    )
    app.state.repo.import_package(make_layered_package("single"))
    project = "pkg-scenario-a"
    for name in ["alice", "bob"]:
        ensure_user(app, name)
        grant(app, name, project, ["annotator"])
        app.state.accounts.set_languages(HARNESS, name, ["de"])
    client = logged_in(app, "lead", projects={project: ["lead"]}, assignments=[])
    return app, client, project


def test_http_proposal_writes_nothing_and_confirmation_audit_reproduces_input(api):
    from dataclasses import asdict

    from sqlalchemy import func, select

    from ontotator.assignments.proposals import (
        DistributionSnapshot,
        SnapshotDocument,
        SnapshotMember,
        build_proposal,
    )
    from ontotator.domain.variants import VariantInfo
    from ontotator.storage.tables import AssignmentRow, AuditEventRow

    app, client, project = api
    url = f"/api/v1/projects/{project}/assignments"
    with app.state.repo.db.transaction() as conn:
        before = conn.execute(
            select(func.count()).select_from(AuditEventRow)
        ).scalar_one()
    response = client.post(
        url + "/proposal",
        json={"document_ids": ["doc-alpha", "doc-beta"], "task": "annotate", "seed": 7},
    )
    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal["context"]["document_ids"] == ["doc-beta", "doc-alpha"]
    assert proposal["seed"] == proposal["context"]["seed"] == 7
    assert [row["load_before"] for row in proposal["rows"]] == [0, 0]
    assert all(
        row["language"] == "de" and row["display_name"] in {"alice", "bob"}
        for row in proposal["rows"]
    )
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == before
        )
        assert (
            conn.execute(select(func.count()).select_from(AssignmentRow)).scalar_one()
            == 0
        )
    edited = [
        {"document_id": "doc-beta", "username": "alice"},
        {"document_id": "doc-alpha", "username": "alice"},
    ]
    confirmed = client.post(
        url,
        json={
            "rows": edited,
            "task": "annotate",
            "context": proposal["context"],
            "seed": 7,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert [row["username"] for row in confirmed.json()["created"]] == [
        "alice",
        "alice",
    ]
    assert confirmed.json()["refused"] == []
    with app.state.repo.db.transaction() as conn:
        details = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "assignment.distribute"
            )
        ).scalar_one()
    assert details["confirmed_rows"] == edited
    snapshot = details["input_snapshot"]
    original = DistributionSnapshot(
        snapshot["project_key"],
        snapshot["adjudicator_not_annotator"],
        tuple(
            SnapshotDocument(**{**doc, "variant": VariantInfo(**doc["variant"])})
            for doc in snapshot["documents"]
        ),
        tuple(SnapshotMember(**member) for member in snapshot["members"]),
        annotate_accepted_translations_only=snapshot[
            "annotate_accepted_translations_only"
        ],
        variants=tuple(VariantInfo(**variant) for variant in snapshot["variants"]),
    )
    reproduced = build_proposal(original, task="annotate", per_document=1, seed=7)
    assert [list(row) for row in reproduced.proposal.rows] == details[
        "original_proposal"
    ]["rows"]
    assert reproduced.context.state_sha256 == proposal["context"]["state_sha256"]
    usernames = {member.user_id: member.username for member in original.members}
    assert [
        {"document_id": doc, "username": usernames[user]}
        for doc, user in reproduced.proposal.rows
    ] != edited
    assert asdict(reproduced.context)["document_ids"] == ("doc-beta", "doc-alpha")


def test_http_unassignable_languages_and_generated_seed(api):
    from sqlalchemy import update

    from ontotator.storage.tables import DocumentRow

    app, client, project = api
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == "doc-alpha")
            .values(language="fr")
        )
    response = client.post(
        f"/api/v1/projects/{project}/assignments/proposal",
        json={"document_ids": ["doc-alpha"], "task": "annotate"},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["rows"] == []
    assert result["unassignable"] == [
        {
            "document_id": "doc-alpha",
            "language": "fr",
            "reason": "NO_READER",
            "eligible_count": 0,
        }
    ]
    assert result["context"]["seed"] == result["seed"]
    assert result["per_document"] == 1


def test_http_stale_is_409_and_manual_rows_keep_partial_refusals(api):
    from sqlalchemy import select, update

    from ontotator.storage.tables import AuditEventRow, DocumentRow

    app, client, project = api
    url = f"/api/v1/projects/{project}/assignments"
    proposal = client.post(
        url + "/proposal",
        json={"document_ids": ["doc-beta"], "task": "annotate", "seed": 7},
    ).json()
    with app.state.repo.db.transaction() as conn:
        conn.execute(
            update(DocumentRow)
            .where(DocumentRow.document_id == "doc-beta")
            .values(text_sha256="changed")
        )
    response = client.post(
        url,
        json={
            "rows": [{"document_id": "doc-beta", "username": "alice"}],
            "task": "annotate",
            "context": proposal["context"],
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "DISTRIBUTION_STALE"
    manual = client.post(
        url,
        json={
            "rows": [
                {"document_id": "doc-beta", "username": "alice"},
                {"document_id": "doc-alpha", "username": "missing"},
            ],
            "task": "annotate",
            "seed": 7,
        },
    )
    assert manual.status_code == 200, manual.text
    assert [row["username"] for row in manual.json()["created"]] == ["alice"]
    assert manual.json()["refused"][0]["code"] == "USER_NOT_FOUND"
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(AuditEventRow.id).where(
                    AuditEventRow.action == "assignment.distribute"
                )
            ).first()
            is None
        )


@pytest.mark.parametrize(
    "body",
    [
        {"document_ids": [], "task": "annotate"},
        {"document_ids": ["doc-beta", "doc-beta"], "task": "annotate"},
        {"document_ids": ["doc-beta"], "task": "unknown"},
        {"document_ids": ["doc-beta"], "task": "annotate", "per_document": 0},
        {"document_ids": ["doc-beta"], "task": "annotate", "seed": True},
    ],
)
def test_http_invalid_proposal_selection_is_422(api, body):
    _app, client, project = api
    response = client.post(
        f"/api/v1/projects/{project}/assignments/proposal", json=body
    )
    assert response.status_code == 422, response.text


def test_http_human_edited_language_refusal_and_explicit_override(api):
    from auth_harness import HARNESS
    from sqlalchemy import select

    from ontotator.storage.tables import AuditEventRow

    app, client, project = api
    app.state.accounts.set_languages(HARNESS, "alice", ["en"])
    _per_text(app.state.repo.db, project, 2)
    url = f"/api/v1/projects/{project}/assignments"
    original = client.post(
        url + "/proposal",
        json={
            "document_ids": ["doc-beta"],
            "task": "annotate",
            "per_document": 2,
            "seed": 7,
        },
    ).json()
    rows = [{"document_id": "doc-beta", "username": name} for name in ["alice", "bob"]]
    response = client.post(
        url, json={"rows": rows, "task": "annotate", "context": original["context"]}
    )
    assert response.status_code == 200, response.text
    assert [row["username"] for row in response.json()["created"]] == ["bob"]
    assert response.json()["refused"] == [
        {
            "document_id": "doc-beta",
            "username": "alice",
            "code": "LANGUAGE_CONFIRMATION_REQUIRED",
        }
    ]
    # A fresh preview is required after Bob's successful row changed the load.
    refreshed = client.post(
        url + "/proposal",
        json={"document_ids": ["doc-beta"], "task": "annotate", "seed": 8},
    ).json()
    override = client.post(
        url,
        json={
            "rows": [rows[0]],
            "task": "annotate",
            "context": refreshed["context"],
            "confirm_language": True,
        },
    )
    assert override.status_code == 200, override.text
    assert [row["username"] for row in override.json()["created"]] == ["alice"]
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(AuditEventRow.id).where(
                    AuditEventRow.action == "assignment.language_override"
                )
            ).first()
            is not None
        )


def test_http_queued_confirmation_rechecks_current_management_rights(api):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, get_ident

    from sqlalchemy import delete, event, func, select

    from ontotator.storage.repository import _lock_id
    from ontotator.storage.tables import (
        AssignmentRow,
        AuditEventRow,
        ProjectMembershipRow,
    )

    app, client, project = api
    url = f"/api/v1/projects/{project}/assignments"
    original = client.post(
        url + "/proposal",
        json={"document_ids": ["doc-beta"], "task": "annotate", "seed": 7},
    ).json()
    lead = app.state.accounts.get_by_username("lead")
    waiting, owner = Event(), get_ident()

    def at_lock(_conn, _cursor, statement, _parameters, _context, _many):
        if get_ident() != owner and "pg_advisory_xact_lock" in statement:
            waiting.set()

    event.listen(app.state.repo.db.engine, "before_cursor_execute", at_lock)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with app.state.repo.db.transaction() as conn:
                conn.execute(
                    select(func.pg_advisory_xact_lock(_lock_id("members", project)))
                )
                future = pool.submit(
                    client.post,
                    url,
                    json={
                        "rows": [{"document_id": "doc-beta", "username": "alice"}],
                        "task": "annotate",
                        "context": original["context"],
                    },
                )
                assert waiting.wait(10)
                conn.execute(
                    delete(ProjectMembershipRow).where(
                        ProjectMembershipRow.user_id == lead.id
                    )
                )
            response = future.result(timeout=15)
    finally:
        event.remove(app.state.repo.db.engine, "before_cursor_execute", at_lock)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "PROJECT_NOT_FOUND"
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AssignmentRow)).scalar_one()
            == 0
        )
        assert (
            conn.execute(
                select(AuditEventRow.id).where(
                    AuditEventRow.action == "assignment.distribute"
                )
            ).first()
            is None
        )


@pytest.mark.parametrize(
    "rows",
    [
        [ConfirmationRow("foreign", "alice")],
        [ConfirmationRow("d", "alice"), ConfirmationRow("d", " ALICE ")],
        [ConfirmationRow("d", "alice"), ConfirmationRow("d", "bob")],
    ],
)
def test_edited_rows_validate_selection_uniqueness_and_document_cap(rows):
    context = DistributionContext(("d",), "annotate", 1, 7, "sha")
    with pytest.raises(DomainError, match="DISTRIBUTION_ROWS_INVALID"):
        validate_confirmation_rows(rows, context)


def test_confirmation_mixed_rows_preserves_partial_success_and_original_audit(stored):
    from sqlalchemy import insert, select

    from ontotator.storage.tables import AuditEventRow, UserLanguageRow, UserRow

    db, proposals, _project, users = stored
    _per_text(db, "p", 2)
    with db.transaction() as conn:
        outsider = conn.execute(
            insert(UserRow)
            .values(username="outsider", display_name="Outside", pseudonym="ann-out")
            .returning(UserRow.id)
        ).scalar_one()
        conn.execute(insert(UserLanguageRow).values(user_id=outsider, language="en"))
    original = proposals.propose(
        Actor.cli(), "p", ["first", "second"], "annotate", per_document=3, seed=7
    )
    rows = [
        ConfirmationRow("first", "alice"),
        ConfirmationRow("first", "missing"),
        ConfirmationRow("first", "outsider"),
        ConfirmationRow("second", "bob"),
    ]
    outcome = DistributionConfirmationService(db).confirm(
        Actor.user(users["lead"], "lead"), "p", rows, original.context, task="annotate"
    )
    assert [row.username for row in outcome.created] == ["alice", "bob"]
    assert [(row.username, row.code) for row in outcome.refused] == [
        ("missing", "USER_NOT_FOUND"),
        ("outsider", "NOT_A_MEMBER"),
    ]
    with db.transaction() as conn:
        events = conn.execute(
            select(AuditEventRow.action, AuditEventRow.details).order_by(
                AuditEventRow.id
            )
        ).all()
    assert [action for action, _ in events] == [
        "assignment.create",
        "assignment.create",
        "assignment.distribute",
    ]
    details = events[-1].details
    assert details["input_snapshot"] == original.snapshot.as_dict()
    assert details["context"]["seed"] == 7
    assert details["original_proposal"]["rows"] == []
    assert len(details["original_proposal"]["unassignable"]) == 2
    assert details["confirmed_rows"] == [
        {"document_id": row.document_id, "username": row.username} for row in rows
    ]
    assert [row.get("code") for row in details["outcomes"]] == [
        None,
        "USER_NOT_FOUND",
        "NOT_A_MEMBER",
        None,
    ]


def test_final_distribution_audit_failure_rolls_back_assignments_and_create_audits(
    stored, monkeypatch
):
    from sqlalchemy import func, select

    from ontotator.storage.tables import AssignmentRow, AuditEventRow

    db, proposals, _project, _users = stored
    original = proposals.propose(Actor.cli(), "p", ["first"], "annotate", seed=7)

    def fail(*args, **kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr("ontotator.assignments.confirmations.record_audit", fail)
    with pytest.raises(RuntimeError, match="audit unavailable"):
        DistributionConfirmationService(db).confirm(
            Actor.cli(),
            "p",
            [ConfirmationRow("first", "alice")],
            original.context,
            task="annotate",
        )
    with db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AssignmentRow)).scalar_one()
            == 0
        )
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == 0
        )


def test_context_task_seed_and_forged_hash_refused_before_writes(stored):
    from sqlalchemy import func, select

    from ontotator.storage.tables import AssignmentRow, AuditEventRow

    db, proposals, _project, _users = stored
    original = proposals.propose(Actor.cli(), "p", ["first"], "annotate", seed=7)
    service = DistributionConfirmationService(db)
    rows = [ConfirmationRow("first", "alice")]
    for task, seed in [("translation_review", 7), ("annotate", 8)]:
        with pytest.raises(DomainError, match="DISTRIBUTION_CONTEXT_INVALID"):
            service.confirm(
                Actor.cli(), "p", rows, original.context, task=task, seed=seed
            )
    with pytest.raises(DomainError, match="DISTRIBUTION_STALE"):
        service.confirm(
            Actor.cli(),
            "p",
            rows,
            replace(original.context, state_sha256="0" * 64),
            task="annotate",
        )
    with db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(AssignmentRow)).scalar_one()
            == 0
        )
        assert (
            conn.execute(select(func.count()).select_from(AuditEventRow)).scalar_one()
            == 0
        )
