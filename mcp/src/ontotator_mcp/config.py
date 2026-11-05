"""Settings from the environment: which server, which token, how long to wait."""

from __future__ import annotations

import ipaddress
import math
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from urllib.parse import urlsplit

URL_VARIABLE = "ONTOTATOR_URL"
TOKEN_VARIABLE = "ONTOTATOR_TOKEN"
ALLOW_HTTP_VARIABLE = "ONTOTATOR_ALLOW_HTTP"
TIMEOUT_VARIABLE = "ONTOTATOR_TIMEOUT"
JOB_TIMEOUT_VARIABLE = "ONTOTATOR_JOB_TIMEOUT"


class ConfigError(ValueError):
    """The environment does not describe a usable server and token."""


def _loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _seconds(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number of seconds.") from None
    if not math.isfinite(value) or value <= 0:
        raise ConfigError(f"{name} must be a positive, finite number of seconds.")
    return value


@dataclass(frozen=True)
class Settings:
    """Where the Ontotator instance is and the API token to use there.

    The token never appears in ``repr`` or in any message.
    """

    url: str
    token: str = field(repr=False)
    timeout: float = 60.0
    job_timeout: float = 900.0
    poll_interval: float = 1.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if env is None else env
        url = env.get(URL_VARIABLE, "").strip().rstrip("/")
        token = env.get(TOKEN_VARIABLE, "").strip()
        if not url:
            raise ConfigError(
                f"Set {URL_VARIABLE} to the address of the Ontotator instance,"
                " for example https://ontotator.example.org."
            )
        if not token:
            raise ConfigError(
                f"Set {TOKEN_VARIABLE} to an API token of that instance"
                " (Profile > API tokens in Ontotator)."
            )
        if any(char.isspace() for char in token):
            raise ConfigError(
                f"{TOKEN_VARIABLE} contains whitespace; paste the token alone."
            )
        try:
            parts = urlsplit(url)
            hostname = parts.hostname
        except ValueError:
            raise ConfigError(f"{URL_VARIABLE} is not a valid URL.") from None
        if parts.scheme not in ("http", "https") or not hostname:
            raise ConfigError(f"{URL_VARIABLE} must be an http(s) URL with a host.")
        if parts.query or parts.fragment:
            raise ConfigError(f"{URL_VARIABLE} must not have a query or fragment.")
        if "@" in parts.netloc:
            raise ConfigError(
                f"{URL_VARIABLE} must not contain a user name or password; the"
                f" API token in {TOKEN_VARIABLE} is the only credential."
            )
        allow_http = env.get(ALLOW_HTTP_VARIABLE, "").strip() == "1"
        if parts.scheme == "http" and not _loopback(hostname) and not allow_http:
            raise ConfigError(
                f"{URL_VARIABLE} uses plain http to another host, which would send"
                f" the token unencrypted. Use https, or set {ALLOW_HTTP_VARIABLE}=1"
                " for a trusted network."
            )
        return cls(
            url=url,
            token=token,
            timeout=_seconds(env, TIMEOUT_VARIABLE, 60.0),
            job_timeout=_seconds(env, JOB_TIMEOUT_VARIABLE, 900.0),
        )
