"""Translation files: their names, where they are found, what the loader keeps."""

import hashlib
import shutil
from pathlib import Path

import pytest

from ontocurator.ontology.translations import (
    apply_translations,
    babelon_problem,
    discover_translation_files,
    parse_translation_name,
    translation_counts,
)
from ontocurator.vendor.hpo_span_annotator.hpo import load as load_ontology

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
