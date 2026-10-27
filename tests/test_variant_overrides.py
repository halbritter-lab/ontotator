"""Strict persisted override carrier and shared CLI/API/worker validation."""

import pytest
from pydantic import ValidationError

from ontotator.domain.errors import DomainError
from ontotator.exchange.variant_overrides import (
    StatusOverride,
    normalize_overrides,
    parse_overrides,
)


@pytest.mark.parametrize("reason", ["", " \t\n", "\u0085"])
def test_blank_reason_is_the_required_domain_code(reason):
    item = StatusOverride(external_id="a", language="de", version=1, reason=reason)
    with pytest.raises(DomainError) as error:
        normalize_overrides([item])
    assert error.value.code == "OVERRIDE_REASON_REQUIRED"


def test_cli_preserves_id_separators_and_reason_equals_then_normalizes():
    assert parse_overrides(["case:part=one:de:2=  Reviewed = accepted  "])[
        0
    ].model_dump() == {
        "external_id": "case:part=one",
        "language": "de",
        "version": 2,
        "reason": "Reviewed = accepted",
    }


def test_duplicate_identity_is_refused_before_enqueue():
    with pytest.raises(DomainError) as error:
        parse_overrides(["a:de:1=First", "a:de:1=Second"])
    assert error.value.code == "OVERRIDE_NOT_APPLICABLE"


@pytest.mark.parametrize(
    "patch",
    [{"version": 0}, {"version": "1"}, {"document_id": "injected"}, {"reason": 7}],
)
def test_override_fields_and_types_are_strict(patch):
    with pytest.raises(ValidationError):
        StatusOverride.model_validate(
            {
                "external_id": "a",
                "language": "de",
                "version": 1,
                "reason": "Checked",
                **patch,
            }
        )


@pytest.mark.parametrize(
    "flag,code",
    [("bad", "OVERRIDE_NOT_APPLICABLE"), ("a:de:1= ", "OVERRIDE_REASON_REQUIRED")],
)
def test_cli_invalid_override_is_reported_before_database_open(
    tmp_path, monkeypatch, flag, code
):
    from typer.testing import CliRunner

    import ontotator.cli as module

    path = tmp_path / "unit.json"
    path.write_text("{}")

    def forbidden(_context):
        raise AssertionError("Invalid overrides must not open a database")

    monkeypatch.setattr(module, "_open_database", forbidden)
    result = CliRunner().invoke(
        module.app, ["admin", "import", "proj", str(path), "--accept-translation", flag]
    )
    assert result.exit_code == 1
    assert f"Error: {code}:" in result.output
