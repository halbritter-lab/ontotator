"""Settings from the environment: secrets and the database URL."""

from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from ontocurator import settings
from ontocurator.settings import SettingsError, database_url, read_secret


def test_a_secret_comes_from_the_variable(tmp_path: Path) -> None:
    assert read_secret("X", {"X": "value"}) == "value"


def test_a_secret_comes_from_its_file_without_the_line_end(tmp_path: Path) -> None:
    secret = tmp_path / "x"
    secret.write_text("value\n", encoding="utf-8")

    assert read_secret("X", {"X_FILE": str(secret)}) == "value"


def test_a_missing_secret_is_none() -> None:
    assert read_secret("X", {}) is None


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"X": "a", "X_FILE": "b"}, "Set only one of X and X_FILE"),
        ({"X": ""}, "X must not be empty"),
        ({"X_FILE": "/does/not/exist"}, "Unable to read X_FILE"),
    ],
)
def test_contradictory_or_unreadable_secrets_are_refused(
    env: dict[str, str], message: str
) -> None:
    with pytest.raises(SettingsError, match=message):
        read_secret("X", env)


def test_an_empty_secret_file_is_refused(tmp_path: Path) -> None:
    secret = tmp_path / "x"
    secret.write_text("\n", encoding="utf-8")

    with pytest.raises(SettingsError, match="X_FILE is empty"):
        read_secret("X", {"X_FILE": str(secret)})


def test_the_database_password_is_read_from_its_file(tmp_path: Path) -> None:
    secret = tmp_path / "pw"
    secret.write_text("s3cret\n", encoding="utf-8")
    env = {
        "ONTOCURATOR_DATABASE_URL": "postgresql://ontocurator_app@db:5432/ontocurator",
        "ONTOCURATOR_DATABASE_PASSWORD_FILE": str(secret),
    }

    url = database_url(env)

    assert url.drivername == "postgresql+psycopg"
    assert url.username == "ontocurator_app"
    assert url.password == "s3cret"
    assert url.host == "db"


def test_a_password_in_the_url_and_a_password_setting_conflict() -> None:
    env = {
        "ONTOCURATOR_DATABASE_URL": "postgresql://u:pw@db/x",
        "ONTOCURATOR_DATABASE_PASSWORD": "other",
    }

    with pytest.raises(SettingsError, match="already contains a password"):
        database_url(env)


@pytest.mark.parametrize(
    "env",
    [{}, {"ONTOCURATOR_DATABASE_URL": "sqlite:///x.db"}],
)
def test_only_postgresql_urls_are_accepted(env: dict[str, str]) -> None:
    with pytest.raises(SettingsError):
        database_url(env)


def test_the_migration_url_has_its_own_prefix() -> None:
    env = {"ONTOCURATOR_MIGRATION_DATABASE_URL": "postgresql://owner@db/x"}

    assert database_url(env, prefix="ONTOCURATOR_MIGRATION_DATABASE").username == (
        "owner"
    )


def test_an_explicit_url_wins_over_the_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "database_url_provider", lambda _ws: "from-provider")
    explicit = "postgresql+psycopg://u:pw@db/x"

    assert settings.resolve_database_url(explicit, None, {}) == explicit
    assert settings.resolve_database_url(None, Path("ws"), {}) == "from-provider"


def test_an_explicit_url_takes_the_password_from_its_file(tmp_path: Path) -> None:
    secret = tmp_path / "pw"
    secret.write_text("s3cret\n", encoding="utf-8")
    env = {"ONTOCURATOR_DATABASE_PASSWORD_FILE": str(secret)}

    resolved = settings.resolve_database_url("postgresql://u@db/x", None, env)

    url = make_url(resolved)
    assert url.drivername == "postgresql+psycopg"
    assert (url.username, url.password, url.host) == ("u", "s3cret", "db")


@pytest.mark.parametrize(
    ("explicit", "env", "message"),
    [
        ("sqlite:///x.db", {}, "must be a postgresql:// URL"),
        ("not a url with secret-pw", {}, "is not a valid URL"),
        (
            "postgresql://u:pw@db/x",
            {"ONTOCURATOR_DATABASE_PASSWORD": "other"},
            "already contains a password",
        ),
    ],
)
def test_an_explicit_url_follows_the_same_rules(
    explicit: str, env: dict[str, str], message: str
) -> None:
    with pytest.raises(SettingsError, match=message) as info:
        settings.resolve_database_url(explicit, None, env)
    assert "secret-pw" not in str(info.value)


def test_a_malformed_url_is_refused_without_echoing_it() -> None:
    raw = "not a url with secret-pw"
    with pytest.raises(
        SettingsError, match="ONTOCURATOR_DATABASE_URL is not a valid URL"
    ) as info:
        database_url({"ONTOCURATOR_DATABASE_URL": raw})
    assert "secret-pw" not in str(info.value)
    assert info.value.__cause__ is None
    assert info.value.__suppress_context__


@pytest.mark.parametrize(
    ("value", "origin"),
    [
        ("https://editor.example", "https://editor.example"),
        ("HTTPS://Editor.Example:443/", "https://editor.example"),
        ("http://localhost:8000", "http://localhost:8000"),
        ("http://[::1]:80", "http://[::1]"),
    ],
)
def test_a_public_origin_is_made_canonical(value: str, origin: str) -> None:
    assert settings.canonical_origin(value) == origin


@pytest.mark.parametrize(
    "value",
    [
        "editor.example",
        "ftp://editor.example",
        "https://",
        "https://editor.example/app",
        "https://editor.example?x=1",
        "https://editor.example#top",
        "https://user:pw@editor.example",
        "https://editor.example:99999",
    ],
)
def test_a_public_origin_is_only_scheme_host_and_port(value: str) -> None:
    with pytest.raises(SettingsError, match="public origin"):
        settings.canonical_origin(value)
