"""Environment-only serving, production boundaries, and proxy trust."""

import os
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pg_harness import database_url_for, unmigrated_database_url
from sqlalchemy import select
from sqlalchemy.engine import make_url
from typer.testing import CliRunner

from ontotator import settings
from ontotator.cli import app as cli_app
from ontotator.storage.tables import LoginAttemptRow


def production_env(tmp_path: Path) -> dict[str, str]:
    secret = tmp_path / "password"
    secret.write_text("test-only-password\n", encoding="utf-8")
    return {
        "ONTOTATOR_ENV": "production",
        "ONTOTATOR_PUBLIC_ORIGIN": "https://editor.example.org",
        "ONTOTATOR_TRUSTED_PROXIES": "10.0.0.2, ::1",
        "ONTOTATOR_DATABASE_URL": "postgresql://ontotator_app@db/ontotator",
        "ONTOTATOR_DATABASE_PASSWORD_FILE": str(secret),
        "ONTOTATOR_DATA_DIR": str(tmp_path / "data"),
    }


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("ONTOTATOR_PUBLIC_ORIGIN", None),
        ("ONTOTATOR_PUBLIC_ORIGIN", "http://editor.example.org"),
        ("ONTOTATOR_PUBLIC_ORIGIN", "https://editor.example.org/path"),
        ("ONTOTATOR_TRUSTED_PROXIES", None),
        ("ONTOTATOR_TRUSTED_PROXIES", "*"),
        ("ONTOTATOR_TRUSTED_PROXIES", "10.0.0.0/24"),
        ("ONTOTATOR_TRUSTED_PROXIES", "proxy.example.org"),
    ],
)
def test_production_needs_an_https_origin_and_exact_proxies(
    tmp_path: Path, name: str, value: str | None
) -> None:
    env = production_env(tmp_path)
    if value is None:
        del env[name]
    else:
        env[name] = value
    with pytest.raises(settings.SettingsError, match=name):
        settings.server_settings(env)


@pytest.mark.parametrize("embedded", [False, True])
def test_production_refuses_plaintext_database_passwords(
    tmp_path: Path, embedded: bool
) -> None:
    env = production_env(tmp_path)
    del env["ONTOTATOR_DATABASE_PASSWORD_FILE"]
    if embedded:
        env["ONTOTATOR_DATABASE_URL"] = "postgresql://ontotator_app:secret@db/app"
    else:
        env["ONTOTATOR_DATABASE_PASSWORD"] = "secret"
    with pytest.raises(settings.SettingsError, match="ONTOTATOR_DATABASE"):
        settings.server_settings(env)


@pytest.mark.parametrize("with_password_file", [False, True])
@pytest.mark.parametrize("query_key", ["password", "pass%77ord"])
def test_production_refuses_database_password_query_parameters(
    tmp_path: Path, with_password_file: bool, query_key: str
) -> None:
    env = production_env(tmp_path)
    if not with_password_file:
        del env["ONTOTATOR_DATABASE_PASSWORD_FILE"]
    secret = "query-secret-marker"
    env["ONTOTATOR_DATABASE_URL"] += f"?{query_key}={secret}"
    with pytest.raises(settings.SettingsError, match="ONTOTATOR_DATABASE_URL") as exc:
        settings.server_settings(env)
    assert secret not in str(exc.value)


def test_production_refuses_direct_admin_hash(tmp_path: Path) -> None:
    env = production_env(tmp_path)
    env["ONTOTATOR_ADMIN_PASSWORD_HASH"] = "secret-hash"
    with pytest.raises(settings.SettingsError, match="ONTOTATOR_ADMIN_PASSWORD_HASH"):
        settings.server_settings(env)


def test_development_defaults() -> None:
    result = settings.server_settings(
        {"ONTOTATOR_DATABASE_URL": "postgresql://ontotator_app@db/app"}
    )
    assert result.environment == "development"
    assert result.data_dir == Path("data")
    assert result.public_origin is None
    assert result.trusted_proxies == ()
    assert result.workers == 2
    assert result.admin_password_hash is None


def test_production_reads_runtime_secrets_only_and_canonicalizes(
    tmp_path: Path,
) -> None:
    env = production_env(tmp_path)
    del env["ONTOTATOR_DATA_DIR"]
    env["ONTOTATOR_PUBLIC_ORIGIN"] = "https://Editor.Example.Org:443/"
    env["ONTOTATOR_WORKERS"] = "6"
    admin_file = tmp_path / "admin"
    admin_file.write_text("hash-from-file\n", encoding="utf-8")
    env["ONTOTATOR_ADMIN_PASSWORD_HASH_FILE"] = str(admin_file)
    env["ONTOTATOR_MIGRATION_DATABASE_URL"] = "invalid URL deliberately ignored"
    env["ONTOTATOR_MIGRATION_DATABASE_PASSWORD_FILE"] = "/does/not/exist"
    result = settings.server_settings(env)
    assert result.data_dir == Path("/data")
    assert result.public_origin == "https://editor.example.org"
    assert result.trusted_proxies == ("10.0.0.2", "::1")
    assert result.workers == 6
    assert result.admin_password_hash == "hash-from-file"
    assert result.database_url.password == "test-only-password"
    assert "hash-from-file" not in repr(result)
    assert "test-only-password" not in repr(result)


def test_unknown_environment_is_refused() -> None:
    with pytest.raises(settings.SettingsError, match="ONTOTATOR_ENV"):
        settings.server_settings({"ONTOTATOR_ENV": "prod"})


@pytest.mark.parametrize("workers", ["0", "7", "abc"])
def test_worker_count_is_bounded(tmp_path: Path, workers: str) -> None:
    env = production_env(tmp_path)
    env["ONTOTATOR_WORKERS"] = workers
    with pytest.raises(settings.SettingsError, match="ONTOTATOR_WORKERS"):
        settings.server_settings(env)


def install_env(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name in list(os.environ):
        if name.startswith("ONTOTATOR_") and name != "ONTOTATOR_TEST_PG_URL":
            monkeypatch.delenv(name)
    for name, value in env.items():
        monkeypatch.setenv(name, value)


def real_env(tmp_path: Path, url: str) -> dict[str, str]:
    env = production_env(tmp_path)
    parsed = make_url(url)
    env["ONTOTATOR_DATABASE_URL"] = parsed._replace(password=None).render_as_string()
    return env


def test_app_from_env_hides_the_api_docs_in_production(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontotator.api.server import app_from_env

    install_env(monkeypatch, real_env(tmp_path, database_url_for(tmp_path / "db")))
    api = app_from_env()
    client = TestClient(
        api, client=("127.0.0.1", 1234), base_url="https://editor.example.org"
    )
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
    assert client.get("/livez").status_code == 200
    assert client.get("/api/v1/ontologies").status_code == 401
    assert api.state.config.host == "0.0.0.0"
    assert client.get("/livez", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/livez", headers={"host": "127.0.0.1"}).status_code == 200


@pytest.mark.parametrize(
    ("peer", "expected"),
    [
        ("10.0.0.2", "198.51.100.7"),
        ("::1", "198.51.100.7"),
        ("::ffff:10.0.0.2", "198.51.100.7"),
        # Loopback (health checks, in-container tools) is served, but its
        # forwarded headers are not believed.
        ("127.0.0.1", "127.0.0.1"),
    ],
)
def test_forwarded_addresses_are_used_only_from_trusted_proxies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, peer: str, expected: str
) -> None:
    from ontotator.api.server import app_from_env

    env = real_env(tmp_path, database_url_for(tmp_path / "db"))
    install_env(monkeypatch, env)
    api = app_from_env()
    client = TestClient(api, client=(peer, 1234), base_url="https://editor.example.org")
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "unknown", "password": "wrong"},
        headers={
            "Origin": env["ONTOTATOR_PUBLIC_ORIGIN"],
            "X-Forwarded-For": "203.0.113.1, 198.51.100.7",
        },
    )
    assert response.status_code == 401
    with api.state.repo.db.transaction() as conn:
        assert conn.execute(select(LoginAttemptRow.client_ip)).scalars().all() == [
            expected
        ]


@pytest.mark.parametrize("peer", ["10.0.0.3", "172.18.0.1", "testclient"])
def test_production_refuses_peers_other_than_the_trusted_proxy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    peer: str,
) -> None:
    """A recreated proxy with a new address must not share one lockout bucket.

    Without the check, uvicorn would ignore its X-Forwarded-For and count
    every user under the proxy's own address (issue #66).
    """
    from ontotator.api.server import app_from_env

    env = real_env(tmp_path, database_url_for(tmp_path / "db"))
    install_env(monkeypatch, env)
    api = app_from_env()
    client = TestClient(api, client=(peer, 1234), base_url="https://editor.example.org")
    with caplog.at_level("ERROR", logger="ontotator.api.proxy_guard"):
        for _ in range(3):
            response = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": "wrong"},
                headers={
                    "Origin": env["ONTOTATOR_PUBLIC_ORIGIN"],
                    "X-Forwarded-For": "198.51.100.7",
                },
            )
            assert response.status_code == 503
            assert "ONTOTATOR_TRUSTED_PROXIES" in response.text
        assert client.get("/livez").status_code == 503
    # Logged once per peer and interval, naming the peer and the setting.
    refusals = [r for r in caplog.records if r.name == "ontotator.api.proxy_guard"]
    assert len(refusals) == 1
    assert peer in refusals[0].getMessage()
    assert "10.0.0.2" in refusals[0].getMessage()
    with api.state.repo.db.transaction() as conn:
        assert conn.execute(select(LoginAttemptRow.client_ip)).scalars().all() == []


def test_development_does_not_install_the_peer_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontotator.api.server import app_from_env

    env = real_env(tmp_path, database_url_for(tmp_path / "db"))
    env["ONTOTATOR_ENV"] = "development"
    install_env(monkeypatch, env)
    api = app_from_env()
    client = TestClient(
        api, client=("10.0.0.3", 1234), base_url="https://editor.example.org"
    )
    assert client.get("/livez").status_code == 200


def test_production_cli_forces_validation_and_factory_workers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = production_env(tmp_path)
    env["ONTOTATOR_ENV"] = "development"
    install_env(monkeypatch, env)
    run = Mock()
    monkeypatch.setattr("ontotator.cli.uvicorn.run", run)
    result = CliRunner().invoke(
        cli_app, ["serve", "--production", "--host", "127.0.0.9", "--port", "9001"]
    )
    assert result.exit_code == 0, result.output
    run.assert_called_once_with(
        "ontotator.api.server:app_from_env",
        factory=True,
        host="0.0.0.0",
        port=8000,
        workers=2,
        proxy_headers=False,
        access_log=True,
        timeout_graceful_shutdown=30,
    )
    assert os.environ["ONTOTATOR_ENV"] == "production"
    monkeypatch.delenv("ONTOTATOR_PUBLIC_ORIGIN")
    run.reset_mock()
    result = CliRunner().invoke(cli_app, ["serve", "--production"])
    assert result.exit_code == 1
    assert "ONTOTATOR_PUBLIC_ORIGIN" in result.output
    run.assert_not_called()


def test_production_pending_schema_exposes_only_unready_health(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontotator.api.server import app_from_env

    install_env(
        monkeypatch, real_env(tmp_path, unmigrated_database_url(tmp_path / "db"))
    )
    api = app_from_env()
    with TestClient(
        api, client=("127.0.0.1", 1234), base_url="https://editor.example.org"
    ) as client:
        assert client.get("/livez").status_code == 200
        response = client.get("/readyz")
        assert response.status_code == 503
        assert response.json()["checks"] == {
            "database": True,
            "schema": False,
            "ontologies": False,
        }
        assert client.get("/").status_code == 404
        assert client.post("/api/v1/auth/login").status_code == 401
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404
        assert not hasattr(api.state, "accounts")
    assert api.state.draining is True


def test_production_database_outage_exits_without_leaking_the_dsn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontotator.api.server import app_from_env

    env = production_env(tmp_path)
    env["ONTOTATOR_DATABASE_URL"] = (
        "postgresql://ontotator_app@127.0.0.1:1/app?connect_timeout=1"
    )
    install_env(monkeypatch, env)
    with pytest.raises(RuntimeError, match="Database unavailable") as exc:
        app_from_env()
    # The supervisor restarts the process; the log shows no host, user or chain.
    assert exc.value.__suppress_context__ and exc.value.__cause__ is None
    for secret in ("ontotator_app", "127.0.0.1", "test-only-password"):
        assert secret not in str(exc.value)


def test_development_factory_keeps_docs_and_rejects_pending_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontotator.api.server import app_from_env
    from ontotator.domain.errors import DomainError

    env = real_env(tmp_path, database_url_for(tmp_path / "db"))
    env["ONTOTATOR_ENV"] = "development"
    del env["ONTOTATOR_PUBLIC_ORIGIN"]
    del env["ONTOTATOR_TRUSTED_PROXIES"]
    install_env(monkeypatch, env)
    api = app_from_env()
    client = TestClient(api, base_url="http://localhost")
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert api.state.config.host == "0.0.0.0"
    monkeypatch.setenv(
        "ONTOTATOR_DATABASE_URL",
        make_url(unmigrated_database_url(tmp_path / "pending"))
        ._replace(password=None)
        .render_as_string(),
    )
    with pytest.raises(DomainError, match="DATABASE_NOT_MIGRATED"):
        app_from_env()
