"""Tasks keep working after their project moved to another release (#81)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from proposal_check_support import assign, client, doc, open_task, proposal_env
from test_project_repin import newer_release

from ontotator.api.routes import encode_workspace_id
from ontotator.auth.audit import Actor
from ontotator.domain.workspace import WorkspaceKey
from ontotator.exchange.t1 import Pin
from ontotator.projects.repin import RepinReport
from ontotator.projects.service import ProjectService

RETIRED = "HP:0011146"  # replaced by SUCCESSOR in ``newer_release``
SUCCESSOR = "HP:0001250"
GONE = "HP:0000365"  # unknown to ``newer_release``


def move(env: SimpleNamespace) -> RepinReport:
    """Move ``proj`` to the newer release, as a lead does in Settings."""
    store = env.app.state.ontology_store
    stored = store.add(Actor.cli(), "hp-2026-09-01.json", newer_release())
    repo = env.app.state.repo
    pins = {
        oid: Pin(stored.sha256, pin.allowed_roots, pin.t1_profile)
        for oid, pin in repo.project_pins("proj").items()
    }
    service = ProjectService(repo.db, store)
    report = service.preview_pins(Actor.cli(), "proj", pins)
    service.apply_pins(Actor.cli(), "proj", pins, report.report_sha256)
    return report


def scratch_env(tmp_path: Any, per_text: int = 1) -> SimpleNamespace:
    return proposal_env(tmp_path, per_text=per_text, mode="scratch")


def command(
    env: SimpleNamespace, username: str, opened: dict[str, Any], payload: dict[str, Any]
) -> dict[str, Any]:
    """Send one edit, then return ``opened`` at its new revision."""
    response = client(env, username).post(
        f"/api/v1/workspaces/{opened['workspace_id']}/commands",
        json={
            "mutation_id": uuid4().hex,
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": payload,
        },
    )
    assert response.status_code == 200, response.text
    return opened | {"view": opened["view"] | {"draft": response.json()}}


def add_finding(
    env: SimpleNamespace, username: str, opened: dict[str, Any], term_id: str
) -> dict[str, Any]:
    return command(
        env,
        username,
        opened,
        {
            "command": "create_annotation",
            "annotation_id": f"finding-{uuid4().hex}",
            "term_id": term_id,
            "layer_id": "hpo",
            "type_id": "phenotype",
            "axes_values": {
                "assertion": "present",
                "experiencer": "patient",
                "temporality": "current",
            },
            "note": "Stated in the text.",
        },
    )


def submit(env: SimpleNamespace, username: str, opened: dict[str, Any]) -> Any:
    opened = command(
        env,
        username,
        opened,
        {"command": "check_layer", "layer_id": "hpo", "checked": True},
    )
    return client(env, username).post(
        f"/api/v1/workspaces/{opened['workspace_id']}/submit",
        json={
            "mutation_id": uuid4().hex,
            "expected_revision": opened["view"]["draft"]["revision"],
            "payload": {"document_checked": True},
        },
    )


def terms(opened: dict[str, Any]) -> list[str]:
    return [
        snap["annotation"]["term_id"] for snap in opened["view"]["draft"]["annotations"]
    ]


def test_an_opened_task_opens_again_after_the_move(tmp_path: Any) -> None:
    env = proposal_env(tmp_path, per_text=1)
    row = assign(env, doc("c1"), "anno")
    first = open_task(env, "anno", row["id"])
    move(env)
    again = open_task(env, "anno", row["id"])
    assert again["workspace_id"] == first["workspace_id"]
    assert again["read_only"] is False


def test_an_open_draft_is_updated_and_goes_through_after_the_move(
    tmp_path: Any,
) -> None:
    env = scratch_env(tmp_path)
    row = assign(env, doc("c1"), "anno")
    add_finding(env, "anno", open_task(env, "anno", row["id"]), RETIRED)

    report = move(env)
    assert [(r.old_term_id, r.new_term_id) for r in report.rewrites] == [
        (RETIRED, SUCCESSOR)
    ]
    opened = open_task(env, "anno", row["id"])
    assert terms(opened) == [SUCCESSOR]
    opened = add_finding(env, "anno", opened, SUCCESSOR)
    response = submit(env, "anno", opened)
    assert response.status_code == 200, response.text
    assert {s["ontology_sha256"] for s in response.json()["snapshots"]} == {
        env.app.state.repo.project_pins("proj")["hp"].sha256
    }


def test_a_task_not_opened_before_the_move_starts_on_the_new_release(
    tmp_path: Any,
) -> None:
    env = scratch_env(tmp_path)
    row = assign(env, doc("c1"), "anno")
    move(env)
    assert terms(open_task(env, "anno", row["id"])) == []


def test_a_submitted_task_stays_as_it_was_submitted(tmp_path: Any) -> None:
    env = scratch_env(tmp_path)
    row = assign(env, doc("c1"), "anno")
    opened = add_finding(env, "anno", open_task(env, "anno", row["id"]), RETIRED)
    assert submit(env, "anno", opened).status_code == 200
    before = open_task(env, "anno", row["id"])
    assert before["read_only"] is True

    report = move(env)
    assert report.rewrites == [] and report.flagged == []
    after = open_task(env, "anno", row["id"])
    assert after["read_only"] is True
    assert after["view"]["draft"] == before["view"]["draft"]
    assert terms(after) == [RETIRED]
    statuses = env.app.state.repo.get_document_statuses(
        "proj", opened["view"]["key"]["annotator_id"], "independent"
    )
    assert statuses[doc("c1")] == "completed"


def test_a_scope_this_project_never_issued_stays_refused(tmp_path: Any) -> None:
    env = proposal_env(tmp_path, per_text=1)
    row = assign(env, doc("c1"), "anno")
    opened = open_task(env, "anno", row["id"])
    move(env)
    forged = WorkspaceKey.model_validate(
        opened["view"]["key"] | {"scope_id": "not-a-scope"}
    )
    response = client(env, "anno").post(
        f"/api/v1/workspaces/{encode_workspace_id(forged)}/commands",
        json={
            "mutation_id": "forged",
            "expected_revision": 0,
            "payload": {"command": "check_layer", "layer_id": "hpo", "checked": True},
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "INVALID_SCOPE"


def two_submissions(env: SimpleNamespace) -> list[str]:
    submitted = []
    for username in ("anno", "anno2"):
        row = assign(env, doc("c1"), username)
        opened = add_finding(
            env, username, open_task(env, username, row["id"]), RETIRED
        )
        response = submit(env, username, opened)
        assert response.status_code == 200, response.text
        submitted.append(response.json()["submission_id"])
    return submitted


def consolidate(env: SimpleNamespace, sources: list[str]) -> Any:
    return env.lead.post(
        "/api/v1/projects/proj/consolidations",
        json={
            "document_id": doc("c1"),
            "reviewer": "leader",
            "source_submission_ids": sources,
            "reason": None,
            "confirm_language": True,
            "request_id": "after-move",
            "expected_workflow_revision": None,
        },
    )


def test_work_from_before_the_move_can_be_consolidated(tmp_path: Any) -> None:
    env = scratch_env(tmp_path, per_text=2)
    submitted = two_submissions(env)
    move(env)
    started = consolidate(env, submitted)
    assert started.status_code == 200, started.text


def test_imported_work_is_looked_up_in_this_project_after_the_move(
    tmp_path: Any, monkeypatch: Any
) -> None:
    """An imported submission's origin key names the exporting project."""
    env = scratch_env(tmp_path, per_text=2)
    submitted = two_submissions(env)
    move(env)
    repository = type(env.app.state.repo)
    stored = repository.get_submission

    def imported(*args: Any, **kwargs: Any) -> Any:
        submission = stored(*args, **kwargs)
        return submission and submission.model_copy(
            update={
                "origin_key": submission.origin_key.model_copy(
                    update={"project_key": "exporter"}
                )
            }
        )

    monkeypatch.setattr(repository, "get_submission", imported)
    started = consolidate(env, submitted)
    assert started.status_code == 200, started.text


def test_a_reopened_task_opens_for_editing_after_the_move(tmp_path: Any) -> None:
    env = scratch_env(tmp_path)
    row = assign(env, doc("c1"), "anno")
    opened = add_finding(env, "anno", open_task(env, "anno", row["id"]), SUCCESSOR)
    assert submit(env, "anno", opened).status_code == 200
    move(env)
    reopened = env.lead.post(
        f"/api/v1/assignments/{row['id']}/reopen", json={"reason": "Check once more."}
    )
    assert reopened.status_code == 200, reopened.text
    again = open_task(env, "anno", row["id"])
    assert again["read_only"] is False
    response = submit(env, "anno", again)
    assert response.status_code == 200, response.text


def test_the_check_names_proposals_on_retired_terms(tmp_path: Any) -> None:
    env = proposal_env(tmp_path, per_text=1, proposal_term=RETIRED)
    row = assign(env, doc("c1"), "anno")
    opened = open_task(env, "anno", row["id"])

    report = move(env)
    assert report.rewrites == []
    [flag] = report.flagged
    assert (flag.term_id, flag.status, flag.replaced_by) == (
        RETIRED,
        "obsolete",
        [SUCCESSOR],
    )
    assert flag.annotation_id.endswith(":p2")

    # What the check promises: the annotator can get past it.
    again = open_task(env, "anno", row["id"])
    assert again["workspace_id"] == opened["workspace_id"]
    assert again["view"]["term_statuses"][f"hpo:{RETIRED}"] == "obsolete"
