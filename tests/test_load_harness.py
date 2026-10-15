"""Focused contract tests: malformed corpora and invalid T1 payloads invalidate load results."""

import importlib.util
import json
from pathlib import Path

import ontospan
import pytest

SPEC = importlib.util.spec_from_file_location(
    "load_seed", Path(__file__).parents[1] / "loadtest" / "seed.py"
)


def seed_module():
    module = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(module)
    return module


def test_representative_gate_rejects_fixture_and_old_release(tmp_path):
    seed = seed_module()
    with pytest.raises(ValueError, match="representative"):
        seed.read_hpo(Path(__file__).parent / "fixtures" / "hp.json")
    old = tmp_path / "old.json"
    old.write_text(
        json.dumps(
            {
                "graphs": [
                    {"meta": {"version": "releases/2025-01-01/hp.json"}, "nodes": []}
                ]
            }
        )
    )
    with pytest.raises(ValueError, match="2026-06-23"):
        seed.read_hpo(old)


def test_synthetic_corpus_is_repeatable_and_valid_t1(tmp_path):
    seed = seed_module()
    terms = [
        ("HP:0001250", "Seizure"),
        ("HP:0004322", "Short stature"),
        ("HP:0000001", "All"),
    ]
    a = seed.build_assets(tmp_path / "a", terms, "2026-06-23", "a" * 64)
    b = seed.build_assets(tmp_path / "b", terms, "2026-06-23", "a" * 64)
    assert a["documents"] == b["documents"]
    assert len(a["documents"]) == 1000
    import zipfile

    with (
        zipfile.ZipFile(tmp_path / "a" / "bundle.zip") as za,
        zipfile.ZipFile(tmp_path / "b" / "bundle.zip") as zb,
    ):
        assert {n: za.read(n) for n in za.namelist()} == {
            n: zb.read(n) for n in zb.namelist()
        }
        units = [
            ontospan.AnnotatedDocument.model_validate_json(za.read(n))
            for n in za.namelist()
            if n != "manifest.json"
        ]
    assert len(units) == 1000
    for unit in units:
        assert 1500 <= len(unit.document.text) <= 3000
        assert len(unit.annotation_set.annotations) == 3
        actor = unit.annotation_set.actors[0]
        assert actor.name == "ontocurator-load" and actor.version == "1.0.0"
    from ontocurator.domain.profiles import TaskProfile

    TaskProfile.model_validate_json((tmp_path / "a" / "profile.json").read_text())


def test_p9_gate_fails_missing_slow_or_failed_samples():
    # Import Locust in a child interpreter: its gevent patching must precede SSL.
    import subprocess
    import sys

    script = r"""
import importlib.util
from locust.env import Environment
spec = importlib.util.spec_from_file_location("workload", "loadtest/locustfile.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def populated():
    env = Environment()
    for name, (method, _) in m.TARGETS.items():
        env.stats.log_request(method, name, 50, 100)
    return env

env = populated()
m.thresholds(env)
assert env.process_exit_code is None
for kind in ("missing", "slow", "failed"):
    env = populated()
    if kind == "missing":
        env.stats.get("search", "POST").reset()
    elif kind == "slow":
        for _ in range(10):
            env.stats.log_request("POST", "search", 200, 100)
    else:
        env.stats.log_error("POST", "search", "synthetic failure")
    m.thresholds(env)
    assert env.process_exit_code == 1, kind
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).parents[1],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_http_commands_use_returned_revision_and_api_payload_models():
    import subprocess
    import sys

    script = r"""
import importlib.util
from types import SimpleNamespace
from locust import HttpUser
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.application.editing import CreateAnnotationCommand, SetAxesCommand
spec = importlib.util.spec_from_file_location("workload", "loadtest/locustfile.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
requests = []
class Response:
    status_code = 200
    def __init__(self, revision): self.revision = revision
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def json(self): return {"revision": self.revision}
    def failure(self, message): raise AssertionError(message)
class Client:
    def post(self, path, *, json, name, catch_response):
        assert path == "/api/v1/workspaces/draft-a/commands"
        envelope = MutationEnvelope.model_validate(json)
        model = CreateAnnotationCommand if envelope.payload["command"] == "create_annotation" else SetAxesCommand
        model.model_validate(envelope.payload)
        requests.append(json)
        return Response(7 + len(requests))
user = object.__new__(m.Annotator)
user.client = Client()
user.environment = SimpleNamespace(load_setup_failed=False)
user.current = "draft-a"
user.drafts = {"draft-a": {"revision": 7}, "draft-b": {"revision": 42}}
user.command({"command": "create_annotation", "annotation_id": "a", "term_id": "HP:0001250", "layer_id": "hpo"})
user.command({"command": "set_axes", "annotation_id": "a", "axes_values": {"assertion": "present"}})
assert [r["expected_revision"] for r in requests] == [7, 8]
assert len({r["mutation_id"] for r in requests}) == 2
assert user.drafts["draft-a"]["revision"] == 9
assert user.drafts["draft-b"]["revision"] == 42
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).parents[1],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_container_transfer_preserves_binary_stdin(tmp_path):
    """Exercise the subprocess stdin boundary; text-mode encoding would corrupt this."""
    import sys

    shim = tmp_path / "compose_shim.py"
    shim.write_text(
        "import subprocess, sys\n"
        "assert sys.argv[1:6] == ['exec', '-T', 'app', 'python', '-c']\n"
        "raise SystemExit(subprocess.run([sys.executable, *sys.argv[5:]], stdin=sys.stdin.buffer).returncode)\n",
        encoding="utf-8",
    )
    original = bytes(range(256)) * 2048 + b"\x00\xff\r\n\n"
    source = tmp_path / "source.bin"
    target = tmp_path / "target.bin"
    source.write_bytes(original)
    seed_module().stream_to_container([sys.executable, str(shim)], source, str(target))
    assert target.read_bytes() == original


def test_selected_assignment_documents_match_workload_and_cover_unchanged_corpus():
    seed = seed_module()
    documents = [f"load-{index:04d}" for index in range(1, 1001)]
    selections = [
        seed.assigned_documents(f"load-{index:02d}", documents)
        for index in range(1, 31)
    ]
    assert set().union(*map(set, selections)) == set(documents)
    assert sum(map(len, selections)) == 1000
    assert all(33 <= len(selection) <= 34 for selection in selections)
    assert selections == [
        seed.assigned_documents(f"load-{index:02d}", documents)
        for index in range(1, 31)
    ]
