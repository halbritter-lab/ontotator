"""Source-review audit and its exact reviewed text survive real final download."""

import json
import zipfile

import pytest
from t1_builders import bundle, correction_unit
from t1_fixtures import run_import
from test_annotation_versions import seed_submission
from test_translation_review_service import save

from ontotator.application.final_results import FinalResultService
from ontotator.application.translation_workflow import TranslationWorkflowService
from ontotator.auth.audit import Actor

pytest_plugins = ("test_translation_review_service",)


@pytest.mark.parametrize("corrected", [False, True])
def test_final_archive_contains_reviewed_source_and_frozen_resolution(
    review_env, corrected
):
    env = review_env
    update = correction_unit(env.source, "New clinical source reviewed explicitly")
    directory = env.tmp_path / "source-change"
    directory.mkdir()
    imported = run_import(env.db, bundle(directory, [update]))
    assert imported.status == "succeeded", imported.error
    service = TranslationWorkflowService(env.db, env.app.state.jobs)
    [cause] = service.obligations(env.accesses["alice"], env.ids["alice"])
    revision = save(
        env,
        "accepted_corrected" if corrected else "accepted_unchanged",
        "Reviewed German wording" if corrected else "Übersetzt",
    )
    record = service.resolve(
        env.accesses["alice"],
        env.ids["alice"],
        cause["cause_id"],
        expected_revision=revision,
        translation_text_sha256=cause["translation_text_sha256"],
        old_source_text_sha256=cause["old_source_text_sha256"],
        new_source_text_sha256=cause["new_source_text_sha256"],
    )
    document = record.created_variant_id or "target"
    seed_submission(env, "alice", "translation-annotations", document=document)
    access = env.accesses["leader"]
    actor = Actor.user(access.user_id, "leader")
    final = FinalResultService(env.db, actor, access)
    final.select("proj", document, "translation-annotations", 0, [])
    state = final.preflight("proj")
    queued = final.freeze(
        "proj",
        {
            "request_id": "reviewed-source",
            "state_digest": state["state_digest"],
            "acknowledged_warnings": [
                {"id": warning["id"], "cause_revision": warning["cause_revision"]}
                for warning in state["warnings"]
            ],
            "accepted_omissions": state["omissions"],
        },
    )
    queue = env.app.state.jobs
    job = queue.run(queue.claim(queued["job_id"], "test"), "test")
    assert job.status == "succeeded", job.error
    with zipfile.ZipFile(env.db.blobs.path(job.result["sha256"])) as archive:
        receipt = json.loads(archive.read("receipt.json"))
        texts = [
            json.loads(line) for line in archive.read("source-texts.jsonl").splitlines()
        ]
    assert cause["new_source_document_id"] in {
        entry["document"]["document_id"] for entry in texts
    }
    resolution = next(
        item
        for item in receipt["source_reviews"]
        if item["cause_id"] == cause["cause_id"]
    )
    assert (
        resolution["payload"]["cause"]["new_source_text_sha256"]
        == cause["new_source_text_sha256"]
    )
    assert resolution["review_record"]["id"] == record.id
    assert resolution["review_record"]["decision"] == record.decision
    assert (
        resolution["review_record"]["reviewer_pseudonym"]
        == env.accesses["alice"].pseudonym
    )
