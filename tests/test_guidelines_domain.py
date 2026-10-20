"""Pure guideline rules: file kind, body limits, notes, reference, notice (G11, G13, G20, G25)."""

from datetime import UTC, datetime

import pytest

from ontocurator.domain.errors import DomainError
from ontocurator.domain.guidelines import (
    MAX_GUIDELINE_BYTES,
    NOTICE_LIMIT,
    VersionFact,
    body_sha256,
    compute_notice,
    current_version,
    decode_body,
    guideline_ref,
    kind_for_filename,
    validate_note,
)

BOM = b"\xef\xbb\xbf"


def _code(error: pytest.ExceptionInfo[DomainError]) -> str:
    return error.value.code


@pytest.mark.parametrize(
    ("filename", "kind"),
    [
        ("rules.md", "markdown"),
        ("RULES.MD", "markdown"),
        ("rules.markdown", "markdown"),
        ("rules.v2.txt", "text"),
        ("Rules.TXT", "text"),
        ("rules.pdf", "error"),
        ("rules.html", "error"),
        ("rules", "error"),
        ("md", "error"),
    ],
)
def test_kind_by_extension(filename: str, kind: str) -> None:
    if kind == "error":
        with pytest.raises(DomainError) as error:
            kind_for_filename(filename)
        assert _code(error) == "GUIDELINE_FILE_TYPE"
    else:
        assert kind_for_filename(filename) == kind


def test_decode_drops_bom_and_keeps_crlf() -> None:
    assert decode_body(BOM + "# Rules\r\nä\r\n".encode()) == "# Rules\r\nä\r\n"
    # Only one leading BOM is dropped.
    assert decode_body(BOM + BOM + b"x") == "﻿x"


def test_size_boundary() -> None:
    assert len(decode_body(b"a" * MAX_GUIDELINE_BYTES)) == MAX_GUIDELINE_BYTES
    assert len(decode_body(BOM + b"a" * MAX_GUIDELINE_BYTES)) == MAX_GUIDELINE_BYTES
    for data in (b"a" * (MAX_GUIDELINE_BYTES + 1), b"a" * (MAX_GUIDELINE_BYTES + 10)):
        with pytest.raises(DomainError) as error:
            decode_body(data)
        assert _code(error) == "GUIDELINE_TOO_LARGE"
    with pytest.raises(DomainError) as error:
        decode_body(BOM + b"a" * (MAX_GUIDELINE_BYTES + 1))
    assert _code(error) == "GUIDELINE_TOO_LARGE"


@pytest.mark.parametrize("data", [b"\xff\xfe rules", b"ok\x00rules", b"\xc3"])
def test_invalid_utf8_and_nul_are_encoding_errors(data: bytes) -> None:
    with pytest.raises(DomainError) as error:
        decode_body(data)
    assert _code(error) == "GUIDELINE_ENCODING"


@pytest.mark.parametrize("data", [b"", BOM, b"  \r\n\t ", BOM + b"\n\n"])
def test_empty_and_whitespace_only_are_empty(data: bytes) -> None:
    with pytest.raises(DomainError) as error:
        decode_body(data)
    assert _code(error) == "GUIDELINE_EMPTY"


def test_note_rules() -> None:
    assert validate_note(None, field="change_note") is None
    assert validate_note("", field="change_note") is None
    assert validate_note("   ", field="reason") is None
    assert validate_note("  Fixed typo  ", field="change_note") == "Fixed typo"
    assert validate_note("x" * 280, field="reason") == "x" * 280
    for value, field in (
        ("x" * 281, "change_note"),
        ("first\nsecond", "reason"),
        ("first\rsecond", "change_note"),
    ):
        with pytest.raises(DomainError) as error:
            validate_note(value, field=field)  # type: ignore[arg-type]
        assert _code(error) == "GUIDELINE_NOTE_INVALID"
        assert error.value.details == {"field": field}


def test_guideline_ref_format() -> None:
    digest = body_sha256("# Rules\n")
    assert len(digest) == 64
    assert digest == body_sha256("# Rules\n")
    assert digest != body_sha256("# Rules\r\n")
    assert (
        guideline_ref("proj", 3, digest)
        == f"urn:ontocurator:proj:guidelines:v3#sha256={digest}"
    )


def _fact(version: int, *, withdrawn: bool = False) -> VersionFact:
    return VersionFact(
        version=version,
        created_at=datetime(2026, 10, version % 28 + 1, tzinfo=UTC),
        change_note=None if withdrawn else f"note {version}",
        withdrawn=withdrawn,
    )


def test_current_version_ignores_nothing_but_the_highest() -> None:
    assert current_version([]) is None
    assert current_version([_fact(1), _fact(3), _fact(2)]) == 3
    assert current_version([_fact(1), _fact(2, withdrawn=True), _fact(3)]) == 3
    # No fallback to the previous version when the highest is withdrawn (G25).
    assert current_version([_fact(1), _fact(2, withdrawn=True)]) is None


def test_notice_none_first_exposure_skipped_versions_withdrawn_and_more() -> None:
    assert compute_notice([], None) is None
    assert compute_notice([_fact(1), _fact(2, withdrawn=True)], None) is None

    first = compute_notice([_fact(1)], None)
    assert first is not None
    assert (first.from_version, first.to_version, first.more) == (None, 1, 0)
    assert [c.version for c in first.changes] == [1]

    versions = [_fact(1), _fact(2, withdrawn=True), _fact(3)]
    skipped = compute_notice(versions, 1)
    assert skipped is not None
    assert (skipped.from_version, skipped.to_version, skipped.more) == (1, 3, 0)
    assert [(c.version, c.withdrawn) for c in skipped.changes] == [
        (3, False),
        (2, True),
    ]

    many = compute_notice([_fact(v) for v in range(1, 9)], None)
    assert many is not None
    assert len(many.changes) == NOTICE_LIMIT
    assert [c.version for c in many.changes] == [8, 7, 6, 5, 4]
    assert many.more == 3

    assert compute_notice(versions, 3) is None
    assert compute_notice(versions, 4) is None
