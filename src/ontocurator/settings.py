"""Server settings from the environment.

Secrets are read from ``NAME`` or from the file named by ``NAME_FILE``, never
from both. The Docker service contract uses only the file form (T2 D1).
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from pathlib import Path
from urllib.parse import urlsplit

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


def ascii_host(name: str) -> str:
    """A host name as browsers send it: lower-case, IDN labels in punycode.

    Raises:
        SettingsError: for a name IDNA cannot encode.
    """
    lowered = name.strip().lower()
    if lowered.isascii():
        return lowered
    try:
        return lowered.encode("idna").decode("ascii")
    except UnicodeError:
        raise SettingsError(f"The host name '{name}' is not valid") from None


def canonical_origin(value: str) -> str:
    """``scheme://host[:port]`` of a public origin such as ``https://ex.org``.

    The scheme and host are lower-cased, an internationalised host is
    written in punycode and a default port is dropped, so the result equals
    the ``Origin`` header a browser sends for that site. A
    trailing ``/`` is accepted; any other path, a query, a fragment or
    credentials are not.

    Raises:
        SettingsError: for anything else.
    """
    problem = "must be an http(s) origin like https://editor.example.org"
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError:
        raise SettingsError(f"The public origin {problem}") from None
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
        or "?" in value
        or "#" in value
    ):
        raise SettingsError(f"The public origin {problem}")
    host = parts.hostname
    if ":" in host:
        host = f"[{host}]"
    else:
        try:
            host = ascii_host(host)
        except SettingsError:
            raise SettingsError(f"The public origin {problem}") from None
    default_port = 443 if parts.scheme == "https" else 80
    suffix = "" if port in (None, default_port) else f":{port}"
    return f"{parts.scheme}://{host}{suffix}"


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
    return _complete_url(raw, f"{prefix}_URL", env, prefix)


def _complete_url(raw: str, name: str, env: Mapping[str, str], prefix: str) -> URL:
    """Parse a PostgreSQL URL and add the password of ``<prefix>_PASSWORD[_FILE]``.

    ``name`` names the URL's source in errors; the URL itself is never echoed,
    since it may contain a password.
    """
    try:
        url = make_url(raw)
    except ArgumentError:
        raise SettingsError(f"{name} is not a valid URL") from None
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    if url.drivername != "postgresql+psycopg":
        raise SettingsError(f"{name} must be a postgresql:// URL")
    has_setting = f"{prefix}_PASSWORD" in env or f"{prefix}_PASSWORD_FILE" in env
    if url.password is not None and has_setting:
        raise SettingsError(f"{name} already contains a password")
    password = read_secret(f"{prefix}_PASSWORD", env)
    if password is not None:
        url = url.set(password=password)
    return url


def _from_environment(_workspace: Path | None) -> str:
    return database_url().render_as_string(hide_password=False)


# Where a database URL comes from when none is given explicitly. Tests replace
# it (tests/conftest.py) so that every app and CLI call gets its own database.
database_url_provider: Callable[[Path | None], str] = _from_environment


def resolve_database_url(
    explicit: str | None,
    workspace: Path | None,
    env: Mapping[str, str] | None = None,
) -> str:
    """The explicit URL, else the provider's URL for this workspace.

    An explicit URL (``--database-url``) follows the rules of
    ``ONTOCURATOR_DATABASE_URL``: PostgreSQL only, and the password may come
    from ``ONTOCURATOR_DATABASE_PASSWORD[_FILE]`` instead of the command line.
    """
    if not explicit:
        return database_url_provider(workspace)
    env = os.environ if env is None else env
    url = _complete_url(explicit, "The database URL", env, "ONTOCURATOR_DATABASE")
    return url.render_as_string(hide_password=False)
