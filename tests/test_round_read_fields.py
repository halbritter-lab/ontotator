"""Read-only facts on work rounds, carried inputs and carry sources."""

from test_reanchor import run, source
from test_work_rounds import rounds  # noqa: F401  (fixture reuse)

from ontocurator.application.editing import EditingService
from ontocurator.application.round_reads import (
    enrich_inputs,
    enrich_rounds,
    enrich_sources,
)
from ontocurator.application.submissions import SubmissionService
from ontocurator.application.work_rounds import WorkRoundService, _input_payload
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.reanchor import NeedsReview
from ontocurator.domain.work_rounds import RoundInputView
from ontocurator.domain.workspace import MutationEnvelope


def _submit_first_round(rounds):  # noqa: F811
    repo, access, actor, assignment, ontology = rounds
    scoped = ScopedRepository(repo.db, access, actor)
    service = WorkRoundService(repo.db)
    first = service.create(
        access, actor, assignment.id, request_id="r1", expected_workflow_revision=0
    )
    created = EditingService(scoped, ontology).apply(
        first.workspace_key,
        MutationEnvelope(
            mutation_id="c",
            expected_revision=0,
            payload={
                "command": "create_annotation",
                "annotation_id": "a",
                "term_id": "HP:0001252",
                "axes_values": {"assertion": "present"},
                "chosen_axis_ids": ["assertion"],
                "note": "N",
            },
        ),
    )
    submission = SubmissionService(scoped, ontology).submit(
        first.workspace_key,
        MutationEnvelope(
            mutation_id="s",
            expected_revision=created.revision,
            payload={"document_checked": True},
        ),
    )
    carried = service.create(
        access,
        actor,
        assignment.id,
        request_id="r2",
        expected_workflow_revision=1,
        kind="carry_forward",
        source_submission_ids=[submission.submission_id],
    )
    return repo, assignment, first, submission, carried


def test_rounds_have_ordinals_counts_times_and_text_identity(rounds):  # noqa: F811
    repo, _assignment, first, _submission, carried = _submit_first_round(rounds)
    views = enrich_rounds(
        repo,
        "pkg-1",
        [
            repo.get_work_round("pkg-1", first.round_id),
            repo.get_work_round("pkg-1", carried.round_id),
        ],
    )
    one, two = views
    assert (one.round_ordinal, two.round_ordinal) == (1, 2)
    assert one.submission_count == 1 and two.submission_count == 0
    assert (
        one.latest_submission_recorded_at is not None
        and two.latest_submission_recorded_at is None
    )
    assert one.input_count == 0 and two.input_count == 1
    assert one.source_round_ordinal is None and two.source_round_ordinal == 1
    assert two.source_submission_recorded_at == one.latest_submission_recorded_at
    assert (
        two.created_at is not None
        and two.document_language == "en"
        and two.document_version == 1
    )


def test_enrichment_leaves_the_stored_round_unchanged(rounds):  # noqa: F811
    repo, _assignment, first, _submission, _carried = _submit_first_round(rounds)
    stored = repo.get_work_round("pkg-1", first.round_id)
    [view] = enrich_rounds(repo, "pkg-1", [stored])
    assert view.model_copy(
        update={
            "round_ordinal": None,
            "created_at": None,
            "submission_count": 0,
            "latest_submission_recorded_at": None,
            "document_language": None,
            "document_version": None,
        }
    ) == repo.get_work_round("pkg-1", first.round_id)
    assert enrich_rounds(repo, "pkg-1", []) == []


def test_inputs_have_source_round_time_language_version(rounds):  # noqa: F811
    repo, _assignment, _first, _submission, carried = _submit_first_round(rounds)
    [item] = enrich_inputs(
        repo, "pkg-1", repo.get_round_input_inventory("pkg-1", carried.round_id)
    )
    assert item.source_round_ordinal == 1
    assert item.source_recorded_at is not None
    assert (item.source_language, item.source_version) == ("en", 1)
    assert item.review_reason is None  # mapped input
    assert item.mapping_status == "carried"


def test_sources_have_round_ordinal_server_time_and_finding_count(rounds):  # noqa: F811
    repo, _assignment, _first, submission, _carried = _submit_first_round(rounds)
    [source_facts] = enrich_sources(repo, "pkg-1", [submission.submission_id])
    assert source_facts["round_ordinal"] == 1 and source_facts["finding_count"] == 1
    assert source_facts["recorded_at"] is not None
    assert enrich_sources(repo, "pkg-1", ["unknown"]) == [
        {"round_ordinal": None, "recorded_at": None, "finding_count": 0}
    ]


def test_needs_review_input_stores_its_review_reason():
    original, _evidence = source("Hypotonie", (((0, 9),),))
    mapped = run("Hypotonie", "HypXtonie", (((0, 9),),))
    assert isinstance(mapped, NeedsReview)
    payload = _input_payload("iid", "sid", original, None, mapped)
    assert payload["mapping_status"] == "needs_review"
    assert payload["review_reason"] == "changed_segment"
    item = RoundInputView.model_validate(payload)
    assert item.review_reason == "changed_segment"


def test_stored_input_without_review_reason_still_decodes():
    original, _evidence = source("Hypotonie", (((0, 9),),))
    mapped = run("Hypotonie", "HypXtonie", (((0, 9),),))
    payload = _input_payload("iid", "sid", original, None, mapped)
    del payload["review_reason"]
    assert RoundInputView.model_validate(payload).review_reason is None


def test_package_archive_keeps_the_round_format_without_read_facts(rounds):  # noqa: F811
    repo, _assignment, first, _submission, carried = _submit_first_round(rounds)
    history = repo.export_package("pkg-1").manifest.workflow_history
    assert history is not None and set(history) == {first.round_id, carried.round_id}
    # Exactly the archived keys as before the read facts existed: older readers
    # validate with extra="forbid".
    round_keys = {
        "round_id",
        "project_key",
        "assignment_id",
        "document_id",
        "annotator_id",
        "kind",
        "mode",
        "state",
        "workflow_revision",
        "latest_submission_id",
        "predecessor_round_id",
        "input_manifest_sha256",
        "input_submission_ids",
        "workspace_key",
        "active",
    }
    input_keys = {
        "input_id",
        "source_submission_id",
        "source_ref",
        "source_snapshot",
        "target_snapshot",
        "mapping_status",
    }
    for item in history.values():
        assert set(item["round"]) == round_keys
        assert all(set(i) == input_keys for i in item["inputs"])
    assert len(history[carried.round_id]["inputs"]) == 1
