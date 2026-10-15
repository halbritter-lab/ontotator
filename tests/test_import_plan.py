from pathlib import Path

import pytest
from t1_fixtures import PIN, TOOL, bundle, hpo_profile, unit

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.project_rules import ProjectRules
from ontocurator.exchange.plan import ProjectImportState, plan_import, read_t1_upload


def read(tmp_path: Path, **kwargs):
    return read_t1_upload(
        bundle(tmp_path / "b.zip", [unit(**kwargs)]), {"hp": PIN}, hpo_profile()
    )


def test_a_new_bundle_plans_documents_and_sets(tmp_path):
    units, issues = read(tmp_path)
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert plan.committable
    assert plan.documents[0].action == "add"
    assert plan.counts["proposals"] == 2
    aset = plan.proposal_sets[0]
    assert aset.actors == [TOOL]
    assert aset.proposals.annotations[0].annotation.axes_defaulted == ["experiencer"]
    assert aset.payload == units[0].set.payload
    assert plan.plan_sha256 == canonical_hash(
        plan.model_dump(mode="json", exclude={"plan_sha256"})
    )


@pytest.mark.parametrize(
    "kind", ["individual", "stage_result", "adjudicated", "release", "tool_output"]
)
def test_an_empty_set_is_planned_as_document_only(tmp_path, kind):
    units, issues = read(tmp_path, annotations=[], set_kind=kind)
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert plan.committable
    assert plan.documents_only == ["EN100017"]
    assert not plan.proposal_sets


@pytest.mark.parametrize(
    "kind", ["individual", "stage_result", "adjudicated", "release"]
)
def test_an_import_with_a_human_set_is_refused_and_lists_the_units(tmp_path, kind):
    units, issues = read(tmp_path, set_kind=kind)
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert not plan.committable
    assert [(i.code, i.unit) for i in plan.errors] == [("T1_SET_KIND", "EN100017")]


def test_tool_actors_without_version_are_errors(tmp_path):
    units, issues = read(
        tmp_path, actors=[{k: v for k, v in TOOL.items() if k != "version"}]
    )
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert "T1_TOOL_PROVENANCE" in [i.code for i in plan.errors]


def test_known_text_and_already_imported_set_are_skipped(tmp_path):
    units, issues = read(tmp_path)
    doc = units[0].document
    state = ProjectImportState(
        documents={doc.document_id: doc.text_sha256},
        sets=frozenset({("b-1", "run-7-EN100017", doc.document_id)}),
    )
    plan = plan_import(units, state, hpo_profile(), ProjectRules(), issues)
    assert plan.documents[0].action == "unchanged"
    assert plan.proposal_sets[0].action == "already_imported"
    assert plan.counts["proposals"] == 0


def test_a_changed_text_under_a_known_id_is_a_collision(tmp_path):
    units, issues = read(tmp_path)
    plan = plan_import(
        units,
        ProjectImportState(documents={"EN100017": "a" * 64}),
        hpo_profile(),
        ProjectRules(),
        issues,
    )
    assert not plan.committable
    assert plan.collisions[0].existing_sha256 == "a" * 64


def test_rules_drop_only_violating_proposals_and_preserve_payload(tmp_path):
    from t1_fixtures import annotation

    units, issues = read(
        tmp_path,
        annotations=[
            annotation("p1", (6, 19), assertion="absent"),
            annotation("p2", (63, 76)),
        ],
    )
    rules = ProjectRules(
        require_chosen_axes=True,
        hidden_axis_values={"hpo": {"assertion": frozenset({"absent"})}},
    )
    plan = plan_import(units, ProjectImportState(), hpo_profile(), rules, issues)
    aset = plan.proposal_sets[0]
    assert plan.committable
    assert [a.annotation.annotation_id for a in aset.proposals.annotations] == [
        "urn:ontospan:b-1:run-7-EN100017:p2"
    ]
    assert aset.refused[0].rule == "hidden_axis_value"
    assert len(aset.payload["annotations"]) == 2
    assert aset.payload == units[0].set.payload
    assert (
        aset.proposals.annotations[0].annotation.evidence_refs[0].version
        == units[0].set.proposals.annotations[1].annotation.evidence_refs[0].version
    )


def test_the_plan_hash_is_stable_and_changes_with_the_project(tmp_path):
    units, issues = read(tmp_path)

    def plan(state=None, rules=None):
        return plan_import(
            units,
            state or ProjectImportState(),
            hpo_profile(),
            rules or ProjectRules(),
            issues,
        )

    baseline = plan()
    assert baseline == plan()
    for state in [
        ProjectImportState(documents={"unrelated": "b" * 64}),
        ProjectImportState(sets=frozenset({(None, "s", "d")})),
        ProjectImportState(context_sha256="pins-changed"),
    ]:
        assert baseline.state_sha256 != plan(state).state_sha256
        assert baseline.plan_sha256 != plan(state).plan_sha256
    assert (
        baseline.plan_sha256
        != plan(rules=ProjectRules(require_chosen_axes=True)).plan_sha256
    )
    a = ProjectImportState(
        documents={"b": "2", "a": "1"},
        sets=frozenset({(None, "s", "d"), ("b", "s", "d")}),
    )
    b = ProjectImportState(
        documents={"a": "1", "b": "2"}, sets=frozenset(reversed(list(a.sets)))
    )
    assert plan(a).plan_sha256 == plan(b).plan_sha256


@pytest.mark.parametrize("existing", [False, True])
def test_the_same_text_under_two_ids_is_a_duplicate_warning(tmp_path, existing):
    path = bundle(
        tmp_path / "b.zip", [unit("a")] if existing else [unit("a"), unit("b")]
    )
    units, issues = read_t1_upload(path, {"hp": PIN}, hpo_profile())
    state = (
        ProjectImportState(documents={"b": units[0].document.text_sha256})
        if existing
        else ProjectImportState()
    )
    plan = plan_import(units, state, hpo_profile(), ProjectRules(), issues)
    assert plan.committable
    assert plan.duplicates[0].same_text_as == ["b"]
    assert any(i.code == "DUPLICATE_TEXT" for i in plan.warnings)


def test_reader_keeps_bundle_path_and_per_unit_source_hash(tmp_path):
    import hashlib

    from t1_fixtures import manifest_sha256

    original = unit()
    units, issues = read_t1_upload(
        bundle(tmp_path / "b.zip", [original]), {"hp": PIN}, hpo_profile()
    )
    assert not [i for i in issues if i.severity == "error"]
    assert units[0].label == "b.zip/documents/00000.json"
    assert units[0].source_text_sha256 == original.document.source_text_sha256
    assert units[0].manifest_sha256 == manifest_sha256(tmp_path / "b.zip")
    assert (
        units[0].document.text_sha256
        == hashlib.sha256(original.document.text.encode()).hexdigest()
    )


def test_full_ontology_validation_reports_annotation_id(tmp_path):
    import ontospan
    from t1_fixtures import HP_PATH, annotation

    path = bundle(
        tmp_path / "b.zip",
        [unit(annotations=[annotation("p1", (6, 19), term_id="HP:9999999")])],
    )
    _, issues = read_t1_upload(
        path,
        {"hp": PIN},
        hpo_profile(),
        ontologies={"hp": ontospan.ObographOntology.load(HP_PATH)},
    )
    errors = [i for i in issues if i.severity == "error"]
    assert errors
    assert errors[0].annotation_id == "p1"


def test_discontinuous_rule_refuses_only_affected_annotation(tmp_path):
    from t1_fixtures import TEXT, annotation, seg

    bad = annotation("p1", (6, 19))
    bad["mentions"][0]["segments"].append(seg(TEXT, 63, 76))
    units, issues = read(tmp_path, annotations=[bad, annotation("p2", (63, 76))])
    original = units[0].set.proposals
    plan = plan_import(
        units,
        ProjectImportState(),
        hpo_profile(),
        ProjectRules(contiguous_mentions_only=True),
        issues,
    )
    aset = plan.proposal_sets[0]
    assert plan.committable
    assert [v.rule for v in aset.refused] == ["discontinuous_mention"]
    assert [a.annotation.annotation_id for a in aset.proposals.annotations] == [
        "urn:ontospan:b-1:run-7-EN100017:p2"
    ]
    assert len(original.annotations) == 2
    assert aset.proposals.notes == {
        "urn:ontospan:b-1:run-7-EN100017:p2": ["score 0.91"]
    }


def test_unit_order_does_not_change_plan_hash(tmp_path):
    units, issues = read_t1_upload(
        bundle(tmp_path / "b.zip", [unit("a"), unit("b")]), {"hp": PIN}, hpo_profile()
    )
    args = (ProjectImportState(), hpo_profile(), ProjectRules(), issues)
    assert (
        plan_import(units, *args).plan_sha256
        == plan_import(list(reversed(units)), *args).plan_sha256
    )


def test_json_blob_uses_original_filename_and_pin_check(tmp_path):
    from t1_fixtures import layers, single

    path = single(tmp_path / "opaque-blob", unit(layer_data=layers(version="other")))
    units, issues = read_t1_upload(
        path, {"hp": PIN}, hpo_profile(), filename="upload.json"
    )
    assert units[0].bundle_id is None
    assert units[0].manifest_sha256 is None
    assert any(i.code == "PIN_MISMATCH" for i in issues)


def test_the_ontospan_release_bundle_is_refused_as_input(tmp_path):
    from datetime import UTC, datetime

    import ontospan

    path = tmp_path / "release.zip"
    ontospan.write_bundle(
        path,
        [unit(set_kind="release")],
        bundle_id="release",
        release=ontospan.ReleaseInfo(name="Published release"),
        created_at=datetime(2026, 10, 14, tzinfo=UTC),
    )
    units, issues = read_t1_upload(path, {"hp": PIN}, hpo_profile())
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    assert not plan.committable
    assert [i.unit for i in plan.errors if i.code == "T1_SET_KIND"] == ["EN100017"]


def test_preview_round_trip_keeps_exact_evidence_versions(tmp_path):
    from ontocurator.exchange.plan import ImportPlan

    units, issues = read(tmp_path)
    plan = plan_import(
        units, ProjectImportState(), hpo_profile(), ProjectRules(), issues
    )
    restored = ImportPlan.model_validate_json(plan.model_dump_json())
    assert restored == plan
    proposal = restored.proposal_sets[0].proposals.annotations[0]
    ref = proposal.annotation.evidence_refs[0]
    assert restored.proposal_sets[0].proposals.evidence[0].version == ref.version


def test_mismatched_evidence_version_is_not_silently_accepted(tmp_path):
    from dataclasses import replace

    from ontocurator.domain.errors import InvalidAnnotation

    units, issues = read(tmp_path)
    aset = units[0].set
    evidence = aset.proposals.evidence[0]
    proposals = replace(
        aset.proposals,
        evidence=[
            evidence.model_copy(update={"version": "wrong"}),
            *aset.proposals.evidence[1:],
        ],
    )
    invalid = replace(units[0], set=replace(aset, proposals=proposals))
    with pytest.raises(InvalidAnnotation, match="mismatched evidence"):
        plan_import(
            [invalid], ProjectImportState(), hpo_profile(), ProjectRules(), issues
        )


def test_full_validation_replaces_unchecked_hierarchy_warning(tmp_path):
    import ontospan
    from t1_fixtures import HP_PATH

    _, issues = read_t1_upload(
        bundle(tmp_path / "b.zip", [unit()]),
        {"hp": PIN},
        hpo_profile(),
        ontologies={"hp": ontospan.ObographOntology.load(HP_PATH)},
    )
    assert not issues
