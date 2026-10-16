"""Independent ancestry and identity contracts used by review/import producers."""

from dataclasses import replace

import pytest

from ontocurator.assignments.proposals import validate_selection
from ontocurator.authz.policy import Access, may_take
from ontocurator.domain.errors import DomainError
from ontocurator.domain.variants import (
    VariantInfo,
    resolve_translation_lineage,
    variant_document_id,
)

SOURCE = VariantInfo(
    "source", "case", "s", "en", 1, "native", None, None, None, None, "a" * 64
)
MT = replace(
    SOURCE,
    document_id="mt",
    external_id="target",
    language="de",
    origin="machine_translation",
    derived_from="source",
    translation={"provider": "first"},
    translation_status="ready_for_review",
)
V2 = replace(
    MT,
    document_id="v2",
    version=2,
    origin="correction",
    derived_from="mt",
    translation=None,
)
V3 = replace(V2, document_id="v3", version=3, derived_from="v2")


def test_correction_context_resolves_original_run_and_source_not_predecessor():
    ancestor, source = resolve_translation_lineage(
        V3, {v.document_id: v for v in [SOURCE, MT, V2]}.get
    )
    assert ancestor == MT
    assert source == SOURCE
    assert V3.translation is None


@pytest.mark.parametrize(
    "bad",
    [
        replace(V2, derived_from="missing"),
        replace(V2, derived_from="v2"),
        replace(V2, language="fr"),
        replace(V2, external_id="other"),
        replace(V2, version=4),
        replace(V2, case_id="other"),
    ],
)
def test_corrupt_correction_lineage_is_refused(bad):
    with pytest.raises(DomainError, match="VARIANT_SOURCE_UNKNOWN"):
        resolve_translation_lineage(
            bad, {v.document_id: v for v in [SOURCE, MT, bad]}.get
        )


def test_native_is_not_a_translation_review_target():
    with pytest.raises(DomainError, match="NOT_A_TRANSLATION"):
        resolve_translation_lineage(SOURCE, lambda _: None)


@pytest.mark.parametrize(
    "roles,admin,allowed",
    [
        (set(), True, False),
        ({"lead"}, False, False),
        ({"adjudicator"}, False, False),
        ({"annotator"}, False, True),
        ({"annotator"}, True, True),
    ],
)
def test_translation_review_role_is_central_and_has_no_admin_work_bypass(
    roles, admin, allowed
):
    assert (
        may_take(
            Access(1, "p", admin, {"project": frozenset(roles)}),
            "project",
            "translation_review",
        )
        is allowed
    )


def test_unfinished_translation_review_distribution_remains_deliberately_unavailable():
    with pytest.raises(DomainError, match="TASK_INVALID"):
        validate_selection(["translation"], "translation_review", 1, 42)


def test_internal_ids_match_actual_import_allocation_and_refuse_collision():
    assert variant_document_id("target", "de", 2, set()) == "target"
    assert variant_document_id("target", "de", 2, {"target"}) == "target~de~v2"
    with pytest.raises(DomainError, match="VARIANT_ID_COLLISION"):
        variant_document_id("target", "de", 2, {"target", "target~de~v2"})
