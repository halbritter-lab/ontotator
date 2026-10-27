"""New runtime reconstruction contracts, without database or pure-bank repetition."""

from copy import deepcopy
from datetime import UTC, datetime

import ontospan
import pytest
from t1_fixtures import HP_PATH, PIN, TEXT, annotation, hpo_profile, unit

from ontotator.api.variant_routes import ReanchorItem
from ontotator.domain.documents import Document
from ontotator.exchange.reanchor_job import ReanchorSource, rebuild_source
from ontotator.exchange.t1 import document_from_unit, unit_to_proposals


def inputs(text=TEXT, annotations=None):
    original = unit(text=text, annotations=annotations)
    doc = document_from_unit(original)
    proposals = unit_to_proposals(
        original, hpo_profile(), doc, bundle_id="original-bundle"
    )
    source = ReanchorSource(
        7,
        original.annotation_set.annotation_set_id,
        "original-bundle",
        original.annotation_set.model_dump(mode="json"),
        tuple(proposals.annotations),
        proposals.notes,
    )
    return original, doc, source


def build(source, old, new):
    return rebuild_source(
        "proj",
        source,
        old,
        Document(
            document_id="target",
            language=old.language,
            **ontospan.make_document("target", old.language, new).model_dump(
                include={"text", "text_sha256"}
            ),
        ),
        hpo_profile(),
        {"hp": PIN},
        created_at=datetime(2026, 10, 16, tzinfo=UTC),
    )


def test_reconstruction_recomputes_real_target_snapshots_and_valid_t1_with_basis_notes():
    original, old, source = inputs()
    before = deepcopy(source.payload)
    item, payload = build(source, old, "Prefix " + TEXT)
    assert item.origin == "reanchor" and item.document_id == "target"
    assert item.annotation_set_id == "proj:reanchor:target:7"
    assert item.bundle_id is None and item.manifest_sha256 is None
    assert source.payload == before
    assert len(item.proposals.annotations) == 2
    for index, snap in enumerate(item.proposals.annotations):
        previous = source.annotations[index]
        assert snap.document_id == "target"
        assert snap.version != previous.version
        assert snap.text_sha256 != previous.text_sha256
        assert snap.annotation.axes_values == previous.annotation.axes_values
        assert snap.annotation.axes_defaulted == previous.annotation.axes_defaulted
        assert snap.annotation.type_id == previous.annotation.type_id
        assert snap.annotation.provenance.source_refs == [
            previous.annotation.annotation_id
        ]
        assert snap.annotation.provenance.actor.actor_id == "ontotator-reanchor"
        assert item.proposals.notes[snap.annotation.annotation_id] == ["score 0.91"]
        assert snap.evidence[0].version != previous.evidence[0].version
    aset = payload.annotation_set
    assert aset.actors[0].name == "ontotator-reanchor"
    assert aset.annotations[0].axes["experiencer"].basis == "defaulted"
    assert aset.annotations[0].provenance.notes == ("score 0.91",)
    assert original.annotation_set.actors[0].model == "bge-m3"
    assert original.annotation_set.actors[0].run_id == "run-7"
    report = ontospan.validate(payload, {"hp": ontospan.ObographOntology.load(HP_PATH)})
    assert report.ok, report.issues
    rebuilt = unit_to_proposals(
        payload,
        hpo_profile(),
        Document(
            document_id="target",
            text=payload.document.text,
            language="de",
            text_sha256=payload.document.text_sha256,
        ),
        bundle_id=None,
    )
    assert [s.model_dump() for s in rebuilt.annotations] == [
        s.model_dump() for s in item.proposals.annotations
    ]


def test_pending_payload_matches_actual_task4_dto_with_absolute_positions_and_cues():
    text = "no finding"
    data = annotation("p1", (3, 10), text=text)
    data["mentions"][0]["cue_segments"] = [{"start": 0, "end": 2, "text": "no"}]
    _original, old, source = inputs(text, [data])
    item, _payload = build(source, old, "a finding")
    assert item.proposals.annotations == []
    assert len(item.pending_items) == 1
    result = ReanchorItem.model_validate(
        {**item.pending_items[0], "proposal_set_id": 19}
    )
    assert result.reason == "changed_cue"
    assert [(s.start, s.end, s.text) for s in result.old_segments] == [
        (3, 10, "finding"),
        (0, 2, "no"),
    ]
    assert result.old_context.text == text
    assert result.new_context.text == "a finding"
    assert (
        result.source_ref.annotation_id
        == source.annotations[0].annotation.annotation_id
    )
    assert result.model_dump(mode="json")["old_segments"][1]["text"] == "no"


def test_source_order_controls_annotation_ids_even_when_first_item_needs_review():
    _original, old, source = inputs()
    new = TEXT[:6] + "X" + TEXT[7:]
    item, _payload = build(source, old, new)
    assert len(item.pending_items) == 1
    assert item.proposals.annotations[
        0
    ].annotation.annotation_id == ontospan.annotation_ref(item.annotation_set_id, "a2")


def test_empty_source_has_no_generated_set():
    _original, old, source = inputs(annotations=[])
    assert build(source, old, old.text) == (None, None)


@pytest.mark.parametrize(
    "change",
    [
        {"project": ""},
        {"producer": {"kind": "import", "job_id": 0}},
        {"producer": {"kind": "translation_review", "review_id": True}},
        {"producer": {"kind": "import", "job_id": 1, "force_admin": True}},
        {"mode": "review"},
    ],
)
def test_server_owned_payload_rejects_untyped_or_override_authority(change):
    from pydantic import ValidationError

    from ontotator.exchange.reanchor_job import ReanchorPayload

    value = {
        "project": "proj",
        "old_document_id": "old",
        "new_document_id": "new",
        "producer": {"kind": "import", "job_id": 1},
        **change,
    }
    with pytest.raises(ValidationError):
        ReanchorPayload.model_validate(value)


def test_registry_contains_the_actual_handler_not_a_placeholder():
    from ontotator.exchange.jobs import HANDLERS
    from ontotator.exchange.reanchor_job import reanchor

    assert HANDLERS["reanchor"] is reanchor


def test_corrupt_source_positions_are_not_persisted_as_invalid_typed_pending_json():
    from ontotator.domain.errors import DomainError

    _original, old, source = inputs()
    source.annotations[0].evidence[0].mention.segments[0].end = 9999
    with pytest.raises(DomainError, match="T1_INVALID"):
        build(source, old, "Prefix " + TEXT)
