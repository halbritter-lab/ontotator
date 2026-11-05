"""Jobs a token started run like those of a session (issue 305)."""

from __future__ import annotations

from typing import Any

from auth_harness import ORIGIN
from fastapi import FastAPI
from fastapi.testclient import TestClient
from proposal_check_support import proposal_env


def _token(client: TestClient, scopes: list[str], url: str) -> dict[str, Any]:
    response = client.post(url, json={"name": "pipeline", "scopes": scopes})
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _bearer(app: FastAPI, secret: str) -> TestClient:
    return TestClient(app, headers={"Authorization": f"Bearer {secret}", **ORIGIN})


def test_a_token_runs_the_translation_review_export(tmp_path) -> None:
    """The stored job payload names the token; the handler still accepts it."""
    env = proposal_env(tmp_path)
    secret = _token(env.lead, ["export"], "/api/v1/projects/proj/tokens")["secret"]
    client = _bearer(env.app, secret)
    started = client.post("/api/v1/projects/proj/exports/translation-reviews")
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]
    job = env.app.state.jobs.claim(job_id, "token-test")
    finished = env.app.state.jobs.run(job, "token-test")
    assert finished.status == "succeeded", finished.error
    assert client.get(f"/api/v1/jobs/{job_id}/download").status_code == 200
