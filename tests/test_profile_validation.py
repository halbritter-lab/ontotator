import pytest

from ontotator.auth import accounts
from ontotator.domain.errors import DomainError


@pytest.mark.parametrize("value", ["", " " * 3, "x" * 121])
def test_display_names_have_a_shared_length_rule(value):
    validate = getattr(accounts, "normalize_display_name", None)
    assert callable(validate), "shared display-name validation is missing"
    with pytest.raises(DomainError) as exc:
        validate(value)
    assert exc.value.code == "DISPLAY_NAME_INVALID"


def test_languages_normalize_and_reject_long_codes():
    validate = getattr(accounts, "normalize_languages", None)
    assert callable(validate), "language validation is missing"
    assert validate(["DE", "en", "de"]) == frozenset({"de", "en"})
    with pytest.raises(DomainError) as exc:
        validate(["deut"])
    assert exc.value.code == "LANGUAGE_INVALID"


@pytest.mark.parametrize("value", ["0000-0002-1825-0097", "0000-0002-1694-233X"])
def test_valid_orcid_checksums(value):
    validate = getattr(accounts, "validate_orcid", None)
    assert callable(validate), "ORCID checksum validation is missing"
    assert validate(value) == value


@pytest.mark.parametrize(
    "value", ["0000-0002-1825-0099", "0000-0002-1825-009", "abcd-0002-1825-0098"]
)
def test_invalid_orcid_checksums(value):
    validate = getattr(accounts, "validate_orcid", None)
    assert callable(validate), "ORCID checksum validation is missing"
    with pytest.raises(DomainError) as exc:
        validate(value)
    assert exc.value.code == "ORCID_INVALID"
