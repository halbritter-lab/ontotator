"""Server settings from the environment.

Secrets are read from ``NAME`` or from the file named by ``NAME_FILE``, never
from both. The Docker service contract uses only the file form (T2 D1).
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from pathlib import Path

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


class SettingsError(ValueError):
    """A setting is missing, contradictory or unreadable."""


def read_secret(name: str, env: Mapping[str, str] | None = None) -> str | None:
    """``NAME`` or the content of ``NAME_FILE`` without its line end, or None."""
    env = os.environ if env is None else env
    direct = env.get(name)
    path = env.get(f"{name}_FILE")
    if direct is not None and path is not None:
        raise SettingsError(f"Set only one of {name} and {name}_FILE")
    if direct is not None:
        if not direct:
            raise SettingsError(f"{name} must not be empty")
        return direct
    if path is None:
        return None
    try:
        value = Path(path).read_text(encoding="utf-8").rstrip("\r\n")
    except OSError as exc:
        raise SettingsError(
            f"Unable to read {name}_FILE: {exc.strerror or exc}"
        ) from exc
    if not value:
        raise SettingsError(f"{name}_FILE is empty")
    return value


def database_url(
    env: Mapping[str, str] | None = None, *, prefix: str = "ONTOCURATOR_DATABASE"
) -> URL:
    """``<prefix>_URL`` with the password of ``<prefix>_PASSWORD[_FILE]``.

    The application uses ``ONTOCURATOR_DATABASE`` (role ``ontocurator_app``),
    migrations use ``ONTOCURATOR_MIGRATION_DATABASE`` (role
    ``ontocurator_owner``).
    """
    env = os.environ if env is None else env
    raw = env.get(f"{prefix}_URL")
    if not raw:
        raise SettingsError(f"{prefix}_URL is not set")
    try:
        url = make_url(raw)
    except ArgumentError:
        raise SettingsError(f"{prefix}_URL is not a valid URL") from None
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    if url.drivername != "postgresql+psycopg":
        raise SettingsError(f"{prefix}_URL must be a postgresql:// URL")
    has_setting = f"{prefix}_PASSWORD" in env or f"{prefix}_PASSWORD_FILE" in env
    if url.password is not None and has_setting:
        raise SettingsError(f"{prefix}_URL already contains a password")
    password = read_secret(f"{prefix}_PASSWORD", env)
    if password is not None:
        url = url.set(password=password)
    return url


def _from_environment(_workspace: Path | None) -> str:
    return database_url().render_as_string(hide_password=False)


# Where a database URL comes from when none is given explicitly. Tests replace
# it (tests/conftest.py) so that every app and CLI call gets its own database.
database_url_provider: Callable[[Path | None], str] = _from_environment


def resolve_database_url(explicit: str | None, workspace: Path | None) -> str:
    """The explicit URL, else the provider's URL for this workspace."""
    return explicit or database_url_provider(workspace)
