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
