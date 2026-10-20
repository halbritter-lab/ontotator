"""Documents rows API: acceptance and discard records per text version."""

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import event, insert, select
from test_case_api import BASE, CASE, CORRECTED, SOURCE, TARGET
from test_case_api import case_env as case_env

from ontocurator.storage import work_plan_store as store
from ontocurator.storage.plan_tables import DiscardedVariantRow
from ontocurator.storage.tables import ProjectRow

REVIEWED_AT = "2026-10-01T09:30:00+00:00"


def _pid(env: Any) -> int:
    with env.db.transaction() as conn:
        return conn.execute(
            select(ProjectRow.id).where(ProjectRow.project_key == "proj")
        ).scalar_one()


def _lead(env: Any) -> Any:
    return env.app.state.accounts.get_by_username("leader")


def _accept(env: Any, document_id: str, source: str, **extra: Any) -> None:
    with env.db.transaction() as conn:
        store.add_acceptance(conn, _pid(env), document_id, source=source, **extra)


def _discard(env: Any, document_id: str, reason: str) -> None:
    with env.db.transaction() as conn:
        conn.execute(
            insert(DiscardedVariantRow).values(
                project_id=_pid(env),
                document_id=document_id,
                reason=reason,
                discarded_by=_lead(env).id,
                discarded_at=datetime(2026, 10, 19, 8, 0, tzinfo=UTC),
            )
        )


def _versions(env: Any) -> dict[str, dict[str, Any]]:
    response = env.lead.get(f"{BASE}/document-rows", params={"case": CASE})
    assert response.status_code == 200, response.text
    return {
        version["document_id"]: version
        for group in response.json()["groups"]
        for row in group["rows"]
        for version in row["versions"]
    }


def _lead_ref(env: Any) -> dict[str, Any]:
    lead = _lead(env)
    return {
        "pseudonym": lead.pseudonym,
        "display_name": lead.display_name,
        "is_me": True,
    }


def test_versions_without_records_have_none(case_env):
    versions = _versions(case_env)
    assert {SOURCE, TARGET, CORRECTED} <= set(versions)
    for version in versions.values():
        assert version["acceptance"] is None
        assert version["discarded"] is None


def test_package_acceptance_keeps_the_package_metadata(case_env):
    _accept(
        case_env,
        TARGET,
        "package",
        reason=None,
        accepted_by=None,
        metadata={"reviewer": "R. Roe", "reviewed_at": REVIEWED_AT, "note": "ok"},
    )
    acceptance = _versions(case_env)[TARGET]["acceptance"]
    assert acceptance["source"] == "package"
    assert acceptance["reason"] is None
    assert acceptance["accepted_by"] is None
    assert acceptance["accepted_at"] is not None
    assert acceptance["reviewer"] == "R. Roe"
    assert acceptance["reviewed_at"] == REVIEWED_AT
    assert set(acceptance) == {
        "source",
        "reason",
        "accepted_at",
        "accepted_by",
        "reviewer",
        "reviewed_at",
    }


@pytest.mark.parametrize("source", ["lead", "override"])
def test_lead_and_override_acceptance_name_the_lead(case_env, source):
    _accept(
        case_env,
        CORRECTED,
        source,
        reason="Reviewed by the clinic",
        accepted_by=_lead(case_env).id,
    )
    versions = _versions(case_env)
    acceptance = versions[CORRECTED]["acceptance"]
    assert acceptance["source"] == source
    assert acceptance["reason"] == "Reviewed by the clinic"
    assert acceptance["accepted_by"] == _lead_ref(case_env)
    assert acceptance["accepted_at"] is not None
    assert acceptance["reviewer"] is None and acceptance["reviewed_at"] is None
    assert versions[TARGET]["acceptance"] is None


def test_the_newest_acceptance_record_wins(case_env):
    _accept(case_env, TARGET, "package", reason=None, accepted_by=None)
    _accept(
        case_env,
        TARGET,
        "lead",
        reason="Checked again",
        accepted_by=_lead(case_env).id,
    )
    acceptance = _versions(case_env)[TARGET]["acceptance"]
    assert acceptance["source"] == "lead" and acceptance["reason"] == "Checked again"


def test_discarded_version_carries_its_record(case_env):
    _discard(case_env, TARGET, "Wrong text")
    versions = _versions(case_env)
    assert versions[TARGET]["discarded"] == {
        "reason": "Wrong text",
        "discarded_at": "2026-10-19T08:00:00Z",
        "discarded_by": _lead_ref(case_env),
    }
    assert versions[CORRECTED]["discarded"] is None


def test_records_add_no_queries_per_version(case_env):
    env = case_env
    engine = env.db.engine
    count = 0

    def counter(*_args: Any) -> None:
        nonlocal count
        count += 1

    def page_queries() -> int:
        nonlocal count
        count = 0
        event.listen(engine, "before_cursor_execute", counter)
        try:
            _versions(env)
        finally:
            event.remove(engine, "before_cursor_execute", counter)
        return count

    empty = page_queries()
    _accept(env, TARGET, "package", reason=None, accepted_by=None)
    _accept(env, CORRECTED, "lead", reason="Fine", accepted_by=_lead(env).id)
    _discard(env, TARGET, "Wrong text")
    assert page_queries() == empty
