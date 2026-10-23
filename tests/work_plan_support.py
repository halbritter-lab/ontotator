"""Test helper: every language version in the plan (review on translations).

``plan_env`` builds the work-plan test project: a lead, reviewers ``ana``
("Ana Weber") and ``ben`` ("Ben Roth"), one annotator, and cases ``c1``/``c2``
with an ``en`` source and ``de``/``fr`` machine translations.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from sqlalchemy import select, update

from ontocurator.domain.work_plans import PlanFlags, RowKey
from ontocurator.storage import work_plan_store as store
from ontocurator.storage.repository import Repository


def plan_all(db: Any, key: str) -> None:
    with db.transaction() as conn:
        pid = Repository._project_id(conn, key)
        assert pid is not None
        rows = store.language_versions(conn, pid)
        flags = {k: PlanFlags(not v.is_source, True) for k, v in rows.items()}
        store.write_rows(conn, pid, flags, actor_id=None)


CASES = ("c1", "c2")
LANGUAGES = ("de", "fr")
BASE = "/api/v1/projects/proj"


def doc(case: str, language: str) -> str:
    """Document ID of the version-1 text of ``case`` in ``language``."""
    return f"{case}-{language}"


def _user(app: Any, username: str, display_name: str) -> None:
    from auth_harness import HARNESS, PASSWORD

    accounts = app.state.accounts
    if accounts.get_by_username(username) is None:
        issued = accounts.create_user(HARNESS, username, display_name)
        accounts.redeem_code(username, issued.code, PASSWORD)


def plan_env(tmp_path: Any, *, rule_on: bool = True) -> SimpleNamespace:
    from auth_harness import grant, logged_in
    from t1_builders import bundle, native_unit, translation_unit
    from t1_fixtures import TEXT, create_project, run_import
    from test_auth_api import _app

    from ontocurator.storage.tables import ProjectRow

    app = _app(tmp_path)
    db = app.state.repo.db
    create_project(db)
    set_rule(db, rule_on)
    units = []
    for case in CASES:
        source = native_unit(doc(case, "en"), "en", f"{TEXT} {case}", case_id=case)
        units.append(source)
        for language in LANGUAGES:
            units.append(
                translation_unit(
                    doc(case, language),
                    language,
                    f"{TEXT} {case} {language}",
                    source=source,
                )
            )
    result = run_import(db, bundle(tmp_path, units))
    assert result.status == "succeeded", result.error
    for username, name in (
        ("ana", "Ana Weber"),
        ("ben", "Ben Roth"),
        ("anno", "Anne Notator"),
        ("anno2", "Arne Notator"),
    ):
        _user(app, username, name)
        assert grant(app, username, "proj", ["annotator"])
    _user(app, "adj", "Ada Judicator")
    assert grant(app, "adj", "proj", ["adjudicator"])
    lead = logged_in(app, "leader", projects={"proj": ["lead"]}, assignments=[])
    with db.transaction() as conn:
        pid = conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()
        flags = {RowKey(case, "en"): PlanFlags(False, True) for case in CASES} | {
            RowKey(case, language): PlanFlags(False, False)
            for case in CASES
            for language in LANGUAGES
        }
        store.write_rows(conn, pid, flags, actor_id=None)
    return SimpleNamespace(app=app, db=db, pid=pid, lead=lead)


def set_rule(db: Any, rule_on: bool) -> None:
    from ontocurator.storage.tables import ProjectRow

    with db.transaction() as conn:
        conn.execute(
            update(ProjectRow)
            .where(ProjectRow.project_key == "proj")
            .values(annotate_accepted_translations_only=rule_on)
        )


def service(env: Any, username: str = "leader") -> Any:
    """A WorkPlanService acting as ``username`` with its current roles."""
    from ontocurator.application.work_plans import WorkPlanService
    from ontocurator.auth.audit import Actor
    from ontocurator.authz.policy import Access
    from ontocurator.storage.tables import ProjectMembershipRow, ProjectRow

    user = env.app.state.accounts.get_by_username(username)
    roles: dict[str, set[str]] = {}
    with env.db.transaction() as conn:
        for key, role in conn.execute(
            select(ProjectRow.project_key, ProjectMembershipRow.role)
            .join(ProjectRow, ProjectRow.id == ProjectMembershipRow.project_id)
            .where(ProjectMembershipRow.user_id == user.id)
        ):
            roles.setdefault(key, set()).add(role)
    access = Access(
        user.id,
        user.pseudonym,
        user.is_system_admin,
        {key: frozenset(values) for key, values in roles.items()},  # type: ignore[misc]
    )
    return WorkPlanService(env.db, Actor(user.id, f"user:{username}"), access)


def review_task(
    db: Any, key: str, document_id: str, username: str, actor: Any = None
) -> Any:
    """Task ``review`` the way only a consolidation start creates it (D1):
    ``_assign_locked`` with its checks; the public ``assign`` refuses it."""
    from ontocurator.assignments.service import AssignmentService
    from ontocurator.auth.audit import Actor
    from ontocurator.storage.tables import ProjectRow

    service = AssignmentService(db)
    with db.transaction() as conn:
        project = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one()
        )
        target = service._target(conn, username)
        return service._assign_locked(
            conn, actor or Actor.cli(), project, document_id, target, "review", True
        )


def assign(env: Any, document_id: str, username: str, task: str, **extra: Any) -> int:
    """Assign through the real service as the lead; returns the assignment ID."""
    from ontocurator.assignments.service import AssignmentService
    from ontocurator.auth.audit import Actor

    lead = env.app.state.accounts.get_by_username("leader")
    if task == "review" and not extra:
        return int(
            review_task(
                env.db, "proj", document_id, username, Actor(lead.id, "user:leader")
            ).id
        )
    return (
        AssignmentService(env.db)
        .assign(
            Actor(lead.id, "user:leader"),
            "proj",
            document_id,
            username,
            task,  # type: ignore[arg-type]
            confirm_language=True,
            **extra,
        )
        .id
    )


def flags_of(env: Any, case: str, language: str) -> PlanFlags:
    with env.db.transaction() as conn:
        return store.effective_plan(conn, env.pid, [case])[RowKey(case, language)]


def revision_of(env: Any, case: str) -> int:
    with env.db.transaction() as conn:
        return store.revisions(conn, env.pid, [case])[case]


def write(env: Any, flags: dict[RowKey, PlanFlags]) -> None:
    with env.db.transaction() as conn:
        store.write_rows(conn, env.pid, flags, actor_id=None)


def submit(env: Any, assignment_id: int, submission_id: str) -> None:
    """Record a submission for the assignment's user and mark it submitted."""
    from sqlalchemy import select as sa_select

    from ontocurator.domain.review import ReviewTargetSet
    from ontocurator.domain.workspace import Submission, WorkspaceKey
    from ontocurator.storage.repository import _key_str
    from ontocurator.storage.tables import AssignmentRow, UserRow

    with env.db.transaction() as conn:
        row = conn.execute(
            sa_select(AssignmentRow.document_id, UserRow.pseudonym)
            .join(UserRow, UserRow.id == AssignmentRow.user_id)
            .where(AssignmentRow.id == assignment_id)
        ).one()
    key = WorkspaceKey(
        project_key="proj",
        document_id=row.document_id,
        annotator_id=row.pseudonym,
        mode="independent",
        target_set_id="targets-0",
    )
    record = Submission(
        submission_id=submission_id,
        origin_key=key,
        targets=ReviewTargetSet.create([]),
        draft_revision=1,
        snapshots=[],
        decisions=[],
        created_at="2026-10-16T10:00:00Z",
    )
    with env.db.transaction() as conn:
        env.app.state.repo._insert_submission(
            conn, env.pid, record, local_key=_key_str(key), imported=False
        )
        conn.execute(
            update(AssignmentRow)
            .where(AssignmentRow.id == assignment_id)
            .values(status="submitted", last_submission_id=submission_id)
        )


def select_final(env: Any, document_id: str, submission_id: str) -> dict[str, Any]:
    response = env.lead.put(
        f"{BASE}/final-selections",
        json={
            "document_id": document_id,
            "submission_id": submission_id,
            "expected_revision": 0,
        },
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def preflight(env: Any) -> dict[str, Any]:
    response = env.lead.post(f"{BASE}/exports/final/preflight")
    assert response.status_code == 200, response.text
    return dict(response.json())
