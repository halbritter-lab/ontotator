"""Pure codepoint re-anchoring; no database/queue fixtures or target hashes."""

import hashlib
from copy import deepcopy

import pytest
from t1_fixtures import hpo_profile

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.reanchor import (
    Carried,
    NeedsReview,
    TextMap,
    map_span,
    reanchor_annotation,
    text_map,
)


def source(text, mentions=(((0, 3),),), cues=()):
    doc = Document(
        document_id="old",
        text=text,
        language="en",
        text_sha256=hashlib.sha256(text.encode()).hexdigest(),
    )
    evidence = [
        EvidenceSnapshot.create(
            EvidenceMention(
                evidence_id=f"e{i}",
                segments=[Segment(start=a, end=b) for a, b in spans],
                cue_segments=[
                    Segment(start=a, end=b)
                    for a, b in (cues[i] if i < len(cues) else ())
                ],
            ),
            doc,
        )
        for i, spans in enumerate(mentions)
    ]
    annotation = Annotation(
        annotation_id="source-ann",
        document_id="old",
        layer_id="hpo",
        type_id="phenotype",
        term_id="HP:0001250",
        axes_values={"assertion": "present", "experiencer": "patient"},
        axes_defaulted=["experiencer"],
        evidence_refs=[
            EvidenceRef(evidence_id=e.mention.evidence_id, version=e.version)
            for e in evidence
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="original-tool", kind="tool"),
            method="tool",
            source_refs=["urn:original"],
        ),
    )
    return snapshot(annotation, evidence, doc, hpo_profile()), evidence


def run(old, new, mentions=(((0, 3),),), cues=()):
    snap, evidence = source(old, mentions, cues)
    return reanchor_annotation(snap, evidence, old, new, text_map(old, new))


def test_unchanged_text_maps_identically():
    m = text_map("Hypotonie", "Hypotonie")
    assert m == TextMap(((0, 0, 9),))
    assert map_span(m, 0, 9) == (0, 9)
    result = run("Hypotonie", "Hypotonie", (((0, 9),),))
    assert isinstance(result, Carried)
    assert [(s.start, s.end) for s in result.evidence[0].segments] == [(0, 9)]


@pytest.mark.parametrize("prefix", ["Before ", "\U0001d538", "😀"])
def test_offsets_shift_in_codepoints(prefix):
    result = run("Hypotonie", prefix + "Hypotonie", (((0, 9),),))
    assert isinstance(result, Carried)
    assert [(s.start, s.end) for s in result.evidence[0].segments] == [
        (len(prefix), len(prefix) + 9)
    ]


@pytest.mark.parametrize("new", ["HypXtonie", "Xypotonie", "HypotoniX"])
def test_replacement_inside_or_at_either_edge_rejects(new):
    result = run("Hypotonie", new, (((0, 9),),))
    assert isinstance(result, NeedsReview)
    assert result.reason == "changed_segment"
    assert result.old_segments[0].text == "Hypotonie"


def test_one_failed_mention_rejects_whole_annotation():
    result = run("one two three", "one NEW three", (((0, 3),), ((4, 7),)))
    assert isinstance(result, NeedsReview)
    assert len(result.old_mentions) == 2
    assert not hasattr(result, "evidence")


def test_all_discontinuous_segments_and_cues_map():
    result = run(
        "no one and two", "X no one and two", (((3, 6), (11, 14)),), (((0, 2),),)
    )
    assert isinstance(result, Carried)
    assert [(s.start, s.end) for s in result.evidence[0].segments] == [(5, 8), (13, 16)]
    assert [(s.start, s.end) for s in result.evidence[0].cue_segments] == [(2, 4)]


def test_failed_cue_rejects_even_when_mention_maps():
    result = run("no finding", "a finding", (((3, 10),),), (((0, 2),),))
    assert isinstance(result, NeedsReview)
    assert result.reason == "changed_cue"
    assert result.old_context.start == 0
    assert result.old_context.end == 10


@pytest.mark.parametrize(
    "old,new", [("abc", "XYZ"), ("abc", ""), ("", "new"), ("", "")]
)
def test_document_level_always_carries(old, new):
    assert isinstance(run(old, new, ()), Carried)


def test_carry_retains_source_and_basis_but_never_claims_target_snapshot_hashes():
    snap, evidence = source("Hypotonie", (((0, 9),),))
    before = deepcopy(snap.model_dump())
    result = reanchor_annotation(
        snap, evidence, "Hypotonie", "X Hypotonie", text_map("Hypotonie", "X Hypotonie")
    )
    assert isinstance(result, Carried)
    assert snap.model_dump() == before
    assert result.source.model_dump() == before
    assert result.source is not snap
    assert result.source.annotation.axes_defaulted == ["experiencer"]
    assert result.source_ref == AnnotationRef(
        annotation_id=snap.annotation.annotation_id, version=snap.version
    )
    assert result.evidence[0].source_ref == snap.annotation.evidence_refs[0]
    assert not hasattr(result.evidence[0], "version")
    assert not hasattr(result.evidence[0], "document_id")


@pytest.mark.parametrize(
    "case,reason",
    [
        ("missing", "missing_evidence"),
        ("version", "evidence_version_mismatch"),
        ("ambiguous", "ambiguous_evidence"),
    ],
)
def test_reference_integrity_fails_closed(case, reason):
    snap, evidence = source("one")
    if case == "missing":
        evidence = []
    elif case == "version":
        evidence = [evidence[0].model_copy(update={"version": "wrong"})]
    else:
        evidence = evidence + evidence
    result = reanchor_annotation(snap, evidence, "one", "one", text_map("one", "one"))
    assert isinstance(result, NeedsReview)
    assert result.reason == reason


@pytest.mark.parametrize("start,end", [(-1, 1), (1, 1), (2, 1)])
def test_invalid_span_bounds_raise_explicitly(start, end):
    with pytest.raises(ValueError):
        map_span(text_map("abc", "abc"), start, end)


def test_out_of_range_evidence_is_not_silently_clamped_into_a_valid_carry():
    snap, evidence = source("one")
    evidence[0].mention.segments[0].end = 99
    result = reanchor_annotation(snap, evidence, "one", "one", text_map("one", "one"))
    assert isinstance(result, NeedsReview)
    assert result.reason == "invalid_bounds"
    assert 0 <= result.old_context.start <= result.old_context.end <= 3


def test_exact_text_recheck_refuses_a_forged_equal_block():
    snap, evidence = source("one")
    result = reanchor_annotation(snap, evidence, "one", "two", TextMap(((0, 0, 3),)))
    assert isinstance(result, NeedsReview)
    assert result.reason == "changed_segment"


def test_context_windows_include_whole_words_with_exact_unicode_offsets():
    prefix = "😀 clinical background " * 6
    suffix = " unchanged contextual information" * 6
    old = prefix + "Ataxia" + suffix
    new = prefix + "Tremor" + suffix
    result = run(old, new, (((len(prefix), len(prefix) + 6),),))
    assert isinstance(result, NeedsReview)
    for text, window in ((old, result.old_context), (new, result.new_context)):
        assert (
            window.start == 0
            or text[window.start - 1].isspace()
            or text[window.start].isspace()
        )
        assert (
            window.end == len(text)
            or text[window.end].isspace()
            or text[window.end - 1].isspace()
        )
        assert window.text == text[window.start : window.end]
        assert len(prefix) - 72 <= window.start <= len(prefix) - 40
        assert len(prefix) + 46 <= window.end <= len(prefix) + 78
    assert "".join(op.old_text for op in result.diff) == result.old_context.text
    assert "".join(op.new_text for op in result.diff) == result.new_context.text


def test_long_unbroken_contexts_stay_bounded_with_exact_absolute_diff_positions():
    old = "A" * 100 + "one" + "Z" * 100
    new = "A" * 100 + "TWO LONGER" + "Z" * 100
    result = run(old, new, (((100, 103),),))
    assert isinstance(result, NeedsReview)
    assert (result.old_context.start, result.old_context.end) == (60, 143)
    assert (result.new_context.start, result.new_context.end) == (60, 150)
    assert result.old_context.text == old[60:143]
    assert result.new_context.text == new[60:150]
    assert "".join(op.old_text for op in result.diff) == result.old_context.text
    assert "".join(op.new_text for op in result.diff) == result.new_context.text
    assert {op.op for op in result.diff} == {"equal", "replace"}
    for op in result.diff:
        assert op.old_text == old[op.old_start : op.old_end]
        assert op.new_text == new[op.new_start : op.new_end]


@pytest.mark.parametrize("old,new", [("abc", "XYZ"), ("abc", ""), ("abc", "zabcX")])
def test_contexts_at_text_boundaries_and_all_changed_are_bounded(old, new):
    result = run(old, new)
    if isinstance(result, NeedsReview):
        assert result.old_context.text == old
        assert result.new_context.text == new
        assert (result.new_context.start, result.new_context.end) == (0, len(new))


def test_empty_text_map_and_repeated_text_follow_only_sequence_matcher():
    assert text_map("", "").blocks == ()
    assert map_span(text_map("", ""), 0, 1) is None
    old = "same repeat same"
    new = "same changed same"
    m = text_map(old, new)
    assert map_span(m, 5, 11) is None
    assert map_span(m, 12, 16) == (13, 17)


@pytest.mark.parametrize(
    "old,new,expected",
    [("abc", "aXbc", "insert"), ("abc", "ac", "delete"), ("abc", "XYZ", "replace")],
)
def test_changed_windows_preserve_each_typed_opcode(old, new, expected):
    result = run(old, new)
    assert isinstance(result, NeedsReview)
    assert expected in {opcode.op for opcode in result.diff}
    assert "".join(op.old_text for op in result.diff) == old
    assert "".join(op.new_text for op in result.diff) == new


def test_repetitive_text_does_not_enable_sequence_matcher_autojunk():
    m = text_map("A" * 400, "B" + "A" * 400)
    assert map_span(m, 200, 260) == (201, 261)


def test_cue_positions_extend_context_envelope():
    old = "C" * 20 + "no" + "A" * 80 + "finding" + "Z" * 80
    new = old.replace("finding", "CHANGED")
    result = run(old, new, (((102, 109),),), (((20, 22),),))
    assert isinstance(result, NeedsReview)
    assert result.old_context.start == 0
    assert result.old_context.end == 149
    assert [(s.start, s.end, s.text) for s in result.old_segments] == [
        (102, 109, "finding"),
        (20, 22, "no"),
    ]


def test_incorrect_source_text_cannot_produce_a_valid_carry():
    snap, evidence = source("one")
    result = reanchor_annotation(snap, evidence, "two", "two", text_map("two", "two"))
    assert isinstance(result, NeedsReview)
    assert result.reason == "source_text_mismatch"


@pytest.mark.parametrize(
    "update", [{"document_id": "other"}, {"text_sha256": "other-hash"}]
)
def test_evidence_from_a_different_source_is_not_carried(update):
    snap, evidence = source("one")
    result = reanchor_annotation(
        snap,
        [evidence[0].model_copy(update=update)],
        "one",
        "one",
        text_map("one", "one"),
    )
    assert isinstance(result, NeedsReview)
    assert result.reason == "evidence_source_mismatch"


@pytest.mark.parametrize("new", ["X one", "CHANGED"])
def test_both_result_paths_leave_original_snapshot_and_evidence_untouched(new):
    snap, evidence = source("one")
    original_snapshot = deepcopy(snap.model_dump())
    original_evidence = [deepcopy(e.model_dump()) for e in evidence]
    result = reanchor_annotation(snap, evidence, "one", new, text_map("one", new))
    assert snap.model_dump() == original_snapshot
    assert [e.model_dump() for e in evidence] == original_evidence
    if isinstance(result, Carried):
        result.source.annotation.axes_values["assertion"] = "absent"
        assert snap.model_dump() == original_snapshot
