import hashlib

import pytest
from pydantic import ValidationError

from ontocurator.domain.annotations import (
    ActorRef,
    Annotation,
    Provenance,
    snapshot,
)
from ontocurator.domain.documents import (
    Document,
    EvidenceMention,
    EvidenceRef,
    EvidenceSnapshot,
    Segment,
)
from ontocurator.domain.errors import InvalidAnnotation
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    AxisDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
    layer_config_hash,
    profile_hash,
    resolve_layer,
    resolve_ontology,
    resolve_type,
)


def _make_sample_profile() -> TaskProfile:
    ont = OntologyDefinition(
        ontology_id="hp",
        label="Human Phenotype Ontology",
        release="2026-06-23",
        sha256="279123a1ae5314e4632a0f85be2d82efd50f44ebf0d98e0100ed6859d7cb83e4",
        format="obo-graph-json",
    )
    type_def = AnnotationTypeDefinition(
        type_id="phenotype",
        label="Phenotype",
        axes=[
            AxisDefinition(
                id="assertion",
                label="Assertion",
                options=["present", "absent", "uncertain"],
                allow_empty=True,
            )
        ],
        evidence_policy="optional",
    )
    layer = LayerDefinition(
        layer_id="hpo-layer",
        label="Phenotypes",
        ontology_id="hp",
        access="editable",
        default_visible=True,
        default_type_id="phenotype",
        annotation_types=[type_def],
    )
    return TaskProfile(
        profile_id="test-profile/v1",
        version="1.0.0",
        ontologies=[ont],
        layers=[layer],
        default_layer_id="hpo-layer",
    )


def test_empty_axes_valid():
    ont = OntologyDefinition(
        ontology_id="test-ont",
        label="Test",
        release="2026-01-01",
        sha256="abc",
        format="obo-graph-json",
    )
    type_no_axes = AnnotationTypeDefinition(
        type_id="t1",
        label="Type 1",
        axes=[],
        evidence_policy="optional",
    )
    layer = LayerDefinition(
        layer_id="l1",
        label="Layer 1",
        ontology_id="test-ont",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_no_axes],
    )
    profile = TaskProfile(
        profile_id="p-empty-axes/v1",
        version="1.0.0",
        ontologies=[ont],
        layers=[layer],
        default_layer_id="l1",
    )
    assert profile.layers[0].annotation_types[0].axes == []


def test_invalid_profile_structures_rejected():
    ont = OntologyDefinition(
        ontology_id="hp",
        label="HP",
        release="2026-06-23",
        sha256="abc",
    )
    type_def = AnnotationTypeDefinition(
        type_id="t1",
        label="T1",
        axes=[],
    )
    layer = LayerDefinition(
        layer_id="l1",
        label="L1",
        ontology_id="hp",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_def],
    )

    # 1. Empty ontology ID
    with pytest.raises((ValueError, ValidationError)):
        OntologyDefinition(
            ontology_id="   ",
            label="HP",
            release="2026-06-23",
            sha256="abc",
        )

    # 2. Duplicate ontology IDs
    with pytest.raises((ValueError, ValidationError)):
        TaskProfile(
            profile_id="p1",
            version="1.0.0",
            ontologies=[ont, ont],
            layers=[layer],
            default_layer_id="l1",
        )

    # 3. Duplicate layer IDs
    with pytest.raises((ValueError, ValidationError)):
        TaskProfile(
            profile_id="p1",
            version="1.0.0",
            ontologies=[ont],
            layers=[layer, layer],
            default_layer_id="l1",
        )

    # 4. Unknown ontology in layer
    layer_bad_ont = layer.model_copy(update={"ontology_id": "nonexistent"})
    with pytest.raises((ValueError, ValidationError)):
        TaskProfile(
            profile_id="p1",
            version="1.0.0",
            ontologies=[ont],
            layers=[layer_bad_ont],
            default_layer_id="l1",
        )

    # 5. Invalid default_layer_id (unknown layer)
    with pytest.raises((ValueError, ValidationError)):
        TaskProfile(
            profile_id="p1",
            version="1.0.0",
            ontologies=[ont],
            layers=[layer],
            default_layer_id="unknown-layer",
        )

    # 6. default_layer_id pointing to a reference (non-editable) layer
    ref_layer = layer.model_copy(update={"access": "reference"})
    with pytest.raises((ValueError, ValidationError)):
        TaskProfile(
            profile_id="p1",
            version="1.0.0",
            ontologies=[ont],
            layers=[ref_layer],
            default_layer_id="l1",
        )

    # 7. Layer default_type_id not in annotation_types
    layer_bad_type = layer.model_copy(update={"default_type_id": "unknown-type"})
    with pytest.raises((ValueError, ValidationError)):
        TaskProfile(
            profile_id="p1",
            version="1.0.0",
            ontologies=[ont],
            layers=[layer_bad_type],
            default_layer_id="l1",
        )


def test_resolver_functions():
    profile = _make_sample_profile()
    layer = resolve_layer(profile, "hpo-layer")
    assert layer.layer_id == "hpo-layer"

    t = resolve_type(profile, "hpo-layer", "phenotype")
    assert t.type_id == "phenotype"

    ont = resolve_ontology(profile, "hp")
    assert ont.ontology_id == "hp"

    with pytest.raises(InvalidAnnotation, match="Unknown layer"):
        resolve_layer(profile, "missing-layer")

    with pytest.raises(InvalidAnnotation, match="Unknown type"):
        resolve_type(profile, "hpo-layer", "missing-type")

    with pytest.raises(InvalidAnnotation, match="Unknown ontology"):
        resolve_ontology(profile, "missing-ont")


def test_hash_consistency_and_stability():
    p1 = _make_sample_profile()
    p2 = _make_sample_profile()
    assert profile_hash(p1) == profile_hash(p2)
    assert layer_config_hash(p1, "hpo-layer") == layer_config_hash(p2, "hpo-layer")

    # Adding a second unused layer to profile does NOT change hpo-layer's layer_config_hash
    second_ont = OntologyDefinition(
        ontology_id="mondo",
        label="Mondo Disease Ontology",
        release="2026-06-01",
        sha256="mondo-hash",
    )
    second_layer = LayerDefinition(
        layer_id="disease-layer",
        label="Diseases",
        ontology_id="mondo",
        access="reference",
        default_type_id="disease",
        annotation_types=[
            AnnotationTypeDefinition(type_id="disease", label="Disease", axes=[])
        ],
    )
    extended_profile = p1.model_copy(
        update={
            "ontologies": [*p1.ontologies, second_ont],
            "layers": [*p1.layers, second_layer],
        }
    )

    # Own layer hash must be unchanged
    assert layer_config_hash(extended_profile, "hpo-layer") == layer_config_hash(
        p1, "hpo-layer"
    )
    # Profile hash changes because profile has new layers
    assert profile_hash(extended_profile) != profile_hash(p1)


def test_v3_snapshot_creation_and_hash_sensitivity():
    profile = _make_sample_profile()
    doc_text = "Patient has severe hypotonia."
    doc = Document(
        document_id="doc-1",
        text=doc_text,
        language="de",
        text_sha256=hashlib.sha256(doc_text.encode("utf-8")).hexdigest(),
    )
    ev_mention = EvidenceMention(
        evidence_id="ev-1", segments=[Segment(start=19, end=28)]
    )
    ev_snap = EvidenceSnapshot.create(mention=ev_mention, document=doc)

    ann1 = Annotation(
        annotation_id="ann-1",
        document_id="doc-1",
        layer_id="hpo-layer",
        type_id="phenotype",
        term_id="HP:0001252",
        axes_values={"assertion": "present"},
        evidence_refs=[EvidenceRef(evidence_id="ev-1", version=ev_snap.version)],
        provenance=Provenance(
            actor=ActorRef(actor_id="curator", kind="human"), method="manual"
        ),
    )
    snap1 = snapshot(ann1, [ev_snap], doc, profile)
    assert snap1.schema_version == "ontocurator-annotation/v3"
    assert snap1.layer_config_sha256 == layer_config_hash(profile, "hpo-layer")
    assert snap1.ontology_sha256 == profile.ontologies[0].sha256

    # 1. Identical data gives identical hash
    snap1_dup = snapshot(ann1, [ev_snap], doc, profile)
    assert snap1.version == snap1_dup.version

    # 2. Changing axes values changes snapshot version
    ann2 = ann1.model_copy(update={"axes_values": {"assertion": "uncertain"}})
    snap2 = snapshot(ann2, [ev_snap], doc, profile)
    assert snap2.version != snap1.version

    # 3. Changing ontology sha256 changes snapshot version
    profile_diff_ont = profile.model_copy(deep=True)
    profile_diff_ont.ontologies[0].sha256 = "different-sha256"
    snap3 = snapshot(ann1, [ev_snap], doc, profile_diff_ont)
    assert snap3.version != snap1.version


def test_hpo_example_profile_file_valid():
    import json
    from pathlib import Path

    profile_path = (
        Path(__file__).parent.parent
        / "src"
        / "ontocurator"
        / "profiles"
        / "hpo-context-example-v1.json"
    )
    raw = json.loads(profile_path.read_text(encoding="utf-8"))
    profile = TaskProfile.model_validate(raw)
    assert profile.profile_id == "hpo-context-example/v1"
    assert profile.default_layer_id == "hpo-layer"
    layer = resolve_layer(profile, "hpo-layer")
    assert layer.access == "editable"
    assert len(layer.annotation_types[0].axes) == 3


def test_layered_fixtures_scenarios():
    try:
        from tests.layered_fixtures import make_layered_package
    except ModuleNotFoundError:
        from layered_fixtures import make_layered_package

    # Scenario A: single
    pkg_a = make_layered_package("single")
    assert pkg_a.manifest.format_version == "ontocurator-work-package/v2"
    assert pkg_a.manifest.document_order == ["doc-beta", "doc-alpha"]
    assert len(pkg_a.manifest.task_profile.layers) == 1
    assert pkg_a.manifest.task_profile.layers[0].access == "editable"

    # Scenario B: assisted
    pkg_b = make_layered_package("assisted")
    assert pkg_b.manifest.format_version == "ontocurator-work-package/v2"
    assert len(pkg_b.manifest.task_profile.ontologies) == 2
    assert len(pkg_b.manifest.task_profile.layers) == 2
    ref_layer = resolve_layer(pkg_b.manifest.task_profile, "reference-layer")
    target_layer = resolve_layer(pkg_b.manifest.task_profile, "target-layer")
    assert ref_layer.access == "reference"
    assert target_layer.access == "editable"
    # Unaligned annotations in reference layer
    assert len(pkg_b.annotations) == 2

    # Scenario C: multi_editable
    pkg_c = make_layered_package("multi_editable")
    assert pkg_c.manifest.format_version == "ontocurator-work-package/v2"
    assert len(pkg_c.manifest.task_profile.layers) == 2
    assert all(
        layer.access == "editable" for layer in pkg_c.manifest.task_profile.layers
    )

    t_opt = resolve_type(pkg_c.manifest.task_profile, "layer-1", "type-opt")
    t_req = resolve_type(pkg_c.manifest.task_profile, "layer-2", "type-req")
    assert t_opt.evidence_policy == "optional"
    assert t_req.evidence_policy == "required_on_complete"
