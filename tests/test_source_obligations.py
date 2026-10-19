"""Every inventory producer creates the same exact, independently resolvable causes."""

from dataclasses import replace

from ontocurator.domain.variants import VariantInfo


def test_inventory_obligations_keep_old_source_and_resolve_only_exact_edge():
    from ontocurator.domain import work_rounds

    original = VariantInfo(
        "en1", "case", "original", "en", 1, "native", None, None, None, None, "1" * 64
    )
    correction = replace(
        original,
        document_id="en2",
        version=2,
        origin="correction",
        derived_from="en1",
        text_sha256="2" * 64,
    )
    later = replace(
        correction,
        document_id="en3",
        version=3,
        derived_from="en2",
        text_sha256="3" * 64,
    )
    translated = VariantInfo(
        "de1",
        "case",
        "run-A",
        "de",
        1,
        "machine_translation",
        "en1",
        {},
        "accepted",
        None,
        "4" * 64,
    )
    unrelated = replace(
        correction,
        document_id="other",
        external_id="another",
        origin="native",
        derived_from=None,
        version=1,
    )
    variants = [original, correction, later, translated, unrelated]
    causes = work_rounds.derive_source_obligations("p", variants, set())
    assert [(c.old_source_document_id, c.new_source_document_id) for c in causes] == [
        ("en1", "en2"),
        ("en2", "en3"),
    ]
    pending = work_rounds.derive_source_obligations("p", variants, {causes[0].cause_id})
    assert [c.cause_id for c in pending] == [causes[1].cause_id]
    assert translated.derived_from == "en1"


def test_resolution_of_old_translation_text_does_not_certify_later_changed_text():
    from ontocurator.domain.work_rounds import derive_source_obligations

    source = VariantInfo(
        "en1", "case", "original", "en", 1, "native", None, None, None, None, "1" * 64
    )
    corrected = replace(
        source,
        document_id="en2",
        version=2,
        origin="correction",
        derived_from="en1",
        text_sha256="2" * 64,
    )
    translation = VariantInfo(
        "de1",
        "case",
        "run-A",
        "de",
        1,
        "machine_translation",
        "en1",
        {},
        "accepted",
        None,
        "3" * 64,
    )
    old_cause = derive_source_obligations("p", [source, corrected, translation], set())[
        0
    ]
    revised = replace(
        translation,
        document_id="de2",
        version=2,
        origin="correction",
        derived_from="de1",
        text_sha256="4" * 64,
    )
    pending = derive_source_obligations(
        "p", [source, corrected, translation, revised], {old_cause.cause_id}
    )
    assert len(pending) == 1
    assert pending[0].cause_id != old_cause.cause_id
    assert pending[0].document_id == "de2"
    assert pending[0].new_source_document_id == "en2"
