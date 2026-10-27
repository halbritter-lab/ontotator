"""Database-free route and exact SQL insertion-outcome contracts."""

import hashlib
from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from ontotator.api import ontology_routes
from ontotator.api.identity import principal_of
from ontotator.auth.audit import Actor
from ontotator.auth.sessions import Principal
from ontotator.domain.errors import AccessDenied, DomainError, PayloadTooLarge
from ontotator.ontology.store import OntologyFile, OntologyStore


def file_row(name="canonical.json", digest="a" * 64):
    return OntologyFile(
        digest,
        "ontology",
        "hp",
        "2026-06-23",
        name,
        None,
        datetime(2026, 10, 15, tzinfo=UTC),
    )


class FakeStore:
    def __init__(self):
        self.rows = {}
        self.calls = []

    def add_with_result(self, actor, filename, data):
        self.calls.append((actor, filename, data))
        if data == b"invalid":
            raise DomainError("INVALID_ONTOLOGY", "bad ontology")
        digest = hashlib.sha256(data).hexdigest()
        created = digest not in self.rows
        if created:
            self.rows[digest] = file_row(filename, digest)
        return SimpleNamespace(ontology=self.rows[digest], created=created)

    def add(self, actor, filename, data):
        return self.add_with_result(actor, filename, data).ontology


@pytest.fixture
def upload_client(monkeypatch):
    store = FakeStore()
    app = FastAPI()
    app.state.ontology_store = store
    app.state.config = SimpleNamespace(max_ontology_bytes=300 * 1024 * 1024)
    principal = Principal(1, "admin", "Admin", "ann-1", True, 1, "csrf")
    app.dependency_overrides[principal_of] = lambda: principal
    app.include_router(ontology_routes.router)

    def listed(_store):
        return [
            ontology_routes.AdminOntology(**vars(row), projects=[])
            for row in reversed(list(store.rows.values()))
        ]

    monkeypatch.setattr(ontology_routes, "_listed", listed)

    @app.exception_handler(DomainError)
    async def failed(_request: Request, exc: DomainError):
        status = (
            413
            if isinstance(exc, PayloadTooLarge)
            else 403
            if isinstance(exc, AccessDenied)
            else 422
        )
        return JSONResponse({"code": exc.code, "details": str(exc)}, status_code=status)

    return TestClient(app), store, app


def test_new_route_preserves_each_input_name_order_and_duplicate(upload_client):
    client, store, _app = upload_client
    response = client.post(
        "/api/v1/admin/ontologies/upload-results",
        files=[
            ("files[]", ("zeta.json", b"first")),
            ("files[]", ("alias.json", b"first")),
            ("files[]", ("alpha.json", b"second")),
        ],
    )
    assert response.status_code == 200, response.text
    assert [(row["filename"], row["status"]) for row in response.json()] == [
        ("zeta.json", "added"),
        ("alias.json", "already_present"),
        ("alpha.json", "added"),
    ]
    assert [row["ontology"]["filename"] for row in response.json()] == [
        "zeta.json",
        "zeta.json",
        "alpha.json",
    ]
    assert len(store.rows) == 2
    assert all(call[0] == Actor.user(1, "admin") for call in store.calls)


def test_existing_old_post_keeps_deduplicated_inventory_response(upload_client):
    client, _store, _app = upload_client
    response = client.post(
        "/api/v1/admin/ontologies/",
        files=[
            ("files[]", ("first.json", b"same")),
            ("files[]", ("alias.json", b"same")),
        ],
    )
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    assert set(response.json()[0]) == {
        "sha256",
        "kind",
        "prefix",
        "release",
        "filename",
        "language",
        "uploaded_at",
        "projects",
    }
    assert response.json()[0]["filename"] == "first.json"


def test_new_route_existing_bytes_under_new_name_remain_already_present(upload_client):
    client, store, _app = upload_client
    store.add(Actor.cli(), "canonical.json", b"same")
    response = client.post(
        "/api/v1/admin/ontologies/upload-results",
        files=[("files[]", ("renamed.json", b"same"))],
    )
    assert response.status_code == 200, response.text
    assert response.json()[0]["status"] == "already_present"
    assert response.json()[0]["filename"] == "renamed.json"
    assert response.json()[0]["ontology"]["filename"] == "canonical.json"


def test_new_route_keeps_successful_earlier_file_on_later_parse_error(upload_client):
    client, store, _app = upload_client
    response = client.post(
        "/api/v1/admin/ontologies/upload-results",
        files=[
            ("files[]", ("valid.json", b"valid")),
            ("files[]", ("bad.json", b"invalid")),
        ],
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "INVALID_ONTOLOGY"
    assert [row.filename for row in store.rows.values()] == ["valid.json"]


@pytest.mark.parametrize("path", ["/", "/upload-results"])
def test_aggregate_overflow_precedes_every_store_write(upload_client, path):
    client, store, app = upload_client
    app.state.config.max_ontology_bytes = 3
    response = client.post(
        "/api/v1/admin/ontologies" + path,
        files=[("files[]", ("a.json", b"12")), ("files[]", ("b.json", b"34"))],
    )
    assert response.status_code == 413, response.text
    assert store.calls == []


def test_new_route_requires_actual_system_admin_guard(upload_client):
    client, store, app = upload_client
    app.dependency_overrides[principal_of] = lambda: Principal(
        1, "member", "Member", "ann-1", False, 1, "csrf"
    )
    response = client.post(
        "/api/v1/admin/ontologies/upload-results",
        files=[("files[]", ("a.json", b"same"))],
    )
    assert response.status_code == 403, response.text
    assert store.calls == []


@pytest.mark.parametrize("inserted", [None, "a" * 64])
def test_insert_outcome_comes_from_actual_returning_value(monkeypatch, inserted):
    import ontotator.ontology.store as module

    canonical = file_row()
    statements = []
    audits = []

    class Result:
        def scalar_one_or_none(self):
            return inserted

        def one(self):
            return SimpleNamespace(**vars(canonical))

    class Connection:
        def execute(self, statement):
            statements.append(statement)
            return Result()

    conn = Connection()
    store = object.__new__(OntologyStore)
    store.db = SimpleNamespace(
        blobs=SimpleNamespace(put=lambda _data: canonical.sha256),
        transaction=lambda: nullcontext(conn),
    )
    monkeypatch.setattr(
        module, "record_audit", lambda *args, **kwargs: audits.append(kwargs)
    )
    item, created = store._insert_with_result(
        Actor.cli(),
        b"bytes",
        kind="ontology",
        prefix="hp",
        release="2026-06-23",
        filename="new-name.json",
        language=None,
    )
    assert item == canonical
    assert created is (inserted is not None)
    assert len(audits) == int(created)
    insert = statements[1]
    assert insert.table.name == "ontology_files"
    assert [column.name for column in insert._returning] == ["sha256"]
    assert insert._post_values_clause is not None


def test_conflict_after_absent_pre_read_is_not_reported_as_added(monkeypatch):
    store = object.__new__(OntologyStore)
    row = file_row()
    service = SimpleNamespace(
        ontology=SimpleNamespace(dominant_prefix="HP", release="2026-06-23")
    )
    store.registry = SimpleNamespace(
        changing=lambda: nullcontext(),
        register_path=lambda _path: None,
        register_service=lambda _service: None,
    )
    store.db = SimpleNamespace(blobs=SimpleNamespace(path=lambda _digest: "blob"))
    monkeypatch.setattr(store, "_get", lambda _digest: None)
    monkeypatch.setattr(store, "_parse", lambda *_args: service)
    monkeypatch.setattr(
        store,
        "_insert_with_result",
        lambda *_args, **_kwargs: (row, False),
        raising=False,
    )
    outcome = store.add_with_result(Actor.cli(), "new-name.json", b"bytes")
    assert outcome.ontology == row
    assert outcome.created is False


@pytest.mark.parametrize("failure", ["none", "parse", "overflow"])
def test_shared_reader_reads_every_input_before_store_and_closes_all_handles(
    upload_client, monkeypatch, failure
):
    import asyncio
    import io
    from tempfile import TemporaryFile

    from starlette.datastructures import UploadFile

    _client, store, app = upload_client
    data = [b"valid", b"invalid" if failure == "parse" else b"also-valid"]
    files = [
        UploadFile(io.BytesIO(value), filename=f"file-{index}.json")
        for index, value in enumerate(data)
    ]
    handles = []

    @contextmanager
    def temporary_file():
        with TemporaryFile() as handle:
            handles.append(handle)
            yield handle

    monkeypatch.setattr(ontology_routes, "TemporaryFile", temporary_file)
    original = store.add_with_result

    def checked_add(actor, filename, content):
        assert [uploaded.file.tell() for uploaded in files] == list(map(len, data))
        return original(actor, filename, content)

    monkeypatch.setattr(store, "add_with_result", checked_add)
    if failure == "overflow":
        app.state.config.max_ontology_bytes = 2
    principal = Principal(1, "admin", "Admin", "ann-1", True, 1, "csrf")
    call = ontology_routes._upload_files(
        principal, Request({"type": "http", "app": app}), files
    )
    if failure == "none":
        assert len(asyncio.run(call)) == 2
    else:
        with pytest.raises(DomainError):
            asyncio.run(call)
    assert all(uploaded.file.closed for uploaded in files)
    assert all(handle.closed for handle in handles)
    if failure == "overflow":
        assert store.calls == []
