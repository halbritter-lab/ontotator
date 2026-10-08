"""The ontology tree: roots, children and paths, without the API."""

import gc
import json
import weakref
from pathlib import Path

import pytest

from ontocurator.domain.errors import DomainError
from ontocurator.ontology.tree import OntologyTree, tree_for
from ontocurator.vendor.hpo_span_annotator.hpo import load

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "hp.json"

# id -> (label, parents, obsolete). Ids are chosen so that sorting by id and
# sorting by label disagree everywhere it matters.
GRAPH: dict[str, tuple[str, tuple[str, ...], bool]] = {
    "0000001": ("Root", (), False),
    "0000003": ("Alpha", ("0000001",), False),
    "0000002": ("Beta", ("0000001",), False),
    "0000004": ("Gamma", ("0000003",), False),
    # Short way under Beta, long way under Alpha > Gamma.
    "0000005": ("Shortcut", ("0000004", "0000002"), False),
    # Two equally short ways; the file names Beta first.
    "0000006": ("Twin", ("0000002", "0000003"), False),
    "0000007": ("Zulu", ("0000003",), False),
    "0000008": ("Able", ("0000002",), False),
    # Root > Alpha > Zulu > Deep and Root > Beta > Able > Deep.
    "0000009": ("Deep", ("0000008", "0000007"), False),
    "0000010": ("Retired child", ("0000003",), True),
    "0000011": ("Retired root", (), True),
    "0000012": ("Orphan of a retired term", ("0000011",), False),
    "0000013": ("Another root", (), False),
}


def _iri(local: str) -> str:
    return f"http://purl.obolibrary.org/obo/TEST_{local}"


def tid(local: str) -> str:
    return f"TEST:{local}"


def write_graph_ontology(directory: Path) -> Path:
    """Write the multi-parent test ontology and return its path."""
    payload = {
        "graphs": [
            {
                "id": "http://example.com/tree.json",
                "meta": {"version": "http://example.com/releases/2026-06-23/tree.json"},
                "nodes": [
                    {
                        "id": _iri(local),
                        "lbl": label,
                        "type": "CLASS",
                        "meta": {"deprecated": True} if obsolete else {},
                    }
                    for local, (label, _, obsolete) in GRAPH.items()
                ],
                "edges": [
                    {"sub": _iri(local), "pred": "is_a", "obj": _iri(parent)}
                    for local, (_, parents, _) in GRAPH.items()
                    for parent in parents
                ],
            }
        ]
    }
    path = directory / "tree.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _graph_tree(tmp_path: Path) -> OntologyTree:
    return OntologyTree(load(write_graph_ontology(tmp_path)))


def _fixture_tree() -> OntologyTree:
    return OntologyTree(load(FIXTURE_PATH))


def test_roots_are_live_terms_without_live_parents_sorted_by_label(
    tmp_path: Path,
) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.roots() == [tid("0000013"), tid("0000012"), tid("0000001")]
    assert [n.label for n in tree.nodes(tree.roots())] == [
        "Another root",
        "Orphan of a retired term",
        "Root",
    ]
    assert _fixture_tree().roots() == ["HP:0000001"]


def test_children_are_sorted_by_label_and_leave_out_obsolete_terms(
    tmp_path: Path,
) -> None:
    fixture = _fixture_tree()
    # By id this would be 1250, 1252, 1284.
    assert fixture.children_of("HP:0000707") == [
        "HP:0001284",
        "HP:0001252",
        "HP:0001250",
    ]
    assert fixture.children_of("HP:0002133") == []
    assert fixture.children_of("HP:9999999") == []

    tree = _graph_tree(tmp_path)
    assert [n.label for n in tree.nodes(tree.children_of(tid("0000003")))] == [
        "Gamma",
        "Twin",
        "Zulu",
    ]
    alpha = tree.node(tid("0000003"))
    assert (alpha.label, alpha.child_count) == ("Alpha", 3)
    # A retired term has no place in the tree, not even when asked for directly.
    assert tree.children_of(tid("0000011")) == []


def test_single_parent_path_runs_from_the_root_to_the_term() -> None:
    tree = _fixture_tree()

    assert tree.path_to("HP:0002133") == [
        "HP:0000001",
        "HP:0000118",
        "HP:0000707",
        "HP:0001250",
        "HP:0002133",
    ]
    assert tree.path_to("HP:0000001") == ["HP:0000001"]
    # Ids resolve the way they do everywhere else.
    assert tree.path_to("hp:0001250")[-1] == "HP:0001250"


def test_unknown_and_obsolete_terms_have_no_path() -> None:
    tree = _fixture_tree()

    assert tree.path_to("HP:9999999") == []
    assert tree.path_to("HP:0000123") == []


def test_the_shortest_path_wins_over_the_alphabetically_first(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.path_to(tid("0000005")) == [
        tid("0000001"),
        tid("0000002"),
        tid("0000005"),
    ]


def test_equally_short_paths_are_decided_by_label_not_by_id_or_file_order(
    tmp_path: Path,
) -> None:
    tree = _graph_tree(tmp_path)

    # Alpha has the higher id and comes second in the file.
    assert tree.path_to(tid("0000006")) == [
        tid("0000001"),
        tid("0000003"),
        tid("0000006"),
    ]


def test_the_tie_is_decided_from_the_root_down(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    # The direct parents are Able and Zulu; Alpha before Beta decides, one
    # level further up.
    assert tree.path_to(tid("0000009")) == [
        tid("0000001"),
        tid("0000003"),
        tid("0000007"),
        tid("0000009"),
    ]


def test_via_parent_forces_the_last_step(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.path_to(tid("0000005"), via_parent_id=tid("0000004")) == [
        tid("0000001"),
        tid("0000003"),
        tid("0000004"),
        tid("0000005"),
    ]
    assert tree.path_to(tid("0000009"), via_parent_id=tid("0000008")) == [
        tid("0000001"),
        tid("0000002"),
        tid("0000008"),
        tid("0000009"),
    ]


@pytest.mark.parametrize("not_a_parent", ["0000001", "0000007", "0000099"])
def test_via_parent_must_be_a_parent_of_the_term(
    tmp_path: Path, not_a_parent: str
) -> None:
    tree = _graph_tree(tmp_path)

    with pytest.raises(DomainError) as raised:
        tree.path_to(tid("0000005"), via_parent_id=tid(not_a_parent))
    assert raised.value.code == "INVALID_TREE_PARENT"


def test_a_retired_parent_is_no_way_into_the_tree(tmp_path: Path) -> None:
    tree = _graph_tree(tmp_path)

    assert tree.parents_of(tid("0000012")) == []
    assert tree.path_to(tid("0000012")) == [tid("0000012")]
    with pytest.raises(DomainError):
        tree.path_to(tid("0000012"), via_parent_id=tid("0000011"))


def test_one_tree_is_kept_per_loaded_ontology() -> None:
    ontology = load(FIXTURE_PATH)

    tree = tree_for(ontology)

    assert tree_for(ontology) is tree
    assert tree_for(load(FIXTURE_PATH)) is not tree
    # The kept list of roots is not handed out for others to change.
    tree.roots().append("HP:0000118")
    assert tree.roots() == ["HP:0000001"]


def test_an_ontology_with_a_tree_is_released_once_nothing_else_holds_it() -> None:
    ontology = load(FIXTURE_PATH)
    tree = tree_for(ontology)
    assert tree.roots() == ["HP:0000001"]
    assert tree.path_to("HP:0001250")
    gone = weakref.ref(ontology)

    del ontology, tree
    gc.collect()

    # A replaced ontology (every translation upload loads a new one) must not
    # stay in memory because a tree was once built for it.
    assert gone() is None


def test_unknown_and_obsolete_terms_have_no_detail() -> None:
    tree = _fixture_tree()

    assert tree.detail("HP:9999999") is None
    assert tree.detail("HP:0000123") is None


def test_levels_list_the_children_under_each_expanded_node() -> None:
    tree = _fixture_tree()

    levels = tree.levels(["HP:0000001", "HP:0000118"])

    assert [level.term_id for level in levels] == ["HP:0000001", "HP:0000118"]
    assert [n.term_id for n in levels[0].children] == ["HP:0000118"]
    assert [(n.term_id, n.label, n.child_count) for n in levels[1].children] == [
        ("HP:0000707", "Abnormality of the nervous system", 3),
        ("HP:0000365", "Hearing impairment", 1),
    ]


def test_detail_lists_names_translations_and_all_parents(tmp_path: Path) -> None:
    fixture = _fixture_tree()
    term = fixture.ontology.terms["HP:0001252"]
    # What a loaded translation file leaves on the term.
    term.translations["de"] = ["Muskelhypotonie", "Hypotonie"]
    term.translations["fr"] = ["Hypotonie musculaire"]
    term.translations["es"] = []

    detail = fixture.detail("HP:0001252")

    assert detail is not None
    assert (detail.term_id, detail.label) == ("HP:0001252", "Hypotonia")
    assert detail.definition
    assert detail.synonyms == ["Low muscle tone", "Muscle hypotonia", "Hypotonic"]
    assert detail.translations == {
        "de": ["Muskelhypotonie", "Hypotonie"],
        "fr": ["Hypotonie musculaire"],
    }
    assert list(detail.translations) == ["de", "fr"]
    assert [n.term_id for n in detail.parents] == ["HP:0000707"]

    untranslated = fixture.detail("HP:0001250")
    assert untranslated is not None
    assert untranslated.translations == {}

    graph = _graph_tree(tmp_path)
    twin = graph.detail(tid("0000006"))
    assert twin is not None
    assert [n.label for n in twin.parents] == ["Alpha", "Beta"]
    root = graph.detail(tid("0000001"))
    assert root is not None
    assert root.parents == []


def test_a_kept_path_is_not_handed_out_for_others_to_change() -> None:
    tree = _fixture_tree()

    tree.path_to("HP:0002133").append("HP:0000001")
    tree.path_to("HP:0001250").clear()

    assert tree.path_to("HP:0002133")[-2:] == ["HP:0001250", "HP:0002133"]
    assert tree.path_to("HP:0001250")[-1] == "HP:0001250"
    assert tree.path_to("HP:0002133", via_parent_id="HP:0001250") == tree.path_to(
        "HP:0002133"
    )


def test_a_cyclic_file_gives_the_same_paths_whatever_was_asked_first(
    tmp_path: Path,
) -> None:
    # Root > A > B, and the file wrongly names B a parent of A as well.
    def cyclic_tree() -> OntologyTree:
        ontology = load(write_graph_ontology(tmp_path))
        ontology.terms[tid("0000003")].parents.append(tid("0000004"))
        return OntologyTree(ontology)

    expected = {
        tid("0000003"): [tid("0000001"), tid("0000003")],
        tid("0000004"): [tid("0000001"), tid("0000003"), tid("0000004")],
    }
    for order in (["0000003", "0000004"], ["0000004", "0000003"]):
        tree = cyclic_tree()
        for _ in range(2):
            for local in order:
                assert tree.path_to(tid(local)) == expected[tid(local)], order
