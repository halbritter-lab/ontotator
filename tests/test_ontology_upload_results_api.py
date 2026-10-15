"""Real PostgreSQL/API coverage, authored for the coordinator's exclusive token."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from auth_harness import logged_in
from sqlalchemy import func, select
from test_auth_api import _app

from ontocurator.auth.audit import Actor
from ontocurator.storage.tables import AuditEventRow, OntologyFileRow

FIXTURES = Path(__file__).parent / "fixtures"
HP = (FIXTURES / "hp.json").read_bytes()
DE = (FIXTURES / "hp-de.babelon.tsv").read_bytes()
BASE = "/api/v1/admin/ontologies"


@pytest.fixture
def staged(tmp_path):
    app = _app(tmp_path)
    return app, logged_in(app, "root", system_admin=True)


def audits(app):
    with app.state.repo.db.transaction() as conn:
        return (
            conn.execute(
                select(AuditEventRow).where(AuditEventRow.action == "ontology.add")
            )
            .mappings()
            .all()
        )


@pytest.mark.parametrize("names", [("a.json", "b.json"), ("b.json", "a.json")])
def test_per_input_results_preserve_duplicate_order_and_actual_insert_status(
    staged, names
):
    app, client = staged
    response = client.post(
        BASE + "/upload-results",
        files=[("files[]", (name, HP, "application/json")) for name in names],
    )
    assert response.status_code == 200, response.text
    assert [(row["filename"], row["status"]) for row in response.json()] == [
        (names[0], "added"),
        (names[1], "already_present"),
    ]
    first, second = response.json()
    assert first["ontology"] == second["ontology"]
    assert first["ontology"]["filename"] == names[0]
    assert len(client.get(BASE + "/").json()) == 1
    recorded = audits(app)
    assert len(recorded) == 1
    assert recorded[0]["actor_user_id"] == app.state.accounts.get_by_username("root").id


@pytest.mark.parametrize("translation_first", [False, True])
def test_ontology_and_translation_duplicates_keep_per_input_results(
    staged, translation_first
):
    app, client = staged
    inputs = [("renamed.json", HP), ("HP-DE.babelon.tsv", DE)]
    if translation_first:
        inputs.reverse()
    inputs += [("second.json", HP), ("hp-de.babelon.tsv", DE)]
    response = client.post(
        BASE + "/upload-results",
        files=[("files[]", (name, data)) for name, data in inputs],
    )
    assert response.status_code == 200, response.text
    assert [row["filename"] for row in response.json()] == [
        name for name, _data in inputs
    ]
    assert [row["status"] for row in response.json()] == [
        "added",
        "added",
        "already_present",
        "already_present",
    ]
    assert len(audits(app)) == 2


def test_new_results_do_not_change_legacy_post_shape_or_canonical_metadata(staged):
    _app, client = staged
    original = client.post(BASE + "/", files=[("files[]", ("canonical.json", HP))])
    assert original.status_code == 200, original.text
    response = client.post(
        BASE + "/upload-results", files=[("files[]", ("new-name.json", HP))]
    )
    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "filename": "new-name.json",
            "status": "already_present",
            "ontology": original.json()[0],
        }
    ]
    again = client.post(
        BASE + "/",
        files=[("files[]", ("third.json", HP)), ("files[]", ("fourth.json", HP))],
    )
    assert again.status_code == 200, again.text
    assert again.json() == original.json()


def test_valid_first_input_persists_when_later_file_is_invalid(staged):
    app, client = staged
    response = client.post(
        BASE + "/upload-results",
        files=[
            ("files[]", ("valid.json", HP)),
            ("files[]", ("broken.json", b"not JSON")),
        ],
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "INVALID_ONTOLOGY"
    assert [row["filename"] for row in client.get(BASE + "/").json()] == ["valid.json"]
    assert len(audits(app)) == 1


def test_aggregate_limit_is_checked_before_any_real_store_change(staged):
    app, client = staged
    app.state.config.max_ontology_bytes = len(HP) + 1
    response = client.post(
        BASE + "/upload-results",
        files=[("files[]", ("first.json", HP)), ("files[]", ("second.json", HP))],
    )
    assert response.status_code == 413, response.text
    assert app.state.ontology_store.list() == []
    assert audits(app) == []


def test_member_cannot_use_results_endpoint(staged):
    app, _admin = staged
    member = logged_in(app, "member")
    response = member.post(
        BASE + "/upload-results", files=[("files[]", ("hp.json", HP))]
    )
    assert response.status_code == 403, response.text
    assert app.state.ontology_store.list() == []


def test_concurrent_stale_absent_reads_report_one_actual_insert(staged, monkeypatch):
    app, _client = staged
    store = app.state.ontology_store
    barrier = Barrier(2)
    original = store._get

    def absent_together(digest):
        result = original(digest)
        assert result is None
        barrier.wait(timeout=10)
        return result

    monkeypatch.setattr(store, "_get", absent_together)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(store.add_with_result, Actor.cli(), name, HP)
            for name in ("a.json", "b.json")
        ]
        results = [future.result(timeout=20) for future in futures]
    assert sorted(result.created for result in results) == [False, True]
    assert results[0].ontology == results[1].ontology
    assert len(audits(app)) == 1
    with store.db.transaction() as conn:
        assert (
            conn.execute(select(func.count()).select_from(OntologyFileRow)).scalar_one()
            == 1
        )
