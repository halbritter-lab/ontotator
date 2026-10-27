"""Translation files: their names, where they are found, what the loader keeps."""

import codecs
import hashlib
import shutil
from pathlib import Path

import pytest

from ontotator.ontology.translations import (
    apply_translations,
    babelon_problem,
    discover_translation_files,
    parse_translation_name,
    translation_counts,
)
from ontotator.vendor.hpo_span_annotator.hpo import load as load_ontology

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("hp-de.babelon.tsv", ("hp", "de")),
        ("hp-de.synonyms.tsv", ("hp", "de")),
        ("HP-DE.Babelon.TSV", ("hp", "de")),
        ("mondo-es.babelon.tsv", ("mondo", "es")),
        ("hp-de.tsv", ("hp", "de")),
        ("hp.json", None),
        ("hp-de.babelon.csv", None),
        ("hp-deu.babelon.tsv", None),
        ("hp_de.babelon.tsv", None),
        ("-de.babelon.tsv", None),
        ("hp-de.a/b.tsv", None),
        ("notes.tsv", None),
    ],
)
def test_translation_file_names(name: str, expected: tuple[str, str] | None) -> None:
    assert parse_translation_name(name) == expected


def test_discovery_takes_the_first_folder_for_a_name(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    bundle = tmp_path / "bundle"
    workspace.mkdir()
    bundle.mkdir()
    shutil.copyfile(DE, workspace / "hp-de.babelon.tsv")
    shutil.copyfile(DE, bundle / "hp-de.babelon.tsv")
    shutil.copyfile(ES, bundle / "HP-ES.Babelon.TSV")
    (bundle / "notes.tsv").write_text("a\tb\n", encoding="utf-8")
    (bundle / "hp.json").write_text("{}", encoding="utf-8")

    found = discover_translation_files([workspace, bundle, tmp_path / "missing"])

    # Sorted by name; upper case in a name does not hide a file.
    assert found == [workspace / "hp-de.babelon.tsv", bundle / "HP-ES.Babelon.TSV"]
    assert discover_translation_files([]) == []


def test_the_fixtures_exercise_every_skip_rule_of_the_loader() -> None:
    ontology = load_ontology(HP)
    loaded, skipped = apply_translations(ontology, [ES, DE])

    assert skipped == []
    assert [(item.filename, item.languages) for item in loaded] == [
        ("hp-de.babelon.tsv", ("de",)),
        ("hp-es.babelon.tsv", ("es",)),
    ]
    assert loaded[0].sha256 == hashlib.sha256(DE.read_bytes()).hexdigest()
    assert loaded[1].sha256 == hashlib.sha256(ES.read_bytes()).hexdigest()
    assert translation_counts(ontology) == {"de": 4, "es": 3}

    def names(term_id: str) -> dict[str, list[str]]:
        return ontology.terms[term_id].translations

    # The definition row (IAO:0000115) is not a name.
    assert names("HP:0001250") == {"de": ["Krampfanfall"], "es": ["Crisis epiléptica"]}
    assert names("HP:0001252") == {"de": ["Muskelhypotonie"], "es": ["Hipotonía"]}
    # "Areflexia" (de) repeats the English label and is dropped.
    assert names("HP:0001284") == {"es": ["Arreflexia"]}
    # "Hipoacusia" (es) repeats an English synonym and is dropped.
    assert names("HP:0000365") == {"de": ["Schwerhörigkeit"]}
    assert names("HP:0000407") == {"de": ["Schallempfindungsschwerhörigkeit"]}
    # The obsolete term gets no name; the unknown id is ignored.
    assert names("HP:0000123") == {}
    assert "HP:9999999" not in ontology.terms


def test_files_of_another_prefix_are_not_applied() -> None:
    mondo = load_ontology(MONDO)

    assert apply_translations(mondo, [DE, ES]) == ([], [])
    assert translation_counts(mondo) == {}
    assert all(not term.translations for term in mondo.terms.values())


def test_unusable_files_are_reported_not_raised(tmp_path: Path) -> None:
    no_header = tmp_path / "hp-fr.babelon.tsv"
    no_header.write_text("term\tname\nHP:0001250\tCrise\n", encoding="utf-8")
    no_rows = tmp_path / "hp-nl.babelon.tsv"
    no_rows.write_text(
        "subject_id\tpredicate_id\ttranslation_value\n"
        "HP:9999999\trdfs:label\tOnbekend\n",
        encoding="utf-8",
    )
    not_text = tmp_path / "hp-es.babelon.tsv"
    not_text.write_bytes(b"\xff\xfe\x00broken")

    assert babelon_problem(DE) is None
    assert babelon_problem(no_rows) is None
    assert "subject_id" in (babelon_problem(no_header) or "")
    assert "cannot be read" in (babelon_problem(not_text) or "")
    assert "cannot be read" in (babelon_problem(tmp_path / "missing.tsv") or "")

    ontology = load_ontology(HP)
    loaded, skipped = apply_translations(ontology, [no_header, DE, no_rows, not_text])

    assert [item.filename for item in loaded] == ["hp-de.babelon.tsv"]
    reasons = {item.filename: item.reason for item in skipped}
    assert set(reasons) == {
        "hp-es.babelon.tsv",
        "hp-fr.babelon.tsv",
        "hp-nl.babelon.tsv",
    }
    assert "subject_id" in reasons["hp-fr.babelon.tsv"]
    assert "holds no name" in reasons["hp-nl.babelon.tsv"]
    assert translation_counts(ontology) == {"de": 4}


def test_a_file_with_a_byte_order_mark_loads_like_one_without(tmp_path: Path) -> None:
    """Excel writes "UTF-8 with BOM". The mark is not part of the first column
    name, and the file counts with the bytes it has on disk."""
    with_mark = tmp_path / "hp-de.babelon.tsv"
    with_mark.write_bytes(codecs.BOM_UTF8 + DE.read_bytes())
    assert DE.read_bytes().startswith(b"subject_id")

    assert babelon_problem(with_mark) is None

    ontology = load_ontology(HP)
    loaded, skipped = apply_translations(ontology, [with_mark])

    assert skipped == []
    assert [(item.filename, item.languages) for item in loaded] == [
        ("hp-de.babelon.tsv", ("de",))
    ]
    assert loaded[0].sha256 == hashlib.sha256(with_mark.read_bytes()).hexdigest()
    assert translation_counts(ontology) == {"de": 4}
    assert ontology.terms["HP:0001250"].translations == {"de": ["Krampfanfall"]}
    # The file itself is left as it is.
    assert with_mark.read_bytes() == codecs.BOM_UTF8 + DE.read_bytes()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["hp-de.babelon.tsv"]

    # A marked file that is no babelon TSV is named by its own name.
    wrong = tmp_path / "hp-fr.babelon.tsv"
    wrong.write_bytes(codecs.BOM_UTF8 + b"term\tname\nHP:0001250\tCrise\n")
    assert "subject_id" in (babelon_problem(wrong) or "")
    _, skipped = apply_translations(load_ontology(HP), [wrong])
    assert [item.filename for item in skipped] == ["hp-fr.babelon.tsv"]
    assert str(wrong) in skipped[0].reason


@pytest.mark.parametrize(
    ("fixture", "sha256"),
    [
        (DE, "aa8f4e933a4fa12078b83e039d2d3aff273706b550e416f584228a034d7aeb12"),
        (ES, "3f3af8643b35997d4d8be01fbb9615652e0aa30350f2baca06e5b49caba9cc7e"),
    ],
)
def test_the_fixtures_have_the_same_bytes_on_every_platform(
    fixture: Path, sha256: str
) -> None:
    """Translation files count by their bytes (index identity). `*.tsv -text`
    in .gitattributes keeps a Windows checkout from turning the line ends of
    the fixtures into CRLF, which would give them another identity there."""
    assert hashlib.sha256(fixture.read_bytes()).hexdigest() == sha256
