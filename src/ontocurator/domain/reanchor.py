"""Pure codepoint mapping and source-only carriers for later reconstruction.

No result here is a target annotation/evidence snapshot. The durable job must
assign target identities and recompute every content-addressed version.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from hashlib import sha256
from typing import Literal

from ontocurator.domain.annotations import AnnotationRef, AnnotationSnapshot
from ontocurator.domain.documents import EvidenceRef, EvidenceSnapshot


@dataclass(frozen=True)
class TextMap:
    blocks: tuple[tuple[int, int, int], ...]


def text_map(old: str, new: str) -> TextMap:
    matcher = SequenceMatcher(None, old, new, autojunk=False)
    return TextMap(tuple((a, b, n) for a, b, n in matcher.get_matching_blocks() if n))


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
class Carried:
    source: AnnotationSnapshot
    source_ref: AnnotationRef
    evidence: tuple[MappedEvidence, ...]


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


def _needs_review(
    source: AnnotationSnapshot,
    mentions: tuple[OldMention, ...],
    reason: ReviewReason,
    old: str,
    new: str,
    m: TextMap,
) -> NeedsReview:
    valid = [
        span
        for mention in mentions
        for span in (*mention.segments, *mention.cue_segments)
        if 0 <= span.start < span.end <= len(old)
    ]
    left = max(0, min(span.start for span in valid) - 40) if valid else 0
    right = min(len(old), max(span.end for span in valid) + 40) if valid else len(old)
    new_left = _boundary(m, left, end=False, new_length=len(new))
    new_right = _boundary(m, right, end=True, new_length=len(new))
    new_right = max(new_left, new_right)
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
    if (
        snapshot.annotation.evidence_refs
        and sha256(old_text.encode("utf-8")).hexdigest() != snapshot.text_sha256
    ):
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
        groups = []
        old_groups = []
        for is_cue, segments in (
            (False, item.mention.segments),
            (True, item.mention.cue_segments),
        ):
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
                    failure = failure or (
                        "changed_cue" if is_cue else "changed_segment"
                    )
                    continue
                positions.append(Span(*target))
            groups.append(tuple(positions))
            old_groups.append(tuple(old_positions))
        mentions.append(OldMention(ref.model_copy(deep=True), *old_groups))
        mapped.append(MappedEvidence(ref.model_copy(deep=True), *groups))
    if failure is not None:
        return _needs_review(snapshot, tuple(mentions), failure, old_text, new_text, m)
    return Carried(snapshot.model_copy(deep=True), source_ref, tuple(mapped))
