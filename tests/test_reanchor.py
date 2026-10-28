"""Pure codepoint re-anchoring; no database/queue fixtures or target hashes."""

import hashlib
from copy import deepcopy

import pytest
from t1_fixtures import hpo_profile

from ontotator.domain.annotations import (
    ActorRef,
    Annotation,
    AnnotationRef,
    Modifier,
    Provenance,
    snapshot,
)
from ontotator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontotator.domain.reanchor import (
    Carried,
    MappedModifier,
    NeedsReview,
    OldModifier,
    Span,
    TextMap,
    TextSpan,
    map_span,
    reanchor_annotation,
    text_map,
)


def source(text, mentions=(((0, 3),),), cues=(), modifiers=()):
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
        modifiers=[
            Modifier(term_id=t, segments=[Segment(start=a, end=b) for a, b in spans])
            for t, spans in modifiers
        ],
        provenance=Provenance(
            actor=ActorRef(actor_id="original-tool", kind="tool"),
            method="tool",
            source_refs=["urn:original"],
        ),
    )
    return snapshot(annotation, evidence, doc, hpo_profile()), evidence


def run(old, new, mentions=(((0, 3),),), cues=(), modifiers=()):
    snap, evidence = source(old, mentions, cues, modifiers)
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


def _clinical_text(paragraphs=14):
    """The size and repetitiveness of the browser workflow fixture's source text."""
    return "Hypotonia. " + "\n\n".join(
        f"Paragraph {index + 1}. Dose 5 mg. A😀é "
        + "The patient describes symptoms and the clinician checks each detail. " * 18
        for index in range(paragraphs)
    )


@pytest.mark.parametrize(
    "change",
    [
        lambda text: text,
        lambda text: text + "\n\nUpdated source: additional clinical detail.",
        lambda text: text.replace("Paragraph 7.", "Paragraph seven."),
    ],
    ids=["unchanged", "appended", "edited-middle"],
)
def test_long_repetitive_text_maps_without_quadratic_matching(change):
    """A consolidation round maps each input under the exclusive project lock.

    A full character SequenceMatcher took seconds per call on an 18k-codepoint
    repetitive text (the browser fixture), so starting consolidation exceeded
    the request timeouts and blocked every other project command meanwhile.
    """
    import time

    old = _clinical_text()
    new = change(old)
    started = time.perf_counter()
    m = text_map(old, new)
    assert time.perf_counter() - started < 0.5
    unchanged = old.index("Paragraph 3.")
    assert map_span(m, unchanged, unchanged + 12) == (unchanged, unchanged + 12)
    last = old.rindex("Paragraph 14.")
    shift = new.rindex("Paragraph 14.") - last
    assert map_span(m, last, last + 13) == (last + shift, last + shift + 13)


def test_a_long_text_edited_at_both_ends_maps_by_lines_in_time():
    """Edits at both ends leave no common prefix or suffix to trim; matching
    the whole 46k-codepoint text by characters took about 10 s."""
    import time

    old = _clinical_text(36)
    new = "Updated. " + old.replace("Paragraph 36.", "Paragraph thirty-six.")
    new = new[:-7] + "detail (amended)."
    assert len(old) > 45_000
    started = time.perf_counter()
    m = text_map(old, new)
    assert time.perf_counter() - started < 0.5
    for label in ("Paragraph 1.", "Paragraph 18.", "Paragraph 35."):
        at, to = old.index(label), new.index(label)
        assert map_span(m, at, at + len(label)) == (to, to + len(label))
    # A span across a line edge into an unchanged line part still maps.
    edge = old.index("\n\nParagraph 35.")
    assert map_span(m, edge - 8, edge + 12) == (
        new.index("\n\nParagraph 35.") - 8,
        new.index("\n\nParagraph 35.") + 12,
    )
    assert map_span(m, old.index("Hypotonia."), old.index("Hypotonia.") + 10) == (
        new.index("Hypotonia."),
        new.index("Hypotonia.") + 10,
    )
    for a, b, n in m.blocks:
        assert old[a : a + n] == new[b : b + n]
    assert all(
        x[0] + x[2] <= y[0] and x[1] + x[2] <= y[1]
        for x, y in zip(m.blocks, m.blocks[1:], strict=False)
    )


def test_a_short_changed_middle_maps_exactly_as_the_character_matcher():
    import random
    from difflib import SequenceMatcher

    def reference(old, new):
        limit = min(len(old), len(new))
        p = 0
        while p < limit and old[p] == new[p]:
            p += 1
        s = 0
        while s < limit - p and old[-1 - s] == new[-1 - s]:
            s += 1
        om, nm = old[p : len(old) - s], new[p : len(new) - s]
        blocks = [(0, 0, p)] if p else []
        if om and nm:
            matcher = SequenceMatcher(None, om, nm, autojunk=False)
            blocks += [(p + a, p + b, n) for a, b, n in matcher.get_matching_blocks()]
        blocks = [block for block in blocks if block[2]]
        if s:
            blocks.append((len(old) - s, len(new) - s, s))
        return tuple(blocks)

    rnd = random.Random(7)
    words = ["Hypotonia", "seizure", "the", "mg", "\n", "\n\n", "é😀", " "]
    for _ in range(500):
        old = "".join(rnd.choice(words) + " " for _ in range(rnd.randint(0, 60)))
        new = list(old)
        for _ in range(rnd.randint(1, 4)):
            i = rnd.randint(0, len(new))
            new[i : i + rnd.randint(0, 6)] = rnd.choice(words)
        new = "".join(new)
        assert text_map(old, new).blocks == reference(old, new)


def test_common_prefix_and_suffix_stay_exact_blocks():
    assert text_map("abc", "abc") == TextMap(((0, 0, 3),))
    assert text_map("ab", "abab") == TextMap(((0, 0, 2),))
    m = text_map("head middle tail", "head CHANGED tail")
    assert map_span(m, 0, 5) == (0, 5)
    assert map_span(m, 11, 16) == (12, 17)
    assert map_span(m, 5, 11) is None


# Modifier segments (modifiers plan M1b, spec "Text versions", R9). Terms of
# tests/fixtures/modifiers/hp-modifiers.json: Severe HP:0012828, Recurrent HP:0031796.
SEVERE = "HP:0012828"
RECURRENT = "HP:0031796"


def test_modifier_segment_is_mapped():
    result = run(
        "schwere Krampfanfall",
        "Ein schwere Krampfanfall",
        (((8, 20),),),
        modifiers=((SEVERE, ((0, 7),)),),
    )
    assert isinstance(result, Carried)
    assert result.modifiers == (MappedModifier(SEVERE, (Span(4, 11),)),)
    assert [m.model_dump() for m in result.target_modifiers] == [
        {"term_id": SEVERE, "segments": [{"start": 4, "end": 11}]}
    ]


def test_changed_modifier_text_sends_the_whole_claim_to_review():
    result = run(
        "schwere Krampfanfall",
        "leichte Krampfanfall",
        (((8, 20),),),
        modifiers=((SEVERE, ((0, 7),)),),
    )
    assert isinstance(result, NeedsReview)
    assert result.reason == "changed_modifier_segment"
    assert result.old_modifiers == (OldModifier(SEVERE, (TextSpan(0, 7, "schwere"),)),)
    # The context window covers the modifier, not only the mention.
    assert result.old_context.start == 0


def test_evidence_failure_stays_the_reason_when_a_modifier_also_changed():
    result = run(
        "schwere Krampfanfall",
        "leichte Xrampfanfall",
        (((8, 20),),),
        modifiers=((SEVERE, ((0, 7),)),),
    )
    assert isinstance(result, NeedsReview)
    assert result.reason == "changed_segment"
    assert result.old_modifiers[0].segments[0].text == "schwere"


def test_spanless_modifiers_are_carried_unchanged():
    result = run(
        "Krampfanfall", "XX Krampfanfall", (((0, 12),),), modifiers=((RECURRENT, ()),)
    )
    assert isinstance(result, Carried)
    assert result.modifiers == (MappedModifier(RECURRENT, ()),)
    assert [m.model_dump() for m in result.target_modifiers] == [{"term_id": RECURRENT}]


def test_a_finding_without_modifiers_carries_no_modifiers():
    result = run("Hypotonie", "Hypotonie", (((0, 9),),))
    assert isinstance(result, Carried)
    assert result.modifiers == ()
    assert result.target_modifiers == []


def test_modifier_segments_of_a_document_level_finding_are_checked():
    snap, evidence = source(
        "schwere Krampfanfall", (), modifiers=((SEVERE, ((0, 7),)),)
    )
    result = reanchor_annotation(
        snap, evidence, "other text", "other text", text_map("other text", "other text")
    )
    assert isinstance(result, NeedsReview)
    assert result.reason == "source_text_mismatch"
