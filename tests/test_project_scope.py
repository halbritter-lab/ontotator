"""Project scoping: a user reaches project data only through a membership (E3)."""

from __future__ import annotations

import hashlib
import inspect
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from auth_harness import PASSWORD, ensure_user, logged_in, upload_package
from layered_fixtures import make_layered_package
from pg_harness import database_for, database_url_for
from sqlalchemy import select

from ontocurator.api.app import create_app
from ontocurator.auth.accounts import AccountService
from ontocurator.auth.audit import Actor
from ontocurator.auth.sessions import SessionService
from ontocurator.authz.memberships import MembershipService
from ontocurator.authz.policy import Access
from ontocurator.authz.scoped import PROJECT_FREE, ScopedRepository
from ontocurator.config import AppConfig
from ontocurator.domain.annotations import AnnotationRef
from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import AccessDenied, DomainError
from ontocurator.domain.reanchor_resolution import PendingReanchorRef
from ontocurator.domain.review import ReviewTargetSet
from ontocurator.domain.workspace import Draft, MutationEnvelope, WorkspaceKey
from ontocurator.packages.models import SearchEventRecord, ValidatedPackage
from ontocurator.storage.database import Database
from ontocurator.storage.repository import Repository
from ontocurator.storage.tables import AuditEventRow, ProjectRow

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"
ADMIN = Actor(None, "test:admin")


def _package(key: str) -> ValidatedPackage:
    pkg = make_layered_package("single")
    return pkg.model_copy(
        update={"manifest": pkg.manifest.model_copy(update={"package_id": key})}
    )


def _key(project_key: str) -> WorkspaceKey:
    return WorkspaceKey(
        project_key=project_key,
        document_id="doc-beta",
        annotator_id="ann-0001",
        mode="independent",
        target_set_id=ReviewTargetSet.create([]).target_set_id,
    )


def _event(project_key: str) -> SearchEventRecord:
    return SearchEventRecord(
        event_id="e-1",
        workspace_key=_key(project_key),
        annotation_id="a-1",
        query="seizure",
        route="lexical",
        candidates=[],
        ontology_release="2026-06-23",
        index_identity="i",
        timestamp="2026-10-15T00:00:00Z",
    )


def _access(roles: dict[str, Any] | None = None, *, admin: bool = False) -> Access:
    return Access(
        user_id=1,
        pseudonym="ann-0001",
        is_system_admin=admin,
        roles={key: frozenset(value) for key, value in (roles or {}).items()},
    )


@pytest.fixture
def db(tmp_path: Path) -> Database:
    db = database_for(tmp_path / "scope.db")
    repo = Repository(db)
    repo.import_package(_package("A"))
    repo.import_package(_package("B"))
    return db


def test_a_member_sees_only_their_projects(db: Database) -> None:
    from ontocurator.assignments.service import AssignmentService

    accounts = AccountService(db)
    user = accounts.create_user(ADMIN, "scope-alice", "Alice").user
    MembershipService(db).add(ADMIN, "A", user.username, ["annotator"])
    AssignmentService(db).assign(
        ADMIN, "A", "doc-beta", user.username, "annotate", confirm_language=True
    )
    alice = ScopedRepository(db, _access({"A": {"annotator"}}))

    assert [m.package_id for m in alice.list_manifests()] == ["A"]
    assert [p.project_key for p in alice.list_projects()] == ["A"]
    assert alice.get_document("A", "doc-beta") is not None
    with pytest.raises(DomainError) as error:
        alice.get_document("B", "doc-beta")
    assert error.value.code == "PROJECT_NOT_FOUND"


# One call per overridden method, each naming project B.
CALLS: dict[str, Callable[[Repository], object]] = {
    "import_package": lambda r: r.import_package(_package("B")),
    "create_project": lambda r: r.create_project(
        "B", "B", None, _package("B").manifest.task_profile, {}
    ),
    "project_pins": lambda r: r.project_pins("B"),
    "t1_export_content": lambda r: r.t1_export_content("B"),
    "edit_log": lambda r: r.edit_log("B"),
    "add_documents_and_proposals": lambda r: r.add_documents_and_proposals(
        "B", [], [], source_sha256="0" * 64
    ),
    "get_search_conditions": lambda r: r.get_search_conditions("B"),
    "capture_search_conditions": lambda r: r.capture_search_conditions("B", [], {}),
    "get_embedded_files": lambda r: r.get_embedded_files("B"),
    "get_manifest": lambda r: r.get_manifest("B"),
    "manifest_hash": lambda r: r.manifest_hash("B"),
    "get_task_profile": lambda r: r.get_task_profile("B"),
    "get_axes_config": lambda r: r.get_axes_config("B"),
    "get_project_rules": lambda r: r.get_project_rules("B"),
    "get_document": lambda r: r.get_document("B", "doc-beta"),
    "get_variant": lambda r: r.get_variant("B", "doc-beta"),
    "get_variant_text": lambda r: r.get_variant_text("B", "doc-beta"),
    "get_annotation_version": lambda r: r.get_annotation_version(
        "B", "doc-beta", "own", "missing"
    ),
    "get_reanchor_items": lambda r: r.get_reanchor_items("B", "doc-beta"),
    "list_variants": lambda r: r.list_variants("B"),
    "find_variants_by_text_sha256": lambda r: r.find_variants_by_text_sha256(
        "B", "0" * 64
    ),
    "get_proposal_set": lambda r: r.get_proposal_set("B", 1),
    "workspace_proposal_sets": lambda r: r.workspace_proposal_sets(_key("B"), []),
    "workspace_reanchor_items": lambda r: r.workspace_reanchor_items(
        Draft(key=_key("B"), targets=ReviewTargetSet.create([]), revision=0)
    ),
    "verified_reanchor_source": lambda r: r.verified_reanchor_source(
        _key("B"),
        PendingReanchorRef(
            proposal_set_id=1, source_ref=AnnotationRef(annotation_id="a", version="v")
        ),
    ),
    "reanchor_source_identity": lambda r: r.reanchor_source_identity(
        _key("B"),
        PendingReanchorRef(
            proposal_set_id=1, source_ref=AnnotationRef(annotation_id="a", version="v")
        ),
    ),
    "proposal_metadata": lambda r: r.proposal_metadata("B", "doc-beta"),
    "list_documents": lambda r: r.list_documents("B"),
    "get_annotation_snapshot": lambda r: r.get_annotation_snapshot("a", "v", "B"),
    "get_evidence_snapshot": lambda r: r.get_evidence_snapshot("e", "v", "B"),
    "list_annotations_for_document": lambda r: r.list_annotations_for_document(
        "B", "doc-beta"
    ),
    "list_workspace_keys": lambda r: r.list_workspace_keys("B", "ann-0001"),
    "open_draft": lambda r: r.open_draft(_key("B")),
    "run_mutation": lambda r: r.run_mutation(
        _key("B"),
        MutationEnvelope(mutation_id="m", expected_revision=0, payload={}),
        lambda draft: draft,
    ),
    "get_document_status": lambda r: r.get_document_status(
        "B", "doc-beta", "ann-0001", "independent"
    ),
    "get_document_statuses": lambda r: r.get_document_statuses(
        "B", "ann-0001", "independent"
    ),
    "review_input_document_ids": lambda r: r.review_input_document_ids("B"),
    "get_submissions_for_workspace": lambda r: r.get_submissions_for_workspace(
        _key("B")
    ),
    "get_submissions_for_document": lambda r: r.get_submissions_for_document(
        "B", "doc-beta"
    ),
    "get_submission": lambda r: r.get_submission("s", "B"),
    "save_search_event": lambda r: r.save_search_event(_event("B")),
    "get_search_event": lambda r: r.get_search_event("e-1", "B"),
    "append_search_event_candidates": lambda r: r.append_search_event_candidates(
        "e-1", ["HP:1"], workspace_key=_key("B")
    ),
    "get_search_events_for_workspace": lambda r: r.get_search_events_for_workspace(
        _key("B")
    ),
    "export_package": lambda r: r.export_package("B"),
    "edit_events": lambda r: r.edit_events(_key("B")),
    "draft_state_at": lambda r: r.draft_state_at(_key("B"), 1),
}


def _public_methods() -> set[str]:
    return {
        name
        for name, member in inspect.getmembers(Repository)
        if not name.startswith("_") and callable(member)
    }


def test_no_public_method_escapes_the_scope() -> None:
    overridden = {name for name in _public_methods() if name in vars(ScopedRepository)}

    assert _public_methods() - overridden == PROJECT_FREE
    # The two lists filter instead of refusing (see the first test).
    assert set(CALLS) == overridden - {"list_manifests", "list_projects"}


@pytest.mark.parametrize("method", sorted(CALLS))
def test_every_project_method_checks_the_scope(db: Database, method: str) -> None:
    alice = ScopedRepository(db, _access({"A": {"annotator", "lead"}}))

    with pytest.raises(DomainError) as error:
        CALLS[method](alice)

    if method in ("import_package", "create_project"):
        # Creating or importing is refused alike for missing and foreign keys.
        assert isinstance(error.value, AccessDenied)
        assert error.value.code == "NOT_ALLOWED"
    else:
        assert error.value.code == "PROJECT_NOT_FOUND"


@pytest.mark.parametrize(
    "method",
    [
        "workspace_reanchor_items",
        "reanchor_source_identity",
        "verified_reanchor_source",
    ],
)
def test_reanchor_methods_hide_foreign_and_missing_projects(
    db: Database, method: str
) -> None:
    alice = ScopedRepository(db, _access({"A": {"annotator", "lead"}}))
    errors = []
    for project in ("B", "missing"):
        key = _key(project)
        with pytest.raises(DomainError) as error:
            if method == "workspace_reanchor_items":
                alice.workspace_reanchor_items(
                    Draft(key=key, targets=ReviewTargetSet.create([]), revision=0)
                )
            else:
                getattr(alice, method)(
                    key,
                    PendingReanchorRef(
                        proposal_set_id=1,
                        source_ref=AnnotationRef(annotation_id="a", version="v"),
                    ),
                )
        errors.append(
            (error.value.code, str(error.value.details).replace(project, "project"))
        )
    assert errors[0] == errors[1]
    assert errors[0][0] == "PROJECT_NOT_FOUND"


@pytest.mark.parametrize(
    "call",
    [
        lambda r: r.get_search_event("e-1"),
        lambda r: r.get_submission("s"),
        lambda r: r.get_annotation_snapshot("a", "v"),
        lambda r: r.get_evidence_snapshot("e", "v"),
        lambda r: r.append_search_event_candidates("e-1", ["HP:1"]),
    ],
)
def test_lookups_without_a_project_are_refused(
    db: Database, call: Callable[[Repository], object]
) -> None:
    admin = ScopedRepository(db, _access(admin=True))

    with pytest.raises(DomainError) as error:
        call(admin)

    assert error.value.code == "PROJECT_REQUIRED"


def test_a_system_admin_sees_every_project(db: Database) -> None:
    AccountService(db).create_user(ADMIN, "scope-admin", "Admin", system_admin=True)
    admin = ScopedRepository(db, _access(admin=True))

    assert sorted(m.package_id for m in admin.list_manifests()) == ["A", "B"]
    assert admin.get_document("B", "doc-beta") is not None
    admin.export_package("B")


def test_a_lead_imports_into_their_project_only(db: Database) -> None:
    lead = ScopedRepository(db, _access({"A": {"lead"}}))

    assert lead.import_package(_package("A")) == "A"
    with pytest.raises(AccessDenied):
        lead.import_package(_package("C"))


def test_membership_changes_are_audited_and_end_sessions(db: Database) -> None:
    accounts = AccountService(db)
    sessions = SessionService(db)
    memberships = MembershipService(db)
    issued = accounts.create_user(ADMIN, "alice", "Alice")
    accounts.redeem_code("alice", issued.code, PASSWORD)
    token, principal = sessions.login("alice", PASSWORD, client_ip="10.0.0.1")

    roles = memberships.add(ADMIN, "A", "Alice", ["annotator", "lead"])

    assert roles == {"annotator", "lead"}
    assert sessions.resolve(token) is None
    assert memberships.members("A") == [
        ("alice", principal.pseudonym, frozenset({"annotator", "lead"}))
    ]
    assert memberships.access_for(principal).roles == {
        "A": frozenset({"annotator", "lead"})
    }
    token, _ = sessions.login("alice", PASSWORD, client_ip="10.0.0.1")
    # Nothing new: no audit row, the session stays.
    memberships.add(ADMIN, "A", "alice", ["lead"])
    assert sessions.resolve(token) is not None
    # Removing the last lead is an administrator exception; the CLI actor
    # represents the installation operator, unlike this fixture's test actor.
    assert memberships.remove(Actor.cli(), "A", "alice", ["lead"]) == {"annotator"}
    assert sessions.resolve(token) is None
    assert memberships.remove(ADMIN, "A", "alice") == frozenset()
    with db.transaction() as conn:
        rows = conn.execute(
            select(
                AuditEventRow.action, AuditEventRow.project_id, AuditEventRow.details
            ).order_by(AuditEventRow.id)
        ).all()
        project_a = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "A")
        ).scalar_one()
    members = [r for r in rows if r.action.startswith("project.")]
    assert [(r.action, r.project_id, r.details) for r in members] == [
        (
            "project.member_add",
            project_a,
            {"username": "alice", "roles": ["annotator", "lead"]},
        ),
        ("project.member_remove", project_a, {"username": "alice", "roles": ["lead"]}),
        (
            "project.member_remove",
            project_a,
            {"username": "alice", "roles": ["annotator"]},
        ),
    ]


@pytest.mark.parametrize(
    ("project", "username", "roles", "code"),
    [
        ("Z", "alice", ["lead"], "PROJECT_NOT_FOUND"),
        ("A", "nobody", ["lead"], "USER_NOT_FOUND"),
        ("A", "alice", ["owner"], "ROLE_INVALID"),
        ("A", "alice", [], "ROLE_INVALID"),
    ],
)
def test_membership_input_is_checked(
    db: Database, project: str, username: str, roles: list[str], code: str
) -> None:
    AccountService(db).create_user(ADMIN, "alice", "Alice")

    with pytest.raises(DomainError) as error:
        MembershipService(db).add(ADMIN, project, username, roles)

    assert error.value.code == code


@pytest.fixture
def app(tmp_path: Path) -> Any:
    raw = FIXTURE_PATH.read_bytes()
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=database_url_for(tmp_path / "api.db"),
        ontology_paths=[FIXTURE_PATH],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=OntologyRef(
            release="2026-06-23", sha256=hashlib.sha256(raw).hexdigest()
        ),
    )
    app = create_app(config)
    app.state.repo.import_package(_package("A"))
    app.state.repo.import_package(_package("B"))
    return app


def test_the_api_hides_foreign_projects(app: Any) -> None:
    alice = logged_in(app, "alice", projects={"A": ["annotator"]})

    assert alice.get("/api/v1/projects/A/documents").status_code == 200
    foreign = alice.get("/api/v1/projects/B/documents")
    missing = alice.get("/api/v1/projects/Z/documents")

    assert foreign.status_code == 404
    assert missing.status_code == 404
    assert foreign.json()["code"] == missing.json()["code"] == "PROJECT_NOT_FOUND"
    assert foreign.json()["details"].replace("B", "Z") == missing.json()["details"]
    assert [p["project_key"] for p in alice.get("/api/v1/projects").json()] == ["A"]


def test_an_upload_makes_the_uploader_a_member_of_the_new_project(
    app: Any, tmp_path: Path
) -> None:
    import io

    from support.v2_writer import PackageWriter

    ensure_user(app, "root", system_admin=True)
    root = logged_in(app, "root")
    buf = io.BytesIO()
    PackageWriter.write_to_stream(_package("C"), buf)

    response = upload_package(
        root,
        files={"file": ("c.zip", buf.getvalue(), "application/zip")},
    )

    assert response.status_code == 200, response.text
    assert app.state.memberships.members("C") == [
        ("root", "ann-0001", frozenset({"lead", "annotator", "adjudicator"}))
    ]
    # The uploader's session goes on.
    assert root.get("/api/v1/projects/C/documents").status_code == 200
    with app.state.repo.db.transaction() as conn:
        actions = list(
            conn.execute(
                select(AuditEventRow.action)
                .where(AuditEventRow.project_id.is_not(None))
                .order_by(AuditEventRow.id)
            ).scalars()
        )
    assert actions == ["project.create", "project.member_add"]
