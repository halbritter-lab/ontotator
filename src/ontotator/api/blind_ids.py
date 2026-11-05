"""Opaque identifiers for consolidators of projects that hide annotator names.

Issue 302 hides the authors of a consolidation round's inputs. Replacing the
author's pseudonym in a snapshot is not enough: the snapshot's ``version`` is
the SHA-256 of its canonical content, author included, and almost every other
identifier the consolidator reads is a hash over such a version (round input
ids and the ``input-…`` annotation and evidence ids, ``round-input:…`` source
refs, target snapshot versions, target set ids, decision ids, consolidated
annotation and group ids, evidence versions, manifests, ``sub-…`` submission
ids). With the members list, a consolidator could rehash the visible content
with each candidate pseudonym and find the author of every input.

So for such a consolidator every one of these hashes is opaque. This
middleware sits inside the session middleware and, for a user who holds the
adjudicator role (and not the lead role) in a project with
``blind_consolidation`` on:

* replaces every 64- and 16-hex-digit run in a JSON answer with ``z`` and a
  keyed permutation of it (same length), for example ``input-<h>-e0`` becomes
  ``input-z<p(h)>-e0``;
* maps every such token in a request (path, query and JSON body) back, for
  every logged-in user, so a page that loaded tokens keeps working when the
  setting changes.

The permutation is keyed per user from an instance secret kept in
``instance_state`` (created at the first start), so a token says nothing about the
value and cannot be recomputed. Hashes of public, author-independent content
keep their value: the text, ontology, layer, axes and scope hashes the page
compares with other answers. Document text is never touched (its offsets
must stay). Leads, system admins and files (exports, downloads) are
unchanged.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import hashlib
import hmac
import json
import re
import secrets
from collections.abc import Callable
from typing import Any

from sqlalchemy import Connection, and_, exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ontotator.auth.context import current_principal
from ontotator.auth.sessions import Principal
from ontotator.storage.tables import (
    InstanceStateRow,
    ProjectMembershipRow,
    ProjectRow,
)

KEY_NAME = "blind_consolidation_key"
# A hex run of a full SHA-256 or of a 16-digit id (``sub-``, ``cons-``,
# consolidation group ids), not part of a longer word.
_REAL = re.compile(r"(?<![0-9A-Za-z])([0-9a-f]{64}|[0-9a-f]{16})(?![0-9A-Za-z])")
_TOKEN = re.compile(r"(?<![0-9A-Za-z])z([0-9a-f]{64}|[0-9a-f]{16})(?![0-9A-Za-z])")
_REAL_BYTES = re.compile(_REAL.pattern.encode())
_TOKEN_BYTES = re.compile(_TOKEN.pattern.encode())
# Hashes of author-independent content, kept so the page can compare them
# with other answers (the document's text hash, ontology definitions).
PUBLIC_KEYS = frozenset(
    {
        "text_sha256",
        "ontology_sha256",
        "layer_config_sha256",
        "axes_config_sha256",
        "sha256",
        "scope_id",
        "csrf_token",
    }
)
# Text whose character offsets matter.
TEXT_KEYS = frozenset({"text"})
ROUNDS = 8


def instance_key(conn: Connection) -> bytes:
    """The instance's secret for opaque identifiers, created on first use."""
    conn.execute(
        pg_insert(InstanceStateRow)
        .values(key=KEY_NAME, value={"key": secrets.token_hex(32)})
        .on_conflict_do_nothing(index_elements=[InstanceStateRow.key])
    )
    value = conn.execute(
        select(InstanceStateRow.value).where(InstanceStateRow.key == KEY_NAME)
    ).scalar_one()
    return bytes.fromhex(value["key"])


def is_blinded(conn: Connection, principal: Principal) -> bool:
    """The user consolidates in a project that hides annotator names and
    does not lead it."""
    if principal.is_system_admin:
        return False
    lead = ProjectMembershipRow.__table__.alias("lead")
    return bool(
        conn.execute(
            select(
                exists().where(
                    ProjectMembershipRow.user_id == principal.user_id,
                    ProjectMembershipRow.role == "adjudicator",
                    ProjectRow.id == ProjectMembershipRow.project_id,
                    ProjectRow.blind_consolidation.is_(True),
                    ~exists().where(
                        and_(
                            lead.c.project_id == ProjectMembershipRow.project_id,
                            lead.c.user_id == principal.user_id,
                            lead.c.role == "lead",
                        )
                    ),
                )
            )
        ).scalar()
    )


class IdCipher:
    """A keyed permutation of hex ids (a balanced Feistel network over the
    id's bytes with HMAC-SHA256 rounds), one per user."""

    def __init__(self, secret: bytes, user_id: int) -> None:
        self._key = hmac.new(
            secret, f"blind-consolidation/v1|{user_id}".encode(), hashlib.sha256
        ).digest()

    def _round(self, size: int, index: int, half: bytes) -> bytes:
        message = bytes([size, index]) + half
        return hmac.new(self._key, message, hashlib.sha256).digest()[: len(half)]

    def seal(self, value: str) -> str:
        data = bytes.fromhex(value)
        n = len(data) // 2
        left, right = data[:n], data[n:]
        for index in range(ROUNDS):
            f = self._round(len(data), index, right)
            left, right = right, bytes(a ^ b for a, b in zip(left, f, strict=True))
        return "z" + (left + right).hex()

    def open(self, token: str) -> str:
        data = bytes.fromhex(token[1:] if token.startswith("z") else token)
        n = len(data) // 2
        left, right = data[:n], data[n:]
        for index in reversed(range(ROUNDS)):
            f = self._round(len(data), index, left)
            left, right = bytes(a ^ b for a, b in zip(right, f, strict=True)), left
        return (left + right).hex()

    def seal_text(self, text: str) -> str:
        return _REAL.sub(lambda m: self.seal(m.group(1)), text)

    def open_text(self, text: str) -> str:
        return _TOKEN.sub(lambda m: self.open(m.group(1)), text)

    def seal_bytes(self, raw: bytes) -> bytes:
        return _REAL_BYTES.sub(lambda m: self.seal(m.group(1).decode()).encode(), raw)

    def open_bytes(self, raw: bytes) -> bytes:
        return _TOKEN_BYTES.sub(lambda m: self.open(m.group(1).decode()).encode(), raw)

    def seal_json(self, value: Any) -> Any:
        return _walk(value, self.seal_text, self.seal_workspace)

    def open_json(self, value: Any) -> Any:
        return _walk(value, self.open_text, self.open_workspace)

    def seal_workspace(self, value: str) -> str:
        """A workspace id (its base64 key, which holds a target set id) with
        the key's hashes sealed."""
        key = _workspace_key(value)
        return value if key is None else _encode_key(self.seal_json(key))

    def open_workspace(self, value: str) -> str:
        key = _workspace_key(value)
        if key is None or not _TOKEN.search(json.dumps(key)):
            return value
        return _encode_key(self.open_json(key))

    def open_path(self, path: str) -> str:
        path = self.open_text(path)
        return _WORKSPACE_PATH.sub(
            lambda m: m.group(1) + self.open_workspace(m.group(2)), path
        )


# A workspace id in a path: ``/workspaces/<base64 of the key>``.
_WORKSPACE_PATH = re.compile(r"(/workspaces/)([A-Za-z0-9_-]{16,})")


def _workspace_key(value: str) -> dict[str, Any] | None:
    """The workspace key a workspace id encodes, or None."""
    try:
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        key = json.loads(raw)
    except (ValueError, binascii.Error):
        return None
    return key if isinstance(key, dict) else None


def _encode_key(key: dict[str, Any]) -> str:
    """As ``routes.encode_workspace_id`` encodes a key."""
    raw = json.dumps(key).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _walk(
    value: Any,
    change: Callable[[str], str],
    workspace: Callable[[str], str],
    key: str | None = None,
) -> Any:
    if isinstance(value, str):
        if key == "workspace_id":
            return workspace(value)
        if key in PUBLIC_KEYS or key in TEXT_KEYS:
            return value
        return change(value)
    if isinstance(value, list):
        return [_walk(item, change, workspace, key) for item in value]
    if isinstance(value, dict):
        return {change(k): _walk(v, change, workspace, k) for k, v in value.items()}
    return value


def _header(headers: list[tuple[bytes, bytes]], name: bytes) -> bytes | None:
    for key, value in headers:
        if key.lower() == name:
            return value
    return None


class BlindIdsMiddleware:
    """Opaque identifiers for a blinded consolidator (see the module doc)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        principal = scope.get("state", {}).get("principal") or current_principal.get(
            None
        )
        state = getattr(scope.get("app"), "state", None)
        repo = getattr(state, "repo", None)
        if not isinstance(principal, Principal) or repo is None:
            await self.app(scope, receive, send)
            return
        cipher, blinded = await run_in_threadpool(_lookup, state, repo, principal)
        scope = _open_scope(scope, cipher)
        receive = await _open_body(scope, receive, cipher)
        if not blinded or scope["path"].startswith("/api/v1/auth/"):
            await self.app(scope, receive, send)
            return
        await self.app(scope, receive, _sealing_send(send, cipher))


def _lookup(state: Any, repo: Any, principal: Principal) -> tuple[IdCipher, bool]:
    with repo.db.transaction() as conn:
        # Read at the app's start (``create_app``); created here only when an
        # app was built without it.
        secret = getattr(state, "blind_ids_key", None)
        if secret is None:
            secret = instance_key(conn)
            state.blind_ids_key = secret
        return IdCipher(secret, principal.user_id), is_blinded(conn, principal)


def _open_scope(scope: Scope, cipher: IdCipher) -> Scope:
    path = cipher.open_path(scope["path"])
    raw = scope.get("raw_path")
    query = scope.get("query_string", b"")
    opened_raw = (
        cipher.open_path(raw.decode("latin-1")).encode("latin-1")
        if raw is not None
        else None
    )
    opened_query = cipher.open_bytes(query)
    if path == scope["path"] and opened_raw == raw and opened_query == query:
        return scope
    return {**scope, "path": path, "raw_path": opened_raw, "query_string": opened_query}


async def _open_body(scope: Scope, receive: Receive, cipher: IdCipher) -> Receive:
    """``receive`` with the tokens of a JSON body mapped back."""
    headers = list(scope.get("headers", []))
    kind = (_header(headers, b"content-type") or b"").split(b";")[0].strip()
    if scope["method"] in {"GET", "HEAD"} or kind != b"application/json":
        return receive
    chunks: list[bytes] = []
    while True:
        message = await receive()
        if message["type"] != "http.request":
            # The client went away; let the app see it.
            async def gone(message: Message = message) -> Message:
                return message

            return gone
        chunks.append(message.get("body", b""))
        if not message.get("more_body", False):
            break
    body = b"".join(chunks)
    if _TOKEN_BYTES.search(body) or b'"workspace_id"' in body:
        # Not JSON after all: the app answers it as it is.
        with contextlib.suppress(ValueError):
            body = json.dumps(cipher.open_json(json.loads(body))).encode()
    sent = False

    async def replay() -> Message:
        nonlocal sent
        if sent:
            return await receive()
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return replay


def _sealing_send(send: Send, cipher: IdCipher) -> Send:
    """``send`` that seals the hex ids of a JSON answer."""
    start: Message | None = None
    chunks: list[bytes] = []
    passthrough = False

    async def sealing(message: Message) -> None:
        nonlocal start, passthrough
        if message["type"] == "http.response.start":
            headers = list(message.get("headers", []))
            kind = (_header(headers, b"content-type") or b"").split(b";")[0].strip()
            passthrough = (
                kind != b"application/json"
                or _header(headers, b"content-disposition") is not None
            )
            if passthrough:
                await send(message)
            else:
                start = message
            return
        if message["type"] != "http.response.body" or passthrough:
            await send(message)
            return
        chunks.append(message.get("body", b""))
        if message.get("more_body", False):
            return
        body = b"".join(chunks)
        if _REAL_BYTES.search(body) or b'"workspace_id"' in body:
            # ASCII escapes: a lone surrogate in an answer cannot fail here.
            body = json.dumps(
                cipher.seal_json(json.loads(body)), separators=(",", ":")
            ).encode()
        assert start is not None
        headers = [
            (k, v)
            for k, v in start.get("headers", [])
            if k.lower() != b"content-length"
        ]
        headers.append((b"content-length", str(len(body)).encode()))
        await send({**start, "headers": headers})
        await send({"type": "http.response.body", "body": body, "more_body": False})

    return sealing
