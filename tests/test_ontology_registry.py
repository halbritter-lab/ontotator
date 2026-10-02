import hashlib
import json
from pathlib import Path

import pytest

from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
)
from ontocurator.ontology.registry import OntologyRegistry


def _create_synthetic_obo(
    tmp_path: Path, filename: str, term_id: str, label: str
) -> tuple[Path, str]:
    obo_curie = term_id.replace(":", "_")
    data = {
        "graphs": [
            {
                "id": f"http://purl.obolibrary.org/obo/{filename}",
                "meta": {"version": "2026-10-02"},
                "nodes": [
                    {
                        "id": f"http://purl.obolibrary.org/obo/{obo_curie}",
                        "lbl": label,
                        "type": "CLASS",
                        "meta": {"definition": {"val": f"Definition for {label}"}},
                    }
                ],
                "edges": [],
            }
        ]
    }
    path = tmp_path / filename
    content = json.dumps(data).encode("utf-8")
    path.write_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    return path, digest


def test_registry_registration_and_hash_validation(tmp_path: Path):
    path, digest = _create_synthetic_obo(
        tmp_path, "ont1.json", "TEST:0001", "Cardiac Arrest"
    )
    registry = OntologyRegistry()

    expected_good = OntologyDefinition(
        ontology_id="ont1",
        label="Ontology One",
        release="2026-10-02",
        sha256=digest,
        format="obo-graph-json",
    )
    registry.register(path, expected_good)

    # Wrong hash rejected
    expected_bad = expected_good.model_copy(update={"sha256": "0" * 64})
    with pytest.raises(DomainError, match="ONTOLOGY_HASH_MISMATCH"):
        registry.register(path, expected_bad)

    # Missing file rejected
    with pytest.raises(DomainError, match="ONTOLOGY_NOT_FOUND"):
        registry.register(tmp_path / "nonexistent.json", expected_good)


def test_same_term_id_in_two_ontologies_independent_indices_and_labels(tmp_path: Path):
    path1, digest1 = _create_synthetic_obo(
        tmp_path, "ont1.json", "TEST:0001", "Cardiac Arrest"
    )
    path2, digest2 = _create_synthetic_obo(
        tmp_path, "ont2.json", "TEST:0001", "Renal Failure"
    )

    registry = OntologyRegistry()
    ont1_def = OntologyDefinition(
        ontology_id="ont1",
        label="Cardiac Ontology",
        release="2026-10-02",
        sha256=digest1,
    )
    ont2_def = OntologyDefinition(
        ontology_id="ont2",
        label="Renal Ontology",
        release="2026-10-02",
        sha256=digest2,
    )
    registry.register(path1, ont1_def)
    registry.register(path2, ont2_def)

    type_def = AnnotationTypeDefinition(type_id="t1", label="Type 1", axes=[])
    layer1 = LayerDefinition(
        layer_id="layer-cardiac",
        label="Cardiac Layer",
        ontology_id="ont1",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_def],
    )
    layer2 = LayerDefinition(
        layer_id="layer-renal",
        label="Renal Layer",
        ontology_id="ont2",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_def],
    )
    profile = TaskProfile(
        profile_id="multi-ont/v1",
        version="1.0.0",
        ontologies=[ont1_def, ont2_def],
        layers=[layer1, layer2],
        default_layer_id="layer-cardiac",
    )

    # Layer 1 service
    svc1 = registry.for_layer(profile, "layer-cardiac")
    status1 = svc1.validate_term("TEST:0001")
    assert status1.status == "valid"
    assert status1.label == "Cardiac Arrest"

    # Layer 2 service
    svc2 = registry.for_layer(profile, "layer-renal")
    status2 = svc2.validate_term("TEST:0001")
    assert status2.status == "valid"
    assert status2.label == "Renal Failure"

    from ontocurator.domain.workspace import WorkspaceKey
    from ontocurator.ontology.provenance import SearchRequest

    ws_key = WorkspaceKey(
        package_id="p1",
        document_id="d1",
        annotator_id="u1",
        mode="independent",
        target_set_id="t1",
    )

    # Search on Layer 1 finds Cardiac Arrest, not Renal Failure
    req1 = SearchRequest(
        workspace_key=ws_key,
        annotation_id="a1",
        layer_id="layer-cardiac",
        query="Cardiac",
        route="lexical",
    )
    res1 = svc1.search(req1)
    assert res1.layer_id == "layer-cardiac"
    assert res1.ontology_sha256 == ont1_def.sha256
    assert any(
        c.term_id == "TEST:0001" and c.label == "Cardiac Arrest"
        for c in res1.candidates
    )

    req_none1 = SearchRequest(
        workspace_key=ws_key,
        annotation_id="a1",
        layer_id="layer-cardiac",
        query="Renal",
        route="lexical",
    )
    res_none1 = svc1.search(req_none1)
    assert len(res_none1.candidates) == 0

    # Search on Layer 2 finds Renal Failure, not Cardiac Arrest
    req2 = SearchRequest(
        workspace_key=ws_key,
        annotation_id="a2",
        layer_id="layer-renal",
        query="Renal",
        route="lexical",
    )
    res2 = svc2.search(req2)
    assert res2.layer_id == "layer-renal"
    assert res2.ontology_sha256 == ont2_def.sha256
    assert any(
        c.term_id == "TEST:0001" and c.label == "Renal Failure" for c in res2.candidates
    )

    req_none2 = SearchRequest(
        workspace_key=ws_key,
        annotation_id="a2",
        layer_id="layer-renal",
        query="Cardiac",
        route="lexical",
    )
    res_none2 = svc2.search(req_none2)
    assert len(res_none2.candidates) == 0


def test_numeric_search_is_scoped_to_layer_ontology(tmp_path: Path):
    from ontocurator.domain.workspace import WorkspaceKey
    from ontocurator.ontology.provenance import SearchRequest

    path1, digest1 = _create_synthetic_obo(
        tmp_path, "ont1.json", "TEST:0001", "Condition Alpha"
    )
    path2, digest2 = _create_synthetic_obo(
        tmp_path, "ont2.json", "TEST:0001", "Condition Beta"
    )

    registry = OntologyRegistry()
    ont1_def = OntologyDefinition(
        ontology_id="ont1", label="Ont 1", release="v1", sha256=digest1
    )
    ont2_def = OntologyDefinition(
        ontology_id="ont2", label="Ont 2", release="v2", sha256=digest2
    )
    registry.register(path1, ont1_def)
    registry.register(path2, ont2_def)

    type_def = AnnotationTypeDefinition(type_id="t1", label="T1", axes=[])
    l1 = LayerDefinition(
        layer_id="l1",
        label="L1",
        ontology_id="ont1",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_def],
    )
    l2 = LayerDefinition(
        layer_id="l2",
        label="L2",
        ontology_id="ont2",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_def],
    )
    profile = TaskProfile(
        profile_id="num-test/v1",
        version="1.0.0",
        ontologies=[ont1_def, ont2_def],
        layers=[l1, l2],
        default_layer_id="l1",
    )

    svc1 = registry.for_layer(profile, "l1")
    svc2 = registry.for_layer(profile, "l2")

    ws_key = WorkspaceKey(
        package_id="p",
        document_id="d",
        annotator_id="u",
        mode="independent",
        target_set_id="t",
    )

    # Numeric lookup "1" resolves correctly within each index
    res1 = svc1.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="a1",
            layer_id="l1",
            query="1",
            route="id",
        )
    )
    assert len(res1.candidates) == 1
    assert res1.candidates[0].label == "Condition Alpha"

    res2 = svc2.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="a2",
            layer_id="l2",
            query="1",
            route="id",
        )
    )
    assert len(res2.candidates) == 1
    assert res2.candidates[0].label == "Condition Beta"


def test_missing_ontology_resource_reported_clearly(tmp_path: Path):
    registry = OntologyRegistry()
    ont_def = OntologyDefinition(
        ontology_id="missing-ont",
        label="Missing Ontology",
        release="2026-10-02",
        sha256="abcdef" * 10 + "1234",
    )
    layer = LayerDefinition(
        layer_id="l1",
        label="L1",
        ontology_id="missing-ont",
        access="editable",
        default_type_id="t1",
        annotation_types=[AnnotationTypeDefinition(type_id="t1", label="T1", axes=[])],
    )
    profile = TaskProfile(
        profile_id="missing-test/v1",
        version="1.0.0",
        ontologies=[ont_def],
        layers=[layer],
        default_layer_id="l1",
    )
    with pytest.raises(DomainError, match="ONTOLOGY_NOT_FOUND"):
        registry.for_layer(profile, "l1")


def test_registry_caching_by_sha256(tmp_path: Path):
    path, digest = _create_synthetic_obo(
        tmp_path, "ont.json", "TEST:0001", "Some Condition"
    )
    registry = OntologyRegistry()
    ont_def = OntologyDefinition(
        ontology_id="ont", label="Ont", release="v1", sha256=digest
    )
    registry.register(path, ont_def)

    type_def = AnnotationTypeDefinition(type_id="t1", label="T1", axes=[])
    l1 = LayerDefinition(
        layer_id="l1",
        label="L1",
        ontology_id="ont",
        access="editable",
        default_type_id="t1",
        annotation_types=[type_def],
    )
    profile = TaskProfile(
        profile_id="cache-test/v1",
        version="1.0.0",
        ontologies=[ont_def],
        layers=[l1],
        default_layer_id="l1",
    )

    svc_first = registry.for_layer(profile, "l1")
    svc_second = registry.for_layer(profile, "l1")
    assert svc_first is svc_second
