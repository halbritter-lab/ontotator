"""Readiness evidence and production exposure validation for the opt-in checker."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "container_check",
    Path(__file__).resolve().parents[1] / "scripts/container_check.py",
)
assert spec is not None and spec.loader is not None
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (503, {"checks": {"database": False}}, True),
        (200, {"checks": {"database": False}}, False),
        (503, {"checks": {"schema": False}}, False),
        (503, {"checks": {"database": True}}, False),
        (503, {"checks": {"database": 0}}, False),
    ],
)
def test_unavailable_probe_requires_http_and_boolean_evidence(status, body, expected):
    assert checker.readiness_matches(status, body, "database", False) is expected


@pytest.mark.parametrize(
    ("config", "expected"),
    [
        ({"services": {"app": {}}}, True),
        ({"services": {"app": {"ports": []}}}, True),
        (
            {"services": {"app": {"ports": [{"target": 8000, "published": "8000"}]}}},
            False,
        ),
        ({"services": {}}, False),
    ],
)
def test_production_contract_rejects_published_or_missing_app(config, expected):
    assert checker.production_has_private_app(config) is expected


@pytest.mark.parametrize("source", ["ambient", "env-file"])
def test_pending_schema_removes_inline_admin_secret_from_compose(
    tmp_path, monkeypatch, source
):
    import json

    stack = checker.Stack(tmp_path, "ontotator:test-only")
    monkeypatch.setattr(stack, "up", lambda **kwargs: None)
    monkeypatch.setattr(stack, "down", lambda: None)
    try:
        if source == "ambient":
            stack.env["ONTOTATOR_ADMIN_PASSWORD_HASH"] = "ambient-review-placeholder"
            prefix = []
        else:
            stack.env.pop("ONTOTATOR_ADMIN_PASSWORD_HASH", None)
            dotenv = tmp_path / "review.env"
            dotenv.write_text(
                "ONTOTATOR_ADMIN_PASSWORD_HASH=dotenv-review-placeholder\n"
            )
            prefix = ["--env-file", str(dotenv)]
        stack.pending_schema()
        config = json.loads(stack.compose(*prefix, "config", "--format", "json").stdout)
        environment = config["services"]["app"]["environment"]
        assert "ONTOTATOR_ADMIN_PASSWORD_HASH" not in environment
        assert (
            environment["ONTOTATOR_ADMIN_PASSWORD_HASH_FILE"]
            == "/run/check-admin-password-hash"
        )
    finally:
        for reservation in stack.reservations:
            reservation.close()


@pytest.mark.parametrize(
    ("stderr", "diagnostic"),
    [
        (
            'cannot create config "owner_password" in read-only service postgres: `file` is the sole supported option',
            "file-backed Compose configs",
        ),
        ("ports are not available: address already in use", "port collision"),
        ("container is unhealthy", "healthcheck failed"),
    ],
)
def test_docker_failure_is_actionable_without_exposing_stderr(stderr, diagnostic):

    poisoned = stderr + "\npassword=must-never-appear"
    result = checker.docker_failure(poisoned)
    assert diagnostic in result
    assert "must-never-appear" not in result


def test_service_status_excludes_commands_and_unknown_metadata():
    import json

    status = checker.service_status(
        json.dumps(
            [
                {
                    "Service": "postgres",
                    "State": "exited",
                    "Health": "unhealthy",
                    "ExitCode": 1,
                    "Command": "password=never-print",
                },
                {
                    "Service": "app",
                    "State": "running",
                    "Health": "healthy",
                    "ExitCode": 0,
                },
            ]
        )
    )
    assert "postgres state=exited health=unhealthy exit=1" in status
    assert "app state=running health=healthy exit=0" in status
    assert "never-print" not in status
