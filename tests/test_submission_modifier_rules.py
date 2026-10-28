"""Submit rules and warnings for modifiers (C5)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import update

from ontotator.application.submissions import SubmissionService
from ontotator.domain.errors import DomainError
from ontotator.domain.workspace import MutationEnvelope, WorkspaceKey
from ontotator.storage.tables import ProjectRow

SUBMIT = {"document_checked": True, "checked_layer_ids": ["hpo-layer"]}


def test_warnings_and_digest_without_modifiers_are_unchanged(tmp_path: Path) -> None:
    """Recorded on the unchanged code: a draft with one defaulted value."""
    from test_editing import _setup_test_env

    repo, ontology, workspaces, editor, _ = _setup_test_env(tmp_path)
    with repo.db.transaction() as conn:
        conn.execute(
            update(ProjectRow).values(
                creation_defaults={"hpo-layer": {"phenotype": {"assertion": "present"}}}
            )
        )
    view = workspaces.open(
        WorkspaceKey(
            project_key="pkg-1",
            document_id="doc-1",
            annotator_id="a",
            mode="independent",
            target_set_id="targets-0",
        )
    )
    editor.apply(
        view.key,
        MutationEnvelope(
            mutation_id="create",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "own",
                "term_id": "HP:0001252",
                "note": "Document-level finding",
                "chosen_axis_ids": [],
            },
        ),
    )
    with pytest.raises(DomainError) as refused:
        SubmissionService(repo, ontology).submit(
            view.key,
            MutationEnvelope(mutation_id="s", expected_revision=1, payload=SUBMIT),
        )
    assert refused.value.code == "AXIS_CONFIRMATION_WARNING"
    assert refused.value.details == {
        "warnings": [
            {
                "annotation_id": "own",
                "rule": "axis_not_chosen",
                "detail": {"axis": "assertion"},
            }
        ],
        "acknowledgement": {
            "draft_revision": 1,
            "policy_revision": 1,
            "warning_digest": "69100ed8e046072e8071459539e1771965752ef9084faf4f810ae08a0635e425",
        },
    }


AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def _modifier_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    from test_editing_modifiers import KRAMPF, _env, seg

    env = _env(tmp_path)
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "a1",
            "term_id": "HP:0001250",
            "segments": [seg(KRAMPF)],
            "axes_values": AXES,
        }
    )
    return env


def _submit(env: Any, acknowledgement: dict[str, Any] | None = None) -> Any:
    payload: dict[str, Any] = {"document_checked": True, "checked_layer_ids": ["hpo"]}
    if acknowledgement is not None:
        payload["warning_acknowledgement"] = acknowledgement
    return SubmissionService(env.repo, env.ontology).submit(
        env.key,
        MutationEnvelope(
            mutation_id=f"s-{env.revision}-{acknowledgement is not None}",
            expected_revision=env.revision,
            payload=payload,
        ),
    )


def _refused(env: Any, acknowledgement: dict[str, Any] | None = None) -> DomainError:
    with pytest.raises(DomainError) as refused:
        _submit(env, acknowledgement)
    return refused.value


def _add(env: Any, *terms: str) -> None:
    for term in terms:
        env.run({"command": "add_modifier", "annotation_id": "a1", "term_id": term})


def test_standalone_modifier_finding_warns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _modifier_env(tmp_path, monkeypatch)
    env.run(
        {
            "command": "create_annotation",
            "annotation_id": "old",
            "term_id": "HP:0012828",
            "segments": [{"start": 25, "end": 32}],
            "axes_values": AXES,
        }
    )
    refused = _refused(env)
    assert refused.code == "AXIS_CONFIRMATION_WARNING"
    assert refused.details["warnings"] == [
        {
            "annotation_id": "old",
            "rule": "modifier_as_finding",
            "detail": {"term_id": "HP:0012828"},
        }
    ]
    submitted = _submit(env, refused.details["acknowledgement"])
    assert "HP:0012828" in [s.annotation.term_id for s in submitted.snapshots]


def test_cohort_modifier_warning_is_acknowledged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _modifier_env(tmp_path, monkeypatch)
    _add(env, "HP:0040282")
    refused = _refused(env)
    assert refused.code == "AXIS_CONFIRMATION_WARNING"
    assert refused.details["warnings"] == [
        {
            "annotation_id": "a1",
            "rule": "cohort_modifier",
            "detail": {"term_id": "HP:0040282"},
        }
    ]
    submitted = _submit(env, refused.details["acknowledgement"])
    assert [m.term_id for m in submitted.snapshots[0].annotation.modifiers] == [
        "HP:0040282"
    ]


def test_two_severities_warn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env = _modifier_env(tmp_path, monkeypatch)
    _add(env, "HP:0012825", "HP:0012828", "HP:0031796")
    refused = _refused(env)
    assert refused.details["warnings"] == [
        {
            "annotation_id": "a1",
            "rule": "exclusive_modifier_class",
            "detail": {"class": "severity"},
        }
    ]


def test_modifier_warnings_need_acknowledgement_with_require_chosen_axes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env = _modifier_env(tmp_path, monkeypatch)
    _add(env, "HP:0040282")
    with env.repo.db.transaction() as conn:
        conn.execute(update(ProjectRow).values(require_chosen_axes=True))
    refused = _refused(env)
    assert refused.code == "AXIS_CONFIRMATION_WARNING"
    assert [w["rule"] for w in refused.details["warnings"]] == ["cohort_modifier"]
    _submit(env, refused.details["acknowledgement"])


@pytest.mark.parametrize(
    ("term", "code"), [("HP:9999999", "UNKNOWN_TERM"), ("HP:0000123", "OBSOLETE_TERM")]
)
def test_unknown_or_obsolete_modifier_blocks_submit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, term: str, code: str
) -> None:
    env = _modifier_env(tmp_path, monkeypatch)
    with monkeypatch.context() as patched:
        # Old data: the command refuses these terms now.
        patched.setattr(env.editor, "_modifier_term", lambda s, c, t: t)
        _add(env, term)
    refused = _refused(env)
    assert refused.code == code
    assert f"modifier {term} of HP:0001250" in str(refused.details)
