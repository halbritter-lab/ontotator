# Term Search, Part 2: Translations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- fmt: off -->
<!-- The marker above keeps `ruff format` from rewriting the Python blocks in this file. They are exact file text, indentation included; ruff would dedent the fragments and turn single keyword-argument lines into tuple assignments. -->

## TL;DR (Deutsch)

- Offizielle HPO-Übersetzungsdateien (`hp-de.babelon.tsv`, `hp-de.synonyms.tsv` usw.) liegen neben der Ontologie und werden mit durchsucht: exakte Treffer auf übersetzte Namen stehen im oberen Block, ähnliche Treffer melden ihre Sprache.
- Zuordnung über den Dateinamen (`hp-…` gehört zur Ontologie mit dem Präfix `HP`). Kaputte oder nicht zuordenbare Dateien werden mit Hinweis übersprungen und halten den Start nicht auf.
- Upload über „Add ontology (.json) or translation (.tsv)“: Die Datei wird geprüft, gespeichert, die Ontologie neu indiziert. Schlägt etwas fehl, bleibt alles wie vorher.
- Jeder Annotator wählt rechts im Suchfeld per Flaggen-Knopf, in welchen Sprachen gesucht wird; Englisch ist immer an. Die Wahl liegt in `preferences.json` und ist nach Neuladen wieder da. Das Suchereignis hält die aktiven Sprachen fest.
- Bundles: `--translation TSV` in `build_standalone.py` und `provision_bundle.py`.
- Vendored Code bleibt unangetastet. 14 Aufgaben: sieben Backend, eine Einstellungen, Vertrag, drei Frontend, Bundles, Abschlussprüfung mit Browser-Test, Screenshots und eingebetteten Web-Assets. Jede Aufgabe wurde in dieser Reihenfolge auf einem sauberen Stand angewendet und war für sich grün.

**Goal:** Let annotators find terms by their translated names, in the languages each of them chooses, and keep every search traceable.

**Architecture:** Translation files lie in the folders ontologies are looked for in. When an ontology is loaded, the files whose name carries its id prefix are merged onto its terms by the vendored loader; the translated names go into the one shared lexical index and into a separate exact-match index. A request names the languages to search; English is always included. The filter is applied at query time, before the best name per term is chosen, so the index identity does not depend on it. An uploaded file is validated by rebuilding the affected ontologies in memory first; only then is it stored and the new services are swapped in. The selection of each annotator is stored in the workspace preferences and sent with every search.

**Tech Stack:** Python 3 / FastAPI / Pydantic v2, scikit-learn (TF-IDF), pytest, ruff, mypy; React 18 + TypeScript, Vite 5, Vitest + Testing Library, Playwright; OpenAPI contract in `contracts/openapi.json` with generated types in `frontend/src/api/generated.ts`.

**Spec:** `docs/superpowers/specs/2026-10-07-term-search-design.md`, section 3 ("Übersetzungen"), the translation lines of section 5, and the mentions of translations in section 2. Part 1 (`docs/superpowers/plans/2026-10-07-term-search-1-one-search.md`) is implemented on this branch; Part 3 (tree) gets its own plan.

**Conventions used below**

- All `npm`/`npx` commands run in `frontend/`. All `uv`/`git` commands run in the repo root.
- The branch `feat/term-search` already exists. Work on it.
- Commit messages follow the repo style (`feat(search): …`, `feat(frontend): …`, `test: …`, `build: …`). Do **not** add any `Co-Authored-By` or "Generated with" lines.
- Before every commit that touches Python files, run `uv run ruff format <those files>`. The code below was formatted with the repo's ruff and is expected to come out unchanged.
- Code blocks are exact file text, indentation included. "Replace A with B" means: A occurs exactly once in that file; if you cannot find it, stop and report instead of guessing. Some files in a Windows working tree have CRLF line endings; that does not matter for matching.
- The steps check formatting with `uv run ruff format --check src tests scripts`. Over the whole repo, `ruff format --check .` also reports `docs/work-package-v2.md`; that file fails before this plan and is left alone.
- Do not edit files under `src/ontotator/vendor/`. That rule from Part 1 holds here without exception: `load_translations` is called as it is, the exact-match index of the translated names and the language filter of the lexical index live in `src/ontotator/ontology/translations.py`.
- Language codes are two lower-case letters. `OntologyService.languages` lists the loaded **translation** languages and never contains `"en"`; the `languages` of a search result and of a search event list what was searched and start with `"en"`.
- From Task 4 to Task 9 `uv run python scripts/export_openapi.py --check` reports drift. Task 9 regenerates the contract.
- Test ontology `tests/fixtures/hp.json` holds: `HP:0001250` Seizure (synonyms Seizures, Epileptic seizure, Convulsion), `HP:0002133` Status epilepticus (Prolonged seizures), `HP:0011146` Dialeptic seizure (Absence seizure), `HP:0001252` Hypotonia (Low muscle tone, Muscle hypotonia, Hypotonic), `HP:0001284` Areflexia (Absent reflexes), `HP:0000365` Hearing impairment (Hearing loss, Hipoacusia, Deafness), `HP:0000407` Sensorineural hearing impairment (Sensorineural hearing loss), the obsolete `HP:0000123`, and the three upper terms `HP:0000001` All, `HP:0000118`, `HP:0000707`. Its dominant prefix is `HP`, its release `2026-06-23`. `tests/fixtures/mondo.json` has the prefix `MONDO`.
- Measured on those fixtures while this plan was written (n-gram scores, rounded): query `Krampfanfall` → `HP:0001250` via the German name at 1.0, nothing via English names of that term; `Krampfanfälle` → the same term at 0.77; `Muskelhypotonie` with German switched off → `HP:0001252` via the English label `Hypotonia` at a score between 0 and 1.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `tests/fixtures/hp-de.babelon.tsv`, `tests/fixtures/hp-es.babelon.tsv` | create | Two small babelon files matching `hp.json` |
| `src/ontotator/ontology/translations.py` | create | File names, discovery, applying files to an ontology, exact index of translated names, lexical index with a language filter |
| `src/ontotator/ontology/service.py` | modify | Build with translations, identity, rebuild, active languages, seed, both search blocks |
| `src/ontotator/ontology/provenance.py` | modify | `languages` on the search request and the search result |
| `src/ontotator/packages/models.py` | modify | `languages` on `SearchEventRecord` |
| `src/ontotator/ontology/registry.py` | modify | Knows the folders, passes the files, rebuilds and publishes services |
| `src/ontotator/config.py`, `src/ontotator/api/app.py`, `src/ontotator/cli.py` | modify | The folders at start; notices for stray files |
| `src/ontotator/application/uploads.py` | modify | `TranslationUploadService` |
| `src/ontotator/api/routes.py` | modify | `translations` in `GET /ontologies`, `.tsv` in `POST /ontologies`, languages in the search event |
| `src/ontotator/application/preferences.py` | modify | `search_languages_by_annotator` |
| `tests/test_translation_files.py`, `tests/test_search_translations.py`, `tests/test_translation_registry.py`, `tests/test_translation_api.py` | create | Backend tests |
| `tests/test_preferences_api.py`, `tests/test_distribution.py`, `tests/test_bundle_preload.py`, `tests/test_followup_findings.py` | modify | Backend tests |
| `contracts/openapi.json`, `frontend/src/api/generated.ts` | regenerate | API contract and types |
| `frontend/src/api/client.ts`, `frontend/src/App.tsx` | modify | Dashboard display, upload of `.tsv` |
| `frontend/src/vite-env.d.ts`, `frontend/src/editor/flags/*` | create | Bundled flag images |
| `frontend/src/editor/searchLanguages.ts`, `frontend/src/editor/SearchLanguageButton.tsx` | create | Selection logic and hook; the button and its list |
| `frontend/src/editor/searchState.ts`, `SearchPanel.tsx`, `AnnotationPanel.tsx`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/styles.css` | modify | The button in the search box, `languages` in the request |
| `frontend/tests/searchLanguages.test.tsx` | create | Frontend tests |
| `frontend/tests/searchState.test.ts`, `searchPanel.test.tsx`, `caseScreen.test.tsx`, `dashboard.test.tsx`, `ontologyUpload.test.tsx` | modify | Frontend tests |
| `scripts/build_common.py`, `scripts/build_standalone.py`, `scripts/provision_bundle.py`, `README.md` | modify | `--translation TSV` |
| `frontend/browser/translations.spec.ts` | create | Browser test |
| `src/ontotator/web/` | regenerate | Embedded SPA build (git-tracked) |

---

### Task 0: Commit the plan, baseline

**Files:**
- Add: `docs/superpowers/plans/2026-10-08-term-search-2-translations.md`

- [ ] **Step 1: Confirm the branch**

Run: `git branch --show-current`
Expected: `feat/term-search`

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-10-08-term-search-2-translations.md
git commit -m "docs: plan for translations in the term search"
```

- [ ] **Step 3: Baseline**

Run (repo root): `uv sync && uv run pytest -q`
Run (in `frontend/`): `npm ci && npm run typecheck && npm test`
Expected: everything passes (when this plan was written: 394 pytest tests, 236 Vitest tests). If something fails before any change, stop and report it.

---

### Task 1: Translation files — fixtures, names, discovery, applying them to an ontology

**Files:**
- Create: `tests/fixtures/hp-de.babelon.tsv`, `tests/fixtures/hp-es.babelon.tsv`
- Create: `src/ontotator/ontology/translations.py`
- Test: `tests/test_translation_files.py` (create)

- [ ] **Step 1: Create the two fixture files**

The files are tab-separated and contain umlauts and accents; write them with a script so no editor turns a tab into spaces. Save this as `make_fixtures.py` in a temporary directory **outside** the repo:

```python
"""Writes the two translation fixtures. Run once from the repo root; do not commit."""

from pathlib import Path

# "|" stands for the tab that separates the columns.
GERMAN = """\
subject_id|predicate_id|source_language|source_value|translation_language|translation_value|translation_status
HP:0001250|rdfs:label|en|Seizure|de|Krampfanfall|OFFICIAL
HP:0001250|IAO:0000115|en|A seizure is an intermittent abnormality.|de|Ein Krampfanfall ist eine vorübergehende Störung.|OFFICIAL
HP:0001252|rdfs:label|en|Hypotonia|de|Muskelhypotonie|OFFICIAL
HP:0000365|rdfs:label|en|Hearing impairment|de|Schwerhörigkeit|OFFICIAL
HP:0000407|rdfs:label|en|Sensorineural hearing impairment|de|Schallempfindungsschwerhörigkeit|CANDIDATE
HP:0001284|rdfs:label|en|Areflexia|de|Areflexia|NOT_TRANSLATED
HP:0000123|rdfs:label|en|Obsolete example term|de|Veralteter Beispielbegriff|OFFICIAL
HP:9999999|rdfs:label|en|Unknown term|de|Unbekannter Begriff|OFFICIAL
"""

# Another column order on purpose: the official files differ in it too.
SPANISH = """\
source_language|source_value|subject_id|predicate_id|translation_language|translation_value|translation_status
en|Seizure|HP:0001250|rdfs:label|es|Crisis epiléptica|OFFICIAL
en|Hypotonia|HP:0001252|rdfs:label|es|Hipotonía|OFFICIAL
en|Areflexia|HP:0001284|rdfs:label|es|Arreflexia|OFFICIAL
en|Hearing impairment|HP:0000365|rdfs:label|es|Hipoacusia|OFFICIAL
"""

fixtures = Path("tests/fixtures")
for name, rows in (("hp-de.babelon.tsv", GERMAN), ("hp-es.babelon.tsv", SPANISH)):
    (fixtures / name).write_bytes(rows.replace("|", "\t").encode("utf-8"))
    print(name, len(rows.splitlines()) - 1, "rows")
```

Run (repo root): `uv run python <path-to>/make_fixtures.py`
Expected:

```text
hp-de.babelon.tsv 8 rows
hp-es.babelon.tsv 4 rows
```

Then check the bytes (repo root):

```bash
uv run python -c "import hashlib, pathlib; [print(hashlib.sha256(p.read_bytes()).hexdigest(), p.name) for p in sorted(pathlib.Path('tests/fixtures').glob('hp-*.tsv'))]"
```

Expected:

```text
aa8f4e933a4fa12078b83e039d2d3aff273706b550e416f584228a034d7aeb12 hp-de.babelon.tsv
3f3af8643b35997d4d8be01fbb9615652e0aa30350f2baca06e5b49caba9cc7e hp-es.babelon.tsv
```

Delete `make_fixtures.py`. What the rows are for:

| File | Row | Purpose |
|---|---|---|
| de | `HP:0001250` label `Krampfanfall` | a German name with no English look-alike |
| de | `HP:0001250` `IAO:0000115` | a definition: the loader skips it |
| de | `HP:0001252` `Muskelhypotonie` | shares n-grams with the English `Hypotonia` (language-filter test) |
| de | `HP:0000365` `Schwerhörigkeit`, `HP:0000407` `Schallempfindungsschwerhörigkeit` | umlauts (accent-blind exact match) |
| de | `HP:0001284` `Areflexia` | equals the English label: skipped |
| de | `HP:0000123` | obsolete term: skipped |
| de | `HP:9999999` | unknown term: skipped |
| es | `Crisis epiléptica`, `Hipotonía`, `Arreflexia` | three Spanish names; `subject_id` is the third column |
| es | `HP:0000365` `Hipoacusia` | equals an English synonym of that term: skipped |

So German names 4 terms and Spanish names 3 terms.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_translation_files.py`:

```python
"""Translation files: their names, where they are found, what the loader keeps."""

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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/test_translation_files.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'ontotator.ontology.translations'`.

- [ ] **Step 4: Implement the module**

Create `src/ontotator/ontology/translations.py`:

```python
"""Translated term names: the files they come from and how they are searched.

The files are the official babelon TSVs (``hp-de.babelon.tsv``,
``hp-de.synonyms.tsv``). The vendored loader reads them unchanged. What decides
which file belongs to which ontology, and how the translated names are searched,
lives here, outside the vendored code.
"""

from __future__ import annotations

import csv
import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from ontotator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    OntologyError,
    load_translations,
)

# <prefix>-<language>.<anything>.tsv, e.g. hp-de.babelon.tsv. The prefix is the
# ontology's dominant id prefix in lower case, the language has two letters.
_TRANSLATION_NAME = re.compile(
    r"^(?P<prefix>[a-z][a-z0-9]*)-(?P<language>[a-z]{2})\.(?:[a-z0-9_-]+\.)*tsv$"
)


def parse_translation_name(name: str) -> tuple[str, str] | None:
    """``(prefix, language)`` of a translation file name, or None if it is none."""
    match = _TRANSLATION_NAME.match(name.lower())
    if match is None:
        return None
    return match.group("prefix"), match.group("language")


def discover_translation_files(search_dirs: Iterable[Path]) -> list[Path]:
    """Translation files in the ontology folders, sorted by name.

    A name found in two folders is taken from the first one, so a file in the
    workspace replaces the one shipped next to the executable.
    """
    found: dict[str, Path] = {}
    for directory in search_dirs:
        if not directory.is_dir():
            continue
        # Not a glob: "*.tsv" would miss "HP-DE.BABELON.TSV" on Linux.
        for candidate in directory.iterdir():
            key = candidate.name.lower()
            if key not in found and parse_translation_name(key) and candidate.is_file():
                found[key] = candidate
    return [found[key] for key in sorted(found)]


def babelon_problem(path: Path) -> str | None:
    """Why a file cannot be a babelon TSV, or None if its header is fine."""
    try:
        with path.open(encoding="utf-8", newline="") as handle:
            header = next(csv.reader(handle, delimiter="\t"), None)
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        return f"{path.name} cannot be read as a tab-separated text file: {exc}"
    if not header or "subject_id" not in header:
        return f"{path.name} has no subject_id column. This is not a babelon TSV."
    return None


@dataclass(frozen=True)
class LoadedTranslation:
    """One translation file whose names are part of an ontology's index."""

    filename: str
    sha256: str
    languages: tuple[str, ...]


@dataclass(frozen=True)
class SkippedTranslation:
    """A translation file for this ontology that contributed nothing."""

    filename: str
    reason: str


def apply_translations(
    ontology: Ontology, paths: Iterable[Path]
) -> tuple[list[LoadedTranslation], list[SkippedTranslation]]:
    """Merge the files that belong to this ontology onto its terms.

    A file belongs to the ontology when the prefix in its name is the
    ontology's dominant id prefix. Other files are not this ontology's business
    and are ignored without a word. A file that belongs here but cannot be used
    is reported, never raised: a broken translation must not cost the ontology.
    """
    prefix = (ontology.dominant_prefix or "").lower()
    loaded: list[LoadedTranslation] = []
    skipped: list[SkippedTranslation] = []
    for path in sorted(paths, key=lambda p: p.name.lower()):
        parsed = parse_translation_name(path.name)
        if parsed is None or not prefix or parsed[0] != prefix:
            continue
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            counts = load_translations(ontology, [path])
        except (OntologyError, OSError, UnicodeDecodeError, csv.Error) as exc:
            skipped.append(SkippedTranslation(path.name, str(exc)))
            continue
        if not counts:
            skipped.append(
                SkippedTranslation(
                    path.name,
                    f"{path.name} holds no name for a term of this ontology.",
                )
            )
            continue
        loaded.append(LoadedTranslation(path.name, digest, tuple(sorted(counts))))
    return loaded, skipped


def translation_counts(ontology: Ontology) -> dict[str, int]:
    """Language -> number of live terms with at least one name in it."""
    counts: dict[str, int] = {}
    for term in ontology.live_terms():
        for language, names in term.translations.items():
            if names:
                counts[language] = counts.get(language, 0) + 1
    return dict(sorted(counts.items()))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_translation_files.py -v`
Expected: 16 passed.

- [ ] **Step 6: Lint and types**

Run: `uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: no findings. (`ruff format --check .` over the whole repo also reports `docs/work-package-v2.md`; that file fails before this plan and is not touched.)

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/hp-de.babelon.tsv tests/fixtures/hp-es.babelon.tsv src/ontotator/ontology/translations.py tests/test_translation_files.py
git commit -m "feat(search): find translation files and apply them to their ontology"
```

---

### Task 2: Service — index the translated names, identity, rebuild

**Files:**
- Modify: `src/ontotator/ontology/service.py` (imports, `__init__`, `load`, new `_build` and `with_translations`)
- Test: `tests/test_search_translations.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_search_translations.py`:

```python
"""Translated term names in the search: loading, matches, languages."""

import hashlib
import logging
from pathlib import Path

import pytest

from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import OntologyRef
from ontotator.domain.workspace import WorkspaceKey
from ontotator.ontology.provenance import SearchRequest, SearchResult
from ontotator.ontology.service import OntologyService

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"


def _key(annotator_id: str = "dr-meier") -> WorkspaceKey:
    return WorkspaceKey(
        package_id="pkg-1",
        document_id="doc-1",
        annotator_id=annotator_id,
        mode="independent",
        target_set_id="targets-1",
    )


def _service(*translations: Path, ontology: Path = HP) -> OntologyService:
    digest = hashlib.sha256(ontology.read_bytes()).hexdigest()
    return OntologyService.load(
        ontology,
        OntologyRef(release="2026-06-23", sha256=digest),
        translation_paths=translations,
    )


def _search(service: OntologyService, query: str, **overrides: object) -> SearchResult:
    fields: dict[str, object] = {
        "workspace_key": _key(),
        "annotation_id": "ann-1",
        "query": query,
    }
    fields.update(overrides)
    return service.search(SearchRequest.model_validate(fields))


def _plain_identity(ontology: Path) -> str:
    """The identity an index of this file had before translations existed."""
    return canonical_hash(
        {
            "ontology_sha256": hashlib.sha256(ontology.read_bytes()).hexdigest(),
            "algorithm": "char_wb_tfidf/1",
            "ngram_range": [3, 5],
            "id_normalization": "dominant_prefix_int_v1",
        }
    )


# --- loading ---------------------------------------------------------------- #


def test_service_knows_its_languages_files_and_counts() -> None:
    plain = _service()
    assert (plain.languages, plain.translations, plain.translation_counts) == (
        [],
        [],
        {},
    )

    both = _service(ES, DE)
    assert both.languages == ["de", "es"]
    assert both.translation_counts == {"de": 4, "es": 3}
    assert [item.filename for item in both.translations] == [
        "hp-de.babelon.tsv",
        "hp-es.babelon.tsv",
    ]
    assert both.skipped_translations == []

    # Files of another ontology are not this one's.
    mondo = _service(DE, ES, ontology=MONDO)
    assert (mondo.languages, mondo.translations, mondo.skipped_translations) == (
        [],
        [],
        [],
    )


def test_unusable_files_are_logged_and_do_not_stop_the_load(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    no_header = tmp_path / "hp-fr.babelon.tsv"
    no_header.write_text("term\tname\nHP:0001250\tCrise\n", encoding="utf-8")
    no_rows = tmp_path / "hp-nl.babelon.tsv"
    no_rows.write_text(
        "subject_id\tpredicate_id\ttranslation_value\n"
        "HP:9999999\trdfs:label\tOnbekend\n",
        encoding="utf-8",
    )

    with caplog.at_level(logging.WARNING, logger="ontotator.ontology.service"):
        service = _service(no_header, DE, no_rows)

    assert service.languages == ["de"]
    assert [item.filename for item in service.translations] == ["hp-de.babelon.tsv"]
    assert {item.filename for item in service.skipped_translations} == {
        "hp-fr.babelon.tsv",
        "hp-nl.babelon.tsv",
    }
    assert "Skipping translation file hp-fr.babelon.tsv" in caplog.text
    assert "Skipping translation file hp-nl.babelon.tsv" in caplog.text
    assert "HP:0001250" in _search(service, "Krampfanfall").displayed_ids


def test_identity_changes_with_and_only_with_the_translation_files(
    tmp_path: Path,
) -> None:
    plain = _service()
    german = _service(DE)
    both = _service(DE, ES)

    # Without translations the identity is the one it always was.
    assert plain.index_identity == _plain_identity(HP)
    # Files of another ontology leave the identity alone.
    assert _service(DE, ES, ontology=MONDO).index_identity == _plain_identity(MONDO)
    # A file that contributes nothing is not part of the index.
    useless = tmp_path / "hp-nl.babelon.tsv"
    useless.write_text("subject_id\ttranslation_value\nHP:9\tx\n", encoding="utf-8")
    assert _service(useless).index_identity == _plain_identity(HP)

    assert len({plain.index_identity, german.index_identity, both.index_identity}) == 3
    # The order the files are given in does not matter.
    assert _service(ES, DE).index_identity == both.index_identity

    # Same name, other content: another index.
    changed = tmp_path / "hp-de.babelon.tsv"
    changed.write_bytes(
        DE.read_bytes() + b"HP:0001284\trdfs:label\ten\tAreflexia\tde\tAreflexie\tOK\n"
    )
    assert _service(changed).index_identity != german.index_identity


# --- similar matches -------------------------------------------------------- #


def test_similar_match_on_a_german_name_reports_its_language() -> None:
    result = _search(_service(DE, ES), "Krampfanfälle")

    hit = next(c for c in result.candidates if c.term_id == "HP:0001250")
    assert (hit.route, hit.match_kind, hit.match_language) == ("lexical", "ngram", "de")
    assert hit.matched_term == "Krampfanfall"
    assert hit.label == "Seizure"
    assert hit.score is not None and hit.score > 0.5
    assert result.shuffled is True

    spanish = _search(_service(DE, ES), "crisis epileptica")
    hit = next(c for c in spanish.candidates if c.term_id == "HP:0001250")
    assert (hit.match_language, hit.matched_term) == ("es", "Crisis epiléptica")


def test_without_translation_files_german_names_find_nothing() -> None:
    plain = _service()

    assert all(
        c.match_language in (None, "en")
        for query in ("Muskelhypotonie", "Krampfanfall", "Schwerhörigkeit")
        for c in _search(plain, query).candidates
    )
    assert "HP:0001250" not in _search(plain, "Krampfanfall").displayed_ids


# --- reloading -------------------------------------------------------------- #


def test_with_translations_builds_a_new_service_and_leaves_the_old_one() -> None:
    german = _service(DE)

    both = german.with_translations([DE, ES])
    assert both is not german
    assert both.languages == ["de", "es"]
    assert both.ref == german.ref
    assert both.index_identity == _service(DE, ES).index_identity
    hit = next(
        c for c in _search(both, "Hipotonía").candidates if c.term_id == "HP:0001252"
    )
    assert hit.match_language == "es"

    # The old service is untouched.
    assert german.languages == ["de"]
    assert german.ontology.terms["HP:0001252"].translations == {
        "de": ["Muskelhypotonie"]
    }
    assert german.index_identity == _service(DE).index_identity

    # A file that is no longer given leaves nothing behind.
    spanish = both.with_translations([ES])
    assert spanish.languages == ["es"]
    assert spanish.ontology.terms["HP:0001252"].translations == {"es": ["Hipotonía"]}
    assert "HP:0001250" not in _search(spanish, "Krampfanfall").displayed_ids
    assert spanish.with_translations([]).index_identity == _plain_identity(HP)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_search_translations.py -v`
Expected: 5 failed, 1 passed. `OntologyService` has no `languages` and no `with_translations` (`AttributeError`); a file without `subject_id` still aborts the whole load (`OntologyError`); the three identities are equal; the German query does not find `HP:0001250` (`StopIteration`), because the index is built without the translated names. `test_without_translation_files_german_names_find_nothing` passes already: it pins what must not change.

- [ ] **Step 3: Imports**

In `src/ontotator/ontology/service.py`, replace

```python
import hashlib
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Literal
```

with

```python
import dataclasses
import hashlib
import logging
import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any, Literal
```

In the same file, replace

```python
from ontotator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    load_translations,
)
from ontotator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
```

with

```python
from ontotator.ontology.translations import (
    LoadedTranslation,
    SkippedTranslation,
    apply_translations,
    translation_counts,
)
from ontotator.vendor.hpo_span_annotator.hpo import Ontology
from ontotator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
```

Replace

```python
# Digits alone, PREFIX:digits or PREFIX_digits. Anything else is a keyword.
```

with

```python
logger = logging.getLogger(__name__)

# Digits alone, PREFIX:digits or PREFIX_digits. Anything else is a keyword.
```

- [ ] **Step 4: Let the service know its translations and put them into the identity**

In `src/ontotator/ontology/service.py`, in `OntologyService.__init__`, replace

```python
        ref: OntologyRef,
    ) -> None:
        self.ontology = ontology
        self.engine = engine
        self.ref = ref
        self.index_identity = canonical_hash(
            {
                "ontology_sha256": ref.sha256,
                "algorithm": "char_wb_tfidf/1",
                "ngram_range": [3, 5],
                "id_normalization": "dominant_prefix_int_v1",
            }
        )
```

with

```python
        ref: OntologyRef,
        translations: Sequence[LoadedTranslation] = (),
        skipped_translations: Sequence[SkippedTranslation] = (),
    ) -> None:
        self.ontology = ontology
        self.engine = engine
        self.ref = ref
        # The translation files whose names are in the index, and the files
        # that belong to this ontology but could not be used.
        self.translations = list(translations)
        self.skipped_translations = list(skipped_translations)
        # Language -> number of terms with a name in it. English is not listed:
        # it is the ontology itself and always searched.
        self.translation_counts = translation_counts(ontology)
        self.languages = list(self.translation_counts)
        identity: dict[str, Any] = {
            "ontology_sha256": ref.sha256,
            "algorithm": "char_wb_tfidf/1",
            "ngram_range": [3, 5],
            "id_normalization": "dominant_prefix_int_v1",
        }
        # Added only when there are translations, so an ontology without them
        # keeps the identity it always had.
        if self.translations:
            identity["translation_sha256"] = sorted(
                item.sha256 for item in self.translations
            )
        self.index_identity = canonical_hash(identity)
```

- [ ] **Step 5: Build the index with the translations; add the rebuild**

In `OntologyService.load`, replace the end of the method

```python
        ontology = load_ontology(path)
        if translation_paths:
            load_translations(ontology, [Path(p) for p in translation_paths])

        lexical = LexicalIndex(ontology)
        lexical.build()
        engine = SearchEngine(ontology=ontology, lexical=lexical)
        return cls(ontology=ontology, engine=engine, ref=expected)
```

with (the rest of `load` stays; `_build` and `with_translations` are new methods of the class)

```python
        return cls._build(load_ontology(path), expected, translation_paths)

    @classmethod
    def _build(
        cls,
        ontology: Ontology,
        ref: OntologyRef,
        translation_paths: Iterable[Path | str],
    ) -> OntologyService:
        """Index a parsed ontology together with its translation files.

        ``translation_paths`` may hold files of other ontologies; only those
        whose name carries this ontology's prefix are used.
        """
        loaded, skipped = apply_translations(
            ontology, [Path(p) for p in translation_paths]
        )
        for problem in skipped:
            logger.warning(
                "Skipping translation file %s: %s", problem.filename, problem.reason
            )
        languages = sorted({code for item in loaded for code in item.languages})
        lexical = LexicalIndex(ontology, languages=languages)
        lexical.build()
        engine = SearchEngine(ontology=ontology, lexical=lexical)
        return cls(
            ontology=ontology,
            engine=engine,
            ref=ref,
            translations=loaded,
            skipped_translations=skipped,
        )

    def with_translations(
        self, translation_paths: Iterable[Path | str]
    ) -> OntologyService:
        """A new service over the same terms with exactly these translation files.

        The terms are copied without their translated names, so a file that was
        replaced or removed leaves nothing behind. This service is not touched
        and keeps answering until the caller swaps the new one in.
        """
        terms = {
            term_id: dataclasses.replace(term, translations={})
            for term_id, term in self.ontology.terms.items()
        }
        ontology = Ontology(
            terms,
            self.ontology.release,
            dominant_prefix=self.ontology.dominant_prefix,
        )
        return self._build(ontology, self.ref, translation_paths)
```

Why `with_translations` copies the terms instead of parsing the file again: the vendored `load_translations` writes into `Term.translations` in place, and an ontology that a package brought along has no file to parse again. Copying each `Term` with an empty `translations` dict works for every ontology, wherever it came from.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_search_translations.py tests/test_search_auto.py -v`
Expected: all pass (6 new).

- [ ] **Step 7: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/ontotator/ontology/service.py tests/test_search_translations.py
git commit -m "feat(search): index translated names and include their files in the index identity"
```

---

### Task 3: Service — exact matches on translated names

**Files:**
- Modify: `src/ontotator/ontology/translations.py` (new class `TranslatedNames`)
- Modify: `src/ontotator/ontology/service.py` (`__init__`, `_auto_hits`)
- Test: `tests/test_search_translations.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_search_translations.py`:

```python
# --- exact matches ---------------------------------------------------------- #


def test_exact_match_on_a_german_name_reports_its_language() -> None:
    result = _search(_service(DE, ES), "Muskelhypotonie")

    first = result.candidates[0]
    assert (first.term_id, first.route, first.match_kind, first.match_language) == (
        "HP:0001252",
        "exact",
        "translation",
        "de",
    )
    assert first.matched_term == "Muskelhypotonie"
    assert first.label == "Hypotonia"
    assert (first.rank, first.display_pos, first.score) == (1, 1, None)
    assert result.displayed_ids[0] == result.ranked_ids[0] == "HP:0001252"
    # The exact hit is not repeated in the similar block.
    assert result.displayed_ids.count("HP:0001252") == 1


def test_exact_match_on_a_translated_name_ignores_case_and_accents() -> None:
    service = _service(DE, ES)

    german = _search(service, "schwerhorigkeit").candidates[0]
    assert (german.term_id, german.route, german.match_language) == (
        "HP:0000365",
        "exact",
        "de",
    )
    assert german.matched_term == "Schwerhörigkeit"

    spanish = _search(service, "HIPOTONIA").candidates[0]
    assert (spanish.term_id, spanish.route, spanish.match_language) == (
        "HP:0001252",
        "exact",
        "es",
    )
    assert spanish.matched_term == "Hipotonía"


def test_english_exact_matches_come_before_translated_ones(tmp_path: Path) -> None:
    # "Seizure" is the label of HP:0001250. Here it is also a German name of two
    # other terms, and a Spanish name of a third.
    german = tmp_path / "hp-de.babelon.tsv"
    german.write_text(
        "subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        "HP:0001284\trdfs:label\tde\tSeizure\n"
        "HP:0001252\trdfs:label\tde\tSeizure\n",
        encoding="utf-8",
    )
    spanish = tmp_path / "hp-es.babelon.tsv"
    spanish.write_text(
        "subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        "HP:0000365\trdfs:label\tes\tSeizure\n"
        "HP:0001252\trdfs:label\tes\tSeizure\n",
        encoding="utf-8",
    )
    service = _service(spanish, german)
    result = _search(service, "seizure")

    exact = [c for c in result.candidates if c.route == "exact"]
    # English first; then by language code and term id; each term once.
    assert [(c.term_id, c.match_kind, c.match_language) for c in exact] == [
        ("HP:0001250", "label", None),
        ("HP:0001252", "translation", "de"),
        ("HP:0001284", "translation", "de"),
        ("HP:0000365", "translation", "es"),
    ]
    assert [c.rank for c in exact] == [1, 2, 3, 4]
    assert [c.display_pos for c in exact] == [1, 2, 3, 4]
    assert result.displayed_ids[:4] == [c.term_id for c in exact]
    assert len(result.displayed_ids) == len(set(result.displayed_ids))
    assert {c.route for c in result.candidates[4:]} <= {"lexical"}

    # Exact matches take precedence within k, English first.
    two = _search(service, "seizure", k=2)
    assert two.displayed_ids == ["HP:0001250", "HP:0001252"]
    assert two.shuffled is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_search_translations.py -v`
Expected: 3 failed, 6 passed. The first candidate for `Muskelhypotonie` comes from the similar block (`route` is `lexical`, `match_kind` is `ngram`), and `seizure` has only its one English exact match.

- [ ] **Step 3: Add the exact-match index of the translated names**

The vendored `Ontology._exact` holds labels and synonyms only, and vendored files are not edited. The translated names get their own index with the same normalisation.

In `src/ontotator/ontology/translations.py`, replace

```python
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from ontotator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    OntologyError,
    load_translations,
)
```

with

```python
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ontotator.vendor.hpo_span_annotator.hpo import (
    Ontology,
    OntologyError,
    load_translations,
    normalise,
)
```

Append to the same file:

```python
class TranslatedNames:
    """Exact-match index of the translated names.

    The ontology's own index holds labels and synonyms only. This is the same
    lookup (same normalisation) for the names the babelon files added.
    """

    def __init__(self, ontology: Ontology) -> None:
        self.ontology = ontology
        # Normalised name -> [(language, term id, the name as written)].
        self._names: dict[str, list[tuple[str, str, str]]] = {}
        for term in ontology.live_terms():
            for language, names in term.translations.items():
                for name in names:
                    self._names.setdefault(normalise(name), []).append(
                        (language, term.hpo_id, name)
                    )

    def exact(self, query: str, languages: Collection[str]) -> list[dict[str, Any]]:
        """Terms with a name in one of ``languages`` that equals the query.

        Ordered by language code, then term id: a fixed order that says nothing
        about relevance. Each term appears once.
        """
        hits = sorted(
            hit for hit in self._names.get(normalise(query), []) if hit[0] in languages
        )
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for language, hpo_id, name in hits:
            if hpo_id in seen:
                continue
            seen.add(hpo_id)
            out.append(
                {
                    **self.ontology.terms[hpo_id].as_dict(),
                    "matched_term": name,
                    "match_kind": "translation",
                    "matched_language": language,
                }
            )
        return out
```

- [ ] **Step 4: Use it in the exact block of the single search**

In `src/ontotator/ontology/service.py`, replace

```python
from ontotator.ontology.translations import (
    LoadedTranslation,
    SkippedTranslation,
    apply_translations,
    translation_counts,
)
```

with

```python
from ontotator.ontology.translations import (
    LoadedTranslation,
    SkippedTranslation,
    TranslatedNames,
    apply_translations,
    translation_counts,
)
```

In `OntologyService.__init__`, directly after

```python
        self.languages = list(self.translation_counts)
```

add

```python
        self._translated = TranslatedNames(ontology)
```

In `_auto_hits`, replace

```python
        exact = self.ontology.exact(query, limit=request.k)
        for position, hit in enumerate(exact, start=1):
```

with

```python
        exact = self.ontology.exact(query, limit=request.k)
        taken = {hit["hpo_id"] for hit in exact}
        # Then the translated names of the active languages. A term that an
        # English name already matched is not listed twice.
        for hit in self._translated.exact(query, self.languages):
            if len(exact) >= request.k:
                break
            if hit["hpo_id"] not in taken:
                taken.add(hit["hpo_id"])
                exact.append(hit)
        for position, hit in enumerate(exact, start=1):
```

Further down in `_auto_hits`, `taken` is now defined above; replace

```python
        if remaining > 0 and lexical is not None and lexical.ready:
            taken = {hit["hpo_id"] for hit in exact}
            ranked = [
```

with

```python
        if remaining > 0 and lexical is not None and lexical.ready:
            ranked = [
```

`_candidate` needs no change: it already copies `matched_language` into `match_language`, and the hits of `TranslatedNames.exact` carry `match_kind = "translation"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_search_translations.py tests/test_search_auto.py -v`
Expected: all pass.

- [ ] **Step 6: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ontotator/ontology/translations.py src/ontotator/ontology/service.py tests/test_search_translations.py
git commit -m "feat(search): count exact matches on translated names"
```

---

### Task 4: Service — the language selection of a request

**Files:**
- Modify: `src/ontotator/ontology/provenance.py` (`SearchRequest.languages`, `SearchResult.languages`)
- Modify: `src/ontotator/packages/models.py` (`SearchEventRecord.languages`)
- Modify: `src/ontotator/ontology/translations.py` (new class `LanguageLexicalIndex`)
- Modify: `src/ontotator/ontology/service.py` (`_build`, `search`, `_route_hits`, `_auto_hits`; new `active_languages`, `_seed`, `_similar`)
- Test: `tests/test_search_translations.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_search_translations.py`, extend the imports. Replace

```python
import hashlib
import logging
from pathlib import Path
```

with

```python
import hashlib
import json
import logging
from pathlib import Path
```

and replace

```python
from ontotator.ontology.service import OntologyService
```

with

```python
from ontotator.ontology.service import OntologyService
from ontotator.packages.models import SearchEventRecord
```

Append to the file:

```python
# --- language selection ----------------------------------------------------- #


def test_request_and_result_carry_the_languages() -> None:
    assert (
        SearchRequest.model_validate(
            {"workspace_key": _key(), "annotation_id": "a", "query": "q"}
        ).languages
        is None
    )
    assert SearchResult(route="auto", query="q").languages == []

    plain = _service()
    assert _search(plain, "Muskelhypotonie").languages == ["en"]
    assert _search(plain, "Muskelhypotonie", languages=["de"]).languages == ["en"]
    assert _search(plain, "HP:0001250").languages == ["en"]


def test_missing_languages_field_means_all_loaded_languages() -> None:
    service = _service(DE, ES)

    assert _search(service, "Krampfanfall").languages == ["en", "de", "es"]
    assert _search(service, "Krampfanfall", languages=None).languages == [
        "en",
        "de",
        "es",
    ]
    assert _search(service, "Krampfanfall").candidates[0].match_language == "de"
    assert _search(service, "Hipotonía").candidates[0].match_language == "es"


def test_a_deselected_language_yields_no_match_through_its_names() -> None:
    service = _service(DE, ES)

    # Exact block: the German name does not count, the Spanish one still does.
    spanish_only = _search(service, "Krampfanfall", languages=["es"])
    assert spanish_only.languages == ["en", "es"]
    assert "HP:0001250" not in spanish_only.displayed_ids
    assert all(c.match_language != "de" for c in spanish_only.candidates)
    assert (
        _search(service, "Hipotonía", languages=["es"]).candidates[0].route == "exact"
    )

    # Similar block.
    english_only = _search(service, "Krampfanfälle", languages=[])
    assert english_only.languages == ["en"]
    assert "HP:0001250" not in english_only.displayed_ids
    assert all(c.match_language in (None, "en") for c in english_only.candidates)

    # Codes that are not loaded are ignored; case and spaces do not matter.
    odd = _search(service, "Krampfanfall", languages=[" DE ", "xx", "en"])
    assert odd.languages == ["en", "de"]
    assert odd.candidates[0].term_id == "HP:0001250"


def test_a_term_stays_findable_through_an_allowed_name() -> None:
    """The best name of Hypotonia for this query is German. With German off the
    term must still be listed, through an English name of its own. Filtering
    the finished list by the language of the best name would lose it."""
    service = _service(DE, ES)

    with_german = _search(service, "Muskelhypotonie")
    assert with_german.candidates[0].route == "exact"
    assert with_german.candidates[0].match_language == "de"

    without = _search(service, "Muskelhypotonie", languages=["es"])
    hit = next(c for c in without.candidates if c.term_id == "HP:0001252")
    assert (hit.route, hit.match_language) == ("lexical", "en")
    assert hit.matched_term == "Hypotonia"
    assert hit.score is not None and 0 < hit.score < 1

    # The same on the explicit lexical route.
    legacy = _search(service, "Muskelhypotonie", languages=[], route="lexical")
    hit = next(c for c in legacy.candidates if c.term_id == "HP:0001252")
    assert (hit.match_language, hit.matched_term) == ("en", "Hypotonia")
    assert legacy.shuffled is True
    assert {c.route for c in legacy.candidates} == {"lexical"}
    everything = _search(service, "Muskelhypotonie", route="lexical")
    hit = next(c for c in everything.candidates if c.term_id == "HP:0001252")
    assert (hit.match_language, hit.matched_term) == ("de", "Muskelhypotonie")


def test_english_stays_on_whatever_is_selected() -> None:
    service = _service(DE, ES)

    for languages in ([], ["de"], ["es"], ["de", "es"], None):
        result = _search(service, "Hypotonia", languages=languages)
        first = result.candidates[0]
        assert (first.term_id, first.route, first.match_kind) == (
            "HP:0001252",
            "exact",
            "label",
        )
        assert result.languages[0] == "en"

    similar = _search(service, "low muscle", languages=[])
    hit = next(c for c in similar.candidates if c.term_id == "HP:0001252")
    assert (hit.match_language, hit.matched_term) == ("en", "Low muscle tone")


def test_the_language_selection_is_part_of_the_shuffle_seed() -> None:
    service = _service(DE, ES)
    query = "hearing"

    seeds = {
        name: _search(service, query, languages=languages).seed
        for name, languages in {
            "none": [],
            "de": ["de"],
            "es": ["es"],
            "both": ["de", "es"],
            "all": None,
        }.items()
    }
    assert None not in seeds.values()
    assert seeds["both"] == seeds["all"]
    assert len({seeds["none"], seeds["de"], seeds["es"], seeds["both"]}) == 4
    # Order and spelling of the request do not make a new question.
    assert _search(service, query, languages=["ES", "de"]).seed == seeds["both"]
    # English only is the question the search asked before translations.
    assert _search(_service(), query).seed == seeds["none"]
    assert _search(_service(DE), query).seed == seeds["de"]
    # Still keyed by annotator.
    other = _search(service, query, workspace_key=_key("dr-other"), languages=["de"])
    assert other.seed != seeds["de"]
    # The explicit lexical route uses the same key.
    assert (
        _search(service, query, languages=["de"], route="lexical").seed == seeds["de"]
    )


def test_the_language_selection_is_not_part_of_the_index_identity() -> None:
    service = _service(DE, ES)

    assert {
        _search(service, "Krampfanfall", languages=languages).index_identity
        for languages in ([], ["de"], ["es"], None)
    } == {service.index_identity}


def test_search_event_keeps_languages_and_reads_old_events() -> None:
    old_payload = {
        "event_id": "evt-old",
        "workspace_key": _key().model_dump(),
        "annotation_id": "ann-1",
        "query": "hypotonia",
        "route": "auto",
        "candidates": ["HP:0001252"],
        "ontology_release": "2026-01-01",
        "index_identity": "idx",
        "timestamp": "2026-01-01T00:00:00+00:00",
    }
    old = SearchEventRecord.model_validate_json(json.dumps(old_payload))
    assert old.languages == []

    new = SearchEventRecord.model_validate({**old_payload, "languages": ["en", "de"]})
    again = SearchEventRecord.model_validate_json(new.model_dump_json())
    assert again.languages == ["en", "de"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_search_translations.py -v`
Expected: 8 failed, 9 passed. `SearchRequest` rejects `languages` (extra forbidden); `SearchResult` and `SearchEventRecord` have no `languages`.

- [ ] **Step 3: Models**

In `src/ontotator/ontology/provenance.py`, in `SearchRequest`, directly after

```python
    k: int = Field(default=10, ge=1, le=100)
```

add

```python
    # Translation languages to search besides English. None means every
    # language that is loaded; codes that are not loaded are ignored.
    languages: list[str] | None = Field(default=None, max_length=32)
```

In `SearchResult`, replace

```python
    index_identity: str | None = None


class HierarchyWarning
```

with

```python
    index_identity: str | None = None
    # The languages this search looked at, English first.
    languages: list[str] = Field(default_factory=list)


class HierarchyWarning
```

In `src/ontotator/packages/models.py`, in `SearchEventRecord`, directly after

```python
    candidate_routes: dict[str, str] = Field(default_factory=dict)
```

add

```python
    # The languages the search looked at, English first. Empty on events
    # written before translations existed.
    languages: list[str] = Field(default_factory=list)
```

`languages` on the request has the default `None` and the two lists use `default_factory`: all three come out **optional** in `generated.ts` (see Task 9), so no existing typed fixture has to change.

- [ ] **Step 4: A lexical index that can leave languages out**

`LexicalIndex.search` has no language parameter and vendored files are not edited, so the filter is a subclass in our own module. It must zero the rows of the other languages **before** the best name per term is chosen; the loop after that is the parent's, copied, because the parent offers no hook between scoring and ranking.

In `src/ontotator/ontology/translations.py`, replace

```python
    load_translations,
    normalise,
)
```

with

```python
    load_translations,
    normalise,
)
from ontotator.vendor.hpo_span_annotator.lexical import (
    LexicalIndex,
    LexicalIndexError,
)
```

Append to the same file:

```python
class LanguageLexicalIndex(LexicalIndex):
    """The lexical index, searchable in a chosen subset of its languages.

    One index holds every language. A search that names languages ignores the
    rows of all others *before* the best name per term is picked. Filtering the
    finished list instead would lose every term whose best-scoring name is in a
    language the annotator switched off, although an English name of the same
    term matches too.
    """

    def search(
        self,
        query: str,
        k: int,
        languages: Collection[str] | None = None,
    ) -> list[dict[str, Any]]:
        if languages is None:
            return super().search(query, k)
        if not self.ready:
            raise LexicalIndexError("the lexical index is not built")
        import numpy as np

        allowed = {"en", *languages}
        scores = (self._vectorizer.transform([query]) @ self._matrix.T).toarray()[0]
        keep = np.fromiter(
            (code in allowed for code in self._term_language),
            dtype=bool,
            count=len(self._term_language),
        )
        scores[~keep] = 0.0

        # From here on this is the parent's ranking: best name per term, top k.
        best: dict[str, tuple[float, str, str]] = {}
        for index in np.argsort(-scores)[: max(400, k * 40)]:
            score = float(scores[index])
            if score <= 0:
                break
            hpo_id = self._ids[index]
            if hpo_id not in best or score > best[hpo_id][0]:
                best[hpo_id] = (
                    score,
                    self._terms[index],
                    self._term_language[index],
                )
            if len(best) >= k * 4:
                break

        ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:k]
        out = []
        for hpo_id, (score, matched, language) in ranked:
            term = self.ontology.terms[hpo_id]
            out.append(
                {
                    **term.as_dict(),
                    "matched_term": matched,
                    "score": round(score, 4),
                    "matched_language": language,
                    "match_kind": "ngram" if language == "en" else f"ngram:{language}",
                }
            )
        return out
```

- [ ] **Step 5: Service: build that index, resolve the active languages, seed, both blocks**

In `src/ontotator/ontology/service.py`, replace

```python
from ontotator.ontology.translations import (
    LoadedTranslation,
    SkippedTranslation,
    TranslatedNames,
    apply_translations,
    translation_counts,
)
from ontotator.vendor.hpo_span_annotator.hpo import Ontology
from ontotator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
from ontotator.vendor.hpo_span_annotator.lexical import LexicalIndex
```

with

```python
from ontotator.ontology.translations import (
    LanguageLexicalIndex,
    LoadedTranslation,
    SkippedTranslation,
    TranslatedNames,
    apply_translations,
    translation_counts,
)
from ontotator.vendor.hpo_span_annotator.hpo import Ontology
from ontotator.vendor.hpo_span_annotator.hpo import (
    load as load_ontology,
)
```

In `_build`, replace

```python
        lexical = LexicalIndex(ontology, languages=languages)
```

with

```python
        lexical = LanguageLexicalIndex(ontology, languages=languages)
```

Directly after the last line of `with_translations`,

```python
        return self._build(ontology, self.ref, translation_paths)
```

add

```python

    def active_languages(self, requested: Sequence[str] | None) -> list[str]:
        """The loaded translation languages a search looks at.

        ``None`` means all of them. Codes that are not loaded are ignored.
        """
        if requested is None:
            return list(self.languages)
        wanted = {code.strip().lower() for code in requested}
        return [code for code in self.languages if code in wanted]
```

In `search`, replace

```python
        if request.route == "auto":
            hits, was_shuffled, seed = self._auto_hits(request)
        else:
            hits, was_shuffled, seed = self._route_hits(request)
```

with

```python
        languages = self.active_languages(request.languages)
        if request.route == "auto":
            hits, was_shuffled, seed = self._auto_hits(request, languages)
        else:
            hits, was_shuffled, seed = self._route_hits(request, languages)
```

Replace the end of `search` and the whole of `_route_hits` up to the signature of `_auto_hits`, i.e.

```python
            index_identity=self.index_identity,
        )

    def _route_hits(
        self, request: SearchRequest
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        """One explicitly named route, exactly as the engine answers it."""
        seed: str | None = None
        if request.route in SCORED_PATHS:
            seed = shuffle_seed(
                annotator_id=request.workspace_key.annotator_id,
                mention_id=request.annotation_id,
                query=request.query,
                k=request.k,
            )
        raw_result = self.engine.search(
            query=request.query,
            path=request.route,
            k=request.k,
            seed=seed,
        )
        hits: list[dict[str, Any]] = raw_result["hits"]
        for hit in hits:
            hit["route"] = request.route
        return hits, bool(raw_result.get("shuffled", False)), seed

    def _auto_hits(
        self, request: SearchRequest
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
```

with

```python
            index_identity=self.index_identity,
            languages=["en", *languages],
        )

    def _seed(self, request: SearchRequest, languages: Sequence[str]) -> str:
        """The permutation key: annotator, annotation, query, depth, languages.

        The same query with another language selection is a new question and
        may be shuffled anew. Without an active translation language the key is
        the one the search had before translations existed.
        """
        seed = shuffle_seed(
            annotator_id=request.workspace_key.annotator_id,
            mention_id=request.annotation_id,
            query=request.query,
            k=request.k,
        )
        if not languages:
            return seed
        raw = f"{seed}|{','.join(sorted(languages))}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def _similar(
        self, query: str, k: int, languages: Sequence[str]
    ) -> list[dict[str, Any]]:
        """Lexical hits by score, over English and the given languages only."""
        lexical = self.engine.lexical
        if lexical is None or not lexical.ready:
            return []
        if isinstance(lexical, LanguageLexicalIndex):
            return lexical.search(query, k, languages=languages)
        return lexical.search(query, k)

    def _route_hits(
        self, request: SearchRequest, languages: Sequence[str]
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        """One explicitly named route, as the engine answers it.

        The lexical route is answered here when the index can filter by
        language, so a language the annotator switched off stays off on this
        route too. The explicit exact route knows English names only.
        """
        seed: str | None = None
        if request.route in SCORED_PATHS:
            seed = self._seed(request, languages)
        query = request.query.strip()
        lexical = self.engine.lexical
        hits: list[dict[str, Any]]
        if (
            seed is not None
            and query
            and isinstance(lexical, LanguageLexicalIndex)
            and lexical.ready
        ):
            hits = shuffled(lexical.search(query, request.k, languages=languages), seed)
            was_shuffled = True
        else:
            raw_result = self.engine.search(
                query=request.query,
                path=request.route,
                k=request.k,
                seed=seed,
            )
            hits = raw_result["hits"]
            was_shuffled = bool(raw_result.get("shuffled", False))
        for hit in hits:
            hit["route"] = request.route
        return hits, was_shuffled, seed

    def _auto_hits(
        self, request: SearchRequest, languages: Sequence[str]
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
```

In `_auto_hits`, replace

```python
        for hit in self._translated.exact(query, self.languages):
```

with

```python
        for hit in self._translated.exact(query, languages):
```

and replace

```python
        seed = shuffle_seed(
            annotator_id=request.workspace_key.annotator_id,
            mention_id=request.annotation_id,
            query=request.query,
            k=request.k,
        )

        similar: list[dict[str, Any]] = []
        remaining = request.k - len(exact)
        lexical = self.engine.lexical
        if remaining > 0 and lexical is not None and lexical.ready:
            ranked = [
                hit
                for hit in lexical.search(query, request.k + len(exact))
                if hit["hpo_id"] not in taken
            ][:remaining]
```

with

```python
        seed = self._seed(request, languages)

        similar: list[dict[str, Any]] = []
        remaining = request.k - len(exact)
        if remaining > 0:
            ranked = [
                hit
                for hit in self._similar(query, request.k + len(exact), languages)
                if hit["hpo_id"] not in taken
            ][:remaining]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_search_translations.py tests/test_search_auto.py -v`
Expected: all pass.

- [ ] **Step 7: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass. `uv run python scripts/export_openapi.py --check` reports drift from now until Task 9 regenerates the contract; that is expected.

- [ ] **Step 8: Commit**

```bash
git add src/ontotator/ontology/provenance.py src/ontotator/packages/models.py src/ontotator/ontology/translations.py src/ontotator/ontology/service.py tests/test_search_translations.py
git commit -m "feat(search): search only the languages a request names, English always"
```

---

### Task 5: Registry — hand every ontology the translation files of its prefix

**Files:**
- Modify: `src/ontotator/ontology/registry.py`
- Modify: `tests/test_followup_findings.py` (a test stub that replaces `OntologyService.load`)
- Test: `tests/test_translation_registry.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_translation_registry.py`:

```python
"""The registry hands each ontology the translation files of its prefix."""

import hashlib
import shutil
from pathlib import Path

from layered_fixtures import make_layered_package

from ontotator.domain.profiles import OntologyDefinition
from ontotator.ontology.registry import OntologyRegistry

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"


def _folder(tmp_path: Path, *files: Path) -> Path:
    folder = tmp_path / "ontologies"
    folder.mkdir()
    for source in files:
        shutil.copyfile(source, folder / source.name)
    return folder


def test_registry_assigns_files_by_prefix(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE, ES)
    (folder / "mondo-es.babelon.tsv").write_text(
        "subject_id\tpredicate_id\ttranslation_value\n"
        "MONDO:0001250\trdfs:label\tatrofia muscular espinal\n",
        encoding="utf-8",
    )
    (folder / "xx-de.babelon.tsv").write_text(
        "subject_id\tpredicate_id\ttranslation_value\nXX:1\trdfs:label\tEtwas\n",
        encoding="utf-8",
    )
    registry = OntologyRegistry(translation_dirs=[folder])
    hp_sha = registry.register_path(HP)
    mondo_sha = registry.register_path(MONDO)
    assert registry.load_registered() == []

    hp = registry.get_service(hp_sha)
    mondo = registry.get_service(mondo_sha)
    assert hp is not None and mondo is not None
    assert hp.translation_counts == {"de": 4, "es": 3}
    assert [item.filename for item in hp.translations] == [
        "hp-de.babelon.tsv",
        "hp-es.babelon.tsv",
    ]
    assert mondo.translation_counts == {"es": 1}
    assert [item.filename for item in mondo.translations] == ["mondo-es.babelon.tsv"]

    assert [sha for sha, _ in registry.services_for_prefix("hp")] == [hp_sha]
    assert [sha for sha, _ in registry.services_for_prefix("mondo")] == [mondo_sha]
    assert registry.services_for_prefix("xx") == []
    assert registry.unassigned_translations() == [folder / "xx-de.babelon.tsv"]


def test_a_file_is_unassigned_until_its_ontology_is_loaded(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE)
    registry = OntologyRegistry(translation_dirs=[folder])
    registry.register_path(MONDO)
    registry.load_registered()
    assert registry.unassigned_translations() == [folder / "hp-de.babelon.tsv"]

    sha = registry.register_path(HP)
    service = registry.get_service(sha)
    assert service is not None and service.languages == ["de"]
    assert registry.unassigned_translations() == []


def test_registry_without_translation_folders_loads_as_before() -> None:
    registry = OntologyRegistry()
    sha = registry.register_path(HP)
    service = registry.get_service(sha)

    assert service is not None
    assert service.languages == []
    assert registry.translation_files() == []
    assert registry.unassigned_translations() == []


def test_package_resources_get_the_translations_too(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE)
    registry = OntologyRegistry(translation_dirs=[folder])
    profile = make_layered_package("single").manifest.task_profile
    assert profile is not None

    prepared = registry.prepare_package(
        profile, {"ontologies/hp.json": HP.read_bytes()}
    )
    assert [service.languages for service in prepared] == [["de"]]

    # The static helper takes the files as an argument and works without them.
    definition = OntologyDefinition(
        ontology_id="hp",
        label="HPO",
        release="2026-06-23",
        sha256=hashlib.sha256(HP.read_bytes()).hexdigest(),
    )
    data = HP.read_bytes()
    assert OntologyRegistry.load_resource(data, definition).languages == []
    assert OntologyRegistry.load_resource(data, definition, [DE, ES]).languages == [
        "de",
        "es",
    ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_translation_registry.py -v`
Expected: 4 failures — `OntologyRegistry.__init__() got an unexpected keyword argument 'translation_dirs'` (three tests) and `'OntologyRegistry' object has no attribute 'translation_files'`.

- [ ] **Step 3: Teach the registry the folders**

The spec has the registry pass "the matching files". The prefix of an ontology is only known after it is parsed, so the registry passes every translation file it finds and `OntologyService` keeps the ones whose name carries its prefix (Task 1, `apply_translations`).

In `src/ontotator/ontology/registry.py`, replace

```python
import threading
from dataclasses import dataclass
```

with

```python
import threading
from collections.abc import Iterable
from dataclasses import dataclass
```

Replace

```python
from ontotator.ontology.service import OntologyService
from ontotator.vendor.hpo_span_annotator.hpo import OntologyError
```

with

```python
from ontotator.ontology.service import OntologyService
from ontotator.ontology.translations import (
    discover_translation_files,
    parse_translation_name,
)
from ontotator.vendor.hpo_span_annotator.hpo import OntologyError
```

Replace

```python
    def __init__(self, base_dir: Path | str | None = None) -> None:
```

with

```python
    def __init__(
        self,
        base_dir: Path | str | None = None,
        translation_dirs: Iterable[Path | str] = (),
    ) -> None:
```

Directly after the last line of `__init__`,

```python
        self.base_dir = Path(base_dir).resolve() if base_dir is not None else None
```

add

```python
        # The folders ontologies are looked for in. Translation files
        # (hp-de.babelon.tsv) lie next to the ontologies there.
        self.translation_dirs = [Path(d) for d in translation_dirs]

    def translation_files(self) -> list[Path]:
        """Every translation file in the ontology folders, as of now."""
        return discover_translation_files(self.translation_dirs)

    def services_for_prefix(self, prefix: str) -> list[tuple[str, OntologyService]]:
        """Loaded ontologies whose dominant id prefix is ``prefix`` (lower case)."""
        return [
            (sha, service)
            for sha, service in self.services()
            if (service.ontology.dominant_prefix or "").lower() == prefix
        ]

    def unassigned_translations(self) -> list[Path]:
        """Translation files whose prefix matches no loaded ontology."""
        loaded = {
            (service.ontology.dominant_prefix or "").lower()
            for _, service in self.services()
        }
        unassigned = []
        for path in self.translation_files():
            parsed = parse_translation_name(path.name)
            if parsed is not None and parsed[0] not in loaded:
                unassigned.append(path)
        return unassigned
```

- [ ] **Step 4: Pass the files wherever the registry loads an ontology**

In `_load_once`, replace

```python
            service = OntologyService.load(path, ref)
```

with

```python
            service = OntologyService.load(
                path, ref, translation_paths=self.translation_files()
            )
```

Replace

```python
    @staticmethod
    def load_resource(data: bytes, expected: OntologyDefinition) -> OntologyService:
        """Validate and parse archive bytes without retaining a temporary path."""
```

with

```python
    @staticmethod
    def load_resource(
        data: bytes,
        expected: OntologyDefinition,
        translation_paths: Iterable[Path] = (),
    ) -> OntologyService:
        """Validate and parse archive bytes without retaining a temporary path."""
```

In `load_resource`, replace

```python
                return OntologyService.load(
                    path, OntologyRef(release=expected.release, sha256=expected.sha256)
                )
```

with

```python
                return OntologyService.load(
                    path,
                    OntologyRef(release=expected.release, sha256=expected.sha256),
                    translation_paths=translation_paths,
                )
```

In `prepare_package`, replace

```python
                prepared.append(self.load_resource(resources[ont.resource_path], ont))
```

with

```python
                prepared.append(
                    self.load_resource(
                        resources[ont.resource_path], ont, self.translation_files()
                    )
                )
```

- [ ] **Step 5: Adjust the one existing test stub that replaces `OntologyService.load`**

`test_registry_parses_outside_shared_lock_and_only_once` swaps `OntologyService.load` for a function with the old two-argument signature; `_load_once` now passes `translation_paths=`. The test's assertions stay as they are.

In `tests/test_followup_findings.py`, replace

```python
    def slow_load(path, ref):  # type: ignore[no-untyped-def]
        loads.append(path)
        started.set()
        assert release.wait(10)
        return original_load(path, ref)
```

with

```python
    def slow_load(path, ref, **kwargs):  # type: ignore[no-untyped-def]
        loads.append(path)
        started.set()
        assert release.wait(10)
        return original_load(path, ref, **kwargs)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_translation_registry.py tests/test_followup_findings.py tests/test_ontology_registry.py -v`
Expected: all pass.

- [ ] **Step 7: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/ontotator/ontology/registry.py tests/test_followup_findings.py tests/test_translation_registry.py
git commit -m "feat(search): let the ontology registry pass translation files to the ontologies it loads"
```

---

### Task 6: Start-up, `GET /ontologies` and the search event

**Files:**
- Modify: `src/ontotator/config.py` (`AppConfig.translation_dirs`)
- Modify: `src/ontotator/api/app.py` (`create_app`)
- Modify: `src/ontotator/cli.py` (`serve`)
- Modify: `src/ontotator/api/routes.py` (`OntologyTranslation`, `OntologyInfo.translations`, `_ontology_info`, search event)
- Test: `tests/test_translation_api.py` (create), `tests/test_distribution.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_translation_api.py`:

```python
"""Translation files through the HTTP API: start-up, listing, search event, upload."""

import io
import logging
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from layered_fixtures import make_layered_package

from ontotator.api.app import create_app
from ontotator.config import AppConfig
from ontotator.packages.writer import PackageWriter

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
MONDO = FIXTURES / "mondo.json"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"
TOKEN = "translation-test"


def _folder(tmp_path: Path, *files: Path) -> Path:
    """``<workspace>/ontologies`` holding copies of the given files."""
    folder = tmp_path / "workspace" / "ontologies"
    folder.mkdir(parents=True, exist_ok=True)
    for source in files:
        shutil.copyfile(source, folder / source.name)
    return folder


def _client(tmp_path: Path, **config: Any) -> TestClient:
    workspace = tmp_path / "workspace"
    app = create_app(
        AppConfig(
            workspace_dir=workspace,
            database_path=workspace / "editor.db",
            session_token=TOKEN,
            **config,
        )
    )
    return TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"})


def _listed(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/v1/ontologies")
    assert response.status_code == 200, response.text
    return {item["ontology_id"]: item for item in response.json()}


def _open_single(client: TestClient, embedded: bool = False) -> Any:
    """Import the single-layer HPO package and open a case; returns its key."""
    package = make_layered_package("single")
    resources = {"ontologies/hp.json": HP.read_bytes()} if embedded else {}
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream, embedded_files=resources)
    imported = client.post(
        "/api/v1/packages",
        files={"file": ("cases.zip", stream.getvalue(), "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    opened = client.post(
        "/api/v1/workspaces/open",
        json={
            "package_id": imported.json()["package_id"],
            "document_id": "doc-beta",
            "annotator_id": "annotator-1",
            "mode": "independent",
        },
    )
    assert opened.status_code == 200, opened.text
    return opened.json()["view"]["key"]


def _search(client: TestClient, key: Any, query: str, **extra: Any) -> Any:
    response = client.post(
        "/api/v1/search",
        json={
            "workspace_key": key,
            "annotation_id": "new-ann-1",
            "layer_id": "hpo-layer",
            "query": query,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- start-up and listing --------------------------------------------------- #


def test_start_loads_translations_from_both_ontology_folders(tmp_path: Path) -> None:
    _folder(tmp_path, DE)
    bundle = tmp_path / "bundle" / "ontologies"
    bundle.mkdir(parents=True)
    shutil.copyfile(ES, bundle / ES.name)

    client = _client(tmp_path, ontology_paths=[HP, MONDO], translation_dirs=[bundle])
    listed = _listed(client)

    assert listed["hp"]["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 4},
        {"language": "es", "filenames": ["hp-es.babelon.tsv"], "term_count": 3},
    ]
    assert listed["mondo"]["translations"] == []


def test_without_translation_files_the_list_is_empty(tmp_path: Path) -> None:
    listed = _listed(_client(tmp_path, ontology_paths=[HP]))

    assert listed["hp"]["translations"] == []
    assert listed["hp"]["term_count"] == 11


def test_two_files_of_one_language_are_listed_together(tmp_path: Path) -> None:
    folder = _folder(tmp_path, DE)
    (folder / "hp-de.synonyms.tsv").write_text(
        "subject_id\ttranslation_value\tStatus\n"
        "HP:0001250\tKrampf|Anfall\tOFFICIAL\n"
        "HP:0001284\tReflexlosigkeit\tOFFICIAL\n",
        encoding="utf-8",
    )
    listed = _listed(_client(tmp_path, ontology_paths=[HP]))

    # Five terms have a German name now: four from the first file, one more
    # (HP:0001284) from the second.
    assert listed["hp"]["translations"] == [
        {
            "language": "de",
            "filenames": ["hp-de.babelon.tsv", "hp-de.synonyms.tsv"],
            "term_count": 5,
        }
    ]


def test_broken_and_stray_files_do_not_block_the_start(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    folder = _folder(tmp_path, DE)
    (folder / "hp-fr.babelon.tsv").write_text("term\tname\nx\ty\n", encoding="utf-8")
    (folder / "hp-nl.babelon.tsv").write_bytes(b"\xff\xfe\x00broken")
    (folder / "xx-de.babelon.tsv").write_text(
        "subject_id\ttranslation_value\nXX:1\tEtwas\n", encoding="utf-8"
    )

    with caplog.at_level(logging.WARNING, logger="ontotator"):
        client = _client(tmp_path, ontology_paths=[HP])

    listed = _listed(client)
    assert listed["hp"]["status"] == "loaded"
    assert [item["language"] for item in listed["hp"]["translations"]] == ["de"]
    assert "Skipping translation file hp-fr.babelon.tsv" in caplog.text
    assert "Skipping translation file hp-nl.babelon.tsv" in caplog.text
    assert "xx-de.babelon.tsv matches no loaded ontology" in caplog.text


def test_package_shipped_ontology_is_searchable_in_german(tmp_path: Path) -> None:
    _folder(tmp_path, DE)
    client = _client(tmp_path)  # no ontology registered: the package brings it
    key = _open_single(client, embedded=True)

    result = _search(client, key, "Muskelhypotonie")

    first = result["candidates"][0]
    assert (first["term_id"], first["route"], first["match_language"]) == (
        "HP:0001252",
        "exact",
        "de",
    )
    assert [item["language"] for item in _listed(client)["hp"]["translations"]] == [
        "de"
    ]


# --- search event ----------------------------------------------------------- #


def test_search_event_records_the_active_languages(tmp_path: Path) -> None:
    _folder(tmp_path, DE, ES)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    repo = client.app.state.repo  # type: ignore[attr-defined]

    everything = _search(client, key, "Krampfanfall")
    assert everything["languages"] == ["en", "de", "es"]
    assert everything["candidates"][0]["match_language"] == "de"
    assert repo.get_search_event(everything["search_id"]).languages == [
        "en",
        "de",
        "es",
    ]

    spanish = _search(client, key, "Krampfanfall", languages=["es"])
    assert spanish["languages"] == ["en", "es"]
    assert "HP:0001250" not in spanish["displayed_ids"]
    assert repo.get_search_event(spanish["search_id"]).languages == ["en", "es"]
    assert spanish["index_identity"] == everything["index_identity"]

    english = _search(client, key, "Krampfanfall", languages=[])
    assert repo.get_search_event(english["search_id"]).languages == ["en"]
```

Append to `tests/test_distribution.py`:

```python
def test_translation_files_next_to_the_ontologies_are_loaded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    german = FIXTURES / "hp-de.babelon.tsv"
    spanish = FIXTURES / "hp-es.babelon.tsv"

    def translations(api_app) -> list[str]:  # type: ignore[no-untyped-def]
        listed = _api(api_app).get("/api/v1/ontologies").json()
        # Every loaded ontology with the prefix "hp" gets the files: the one from
        # the ontologies folder and the one the demo package brings along.
        assert {item["ontology_id"] for item in listed} == {"hp"}
        per_ontology = {
            tuple(t["language"] for t in item["translations"]) for item in listed
        }
        assert len(per_ontology) == 1
        return list(per_ontology.pop())

    # The delivery folder given with --provision-dir.
    root = _provision_dir(tmp_path)
    (root / "ontologies" / german.name).write_bytes(german.read_bytes())
    ws = tmp_path / "ws"
    _, api_app = _serve(ws, root)
    assert translations(api_app) == ["de"]
    # The file is read where it lies; it is not copied into the workspace.
    assert not (ws / "ontologies" / german.name).exists()

    # The workspace folder, on the next start.
    (ws / "ontologies" / spanish.name).write_bytes(spanish.read_bytes())
    _, api_app = _serve(ws, root)
    assert translations(api_app) == ["de", "es"]

    # ontologies/ next to the program (the current directory when run from source).
    other = tmp_path / "ws-2"
    monkeypatch.chdir(root)
    _, api_app = _serve(other, None)
    assert translations(api_app) == ["de"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_translation_api.py tests/test_distribution.py -v`
Expected: the new tests fail — `AppConfig` rejects `translation_dirs` (extra forbidden), the items of `GET /ontologies` have no `translations` key (`KeyError`), and the stored event has no languages (`[] == ['en', 'de', 'es']`). The existing tests of `test_distribution.py` pass.

- [ ] **Step 3: Configuration and application start**

In `src/ontotator/config.py`, directly after

```python
    ontology_paths: list[Path] = []
```

add

```python
    # Folders besides <workspace>/ontologies in which translation files
    # (hp-de.babelon.tsv) are looked for, e.g. ontologies/ next to the executable.
    translation_dirs: list[Path] = []
```

In `src/ontotator/api/app.py`, replace

```python
        registry = OntologyRegistry(base_dir=config.workspace_dir)
```

with

```python
        registry = OntologyRegistry(
            base_dir=config.workspace_dir,
            translation_dirs=[
                config.workspace_dir / "ontologies",
                *config.translation_dirs,
            ],
        )
```

In the same function, replace

```python
                    OntologyService.load(
                        config.ontology_path, config.expected_ontology_ref
                    )
```

with

```python
                    OntologyService.load(
                        config.ontology_path,
                        config.expected_ontology_ref,
                        translation_paths=registry.translation_files(),
                    )
```

and replace

```python
                registry.register_service(registry.load_resource(data, definition))
```

with

```python
                registry.register_service(
                    registry.load_resource(
                        data, definition, registry.translation_files()
                    )
                )
        # A file that cannot be read was already reported while its ontology
        # loaded. What is left to say: files that belong to no ontology at all.
        for stray in registry.unassigned_translations():
            logger.warning(
                "Translation file %s matches no loaded ontology and is skipped.",
                stray,
            )
```

Both notices go through `logging`. The CLI configures no handler, so Python's last-resort handler prints warnings to the console window (stderr); that is where "Could not load ontology …" appears today.

In `src/ontotator/cli.py`, in the `AppConfig(...)` call of `serve`, replace

```python
            ontology_paths=ontology_list,
            session_token=effective_token,
```

with

```python
            ontology_paths=ontology_list,
            # Translation files lie next to the ontologies. The workspace
            # folder is always searched; these are the delivery folders.
            translation_dirs=[
                app_dir() / "ontologies",
                *([source_dir / "ontologies"] if source_dir is not None else []),
            ],
            session_token=effective_token,
```

- [ ] **Step 4: List the translations and record the languages of a search**

In `src/ontotator/api/routes.py`, replace

```python
class OntologyInfo(BaseModel):
    ontology_id: str
    release: str
    sha256: str
    term_count: int
    path: str | None = None
    status: Literal["loaded", "failed"] = "loaded"
    error: str | None = None


def _ontology_info(sha: str, svc: OntologyService, path: Path | None) -> OntologyInfo:
    return OntologyInfo(
        ontology_id=(svc.ontology.dominant_prefix or "unknown").lower(),
        release=svc.ontology.release or svc.ref.release,
        sha256=sha,
        term_count=len(svc.ontology.terms),
        path=str(path) if path is not None else None,
    )
```

with

```python
class OntologyTranslation(BaseModel):
    """One language an ontology can be searched in besides English."""

    language: str
    # The files that contributed names in this language.
    filenames: list[str]
    # Terms with at least one name in this language.
    term_count: int


class OntologyInfo(BaseModel):
    ontology_id: str
    release: str
    sha256: str
    term_count: int
    path: str | None = None
    status: Literal["loaded", "failed"] = "loaded"
    error: str | None = None
    translations: list[OntologyTranslation] = Field(default_factory=list)


def _ontology_info(sha: str, svc: OntologyService, path: Path | None) -> OntologyInfo:
    return OntologyInfo(
        ontology_id=(svc.ontology.dominant_prefix or "unknown").lower(),
        release=svc.ontology.release or svc.ref.release,
        sha256=sha,
        term_count=len(svc.ontology.terms),
        path=str(path) if path is not None else None,
        translations=[
            OntologyTranslation(
                language=language,
                filenames=sorted(
                    item.filename
                    for item in svc.translations
                    if language in item.languages
                ),
                term_count=count,
            )
            for language, count in svc.translation_counts.items()
        ],
    )
```

In `search_ontology`, in the `SearchEventRecord(...)` call, directly after

```python
        candidate_routes={c.term_id: c.route for c in result.candidates if c.route},
```

add

```python
        languages=result.languages,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_translation_api.py tests/test_distribution.py tests/test_ontology_management.py tests/test_api.py -v`
Expected: all pass.

- [ ] **Step 6: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/ontotator/config.py src/ontotator/api/app.py src/ontotator/cli.py src/ontotator/api/routes.py tests/test_translation_api.py tests/test_distribution.py
git commit -m "feat(search): load translations at start, list them per ontology and record the languages of a search"
```

---

### Task 7: Upload — `POST /ontologies` accepts a translation file

**Files:**
- Modify: `src/ontotator/ontology/registry.py` (`rebuild_for_prefix`, `publish`)
- Modify: `src/ontotator/application/uploads.py` (`TranslationUploadService`; ontology uploads pick up stored translations)
- Modify: `src/ontotator/api/routes.py` (`TranslationUploadInfo`, `upload_ontology`)
- Test: `tests/test_translation_api.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_translation_api.py`, extend the imports. Replace

```python
from ontotator.config import AppConfig
from ontotator.packages.writer import PackageWriter
```

with

```python
from ontotator.config import AppConfig
from ontotator.ontology.service import OntologyService
from ontotator.packages.writer import PackageWriter
```

Append to the file:

```python
# --- upload ----------------------------------------------------------------- #


def _upload(client: TestClient, name: str, data: bytes) -> Any:
    return client.post(
        "/api/v1/ontologies",
        files={"file": (name, data, "text/tab-separated-values")},
    )


def test_uploading_a_translation_reloads_the_ontology(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP, MONDO])
    key = _open_single(client)
    before = _search(client, key, "Muskelhypotonie")
    assert before["languages"] == ["en"]
    assert all(c["match_language"] in (None, "en") for c in before["candidates"])

    response = _upload(client, "HP-de.babelon.tsv", DE.read_bytes())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filename"] == "hp-de.babelon.tsv"
    assert body["language"] == "de"
    assert body["assigned"] is True
    assert body["message"] == "hp-de.babelon.tsv was added. HP 2026-06-23: de 4 terms."
    assert [item["ontology_id"] for item in body["ontologies"]] == ["hp"]
    assert body["ontologies"][0]["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 4}
    ]
    stored = tmp_path / "workspace" / "ontologies" / "hp-de.babelon.tsv"
    assert stored.read_bytes() == DE.read_bytes()
    # No staging folder is left behind.
    assert [p.name for p in stored.parent.iterdir() if p.name.startswith(".")] == []

    after = _search(client, key, "Muskelhypotonie")
    assert after["languages"] == ["en", "de"]
    assert after["candidates"][0]["match_language"] == "de"
    assert after["index_identity"] != before["index_identity"]
    listed = _listed(client)
    assert listed["hp"]["translations"] == body["ontologies"][0]["translations"]
    assert listed["mondo"]["translations"] == []


def test_uploading_the_same_name_replaces_the_file(tmp_path: Path) -> None:
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    assert _upload(client, "hp-de.babelon.tsv", DE.read_bytes()).status_code == 200
    assert _upload(client, "hp-es.babelon.tsv", ES.read_bytes()).status_code == 200

    smaller = (
        b"subject_id\tpredicate_id\ttranslation_language\ttranslation_value\n"
        b"HP:0001284\trdfs:label\tde\tAreflexie\n"
    )
    response = _upload(client, "hp-de.babelon.tsv", smaller)

    assert response.status_code == 200, response.text
    # German is replaced, Spanish is kept.
    assert response.json()["ontologies"][0]["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 1},
        {"language": "es", "filenames": ["hp-es.babelon.tsv"], "term_count": 3},
    ]
    folder = tmp_path / "workspace" / "ontologies"
    assert (folder / "hp-de.babelon.tsv").read_bytes() == smaller
    assert sorted(p.name for p in folder.iterdir()) == [
        "hp-de.babelon.tsv",
        "hp-es.babelon.tsv",
    ]
    # The names of the replaced file are gone, the new one is found.
    assert "HP:0001250" not in _search(client, key, "Krampfanfall")["displayed_ids"]
    assert _search(client, key, "Areflexie")["candidates"][0]["match_language"] == "de"
    assert _search(client, key, "Hipotonía")["candidates"][0]["match_language"] == "es"


@pytest.mark.parametrize(
    ("name", "data", "reason"),
    [
        ("hp-de.babelon.tsv", b"term\tname\nHP:0001250\tKrampf\n", "subject_id"),
        (
            "hp-de.babelon.tsv",
            b"subject_id\ttranslation_value\nHP:9999999\tUnbekannt\n",
            "holds no name",
        ),
        ("hp-de.babelon.tsv", b"", "subject_id"),
        ("hp-de.babelon.tsv", b"\xff\xfe\x00broken", "cannot be read"),
        ("german.tsv", DE.read_bytes(), "not a translation file name"),
    ],
)
def test_unusable_uploads_are_rejected_and_change_nothing(
    tmp_path: Path, name: str, data: bytes, reason: str
) -> None:
    folder = _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    before = _listed(client)

    response = _upload(client, name, data)

    assert response.status_code == 400, response.text
    assert reason in response.json()["detail"]
    assert sorted(p.name for p in folder.iterdir()) == ["hp-de.babelon.tsv"]
    assert (folder / "hp-de.babelon.tsv").read_bytes() == DE.read_bytes()
    assert _listed(client) == before


def test_upload_without_a_matching_ontology_is_stored_with_a_notice(
    tmp_path: Path,
) -> None:
    client = _client(tmp_path, ontology_paths=[MONDO])

    response = _upload(client, "hp-de.babelon.tsv", DE.read_bytes())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["assigned"] is False
    assert body["ontologies"] == []
    assert "no loaded ontology has the prefix 'HP'" in body["message"]
    stored = tmp_path / "workspace" / "ontologies" / "hp-de.babelon.tsv"
    assert stored.read_bytes() == DE.read_bytes()
    assert _listed(client)["mondo"]["translations"] == []

    # Not a babelon file: rejected although no ontology could check its rows.
    bad = _upload(client, "hp-es.babelon.tsv", b"term\tname\nx\ty\n")
    assert bad.status_code == 400
    assert not (stored.parent / "hp-es.babelon.tsv").exists()

    # The ontology that arrives later picks the stored file up.
    added = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", HP.read_bytes(), "application/json")},
    )
    assert added.status_code == 200, added.text
    assert added.json()["translations"] == [
        {"language": "de", "filenames": ["hp-de.babelon.tsv"], "term_count": 4}
    ]


def test_failed_reload_keeps_the_old_index_and_stores_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = _folder(tmp_path, DE)
    client = _client(tmp_path, ontology_paths=[HP])
    key = _open_single(client)
    before = _search(client, key, "Krampfanfall")

    def broken(self: OntologyService, paths: object) -> OntologyService:
        raise RuntimeError("index build failed")

    monkeypatch.setattr(OntologyService, "with_translations", broken)
    response = _upload(client, "hp-es.babelon.tsv", ES.read_bytes())

    assert response.status_code == 500, response.text
    assert "index build failed" in response.json()["detail"]
    assert sorted(p.name for p in folder.iterdir()) == ["hp-de.babelon.tsv"]
    after = _search(client, key, "Krampfanfall")
    assert after["languages"] == ["en", "de"]
    assert after["index_identity"] == before["index_identity"]
    assert after["candidates"][0]["term_id"] == "HP:0001250"


def test_ontology_json_upload_still_answers_with_the_ontology(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/v1/ontologies",
        files={"file": ("hp.json", HP.read_bytes(), "application/json")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ontology_id"] == "hp"
    assert body["translations"] == []
    assert "filename" not in body
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_translation_api.py -v`
Expected: 9 of the 10 new tests fail — a `.tsv` upload is parsed as an ontology and answered with `400 Failed to register ontology: …` (so the status, the body and the `reason in detail` assertions fail). `test_ontology_json_upload_still_answers_with_the_ontology` passes already; it pins what must not change.

- [ ] **Step 3: Registry: rebuild without publishing, then publish**

In `src/ontotator/ontology/registry.py`, directly after the end of `unassigned_translations`, i.e. after

```python
            if parsed is not None and parsed[0] not in loaded:
                unassigned.append(path)
        return unassigned
```

add

```python

    def rebuild_for_prefix(
        self, prefix: str, translation_paths: Iterable[Path]
    ) -> dict[str, OntologyService]:
        """New services for the ontologies of a prefix; nothing is published.

        The caller looks at the result and hands it to :meth:`publish`. Until
        then, and if this raises, the current services keep answering.
        """
        paths = list(translation_paths)
        return {
            sha: service.with_translations(paths)
            for sha, service in self.services_for_prefix(prefix)
        }

    def publish(self, services: dict[str, OntologyService]) -> None:
        """Swap in rebuilt services, all at once."""
        with self._lock:
            self._services.update(services)
```

- [ ] **Step 4: The upload service**

In `src/ontotator/application/uploads.py`, replace

```python
import hashlib
import os
import tempfile
```

with

```python
import hashlib
import os
import shutil
import tempfile
```

Replace

```python
from ontotator.ontology.service import OntologyService
from ontotator.packages.models import PackageManifest, ValidatedPackage
```

with

```python
from ontotator.ontology.service import OntologyService
from ontotator.ontology.translations import babelon_problem, parse_translation_name
from ontotator.packages.models import PackageManifest, ValidatedPackage
```

Replace

```python
MAX_PACKAGE_UPLOAD_BYTES = MAX_COMPRESSED_BYTES
```

with

```python
MAX_TRANSLATION_UPLOAD_BYTES = 64 * 1024 * 1024  # 64 MiB
MAX_PACKAGE_UPLOAD_BYTES = MAX_COMPRESSED_BYTES
```

In `OntologyUploadService.store`, replace (an ontology uploaded after its translation file picks the file up)

```python
                    service = OntologyService.load(
                        tmp_path, OntologyRef(release="uploaded", sha256=digest)
                    )
```

with

```python
                    service = OntologyService.load(
                        tmp_path,
                        OntologyRef(release="uploaded", sha256=digest),
                        translation_paths=self.registry.translation_files(),
                    )
```

Add the result type and the service. In the same file, directly before

```python
class PackageImportService:
```

add

```python
@dataclass(frozen=True)
class StoredTranslation:
    """Result of a translation upload."""

    path: Path
    prefix: str
    language: str
    # SHA-256 of the ontology -> its service, rebuilt with the new file. Empty
    # when no loaded ontology has the file's prefix.
    services: dict[str, OntologyService]


class TranslationUploadService:
    """Stores an uploaded babelon TSV and rebuilds the ontologies it belongs to.

    Unlike an ontology, a translation file is stored under its own name and a
    file of the same name is replaced: packages pin ontologies, not
    translations. The file only reaches its place after the ontologies were
    rebuilt with it, so a file that cannot be used changes nothing.
    """

    def __init__(self, registry: OntologyRegistry, directory: Path) -> None:
        self.registry = registry
        self.directory = directory

    def store(self, source: BinaryIO, filename: str | None) -> StoredTranslation:
        name = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
        parsed = parse_translation_name(name)
        if parsed is None:
            raise DomainError(
                "INVALID_TRANSLATION",
                f"'{name}' is not a translation file name. Expected "
                "<prefix>-<language>.<kind>.tsv, e.g. hp-de.babelon.tsv.",
            )
        prefix, language = parsed

        self.directory.mkdir(parents=True, exist_ok=True)
        # Staged under its real name: the loader reads the language from it.
        staging = self.directory / f".upload-{uuid4().hex}"
        staging.mkdir()
        staged = staging / name
        try:
            with staged.open("wb") as handle:
                copy_limited(
                    source, handle, MAX_TRANSLATION_UPLOAD_BYTES, "Translation upload"
                )
            problem = babelon_problem(staged)
            if problem is not None:
                raise DomainError("INVALID_TRANSLATION", problem)

            self.registry.load_registered()
            others = [
                path
                for path in self.registry.translation_files()
                if path.name.lower() != name
            ]
            try:
                rebuilt = self.registry.rebuild_for_prefix(prefix, [*others, staged])
            except Exception as exc:
                raise DomainError(
                    "TRANSLATION_RELOAD_FAILED",
                    f"The ontology could not be reloaded with '{name}': {exc}. "
                    "The file was not stored; the search is unchanged.",
                ) from exc
            if rebuilt and not any(
                item.filename == name
                for service in rebuilt.values()
                for item in service.translations
            ):
                reasons = [
                    item.reason
                    for service in rebuilt.values()
                    for item in service.skipped_translations
                    if item.filename == name
                ]
                raise DomainError(
                    "INVALID_TRANSLATION",
                    reasons[0] if reasons else f"'{name}' holds no usable name.",
                )

            dest = self.directory / name
            os.replace(staged, dest)
            self.registry.publish(rebuilt)
            return StoredTranslation(
                path=dest, prefix=prefix, language=language, services=rebuilt
            )
        finally:
            shutil.rmtree(staging, ignore_errors=True)
```

How the error cases of the spec map onto this:

| Case | Where it is caught |
|---|---|
| not a babelon TSV (no `subject_id`), not readable as text | `babelon_problem` → `INVALID_TRANSLATION` → 400 |
| no usable row for the ontology it belongs to | rebuilt services list the file under `skipped_translations` → `INVALID_TRANSLATION` → 400 |
| no loaded ontology has the prefix | `rebuilt` is empty: file is stored, `services` is empty |
| the rebuild raises | `TRANSLATION_RELOAD_FAILED` → 500; nothing stored, nothing published |

- [ ] **Step 5: The endpoint**

In `src/ontotator/api/routes.py`, replace

```python
from ontotator.application.uploads import (
    OntologyUploadService,
    PackageImportService,
)
```

with

```python
from ontotator.application.uploads import (
    OntologyUploadService,
    PackageImportService,
    TranslationUploadService,
)
```

Directly after the last field of `OntologyInfo`,

```python
    translations: list[OntologyTranslation] = Field(default_factory=list)
```

add

```python


class TranslationUploadInfo(BaseModel):
    """Answer to the upload of a translation file (``.tsv``)."""

    filename: str
    language: str
    # False when no loaded ontology has the file's prefix yet.
    assigned: bool
    message: str
    # The ontologies that were reloaded with the file.
    ontologies: list[OntologyInfo] = Field(default_factory=list)
```

In `upload_ontology`, replace

```python
) -> OntologyInfo:
    """Upload and register an ontology file into the active workspace.

    Stored immutably as ``<stem>-<sha256[:12]>.json`` and remembered in the
    persistent configuration so it is registered again after a restart.
    """
    config = getattr(request.app.state, "config", None)
    directory = (
        (config.workspace_dir / "ontologies")
        if config
        else Path("./workspace/ontologies")
    )
```

with

```python
) -> OntologyInfo | TranslationUploadInfo:
    """Upload an ontology (``.json``) or a translation file (``.tsv``).

    An ontology is stored immutably as ``<stem>-<sha256[:12]>.json`` and
    remembered in the persistent configuration so it is registered again after
    a restart. A translation file (babelon TSV, e.g. ``hp-de.babelon.tsv``) is
    stored under its own name, replaces a file of that name, and the ontology
    it belongs to is reloaded.
    """
    config = getattr(request.app.state, "config", None)
    directory = (
        (config.workspace_dir / "ontologies")
        if config
        else Path("./workspace/ontologies")
    )
    if (file.filename or "").lower().endswith(".tsv"):
        return _upload_translation(file, ontology, directory)
```

Append to the file (after `upload_ontology`):

```python
def _upload_translation(
    file: UploadFile, ontology: OntologyRegistry, directory: Path
) -> TranslationUploadInfo:
    try:
        stored = TranslationUploadService(ontology, directory).store(
            file.file, file.filename
        )
    except PayloadTooLarge:
        raise
    except DomainError as exc:
        # A failed reload is not the uploader's mistake.
        status = 500 if exc.code == "TRANSLATION_RELOAD_FAILED" else 400
        raise HTTPException(
            status_code=status, detail=f"Failed to add translation: {exc}"
        ) from exc

    name = stored.path.name
    infos = [
        _ontology_info(sha, svc, ontology.registered_path(sha))
        for sha, svc in stored.services.items()
    ]
    if not infos:
        message = (
            f"{name} was stored, but no loaded ontology has the prefix "
            f"'{stored.prefix.upper()}'. It is used as soon as such an ontology is added."
        )
    else:
        loaded = "; ".join(
            f"{info.ontology_id.upper()} {info.release}: "
            + ", ".join(f"{t.language} {t.term_count} terms" for t in info.translations)
            for info in infos
        )
        message = f"{name} was added. {loaded}."
    return TranslationUploadInfo(
        filename=name,
        language=stored.language,
        assigned=bool(infos),
        message=message,
        ontologies=infos,
    )
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_translation_api.py tests/test_ontology_management.py -v`
Expected: all pass.

- [ ] **Step 7: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/ontotator/ontology/registry.py src/ontotator/application/uploads.py src/ontotator/api/routes.py tests/test_translation_api.py
git commit -m "feat(search): accept translation files in the ontology upload and reload the ontology"
```

---

### Task 8: Preferences — the search languages of each annotator

**Files:**
- Modify: `src/ontotator/application/preferences.py`
- Test: `tests/test_preferences_api.py`

- [ ] **Step 1: Adapt the existing assertions and write the failing tests**

The response of `/api/v1/preferences` gains a key, so the four existing assertions that compare the complete object need it too. They change in this commit, together with the model.

In `tests/test_preferences_api.py`, replace

```python
app_client = _shared_app_client
```

with

```python
app_client = _shared_app_client

EMPTY_PREFERENCES = {
    "last_annotator_id": None,
    "mode_by_package": {},
    "search_languages_by_annotator": {},
}
```

In `test_preferences_default_to_empty` and in `test_corrupt_preferences_file_falls_back_to_defaults` (one line each), replace

```python
    assert resp.json() == {"last_annotator_id": None, "mode_by_package": {}}
```

with

```python
    assert resp.json() == EMPTY_PREFERENCES
```

In `test_preferences_round_trip_and_persist_in_workspace`, replace

```python
    assert resp.json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-a": "review"},
    }
```

with

```python
    assert resp.json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-a": "review"},
        "search_languages_by_annotator": {},
    }
```

and

```python
    assert resp.json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-a": "review", "pkg-b": "independent"},
    }
```

with

```python
    assert resp.json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {"pkg-a": "review", "pkg-b": "independent"},
        "search_languages_by_annotator": {},
    }
```

Append to the file:

```python
# --------------------------------------------------------------------------- #
# Search languages per annotator
# --------------------------------------------------------------------------- #


def test_search_languages_are_stored_per_annotator(app_client):
    client, config = app_client
    url = "/api/v1/preferences"

    resp = client.put(
        url, json={"search_languages_by_annotator": {"  JPL ": ["DE", "es", "de "]}}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["search_languages_by_annotator"] == {"JPL": ["de", "es"]}

    # Another annotator is added; an empty list is a choice (English only).
    resp = client.put(url, json={"search_languages_by_annotator": {"AB": []}})
    assert resp.json()["search_languages_by_annotator"] == {
        "JPL": ["de", "es"],
        "AB": [],
    }

    # One annotator's selection is replaced, the other one is kept.
    resp = client.put(url, json={"search_languages_by_annotator": {"JPL": ["fr"]}})
    assert resp.json()["search_languages_by_annotator"] == {"JPL": ["fr"], "AB": []}

    # Updating something else leaves the selections alone.
    resp = client.put(url, json={"last_annotator_id": "AB"})
    assert resp.json() == {
        "last_annotator_id": "AB",
        "mode_by_package": {},
        "search_languages_by_annotator": {"JPL": ["fr"], "AB": []},
    }
    assert client.get(url).json() == resp.json()
    stored = json.loads(
        (config.workspace_dir / "preferences.json").read_text(encoding="utf-8")
    )
    assert stored["search_languages_by_annotator"] == {"JPL": ["fr"], "AB": []}

    # A second store on the same file reads the same selections (restart).
    from ontotator.application.preferences import PreferencesStore

    again = PreferencesStore(config.workspace_dir / "preferences.json").load()
    assert again.search_languages_by_annotator == {"JPL": ["fr"], "AB": []}


@pytest.mark.parametrize(
    "bad",
    [
        {"JPL": "de"},
        {"JPL": [1]},
        {"JPL": ["de-DE"]},
        {"JPL": ["x"]},
        {"JPL": ["de"] * 33},
        {"": ["de"]},
        {"dr\nx": ["de"]},
    ],
)
def test_search_languages_reject_invalid_selections(app_client, bad):
    client, config = app_client
    resp = client.put(
        "/api/v1/preferences", json={"search_languages_by_annotator": bad}
    )
    assert resp.status_code == 422
    assert not (config.workspace_dir / "preferences.json").exists()


def test_unreadable_search_language_entries_are_ignored(app_client):
    client, config = app_client
    (config.workspace_dir / "preferences.json").write_text(
        json.dumps(
            {
                "last_annotator_id": "JPL",
                "search_languages_by_annotator": {
                    "JPL": ["de"],
                    "AB": "everything",
                    "CD": [5],
                },
            }
        ),
        encoding="utf-8",
    )
    assert client.get("/api/v1/preferences").json() == {
        "last_annotator_id": "JPL",
        "mode_by_package": {},
        "search_languages_by_annotator": {"JPL": ["de"]},
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_preferences_api.py -v`
Expected: 5 failed, 18 passed. The three adapted tests fail (the response has no `search_languages_by_annotator`), `test_search_languages_are_stored_per_annotator` gets `422` (unknown field) and `test_unreadable_search_language_entries_are_ignored` misses the key. The seven cases of `test_search_languages_reject_invalid_selections` pass already, for the wrong reason: today the whole field is unknown. After Step 3 the field is known, and they pass only if each bad value is rejected.

- [ ] **Step 3: Implement**

In `src/ontotator/application/preferences.py`, replace

```python
PreferenceMode = Literal["independent", "review", "assisted"]
```

with

```python
MAX_SEARCH_LANGUAGES = 32

PreferenceMode = Literal["independent", "review", "assisted"]
```

Directly after

```python
def _check_annotator(value: str | None) -> str | None:
    return None if value is None else normalize_annotator_id(value)
```

add

```python


def _clean_languages(value: object) -> list[str] | None:
    """A stored language selection: short lower-case codes, each once."""
    if not isinstance(value, list) or len(value) > MAX_SEARCH_LANGUAGES:
        return None
    codes: list[str] = []
    for item in value:
        if not isinstance(item, str):
            return None
        code = item.strip().lower()
        if not (2 <= len(code) <= 8 and code.isascii() and code.isalpha()):
            return None
        if code not in codes:
            codes.append(code)
    return codes


def _check_search_languages(
    value: dict[str, list[str]] | None,
) -> dict[str, list[str]] | None:
    if value is None:
        return None
    checked: dict[str, list[str]] = {}
    for annotator_id, languages in value.items():
        codes = _clean_languages(languages)
        if codes is None:
            raise ValueError("languages must be a short list of language codes")
        checked[normalize_annotator_id(annotator_id)] = codes
    return checked
```

In `Preferences`, replace

```python
    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)


class _StoredPreferences(Preferences):
```

with

```python
    mode_by_package: dict[str, PreferenceMode] = Field(default_factory=dict)
    # Annotator id -> translation languages that annotator searches in. No
    # entry means the annotator never chose: all loaded languages are searched.
    search_languages_by_annotator: dict[str, list[str]] = Field(default_factory=dict)

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)


class _StoredPreferences(Preferences):
```

In `PreferencesUpdate`, replace

```python
    mode_by_package: dict[str, PreferenceMode] | None = None

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)
```

with

```python
    mode_by_package: dict[str, PreferenceMode] | None = None
    # Merged per annotator: the given annotators' selections are replaced, the
    # others are kept.
    search_languages_by_annotator: dict[str, list[str]] | None = None

    validate_annotator = field_validator("last_annotator_id")(_check_annotator)
    validate_search_languages = field_validator("search_languages_by_annotator")(
        _check_search_languages
    )
```

In `PreferencesStore._read`, directly after

```python
                    prefs.mode_by_package[package_id] = mode
```

add

```python
        selections = data.get("search_languages_by_annotator")
        if isinstance(selections, dict):
            for annotator_id, languages in selections.items():
                codes = _clean_languages(languages)
                if isinstance(annotator_id, str) and codes is not None:
                    prefs.search_languages_by_annotator[annotator_id] = codes
```

In `PreferencesStore.update`, directly after

```python
                prefs.mode_by_package.update(change.mode_by_package)
```

add

```python
            if change.search_languages_by_annotator:
                prefs.search_languages_by_annotator.update(
                    change.search_languages_by_annotator
                )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_preferences_api.py tests/test_legacy_config.py -v`
Expected: all pass.

- [ ] **Step 5: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ontotator/application/preferences.py tests/test_preferences_api.py
git commit -m "feat(search): store the search languages of each annotator in the workspace preferences"
```

---

### Task 9: Regenerate the contract

**Files:**
- Regenerate: `contracts/openapi.json`
- Regenerate: `frontend/src/api/generated.ts`

- [ ] **Step 1: Export the OpenAPI schema**

Run (repo root): `uv run python scripts/export_openapi.py`
Then: `uv run python scripts/export_openapi.py --check`
Expected: the check prints `OpenAPI schema is up-to-date`.

- [ ] **Step 2: Regenerate the TypeScript types**

Run (in `frontend/`): `npm run api:generate && npm run api:check`
Expected: `API schema and generated TypeScript types are in sync.`

- [ ] **Step 3: Verify the diff**

Run: `git diff --stat contracts/openapi.json frontend/src/api/generated.ts`, then `git diff frontend/src/api/generated.ts`
Expected in `generated.ts`, and nothing else:

- `OntologyInfo` gains `translations?: components["schemas"]["OntologyTranslation"][]`.
- New schema `OntologyTranslation` with `language: string`, `filenames: string[]`, `term_count: number`.
- New schema `TranslationUploadInfo` with `filename`, `language`, `assigned`, `message` and `ontologies?`.
- `Preferences` gains `search_languages_by_annotator?: { [key: string]: string[] }`; `PreferencesUpdate` the same with `| null`.
- `SearchRequest` gains `languages?: string[] | null`; `SearchResult` gains `languages?: string[]`.
- The response of `POST /api/v1/ontologies` becomes `components["schemas"]["OntologyInfo"] | components["schemas"]["TranslationUploadInfo"]`, and its description changes.

Every new field on an existing schema is **optional** (`?`). That is deliberate: `openapi-typescript` makes a property required when its schema carries a plain default (this is what made `route` on `SearchCandidate` required in Part 1 and broke typed fixtures), but not for `None` defaults and not for `default_factory`. All fields added in Tasks 4, 6 and 8 use one of those two. If a new field shows up **without** `?` on `SearchRequest`, `SearchResult`, `SearchCandidate`, `OntologyInfo` or `Preferences`, stop: a model deviates from this plan.

- [ ] **Step 4: Typecheck and tests: no existing typed fixture needs a change**

Run (in `frontend/`): `npm run typecheck && npm test`
Expected: no type errors, all tests pass. These are the typed fixtures that would break if one of the new fields were required; they must compile **unchanged**:

- `frontend/tests/searchState.test.ts` — `const candidate: SearchCandidate = {…}` (three literals) and `const mockResponse: SearchResult = {…}`.
- `frontend/tests/dashboard.test.tsx`, `frontend/tests/firstRun.test.tsx`, `frontend/tests/distribution.test.tsx`, `frontend/tests/legacyConfig.test.tsx`, `frontend/tests/review-findings.test.tsx`, `frontend/tests/workflow-regressions.test.tsx` — `vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: …, mode_by_package: {} })`.
- `frontend/tests/ontologyUpload.test.tsx`, `frontend/tests/review-findings.test.tsx` — `OntologyInfo` literals without `translations` (typed by the hand-written interface in `frontend/src/api/client.ts`, extended in Task 10).
- `frontend/src/editor/searchState.ts` — the `SearchRequest` literal without `languages`.

If `npm run typecheck` does report one of them, add the missing field to that fixture in **this** commit (`languages: []`, `translations: []`, `search_languages_by_annotator: {}`) and say so in the final report.

- [ ] **Step 5: Commit**

```bash
git add contracts/openapi.json frontend/src/api/generated.ts
git commit -m "build: regenerate the API contract for translations and search languages"
```

---

### Task 10: Frontend — dashboard shows the languages, the upload accepts `.tsv`

**Files:**
- Modify: `frontend/src/api/client.ts` (`OntologyInfo`, `uploadOntology`)
- Modify: `frontend/src/App.tsx`
- Test: `frontend/tests/dashboard.test.tsx`, `frontend/tests/ontologyUpload.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/dashboard.test.tsx`, directly before

```tsx
  it("filters documents by status tabs", async () => {
```

add

```tsx
  it("shows the languages and term counts of each ontology", async () => {
    vi.spyOn(api, "listPackages").mockResolvedValue(samplePackages as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(sampleDocuments as any);
    vi.spyOn(api, "listOntologies").mockResolvedValue([
      {
        ontology_id: "hp",
        release: "2026-06-23",
        sha256: "1",
        term_count: 19000,
        translations: [
          { language: "de", filenames: ["hp-de.babelon.tsv", "hp-de.synonyms.tsv"], term_count: 3412 },
          { language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 18201 },
          { language: "fr", filenames: ["hp-fr.babelon.tsv"], term_count: 880 },
        ],
      },
      { ontology_id: "mondo", release: "2026-01-01", sha256: "2", term_count: 7, translations: [] },
    ]);

    render(<App />);

    expect(
      await screen.findByText("Ontologies: HP 2026-06-23 · de 3 412 · es 18 201 · fr 880 terms, MONDO"),
    ).toBeDefined();
  });
```

In `frontend/tests/ontologyUpload.test.tsx`, replace the end of the file

```tsx
    await waitFor(() => {
      expect(uploadOntSpy).toHaveBeenCalledWith(fakeJson);
    });
  });
});
```

with

```tsx
    await waitFor(() => {
      expect(uploadOntSpy).toHaveBeenCalledWith(fakeJson);
    });
  });

  it("accepts a translation file in the header upload and reports what was loaded", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listPackages").mockResolvedValue([]);
    const translations = [{ language: "de", filenames: ["hp-de.babelon.tsv"], term_count: 3412 }];
    const listSpy = vi
      .spyOn(api, "listOntologies")
      .mockResolvedValueOnce([{ ontology_id: "hp", release: "2026-06-23", sha256: "abc", term_count: 19000 }])
      .mockResolvedValue([
        { ontology_id: "hp", release: "2026-06-23", sha256: "abc", term_count: 19000, translations },
      ]);
    const uploadSpy = vi.spyOn(api, "uploadOntology").mockResolvedValue({
      filename: "hp-de.babelon.tsv",
      language: "de",
      assigned: true,
      message: "hp-de.babelon.tsv was added. HP 2026-06-23: de 3412 terms.",
      ontologies: [],
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("Ontologies: HP")).toBeDefined());

    const input = screen.getByLabelText("Ontology (.json) or translation file (.tsv)") as HTMLInputElement;
    expect(input.accept.split(",")).toEqual([".json", ".tsv"]);
    expect(screen.getByRole("button", { name: "Add ontology (.json) or translation (.tsv)" })).toBeDefined();

    const tsv = new File(["subject_id\ttranslation_value\n"], "hp-de.babelon.tsv", {
      type: "text/tab-separated-values",
    });
    fireEvent.change(input, { target: { files: [tsv] } });

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(tsv));
    const notice = await screen.findByRole("status", { name: "Import result" });
    expect(notice.textContent).toContain("hp-de.babelon.tsv was added. HP 2026-06-23: de 3412 terms.");
    // The ontology display is refreshed after the upload.
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Ontologies: HP 2026-06-23 · de 3 412 terms")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no notice after a plain ontology upload", async () => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listPackages").mockResolvedValue([]);
    vi.spyOn(api, "listOntologies").mockResolvedValue([]);
    const uploadSpy = vi.spyOn(api, "uploadOntology").mockResolvedValue({
      ontology_id: "hp",
      release: "2026-06",
      sha256: "abc1234",
      term_count: 15000,
    });

    render(<App />);
    const input = await screen.findByLabelText("Ontology (.json) or translation file (.tsv)");
    const json = new File(['{"graphs": []}'], "hp.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [json] } });

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith(json));
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    expect(screen.queryByRole("status", { name: "Import result" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/dashboard.test.tsx tests/ontologyUpload.test.tsx`
Expected: 3 failures — the header reads `Ontologies: HP, MONDO`; there is no input labelled `Ontology (.json) or translation file (.tsv)` (two tests). `npm run typecheck` fails too: `translations` and the upload result are not known to the client types yet.

- [ ] **Step 3: Client types**

In `frontend/src/api/client.ts`, replace

```ts
export interface OntologyInfo {
  ontology_id: string;
  release: string;
  sha256: string;
  term_count: number;
  path?: string | null;
}
```

with

```ts
export type OntologyTranslation = components["schemas"]["OntologyTranslation"];
export type TranslationUploadInfo = components["schemas"]["TranslationUploadInfo"];

export interface OntologyInfo {
  ontology_id: string;
  release: string;
  sha256: string;
  term_count: number;
  path?: string | null;
  /** The languages the ontology can be searched in besides English. */
  translations?: OntologyTranslation[];
}
```

Replace

```ts
  async uploadOntology(file: File): Promise<OntologyInfo> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request<OntologyInfo>("/api/v1/ontologies", {
```

with

```ts
  /** Upload an ontology (.json) or a translation file (.tsv, e.g. hp-de.babelon.tsv). */
  async uploadOntology(file: File): Promise<OntologyInfo | TranslationUploadInfo> {
    const formData = new FormData();
    formData.append("file", file);
    return this.request<OntologyInfo | TranslationUploadInfo>("/api/v1/ontologies", {
```

- [ ] **Step 4: Dashboard and upload**

In `frontend/src/App.tsx`, directly after

```tsx
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
```

add

```tsx

/** 18201 -> "18 201". */
const formatCount = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

/** "HP", or with translations "HP 2026-06-23 · de 3 412 · es 18 201 terms". */
export const ontologySummary = (ontology: OntologyInfo): string => {
  const id = ontology.ontology_id.toUpperCase();
  const translations = ontology.translations ?? [];
  if (translations.length === 0) return id;
  const languages = translations.map((item) => `${item.language} ${formatCount(item.term_count)}`);
  return `${id} ${ontology.release} · ${languages.join(" · ")} terms`;
};
```

In `handleUploadMissingOntology`, replace

```tsx
      await api.uploadOntology(file);
      await loadOntologies();
```

with

```tsx
      const uploaded = await api.uploadOntology(file);
      await loadOntologies();
      // A translation file answers with what was loaded, or why it waits for its ontology.
      if ("filename" in uploaded) setNotice(uploaded.message);
```

Replace

```tsx
    () => Array.from(new Set(ontologies.map((o) => o.ontology_id.toUpperCase()))),
```

with

```tsx
    () => Array.from(new Set(ontologies.map(ontologySummary))),
```

In `fileInputs`, replace

```tsx
        accept=".json"
        aria-label="Ontology file (.json)"
```

with

```tsx
        accept=".json,.tsv"
        aria-label="Ontology (.json) or translation file (.tsv)"
```

In the header, replace

```tsx
                padding: "3px 8px",
                borderRadius: 4,
              }}
            >
              Ontologies: {ontologyLabels.join(", ")}
```

with

```tsx
                padding: "3px 8px",
                borderRadius: 4,
                whiteSpace: "nowrap",
              }}
            >
              Ontologies: {ontologyLabels.join(", ")}
```

and

```tsx
            {isUploadingOntology ? "Uploading..." : "Add ontology (.json)"}
```

with

```tsx
            {isUploadingOntology ? "Uploading..." : "Add ontology (.json) or translation (.tsv)"}
```

The second file input (in the "Missing ontology" prompt) keeps `accept=".json"`: that prompt asks for an ontology. The numbers use a plain space as thousands separator and the badge does not wrap; a non-breaking space would be folded by the Testing Library queries and is easy to lose in an editor.

- [ ] **Step 5: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/dashboard.test.tsx tests/ontologyUpload.test.tsx && npm run typecheck && npm test`
Expected: all pass, no type errors. `tests/review-findings.test.tsx` still finds `Ontologies: HP` (two HPO versions without translations collapse to one label, as before); `tests/firstRun.test.tsx` and `browser/legacy-config.spec.ts` still find a button matching `/Add ontology/`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/App.tsx frontend/tests/dashboard.test.tsx frontend/tests/ontologyUpload.test.tsx
git commit -m "feat(frontend): show the languages of each ontology and accept translation files in the upload"
```

---

### Task 11: Frontend — flags, the language button and the stored selection

**Files:**
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/editor/flags/gb.svg`, `de.svg`, `es.svg`, `fr.svg`, `nl.svg`, `index.ts`
- Create: `frontend/src/editor/searchLanguages.ts`
- Create: `frontend/src/editor/SearchLanguageButton.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/tests/searchLanguages.test.tsx` (create)

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/searchLanguages.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flagFor } from "../src/editor/flags";
import { SearchLanguageButton } from "../src/editor/SearchLanguageButton";
import {
  activeLanguages,
  toggledSelection,
  useSearchLanguages,
  type LanguageClient,
  type SearchLanguageControl,
} from "../src/editor/searchLanguages";

const hp = {
  ontology_id: "hp",
  release: "2026-06-23",
  sha256: "ABC123",
  term_count: 19000,
  translations: [
    { language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 18201 },
    { language: "de", filenames: ["hp-de.babelon.tsv", "hp-de.synonyms.tsv"], term_count: 3412 },
  ],
};
const mondo = { ontology_id: "mondo", release: "2026-01-01", sha256: "ffff", term_count: 7, translations: [] };

const clientWith = (stored?: Record<string, string[]>) => {
  const client = {
    listOntologies: vi.fn().mockResolvedValue([hp, mondo]),
    getPreferences: vi.fn().mockResolvedValue({
      last_annotator_id: "JPL",
      mode_by_package: {},
      ...(stored ? { search_languages_by_annotator: stored } : {}),
    }),
    updatePreferences: vi.fn().mockResolvedValue({}),
  };
  return client as typeof client & LanguageClient;
};

describe("search language selection", () => {
  it("treats a missing selection as all loaded languages and ignores codes that are not loaded", () => {
    expect(activeLanguages(["de", "es"], undefined)).toEqual(["de", "es"]);
    expect(activeLanguages(["de", "es"], [])).toEqual([]);
    expect(activeLanguages(["de", "es"], ["es", "fr"])).toEqual(["es"]);
    // A language that arrived after the annotator chose starts switched off.
    expect(activeLanguages(["de", "es", "nl"], ["de", "es"])).toEqual(["de", "es"]);
  });

  it("switches one language and keeps stored codes that are not loaded", () => {
    expect(toggledSelection(["de", "es"], undefined, "de")).toEqual(["es"]);
    expect(toggledSelection(["de", "es"], ["es"], "de")).toEqual(["de", "es"]);
    expect(toggledSelection(["de", "es"], ["es"], "es")).toEqual([]);
    expect(toggledSelection(["de", "es"], ["es", "fr"], "es")).toEqual(["fr"]);
    expect(toggledSelection(["de", "es"], ["fr"], "de")).toEqual(["de", "fr"]);
  });
});

describe("useSearchLanguages", () => {
  it("offers the loaded languages of the ontology, all active by default", async () => {
    const client = clientWith();
    const { result } = renderHook(() => useSearchLanguages(client, "JPL"));

    await waitFor(() => expect(result.current("abc123")).toBeDefined());
    const control = result.current("abc123")!;
    expect(control.options).toEqual([
      { language: "de", termCount: 3412 },
      { language: "es", termCount: 18201 },
    ]);
    expect(control.active).toEqual(["de", "es"]);
  });

  it("gives nothing for an ontology without translations or an unknown one", async () => {
    const client = clientWith();
    const { result } = renderHook(() => useSearchLanguages(client, "JPL"));

    await waitFor(() => expect(result.current("abc123")).toBeDefined());
    expect(result.current("ffff")).toBeUndefined();
    expect(result.current("nope")).toBeUndefined();
    expect(result.current(undefined)).toBeUndefined();
  });

  it("restores the stored selection of this annotator and not of another one", async () => {
    const client = clientWith({ JPL: ["es", "fr"], AB: ["de"] });

    const mine = renderHook(() => useSearchLanguages(client, "JPL"));
    await waitFor(() => expect(mine.result.current("abc123")?.active).toEqual(["es"]));

    const theirs = renderHook(() => useSearchLanguages(client, "AB"));
    await waitFor(() => expect(theirs.result.current("abc123")?.active).toEqual(["de"]));

    const nobody = renderHook(() => useSearchLanguages(client, "NEW"));
    await waitFor(() => expect(nobody.result.current("abc123")).toBeDefined());
    expect(nobody.result.current("abc123")!.active).toEqual(["de", "es"]);
  });

  it("stores a change for this annotator only and applies it at once", async () => {
    const client = clientWith({ JPL: ["es", "fr"], AB: ["de"] });
    const { result } = renderHook(() => useSearchLanguages(client, "JPL"));
    await waitFor(() => expect(result.current("abc123")?.active).toEqual(["es"]));

    act(() => result.current("abc123")!.onToggle("de"));
    expect(result.current("abc123")!.active).toEqual(["de", "es"]);
    expect(client.updatePreferences).toHaveBeenLastCalledWith({
      search_languages_by_annotator: { JPL: ["de", "es", "fr"] },
    });

    act(() => result.current("abc123")!.onToggle("es"));
    expect(result.current("abc123")!.active).toEqual(["de"]);
    expect(client.updatePreferences).toHaveBeenLastCalledWith({
      search_languages_by_annotator: { JPL: ["de", "fr"] },
    });
    expect(client.updatePreferences).toHaveBeenCalledTimes(2);
  });

  it("stays silent when the server cannot be asked", async () => {
    const client = {
      listOntologies: vi.fn().mockRejectedValue(new Error("offline")),
      getPreferences: vi.fn().mockRejectedValue(new Error("offline")),
      updatePreferences: vi.fn(),
    } as unknown as LanguageClient;
    const { result } = renderHook(() => useSearchLanguages(client, "JPL"));

    await waitFor(() => expect(client.listOntologies).toHaveBeenCalled());
    expect(result.current("abc123")).toBeUndefined();
  });
});

describe("SearchLanguageButton", () => {
  afterEach(cleanup);

  const control = (active: string[], languages = ["de", "es"], onToggle = vi.fn()): SearchLanguageControl => ({
    options: languages.map((language, index) => ({ language, termCount: 3412 + index * 14789 })),
    active,
    onToggle,
  });
  const flagsIn = (element: Element) =>
    Array.from(element.querySelectorAll("[data-language]")).map((node) => node.getAttribute("data-language"));

  it("bundles a flag image for the five languages and none for others", () => {
    for (const language of ["en", "de", "es", "fr", "nl", "DE"]) {
      expect(flagFor(language), language).toMatch(/\.svg|^data:image\/svg/);
    }
    expect(new Set(["en", "de", "es", "fr", "nl"].map(flagFor)).size).toBe(5);
    expect(flagFor("pt")).toBeUndefined();
  });

  it("shows the flags of the active languages, English first, and names them for screen readers", () => {
    render(<SearchLanguageButton control={control(["de"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, DE" });
    expect(flagsIn(button)).toEqual(["en", "de"]);
    expect(button.querySelectorAll("img")).toHaveLength(2);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows three flags and +n from four languages on", () => {
    render(<SearchLanguageButton control={control(["de", "es", "fr", "nl"], ["de", "es", "fr", "nl"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, DE, ES, FR, NL" });
    expect(flagsIn(button)).toEqual(["en", "de", "es"]);
    expect(button.textContent).toBe("+2");
  });

  it("shows exactly three flags without a counter for three languages", () => {
    render(<SearchLanguageButton control={control(["de", "es"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, DE, ES" });
    expect(flagsIn(button)).toEqual(["en", "de", "es"]);
    expect(button.textContent).toBe("");
  });

  it("falls back to the language code when no flag is bundled", () => {
    render(<SearchLanguageButton control={control(["pt"], ["pt"])} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, PT" });
    expect(button.querySelectorAll("img")).toHaveLength(1);
    expect(button.textContent).toBe("PT");
  });

  it("lists every loaded language with checkbox, flag and code; English is fixed", () => {
    const onToggle = vi.fn();
    render(<SearchLanguageButton control={control(["es"], ["de", "es"], onToggle)} />);
    fireEvent.click(screen.getByRole("button", { name: /Search languages/ }));

    const list = screen.getByRole("group", { name: "Search languages" });
    const boxes = Array.from(list.querySelectorAll("label")).map((label) => ({
      code: label.textContent,
      flag: label.querySelector("img")?.getAttribute("data-language"),
      checked: (label.querySelector("input") as HTMLInputElement).checked,
      disabled: (label.querySelector("input") as HTMLInputElement).disabled,
    }));
    expect(boxes).toEqual([
      { code: "EN", flag: "en", checked: true, disabled: true },
      { code: "DE", flag: "de", checked: false, disabled: false },
      { code: "ES", flag: "es", checked: true, disabled: false },
    ]);
    expect(screen.getByRole("checkbox", { name: "DE" }).closest("label")!.title).toBe(
      "3,412 terms have a name in this language",
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "EN" }));
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));
    expect(onToggle).toHaveBeenCalledWith("de");
    // The list stays open for further changes.
    expect(screen.getByRole("group")).toBeDefined();
  });

  it("closes on Escape and on a click outside, not on a click inside", () => {
    render(
      <div>
        <span>elsewhere</span>
        <SearchLanguageButton control={control(["de"])} />
      </div>,
    );
    const button = screen.getByRole("button", { name: /Search languages/ });

    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("checkbox", { name: "DE" }));
    expect(screen.getByRole("group")).toBeDefined();
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("group")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "DE" }), { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/searchLanguages.test.tsx`
Expected: the file fails to load — `Failed to resolve import "../src/editor/flags"`.

- [ ] **Step 3: The flag images**

Five hand-written SVG files, 16 × 12 units, plain stripes and one cross. They live next to the component that uses them and are imported like any module; Vite turns each import into a URL (inlined as a `data:` URI in the production build, because the files are far below Vite's 4 kB limit, so the embedded web assets gain no extra files and nothing is fetched from a network).

TypeScript needs to know what importing an `.svg` yields. Create `frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Create `frontend/src/editor/flags/gb.svg` (United Kingdom, for English):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 12">
  <rect width="16" height="12" fill="#012169"/>
  <path d="M0 0l16 12M16 0L0 12" stroke="#fff" stroke-width="2.4"/>
  <path d="M0 0l16 12M16 0L0 12" stroke="#c8102e" stroke-width="0.8"/>
  <path d="M8 0v12M0 6h16" stroke="#fff" stroke-width="4"/>
  <path d="M8 0v12M0 6h16" stroke="#c8102e" stroke-width="2.4"/>
</svg>
```

Create `frontend/src/editor/flags/de.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 12">
  <rect width="16" height="4" fill="#000"/>
  <rect y="4" width="16" height="4" fill="#dd0000"/>
  <rect y="8" width="16" height="4" fill="#ffce00"/>
</svg>
```

Create `frontend/src/editor/flags/es.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 12">
  <rect width="16" height="12" fill="#aa151b"/>
  <rect y="3" width="16" height="6" fill="#f1bf00"/>
</svg>
```

Create `frontend/src/editor/flags/fr.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 12" preserveAspectRatio="none">
  <rect width="5" height="12" fill="#0055a4"/>
  <rect x="5" width="5" height="12" fill="#fff"/>
  <rect x="10" width="5" height="12" fill="#ef4135"/>
</svg>
```

Create `frontend/src/editor/flags/nl.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 12">
  <rect width="16" height="4" fill="#ae1c28"/>
  <rect y="4" width="16" height="4" fill="#fff"/>
  <rect y="8" width="16" height="4" fill="#21468b"/>
</svg>
```

Create `frontend/src/editor/flags/index.ts`:

```ts
import de from "./de.svg";
import es from "./es.svg";
import fr from "./fr.svg";
import gb from "./gb.svg";
import nl from "./nl.svg";

/**
 * Bundled flag images by language code. Emoji flags are not an option: Windows
 * renders them as two letters, and the portable bundle runs without network.
 */
const FLAGS: Record<string, string> = { en: gb, de, es, fr, nl };

/** The flag image for a language, or undefined when none is bundled. */
export const flagFor = (language: string): string | undefined => FLAGS[language.toLowerCase()];
```

- [ ] **Step 4: The selection logic and the hook**

Create `frontend/src/editor/searchLanguages.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, OntologyInfo } from "../api/client";

export interface SearchLanguageOption {
  language: string;
  /** Terms with at least one name in this language. */
  termCount: number;
}

/** What the language button of the search box needs. English is implied and always on. */
export interface SearchLanguageControl {
  /** The translation languages loaded for the ontology, sorted by code. */
  options: SearchLanguageOption[];
  /** The loaded languages this annotator searches in. */
  active: string[];
  onToggle: (language: string) => void;
}

/** No stored selection means all loaded languages; stored codes that are not loaded are ignored. */
export const activeLanguages = (loaded: string[], stored: string[] | undefined): string[] =>
  stored === undefined ? loaded : loaded.filter((language) => stored.includes(language));

/** The selection to store after one loaded language was switched; codes that are not loaded stay stored. */
export const toggledSelection = (
  loaded: string[],
  stored: string[] | undefined,
  language: string,
): string[] => {
  const active = activeLanguages(loaded, stored);
  const next = active.includes(language)
    ? active.filter((code) => code !== language)
    : [...active, language];
  const notLoaded = (stored ?? []).filter((code) => !loaded.includes(code));
  return [...loaded.filter((code) => next.includes(code)), ...notLoaded];
};

export type LanguageClient = Pick<ApiClient, "listOntologies" | "getPreferences" | "updatePreferences">;

/**
 * The search languages of one annotator. Returns a function that gives the
 * control for an ontology (by SHA-256), or undefined when that ontology has no
 * translation loaded; the search box then shows no language button.
 */
export function useSearchLanguages(
  client: LanguageClient,
  annotatorId: string,
): (ontologySha256: string | null | undefined) => SearchLanguageControl | undefined {
  const [ontologies, setOntologies] = useState<OntologyInfo[]>([]);
  const [stored, setStored] = useState<string[] | undefined>(undefined);
  // The latest selection, so two quick clicks build on each other.
  const storedRef = useRef<string[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    client.listOntologies().then(
      (list) => {
        if (!cancelled) setOntologies(list ?? []);
      },
      () => undefined,
    );
    client.getPreferences().then(
      (prefs) => {
        if (cancelled) return;
        storedRef.current = prefs?.search_languages_by_annotator?.[annotatorId];
        setStored(storedRef.current);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [client, annotatorId]);

  return useCallback(
    (ontologySha256) => {
      const sha = ontologySha256?.toLowerCase();
      const ontology = sha ? ontologies.find((item) => item.sha256.toLowerCase() === sha) : undefined;
      const options = (ontology?.translations ?? [])
        .map((item) => ({ language: item.language, termCount: item.term_count }))
        .sort((a, b) => a.language.localeCompare(b.language));
      if (options.length === 0) return undefined;
      const loaded = options.map((option) => option.language);
      return {
        options,
        active: activeLanguages(loaded, stored),
        onToggle: (language: string) => {
          const next = toggledSelection(loaded, storedRef.current, language);
          storedRef.current = next;
          setStored(next);
          void client
            .updatePreferences({ search_languages_by_annotator: { [annotatorId]: next } })
            .catch(() => undefined);
        },
      };
    },
    [client, annotatorId, ontologies, stored],
  );
}
```

- [ ] **Step 5: The button and its list**

Create `frontend/src/editor/SearchLanguageButton.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { flagFor } from "./flags";
import type { SearchLanguageControl } from "./searchLanguages";

const MAX_FLAGS = 3;

const Flag: React.FC<{ language: string }> = ({ language }) => {
  const src = flagFor(language);
  return src ? (
    <img className="lang-flag" src={src} alt="" width={16} height={12} data-language={language} />
  ) : (
    <span className="lang-code" data-language={language}>
      {language.toUpperCase()}
    </span>
  );
};

/** The small flag button at the right edge of the search box, and its checkbox list. */
export const SearchLanguageButton: React.FC<{ control: SearchLanguageControl }> = ({ control }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // English is the ontology itself: always searched, always shown first.
  const shown = ["en", ...control.active];
  const flags = shown.length > MAX_FLAGS ? shown.slice(0, MAX_FLAGS) : shown;
  const more = shown.length - flags.length;
  const name = `Search languages: ${shown.map((code) => code.toUpperCase()).join(", ")}`;

  return (
    <div
      className="search-language"
      ref={rootRef}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="search-language-button"
        aria-label={name}
        aria-haspopup="true"
        aria-expanded={open}
        title={name}
        onClick={() => setOpen((value) => !value)}
      >
        {flags.map((code) => (
          <Flag key={code} language={code} />
        ))}
        {more > 0 && <span className="lang-code">+{more}</span>}
      </button>
      {open && (
        <div className="search-language-menu" role="group" aria-label="Search languages">
          <label className="search-language-option" title="The names of the ontology itself are always searched">
            <input type="checkbox" checked disabled readOnly />
            <Flag language="en" />
            <span>EN</span>
          </label>
          {control.options.map((option) => (
            <label
              key={option.language}
              className="search-language-option"
              title={`${option.termCount.toLocaleString("en-US")} terms have a name in this language`}
            >
              <input
                type="checkbox"
                checked={control.active.includes(option.language)}
                onChange={() => control.onToggle(option.language)}
              />
              <Flag language={option.language} />
              <span>{option.language.toUpperCase()}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
```

Append to `frontend/src/styles.css`:

```css
/* Search languages: flag button at the right edge of the search box */
.search-language {
  position: relative;
  flex: none;
  display: flex;
}

.search-language-button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--bg-surface);
  cursor: pointer;
}

.search-language-button:hover,
.search-language-button[aria-expanded="true"] {
  border-color: var(--primary);
}

.lang-flag {
  display: block;
  width: 16px;
  height: 12px;
  border-radius: 1px;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.18);
}

.lang-code {
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 12px;
  color: var(--text-muted);
}

.search-language-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
  padding: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.14);
}

.search-language-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 0.85rem;
  border-radius: 4px;
  cursor: pointer;
}

.search-language-option:hover {
  background: var(--primary-light);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/searchLanguages.test.tsx && npm run typecheck && npm test`
Expected: 14 new tests pass, no type errors, the whole suite passes. Nothing renders the button yet; Task 12 puts it into the search box.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/vite-env.d.ts frontend/src/editor/flags frontend/src/editor/searchLanguages.ts frontend/src/editor/SearchLanguageButton.tsx frontend/src/styles.css frontend/tests/searchLanguages.test.tsx
git commit -m "feat(frontend): add the search language button with bundled flags and the per-annotator selection"
```

---

### Task 12: Frontend — the language button in the search box

**Files:**
- Modify: `frontend/src/editor/searchState.ts` (`SearchManager.search`)
- Modify: `frontend/src/editor/SearchPanel.tsx`
- Modify: `frontend/src/editor/AnnotationPanel.tsx`
- Modify: `frontend/src/app/CaseScreen.tsx`
- Test: `frontend/tests/searchState.test.ts`, `frontend/tests/searchPanel.test.tsx`, `frontend/tests/caseScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/searchState.test.ts`, directly before

```ts
  it("updates state with candidates upon successful search", async () => {
```

add

```ts
  it("sends the languages only when they are given", async () => {
    searchOntologySpy.mockResolvedValue({ route: "auto", query: "krampf", candidates: [] });
    const manager = new SearchManager(mockClient);

    await manager.search("krampf", "ann-1", sampleKey, "auto", 10, "hpo-layer");
    expect("languages" in searchOntologySpy.mock.calls[0][0]).toBe(false);

    await manager.search("krampf", "ann-1", sampleKey, "auto", 10, "hpo-layer", ["de", "es"]);
    expect(searchOntologySpy.mock.calls[1][0].languages).toEqual(["de", "es"]);

    // An empty list is a selection (English only), not "no selection".
    await manager.search("krampf", "ann-1", sampleKey, "auto", 10, "hpo-layer", []);
    expect(searchOntologySpy.mock.calls[2][0].languages).toEqual([]);
  });
```

In `frontend/tests/searchPanel.test.tsx`, replace the imports

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/editor/SearchPanel";
import { SearchManager } from "../src/editor/searchState";
```

with

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/editor/SearchPanel";
import { toggledSelection, type SearchLanguageControl } from "../src/editor/searchLanguages";
import { SearchManager } from "../src/editor/searchState";
```

Append to the file:

```tsx
describe("SearchPanel language selection", () => {
  afterEach(cleanup);

  const loaded = ["de", "es"];

  /** The panel with a parent that keeps the selection, as the case screen does. */
  const Harness = ({
    searchOntology,
    initial,
    onStore,
  }: {
    searchOntology: ReturnType<typeof vi.fn>;
    initial: string[] | undefined;
    onStore: (selection: string[]) => void;
  }) => {
    const [manager] = useState(() => new SearchManager({ searchOntology } as any));
    const [stored, setStored] = useState(initial);
    const languages: SearchLanguageControl = {
      options: [
        { language: "de", termCount: 3412 },
        { language: "es", termCount: 18201 },
      ],
      active: stored === undefined ? loaded : loaded.filter((code) => stored.includes(code)),
      onToggle: (language) => {
        const next = toggledSelection(loaded, stored, language);
        setStored(next);
        onStore(next);
      },
    };
    return (
      <SearchPanel
        searchManager={manager}
        annotationId="a"
        workspaceKey={key}
        layerId="phenotype"
        onSelectCandidate={vi.fn()}
        debounceMs={0}
        languages={languages}
      />
    );
  };

  it("shows no language button without loaded translations and sends no languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const input = renderPanel(searchOntology);

    expect(screen.queryByRole("button", { name: /Search languages/ })).toBeNull();
    fireEvent.change(input, { target: { value: "seizure" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect("languages" in searchOntology.mock.calls[0][0]).toBe(false);
  });

  it("shows the button in the row of the search box and sends the active languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    render(<Harness searchOntology={searchOntology} initial={["es"]} onStore={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Search languages: EN, ES" });
    const input = screen.getByLabelText(/Search ontology term/i);
    expect(button.closest(".search-language")!.parentElement).toBe(input.parentElement);

    fireEvent.change(input, { target: { value: "krampf" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].languages).toEqual(["es"]);
  });

  it("stores a deselection, repeats the pending query at once and sends the new languages", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const onStore = vi.fn();
    render(<Harness searchOntology={searchOntology} initial={undefined} onStore={onStore} />);
    const input = screen.getByLabelText(/Search ontology term/i);

    fireEvent.change(input, { target: { value: "krampf" } });
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(1));
    expect(searchOntology.mock.calls[0][0].languages).toEqual(["de", "es"]);

    fireEvent.click(screen.getByRole("button", { name: "Search languages: EN, DE, ES" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(onStore).toHaveBeenCalledWith(["es"]);
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(2));
    expect(searchOntology.mock.calls[1][0].query).toBe("krampf");
    expect(searchOntology.mock.calls[1][0].languages).toEqual(["es"]);
    expect(screen.getByRole("button", { name: "Search languages: EN, ES" })).toBeDefined();
    // The list stays open; English cannot be switched off.
    const english = screen.getByRole("checkbox", { name: "EN" }) as HTMLInputElement;
    expect(english.checked && english.disabled).toBe(true);
    expect(input.getAttribute("value")).toBe("krampf");

    // Switching the last language off still sends a selection: English only.
    fireEvent.click(screen.getByRole("checkbox", { name: "ES" }));
    await waitFor(() => expect(searchOntology).toHaveBeenCalledTimes(3));
    expect(searchOntology.mock.calls[2][0].languages).toEqual([]);
  });

  it("does not search when the selection changes while the box is empty", async () => {
    const searchOntology = vi.fn().mockResolvedValue({ search_id: "s", candidates: [] });
    const onStore = vi.fn();
    render(<Harness searchOntology={searchOntology} initial={undefined} onStore={onStore} />);

    fireEvent.click(screen.getByRole("button", { name: /Search languages/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(onStore).toHaveBeenCalledWith(["es"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(searchOntology).not.toHaveBeenCalled();
  });
});
```

In `frontend/tests/caseScreen.test.tsx`, directly before

```tsx
  it("updates clinical axes on an existing annotation", async () => {
```

add

```tsx
  it("offers the search languages of the layer's ontology and remembers the annotator's choice", async () => {
    vi.spyOn(api, "listOntologies").mockResolvedValue([
      {
        ontology_id: "hp",
        release: "2024-06-25",
        sha256: "TEST-HP-SHA",
        term_count: 11,
        translations: [
          { language: "de", filenames: ["hp-de.babelon.tsv"], term_count: 4 },
          { language: "es", filenames: ["hp-es.babelon.tsv"], term_count: 3 },
        ],
      },
    ]);
    vi.spyOn(api, "getPreferences").mockResolvedValue({
      last_annotator_id: "user-test",
      mode_by_package: {},
      search_languages_by_annotator: { "user-test": ["es"], "someone-else": ["de"] },
    });
    const store = vi.spyOn(api, "updatePreferences").mockResolvedValue({} as any);
    const search = vi.spyOn(api, "searchOntology").mockResolvedValue({ search_id: "s", candidates: [] } as any);

    render(<CaseScreen view={sampleView} workspaceId="ws-test-token" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/\+ (New Annotation|Neue Annotation)/i));

    // The stored selection of this annotator is back after loading.
    const button = await screen.findByRole("button", { name: "Search languages: EN, ES" });
    fireEvent.change(screen.getByLabelText(/Search ontology term/i), { target: { value: "Krampfanfall" } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search.mock.calls[0][0].languages).toEqual(["es"]);

    fireEvent.click(button);
    fireEvent.click(screen.getByRole("checkbox", { name: "DE" }));

    expect(store).toHaveBeenCalledWith({ search_languages_by_annotator: { "user-test": ["de", "es"] } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search.mock.calls[1][0].languages).toEqual(["de", "es"]);
    expect(search.mock.calls[1][0].query).toBe("Krampfanfall");
  });

  it("shows no language button when the ontology has no translations", async () => {
    const listed = vi.spyOn(api, "listOntologies").mockResolvedValue([
      { ontology_id: "hp", release: "2024-06-25", sha256: "test-hp-sha", term_count: 11, translations: [] },
    ]);
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "user-test", mode_by_package: {} });

    render(<CaseScreen view={sampleView} workspaceId="ws-test-token" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/\+ (New Annotation|Neue Annotation)/i));

    await waitFor(() => expect(listed).toHaveBeenCalled());
    expect(screen.getByLabelText(/Search ontology term/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Search languages/ })).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `frontend/`): `npx vitest run tests/searchState.test.ts tests/searchPanel.test.tsx tests/caseScreen.test.tsx`
Expected: 6 failed, 20 passed. The request carries no `languages` (`searchState`); the panel renders no `Search languages` button (three tests); the case screen neither shows the button nor asks for the ontologies (two tests). `shows no language button without loaded translations and sends no languages` passes already: it pins what must not change.

- [ ] **Step 3: `SearchManager` sends the languages**

In `frontend/src/editor/searchState.ts`, replace

```ts
    k = 10,
    layerId?: string | null
  ): Promise<SearchCandidate[]> {
```

with

```ts
    k = 10,
    layerId?: string | null,
    /** Translation languages to search besides English; omit to search all loaded ones. */
    languages?: string[]
  ): Promise<SearchCandidate[]> {
```

and, where the request is built, replace

```ts
        route,
        k,
      };
```

with

```ts
        route,
        k,
        ...(languages ? { languages } : {}),
      };
```

- [ ] **Step 4: `SearchPanel` shows the button, sends the selection and repeats the query when it changes**

In `frontend/src/editor/SearchPanel.tsx`, replace

```tsx
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";
```

with

```tsx
import { SearchLanguageButton } from "./SearchLanguageButton";
import type { SearchLanguageControl } from "./searchLanguages";
import { SearchManager, type SearchState, type WorkspaceKey } from "./searchState";
```

Replace

```tsx
  debounceMs?: number;
}
```

with

```tsx
  debounceMs?: number;
  /** Present when the layer's ontology has translations loaded; then the language button is shown. */
  languages?: SearchLanguageControl;
}
```

Replace

```tsx
  debounceMs = SEARCH_DEBOUNCE_MS,
}) => {
```

with

```tsx
  debounceMs = SEARCH_DEBOUNCE_MS,
  languages,
}) => {
  const languageControl = languages && languages.options.length > 0 ? languages : undefined;
  // Sent with every request when translations are loaded; English is implied.
  const requestLanguages = languageControl?.active;
```

In `runSearch`, replace

```tsx
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId);
    }, debounceMs);
  };
```

with

```tsx
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId, requestLanguages);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      void searchManager.search(val, annotationId, workspaceKey, "auto", 10, layerId, requestLanguages);
    }, debounceMs);
  };
```

In `frontend/src/editor/SearchPanel.tsx`, directly before

```tsx
  const handleQueryChange = (val: string) => {
```

add

```tsx
  // A changed language selection is a new question: ask the pending query again.
  const languagesKey = requestLanguages ? requestLanguages.join(",") : null;
  const lastLanguagesKey = useRef(languagesKey);
  useEffect(() => {
    if (lastLanguagesKey.current === languagesKey) return;
    lastLanguagesKey.current = languagesKey;
    if (queryInput.trim()) runSearch(queryInput, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languagesKey]);
```

In the row of the input, after the clear button, add the language button. Replace

```tsx
              ✕
            </button>
          )}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
```

with

```tsx
              ✕
            </button>
          )}
          {languageControl && <SearchLanguageButton control={languageControl} />}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
```

The effect runs after the render that received the new selection, so `runSearch` sends the new `requestLanguages`. It asks immediately (`true`): a click on a checkbox is not typing, and `runSearch` cancels a pending debounce timer first.

- [ ] **Step 5: Hand the control down from the case screen**

In `frontend/src/editor/AnnotationPanel.tsx`, replace

```tsx
import type { SearchManager, WorkspaceKey } from "./searchState";
```

with

```tsx
import type { SearchLanguageControl } from "./searchLanguages";
import type { SearchManager, WorkspaceKey } from "./searchState";
```

Replace

```tsx
  /** True while "+ Add Mention" mode waits for a text selection. */
  isAttachingMention?: boolean;
}
```

with

```tsx
  /** True while "+ Add Mention" mode waits for a text selection. */
  isAttachingMention?: boolean;
  /** Language selection of the term search, when the layer's ontology has translations. */
  searchLanguages?: SearchLanguageControl;
}
```

Replace

```tsx
  isAttachingMention = false,
}) => {
```

with

```tsx
  isAttachingMention = false,
  searchLanguages,
}) => {
```

Replace

```tsx
              currentTermId={currentTerm}
              onSelectCandidate={handleSelectCandidate}
            />
```

with

```tsx
              currentTermId={currentTerm}
              onSelectCandidate={handleSelectCandidate}
              languages={searchLanguages}
            />
```

In `frontend/src/app/CaseScreen.tsx`, replace

```tsx
import { SearchPanel } from "../editor/SearchPanel";
```

with

```tsx
import { useSearchLanguages } from "../editor/searchLanguages";
import { SearchPanel } from "../editor/SearchPanel";
```

Directly after

```tsx
  useEffect(() => {
    searchManager.setLayer(layerSelection.activeLayerId);
  }, [layerSelection.activeLayerId, searchManager]);
```

add

```tsx

  // Search languages: stored per annotator, offered per ontology of the layer.
  const languagesForOntology = useSearchLanguages(api, view.key.annotator_id);
  const searchLanguagesFor = (layerId: string | null | undefined) => {
    const ontologyId = (view.layers ?? []).find((layer) => layer.layer_id === layerId)?.ontology_id;
    const definition = (view.ontologies ?? []).find((item) => item.ontology_id === ontologyId);
    return languagesForOntology(definition?.sha256);
  };
```

In the `<SearchPanel …>` for a pending annotation, directly after

```tsx
                  annotationId={pendingAnnotation.annotationId} workspaceKey={view.key} layerId={pendingAnnotation.layerId}
```

add

```tsx
                  languages={searchLanguagesFor(pendingAnnotation.layerId)}
```

In the `<AnnotationPanel …>`, directly after

```tsx
              layerId={selectedAnnotation?.annotation.layer_id}
```

add

```tsx
              searchLanguages={searchLanguagesFor(selectedAnnotation?.annotation.layer_id)}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (in `frontend/`): `npx vitest run tests/searchState.test.ts tests/searchPanel.test.tsx tests/caseScreen.test.tsx && npm run typecheck && npm test`
Expected: all pass, no type errors. The case screen now asks `GET /ontologies` and `GET /preferences` once when it mounts; tests that do not mock them get a rejected request, which the hook ignores (no language button, as without translations).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/editor/searchState.ts frontend/src/editor/SearchPanel.tsx frontend/src/editor/AnnotationPanel.tsx frontend/src/app/CaseScreen.tsx frontend/tests/searchState.test.ts frontend/tests/searchPanel.test.tsx frontend/tests/caseScreen.test.tsx
git commit -m "feat(frontend): choose the search languages in the search box"
```

---

### Task 13: Bundles — `--translation TSV` for the build and for provisioning

**Files:**
- Modify: `scripts/build_common.py` (`Preload`, `validate_preload`, `apply_preload`, `ONTOLOGIES_README`)
- Modify: `scripts/build_standalone.py`, `scripts/provision_bundle.py` (option, help texts)
- Modify: `README.md`
- Test: `tests/test_bundle_preload.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_bundle_preload.py`, replace

```python
DEMO = FIXTURES / "demo_package.zip"
```

with

```python
DEMO = FIXTURES / "demo_package.zip"
DE = FIXTURES / "hp-de.babelon.tsv"
ES = FIXTURES / "hp-es.babelon.tsv"
```

Append to the file:

```python
def test_translation_option_puts_the_file_into_the_bundle(tmp_path: Path) -> None:
    args = build_standalone.parse_args(
        [
            "--ontology",
            str(HP),
            "--translation",
            str(DE),
            "--translation",
            str(ES),
            "--bundle-name",
            "study-xy",
            "--out-dir",
            str(tmp_path),
        ]
    )
    assert args.preload.translations == (DE.resolve(), ES.resolve())
    assert not args.preload.empty

    zip_path = build_standalone.prepare_portable_bundle(
        _fake_onedir(tmp_path), tmp_path, None, preload=args.preload, bundle_name="s"
    )
    with zipfile.ZipFile(zip_path) as z:
        assert z.read("s/ontologies/hp-de.babelon.tsv") == DE.read_bytes()
        assert z.read("s/ontologies/hp-es.babelon.tsv") == ES.read_bytes()
        assert z.read("s/ontologies/hp.json") == HP.read_bytes()
        readme = " ".join(z.read("s/ontologies/README.txt").decode().split())
    assert "hp-de.babelon.tsv" in readme
    assert "read from this folder on every start" in readme


def test_provisioning_adds_translations_like_a_preloaded_build(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SOURCE_DATE_EPOCH", raising=False)
    preload = build_common.Preload(ontologies=(HP,), translations=(DE,))

    built_dir = tmp_path / "built"
    built_dir.mkdir()
    built = build_standalone.prepare_portable_bundle(
        _fake_onedir(built_dir), built_dir, None, preload=preload, bundle_name="s"
    )
    plain_dir = tmp_path / "plain"
    plain_dir.mkdir()
    plain = build_standalone.prepare_portable_bundle(
        _fake_onedir(plain_dir), plain_dir, None
    )
    out_dir = tmp_path / "out"
    provision_bundle.main(
        [
            str(plain),
            "--ontology",
            str(HP),
            "--translation",
            str(DE),
            "--bundle-name",
            "s",
            "--out-dir",
            str(out_dir),
        ]
    )
    assert (out_dir / "s.zip").read_bytes() == built.read_bytes()

    # A translation alone is something to add.
    only = provision_bundle.main(
        [
            str(plain),
            "--translation",
            str(DE),
            "--bundle-name",
            "only-de",
            "--out-dir",
            str(out_dir),
        ]
    )
    with zipfile.ZipFile(only) as z:
        assert z.read("only-de/ontologies/hp-de.babelon.tsv") == DE.read_bytes()
    # Nothing at all is still refused.
    with pytest.raises(SystemExit):
        provision_bundle.main([str(plain), "--bundle-name", "empty"])


def test_translation_preloads_are_validated(tmp_path: Path) -> None:
    missing = tmp_path / "hp-fr.babelon.tsv"
    with pytest.raises(build_common.PreloadError, match="not found"):
        build_common.validate_preload(build_common.Preload(translations=(missing,)))

    misnamed = tmp_path / "german.tsv"
    misnamed.write_bytes(DE.read_bytes())
    with pytest.raises(build_common.PreloadError, match="translation file name"):
        build_common.validate_preload(build_common.Preload(translations=(misnamed,)))

    no_header = tmp_path / "hp-fr.babelon.tsv"
    no_header.write_text("term\tname\nx\ty\n", encoding="utf-8")
    with pytest.raises(build_common.PreloadError, match="subject_id"):
        build_common.validate_preload(build_common.Preload(translations=(no_header,)))

    # Readable, but without a single name for the ontology it is shipped with.
    useless = tmp_path / "x" / "hp-nl.babelon.tsv"
    useless.parent.mkdir()
    useless.write_text(
        "subject_id\ttranslation_value\nHP:9999999\tOnbekend\n", encoding="utf-8"
    )
    with pytest.raises(build_common.PreloadError, match=r"hp-nl\.babelon\.tsv"):
        build_common.validate_preload(
            build_common.Preload(ontologies=(HP,), translations=(useless,))
        )

    duplicate = tmp_path / "y" / "hp-de.babelon.tsv"
    duplicate.parent.mkdir()
    duplicate.write_bytes(DE.read_bytes())
    with pytest.raises(build_common.PreloadError, match=r"hp-de\.babelon\.tsv"):
        build_common.validate_preload(
            build_common.Preload(translations=(DE, duplicate))
        )

    assert (
        build_common.validate_preload(
            build_common.Preload(ontologies=(HP,), translations=(DE, ES))
        )
        == []
    )
    # Without its ontology the file is accepted, with a warning.
    warnings = build_common.validate_preload(build_common.Preload(translations=(DE,)))
    assert len(warnings) == 1 and "'HP'" in warnings[0]
    with pytest.raises(SystemExit):
        build_standalone.parse_args(["--translation", str(misnamed)])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_bundle_preload.py -v`
Expected: 3 failures — `unrecognized arguments: --translation` (`SystemExit: 2`, twice) and `Preload.__init__() got an unexpected keyword argument 'translations'`.

- [ ] **Step 3: Preload, validation and copying**

In `scripts/build_common.py`, replace

```python
    ontologies: tuple[Path, ...] = ()
    settings: Path | None = None

    @property
    def empty(self) -> bool:
        return not (self.packages or self.ontologies or self.settings)
```

with

```python
    ontologies: tuple[Path, ...] = ()
    settings: Path | None = None
    translations: tuple[Path, ...] = ()

    @property
    def empty(self) -> bool:
        return not (
            self.packages or self.ontologies or self.settings or self.translations
        )
```

In `validate_preload`, replace

```python
    from ontotator.ontology.service import OntologyService
    from ontotator.packages.reader import PackageReader

    warnings: list[str] = []
    _check_unique_names(preload.packages, "work package")
    _check_unique_names(preload.ontologies, "ontology")
```

with

```python
    from ontotator.ontology.service import OntologyService
    from ontotator.ontology.translations import (
        babelon_problem,
        parse_translation_name,
    )
    from ontotator.packages.reader import PackageReader

    warnings: list[str] = []
    _check_unique_names(preload.packages, "work package")
    _check_unique_names(preload.ontologies, "ontology")
    _check_unique_names(preload.translations, "translation")

    for path in preload.translations:
        if not path.is_file():
            raise PreloadError(f"Translation file not found: {path}")
        if parse_translation_name(path.name) is None:
            raise PreloadError(
                f"{path.name} is not a translation file name; expected "
                "<prefix>-<language>.<kind>.tsv, e.g. hp-de.babelon.tsv."
            )
        problem = babelon_problem(path)
        if problem is not None:
            raise PreloadError(problem)
```

and

```python
    for path in preload.ontologies:
        if path.suffix.lower() != ".json" or not path.is_file():
            raise PreloadError(f"Ontology not found or not a .json file: {path}")
        try:
            OntologyService.load(
                path, OntologyRef(release="preload", sha256=_sha256(path))
            )
        except Exception as exc:
            raise PreloadError(f"{path} is not a usable ontology: {exc}") from exc
```

with

```python
    prefixes: set[str] = set()
    for path in preload.ontologies:
        if path.suffix.lower() != ".json" or not path.is_file():
            raise PreloadError(f"Ontology not found or not a .json file: {path}")
        try:
            service = OntologyService.load(
                path,
                OntologyRef(release="preload", sha256=_sha256(path)),
                translation_paths=preload.translations,
            )
        except Exception as exc:
            raise PreloadError(f"{path} is not a usable ontology: {exc}") from exc
        prefixes.add((service.ontology.dominant_prefix or "").lower())
        for skipped in service.skipped_translations:
            raise PreloadError(
                f"Translation file {skipped.filename} cannot be used with "
                f"{path.name}: {skipped.reason}"
            )

    for path in preload.translations:
        parsed = parse_translation_name(path.name)
        if parsed is not None and parsed[0] not in prefixes:
            warnings.append(
                f"{path.name} belongs to an ontology with the prefix "
                f"'{parsed[0].upper()}', which is not one of the ontologies added "
                "here; make sure the bundle contains it."
            )
```

In `apply_preload`, replace

```python
    Produces exactly the layout of the manual steps (unzip, drop files into
    packages/ and ontologies/, add ontotator-settings.json, zip again).
```

with

```python
    Produces exactly the layout of the manual steps (unzip, drop files into
    packages/ and ontologies/ (ontologies and their translation files), add
    ontotator-settings.json, zip again).
```

and directly after

```python
    targets += [(p, bundle_dir / "ontologies" / p.name) for p in preload.ontologies]
```

add

```python
    targets += [(p, bundle_dir / "ontologies" / p.name) for p in preload.translations]
```

In `ONTOLOGIES_README`, replace

```python
workspace/ontologies and stays available even if the file here is removed.
Invalid files are skipped with a message in the console window.

"""
    + _DELIVERY_RULES
)
```

with

```python
workspace/ontologies and stays available even if the file here is removed.
Invalid files are skipped with a message in the console window.

Translation files (official babelon TSV files, e.g. hp-de.babelon.tsv and
hp-de.synonyms.tsv) placed in this folder make the terms searchable in that
language. The name decides the ontology: hp-de.* belongs to the ontology whose
term IDs start with HP. They are read from this folder on every start and are
not copied; a replaced file takes effect at the next start.

"""
    + _DELIVERY_RULES
)
```

The translation files are **not** copied into the workspace at start (unlike ontologies): the app reads them from `ontologies/` next to the executable, which Task 6 made a search folder. That is why the README text says a replaced file takes effect at the next start.

- [ ] **Step 4: The option in both scripts**

In `scripts/build_standalone.py`, replace

```python
        help="Ontology to ship in ontologies/ (registered on start; repeatable).",
    )
```

with

```python
        help="Ontology to ship in ontologies/ (registered on start; repeatable).",
    )
    parser.add_argument(
        "--translation",
        type=Path,
        action="append",
        default=[],
        metavar="TSV",
        help="Translation file (babelon TSV, e.g. hp-de.babelon.tsv) to ship in "
        "ontologies/ (read on start; repeatable).",
    )
```

Replace

```python
        ontologies=tuple(p.resolve() for p in args.ontology),
        settings=args.settings.resolve() if args.settings else None,
    )
```

with

```python
        ontologies=tuple(p.resolve() for p in args.ontology),
        settings=args.settings.resolve() if args.settings else None,
        translations=tuple(p.resolve() for p in args.translation),
    )
```

In the module docstring, replace

```python
   Optional preloads (``--package``, ``--ontology``, ``--settings``) are
   validated before the build and copied into packages/, ontologies/ and
   ontotator-settings.json; ``--bundle-name NAME`` names the ZIP and its
```

with

```python
   Optional preloads (``--package``, ``--ontology``, ``--translation``,
   ``--settings``) are validated before the build and copied into packages/,
   ontologies/ and ontotator-settings.json; ``--bundle-name NAME`` names the ZIP and its
```

In the README text of the bundle, replace

```python
  workspace/ontologies/ ontology files (.json) - auto-loaded on start
  ontologies/           ontology .json files registered on every start
```

with

```python
  workspace/ontologies/ ontology files (.json) - auto-loaded on start
  ontologies/           ontology .json files registered on every start,
                        translation files (e.g. hp-de.babelon.tsv) read on
                        every start
```

In `scripts/provision_bundle.py`, replace

```python
        help="Ontology to ship in ontologies/ (repeatable).",
    )
```

with

```python
        help="Ontology to ship in ontologies/ (repeatable).",
    )
    parser.add_argument(
        "--translation",
        type=Path,
        action="append",
        default=[],
        metavar="TSV",
        help="Translation file (babelon TSV, e.g. hp-de.babelon.tsv) to ship in "
        "ontologies/ (repeatable).",
    )
```

Replace

```python
        ontologies=tuple(p.resolve() for p in args.ontology),
        settings=args.settings.resolve() if args.settings else None,
    )
    if args.preload.empty:
        parser.error("nothing to add: give --package, --ontology and/or --settings")
```

with

```python
        ontologies=tuple(p.resolve() for p in args.ontology),
        settings=args.settings.resolve() if args.settings else None,
        translations=tuple(p.resolve() for p in args.translation),
    )
    if args.preload.empty:
        parser.error(
            "nothing to add: give --package, --ontology, --translation "
            "and/or --settings"
        )
```

In the module docstring, replace

```python
Adds work packages, ontologies and an optional ontotator-settings.json to a
copy of a portable bundle,
```

with

```python
Adds work packages, ontologies, translation files and an optional
ontotator-settings.json to a copy of a portable bundle,
```

and

```python
files into packages/ and the .json ontologies into ontologies/, add
```

with

```python
files into packages/ and the .json ontologies and .tsv translation files
into ontologies/, add
```

- [ ] **Step 5: README**

In `README.md`, in the feature list, replace the sentence

```markdown
Local in-memory exact and prefix lexical search with instant results.
```

with

```markdown
Local in-memory exact and prefix lexical search with instant results. Official HPO translation files (`hp-<language>.babelon.tsv`, `hp-<language>.synonyms.tsv`) placed next to the ontology or uploaded in the web UI make the terms searchable in that language; each annotator chooses the languages with the flag button in the search box.
```

In the section on the preconfigured distribution, replace the line

```markdown
├── ontologies/                 ← *.json registered at startup
```

with

```markdown
├── ontologies/                 ← *.json registered at startup, hp-<language>.*.tsv read at startup
```

and directly after the paragraph that ends with

```markdown
unchanged are skipped silently, so starting again is safe. Invalid files are
skipped with a message in the console; they never block the start.
```

add

```markdown

Translation files (`hp-de.babelon.tsv`, `hp-es.synonyms.tsv`, … from
[obophenotype/hpo-translations](https://github.com/obophenotype/hpo-translations))
in `ontologies/` or `workspace/ontologies/` are read at every start and belong
to the ontology whose term IDs start with the prefix in the file name. They
are not copied and not pinned by packages: replacing a file changes what the
search finds from the next start on. Ship them with `--translation FILE.tsv`
(`build_standalone.py`, `provision_bundle.py`).
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_bundle_preload.py tests/test_standalone_packaging.py -v`
Expected: all pass.

- [ ] **Step 7: Whole backend suite, lint, types**

Run: `uv run pytest -q && uv run ruff check . && uv run ruff format --check src tests scripts && uv run mypy src`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/build_common.py scripts/build_standalone.py scripts/provision_bundle.py README.md tests/test_bundle_preload.py
git commit -m "build: ship translation files in portable bundles with --translation"
```

---

### Task 14: Browser test, verification, a look at the result, embedded assets

**Files:**
- Create: `frontend/browser/translations.spec.ts`
- Regenerate: `src/ontotator/web/` (git-tracked)

- [ ] **Step 1: A browser test of the whole path**

One spec against the real backend: upload the German file on the dashboard, search in German, switch German off, come back on a fresh page.

Create `frontend/browser/translations.spec.ts`:

```ts
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { importPackage, LAUNCH_URL, openCase } from "./helpers";

const GERMAN = fileURLToPath(new URL("../../tests/fixtures/hp-de.babelon.tsv", import.meta.url));
const ANNOTATOR = "lang-tester";

const startSearch = async (page: Page, query: string) => {
  await page.getByRole("button", { name: /\+ New Annotation/i }).click();
  await page.getByLabel(/Search ontology term/i).fill(query);
};
const seizure = (page: Page) => page.locator(".candidate-card").filter({ hasText: "HP:0001250" });

// Uploading the file changes the shared test server for the specs that run
// after this one: they then search with German loaded. They pick candidates
// by term id, which German names do not change.
test("translations: upload, search in German, switch the language off, selection survives a reload", async ({ page }) => {
  await importPackage(page, "", "browser-fixture", ANNOTATOR);

  await page.locator('input[type="file"][accept=".json,.tsv"]').setInputFiles(GERMAN);
  await expect(page.getByRole("status", { name: "Import result" })).toContainText(
    "hp-de.babelon.tsv was added. HP 2026-06-23: de 4 terms.",
  );
  await expect(page.locator(".app-header")).toContainText("HP 2026-06-23 · de 4 terms");

  await openCase(page, { identity: ANNOTATOR });
  await startSearch(page, "Krampfanfall");
  await expect(page.locator(".candidate-card").first()).toContainText("Seizure");
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");

  // The flag button sits in the row of the search box.
  const button = page.getByRole("button", { name: "Search languages: EN, DE" });
  const box = await button.boundingBox();
  const input = await page.getByLabel(/Search ontology term/i).boundingBox();
  expect(box && input && box.x > input.x + input.width && Math.abs(box.y - input.y) < 4).toBeTruthy();

  await button.click();
  const list = page.getByRole("group", { name: "Search languages" });
  await expect(list.getByRole("checkbox", { name: "EN" })).toBeDisabled();
  await list.getByRole("checkbox", { name: "DE" }).uncheck();
  // The pending query is asked again at once, now without German names.
  await expect(seizure(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search languages: EN", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);

  // A fresh page: the selection comes back from the workspace preferences.
  await page.goto("about:blank");
  await page.goto(LAUNCH_URL);
  await expect(page.locator("#package-select")).toHaveValue("browser-fixture");
  await openCase(page, { identity: ANNOTATOR });
  await startSearch(page, "Krampfanfall");
  await expect(page.getByRole("button", { name: "Search languages: EN", exact: true })).toBeVisible();
  await expect(seizure(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Search languages: EN", exact: true }).click();
  await page.getByRole("group", { name: "Search languages" }).getByRole("checkbox", { name: "DE" }).check();
  await expect(seizure(page)).toContainText("Match: »Krampfanfall« (translation, de)");
});
```

The spec uploads into the test server that all browser specs share, so `workflow.spec.ts`, which runs after it, searches with German loaded. Those specs pick candidates by term id (`HP:0001252`), which German names do not change.

- [ ] **Step 2: All checks**

Run (in `frontend/`): `npm run typecheck && npm test && npm run api:check && npm run build && npx playwright test`
Run (repo root): `uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run python scripts/export_openapi.py --check`
Expected: everything passes, with one known exception: `ruff format --check .` reports `docs/work-package-v2.md`, which fails before this plan. Nothing else may be reported; in particular this plan file itself passes.

If `translations.spec.ts` fails at `HP 2026-06-23: de 4 terms`, the fixture file was changed; recreate it (Task 1, Step 1). If another browser spec fails because it picked a candidate by position, change it to pick by term id; do not change the search.

- [ ] **Step 3: Look at it**

Save this as `frontend/browser/zz-shots.spec.ts` (delete it afterwards, do not commit it):

```ts
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { importPackage, openCase } from "./helpers";

const fixture = (name: string) => fileURLToPath(new URL(`../../tests/fixtures/${name}`, import.meta.url));
// A directory outside the repository, e.g. SHOTS_DIR=C:/Users/<you>/AppData/Local/Temp/term-search-2
const OUT = process.env.SHOTS_DIR!;

test("screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await importPackage(page, "", "browser-fixture", "shots");
  const upload = page.locator('input[type="file"][accept=".json,.tsv"]');
  await upload.setInputFiles(fixture("hp-de.babelon.tsv"));
  await page.getByText(/hp-de.babelon.tsv was added/).waitFor();
  await upload.setInputFiles(fixture("hp-es.babelon.tsv"));
  await page.getByText(/hp-es.babelon.tsv was added/).waitFor();
  await page.screenshot({ path: `${OUT}/1-dashboard.png` });

  await openCase(page, { identity: "shots" });
  await page.getByRole("button", { name: /\+ New Annotation/i }).click();
  await page.screenshot({ path: `${OUT}/2-empty-panel.png` });
  await page.getByLabel(/Search ontology term/i).fill("Krampfanfall");
  await page.locator(".candidate-card").first().waitFor();
  await page.screenshot({ path: `${OUT}/3-german-query.png` });
  await page.getByRole("button", { name: /Search languages/ }).click();
  await page.screenshot({ path: `${OUT}/4-list-open.png` });
  await page.getByRole("checkbox", { name: "DE" }).uncheck();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/5-german-off.png` });
  await page.locator(".search-panel").screenshot({ path: `${OUT}/6-panel-closeup.png` });
});
```

Run (in `frontend/`, Git Bash): `SHOTS_DIR="$(cygpath -m "$TEMP")/term-search-2" npx playwright test browser/zz-shots.spec.ts`
Look at each of the six images:

1. Dashboard: the header reads `Ontologies: HP 2026-06-23 · de 4 · es 3 terms, MONDO` on one line, the button reads `Add ontology (.json) or translation (.tsv)`, a green notice names the uploaded file.
2. Empty search panel: one input, to its right a small button with three flags (United Kingdom, Germany, Spain), in the same row; one hint line below. No extra row, no gap.
3. Query `Krampfanfall`: Seizure is the first card with `Match: »Krampfanfall« (translation, de)`.
4. List open: three entries with checkbox, flag and code (EN greyed out and checked, DE, ES), right-aligned under the button, above the cards.
5. German off: the button shows two flags (United Kingdom, Spain), Seizure is gone from the cards, the list is still open.
6. Close-up: the flags are sharp, 16 px wide, with a thin outline (the white of a flag must not disappear into the button).

Delete `frontend/browser/zz-shots.spec.ts`. Run `git status --short` and make sure it is gone.

- [ ] **Step 4: Commit the browser test**

```bash
git add frontend/browser/translations.spec.ts
git commit -m "test: search in German, switch the language off and find the selection again after a reload"
```

- [ ] **Step 5: Rebuild the embedded web assets and commit**

```bash
uv run python -c "import sys; sys.path.insert(0, 'scripts'); from build_common import build_frontend, sync_embedded_web_assets; sync_embedded_web_assets(build_frontend(npm_ci=False))"
git add src/ontotator/web
git commit -m "build: rebuild embedded web assets"
```

Expected: `src/ontotator/web/assets/` holds one new `.js` and one new `.css` file and no `.svg` file (the flags are inlined).

- [ ] **Step 6: Report**

Branch and commits, the actual numbers from Step 2, every deviation from this plan (what, where, why), what the screenshots show including anything that looks off, and the screenshot paths. Do not merge or push.

---

## Notes for the implementer

- **Numbers at the end.** When this plan was written, the final state had 460 pytest tests, 260 Vitest tests and 24 Playwright tests, all passing.
- **Why the language filter sits inside the index search.** `LexicalIndex.search` returns one row per term: its best-scoring name. If German is switched off and the best name of a term is German, dropping that row loses the term although an English name of it matched too. `LanguageLexicalIndex` therefore sets the scores of the excluded rows to zero first and only then picks the best name per term. `test_a_term_stays_findable_through_an_allowed_name` fails for a filter that works on the finished list, and for a filter that is not applied at all.
- **Seed.** Annotator, annotation, normalised query and `k` as before. With at least one active translation language, the sorted language codes are hashed in on top. Without one, the seed is exactly the old one, so nothing changes for installations without translation files and for annotators who search in English only.
- **Index identity.** Only files that contributed names count, by content (SHA-256), in sorted order. The file name and the folder do not matter; neither does the language selection of a request.
- **Which language a name has.** The vendored loader takes it from the column `translation_language`, and from the file name only when the column is missing. The file name always decides the ontology (its prefix).
- **Reloading does not parse the ontology file again.** `OntologyService.with_translations` copies the loaded terms without their translated names and builds a new index. That is why an upload also works for ontologies that a package brought along, which have no file on disk.
- **An upload is all or nothing.** The file is staged in a hidden folder under its real name, the affected ontologies are rebuilt with it in memory, and only if that worked is the file moved into place and the new services published together. Searches running meanwhile use the old services.
- **Translations are not pinned.** Packages pin the ontology by SHA-256, nothing else. A replaced translation file changes what a search finds; that is visible afterwards because every search event stores the index identity and the languages.
- **Old application versions.** `SearchEventRecord` forbids unknown fields, so a version of the app from before this change cannot read a package that contains events with `languages`. Reading old packages with the new version works (`test_search_event_keeps_languages_and_reads_old_events`). `preferences.json` is read leniently by old versions (unknown keys are ignored).
- **Part 3 (tree)** can read the translated names of a term from `service.ontology.terms[term_id].translations` (language → names).

## Decisions the spec left open

1. **Who matches files to ontologies.** The spec lets the registry pass "the matching files". The prefix of an ontology is only known after parsing, so the registry passes every translation file and `OntologyService` keeps those with its prefix.
2. **File names.** `<prefix>-<language>.<anything>.tsv` with a two-letter language, compared in lower case; `hp-de.tsv` without a middle part is accepted too. An upload is stored under the lower-cased name.
3. **Same name in two folders.** The first folder wins: `<workspace>/ontologies` before `ontologies/` next to the executable.
4. **Folders on the command line.** Besides the two folders of the spec, `--provision-dir <dir>` makes `<dir>/ontologies` a folder for translation files (for a frozen bundle this is the same folder as "next to the executable").
5. **`translations` in `GET /ontologies`.** One entry per language with `filenames` (a list) and `term_count`, not one entry per file: the dashboard, the tooltip and the selector all work per language, and two files of one language (`babelon`, `synonyms`) share one count.
6. **Order of exact matches on translated names.** After the English exact matches, by language code, then term id; `match_kind` is `translation`. The babelon loader does not keep whether a translated name was a label or a synonym, so "label before synonym" cannot be applied to them.
7. **Explicit legacy routes.** `lexical` honours `languages` (it searches the same shared index). `exact` stays as it was, English names and prefix fallback only; the interface no longer uses it. `id` and `browse` have nothing to filter.
8. **`languages` in the result and the event.** The languages that were searched, `"en"` first, for every route. Events from before this change have an empty list.
9. **Seed without an active translation language.** Unchanged from Part 1 (see the note above), instead of a new seed for everyone.
10. **Index identity.** A new key `translation_sha256` (sorted list), present only when at least one file contributed names. Files that were skipped do not count.
11. **Answer to a `.tsv` upload.** A second response shape, `TranslationUploadInfo` (`filename`, `language`, `assigned`, `message`, `ontologies`), on the same endpoint. The dashboard shows `message` as a notice.
12. **A `.tsv` for which no ontology is loaded.** Only the header can be checked (`subject_id`); "no usable row" needs an ontology and is checked when one with that prefix is loaded (then the file is skipped with a notice).
13. **Limits and status codes of the upload.** 64 MiB; 400 for an unusable file or name; 500 when the rebuild itself fails, with nothing stored.
14. **How the ontology is "reloaded".** Rebuilt from the loaded terms, not parsed again from disk.
15. **Bundles.** Translation files in `ontologies/` of a bundle are read in place at every start; they are not copied into the workspace and not recorded in `provisioning.json`. `--translation` rejects a file that is unusable for an ontology added with it and warns when no ontology with that prefix is added.
16. **Preferences.** Codes are 2 to 8 ASCII letters, lower-cased, at most 32 per annotator; an update replaces the selection of the annotators it names and keeps the others. An empty list is a valid selection (English only) and differs from "never chose".
17. **One selection per annotator, not per ontology.** As in the spec's field `search_languages_by_annotator`. Switching a language keeps stored codes that are not loaded for the current ontology.
18. **What the interface sends.** With translations loaded, always the explicit list of active languages (also when all are active); without translations, no `languages` field.
19. **`+n` on the button.** English counts as a language: with English and three or more translation languages active, the button shows three flags and `+n`.
20. **The entry for English.** Checked and disabled; its tooltip says that the ontology's own names are always searched (there is no term count to show).
21. **Dashboard text.** The ontology id as today (`HP`, not `HPO`), a plain space as thousands separator, the badge does not wrap; ontologies without translations are shown as before.
22. **Upload control.** The existing header button, relabelled `Add ontology (.json) or translation (.tsv)`. The "Missing ontology" prompt keeps accepting `.json` only.
23. **Flags.** Five SVG files under `frontend/src/editor/flags/`, imported as modules and inlined by Vite. A language without a file shows its code in capitals.
24. **Notices at start.** Through `logging` at warning level, which reaches the console window like the existing "Could not load ontology" notice.
25. **Browser test.** It uploads into the test server shared by all browser specs; the specs that run after it search with German loaded.
26. **This file.** It carries `<!-- fmt: off -->` so that `ruff format` leaves the code blocks, which are exact file text, alone.
