"""Pure planner tests: real T1 readers, no database fixture or worker."""

from dataclasses import replace

import pytest
from t1_builders import bundle, correction_unit, native_unit, translation_unit
from t1_fixtures import PIN, hpo_profile

from ontocurator.domain.project_rules import ProjectRules
from ontocurator.domain.variants import VariantInfo
from ontocurator.exchange.plan import ProjectImportState, plan_import, read_t1_upload


def planned(tmp_path, units, state=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    incoming, issues = read_t1_upload(
        bundle(tmp_path, units), {"hp": PIN}, hpo_profile()
    )
    return plan_import(
        incoming, state or ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )


def test_source_before_translation_and_stable_internal_identity(tmp_path):
    source = native_unit("case", "en", "Source text")
    translated = translation_unit("case", "de", "Deutscher Text", source=source)
    plan = planned(tmp_path, [translated, source])
    assert plan.committable
    assert [v.document_id for v in plan.variants] == ["case", "case~de~v1"]
    assert plan.variants[1].derived_from == "case"
    assert plan.variants[1].derived_in_upload
    assert plan.variants[1].status == "ready_for_review"
    incoming, issues = read_t1_upload(
        tmp_path / "variants.zip", {"hp": PIN}, hpo_profile()
    )
    assert (
        plan.plan_sha256
        == plan_import(
            list(reversed(incoming)),
            ProjectImportState(),
            hpo_profile(),
            ProjectRules(),
            issues,
        ).plan_sha256
    )


def test_failed_checks_and_translation_correction_keep_ancestor_provenance(tmp_path):
    source = native_unit("source", "en", "Original")
    translated = translation_unit(
        "translation",
        "de",
        "Uebersetzt",
        source=source,
        checks=(("units_added", False),),
    )
    corrected = correction_unit(translated, "Korrigiert")
    plan = planned(tmp_path, [corrected, translated, source])
    assert plan.committable
    assert plan.variants[1].failed_checks == ("units_added",)
    assert plan.variants[1].status == "automatic_check_failed"
    assert plan.variants[2].status == "ready_for_review"
    assert plan.variants[2].translation is None
    assert plan.variants[2].derived_from == plan.variants[1].document_id


@pytest.mark.parametrize(
    "kind,code",
    [("missing", "VARIANT_SOURCE_UNKNOWN"), ("version", "VARIANT_VERSION_INVALID")],
)
def test_invalid_sources_and_predecessors_are_refused(tmp_path, kind, code):
    source = native_unit("case", "en", "First")
    item = (
        translation_unit("translated", "de", "Zweiter", source=source)
        if kind == "missing"
        else correction_unit(source, "Third", version=3)
    )
    plan = planned(tmp_path, [item] if kind == "missing" else [item, source])
    assert not plan.committable
    assert code in {issue.code for issue in plan.errors}


def state_of(plan):
    hashes = {doc.document_id: doc.text_sha256 for doc in plan.documents}
    variants = {
        v.document_id: VariantInfo(
            v.document_id,
            v.case_id,
            v.external_id,
            v.language,
            v.version,
            v.origin,
            v.derived_from,
            v.translation,
            v.status,
            v.status_reason,
            hashes[v.document_id],
        )
        for v in plan.variants
    }
    return ProjectImportState(documents=hashes, variants=variants)


def test_existing_identity_is_found_before_allocation_and_keeps_accepted_status(
    tmp_path,
):
    source = native_unit("case", "en", "Source")
    translation = translation_unit("case", "de", "Uebersetzung", source=source)
    state = state_of(planned(tmp_path / "first", [source, translation]))
    state.variants["case~de~v1"] = replace(
        state.variants["case~de~v1"],
        translation_status="accepted",
        status_reason="Reviewed before import",
    )
    repeated = planned(tmp_path / "again", [translation, source], state)
    assert repeated.committable
    assert repeated.counts["documents_added"] == 0
    value = next(v for v in repeated.variants if v.language == "de")
    assert (value.document_id, value.status, value.status_reason) == (
        "case~de~v1",
        "accepted",
        "Reviewed before import",
    )
    altered = replace(
        state,
        variants={
            key: replace(v, translation_status="reviewed") if v.language == "de" else v
            for key, v in state.variants.items()
        },
    )
    assert (
        planned(tmp_path / "changed", [translation, source], altered).state_sha256
        != repeated.state_sha256
    )


def test_case_identity_disambiguates_upload_sources_and_same_case_still_ambiguous(
    tmp_path,
):
    first = native_unit("first", "en", "Identical", case_id="case-one")
    second = native_unit("second", "en", "Identical", case_id="case-two")
    translated = translation_unit("translated", "de", "Anders", source=first)
    plan = planned(tmp_path / "valid", [second, translated, first])
    assert plan.committable
    assert (
        next(v for v in plan.variants if v.external_id == "translated").derived_from
        == "first"
    )
    second = second.model_copy(
        update={"document": second.document.model_copy(update={"case_id": "case-one"})}
    )
    refused = planned(tmp_path / "ambiguous", [first, second, translated])
    assert "VARIANT_SOURCE_AMBIGUOUS" in {i.code for i in refused.errors}


def test_wrong_case_upload_source_does_not_hide_matching_project_source(tmp_path):
    stored_source = native_unit("stored", "en", "Identical", case_id="right-case")
    state = state_of(planned(tmp_path / "initial", [stored_source]))
    wrong = native_unit("wrong", "en", "Identical", case_id="wrong-case")
    translated = translation_unit("translation", "de", "Anders", source=stored_source)
    result = planned(tmp_path / "next", [translated, wrong], state)
    assert result.committable
    assert (
        next(v for v in result.variants if v.external_id == "translation").derived_from
        == "stored"
    )


def test_duplicate_source_occurrences_are_not_ambiguous(tmp_path):
    source = native_unit("source", "en", "Original")
    copy = source.model_copy(
        update={
            "annotation_set": source.annotation_set.model_copy(
                update={"annotation_set_id": "another-set"}
            )
        }
    )
    translated = translation_unit("translated", "de", "Anders", source=source)
    plan = planned(tmp_path, [source, copy, translated])
    assert plan.committable
    assert len(plan.variants) == 2


def test_cycles_are_refused_for_each_affected_input(tmp_path):
    first = native_unit("a", "en", "Alpha")
    second = translation_unit("b", "de", "Beta", source=first)
    first = translation_unit("a", "en", "Alpha", source=second)
    plan = planned(tmp_path, [first, second])
    assert not plan.committable
    assert {i.code for i in plan.errors} == {"VARIANT_VERSION_INVALID"}
    assert len(plan.errors) == 2


def test_synthetic_id_collision_is_not_randomly_renamed(tmp_path):
    source = native_unit("case", "en", "Original")
    occupied = native_unit("case~de~v1", "en", "Occupied")
    state = state_of(planned(tmp_path / "first", [source, occupied]))
    translated = translation_unit("case", "de", "Anders", source=source)
    plan = planned(tmp_path / "again", [translated], state)
    assert "VARIANT_ID_COLLISION" in {i.code for i in plan.errors}


def test_same_identity_conflicting_metadata_is_refused(tmp_path):
    first = native_unit("case", "en", "Original", case_id="one")
    other = first.model_copy(
        update={"document": first.document.model_copy(update={"case_id": "two"})}
    )
    other = other.model_copy(
        update={
            "annotation_set": other.annotation_set.model_copy(
                update={"annotation_set_id": "another-set"}
            )
        }
    )
    plan = planned(tmp_path, [other, first])
    assert "VARIANT_CASE_MISMATCH" in {i.code for i in plan.errors}


def test_internal_id_mapping_recomputes_snapshots_and_preserves_delivery_basis(
    tmp_path,
):
    from t1_fixtures import TEXT, unit

    source = native_unit("case", "en", "Original source")
    translated = translation_unit("case", "de", TEXT, source=source)
    translated = translated.model_copy(
        update={
            "annotation_set": translated.annotation_set.model_copy(
                update={"annotations": unit().annotation_set.annotations}
            )
        }
    )
    path = bundle(tmp_path, [source, translated])
    incoming, issues = read_t1_upload(path, {"hp": PIN}, hpo_profile())
    original = next(u for u in incoming if u.set is not None)
    plan = plan_import(
        incoming, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert plan.committable
    mapped = plan.proposal_sets[0]
    assert mapped.document_id == "case~de~v1"
    assert mapped.payload == original.set.payload
    first = mapped.proposals.annotations[0]
    assert first.annotation.document_id == "case~de~v1"
    assert (
        first.annotation.annotation_id
        == original.set.proposals.annotations[0].annotation.annotation_id
    )
    assert first.version != original.set.proposals.annotations[0].version
    assert first.annotation.axes_defaulted == ["experiencer"]
    assert mapped.proposals.notes[first.annotation.annotation_id] == ["score 0.91"]
    assert all(e.document_id == "case~de~v1" for e in mapped.proposals.evidence)


@pytest.mark.parametrize("broken", [None, "case~en~v2"])
def test_broken_stored_correction_ancestry_is_a_deterministic_refusal(tmp_path, broken):
    first = native_unit("case", "en", "First")
    second = correction_unit(first, "Second")
    state = state_of(planned(tmp_path / "initial", [first, second]))
    state.variants["case~en~v2"] = replace(
        state.variants["case~en~v2"], derived_from=broken
    )
    third = correction_unit(second, "Third")
    plan = planned(tmp_path / "next", [third], state)
    assert not plan.committable
    assert "VARIANT_VERSION_INVALID" in {i.code for i in plan.errors}


def test_identical_reimport_with_omitted_optional_run_metadata_keeps_stored_provenance(
    tmp_path,
):
    source = native_unit("case", "en", "Source")
    translated = translation_unit("case", "de", "Translation", source=source)
    state = state_of(planned(tmp_path / "first", [source, translated]))
    incomplete = translated.model_copy(
        update={
            "document": translated.document.model_copy(update={"translation": None})
        }
    )
    plan = planned(tmp_path / "again", [incomplete], state)
    assert plan.committable
    assert plan.variants[0].translation == state.variants["case~de~v1"].translation
    assert plan.counts["documents_added"] == 0


def test_repeated_logical_input_can_supply_optional_metadata_once(tmp_path):
    source = native_unit("case", "en", "Source")
    translated = translation_unit("case", "de", "Translation", source=source)
    incomplete = translated.model_copy(
        update={
            "document": translated.document.model_copy(update={"translation": None}),
            "annotation_set": translated.annotation_set.model_copy(
                update={"annotation_set_id": "another-run"}
            ),
        }
    )
    plan = planned(tmp_path, [source, incomplete, translated])
    assert plan.committable
    assert next(
        v for v in plan.variants if v.language == "de"
    ).translation == translated.document.translation.model_dump(mode="json")
