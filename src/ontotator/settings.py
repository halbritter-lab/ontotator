"""Server settings from the environment.

Secrets are read from ``NAME`` or from the file named by ``NAME_FILE``, never
from both. The Docker service contract uses only the file form (T2 D1).
"""

from __future__ import annotations

import ipaddress
import json
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError


class SettingsError(ValueError):
    """A setting is missing, contradictory or unreadable."""


@dataclass(frozen=True)
class ServerSettings:
    """Validated runtime settings; secret-bearing fields are never repr'd."""

    environment: str
    data_dir: Path
    public_origin: str | None
    trusted_proxies: tuple[str, ...]
    workers: int
    admin_password_hash: str | None = field(repr=False)
    database_url: URL = field(repr=False)


def server_settings(env: Mapping[str, str] | None = None) -> ServerSettings:
    """Read application settings only, without migration/owner credentials."""
    env = os.environ if env is None else env
    environment = env.get("ONTOTATOR_ENV", "development")
    if environment not in ("development", "production"):
        raise SettingsError("ONTOTATOR_ENV must be development or production")
    production = environment == "production"
    raw_origin = env.get("ONTOTATOR_PUBLIC_ORIGIN")
    origin = None
    if raw_origin is not None:
        try:
            origin = canonical_origin(raw_origin)
        except SettingsError as exc:
            raise SettingsError(f"ONTOTATOR_PUBLIC_ORIGIN: {exc}") from None
    if production and (origin is None or not origin.startswith("https://")):
        raise SettingsError("ONTOTATOR_PUBLIC_ORIGIN must be an https:// origin")
    raw_proxies = env.get("ONTOTATOR_TRUSTED_PROXIES", "")
    proxies: tuple[str, ...] = ()
    if raw_proxies:
        try:
            proxies = tuple(
                str(ipaddress.ip_address(ip.strip())) for ip in raw_proxies.split(",")
            )
        except ValueError:
            raise SettingsError(
                "ONTOTATOR_TRUSTED_PROXIES must contain exact IP addresses"
            ) from None
    if production and not proxies:
        raise SettingsError("ONTOTATOR_TRUSTED_PROXIES is required in production")
    try:
        workers = int(env.get("ONTOTATOR_WORKERS", "2"))
    except ValueError:
        raise SettingsError(
            "ONTOTATOR_WORKERS must be an integer from 1 to 16"
        ) from None
    if not 1 <= workers <= 16:
        raise SettingsError("ONTOTATOR_WORKERS must be an integer from 1 to 16")
    if production:
        for name in (
            "ONTOTATOR_DATABASE_PASSWORD",
            "ONTOTATOR_ADMIN_PASSWORD_HASH",
        ):
            if name in env:
                raise SettingsError(f"{name} must come from {name}_FILE in production")
        # Check before adding a file password: authority and query passwords
        # are plaintext secrets. Psycopg query options override URL credentials;
        # SQLAlchemy decodes query keys, including percent-encoded "password".
        raw_url = env.get("ONTOTATOR_DATABASE_URL", "")
        try:
            parsed_url = make_url(raw_url)
        except ArgumentError:
            raise SettingsError("ONTOTATOR_DATABASE_URL is not a valid URL") from None
        if parsed_url.password is not None or "password" in parsed_url.query:
            raise SettingsError(
                "ONTOTATOR_DATABASE_URL must not contain a password; use ONTOTATOR_DATABASE_PASSWORD_FILE"
            )
    url = database_url(env)
    return ServerSettings(
        environment=environment,
        data_dir=Path(env.get("ONTOTATOR_DATA_DIR", "/data" if production else "data")),
        public_origin=origin,
        trusted_proxies=proxies,
        workers=workers,
        admin_password_hash=read_secret("ONTOTATOR_ADMIN_PASSWORD_HASH", env),
        database_url=url,
    )


DEMO_LOGINS_ENV = "ONTOTATOR_DEMO_LOGINS_FILE"
MAX_DEMO_LOGINS = 20


@dataclass(frozen=True)
class DemoLogin:
    """A one-click login offered on the login page of a loopback demo stack."""

    username: str
    password: str = field(repr=False)
    label: str = ""


def is_loopback_host(host: str) -> bool:
    """``localhost`` or a loopback IP address (``[::1]`` brackets allowed)."""
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def demo_logins(
    env: Mapping[str, str] | None = None,
    *,
    public_origin: str | None,
    bind_host: str | None = None,
) -> tuple[DemoLogin, ...]:
    """The demo accounts from ``ONTOTATOR_DEMO_LOGINS_FILE``; () when unset.

    DEMO ONLY: their passwords are sent to every browser that opens the login
    page. The file holds a JSON list of ``{"username", "password", "label"}``
    objects. Refused in production, with a public origin that is not a
    loopback address, and when the server binds a non-loopback address
    (``bind_host``; a container binds 0.0.0.0, so it is checked only when
    given).

    Raises:
        SettingsError: for a refused setting or an unreadable/invalid file.
    """
    env = os.environ if env is None else env
    path = env.get(DEMO_LOGINS_ENV)
    if path is None:
        return ()
    if env.get("ONTOTATOR_ENV", "development") == "production":
        raise SettingsError(f"{DEMO_LOGINS_ENV} must never be set in production")
    origin_host = urlsplit(public_origin).hostname if public_origin else None
    if origin_host is not None and not is_loopback_host(origin_host):
        raise SettingsError(
            f"{DEMO_LOGINS_ENV} needs a loopback public origin, not {public_origin}"
        )
    if bind_host is not None and not is_loopback_host(bind_host):
        raise SettingsError(
            f"{DEMO_LOGINS_ENV} needs a loopback address to bind, not {bind_host}"
        )
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise SettingsError(
            f"Unable to read {DEMO_LOGINS_ENV}: {exc.strerror or exc}"
        ) from exc
    except ValueError:
        raise SettingsError(f"{DEMO_LOGINS_ENV} is not valid JSON") from None
    problem = (
        f"{DEMO_LOGINS_ENV} must hold a list of 1 to {MAX_DEMO_LOGINS} objects "
        'with non-empty "username" and "password" strings and an optional "label"'
    )
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_DEMO_LOGINS:
        raise SettingsError(problem)
    logins: list[DemoLogin] = []
    for entry in raw:
        if not isinstance(entry, dict) or set(entry) - {
            "username",
            "password",
            "label",
        }:
            raise SettingsError(problem)
        username, password = entry.get("username"), entry.get("password")
        label = entry.get("label", "")
        if not (
            isinstance(username, str)
            and username.strip()
            and isinstance(password, str)
            and password
            and isinstance(label, str)
        ):
            raise SettingsError(problem)
        logins.append(DemoLogin(username.strip(), password, label.strip()))
    return tuple(logins)


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
    env: Mapping[str, str] | None = None, *, prefix: str = "ONTOTATOR_DATABASE"
) -> URL:
    """``<prefix>_URL`` with the password of ``<prefix>_PASSWORD[_FILE]``.

    The application uses ``ONTOTATOR_DATABASE`` (role ``ontotator_app``),
    migrations use ``ONTOTATOR_MIGRATION_DATABASE`` (role
    ``ontotator_owner``).
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
    ``ONTOTATOR_DATABASE_URL``: PostgreSQL only, and the password may come
    from ``ONTOTATOR_DATABASE_PASSWORD[_FILE]`` instead of the command line.
    """
    if not explicit:
        return database_url_provider(workspace)
    env = os.environ if env is None else env
    url = _complete_url(explicit, "The database URL", env, "ONTOTATOR_DATABASE")
    return url.render_as_string(hide_password=False)
