"""Production peer check: only the trusted reverse proxy and loopback may connect.

In production the app has no published port; every request comes from the
reverse proxy (``ONTOTATOR_TRUSTED_PROXIES``) or from inside the container
(the Docker health check on 127.0.0.1). If the proxy is recreated with
another address, uvicorn's own proxy handling would silently ignore its
``X-Forwarded-For`` and count every user under the proxy's address for the
login lockout, so one burst of failed logins would lock everyone out. This
middleware refuses such requests with 503 and logs why, so a changed proxy
address shows up as an outage with a clear cause instead.

It replaces uvicorn's ``--proxy-headers`` handling, which ``serve
--production`` switches off: the check needs the TCP peer, which uvicorn's
middleware overwrites.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from collections.abc import Iterable
from typing import Any, cast

from starlette.types import ASGIApp, Receive, Scope, Send
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

logger = logging.getLogger(__name__)

# One log line per refused peer address and interval, so a misrouted flood
# cannot fill the rotated container log.
_LOG_INTERVAL_SECONDS = 60.0
_MAX_REMEMBERED_PEERS = 256

_BODY = (
    b"Service unavailable: the connecting reverse proxy is not trusted. "
    b"The operator must check ONTOTATOR_TRUSTED_PROXIES.\n"
)


def _ip(host: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    if not host:
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        return address.ipv4_mapped
    return address


class TrustedPeerGuard:
    """Apply forwarded headers from trusted proxies; refuse other remote peers.

    - Peer in ``trusted_proxies``: ``X-Forwarded-For``/``-Proto`` are applied
      (uvicorn's rules: the rightmost untrusted address is the client).
    - Loopback peer (health checks, in-container tools): passed through
      unchanged; forwarded headers are ignored.
    - Any other peer, or none: 503, never reaching the app or the login
      lockout.
    """

    def __init__(self, app: ASGIApp, trusted_proxies: Iterable[str]) -> None:
        addresses = [_ip(proxy.strip()) for proxy in trusted_proxies]
        if not addresses or None in addresses:
            raise ValueError("Trusted proxies must be one or more exact IP addresses")
        self.app = app
        self.trusted = frozenset(a for a in addresses if a is not None)
        self.forwarded: ASGIApp = cast(
            ASGIApp,
            ProxyHeadersMiddleware(
                cast(Any, app), trusted_hosts=",".join(str(a) for a in self.trusted)
            ),
        )
        self._logged: dict[str, float] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        host = client[0] if client else None
        peer = _ip(host)
        if peer is not None and peer in self.trusted:
            if host != str(peer):
                # ProxyHeadersMiddleware compares strings; use the normal form.
                scope["client"] = (str(peer), client[1] if client else 0)
            await self.forwarded(scope, receive, send)
            return
        if peer is not None and peer.is_loopback:
            await self.app(scope, receive, send)
            return
        self._log_refusal(host)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1013})
            return
        await send(
            {
                "type": "http.response.start",
                "status": 503,
                "headers": [
                    (b"content-type", b"text/plain; charset=utf-8"),
                    (b"content-length", str(len(_BODY)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": _BODY})

    def _log_refusal(self, host: str | None) -> None:
        key = host or "<none>"
        now = time.monotonic()
        last = self._logged.get(key)
        if last is not None and now - last < _LOG_INTERVAL_SECONDS:
            return
        if len(self._logged) >= _MAX_REMEMBERED_PEERS:
            self._logged.clear()
        self._logged[key] = now
        logger.error(
            "Refused a request from %s: not in ONTOTATOR_TRUSTED_PROXIES (%s) and "
            "not loopback. If this is the reverse proxy, its address changed: pin "
            "it on the shared network and set ONTOTATOR_TRUSTED_PROXIES to it "
            "(docs/operations.md, Reverse proxy settings).",
            key[:64],
            ", ".join(sorted(str(a) for a in self.trusted)),
        )
