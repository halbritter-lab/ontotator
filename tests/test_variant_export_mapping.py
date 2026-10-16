"""Real format export mapping with project-wide ancestry hashes, no database."""

from dataclasses import replace

import ontospan
import pytest
from t1_builders import native_unit, translation_unit

from ontocurator.domain.variants import VariantInfo
from ontocurator.exchange.t1 import document_from_unit, document_to_t1


def test_translation_exports_external_id_and_source_variant_hash_separately():
    source = native_unit("case", "en", "Original")
    translated = translation_unit("case", "de", "Uebersetzung", source=source)
    document = document_from_unit(translated).model_copy(
        update={"document_id": "case~de~v1"}
    )
    variant = VariantInfo(
        "case~de~v1",
        "case",
        "case",
        "de",
        1,
        "machine_translation",
        "case",
        translated.document.translation.model_dump(mode="json"),
        "accepted",
        "Reviewed",
        document.text_sha256,
    )
    exported = document_to_t1(
        document,
        variant,
        {"case": source.document.text_sha256},
        source_text_sha256="f" * 64,
        single_native_case=False,
    )
    assert exported.document_id == "case"
    assert exported.case_id == "case"
    assert exported.variant.derived_from == source.document.text_sha256
    assert exported.source_text_sha256 == "f" * 64
    assert exported.translation == translated.document.translation
    assert ontospan.validate(translated.model_copy(update={"document": exported})).ok
    correction = replace(
        variant,
        version=2,
        origin="correction",
        derived_from="case~de~v1",
        translation=None,
    )
    emitted = document_to_t1(
        document, correction, {"case~de~v1": "e" * 64}, single_native_case=False
    )
    assert emitted.translation is None
    assert emitted.variant.derived_from == "e" * 64


def test_plain_native_keeps_original_format_document_shape():
    raw = native_unit("native", "en", "Original")
    document = document_from_unit(raw)
    variant = VariantInfo(
        "native",
        "native",
        "native",
        "en",
        1,
        "native",
        None,
        None,
        None,
        None,
        document.text_sha256,
    )
    assert (
        document_to_t1(
            document, variant, {}, source_text_sha256=raw.document.source_text_sha256
        )
        == raw.document
    )


def test_export_refuses_unresolvable_source_instead_of_emitting_internal_id():
    from ontocurator.domain.errors import DomainError

    raw = native_unit("native", "de", "Original")
    document = document_from_unit(raw)
    variant = VariantInfo(
        "native",
        "case",
        "external",
        "de",
        1,
        "human_translation",
        "missing",
        None,
        "accepted",
        None,
        document.text_sha256,
    )
    with pytest.raises(DomainError) as error:
        document_to_t1(document, variant, {})
    assert error.value.code == "VARIANT_SOURCE_UNKNOWN"


def test_single_native_preserves_an_explicit_case_without_a_variant_object():
    raw = native_unit("external", "en", "Original", case_id="real-case")
    document = document_from_unit(raw)
    variant = VariantInfo(
        "external",
        "real-case",
        "external",
        "en",
        1,
        "native",
        None,
        None,
        None,
        None,
        document.text_sha256,
    )
    exported = document_to_t1(document, variant, {})
    assert exported.case_id == "real-case" and exported.variant is None
