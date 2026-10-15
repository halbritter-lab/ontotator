import hashlib
from pathlib import Path

import pytest

from ontocurator.domain.documents import OntologyRef
from ontocurator.domain.errors import DomainError
from ontocurator.domain.workspace import WorkspaceKey
from ontocurator.ontology.provenance import SearchRequest
from ontocurator.ontology.service import OntologyService

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"


def _fixture_ref() -> OntologyRef:
    raw = FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    return OntologyRef(release="2026-06-23", sha256=digest)


def test_ontology_load_and_hash_verification() -> None:
    expected = _fixture_ref()
    service = OntologyService.load(FIXTURE_PATH, expected)
    assert service.ontology.release == "2026-06-23"

    # Mismatched hash rejected
    bad_ref = OntologyRef(release="2026-06-23", sha256="wrong-hash")
    with pytest.raises(DomainError, match="ONTOLOGY_HASH_MISMATCH"):
        OntologyService.load(FIXTURE_PATH, bad_ref)


def test_ontology_term_validation() -> None:
    service = OntologyService.load(FIXTURE_PATH, _fixture_ref())

    # Valid term
    status_valid = service.validate_term("HP:0001252")
    assert status_valid.status == "valid"
    assert status_valid.label == "Hypotonia"

    # Deprecated / obsolete term (from fixture HP:0000123)
    status_obs = service.validate_term("HP:0000123")
    assert status_obs.status == "obsolete"

    # Unknown term
    status_unk = service.validate_term("HP:9999999")
    assert status_unk.status == "unknown"
    assert status_unk.label is None


def test_search_exact_id_and_lexical_shuffling() -> None:
    service = OntologyService.load(FIXTURE_PATH, _fixture_ref())

    ws_key = WorkspaceKey(
        project_key="pkg-1",
        document_id="doc-1",
        annotator_id="dr-meier",
        mode="independent",
        target_set_id="targets-1",
    )

    # 1. Search by exact ID
    req_id = SearchRequest(
        workspace_key=ws_key,
        annotation_id="ann-1",
        query="HP:0001250",
        route="id",
        k=10,
    )
    res_id = service.search(req_id)
    assert len(res_id.candidates) == 1
    assert res_id.candidates[0].hpo_id == "HP:0001250"
    assert res_id.candidates[0].label == "Seizure"
    assert res_id.displayed_ids == ["HP:0001250"]

    # 2. Search exact / starts_with
    req_exact = SearchRequest(
        workspace_key=ws_key,
        annotation_id="ann-1",
        query="Hypotonia",
        route="exact",
        k=10,
    )
    res_exact = service.search(req_exact)
    assert len(res_exact.candidates) >= 1
    assert res_exact.candidates[0].hpo_id == "HP:0001252"

    # 3. Lexical search with character n-grams and stable shuffling
    req_lex1 = SearchRequest(
        workspace_key=ws_key,
        annotation_id="ann-stable-id-1",
        query="hypoton",
        route="lexical",
        k=10,
    )
    res_lex1 = service.search(req_lex1)
    assert len(res_lex1.candidates) >= 1
    # Ranked IDs set matches displayed IDs set
    assert set(res_lex1.displayed_ids) == set(res_lex1.ranked_ids)
    assert len(res_lex1.displayed_ids) == len(res_lex1.ranked_ids)

    # Determinism: same seed inputs produce identical displayed order
    res_lex2 = service.search(req_lex1)
    assert res_lex1.displayed_ids == res_lex2.displayed_ids

    # Different annotator or annotation_id yields different seed / permutation
    req_lex_other = SearchRequest(
        workspace_key=ws_key.model_copy(update={"annotator_id": "dr-other"}),
        annotation_id="ann-other-id",
        query="hypoton",
        route="lexical",
        k=10,
    )
    res_lex_other = service.search(req_lex_other)
    assert set(res_lex_other.displayed_ids) == set(res_lex1.displayed_ids)


def test_hierarchy_warnings_exhaustive_traversal() -> None:
    service = OntologyService.load(FIXTURE_PATH, _fixture_ref())

    # In fixture:
    # HP:0002133 (Status epilepticus) is_a HP:0001250 (Seizure)
    # HP:0001250 is_a HP:0000707 (Abnormality of nervous system)
    # HP:0000707 is_a HP:0000118 (Phenotypic abnormality)
    # HP:0000118 is_a HP:0000001 (All)

    terms = ["HP:0002133", "HP:0001250", "HP:0000707", "HP:0000365"]
    warnings = service.hierarchy_warnings(terms)
    # HP:0002133 has ancestors HP:0001250 and HP:0000707
    # HP:0001250 has ancestor HP:0000707
    # HP:0000365 is Hearing impairment (unrelated to nervous system)
    assert len(warnings) >= 2
    pairs = {(w.parent_id, w.child_id) for w in warnings}
    assert ("HP:0001250", "HP:0002133") in pairs
    assert ("HP:0000707", "HP:0002133") in pairs
    assert ("HP:0000707", "HP:0001250") in pairs


MONDO_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "mondo.json"


def _mondo_fixture_ref() -> OntologyRef:
    raw = MONDO_FIXTURE_PATH.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    return OntologyRef(release="2026-09-01", sha256=digest)


def test_mondo_ontology_load_validation_and_search() -> None:
    expected = _mondo_fixture_ref()
    service = OntologyService.load(MONDO_FIXTURE_PATH, expected)
    assert service.ontology.release == "2026-09-01"

    # Term validation
    status_valid = service.validate_term("MONDO:0001250")
    assert status_valid.status == "valid"
    assert status_valid.label == "spinal muscular atrophy"
    assert "SMA" in status_valid.synonyms

    # Obsolete term
    status_obs = service.validate_term("MONDO:0000123")
    assert status_obs.status == "obsolete"

    # Unknown term
    status_unk = service.validate_term("MONDO:9999999")
    assert status_unk.status == "unknown"

    # Unsupported IRI not loaded
    assert service.validate_term("unsupported:non_obo_identifier").status == "unknown"

    ws_key = WorkspaceKey(
        project_key="pkg-mondo",
        document_id="doc-1",
        annotator_id="dr-meier",
        mode="independent",
        target_set_id="targets-1",
    )

    # Search by full CURIE
    res_curie = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="MONDO:0001250",
            route="id",
            k=10,
        )
    )
    assert len(res_curie.candidates) == 1
    assert res_curie.candidates[0].term_id == "MONDO:0001250"
    assert res_curie.candidates[0].hpo_id == "MONDO:0001250"
    assert res_curie.candidates[0].label == "spinal muscular atrophy"

    # Search by non-dominant loaded prefix explicit CURIE
    res_orphanet = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="Orphanet:791",
            route="id",
            k=10,
        )
    )
    assert len(res_orphanet.candidates) == 1
    assert res_orphanet.candidates[0].term_id == "Orphanet:791"

    # Numeric search integer-equivalent in dominant prefix: '1250' -> MONDO:0001250
    res_num = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="1250",
            route="id",
            k=10,
        )
    )
    assert len(res_num.candidates) == 1
    assert res_num.candidates[0].term_id == "MONDO:0001250"

    # Variable numeric width: 4 digits '1001' -> MONDO:1001
    res_num4 = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="1001",
            route="id",
            k=10,
        )
    )
    assert len(res_num4.candidates) == 1
    assert res_num4.candidates[0].term_id == "MONDO:1001"

    # Exact search on label and exact synonym
    res_exact_label = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="spinal muscular atrophy",
            route="exact",
            k=10,
        )
    )
    assert len(res_exact_label.candidates) >= 1
    assert res_exact_label.candidates[0].term_id == "MONDO:0001250"

    res_exact_syn = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="SMA",
            route="exact",
            k=10,
        )
    )
    assert any(c.term_id == "MONDO:0001250" for c in res_exact_syn.candidates)

    # Lexical search
    res_lex = service.search(
        SearchRequest(
            workspace_key=ws_key,
            annotation_id="ann-1",
            query="muscular atrophy",
            route="lexical",
            k=10,
        )
    )
    assert any(c.term_id == "MONDO:0001250" for c in res_lex.candidates)


def test_prefix_ties_and_ambiguous_numeric_queries(tmp_path: Path) -> None:
    import json

    from ontocurator.vendor.hpo_span_annotator.hpo import load as load_ontology
    from ontocurator.vendor.hpo_span_annotator.search import SearchEngine

    # 1. Prefix tie: 2 terms with PREA and 2 terms with PREB
    tie_payload = {
        "graphs": [
            {
                "id": "http://example.com/tie.json",
                "meta": {"version": "http://example.com/releases/2026-01-01/tie.json"},
                "nodes": [
                    {
                        "id": "http://purl.obolibrary.org/obo/PREA_0001",
                        "lbl": "A1",
                        "type": "CLASS",
                    },
                    {
                        "id": "http://purl.obolibrary.org/obo/PREA_0002",
                        "lbl": "A2",
                        "type": "CLASS",
                    },
                    {
                        "id": "http://purl.obolibrary.org/obo/PREB_0001",
                        "lbl": "B1",
                        "type": "CLASS",
                    },
                    {
                        "id": "http://purl.obolibrary.org/obo/PREB_0002",
                        "lbl": "B2",
                        "type": "CLASS",
                    },
                ],
            }
        ]
    }
    tie_file = tmp_path / "tie.json"
    tie_file.write_text(json.dumps(tie_payload), encoding="utf-8")
    ont_tie = load_ontology(tie_file)
    engine_tie = SearchEngine(ontology=ont_tie)

    # Digits query '1' has a prefix tie (PREA vs PREB) -> returns no candidates
    res_tie = engine_tie.search("1", path="id")
    assert res_tie["hits"] == []

    # Explicit CURIE lookup succeeds for both
    res_a = engine_tie.search("PREA:0001", path="id")
    assert len(res_a["hits"]) == 1
    assert res_a["hits"][0]["hpo_id"] == "PREA:0001"

    res_b = engine_tie.search("PREB:0001", path="id")
    assert len(res_b["hits"]) == 1
    assert res_b["hits"][0]["hpo_id"] == "PREB:0001"

    # 2. Ambiguous numeric ID within dominant prefix: TEST:123 and TEST:0123
    ambig_payload = {
        "graphs": [
            {
                "id": "http://example.com/ambig.json",
                "meta": {
                    "version": "http://example.com/releases/2026-01-01/ambig.json"
                },
                "nodes": [
                    {
                        "id": "http://purl.obolibrary.org/obo/TEST_123",
                        "lbl": "Test short",
                        "type": "CLASS",
                    },
                    {
                        "id": "http://purl.obolibrary.org/obo/TEST_0123",
                        "lbl": "Test padded",
                        "type": "CLASS",
                    },
                    {
                        "id": "http://purl.obolibrary.org/obo/TEST_999",
                        "lbl": "Test other",
                        "type": "CLASS",
                    },
                ],
            }
        ]
    }
    ambig_file = tmp_path / "ambig.json"
    ambig_file.write_text(json.dumps(ambig_payload), encoding="utf-8")
    ont_ambig = load_ontology(ambig_file)
    engine_ambig = SearchEngine(ontology=ont_ambig)

    # Digits query '123' matches two IDs (TEST:123 and TEST:0123)
    # -> returns no candidates
    res_ambig = engine_ambig.search("123", path="id")
    assert res_ambig["hits"] == []

    # Explicit queries for each succeed
    assert len(engine_ambig.search("TEST:123", path="id")["hits"]) == 1
    assert len(engine_ambig.search("TEST:0123", path="id")["hits"]) == 1


def test_case_preservation_and_alphanumeric_ids(tmp_path: Path) -> None:
    import json

    from ontocurator.vendor.hpo_span_annotator.hpo import load as load_ontology
    from ontocurator.vendor.hpo_span_annotator.search import SearchEngine

    payload = {
        "graphs": [
            {
                "id": "http://example.com/mixed.json",
                "meta": {
                    "version": "http://example.com/releases/2026-01-01/mixed.json"
                },
                "nodes": [
                    {
                        "id": "http://purl.obolibrary.org/obo/gene_Abc123",
                        "lbl": "Gene Abc123",
                        "type": "CLASS",
                    },
                    {
                        "id": "http://purl.obolibrary.org/obo/gene_Def456",
                        "lbl": "Gene Def456",
                        "type": "CLASS",
                    },
                ],
            }
        ]
    }
    f = tmp_path / "mixed.json"
    f.write_text(json.dumps(payload), encoding="utf-8")
    ont = load_ontology(f)
    assert "gene:Abc123" in ont.terms
    term = ont.get("gene:Abc123")
    assert term is not None
    assert term.hpo_id == "gene:Abc123"

    engine = SearchEngine(ontology=ont)
    res = engine.search("gene:Abc123", path="id")
    assert len(res["hits"]) == 1
    assert res["hits"][0]["hpo_id"] == "gene:Abc123"

    # Alphanumeric local ID is not matched by digits-only query
    res_digits = engine.search("123", path="id")
    assert res_digits["hits"] == []
