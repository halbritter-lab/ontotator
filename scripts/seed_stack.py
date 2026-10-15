"""Seed a running development Compose project, without starting or stopping it.

Run ``uv run python scripts/seed_stack.py`` after bringing up dev Compose.
The container checker calls ``seed(stack)`` and ``run_browser_smoke(stack)``
on its existing healthy, disposable stack. Accounts and corpus are synthetic.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import BinaryIO, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
# DEVELOPMENT ONLY. Never use these synthetic smoke accounts in production.
DEV_PASSWORD = "development-only-smoke-password"


class RunningStack(Protocol):
    env: dict[str, str]

    @property
    def host(self) -> str: ...

    def compose(
        self, *args: str, check: bool = True, stdin: BinaryIO | None = None
    ) -> subprocess.CompletedProcess[str]: ...

    def exec(
        self, service: str, *args: str, check: bool = True
    ) -> subprocess.CompletedProcess[str]: ...


def copy_fixture(stack: RunningStack, source: Path, target: str) -> None:
    """Stream public fixture bytes through the process's writable /tmp mount.

    Docker archive-copy refuses read-only containers even for tmpfs destinations.
    The bytes here are public test corpus only, never credentials.
    """
    with source.open("rb") as handle:
        stack.compose(
            "exec",
            "-T",
            "app",
            "python",
            "-c",
            "import pathlib, sys; pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())",
            target,
            stdin=handle,
        )


def seed(stack: RunningStack) -> None:
    """Create smoke users/project in a fresh stack; consume setup codes privately.

    Intentionally fails on an already-seeded database: browser acceptance needs
    the first case to start Open, not a result left by an earlier run.
    """
    password = stack.env.get("STACK_SMOKE_PASSWORD", DEV_PASSWORD)
    for username, admin in [("smoke-admin", True), ("smoke-annotator", False)]:
        args = [
            "ontocurator",
            "admin",
            "users",
            "create",
            username,
            "--display-name",
            username,
        ]
        if admin:
            args.append("--system-admin")
        result = stack.exec("app", *args)
        # _print_code prints the token alone on an indented line. Never echo
        # stdout, response bodies, cookies, or passwords, even when seeding fails.
        codes = re.findall(r"(?m)^  ([A-Za-z0-9_-]{43})\s*$", result.stdout)
        if len(codes) != 1:
            raise RuntimeError(
                f"Could not read setup code for synthetic account {username}"
            )
        request = Request(
            stack.host + "/api/v1/auth/redeem-code",
            data=json.dumps(
                {"username": username, "code": codes[0], "new_password": password}
            ).encode(),
            headers={"Content-Type": "application/json", "Origin": stack.host},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError("Synthetic account setup failed")
        except (HTTPError, URLError):
            raise RuntimeError(
                f"Synthetic account setup failed for {username}"
            ) from None

    for filename in ("hp.json", "smoke-profile.json", "smoke-bundle.zip"):
        copy_fixture(stack, FIXTURES / filename, f"/tmp/{filename}")
    stack.exec("app", "ontocurator", "admin", "ontologies", "add", "/tmp/hp.json")
    stack.exec(
        "app",
        "ontocurator",
        "admin",
        "projects",
        "create",
        "smoke",
        "--name",
        "smoke",
        "--profile",
        "/tmp/smoke-profile.json",
    )
    stack.exec(
        "app",
        "ontocurator",
        "admin",
        "projects",
        "add-member",
        "smoke",
        "smoke-annotator",
        "--role",
        "annotator",
    )
    imported = stack.exec(
        "app", "ontocurator", "admin", "import", "smoke", "/tmp/smoke-bundle.zip"
    )
    if (
        "documents_added: 2" not in imported.stdout
        or "proposals: 1" not in imported.stdout
    ):
        raise RuntimeError("Smoke import did not create two documents and one proposal")
    stack.exec(
        "app",
        "ontocurator",
        "admin",
        "assign",
        "smoke",
        "smoke-annotator",
        "--confirm-language",
    )
    print(
        "Seeded synthetic smoke project (two documents, one tool proposal).", flush=True
    )


def run_browser_smoke(stack: RunningStack) -> None:
    """Run Playwright against this stack, with no fixture server or lifecycle."""
    npm = shutil.which("npm")
    if npm is None:
        raise RuntimeError("npm is required for the stack browser smoke")
    result = subprocess.run(
        [npm, "run", "test:stack"],
        cwd=ROOT / "frontend",
        env={**stack.env, "STACK_BASE_URL": stack.host},
        timeout=180,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("Stack browser smoke failed; see Playwright output")


class ExistingStack:
    """Adapter for the standalone CLI; it never creates or removes services."""

    def __init__(self, project: str | None, host: str) -> None:
        self.env = dict(os.environ)
        self.host = host.rstrip("/")
        self.command = ["docker", "compose", "-f", str(ROOT / "docker-compose.dev.yml")]
        if project:
            self.command += ["-p", project]

    def compose(
        self, *args: str, check: bool = True, stdin: BinaryIO | None = None
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            self.command + list(args),
            cwd=ROOT,
            env=self.env,
            capture_output=True,
            text=True,
            timeout=180,
            stdin=stdin,
        )
        if check and result.returncode:
            raise RuntimeError(
                f"Smoke Compose operation failed (exit {result.returncode}); output withheld because setup codes may be present"
            )
        return result

    def exec(
        self, service: str, *args: str, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        return self.compose("exec", "-T", service, *args, check=check)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project",
        help="Existing Compose project (default: Compose's project selection)",
    )
    parser.add_argument(
        "--host", default=os.environ.get("STACK_BASE_URL", "http://127.0.0.1:8000")
    )
    parser.add_argument(
        "--browser",
        action="store_true",
        help="Also run the browser smoke after seeding",
    )
    args = parser.parse_args()
    stack = ExistingStack(args.project, args.host)
    seed(stack)
    if args.browser:
        run_browser_smoke(stack)
