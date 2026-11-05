"""Undo, redo and reset of the editor (issue 320), built from the edit log."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from auth_harness import logged_in
from layered_fixtures import make_layered_package
from pg_harness import database_url_for
from test_round_input_resolution_contract import _apply, _clear, _ctx, _dismiss
from test_round_inputs_access_api import carried_round  # noqa: F401
from test_work_rounds import rounds  # noqa: F401

from ontotator.api.app import create_app
from ontotator.api.routes import decode_workspace_id
from ontotator.application.draft_history import DraftHistoryService
from ontotator.application.work_rounds import RoundInputResolutionService
from ontotator.config import AppConfig
from ontotator.domain.documents import OntologyRef
from ontotator.domain.errors import DomainError
from ontotator.domain.workspace import MutationEnvelope
from ontotator.storage.repository import DraftState

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"
PROJECT = "pkg-scenario-a"


@pytest.fixture
def app(tmp_path: Path) -> Any:
    raw = FIXTURE_PATH.read_bytes()
    config = AppConfig(
        workspace_dir=tmp_path,
        database_url=database_url_for(tmp_path / "api.db"),
        ontology_paths=[FIXTURE_PATH],
        ontology_path=FIXTURE_PATH,
        expected_ontology_ref=OntologyRef(
            release="2026-06-23", sha256=hashlib.sha256(raw).hexdigest()
        ),
    )
    app = create_app(config)
    app.state.repo.import_package(make_layered_package("single"))
    return app


@pytest.fixture
def alice(app: Any) -> Any:
    return logged_in(app, "alice", projects={PROJECT: ["annotator"]})


class Editor:
    """The editor of one workspace: commands, history and the revision."""

    def __init__(self, client: Any) -> None:
        self.client = client
        response = client.post(
            "/api/v1/workspaces/open",
            json={"project_key": PROJECT, "document_id": "doc-beta"},
        )
        assert response.status_code == 200, response.text
        self.ws = str(response.json()["workspace_id"])
        self.revision = 0
        self.count = 0

    def send(
        self,
        payload: dict[str, Any],
        *,
        path: str = "commands",
        step: str | None = None,
        status: int = 200,
    ) -> dict[str, Any]:
        self.count += 1
        envelope: dict[str, Any] = {
            "mutation_id": f"m{self.count}",
            "expected_revision": self.revision,
            "payload": payload,
        }
        if step is not None:
            envelope["step_id"] = step
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws}/{path}", json=envelope
        )
        assert response.status_code == status, response.text
        body: dict[str, Any] = response.json()
        if status == 200:
            self.revision = int(body.get("revision", body.get("draft_revision", 0)))
        return body

    def history(self) -> dict[str, Any]:
        response = self.client.get(f"/api/v1/workspaces/{self.ws}/history")
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    def undo(self, *, status: int = 200) -> dict[str, Any]:
        step = self.history()["undo"]["after_revision"]
        return self.send(
            {"command": "undo_step", "step": step}, path="history", status=status
        )

    def redo(self) -> dict[str, Any]:
        step = self.history()["redo"]["after_revision"]
        return self.send({"command": "redo_step", "step": step}, path="history")

    def reset(self, *, status: int = 200) -> dict[str, Any]:
        return self.send({"command": "reset_changes"}, path="history", status=status)


def _create(annotation_id: str, start: int, end: int) -> dict[str, Any]:
    return {
        "command": "create_annotation",
        "annotation_id": annotation_id,
        "layer_id": "hpo-layer",
        "type_id": "phenotype",
        "term_id": "HP:0001252",
        "axes": {"assertion": "present"},
        "evidence_id": f"ev-{annotation_id}",
        "segments": [{"start": start, "end": end}],
    }


def _ids(draft: dict[str, Any]) -> list[str]:
    return sorted(a["annotation"]["annotation_id"] for a in draft["annotations"])


def test_an_empty_draft_has_nothing_to_undo(alice: Any) -> None:
    editor = Editor(alice)
    history = editor.history()
    assert history["available"] is True
    assert history["undo"] is None and history["redo"] is None
    assert history["changed"] is False
    editor.reset(status=422)


def test_undo_and_redo_step_through_the_edits(app: Any, alice: Any) -> None:
    editor = Editor(alice)
    editor.send(_create("a1", 30, 44))
    editor.send(_create("a2", 0, 3))
    editor.send({"command": "delete_draft_annotation", "annotation_id": "a1"})

    history = editor.history()
    assert history["undo"] == {
        "before_revision": 2,
        "after_revision": 3,
        "action": "delete_draft_annotation",
        "outcome": None,
        "annotation_id": "a1",
        "layer_id": "hpo-layer",
        "term_id": "HP:0001252",
        "commands": 1,
    }
    assert history["undo_count"] == 3 and history["changed"] is True

    assert _ids(editor.undo()) == ["a1", "a2"]
    assert _ids(editor.undo()) == ["a1"]
    history = editor.history()
    assert history["undo"]["action"] == "create_annotation"
    assert history["redo"]["after_revision"] == 2
    assert (history["undo_count"], history["redo_count"]) == (1, 2)

    assert _ids(editor.redo()) == ["a1", "a2"]
    assert _ids(editor.redo()) == ["a2"]
    assert editor.history()["redo"] is None

    # Every step is a new edit; nothing in the log is rewritten.
    key = decode_workspace_id(editor.ws)
    events = app.state.repo.edit_events(key)
    assert [e.command.get("command") for e in events] == [
        "create_annotation",
        "create_annotation",
        "delete_draft_annotation",
        "undo_step",
        "undo_step",
        "redo_step",
        "redo_step",
    ]
    assert editor.revision == 7


def test_a_new_edit_drops_the_redo_steps(alice: Any) -> None:
    editor = Editor(alice)
    editor.send(_create("a1", 30, 44))
    editor.send(_create("a2", 0, 3))
    editor.undo()
    assert editor.history()["redo_count"] == 1

    editor.send({"command": "check_layer", "layer_id": "hpo-layer", "checked": True})

    history = editor.history()
    assert history["redo"] is None
    assert history["undo"]["action"] == "check_layer"
    # Undo after the new edit goes back to before it, then before a1.
    editor.undo()
    assert _ids(editor.undo()) == []


def test_commands_of_one_action_are_one_step(alice: Any) -> None:
    editor = Editor(alice)
    editor.send(_create("a1", 30, 44), step="s1")
    editor.send(
        {"command": "set_annotation_note", "annotation_id": "a1", "note": "x"},
        step="s1",
    )
    history = editor.history()
    assert history["undo"]["commands"] == 2 and history["undo_count"] == 1

    assert _ids(editor.undo()) == []
    assert editor.history()["undo"] is None


def test_an_action_that_got_between_joins_the_step(alice: Any) -> None:
    editor = Editor(alice)
    editor.send(_create("a1", 30, 44), step="s1")
    editor.send(_create("a2", 0, 3))
    editor.send(
        {"command": "set_annotation_note", "annotation_id": "a1", "note": "x"},
        step="s1",
    )
    assert editor.history()["undo_count"] == 1
    assert _ids(editor.undo()) == []


def test_reset_returns_to_the_start_and_can_be_undone(alice: Any) -> None:
    editor = Editor(alice)
    editor.send(_create("a1", 30, 44))
    editor.send({"command": "check_layer", "layer_id": "hpo-layer", "checked": True})

    reset = editor.reset()
    assert reset["annotations"] == [] and reset["checked_layer_ids"] == []
    history = editor.history()
    assert history["undo"]["action"] == "reset_changes"
    assert history["changed"] is False
    editor.reset(status=422)

    restored = editor.undo()
    assert _ids(restored) == ["a1"] and restored["checked_layer_ids"] == ["hpo-layer"]


def test_a_step_that_is_no_longer_on_top_is_refused(alice: Any) -> None:
    editor = Editor(alice)
    editor.send(_create("a1", 30, 44))
    editor.send(_create("a2", 0, 3))
    body = editor.send({"command": "undo_step", "step": 1}, path="history", status=422)
    assert body["code"] == "HISTORY_STEP_UNAVAILABLE"
    editor.send({"command": "redo_step", "step": 2}, path="history", status=422)
    editor.send({"command": "undo_step"}, path="history", status=422)


def test_the_history_starts_after_a_submit(app: Any, alice: Any) -> None:
    editor = Editor(alice)
    creation = {
        **_create("a1", 30, 44),
        "axes": {
            "assertion": "present",
            "experiencer": "patient",
            "temporality": "current",
        },
        "chosen_axis_ids": ["assertion", "experiencer", "temporality"],
    }
    editor.send(creation)
    editor.send({"command": "check_layer", "layer_id": "hpo-layer", "checked": True})
    editor.send(
        {"document_checked": True, "checked_layer_ids": ["hpo-layer"]}, path="submit"
    )
    history = DraftHistoryService(app.state.repo).view(decode_workspace_id(editor.ws))
    assert history.undo is None and history.changed is False


def test_the_start_of_a_draft_is_stored_with_it(app: Any, alice: Any) -> None:
    editor = Editor(alice)
    key = decode_workspace_id(editor.ws)
    with app.state.repo.db.transaction() as conn:
        assert app.state.repo._draft_initial_state(conn, key) == DraftState()


def _history_envelope(command: str, revision: int, step: int | None = None) -> Any:
    payload: dict[str, Any] = {"command": command}
    if step is not None:
        payload["step"] = step
    return MutationEnvelope(
        mutation_id=f"h-{command}-{revision}",
        expected_revision=revision,
        payload=payload,
    )


def test_reset_of_a_carried_round_brings_the_carried_findings_back(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    service = DraftHistoryService(scoped)
    draft = RoundInputResolutionService(scoped).resolve(key, _dismiss(item["input_id"]))
    assert all(s.annotation.annotation_id != carried_id for s in draft.annotations)

    reset = service.apply(key, _history_envelope("reset_changes", draft.revision))

    assert [s.annotation.annotation_id for s in reset.annotations] == [carried_id]
    assert reset.round_input_resolutions == []
    assert service.view(key).changed is False


def test_clearing_a_dismissal_after_an_undone_clear_restores_the_finding(rounds):  # noqa: F811
    _repo, scoped, _o, key, item = _ctx(rounds)
    carried_id = item["target_snapshot"]["annotation"]["annotation_id"]
    resolutions = RoundInputResolutionService(scoped)
    service = DraftHistoryService(scoped)
    draft = resolutions.resolve(key, _dismiss(item["input_id"]))
    draft = resolutions.clear(key, _clear(item["input_id"], revision=draft.revision))
    assert [s.annotation.annotation_id for s in draft.annotations] == [carried_id]

    view = service.view(key)
    assert view.undo is not None and view.undo.action == "clear_round_input_resolution"
    draft = service.apply(
        key, _history_envelope("undo_step", draft.revision, view.undo.after_revision)
    )
    assert draft.annotations == [] and len(draft.round_input_resolutions) == 1

    draft = resolutions.clear(
        key, _clear(item["input_id"], revision=draft.revision, mutation_id="u2")
    )
    assert [s.annotation.annotation_id for s in draft.annotations] == [carried_id]


def _complete(input_id: str, annotation_id: str, version: str, revision: int) -> Any:
    return MutationEnvelope(
        mutation_id=f"c-{revision}",
        expected_revision=revision,
        payload={
            "input_id": input_id,
            "outcome": "completed",
            "annotation_ref": {"annotation_id": annotation_id, "version": version},
        },
    )


def test_a_step_on_a_carried_finding_says_check_or_link(rounds):  # noqa: F811
    _repo, scoped, ontology, key, item = _ctx(rounds)
    carried = item["target_snapshot"]["annotation"]
    resolutions = RoundInputResolutionService(scoped)
    service = DraftHistoryService(scoped)
    version = item["target_snapshot"]["version"]
    draft = resolutions.resolve(
        key, _complete(item["input_id"], carried["annotation_id"], version, 0)
    )
    view = service.view(key)
    assert view.undo is not None and view.undo.action == "resolve_round_input"
    assert view.undo.outcome == "checked"

    draft = _apply(
        scoped,
        ontology,
        key,
        draft.revision,
        {
            "command": "create_annotation",
            "annotation_id": "other",
            "layer_id": carried["layer_id"],
            "type_id": carried["type_id"],
            "term_id": carried["term_id"],
            "evidence_id": "other-ev",
            "segments": [{"start": 26, "end": 35}],
        },
    )
    other = next(s for s in draft.annotations if s.annotation.annotation_id == "other")
    draft = resolutions.resolve(
        key, _complete(item["input_id"], "other", other.version, draft.revision)
    )
    view = service.view(key)
    assert view.undo is not None and view.undo.outcome == "linked"
    # Checking the linked finding again is a check, not another link.
    resolutions.resolve(
        key, _complete(item["input_id"], "other", other.version, draft.revision)
    )
    view = service.view(key)
    assert view.undo is not None and view.undo.outcome == "checked"


def test_a_layer_step_says_checked_or_not_checked(alice: Any) -> None:
    editor = Editor(alice)
    editor.send({"command": "check_layer", "layer_id": "hpo-layer", "checked": True})
    assert editor.history()["undo"]["outcome"] == "checked"
    editor.send({"command": "check_layer", "layer_id": "hpo-layer", "checked": False})
    assert editor.history()["undo"]["outcome"] == "unchecked"


def test_the_history_reads_no_states_it_does_not_need(app: Any, alice: Any) -> None:
    """Issue 320 review: a long round is read without every logged state."""
    from sqlalchemy import event

    editor = Editor(alice)
    editor.send(_create("a1", 30, 44))
    for index in range(30):
        editor.send(
            {
                "command": "set_annotation_note",
                "annotation_id": "a1",
                "note": f"n{index}",
            }
        )
    states: list[int] = []

    def count(conn: Any, cursor: Any, statement: str, *_args: Any) -> None:
        if "edit_events.state" in statement:
            states.append(cursor.rowcount)

    engine = app.state.repo.db.engine
    event.listen(engine, "after_cursor_execute", count)
    try:
        history = editor.history()
        editor.undo()
    finally:
        event.remove(engine, "after_cursor_execute", count)
    assert history["undo_count"] == 31
    # A handful of single states (current, before and after the top step), not one per edit.
    assert sum(states) <= 8, states


def test_a_consolidation_has_no_history(rounds):  # noqa: F811
    _repo, scoped, _o, key, _item = _ctx(rounds)
    review = key.model_copy(update={"mode": "review"})
    with pytest.raises(DomainError, match="HISTORY_NOT_AVAILABLE"):
        DraftHistoryService(scoped).apply(review, _history_envelope("reset_changes", 0))
    assert DraftHistoryService(scoped).view(review).available is False


def test_reset_of_a_proposal_check_opens_every_proposal_again(tmp_path: Path) -> None:
    from proposal_check_support import proposal_env
    from test_consolidation_tool_proposals import HEAVY, Workspace

    env = proposal_env(tmp_path)
    anne = Workspace(env, "anno")
    first, second = anne.targets[0], anne.targets[1]
    anne.decide(first, "confirmed")
    anne.decide(second, "rejected")
    anne.create("anne-heavy", HEAVY, HEAVY + len("schwere"), assertion="present")
    history = anne.client.get(f"/api/v1/workspaces/{anne.id}/history").json()
    assert history["undo_count"] == 3 and history["changed"] is True

    # Undo takes back the new finding, then the rejection of the second proposal.
    for _ in range(2):
        top = anne.client.get(f"/api/v1/workspaces/{anne.id}/history").json()["undo"]
        undone = anne.post(
            "history", {"command": "undo_step", "step": top["after_revision"]}
        )
    assert [d["target"]["annotation_id"] for d in undone["decisions"]] == [
        first["annotation_id"]
    ]
    assert undone["annotations"] == []

    reset = anne.post("history", {"command": "reset_changes"})
    assert reset["decisions"] == [] and reset["annotations"] == []
    assert len(reset["targets"]["targets"]) == len(anne.targets)
    view = anne.client.get(f"/api/v1/workspaces/{anne.id}/history").json()
    assert view["undo"]["action"] == "reset_changes" and view["redo"] is None


def test_an_edit_and_replace_copy_is_named_as_one(tmp_path: Path) -> None:
    from proposal_check_support import proposal_env
    from test_consolidation_tool_proposals import FIRST_SEIZURE, Workspace

    env = proposal_env(tmp_path)
    anne = Workspace(env, "anno")
    first = anne.targets[0]
    anne.post(
        "commands",
        {
            "command": "create_annotation",
            "annotation_id": "copy1",
            "evidence_id": "ev-copy1",
            "term_id": "HP:0001250",
            "layer_id": "hpo",
            "type_id": "phenotype",
            "segments": [
                {"start": FIRST_SEIZURE, "end": FIRST_SEIZURE + len("Krampfanfälle")}
            ],
            "source_annotation_id": first["annotation_id"],
            "source_version": first["version"],
        },
        step_id="edit-replace",
    )
    view = anne.client.get(f"/api/v1/workspaces/{anne.id}/history").json()
    assert view["undo"]["action"] == "create_annotation"
    assert view["undo"]["outcome"] == "copy"
