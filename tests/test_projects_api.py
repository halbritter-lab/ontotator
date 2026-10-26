"""Project administration through real authenticated sessions."""

import hashlib
from pathlib import Path

import pytest
from auth_harness import ensure_assignment, logged_in
from sqlalchemy import insert, select
from test_auth_api import _app

from ontocurator.auth.audit import Actor
from ontocurator.storage.tables import (
    AssignmentRow,
    AuditEventRow,
    DocumentRow,
    ProjectRow,
)

HP = Path(__file__).parent / "fixtures" / "hp.json"


@pytest.fixture
def app(tmp_path):
    return _app(tmp_path)


def create_project(app, admin, key="phenotypes"):
    stored = app.state.ontology_store.add(Actor.cli(), "hp.json", HP.read_bytes())
    response = admin.post(
        "/api/v1/projects/",
        json={
            "key": key,
            "name": "Phenotypes",
            "description": "Clinical work",
            "languages": ["DE", "en"],
            "template": "hpo-phenotype",
            "pins": [
                {
                    "ontology_id": "HP",
                    "sha256": stored.sha256,
                    "t1_profile": "hpo-phenotype",
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_an_admin_creates_a_project_from_the_template(app):
    admin = logged_in(app, "root", system_admin=True)
    result = create_project(app, admin)
    assert result["profile"]["layers"][0]["ontology_id"] == "HP"
    assert result["pins"][0]["release"] == result["profile"]["ontologies"][0]["release"]
    assert result["languages"] == ["de", "en"]
    assert result["axis_defaults"]["hpo-layer"]["assertion"] == "present"
    assert result["locked"] is False
    assert result["require_chosen_axes"] is False
    assert admin.get("/api/v1/projects/templates").json()[0][
        "required_ontology_ids"
    ] == ["HP"]
    assert admin.get("/api/v1/projects").json()[0]["can_manage"] is True
    with app.state.repo.db.transaction() as conn:
        assert conn.execute(
            select(AuditEventRow.id).where(AuditEventRow.action == "project.create")
        ).first()


def test_a_lead_edits_settings_but_not_another_project(app):
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    create_project(app, admin, "other")
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})
    changed = lead.patch(
        "/api/v1/projects/phenotypes/settings", json={"name": "Updated"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["name"] == "Updated"
    # The URL/version fields are gone; versioned guidelines replace them.
    assert (
        lead.patch(
            "/api/v1/projects/phenotypes/settings",
            json={"guideline_url": "https://example.org/g"},
        ).status_code
        == 422
    )
    assert (
        lead.patch("/api/v1/projects/other/settings", json={"name": "No"}).status_code
        == 404
    )


@pytest.mark.parametrize(
    "hidden",
    [
        {"no-layer": {}},
        {"hpo-layer": {"assertion": ["wrong"]}},
        {"hpo-layer": {"assertion": ["present"]}},
    ],
)
def test_hidden_values_must_exist_and_not_be_the_default(app, hidden):
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    result = admin.patch(
        "/api/v1/projects/phenotypes/settings", json={"hidden_axis_values": hidden}
    )
    assert result.status_code == 422
    assert result.json()["code"] == "SETTINGS_INVALID"


def test_a_lead_manages_members_but_not_the_last_lead(app):
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})
    # Remove the creator's lead role as an administrator, retaining their other roles.
    assert (
        admin.put(
            "/api/v1/projects/phenotypes/members/root", json={"roles": ["annotator"]}
        ).status_code
        == 200
    )
    result = lead.put("/api/v1/projects/phenotypes/members/lead", json={"roles": []})
    assert result.status_code == 409, result.text
    assert result.json()["code"] == "LAST_LEAD"
    admin = logged_in(app, "root", system_admin=True)
    assert (
        admin.put(
            "/api/v1/projects/phenotypes/members/lead", json={"roles": []}
        ).status_code
        == 200
    )


def test_removing_a_member_with_open_work_needs_confirmation(app):
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    logged_in(app, "alice", projects={"phenotypes": ["annotator", "lead"]})
    user = app.state.accounts.get_by_username("alice")
    with app.state.repo.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "phenotypes")
        ).scalar_one()
        conn.execute(
            insert(DocumentRow).values(
                project_id=pid,
                document_id="d1",
                case_id="d1",
                external_id="d1",
                text="Test",
                text_sha256=hashlib.sha256(b"Test").hexdigest(),
                language="en",
            )
        )
        aid = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=pid,
                document_id="d1",
                user_id=user.id,
                task="annotate",
                status="reopened",
                annotation_mode="scratch",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    path = "/api/v1/projects/phenotypes/members/alice"
    # Losing an unrelated role preserves the active annotation task.
    assert admin.put(path, json={"roles": ["annotator"]}).status_code == 200
    response = admin.put(path, json={"roles": []})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "MEMBER_HAS_ASSIGNMENTS"
    assert response.json()["details"]["assignments"][0]["id"] == aid
    response = admin.put(path, json={"roles": [], "revoke_assignments": True})
    assert response.status_code == 200, response.text
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(AssignmentRow.revoked_at).where(AssignmentRow.id == aid)
            ).scalar_one()
            is not None
        )
        assert conn.execute(
            select(AuditEventRow.id).where(AuditEventRow.action == "assignment.revoke")
        ).first()


def test_pins_lock_after_the_first_submission(tmp_path):
    from pg_harness import database_for
    from t1_fixtures import OPERATOR, bundle, run_import, unit
    from t1_fixtures import create_project as seed
    from test_t1_export import _submit

    from ontocurator.domain.errors import DomainError
    from ontocurator.ontology.registry import OntologyRegistry
    from ontocurator.ontology.store import OntologyStore
    from ontocurator.projects.service import ProjectService

    db = database_for(tmp_path / "project.db", data_dir=tmp_path)
    seed(db)
    assert (
        run_import(db, bundle(tmp_path / "in.zip", [unit("EN100017")])).status
        == "succeeded"
    )
    service = ProjectService(db, OntologyStore(db, OntologyRegistry(), tmp_path))
    _submit(db, "alice", "independent", [], submission_id="s1")
    assert service.settings("proj").locked
    with pytest.raises(DomainError, match="PROJECT_IN_USE"):
        service.update_pins(OPERATOR, "proj", {})
    with pytest.raises(DomainError, match="PROJECT_IN_USE"):
        service.update_profile(OPERATOR, "proj", service.settings("proj").profile)


def test_a_prepared_edit_cannot_commit_after_profile_change(tmp_path, monkeypatch):
    from sqlalchemy import update
    from test_editing import _setup_test_env

    from ontocurator.domain.errors import RevisionConflict
    from ontocurator.domain.profiles import profile_hash
    from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey
    from ontocurator.storage.tables import DraftRow

    repo, _ontology, _workspace_service, editor, document = _setup_test_env(tmp_path)
    key = WorkspaceKey(
        project_key="pkg-1",
        document_id=document.document_id,
        annotator_id="alice",
        mode="independent",
        target_set_id="",
    )
    profile = repo.get_task_profile(key.project_key)
    real = repo.run_mutation

    def change_before_lock(*args, **kwargs):
        changed = profile.model_copy(update={"version": "2.0"})
        with repo.db.transaction() as conn:
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.project_key == key.project_key)
                .values(
                    task_profile=changed.model_dump(mode="json"),
                    task_profile_sha256=profile_hash(changed),
                )
            )
        return real(*args, **kwargs)

    monkeypatch.setattr(repo, "run_mutation", change_before_lock)
    with pytest.raises(RevisionConflict):
        editor.apply(
            key,
            MutationEnvelope(
                mutation_id="stale",
                expected_revision=0,
                payload={
                    "command": "check_layer",
                    "layer_id": profile.default_layer_id,
                    "checked": True,
                },
            ),
        )
    with repo.db.transaction() as conn:
        assert conn.execute(select(DraftRow.id)).first() is None


def test_two_concurrent_lead_removals_leave_one_lead(app):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from ontocurator.domain.errors import DomainError

    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    logged_in(app, "lead-a", projects={"phenotypes": ["lead"]})
    logged_in(app, "lead-b", projects={"phenotypes": ["lead"]})
    root = app.state.accounts.get_by_username("root")
    app.state.memberships.set_roles(
        Actor.user(root.id, root.username), "phenotypes", "root", []
    )
    barrier = Barrier(2)

    def remove(username):
        user = app.state.accounts.get_by_username(username)
        barrier.wait(timeout=10)
        try:
            app.state.memberships.set_roles(
                Actor.user(user.id, username), "phenotypes", username, []
            )
            return "removed"
        except DomainError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(remove, ["lead-a", "lead-b"]))
    assert sorted(results) == ["LAST_LEAD", "removed"]
    assert (
        sum(
            "lead" in roles
            for _, _, roles in app.state.memberships.members("phenotypes")
        )
        == 1
    )


def test_membership_revocation_failure_rolls_back_work_roles_audit_and_sessions(
    app, monkeypatch
):
    from ontocurator.projects import assignments
    from ontocurator.storage.tables import ProjectMembershipRow

    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    alice = logged_in(
        app, "alice", projects={"phenotypes": ["annotator"]}, assignments=[]
    )
    user = app.state.accounts.get_by_username("alice")
    with app.state.repo.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "phenotypes")
        ).scalar_one()
        conn.execute(
            insert(DocumentRow).values(
                project_id=pid,
                document_id="d1",
                case_id="d1",
                external_id="d1",
                text="Test",
                text_sha256=hashlib.sha256(b"Test").hexdigest(),
                language="en",
            )
        )
        aid = conn.execute(
            insert(AssignmentRow)
            .values(
                project_id=pid,
                document_id="d1",
                user_id=user.id,
                task="annotate",
                annotation_mode="scratch",
            )
            .returning(AssignmentRow.id)
        ).scalar_one()
    real = assignments.record_audit

    def fail_after_audit(*args, **kwargs):
        real(*args, **kwargs)
        raise RuntimeError("after assignment revocation and audit write")

    monkeypatch.setattr(assignments, "record_audit", fail_after_audit)
    root = app.state.accounts.get_by_username("root")
    with pytest.raises(RuntimeError, match="after assignment"):
        app.state.memberships.set_roles(
            Actor.user(root.id, root.username),
            "phenotypes",
            "alice",
            [],
            revoke_assignments=True,
        )
    with app.state.repo.db.transaction() as conn:
        assert (
            conn.execute(
                select(AssignmentRow.revoked_at).where(AssignmentRow.id == aid)
            ).scalar_one()
            is None
        )
        assert (
            conn.execute(
                select(ProjectMembershipRow.role).where(
                    ProjectMembershipRow.user_id == user.id
                )
            ).scalar_one()
            == "annotator"
        )
        assert not conn.execute(
            select(AuditEventRow.id).where(AuditEventRow.action == "assignment.revoke")
        ).first()
    assert alice.get("/api/v1/auth/me").status_code == 200


def test_independent_draft_commands_remain_concurrent(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from test_editing import _setup_test_env

    from ontocurator.domain.workspace import MutationEnvelope, WorkspaceKey

    repo, _, _, _, document = _setup_test_env(tmp_path)
    inside = Barrier(2)

    def edit(username):
        key = WorkspaceKey(
            project_key="pkg-1",
            document_id=document.document_id,
            annotator_id=username,
            mode="independent",
            target_set_id="",
        )

        def operation(draft):
            inside.wait(timeout=10)
            return draft

        return repo.run_mutation(
            key,
            MutationEnvelope(
                mutation_id=username,
                expected_revision=0,
                payload={"command": "check_layer"},
            ),
            operation,
        ).revision

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(edit, ["alice", "bob"])) == [1, 1]


def test_pin_update_waits_for_first_submission_then_refuses(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from pg_harness import database_for
    from t1_fixtures import OPERATOR, bundle, run_import, unit
    from t1_fixtures import create_project as seed
    from test_t1_export import _submit

    from ontocurator.domain.errors import DomainError
    from ontocurator.ontology.registry import OntologyRegistry
    from ontocurator.ontology.store import OntologyStore
    from ontocurator.projects.service import ProjectService

    db = database_for(tmp_path / "project.db", data_dir=tmp_path)
    seed(db)
    assert (
        run_import(db, bundle(tmp_path / "in.zip", [unit("EN100017")])).status
        == "succeeded"
    )
    service = ProjectService(db, OntologyStore(db, OntologyRegistry(), tmp_path))
    held, release, updating = Event(), Event(), Event()

    def submit():
        with db.transaction():
            _submit(db, "alice", "independent", [], submission_id="s1")
            held.set()
            assert release.wait(10)

    def update():
        assert held.wait(10)
        updating.set()
        try:
            service.update_profile(OPERATOR, "proj", service.settings("proj").profile)
            return "updated"
        except DomainError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        submitted = pool.submit(submit)
        changed = pool.submit(update)
        assert updating.wait(10)
        release.set()
        submitted.result(timeout=15)
        assert changed.result(timeout=15) == "PROJECT_IN_USE"


@pytest.mark.parametrize("replay", [False, True])
@pytest.mark.parametrize("stage", ["service", "capture"])
def test_authenticated_edit_rejects_stale_prepared_profile(
    app, monkeypatch, replay, stage
):
    from ontocurator.application.editing import EditorService
    from ontocurator.domain.profiles import TaskProfile
    from ontocurator.ontology.registry import OntologyRegistry
    from ontocurator.projects.service import ProjectService
    from ontocurator.storage.tables import DraftRow

    admin = logged_in(app, "root", system_admin=True)
    project = create_project(app, admin)
    with app.state.repo.db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "phenotypes")
        ).scalar_one()
        conn.execute(
            insert(DocumentRow).values(
                project_id=pid,
                document_id="d1",
                case_id="d1",
                external_id="d1",
                text="Test",
                text_sha256=hashlib.sha256(b"Test").hexdigest(),
                language="en",
            )
        )
    ensure_assignment(app, "root", "phenotypes", "d1", "annotate")
    opened = admin.post(
        "/api/v1/workspaces/open",
        json={"project_key": "phenotypes", "document_id": "d1", "mode": "independent"},
    )
    assert opened.status_code == 200, opened.text
    wsid = opened.json()["workspace_id"]
    payload = {
        "mutation_id": "stale-api",
        "expected_revision": 0,
        "payload": {
            "command": "create_annotation",
            "annotation_id": "a1",
            "note": "Document-level test finding",
            "term_id": "HP:0001250",
        },
    }
    if replay:
        initial = admin.post(f"/api/v1/workspaces/{wsid}/commands", json=payload)
        assert initial.status_code == 200, initial.text
    target = EditorService if stage == "service" else OntologyRegistry
    method = "_get_service_for_layer" if stage == "service" else "_for_definition"
    if stage == "capture":
        ProjectService(app.state.repo.db, app.state.ontology_store).update_profile(
            Actor.cli(), "phenotypes", TaskProfile.model_validate(project["profile"])
        )
    real = getattr(target, method)
    changed = False

    def change_during_preparation(self, *args):
        nonlocal changed
        service = real(self, *args)
        if not changed:
            changed = True
            profile = TaskProfile.model_validate(project["profile"]).model_copy(
                update={"version": "2.0"}
            )
            ProjectService(app.state.repo.db, app.state.ontology_store).update_profile(
                Actor.cli(), "phenotypes", profile
            )
        return service

    monkeypatch.setattr(target, method, change_during_preparation)
    response = admin.post(
        f"/api/v1/workspaces/{wsid}/commands",
        json={
            "mutation_id": "stale-api",
            "expected_revision": 0,
            "payload": {
                "command": "create_annotation",
                "annotation_id": "a1",
                "note": "Document-level test finding",
                "term_id": "HP:0001250",
            },
        },
    )
    assert response.status_code == (200 if replay else 409), response.text
    if replay:
        assert response.json() == initial.json()
    with app.state.repo.db.transaction() as conn:
        assert conn.execute(select(DraftRow.revision)).scalar_one() == (
            1 if replay else 0
        )


def test_import_prepared_before_a_profile_change_rolls_back(tmp_path, monkeypatch):
    from pg_harness import database_for
    from sqlalchemy import update
    from t1_fixtures import bundle, run_import, unit
    from t1_fixtures import create_project as seed

    from ontocurator.domain.profiles import TaskProfile, profile_hash
    from ontocurator.exchange import uploads

    db = database_for(tmp_path / "project.db", data_dir=tmp_path)
    seed(db)
    real = uploads.read_sources

    def change_during_parse(*args, **kwargs):
        delivery = real(*args, **kwargs)
        with db.transaction() as conn:
            row = conn.execute(
                select(ProjectRow.task_profile).where(ProjectRow.project_key == "proj")
            ).scalar_one()
            profile = TaskProfile.model_validate(row).model_copy(
                update={"version": "2.0"}
            )
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.project_key == "proj")
                .values(
                    task_profile=profile.model_dump(mode="json"),
                    task_profile_sha256=profile_hash(profile),
                )
            )
        return delivery

    monkeypatch.setattr(uploads, "read_sources", change_during_parse)
    result = run_import(db, bundle(tmp_path / "stale.zip", [unit("EN100017")]))
    assert result.status == "failed"
    with db.transaction() as conn:
        assert conn.execute(select(DocumentRow.document_id)).first() is None


def test_reciprocal_membership_edits_do_not_deadlock_on_audit_foreign_keys(
    app, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from ontocurator.authz import memberships

    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin, "project-a")
    create_project(app, admin, "project-b")
    logged_in(
        app, "alice", projects={"project-a": ["lead"], "project-b": ["annotator"]}
    )
    logged_in(app, "bob", projects={"project-b": ["lead"], "project-a": ["annotator"]})
    alice = app.state.accounts.get_by_username("alice")
    bob = app.state.accounts.get_by_username("bob")
    barrier = Barrier(2)
    real = memberships.require_project_management

    def synchronized_authority(*args, **kwargs):
        # Reciprocal user pairs now acquire actor SHARE / target NO KEY UPDATE
        # in ID order. Rendezvous before those locks, since intersecting pairs
        # correctly serialize; forcing an audit rendezvous would require both
        # incompatible user-lock sets to be held at once.
        barrier.wait(timeout=10)
        return real(*args, **kwargs)

    monkeypatch.setattr(
        memberships, "require_project_management", synchronized_authority
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(
            app.state.memberships.set_roles,
            Actor.user(alice.id, "alice"),
            "project-a",
            "bob",
            [],
        )
        second = pool.submit(
            app.state.memberships.set_roles,
            Actor.user(bob.id, "bob"),
            "project-b",
            "alice",
            [],
        )
        assert first.result(timeout=15) == second.result(timeout=15) == frozenset()


def test_pins_can_upgrade_before_work_and_rebind_actual_release(app):
    import json

    from ontocurator.domain.profiles import TaskProfile

    admin = logged_in(app, "root", system_admin=True)
    project = create_project(app, admin)
    data = json.loads(HP.read_text(encoding="utf-8"))
    # A different valid serialization changes the file identity without changing the ontology.
    stored = app.state.ontology_store.add(
        Actor.cli(), "hp-new.json", json.dumps(data, indent=4).encode()
    )
    pins = project["pins"]
    for pin in pins:
        pin.pop("release")
        pin["sha256"] = stored.sha256
    result = admin.put("/api/v1/projects/phenotypes/pins", json=pins)
    assert result.status_code == 200, result.text
    rebound = TaskProfile.model_validate(result.json()["profile"])
    assert rebound.ontologies[0].sha256 == stored.sha256
    assert rebound.ontologies[0].release == stored.release
    assert result.json()["pins"][0]["sha256"] == stored.sha256


def test_spanless_setting_defaults_and_patch_retains_false_with_audit(app):
    admin = logged_in(app, "root", system_admin=True)
    assert create_project(app, admin)["allow_spanless_findings"] is True
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})
    annotator = logged_in(app, "annotator", projects={"phenotypes": ["annotator"]})
    endpoint = "/api/v1/projects/phenotypes/settings"
    assert (
        annotator.patch(endpoint, json={"allow_spanless_findings": False}).status_code
        == 403
    )
    changed = lead.patch(endpoint, json={"allow_spanless_findings": False})
    assert changed.status_code == 200, changed.text
    assert changed.json()["allow_spanless_findings"] is False
    assert (
        lead.patch(endpoint, json={"description": "updated"}).json()[
            "allow_spanless_findings"
        ]
        is False
    )
    assert (
        app.state.repo.get_project_rules("phenotypes").allow_spanless_findings is False
    )
    with app.state.repo.db.transaction() as conn:
        rows = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "project.update"
            )
        ).all()
    assert "allow_spanless_findings" in str(rows)


def test_optional_spanless_reason_setting_is_authorized_persisted_and_audited(app):
    admin = logged_in(app, "root", system_admin=True)
    assert create_project(app, admin)["require_spanless_note"] is True
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})
    annotator = logged_in(app, "annotator", projects={"phenotypes": ["annotator"]})
    adjudicator = logged_in(app, "reviewer", projects={"phenotypes": ["adjudicator"]})
    endpoint = "/api/v1/projects/phenotypes/settings"
    for client in (annotator, adjudicator):
        assert (
            client.patch(endpoint, json={"require_spanless_note": False}).status_code
            == 403
        )
    changed = lead.patch(endpoint, json={"require_spanless_note": False})
    assert changed.status_code == 200, changed.text
    assert changed.json()["require_spanless_note"] is False
    retained = lead.patch(endpoint, json={"description": "updated"})
    assert retained.json()["require_spanless_note"] is False
    assert app.state.repo.get_project_rules("phenotypes").require_spanless_note is False
    with app.state.repo.db.transaction() as conn:
        rows = conn.execute(
            select(AuditEventRow.details).where(
                AuditEventRow.action == "project.update"
            )
        ).all()
    assert sorted(row[0]["fields"] for row in rows) == [
        ["description"],
        ["require_spanless_note"],
    ]


def test_only_removing_a_role_ends_the_members_sessions(app):
    admin = logged_in(app, "root", system_admin=True)
    create_project(app, admin)
    lead = logged_in(app, "lead", projects={"phenotypes": ["lead"]})
    alice = logged_in(
        app, "alice", projects={"phenotypes": ["annotator"]}, assignments=[]
    )

    def put(client, username, roles):
        response = client.put(
            f"/api/v1/projects/phenotypes/members/{username}", json={"roles": roles}
        )
        assert response.status_code == 200, response.text

    # A lead adding themself as annotator keeps their session.
    put(lead, "lead", ["lead", "annotator"])
    assert lead.get("/api/v1/projects").status_code == 200
    put(admin, "alice", ["annotator", "adjudicator"])
    assert alice.get("/api/v1/projects").status_code == 200
    # Removing a role revokes.
    put(admin, "alice", ["annotator"])
    assert alice.get("/api/v1/projects").status_code == 401
    # Mixed add and remove revokes too.
    alice = logged_in(app, "alice")
    put(admin, "alice", ["adjudicator"])
    assert alice.get("/api/v1/projects").status_code == 401
