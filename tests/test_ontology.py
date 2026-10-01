import hashlib
from pathlib import Path

import pytest

from hpo_editor.domain.documents import OntologyRef
from hpo_editor.domain.errors import DomainError
from hpo_editor.domain.workspace import WorkspaceKey
from hpo_editor.ontology.provenance import SearchRequest
from hpo_editor.ontology.service import OntologyService

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
        package_id="pkg-1",
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
