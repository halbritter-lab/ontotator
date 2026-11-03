"""The real Ontotator app on a fresh test database, for the integration test.

Runs in the main project's environment (``uv run --project <repo>``), never
in the MCP server's. Creates a system administrator, two annotators and two
API tokens, prints one JSON line with the address and the tokens on stdout,
then serves until stdin closes and drops its databases. The database is a
copy of the test template on the server named by ``ONTOTATOR_TEST_PG_URL``;
``PYTEST_XDIST_WORKER`` must be unique, so that only this process's
databases are created and dropped (``tests/pg_harness.py``).
"""

from __future__ import annotations

import json
import socket
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))

import uvicorn  # noqa: E402
from auth_harness import ensure_user  # noqa: E402
from ontotator.api.app import create_app  # noqa: E402
from ontotator.auth.audit import Actor  # noqa: E402
from ontotator.config import AppConfig  # noqa: E402
from pg_harness import database_url_for, reset  # noqa: E402

ALL_SCOPES = ["read", "import", "export", "project-admin", "admin"]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port: int = probe.getsockname()[1]
        return port


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ontotator-mcp-it-") as folder:
        root = Path(folder)
        port = _free_port()
        app = create_app(
            AppConfig(
                workspace_dir=root,
                database_url=database_url_for(root / "mcp.db"),
                port=port,
            )
        )
        try:
            ensure_user(app, "root", system_admin=True)
            for name in ("ann1", "ann2"):
                ensure_user(app, name)
            tokens = app.state.api_tokens
            admin = tokens.create(
                Actor.cli(),
                "root",
                name="mcp integration",
                scopes=ALL_SCOPES,
                kind="system",
                lifetime_days=1,
            )
            reader = tokens.create(
                Actor.cli(), "root", name="mcp read only", scopes=["read"]
            )
            print(
                json.dumps(
                    {
                        "url": f"http://127.0.0.1:{port}",
                        "admin_token": admin.secret,
                        "read_token": reader.secret,
                    }
                ),
                flush=True,
            )
            server = uvicorn.Server(
                uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
            )

            def stop_on_eof() -> None:
                # The test closes stdin to stop the server; a signal would end
                # the process before the test databases are dropped.
                sys.stdin.read()
                server.should_exit = True

            threading.Thread(target=stop_on_eof, daemon=True).start()
            server.run()
        finally:
            reset()


if __name__ == "__main__":
    main()
