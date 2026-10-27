"""Deliberate accepted-text corrections and exact source confirmations."""

import pytest
from auth_harness import HARNESS
from t1_builders import bundle, correction_unit
from t1_fixtures import run_import
from test_translation_review_service import review_env as review_env
from test_translation_review_service import save

from ontotator.application.translation_workflow import TranslationWorkflowService
from ontotator.domain.errors import DomainError


def test_repeat_review_clears_previous_submission_pointer(review_env):
    env = review_env
    revision = save(env, "accepted_unchanged")
    original = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    target = env.app.state.repo.get_variant("proj", "target")
    assignment = TranslationWorkflowService(
        env.db, env.app.state.jobs
    ).assign_correction(
        HARNESS,
        "proj",
        "target",
        "alice",
        expected_text_sha256=target.text_sha256,
        reason="Review accepted text again",
        confirm_language=True,
    )
    assert assignment.id == env.ids["alice"]
    assert assignment.last_submission_id is None
    assert assignment.active_round_id is not None
    assert env.service.records(env.accesses["alice"], "proj", "target")[0] == original


def test_accepted_translation_can_be_corrected_again_without_rewriting_history(
    review_env,
):
    env = review_env
    service = TranslationWorkflowService(env.db, env.app.state.jobs)
    revision = save(env, "accepted_corrected", "First correction")
    original = env.service.submit(
        env.accesses["alice"], env.ids["alice"], expected_revision=revision
    )
    child = env.app.state.repo.get_variant("proj", original.created_variant_id)
    assignment = service.assign_correction(
        HARNESS,
        "proj",
        child.document_id,
        "alice",
        expected_text_sha256=child.text_sha256,
        reason="Review wording again",
        confirm_language=True,
    )
    revision = env.service.save_draft(
        env.accesses["alice"],
        assignment.id,
        expected_revision=0,
        text="Second correction",
        form={"decision": "accepted_corrected", "clinical_change": False},
    )
    latest = env.service.submit(
        env.accesses["alice"], assignment.id, expected_revision=revision
    )
    assert latest.created_variant_id != original.created_variant_id
    assert (
        env.app.state.repo.get_variant("proj", latest.created_variant_id).derived_from
        == child.document_id
    )
    assert env.service.records(env.accesses["alice"], "proj", "target")[0] == original
    with pytest.raises(DomainError, match="VARIANT_REVIEW_STALE"):
        service.assign_correction(
            HARNESS,
            "proj",
            child.document_id,
            "alice",
            expected_text_sha256=child.text_sha256,
            reason="Stale",
            confirm_language=True,
        )


@pytest.mark.parametrize("corrected", [False, True])
def test_no_change_resolves_only_exact_displayed_source_edge(review_env, corrected):
    env = review_env
    first = correction_unit(env.source, "Updated source")
    second = correction_unit(first, "Updated source again")
    additions = env.tmp_path / "source-updates"
    additions.mkdir()
    result = run_import(env.db, bundle(additions, [first, second]))
    assert result.status == "succeeded", result.error
    service = TranslationWorkflowService(env.db, env.app.state.jobs)
    obligations = service.obligations(env.accesses["alice"], env.ids["alice"])
    assert len(obligations) == 2
    shown = obligations[0]
    revision = (
        save(env, "accepted_corrected", "Updated translation")
        if corrected
        else save(env)
    )
    body = {
        key: shown[key]
        for key in (
            "translation_text_sha256",
            "old_source_text_sha256",
            "new_source_text_sha256",
        )
    }
    with pytest.raises(DomainError, match="REVISION_CONFLICT"):
        service.resolve(
            env.accesses["alice"],
            env.ids["alice"],
            shown["cause_id"],
            expected_revision=revision,
            **{**body, "new_source_text_sha256": "0" * 64},
        )
    with pytest.raises(DomainError, match="ASSIGNMENT_NOT_FOUND"):
        service.obligations(env.accesses["bob"], env.ids["alice"])
    record = service.resolve(
        env.accesses["alice"],
        env.ids["alice"],
        shown["cause_id"],
        expected_revision=revision,
        **body,
    )
    assert record.decision == (
        "accepted_corrected" if corrected else "accepted_unchanged"
    )
    remaining = env.app.state.repo.list_workflow_causes("proj")
    target = [
        item
        for item in remaining
        if item["document_id"] == (record.created_variant_id or "target")
    ]
    assert len(target) == 1 and target[0]["cause_id"] != shown["cause_id"]
    current_document = record.created_variant_id or "target"
    variant = env.app.state.repo.get_variant("proj", current_document)
    followup = service.assign_correction(
        HARNESS,
        "proj",
        current_document,
        "alice",
        expected_text_sha256=variant.text_sha256,
        reason="Review the remaining source edge",
        confirm_language=True,
    )
    if not corrected:
        assert followup.id == env.ids["alice"]
    opened = env.service.open(env.accesses["alice"], followup.id)
    followup_revision = env.service.save_draft(
        env.accesses["alice"],
        followup.id,
        expected_revision=opened.draft.revision,
        text=opened.text,
        form={
            "decision": "accepted_unchanged",
            "clinical_change": False,
            "rationale": "Checked.",
        },
    )
    (last,) = service.obligations(env.accesses["alice"], followup.id)
    finished = service.resolve(
        env.accesses["alice"],
        followup.id,
        last["cause_id"],
        expected_revision=followup_revision,
        **{key: last[key] for key in body},
    )
    assert finished.id != record.id
    assert service.obligations(env.accesses["alice"], followup.id) == []
