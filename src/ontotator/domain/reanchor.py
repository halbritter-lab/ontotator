"""Pure codepoint mapping and source-only carriers for later reconstruction.

No result here is a target annotation/evidence snapshot. The durable job must
assign target identities and recompute every content-addressed version.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from hashlib import sha256
from itertools import accumulate
from typing import Literal

from ontotator.domain.annotations import AnnotationRef, AnnotationSnapshot, Modifier
from ontotator.domain.documents import EvidenceRef, EvidenceSnapshot, Segment


@dataclass(frozen=True)
class TextMap:
    blocks: tuple[tuple[int, int, int], ...]


# Codepoints of both changed middles matched by characters alone (~0.1 s).
_CHAR_MATCH_LIMIT = 8000


def _char_blocks(old: str, new: str) -> list[tuple[int, int, int]]:
    matcher = SequenceMatcher(None, old, new, autojunk=False)
    return [(a, b, n) for a, b, n in matcher.get_matching_blocks() if n]


def _line_blocks(old: str, new: str) -> list[tuple[int, int, int]]:
    """Equal blocks of whole equal lines, characters only inside changed lines."""
    old_lines = old.splitlines(keepends=True)
    new_lines = new.splitlines(keepends=True)
    if len(old_lines) <= 1 or len(new_lines) <= 1:
        return _char_blocks(old, new)
    old_at = [0, *accumulate(map(len, old_lines))]
    new_at = [0, *accumulate(map(len, new_lines))]
    blocks: list[tuple[int, int, int]] = []
    matcher = SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    for op, i, i_end, j, j_end in matcher.get_opcodes():
        a, a_end, b, b_end = old_at[i], old_at[i_end], new_at[j], new_at[j_end]
        if op == "equal":
            blocks.append((a, b, a_end - a))
        elif op == "replace":
            blocks.extend(
                (a + x, b + y, n)
                for x, y, n in _char_blocks(old[a:a_end], new[b:b_end])
            )
    return blocks


def text_map(old: str, new: str) -> TextMap:
    """Equal codepoint blocks of ``old`` and ``new``, in order.

    The common prefix and suffix are equal blocks as they are; the changed
    middle goes through a character ``SequenceMatcher``. Matching a long,
    repetitive text character by character without autojunk is quadratic
    (seconds for an ordinary clinical text edited at both ends), and callers
    such as round creation map under the exclusive project lock, so a middle
    longer than ``_CHAR_MATCH_LIMIT`` is matched by lines first and only the
    differing line groups by characters. Adjacent blocks are merged, so a
    span across a line edge still maps.
    """
    limit = min(len(old), len(new))
    prefix = 0
    while prefix < limit and old[prefix] == new[prefix]:
        prefix += 1
    suffix = 0
    while suffix < limit - prefix and old[-1 - suffix] == new[-1 - suffix]:
        suffix += 1
    old_middle = old[prefix : len(old) - suffix]
    new_middle = new[prefix : len(new) - suffix]
    found: list[tuple[int, int, int]] = [(0, 0, prefix)] if prefix else []
    if old_middle and new_middle:
        found.extend(
            (prefix + a, prefix + b, n)
            for a, b, n in (
                _char_blocks(old_middle, new_middle)
                if len(old_middle) + len(new_middle) <= _CHAR_MATCH_LIMIT
                else _line_blocks(old_middle, new_middle)
            )
        )
    if suffix:
        found.append((len(old) - suffix, len(new) - suffix, suffix))
    blocks: list[tuple[int, int, int]] = []
    for a, b, n in found:
        if (
            blocks
            and blocks[-1][0] + blocks[-1][2] == a
            and blocks[-1][1] + blocks[-1][2] == b
        ):
            blocks[-1] = (blocks[-1][0], blocks[-1][1], blocks[-1][2] + n)
        else:
            blocks.append((a, b, n))
    return TextMap(tuple(blocks))


def map_span(m: TextMap, start: int, end: int) -> tuple[int, int] | None:
    """Map [start, end) only when a single equal block contains it entirely."""
    if start < 0 or end <= start:
        raise ValueError("A span must be a nonempty, nonnegative codepoint interval")
    for a, b, n in m.blocks:
        if a <= start and end <= a + n:
            return start - a + b, end - a + b
    return None


@dataclass(frozen=True)
class Span:
    start: int
    end: int


@dataclass(frozen=True)
class MappedEvidence:
    source_ref: EvidenceRef
    segments: tuple[Span, ...]
    cue_segments: tuple[Span, ...]


@dataclass(frozen=True)
class MappedModifier:
    term_id: str
    segments: tuple[Span, ...]


@dataclass(frozen=True)
class Carried:
    source: AnnotationSnapshot
    source_ref: AnnotationRef
    evidence: tuple[MappedEvidence, ...]
    modifiers: tuple[MappedModifier, ...] = ()

    @property
    def target_modifiers(self) -> list[Modifier]:
        """The mapped modifiers as the target annotation's ``modifiers``."""
        return [
            Modifier(
                term_id=m.term_id,
                segments=[Segment(start=s.start, end=s.end) for s in m.segments],
            )
            for m in self.modifiers
        ]


@dataclass(frozen=True)
class TextSpan:
    start: int
    end: int
    text: str


@dataclass(frozen=True)
class OldMention:
    source_ref: EvidenceRef
    segments: tuple[TextSpan, ...]
    cue_segments: tuple[TextSpan, ...]


@dataclass(frozen=True)
class OldModifier:
    term_id: str
    segments: tuple[TextSpan, ...]


@dataclass(frozen=True)
class TextWindow:
    start: int
    end: int
    text: str


Opcode = Literal["equal", "replace", "insert", "delete"]


@dataclass(frozen=True)
class WindowOpcode:
    op: Opcode
    old_start: int
    old_end: int
    new_start: int
    new_end: int
    old_text: str
    new_text: str


ReviewReason = Literal[
    "source_text_mismatch",
    "missing_evidence",
    "evidence_version_mismatch",
    "ambiguous_evidence",
    "evidence_source_mismatch",
    "invalid_bounds",
    "changed_segment",
    "changed_cue",
    "changed_modifier_segment",
]


@dataclass(frozen=True)
class NeedsReview:
    source_ref: AnnotationRef
    term_id: str
    layer_id: str
    reason: ReviewReason
    old_mentions: tuple[OldMention, ...]
    old_context: TextWindow
    new_context: TextWindow
    diff: tuple[WindowOpcode, ...]
    old_modifiers: tuple[OldModifier, ...] = ()

    @property
    def old_segments(self) -> tuple[TextSpan, ...]:
        """Flat highlight data includes mention segments and their cue segments."""
        return tuple(
            segment
            for mention in self.old_mentions
            for segment in (*mention.segments, *mention.cue_segments)
        )


def _boundary(m: TextMap, position: int, *, end: bool, new_length: int) -> int:
    # At an insertion boundary both equal blocks can contain this old position.
    # Include the intervening new text rather than selecting a repeated match.
    exact = [b + position - a for a, b, n in m.blocks if a <= position <= a + n]
    if exact:
        result = max(exact) if end else min(exact)
    elif end:
        result = next((b for a, b, _ in m.blocks if a >= position), new_length)
    else:
        result = max((b + n for a, b, n in m.blocks if a + n <= position), default=0)
    return min(new_length, max(0, result))


def _whole_word_window(text: str, left: int, right: int) -> tuple[int, int]:
    """Extend to nearby token edges, without unbounded scans of unbroken text."""
    start, end = left, right
    while 0 < start < len(text) and not (
        text[start - 1].isspace() or text[start].isspace()
    ):
        if left - start == 32:
            start = left
            break
        start -= 1
    while 0 < end < len(text) and not (text[end - 1].isspace() or text[end].isspace()):
        if end - right == 32:
            end = right
            break
        end += 1
    return start, end


def _needs_review(
    source: AnnotationSnapshot,
    mentions: tuple[OldMention, ...],
    reason: ReviewReason,
    old: str,
    new: str,
    m: TextMap,
    old_modifiers: tuple[OldModifier, ...] = (),
) -> NeedsReview:
    valid = [
        span
        for spans in (
            *((*mention.segments, *mention.cue_segments) for mention in mentions),
            *(modifier.segments for modifier in old_modifiers),
        )
        for span in spans
        if 0 <= span.start < span.end <= len(old)
    ]
    left = max(0, min(span.start for span in valid) - 40) if valid else 0
    right = min(len(old), max(span.end for span in valid) + 40) if valid else len(old)
    left, right = _whole_word_window(old, left, right)
    new_left = _boundary(m, left, end=False, new_length=len(new))
    new_right = _boundary(m, right, end=True, new_length=len(new))
    new_right = max(new_left, new_right)
    new_left, new_right = _whole_word_window(new, new_left, new_right)
    old_window = TextWindow(left, right, old[left:right])
    new_window = TextWindow(new_left, new_right, new[new_left:new_right])
    matcher = SequenceMatcher(None, old_window.text, new_window.text, autojunk=False)
    diff = []
    for op, a, a_end, b, b_end in matcher.get_opcodes():
        kind: Opcode
        if op == "equal":
            kind = "equal"
        elif op == "replace":
            kind = "replace"
        elif op == "insert":
            kind = "insert"
        else:
            kind = "delete"
        diff.append(
            WindowOpcode(
                kind,
                left + a,
                left + a_end,
                new_left + b,
                new_left + b_end,
                old_window.text[a:a_end],
                new_window.text[b:b_end],
            )
        )
    return NeedsReview(
        AnnotationRef(
            annotation_id=source.annotation.annotation_id, version=source.version
        ),
        source.annotation.term_id,
        source.annotation.layer_id,
        reason,
        mentions,
        old_window,
        new_window,
        tuple(diff),
        old_modifiers,
    )


def reanchor_annotation(
    snapshot: AnnotationSnapshot,
    evidence: Sequence[EvidenceSnapshot],
    old_text: str,
    new_text: str,
    m: TextMap,
) -> Carried | NeedsReview:
    """Carry all referenced anchors, or return one diagnostic for the whole claim."""
    source_ref = AnnotationRef(
        annotation_id=snapshot.annotation.annotation_id, version=snapshot.version
    )
    mapped = []
    mentions = []
    failure: ReviewReason | None = None

    def carry(
        segments: Sequence[Segment], changed: ReviewReason
    ) -> tuple[tuple[Span, ...], tuple[TextSpan, ...]]:
        nonlocal failure
        positions = []
        old_positions = []
        for segment in segments:
            a, b = segment.start, segment.end
            valid = 0 <= a < b <= len(old_text)
            old_positions.append(TextSpan(a, b, old_text[a:b] if valid else ""))
            if not valid:
                failure = failure or "invalid_bounds"
                continue
            target = map_span(m, a, b)
            if (
                target is None
                or not (0 <= target[0] < target[1] <= len(new_text))
                or old_text[a:b] != new_text[target[0] : target[1]]
            ):
                failure = failure or changed
                continue
            positions.append(Span(*target))
        return tuple(positions), tuple(old_positions)

    if (
        snapshot.annotation.evidence_refs
        or any(modifier.segments for modifier in snapshot.annotation.modifiers)
    ) and sha256(old_text.encode("utf-8")).hexdigest() != snapshot.text_sha256:
        failure = "source_text_mismatch"
    for ref in snapshot.annotation.evidence_refs:
        candidates = [
            item for item in evidence if item.mention.evidence_id == ref.evidence_id
        ]
        exact = [item for item in candidates if item.version == ref.version]
        if not exact:
            failure = failure or (
                "evidence_version_mismatch" if candidates else "missing_evidence"
            )
            continue
        if len(exact) != 1:
            failure = failure or "ambiguous_evidence"
            continue
        item = exact[0]
        if (
            item.document_id != snapshot.document_id
            or item.text_sha256 != snapshot.text_sha256
        ):
            failure = failure or "evidence_source_mismatch"
        segments, old_segments = carry(item.mention.segments, "changed_segment")
        cues, old_cues = carry(item.mention.cue_segments, "changed_cue")
        mentions.append(OldMention(ref.model_copy(deep=True), old_segments, old_cues))
        mapped.append(MappedEvidence(ref.model_copy(deep=True), segments, cues))
    # After the evidence: an evidence reason stays the first failure.
    modifiers = []
    old_modifiers = []
    for modifier in snapshot.annotation.modifiers:
        spans, old_spans = carry(modifier.segments, "changed_modifier_segment")
        modifiers.append(MappedModifier(modifier.term_id, spans))
        old_modifiers.append(OldModifier(modifier.term_id, old_spans))
    if failure is not None:
        return _needs_review(
            snapshot,
            tuple(mentions),
            failure,
            old_text,
            new_text,
            m,
            tuple(old_modifiers),
        )
    return Carried(
        snapshot.model_copy(deep=True), source_ref, tuple(mapped), tuple(modifiers)
    )
