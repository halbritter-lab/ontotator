"""Container contract checks. Docker work is opt-in; never touches another project."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


class DockerCommandError(RuntimeError):
    """A diagnostic safe to print without exposing Docker's raw output."""


def readiness_matches(status: int, body: dict, check: str, expected: bool) -> bool:
    """An unavailable probe must carry both its HTTP and explicit check evidence."""
    return status == 503 and body.get("checks", {}).get(check) is expected


def production_has_private_app(config: dict) -> bool:
    return "app" in config.get("services", {}) and not config["services"]["app"].get(
        "ports"
    )


def docker_failure(stderr: str) -> str:
    """Classify known failures without echoing commands, environment or logs."""
    if "cannot create config" in stderr and "read-only service" in stderr:
        return "read-only PostgreSQL requires file-backed Compose configs"
    if any(
        message in stderr.lower()
        for message in (
            "port is already allocated",
            "address already in use",
            "ports are not available",
        )
    ):
        return "localhost port collision; rerun to select fresh ports"
    if "unhealthy" in stderr.lower():
        return "service healthcheck failed; inspect service status for this project"
    if "no such image" in stderr.lower() or "pull access denied" in stderr.lower():
        return "requested image is unavailable locally"
    if "bind source path does not exist" in stderr.lower():
        return "required bind-mounted file is missing"
    return "Docker failed; inspect service status for this project"


def service_status(output: str) -> str:
    """Project-local service state only; never log commands or container metadata."""
    rows = (
        json.loads(output)
        if output.lstrip().startswith("[")
        else [json.loads(line) for line in output.splitlines() if line.strip()]
    )
    summaries = []
    for row in rows:
        if row.get("Service") not in {"app", "migrate", "postgres"}:
            continue
        state = row.get("State")
        state = (
            state
            if state in {"running", "created", "exited", "restarting", "dead", "paused"}
            else "unknown"
        )
        health = row.get("Health")
        health = (
            health if health in {"healthy", "unhealthy", "starting", ""} else "unknown"
        )
        code = row.get("ExitCode")
        code = code if type(code) is int else "unknown"
        summaries.append(
            f"{row['Service']} state={state} health={health or 'none'} exit={code}"
        )
    return "; ".join(summaries) or "no project containers created"


def run(
    args: list[str],
    *,
    env: dict[str, str],
    check: bool = True,
    stage: str = "docker",
    stdin: BinaryIO | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args,
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=180,
        stdin=stdin,
    )
    if check and result.returncode:
        raise DockerCommandError(
            f"{stage} (exit {result.returncode}): {docker_failure(result.stderr)}"
        )
    return result


class Stack:
    """A disposable Compose project, reusable by other opt-in stack checks."""

    def __init__(self, directory: Path, image: str | None) -> None:
        self.project = "ontocheck" + uuid4().hex[:12]
        self.directory = directory
        self.image = image
        self.env = dict(os.environ)
        self.files = [str(ROOT / "docker-compose.dev.yml")]
        self.reservations: list[socket.socket] = []
        for variable in ("ONTOTATOR_DEV_PORT", "ONTOTATOR_DEV_PG_PORT"):
            reservation = socket.socket()
            reservation.bind(("127.0.0.1", 0))
            self.reservations.append(reservation)
            self.env[variable] = str(reservation.getsockname()[1])
        if image:
            token = directory / "unused-build-token"
            token.touch()
            self.env["GITHUB_TOKEN_FILE"] = str(token)
            override = directory / "image.json"
            override.write_text(
                json.dumps(
                    {
                        "services": {
                            name: {"image": image} for name in ("app", "migrate")
                        }
                    }
                )
            )
            self.files.append(str(override))

    def compose(
        self, *args: str, check: bool = True, stdin: BinaryIO | None = None
    ) -> subprocess.CompletedProcess[str]:
        command = ["docker", "compose", "-p", self.project]
        for file in self.files:
            command += ["-f", file]
        operation = next(
            (
                arg
                for arg in args
                if arg in {"up", "down", "exec", "stop", "start", "config", "ps"}
            ),
            "command",
        )
        service = (
            f" service={args[2]}"
            if len(args) > 2
            and args[:2] == ("exec", "-T")
            and args[2] in {"app", "migrate", "postgres"}
            else ""
        )
        return run(
            command + list(args),
            env=self.env,
            check=check,
            stage=f"compose {operation}{service} project={self.project}",
            stdin=stdin,
        )

    def up(self, *, wait: bool = True) -> None:
        for reservation in self.reservations:
            reservation.close()
        self.reservations.clear()
        args = ["up", "-d", "--no-build" if self.image else "--build"]
        if wait:
            args += ["--wait", "--wait-timeout", "150"]
        self.compose(*args)
        # Reuse the image just built when the schema scenario recreates services.
        if self.image is None:
            self.image = "ontotator-dev:local"

    @property
    def host(self) -> str:
        return f"http://127.0.0.1:{self.env['ONTOTATOR_DEV_PORT']}"

    def down(self) -> None:
        for reservation in self.reservations:
            reservation.close()
        self.reservations.clear()
        self.compose("down", "--volumes", "--remove-orphans")

    def exec(
        self, service: str, *args: str, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        return self.compose("exec", "-T", service, *args, check=check)

    def probe(self) -> tuple[int, dict]:
        code = """import json, urllib.request, urllib.error
try:
    response = urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=5)
except urllib.error.HTTPError as error:
    response = error
print(json.dumps([response.status, json.load(response)]))
"""
        status, body = json.loads(self.exec("app", "python", "-c", code).stdout)
        return status, body

    def await_probe(self, check: str, expected: bool, *, timeout: float = 30) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                status, body = self.probe()
                if readiness_matches(status, body, check, expected):
                    return True
            except (RuntimeError, ValueError):
                pass
            # Covers readiness caching in both Uvicorn workers, without assuming
            # the first request after a database stop observes the outage.
            time.sleep(1.1)
        return False

    def pending_schema(self) -> None:
        self.down()
        secret = self.directory / "admin-password-hash"
        # Disposable DEVELOPMENT ONLY credential already used by dev Compose.
        secret.write_text(
            "$argon2id$v=19$m=19456,t=2,p=1$9JHO3+VFkY+sdmMU07T4cg$U3OQKXAew6vo6eGHZYm4Qcf2S+j06b5TyuRBlrLHuLs"
        )
        password = self.directory / "app-password"
        password.write_text("cafebabe0123456789abcdef01234567")
        override = self.directory / "pending.yml"
        override.write_text(
            json.dumps(
                {
                    "services": {
                        "migrate": {
                            "environment": {"ONTOTATOR_MIGRATE_TARGET": "0001"}
                        },
                        "app": {
                            "environment": {
                                "ONTOTATOR_ENV": "production",
                                "ONTOTATOR_PUBLIC_ORIGIN": "https://container-check.invalid",
                                "ONTOTATOR_TRUSTED_PROXIES": "127.0.0.1",
                                "ONTOTATOR_ADMIN_PASSWORD_HASH": None,
                                "ONTOTATOR_ADMIN_PASSWORD_HASH_FILE": "/run/check-admin-password-hash",
                                "ONTOTATOR_DATABASE_URL": "postgresql://ontotator_app@postgres:5432/ontotator",
                                "ONTOTATOR_DATABASE_PASSWORD_FILE": "/run/check-app-password",
                            },
                            "volumes": [
                                {
                                    "type": "bind",
                                    "source": str(secret),
                                    "target": "/run/check-admin-password-hash",
                                    "read_only": True,
                                },
                                {
                                    "type": "bind",
                                    "source": str(password),
                                    "target": "/run/check-app-password",
                                    "read_only": True,
                                },
                            ],
                        },
                    }
                }
            ).replace(
                '"ONTOTATOR_ADMIN_PASSWORD_HASH": null',
                '"ONTOTATOR_ADMIN_PASSWORD_HASH": !reset null',
            )
        )
        self.files.append(str(override))
        # The app must start health-only but remain unhealthy with old schema.
        self.up(wait=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image", help="Reuse this local image for app and migrate; never build"
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Seed and run browser smoke on the same healthy stack",
    )
    args = parser.parse_args()
    failures = 0

    def report(name: str, passed: bool) -> None:
        nonlocal failures
        print(f"{'PASS' if passed else 'FAIL'} {name}", flush=True)
        failures += not passed

    with tempfile.TemporaryDirectory(prefix="ontocheck-") as temporary:
        stack = Stack(Path(temporary), args.image)
        try:
            stack.up()
            if args.smoke:
                from seed_stack import run_browser_smoke, seed

                print("Smoke: seeding the healthy stack", flush=True)
                seed(stack)
                print("Smoke: running browser checks", flush=True)
                run_browser_smoke(stack)
                report("stack browser smoke", True)
            report(
                "non-root uid 1001",
                stack.exec("app", "id", "-u").stdout.strip() == "1001",
            )
            result = stack.exec(
                "app", "sh", "-c", "touch /app/container-check", check=False
            )
            report(
                "read-only root filesystem",
                result.returncode != 0 and "Read-only file system" in result.stderr,
            )
            report(
                "writable data and tmp",
                stack.exec(
                    "app",
                    "sh",
                    "-c",
                    "touch /data/container-check /tmp/container-check",
                    check=False,
                ).returncode
                == 0,
            )
            container = stack.compose("ps", "-q", "app").stdout.strip()
            inspection = json.loads(
                run(["docker", "inspect", container], env=stack.env).stdout
            )[0]
            report(
                "all capabilities dropped",
                inspection["HostConfig"]["CapDrop"] == ["ALL"],
            )
            env = stack.env | {
                "ONTOTATOR_IMAGE": args.image or "ontotator-dev:local",
                "ONTOTATOR_PUBLIC_ORIGIN": "https://container-check.invalid",
                "ONTOTATOR_TRUSTED_PROXIES": "127.0.0.1",
                "NPM_SHARED_NETWORK_NAME": "container-check-npm",
            }
            production = run(
                [
                    "docker",
                    "compose",
                    "-f",
                    str(ROOT / "docker-compose.yml"),
                    "config",
                    "--format",
                    "json",
                ],
                env=env,
            )
            report(
                "production app has no published port",
                production_has_private_app(json.loads(production.stdout)),
            )
            denied = stack.exec(
                "postgres",
                "psql",
                "-U",
                "ontotator_app",
                "-d",
                "ontotator",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                "UPDATE ontotator.submissions SET mode='x'",
                check=False,
            )
            report(
                "app role cannot update submission history",
                denied.returncode != 0
                and "permission denied for table submissions" in denied.stderr,
            )
            migration = stack.exec("app", "ontotator", "db", "upgrade", check=False)
            report(
                "app cannot run owner migrations",
                migration.returncode == 1
                and "ONTOTATOR_MIGRATION_DATABASE_URL is not set"
                in migration.stdout + migration.stderr,
            )
            stack.compose("stop", "postgres")
            report(
                "readyz detects unavailable database",
                stack.await_probe("database", False),
            )
            stack.compose("start", "postgres")
            stack.pending_schema()
            pending = stack.await_probe("schema", False)
            if pending:
                status, body = stack.probe()
                pending = (
                    readiness_matches(status, body, "schema", False)
                    and body["checks"].get("database") is True
                )
            report("readyz detects pending migrations", pending)
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
            detail = (
                str(error)
                if isinstance(error, DockerCommandError)
                else type(error).__name__
            )
            report(
                f"container checks aborted: {detail}",
                False,
            )
            try:
                status = stack.compose("ps", "--all", "--format", "json", check=False)
                print(
                    f"Project {stack.project}: {service_status(status.stdout)}",
                    flush=True,
                )
            except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired):
                print(
                    f"Project {stack.project}: service status unavailable", flush=True
                )
        finally:
            try:
                stack.down()
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                report(f"cleanup failed for project {stack.project}", False)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
