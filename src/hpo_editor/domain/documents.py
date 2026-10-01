import hashlib
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

from hpo_editor.domain.canonical import canonical_hash
from hpo_editor.domain.errors import InvalidAnnotation


class OntologyRef(BaseModel):
    """Reference to pinned HPO ontology release and digest."""

    model_config = ConfigDict(extra="forbid")

    release: str
    sha256: str


class Document(BaseModel):
    """Immutable document containing original text and UTF-8 byte SHA-256."""

    model_config = ConfigDict(extra="forbid")

    document_id: str
    text: str
    language: str
    text_sha256: str

    @model_validator(mode="after")
    def verify_hash(self) -> Self:
        expected = hashlib.sha256(self.text.encode("utf-8")).hexdigest()
        if self.text_sha256 != expected:
            raise InvalidAnnotation(
                f"Document text SHA-256 mismatch: "
                f"got {self.text_sha256}, calculated {expected}"
            )
        return self


class Segment(BaseModel):
    """Zero-based Unicode codepoint interval [start, end)."""

    model_config = ConfigDict(extra="forbid")

    start: int
    end: int

    @model_validator(mode="after")
    def validate_interval(self) -> Self:
        if self.start < 0:
            raise InvalidAnnotation(f"Segment start cannot be negative: {self.start}")
        if self.end <= self.start:
            raise InvalidAnnotation(
                f"Segment is empty or inverted: start={self.start}, end={self.end}"
            )
        return self


class EvidenceMention(BaseModel):
    """Evidence mention spanning one or more ordered, non-overlapping segments."""

    model_config = ConfigDict(extra="forbid")

    evidence_id: str
    segments: list[Segment]
    cue_segments: list[Segment] = []

    @model_validator(mode="after")
    def validate_segments_structure(self) -> Self:
        if not self.segments:
            raise InvalidAnnotation("EvidenceMention must contain at least one segment")

        sorted_segs = sorted(self.segments, key=lambda s: s.start)
        for i in range(len(sorted_segs) - 1):
            if sorted_segs[i].end > sorted_segs[i + 1].start:
                raise InvalidAnnotation(
                    f"EvidenceMention segments overlap: "
                    f"{sorted_segs[i]} and {sorted_segs[i + 1]}"
                )
        self.segments = sorted_segs

        if self.cue_segments:
            sorted_cues = sorted(self.cue_segments, key=lambda s: s.start)
            for i in range(len(sorted_cues) - 1):
                if sorted_cues[i].end > sorted_cues[i + 1].start:
                    raise InvalidAnnotation(
                        f"Cue segments overlap: "
                        f"{sorted_cues[i]} and {sorted_cues[i + 1]}"
                    )
            self.cue_segments = sorted_cues
        return self


class EvidenceRef(BaseModel):
    """Reference binding evidence ID and specific immutable version hash."""

    model_config = ConfigDict(extra="forbid")

    evidence_id: str
    version: str


class EvidenceSnapshot(BaseModel):
    """Immutable snapshot of evidence bound to text and document."""

    model_config = ConfigDict(extra="forbid")

    mention: EvidenceMention
    document_id: str
    text_sha256: str
    version: str

    @classmethod
    def create(cls, mention: EvidenceMention, document: Document) -> "EvidenceSnapshot":
        canonical_content = {
            "document_id": document.document_id,
            "mention": mention.model_dump(),
            "text_sha256": document.text_sha256,
        }
        v = canonical_hash(canonical_content)
        return cls(
            mention=mention,
            document_id=document.document_id,
            text_sha256=document.text_sha256,
            version=v,
        )


def validate_segments(text: str, mentions: list[EvidenceMention]) -> None:
    """Validate that mention segments fall in bounds (Unicode codepoints)."""
    text_len = len(text)
    for mention in mentions:
        for seg in mention.segments:
            if seg.end > text_len:
                raise InvalidAnnotation(
                    f"Segment [{seg.start}, {seg.end}) is out of bounds "
                    f"for text of length {text_len}"
                )
        for cue in mention.cue_segments:
            if cue.end > text_len:
                raise InvalidAnnotation(
                    f"Cue segment [{cue.start}, {cue.end}) is out of bounds "
                    f"for text of length {text_len}"
                )
