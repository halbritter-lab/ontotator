"""Read-only facts on work rounds, carried inputs and carry sources."""

import pytest
from pg_harness import owner_engine
from sqlalchemy import select, text, update
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
from ontocurator.domain.errors import DomainError
from ontocurator.domain.reanchor import NeedsReview
from ontocurator.domain.work_rounds import RoundInputView
from ontocurator.domain.workspace import MutationEnvelope
from ontocurator.storage.workflow_tables import RoundInputRow


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
        # No needs-review reason to keep, so no ``review_reasons`` map either.
        assert set(item) == {"round", "inputs", "submission_ids"}
        assert set(item["round"]) == round_keys
        assert all(set(i) == input_keys for i in item["inputs"])
    assert len(history[carried.round_id]["inputs"]) == 1


ARCHIVED_INPUT_KEYS = {
    "input_id",
    "source_submission_id",
    "source_ref",
    "source_snapshot",
    "target_snapshot",
    "mapping_status",
}


def _needs_review_round(rounds):  # noqa: F811
    """A carried round whose one input needs review for ``changed_segment``.

    Stored inputs are immutable for the app role; the schema owner rewrites the
    one mapped input as a needs-review input (as a corrected text produces).
    """
    repo, _assignment, _first, _submission, carried = _submit_first_round(rounds)
    table = f"{RoundInputRow.__table__.schema}.{RoundInputRow.__tablename__}"
    with owner_engine(repo.db).begin() as conn:
        conn.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER USER"))
        row = conn.execute(
            select(RoundInputRow.input_id, RoundInputRow.payload).where(
                RoundInputRow.round_id == carried.round_id
            )
        ).one()
        conn.execute(
            update(RoundInputRow)
            .where(RoundInputRow.input_id == row.input_id)
            .values(
                payload=dict(row.payload)
                | {
                    "mapping_status": "needs_review",
                    "target_snapshot": None,
                    "review_reason": "changed_segment",
                }
            )
        )
        conn.execute(text(f"ALTER TABLE {table} ENABLE TRIGGER USER"))
    return repo, carried, row.input_id


def _clone(package, package_id):  # type: ignore[no-untyped-def]
    return package.model_copy(
        update={
            "manifest": package.manifest.model_copy(update={"package_id": package_id})
        }
    )


def test_archived_needs_review_input_keeps_its_review_reason(rounds):  # noqa: F811
    repo, carried, input_id = _needs_review_round(rounds)
    package = repo.export_package("pkg-1")
    archived = package.manifest.workflow_history[carried.round_id]
    # The inputs keep the old archived shape (older readers validate them with
    # extra="forbid"); the reason travels in a sibling map they never read.
    assert all(set(i) == ARCHIVED_INPUT_KEYS for i in archived["inputs"])
    assert archived["review_reasons"] == {input_id: "changed_segment"}
    clone = _clone(package, "roundtrip")
    repo.import_package(clone)
    [item] = repo.get_round_input_inventory("roundtrip", carried.round_id)
    view = RoundInputView.model_validate(item)
    assert (view.mapping_status, view.review_reason) == (
        "needs_review",
        "changed_segment",
    )
    # A re-export of the imported project keeps the reason unchanged.
    again = repo.export_package("roundtrip")
    assert again.manifest.workflow_history == clone.manifest.workflow_history


def test_older_package_without_review_reasons_still_imports(rounds):  # noqa: F811
    repo, carried, _input_id = _needs_review_round(rounds)
    package = repo.export_package("pkg-1")
    history = {
        rid: {k: v for k, v in archived.items() if k != "review_reasons"}
        for rid, archived in package.manifest.workflow_history.items()
    }
    old = package.model_copy(
        update={
            "manifest": package.manifest.model_copy(
                update={"package_id": "older", "workflow_history": history}
            )
        }
    )
    repo.import_package(old)
    [item] = repo.get_round_input_inventory("older", carried.round_id)
    view = RoundInputView.model_validate(item)
    assert (view.mapping_status, view.review_reason) == ("needs_review", None)


def test_review_reason_for_an_unknown_input_is_refused(rounds):  # noqa: F811
    repo, carried, _input_id = _needs_review_round(rounds)
    package = repo.export_package("pkg-1")
    history = dict(package.manifest.workflow_history)
    history[carried.round_id] = dict(history[carried.round_id]) | {
        "review_reasons": {"no-such-input": "changed_segment"}
    }
    with pytest.raises((DomainError, ValueError)):
        type(package).model_validate(
            package.model_dump()
            | {
                "manifest": package.manifest.model_copy(
                    update={"package_id": "bad", "workflow_history": history}
                )
            }
        )
