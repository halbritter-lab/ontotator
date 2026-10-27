"""Pure ancestry checks; malformed chains never become verified native texts."""

from dataclasses import FrozenInstanceError, replace

import pytest

from ontotator.domain.variants import VariantInfo, is_translation_chain

NATIVE = VariantInfo(
    "native", "case", "native", "en", 1, "native", None, None, None, None, "a" * 64
)


@pytest.mark.parametrize("origin", ["machine_translation", "human_translation"])
def test_translation_origins_are_translation_chains(origin):
    translated = replace(
        NATIVE, document_id="translation", origin=origin, derived_from="native"
    )
    assert is_translation_chain(translated, lambda _: NATIVE)


@pytest.mark.parametrize("translated", [False, True])
def test_corrections_follow_all_predecessors(translated):
    ancestor = replace(NATIVE, origin="machine_translation") if translated else NATIVE
    first = replace(
        NATIVE,
        document_id="first",
        origin="correction",
        derived_from="native",
        version=2,
    )
    last = replace(first, document_id="last", derived_from="first", version=3)
    rows = {"native": ancestor, "first": first}
    assert is_translation_chain(last, rows.get) is translated


def test_native_does_not_read_ancestry():
    def unexpected(_):
        pytest.fail("native variant needs no lookup")

    assert not is_translation_chain(NATIVE, unexpected)


@pytest.mark.parametrize("source", [None, "missing"])
def test_a_missing_correction_predecessor_is_not_treated_as_native(source):
    broken = replace(NATIVE, origin="correction", derived_from=source, version=2)
    with pytest.raises(ValueError, match="ancestry"):
        is_translation_chain(broken, lambda _: None)


@pytest.mark.parametrize("self_cycle", [False, True])
def test_cycles_are_refused_without_recursion(self_cycle):
    first = replace(
        NATIVE,
        document_id="first",
        origin="correction",
        derived_from="first" if self_cycle else "last",
        version=2,
    )
    last = replace(first, document_id="last", derived_from="first", version=3)
    with pytest.raises(ValueError, match="ancestry"):
        is_translation_chain(first, {"first": first, "last": last}.get)


def test_variant_metadata_is_frozen():
    with pytest.raises(FrozenInstanceError):
        NATIVE.version = 2  # type: ignore[misc]
