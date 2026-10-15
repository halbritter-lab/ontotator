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
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from ontocurator import settings
from ontocurator.cli import app as cli_app
from ontocurator.storage.tables import LoginAttemptRow


def production_env(tmp_path: Path) -> dict[str, str]:
    secret = tmp_path / "password"
    secret.write_text("test-only-password\n", encoding="utf-8")
    return {
        "ONTOCURATOR_ENV": "production",
        "ONTOCURATOR_PUBLIC_ORIGIN": "https://editor.example.org",
        "ONTOCURATOR_TRUSTED_PROXIES": "10.0.0.2, ::1",
        "ONTOCURATOR_DATABASE_URL": "postgresql://ontocurator_app@db/ontocurator",
        "ONTOCURATOR_DATABASE_PASSWORD_FILE": str(secret),
        "ONTOCURATOR_DATA_DIR": str(tmp_path / "data"),
    }


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("ONTOCURATOR_PUBLIC_ORIGIN", None),
        ("ONTOCURATOR_PUBLIC_ORIGIN", "http://editor.example.org"),
        ("ONTOCURATOR_PUBLIC_ORIGIN", "https://editor.example.org/path"),
        ("ONTOCURATOR_TRUSTED_PROXIES", None),
        ("ONTOCURATOR_TRUSTED_PROXIES", "*"),
        ("ONTOCURATOR_TRUSTED_PROXIES", "10.0.0.0/24"),
        ("ONTOCURATOR_TRUSTED_PROXIES", "proxy.example.org"),
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
    del env["ONTOCURATOR_DATABASE_PASSWORD_FILE"]
    if embedded:
        env["ONTOCURATOR_DATABASE_URL"] = "postgresql://ontocurator_app:secret@db/app"
    else:
        env["ONTOCURATOR_DATABASE_PASSWORD"] = "secret"
    with pytest.raises(settings.SettingsError, match="ONTOCURATOR_DATABASE"):
        settings.server_settings(env)


def test_production_refuses_direct_admin_hash(tmp_path: Path) -> None:
    env = production_env(tmp_path)
    env["ONTOCURATOR_ADMIN_PASSWORD_HASH"] = "secret-hash"
    with pytest.raises(settings.SettingsError, match="ONTOCURATOR_ADMIN_PASSWORD_HASH"):
        settings.server_settings(env)


def test_development_defaults() -> None:
    result = settings.server_settings(
        {"ONTOCURATOR_DATABASE_URL": "postgresql://ontocurator_app@db/app"}
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
    del env["ONTOCURATOR_DATA_DIR"]
    env["ONTOCURATOR_PUBLIC_ORIGIN"] = "https://Editor.Example.Org:443/"
    env["ONTOCURATOR_WORKERS"] = "16"
    admin_file = tmp_path / "admin"
    admin_file.write_text("hash-from-file\n", encoding="utf-8")
    env["ONTOCURATOR_ADMIN_PASSWORD_HASH_FILE"] = str(admin_file)
    env["ONTOCURATOR_MIGRATION_DATABASE_URL"] = "invalid URL deliberately ignored"
    env["ONTOCURATOR_MIGRATION_DATABASE_PASSWORD_FILE"] = "/does/not/exist"
    result = settings.server_settings(env)
    assert result.data_dir == Path("/data")
    assert result.public_origin == "https://editor.example.org"
    assert result.trusted_proxies == ("10.0.0.2", "::1")
    assert result.workers == 16
    assert result.admin_password_hash == "hash-from-file"
    assert result.database_url.password == "test-only-password"
    assert "hash-from-file" not in repr(result)
    assert "test-only-password" not in repr(result)


def test_unknown_environment_is_refused() -> None:
    with pytest.raises(settings.SettingsError, match="ONTOCURATOR_ENV"):
        settings.server_settings({"ONTOCURATOR_ENV": "prod"})


@pytest.mark.parametrize("workers", ["0", "17", "abc"])
def test_worker_count_is_bounded(tmp_path: Path, workers: str) -> None:
    env = production_env(tmp_path)
    env["ONTOCURATOR_WORKERS"] = workers
    with pytest.raises(settings.SettingsError, match="ONTOCURATOR_WORKERS"):
        settings.server_settings(env)


def install_env(monkeypatch: pytest.MonkeyPatch, env: dict[str, str]) -> None:
    for name in list(os.environ):
        if name.startswith("ONTOCURATOR_") and name != "ONTOCURATOR_TEST_PG_URL":
            monkeypatch.delenv(name)
    for name, value in env.items():
        monkeypatch.setenv(name, value)


def real_env(tmp_path: Path, url: str) -> dict[str, str]:
    env = production_env(tmp_path)
    parsed = make_url(url)
    env["ONTOCURATOR_DATABASE_URL"] = parsed._replace(password=None).render_as_string()
    return env


def test_app_from_env_hides_the_api_docs_in_production(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.api.server import app_from_env

    install_env(monkeypatch, real_env(tmp_path, database_url_for(tmp_path / "db")))
    api = app_from_env()
    client = TestClient(api, base_url="https://editor.example.org")
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
    assert client.get("/livez").status_code == 200
    assert client.get("/api/v1/ontologies").status_code == 401
    assert api.state.config.host == "0.0.0.0"
    assert client.get("/livez", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/livez", headers={"host": "127.0.0.1"}).status_code == 200


@pytest.mark.parametrize(
    ("peer", "expected"), [("10.0.0.2", "198.51.100.7"), ("10.0.0.3", "10.0.0.3")]
)
def test_forwarded_addresses_are_used_only_from_trusted_proxies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, peer: str, expected: str
) -> None:
    from ontocurator.api.server import app_from_env

    env = real_env(tmp_path, database_url_for(tmp_path / "db"))
    install_env(monkeypatch, env)
    api = app_from_env()
    wrapped = ProxyHeadersMiddleware(
        api, trusted_hosts=",".join(settings.server_settings(env).trusted_proxies)
    )
    client = TestClient(
        wrapped, client=(peer, 1234), base_url="https://editor.example.org"
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "unknown", "password": "wrong"},
        headers={
            "Origin": env["ONTOCURATOR_PUBLIC_ORIGIN"],
            "X-Forwarded-For": "198.51.100.7",
        },
    )
    assert response.status_code == 401
    with api.state.repo.db.transaction() as conn:
        assert conn.execute(select(LoginAttemptRow.client_ip)).scalars().all() == [
            expected
        ]


def test_production_cli_forces_validation_and_factory_workers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = production_env(tmp_path)
    env["ONTOCURATOR_ENV"] = "development"
    install_env(monkeypatch, env)
    run = Mock()
    monkeypatch.setattr("ontocurator.cli.uvicorn.run", run)
    result = CliRunner().invoke(
        cli_app, ["serve", "--production", "--host", "127.0.0.9", "--port", "9001"]
    )
    assert result.exit_code == 0, result.output
    run.assert_called_once_with(
        "ontocurator.api.server:app_from_env",
        factory=True,
        host="0.0.0.0",
        port=8000,
        workers=2,
        proxy_headers=True,
        forwarded_allow_ips="10.0.0.2,::1",
        access_log=True,
        timeout_graceful_shutdown=30,
    )
    assert os.environ["ONTOCURATOR_ENV"] == "production"
    monkeypatch.delenv("ONTOCURATOR_PUBLIC_ORIGIN")
    run.reset_mock()
    result = CliRunner().invoke(cli_app, ["serve", "--production"])
    assert result.exit_code == 1
    assert "ONTOCURATOR_PUBLIC_ORIGIN" in result.output
    run.assert_not_called()


def test_production_pending_schema_exposes_only_unready_health(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.api.server import app_from_env

    install_env(
        monkeypatch, real_env(tmp_path, unmigrated_database_url(tmp_path / "db"))
    )
    api = app_from_env()
    with TestClient(api, base_url="https://editor.example.org") as client:
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


def test_production_database_outage_exposes_only_unready_health(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.api.server import app_from_env

    env = production_env(tmp_path)
    env["ONTOCURATOR_DATABASE_URL"] = (
        "postgresql://ontocurator_app@127.0.0.1:1/app?connect_timeout=1"
    )
    install_env(monkeypatch, env)
    api = app_from_env()
    client = TestClient(api, base_url="https://editor.example.org")
    assert client.get("/livez").status_code == 200
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json() == {
        "ok": False,
        "checks": {"database": False, "schema": False, "ontologies": False},
    }
    assert client.get("/").status_code == 404


def test_development_factory_keeps_docs_and_rejects_pending_schema(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ontocurator.api.server import app_from_env
    from ontocurator.domain.errors import DomainError

    env = real_env(tmp_path, database_url_for(tmp_path / "db"))
    env["ONTOCURATOR_ENV"] = "development"
    del env["ONTOCURATOR_PUBLIC_ORIGIN"]
    del env["ONTOCURATOR_TRUSTED_PROXIES"]
    install_env(monkeypatch, env)
    api = app_from_env()
    client = TestClient(api, base_url="http://localhost")
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert api.state.config.host == "0.0.0.0"
    monkeypatch.setenv(
        "ONTOCURATOR_DATABASE_URL",
        make_url(unmigrated_database_url(tmp_path / "pending"))
        ._replace(password=None)
        .render_as_string(),
    )
    with pytest.raises(DomainError, match="DATABASE_NOT_MIGRATED"):
        app_from_env()
