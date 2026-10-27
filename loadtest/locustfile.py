"""P9 workload. Run one local process with the 30 synthetic accounts."""

from __future__ import annotations

import json
import os
import random
from collections import deque
from pathlib import Path
from uuid import uuid4

from locust import HttpUser, between, events, task
from locust.exception import StopUser

# Seeded tool proposals make the assignments proposal-check tasks (the
# project's default annotation mode); a user may open only that mode.
MODE = "proposal_check"
TARGETS = {
    "search": ("POST", 150),
    "open": ("POST", 300),
    "write": ("POST", 150),
    "dashboard": ("GET", 500),
}


@events.init_command_line_parser.add_listener
def options(parser):
    parser.add_argument(
        "--load-manifest",
        default="loadtest/results/seed/manifest.json",
        help="Manifest produced by seed.py",
    )
    parser.add_argument(
        "--load-password",
        default=os.environ.get("ONTOTATOR_LOAD_PASSWORD"),
        help="Synthetic credentials; prefer ONTOTATOR_LOAD_PASSWORD",
    )


@events.init.add_listener
def initialize(environment, **_kwargs):
    opts = environment.parsed_options
    if opts.master or opts.worker:
        raise ValueError(
            "Use one local Locust process so each of the 30 accounts is assigned once"
        )
    if not opts.load_password:
        raise ValueError("Set ONTOTATOR_LOAD_PASSWORD or --load-password")
    manifest = json.loads(Path(opts.load_manifest).read_text(encoding="utf-8"))
    if (
        len(manifest["users"]) != 30
        or len(set(manifest["users"])) != 30
        or len(manifest["documents"]) != 1000
        or set(manifest.get("assignments", {})) != set(manifest["users"])
        or not set().union(*manifest["assignments"].values())
        <= set(manifest["documents"])
    ):
        raise ValueError(
            "Expected 30 distinct users, 1000 documents and each user's assignments"
        )
    if opts.num_users != 30:
        raise ValueError("P9 requires --users 30")
    environment.load_manifest = manifest
    environment.load_accounts = deque(manifest["users"])
    environment.load_setup_failed = False


@events.quitting.add_listener
def thresholds(environment, **_kwargs):
    failed = getattr(environment, "load_setup_failed", False)
    print("\nP9 task       samples   p50 ms   p95 ms   p99 ms   target p95   result")
    for name, (method, target) in TARGETS.items():
        entry = environment.stats.get(name, method)
        samples = entry.num_requests
        values = [
            entry.get_response_time_percentile(p) if samples else None
            for p in (0.5, 0.95, 0.99)
        ]
        passed = bool(samples) and values[1] < target and entry.num_failures == 0
        failed |= not passed
        rendered = " ".join(
            f"{v:8.1f}" if v is not None else "     N/A" for v in values
        )
        print(
            f"{name:12} {samples:7} {rendered} {target:10}   {'PASS' if passed else 'FAIL'}"
        )
    # Setup/auth failures count, too: a fast failing request is never acceptance.
    if failed or environment.stats.total.num_failures:
        environment.process_exit_code = 1


class Annotator(HttpUser):
    wait_time = between(0.5, 1.5)

    def on_start(self):
        try:
            self.username = self.environment.load_accounts.popleft()
        except IndexError:
            self.environment.load_setup_failed = True
            raise StopUser() from None
        self.rng = random.Random(self.username)
        self.drafts = {}
        self.current = None
        self.client.headers.update({"Origin": self.host.rstrip("/")})
        with self.client.post(
            "/api/v1/auth/login",
            json={
                "username": self.username,
                "password": self.environment.parsed_options.load_password,
            },
            name="setup/login",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                self.environment.load_setup_failed = True
                response.failure(f"Login failed ({response.status_code})")
                raise StopUser()
            self.client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
        self.open_document()

    def checked_json(self, response):
        if response.status_code != 200:
            response.failure(f"Unexpected HTTP {response.status_code}")
            self.environment.load_setup_failed = True
            raise StopUser()
        return response.json()

    @task(2)
    def open_document(self):
        # Only the user's own assigned texts open (5 annotators per text).
        document = self.rng.choice(
            self.environment.load_manifest["assignments"][self.username]
        )
        with self.client.post(
            "/api/v1/workspaces/open",
            json={
                "project_key": "load",
                "document_id": document,
                "mode": MODE,
            },
            name="open",
            catch_response=True,
        ) as response:
            data = self.checked_json(response)
        self.current = data["workspace_id"]
        # Always replace with the server revision when revisiting an existing draft.
        self.drafts[self.current] = {
            "key": data["view"]["key"],
            "revision": data["view"]["draft"]["revision"],
        }

    @task(5)
    def search(self):
        label = self.rng.choice(self.environment.load_manifest["terms"])[1]
        length = self.rng.randint(4, min(12, len(label)))
        start = self.rng.randint(0, len(label) - length)
        with self.client.post(
            "/api/v1/search",
            json={
                "workspace_key": self.drafts[self.current]["key"],
                "annotation_id": "load-search",
                "layer_id": "hpo",
                "query": label[start : start + length],
                "route": "auto",
            },
            name="search",
            catch_response=True,
        ) as response:
            self.checked_json(response)

    def command(self, payload):
        draft = self.drafts[self.current]
        # Each command is a distinct attempt; never reuse an id with another payload.
        # No automatic retry: ambiguous failures stop this user and fail acceptance.
        envelope = {
            "mutation_id": str(uuid4()),
            "expected_revision": draft["revision"],
            "payload": payload,
        }
        with self.client.post(
            f"/api/v1/workspaces/{self.current}/commands",
            json=envelope,
            name="write",
            catch_response=True,
        ) as response:
            result = self.checked_json(response)
            if result["revision"] != draft["revision"] + 1:
                response.failure("Unexpected mutation revision")
                self.environment.load_setup_failed = True
                raise StopUser()
            draft["revision"] = result["revision"]

    @task(4)
    def write(self):
        annotation = str(uuid4())
        term = self.rng.choice(self.environment.load_manifest["terms"])[0]
        self.command(
            {
                "command": "create_annotation",
                "annotation_id": annotation,
                "term_id": term,
                "layer_id": "hpo",
                "type_id": "phenotype",
                # A finding without a text span needs a note (project default).
                "note": "Synthetic finding without a span",
            }
        )
        self.command(
            {
                "command": "set_axes",
                "annotation_id": annotation,
                "axes_values": {
                    "assertion": "present",
                    "experiencer": "patient",
                    "temporality": "current",
                },
            }
        )

    @task(1)
    def dashboard(self):
        with self.client.get(
            f"/api/v1/projects/load/documents?mode={MODE}",
            name="dashboard",
            catch_response=True,
        ) as response:
            self.checked_json(response)
