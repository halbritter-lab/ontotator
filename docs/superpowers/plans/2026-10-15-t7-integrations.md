# T7: Integration Interfaces Implementation Plan

> **Status (2026-10-15): parked.** No part of the core roadmap depends on T7. The plan is picked up when a concrete need appears, e.g. the first consumer reading a release. Q33 is resolved and moved into T3a (see there); Q34 stays open until T7 resumes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Lean format: files, interfaces, tables, test cases and acceptance criteria per task. Implementers write the code test-first; code appears only where it defines a contract.

**Goal:**
- Converter authors get one tested mapping from offsets on a raw text to offsets on its canonical text (`ontospan.offsets`, I6), plus conformance fixtures for import bundles, release bundles and offsets.
- Any consumer reads a release with one shared reader (`ontospan.release`) or with the JSON Schemas alone, and resolves its lineage inside the bundle (I5, I8).
- Ontocurator closes the gaps that remain between the T7 spec and the T2–T4 plans. These are: which sets an import may carry, the producer block of import bundles, proposal sets for finished documents, and a contract test between the two implementations.
- Adapters in consumer repositories (Phentrieve, phentrieve-benchmark) are listed as separate tasks. They are not Ontocurator work.

**What this plan does not repeat.** Most T7 requirements are already tasks in the T2–T4 plans (T3/T5/T4 index, "T7 alignment"):

| Requirement | Already planned in |
|---|---|
| O1, O2, I1, I3, I9 (ids kept, empty sets, tool provenance, audited bundle id and manifest hash) | T2d Tasks 1 and 4 (patch); T3a Task 6 |
| O4 (`contiguous_mentions_only`, hidden axis values) | T3a Task 5 |
| I3 display (tool, version, model, run id, notes) | T3b Task 10 |
| I2 (variants, translation status, the lead's override) | T5 Task 3 |
| O3, O5, O7 (lineage, assisted first round, late sets) | T4a Tasks 5–8, 13, 14 |
| O6, I5, I7 (release content, `release` block, `admin export-release`) | T4b Tasks 8 and 9 |
| I10 (API round trip, `scripts/check_integration_roundtrip.py`) | T4b Task 14 |
| I7 format part (manifest `release` block) | ontospan format 1.1, merged as `4105ec1` (PR #2) |

T7b (CLI import of documents and proposals) has nothing left. It is the T2d Task 4 patch.

**Architecture:**
- **Part A, ontospan (T7a):** two new modules, `offsets.py` and `release.py`, and the fixture set `conformance/integration/`. The schema is unchanged (`SCHEMA_VERSION` stays `1.1.0`); the package becomes `1.2.0` (Q36).
- **Part B, Ontocurator (T7c–T7e):** small additions to the import planner (T3a), the import of bundles with a `release` block (T5), proposal sets for finished documents (T4a), the release job's read-back (T4b), and a contract test against vendored ontospan fixtures. It ends with a guide for tool authors.
- **Part C, consumer repositories:** a release reader in Phentrieve, and the exporter and importer in phentrieve-benchmark. Each is planned in detail in its own repository.

**Spec:** `docs/superpowers/specs/2026-10-14-t7-integrations-design.md` (I1–I10, O1–O7; binding). Roadmap E4–E8: `…-roadmap-web-service-analysis.md`. Indexes: `2026-10-14-t2-index.md` (R1, R2, Q1–Q14, D-a…D-n) and `2026-10-14-t3-t5-t4-index.md` (shared contracts, U1–U5, D-o…D-ab, Q15–Q32). Format: `janpower/ontospan` `main` at `4105ec1` (format 1.1).

## Dependencies and where each task lands

| Task | Needs | Repository and branch |
|---|---|---|
| 1–5 (Part A) | T1 only (ontospan `main` `4105ec1`). It can start now, in parallel to T2. | ontospan, `feat/offsets-integration` from `main`, worktree `../ontospan/.worktrees/offsets-integration` |
| 6 | T3a Task 6 (`read_t1_upload`, `plan_import`) | Ontocurator, `feat/t3a-admin-backend`, right after T3a Task 6 |
| 7 | T5 Task 3 (ontospan 1.1 pin, variant import) | Ontocurator, `feat/t5-variants-review`, right after T5 Task 3 |
| 8 | T4a Tasks 8 and 9 (late sets, `reopen_to`) | Ontocurator, `feat/t4a-workflows`, right after T4a Task 9 |
| 9–10 | T4b (release job, Task 14 round trip) and Part A merged on ontospan `main` | Ontocurator, `feat/t7-integration-contract` from `feat/t4b-adjudication-releases`, worktree `.worktrees/t7-integration-contract` |
| 11 | Part A merged; a release from Task 9 as a sample | Phentrieve (separate repository) |
| 12–13 | Part A merged; Ontocurator after T3a (import) and T4b (releases) | phentrieve-benchmark (separate repository) |

- **T1:** Part A extends ontospan and changes no format rule. Parts B and C depend on Part A only from Task 9 on.
- **T2:** T2d's import (Task 4 patch) is the base for Tasks 6 and 7. T2e's dev compose stack runs the round-trip script (Task 10).
- **T3:** Task 6 extends T3a's planner; Tasks 7 and 8 add preview fields that T3b's preview page shows.
- **Note for the coordinator:** the ontospan half of T5 Task 1 is already merged (`4105ec1`). T2d can pin `4105ec1` directly instead of `263368b`; T5 Task 1 then shrinks to its re-pin check.
- Tasks 6–8 run on the branches of the plans they extend, because T3a, T5 and T4a have not started yet (D-ah). The coordinator adds them to those plans' task lists. If a plan has already been merged when its T7 task is due, the task runs on `feat/t7-integration-contract` before Task 9 instead.

**Commit rules:**
- ontospan, per task: `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q`, then one conventional commit.
- Ontocurator, per task: `uv run ruff check --fix src tests && uv run ruff format src tests && uv run mypy src`, then one conventional commit. After API changes: `uv run python scripts/export_openapi.py && npm --prefix frontend run api:generate`.
- No AI attribution and no `Co-Authored-By` trailers anywhere. Nothing is pushed or merged without the user's confirmation.

## Technical decisions (with rationale)

| # | Decision | Rationale |
|---|---|---|
| D-ac | The offset map is built from **runs** (I6). A raw offset maps if it lies on a run boundary or inside a run that canonicalisation left unchanged. Inside a changed run it is `offset_inside_normalization` (Q39). | Mapping is positional and exact. No snapping and no guessing (I6). |
| D-ad | `OffsetError` subclasses `ontospan.FormatError` and carries exactly one `Issue` (code, path `raw[start:end]`, message). | Converters already handle `FormatError`. They report offset problems with codes just like validation issues. |
| D-ae | Fixtures are **directory bundles** (`manifest.json`, `documents/*.json`). `tests/integration_cases.py` writes them, and a test compares them byte for byte, as `tests/conformance_cases.py` does. | They are diffable in review, and line endings are protected by ontospan's `*.json text eol=lf`. |
| D-af | The release reader resolves a reference by `(annotation_set_id, annotation_id)` among the units with the same `document_id` and `text_sha256`. The bundle component of the URN is ignored. | This is the rule of T4b's builder ("Lineage check"). Set ids are unique within a bundle (`duplicate_annotation_set`), and T1 F3 links the sets of a release by identical `text_sha256`. |
| D-ag | Ontocurator's release job reads its bundle back with `ontospan.read_release`, in addition to the builder's own `RELEASE_LINEAGE_BROKEN` check. | The format's lineage rules then have one implementation that every consumer also runs (E7 principle "one definition"). |
| D-ah | Tasks 6–8 land on the T3a, T5 and T4a branches. | These plans have not started yet. Each change is small and touches files those plans create. Doing it later would mean a second pass over the same code. |

---

## Part A: ontospan (Tasks 1–5)

Set up: `git -C ../ontospan worktree add .worktrees/offsets-integration -b feat/offsets-integration main`, then `uv sync` in the worktree. Baseline: `uv run pytest -q`.

### Task 1: Offset map construction (`ontospan.offsets`)

**Create** `src/ontospan/offsets.py`, `tests/test_offsets.py`. **Modify** `src/ontospan/__init__.py` (export `canonicalize_with_offsets`, `OffsetMap`, `OffsetError`), `tests/test_package.py` (public names).

**Contract:**

```python
class OffsetError(FormatError):
    """A raw offset or span that cannot be mapped; ``.code`` is the issue code."""

    code: str


@dataclass(frozen=True)
class OffsetMap:
    canonical: str
    identity: bool  # canonical_text(raw) == raw

    def position(self, raw_offset: int) -> int: ...  # Task 2
    def span(
        self, raw_start: int, raw_end: int, *, snippet: str | None = None
    ) -> tuple[int, int]: ...
    def span_utf16(
        self, u16_start: int, u16_end: int, *, snippet: str | None = None
    ) -> tuple[int, int]: ...
    def segment(
        self,
        raw_start: int,
        raw_end: int,
        *,
        snippet: str | None = None,
        utf16: bool = False,
    ) -> Segment: ...  # ontospan.segment(canonical, …)


def canonicalize_with_offsets(raw: str) -> tuple[str, OffsetMap]: ...
```

**Run rules** (in this order; the result must equal `canonical_text(raw)`):
1. A raw text that contains a surrogate code point is refused with `invalid_unicode` (the existing validation code).
2. **Fast path:** if `canonical_text(raw) == raw`, the map is the identity, with one unchanged run.
3. **Leading BOMs:** every U+FEFF at the start is its own run with an empty canonical piece. This matches `canonical_text`'s `lstrip(BOM)`. A BOM later in the text is an ordinary code point.
4. **Line ends:** `\r\n` is one run with the piece `\n`. A lone `\r` is one run with the piece `\n`.
5. **Other code points:** a new run starts at code point `c` if `unicodedata.combining(c) == 0` and `c` does not compose with the last code point of the **normalised** current run, i.e. `len(NFC(piece[-1] + c)) == 2`. Otherwise `c` joins the current run. Comparing with the normalised tail keeps Hangul L+V+T in one run.
6. Each run's piece is `NFC(run)`, with rule 4 applied first. A run is **changed** if its piece differs from its raw text.
7. If the concatenated pieces differ from `canonical_text(raw)`, raise `OffsetError("offset_map_inconsistent")`. This is a bug guard, and the exhaustive test below must never reach it.

The map stores the run boundaries as two sorted tuples (raw and canonical starts) plus a changed flag per run. `position` uses `bisect`.

**Tests (`tests/test_offsets.py`):**
- `test_canonical_text_returns_an_identity_map`: `identity is True`; `position(i) == i` for every `i`.
- `test_crlf_and_lone_cr_become_lf_runs`: `"a\r\nb\rc"` gives canonical `"a\nb\nc"` and two changed runs.
- `test_leading_boms_are_deletions_and_inner_boms_stay`: `"﻿﻿ab﻿c"` gives `"ab﻿c"`.
- `test_combining_sequences_compose_within_one_run`: `"é"` gives `"é"` as one changed run of raw length 2.
- `test_hangul_jamo_compose_across_l_v_t`: `"각"` gives one syllable as one run.
- `test_reordered_combining_marks_are_a_changed_run`: `"x̣́"` gives `"x̣́"`. The lengths are equal, but the run is changed (Q39).
- `test_singletons_are_changed_runs_of_length_one`: U+212B ANGSTROM SIGN becomes U+00C5.
- `test_astral_characters_are_single_code_points`: `"😀a"` is the identity.
- `test_lone_surrogates_are_refused`: `invalid_unicode`.
- `test_runs_concatenate_to_canonical_text_exhaustively`: every string of length 1–4 over the alphabet `a`, `e`, `x`, U+0301, U+0323, `\r`, `\n`, U+1100, U+1161, U+11A8, U+212B and U+FEFF (about 23 000 strings). `canonicalize_with_offsets(s)[0] == canonical_text(s)`, and no `offset_map_inconsistent` is raised.

**Steps:**
- [ ] Write the tests. Run `uv run pytest tests/test_offsets.py -q`; they fail (missing module).
- [ ] Implement rules 1–7; keep the module free of I/O.
- [ ] Run `uv run pytest tests/test_offsets.py -q` until it passes (the exhaustive test under 10 s), then `uv run pytest -q`.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_offsets.py tests/test_package.py -q` passes. Commit: `feat: offset map from raw text to canonical text`.

---

### Task 2: Span mapping, UTF-16 input and the snippet check

**Modify** `src/ontospan/offsets.py`, `tests/test_offsets.py`.

**Mapping rules:**
- `position(o)`: `0 <= o <= len(raw)`, else `offset_out_of_range`. If `o` is a run start, the result is that run's canonical start; `len(raw)` maps to `len(canonical)`. Inside an unchanged run the offset maps positionally. Inside a changed run it is `offset_inside_normalization`.
- `span(s, e)`: `s < e`, else `offset_out_of_range`. Both ends are mapped with `position`. A mapped span with `start == end` is `span_empty` (for example a span that covers only a leading BOM).
- `span_utf16(s16, e16)`: UTF-16 code unit offsets on the **raw** text (XMI, JavaScript). They are converted to code points first. An offset between a high and a low surrogate is `offset_inside_surrogate_pair`. An offset beyond the UTF-16 length is `offset_out_of_range`.
- `snippet`: if given, `canonical_text(snippet)` must equal `canonical[start:end]`, else `snippet_mismatch` (I6 self-check).
- `segment(...)` returns `ontospan.segment(canonical, start, end)`, so the segment text always quotes the canonical text.

**Codes (contract, listed in the README):**

| Code | Raised by |
|---|---|
| `invalid_unicode` | `canonicalize_with_offsets` |
| `offset_map_inconsistent` | `canonicalize_with_offsets` (bug guard) |
| `offset_out_of_range` | `position`, `span`, `span_utf16` |
| `offset_inside_normalization` | `position`, `span`, `span_utf16` |
| `offset_inside_surrogate_pair` | `span_utf16` |
| `span_empty` | `span`, `span_utf16` |
| `snippet_mismatch` | `span`, `span_utf16`, `segment` |

**Tests (`tests/test_offsets.py`):**
- `test_boundaries_map_through_deleted_and_shortened_runs`: parametrised. BOM: raw `(1, 3)` gives `(0, 2)`. CRLF: in `"ab\r\ncd"`, raw `(4, 6)` gives `(3, 5)`. Combining: in `"Café au lait"`, raw `(0, 5)` gives `(0, 4)`.
- `test_offsets_inside_a_changed_run_are_refused`: three cases with code `offset_inside_normalization`: between `\r` and `\n`; between `e` and U+0301; between L and V jamo.
- `test_offsets_inside_an_unchanged_run_map_positionally`: `"x́"` (no precomposed form) maps the offset 1 to 1.
- `test_out_of_range_and_reversed_spans_are_refused`.
- `test_a_span_that_only_covers_a_deleted_bom_is_empty`: `span_empty`.
- `test_utf16_offsets_count_surrogate_pairs`: in `"😀 Krampf"`, UTF-16 `(3, 9)` gives code points `(2, 8)`.
- `test_a_utf16_offset_inside_a_surrogate_pair_is_refused`.
- `test_a_matching_snippet_passes_and_a_wrong_one_is_reported`: a CRLF snippet matches its canonical LF slice; a different snippet gives `snippet_mismatch`.
- `test_segment_quotes_the_canonical_text`.
- `test_offset_errors_are_format_errors_with_one_code`: `isinstance(err, FormatError)`, `len(err.report.issues) == 1`, `err.code == err.report.issues[0].code`.
- `test_mapped_spans_quote_the_normalised_raw_slice_exhaustively`: over the Task 1 alphabet without BOM, for every `0 <= s < e <= len(raw)`. If the mapping succeeds, `canonical[ms:me] == NFC(raw[s:e] with CRLF/CR → LF)`. If it fails, the code is `offset_inside_normalization` or `span_empty`.

**Steps:**
- [ ] Write the tests. Run `uv run pytest tests/test_offsets.py -q`; the new ones fail.
- [ ] Implement `position`, `span`, `span_utf16`, `segment` and the snippet check.
- [ ] Run `uv run pytest tests/test_offsets.py -q` until it passes, then `uv run pytest -q`.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_offsets.py -q` passes. Commit: `feat: span mapping with UTF-16 input and a snippet check`.

---

### Task 3: Release reader (`ontospan.release`)

> **Open question Q37 (technical):** should ontospan offer a public release reader, or only document the recipe in the README? Default: a small public module. Phentrieve, the benchmark and Ontocurator's release job need exactly the same lineage rules (E7 "one definition"), and the README recipe would still need a tested reference.

**Create** `src/ontospan/release.py`, `tests/test_release.py`. **Modify** `src/ontospan/__init__.py` (export `ReleaseView`, `read_release`, `check_lineage`), `tests/test_package.py`.

**Contract:**

```python
@dataclass(frozen=True)
class ReleaseView:
    manifest: Manifest
    units: tuple[AnnotatedDocument, ...]

    def finals(
        self,
    ) -> list[AnnotatedDocument]: ...  # set_kind "release", in bundle order
    def sets_for(
        self, unit: AnnotatedDocument
    ) -> list[AnnotatedDocument]: ...  # same document_id and text_sha256
    def resolve(
        self, unit: AnnotatedDocument, ref: str
    ) -> tuple[AnnotatedDocument, Annotation] | None: ...
    def origins(
        self,
        unit: AnnotatedDocument,
        annotation: Annotation,
        *,
        set_kind: SetKind | None = None,
    ) -> list[tuple[AnnotatedDocument, Annotation]]:
        ...
        # transitive over source_refs (breadth first, each annotation once); optionally filtered by set kind


def check_lineage(units: Sequence[AnnotatedDocument]) -> ValidationReport: ...
def read_release(
    path: Path,
    ontologies: Mapping[str, OntologyView] | None = None,
    *,
    report: ValidationReport | None = None,
) -> ReleaseView:
    ...
    # read_bundle + the release rules below; raises FormatError on any error
```

**Rules (codes are the contract):**

| Rule | Code | Where |
|---|---|---|
| A `source_refs` entry of an annotation in a set **other than** `tool_output` resolves inside the bundle (D-af). `tool_output` references may point outside, e.g. to the producer's own inputs. | `lineage_unresolved` | `check_lineage` |
| Following `source_refs` never returns to the starting annotation | `lineage_cycle` | `check_lineage` |
| The manifest has a `release` block | `release_block_missing` | `read_release` |
| Each document variant (`document_id`, `text_sha256`) in the bundle has exactly one `release` set | `release_final_missing`, `release_final_duplicate` | `read_release` |

Issue paths name the file and annotation, e.g. `documents/00003.json:a7`.

**Tests (`tests/test_release.py`):** the units are built with `tests/builders.py`. One document has a `tool_output` set, two `individual` sets, an `adjudicated` set and a `release` set; a second document has a `stage_result` and a `release` set.
- `test_finals_are_the_release_sets_in_bundle_order`.
- `test_references_resolve_within_the_same_document_text`: a reference to an equal set id on another document does not resolve.
- `test_the_bundle_component_of_a_reference_is_ignored`.
- `test_origins_follow_source_refs_transitively`: with `set_kind="tool_output"`, the release annotation reaches the proposal through the adjudicated and individual annotations.
- `test_tool_output_references_are_not_checked`.
- `test_an_unresolved_reference_is_an_error` (`lineage_unresolved` with the path).
- `test_a_cycle_is_an_error` (`lineage_cycle`).
- `test_a_document_without_or_with_two_final_sets_is_an_error` (two cases).
- `test_read_release_needs_the_release_block`.
- `test_read_release_passes_bundle_warnings_to_the_report`: a `newer_minor` warning arrives in the `report=` sink.

**Steps:**
- [ ] Write the tests. Run `uv run pytest tests/test_release.py -q`; they fail.
- [ ] Implement `check_lineage` first (pure over units), then `ReleaseView`, then `read_release` on top of `read_bundle`.
- [ ] Run `uv run pytest tests/test_release.py -q` until it passes, then `uv run pytest -q`.
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_release.py tests/test_package.py -q` passes. Commit: `feat: release reader with lineage resolution`.

---

### Task 4: Integration fixtures (`conformance/integration/`)

**Create** `tests/integration_cases.py` (generator and expectations, as `tests/conformance_cases.py`), `tests/test_integration_fixtures.py`, and the generated files below. **Modify** `tests/builders.py` only if a helper is missing.

**Generated content** (`uv run python tests/integration_cases.py`; fixed `created_at`; the texts are `SOURCE_TEXT`, its German translation `TEXT`, and a second English text). The fixtures use no modifiers, so every current consumer can import them (Ontocurator refuses modifiers, T2 Q11).

| Path | Content |
|---|---|
| `conformance/integration/import/` | A bundle from a fictitious tool. Its manifest has `release = {name: "example-run-7", producer: {name: "example-tool", version: "2.0"}}` (I7: import bundles may fill `producer`). Three units: `case-1` English native, with a `tool_output` set (tool actor with `name`, `version`, `model`, `run_id`; three annotations, one with a discontinuous mention, one axis with `basis: "defaulted"`, a `provenance.notes` entry); `case-1` German `machine_translation` (`derived_from` = the English text hash, two passed checks) with an empty set (O2); `case-2` English native with an empty set. |
| `conformance/integration/release/` | The matching release. Its manifest has `release = {name: "Gold v1", description, project_id: "example-project", producer: {name: "example-curator", version: "1.0"}, supersedes: []}`, plus one contributor with name and the ORCID example id `0000-0002-1825-0097`. For `case-1` English it contains the `tool_output` set exactly as imported; two `individual` sets (`ann-0001` adopted one proposal with `source_refs` = its URN with the import bundle id, and `ann-0002` annotated manually); an `adjudicated` set (`merged` and `adopted`, `source_refs` to the individual annotations plus the imported origins); and the `release` set (`adopted`, `source_refs` = the adjudicated annotation plus the imported origins, O3). |
| `conformance/integration/offsets.json` | `{"cases": [{"name", "raw", "spans": [{"unit": "code_point" \| "utf16", "start", "end", "snippet"?, "expected": [start, end]} \| {…, "error": code}]}]}`. About 12 cases from Task 2, for converters in other languages. |

**Tests (`tests/test_integration_fixtures.py`):**
- `test_the_committed_integration_fixtures_are_up_to_date`: generate into `tmp_path`; compare every file byte for byte with the committed tree, and fail on extra or missing files.
- `test_the_import_bundle_reads_with_the_ontology`: `read_bundle` with `tests/fixtures/hp-mini.json` gives no errors; 3 units; exactly one non-empty set, of kind `tool_output`, whose tool actor has `name` and `version`.
- `test_the_release_bundle_reads_as_a_release`: `read_release` passes. Set kinds for `case-1` are `{release, adjudicated, individual ×2, tool_output}`. Every release annotation's `origins(set_kind="tool_output")` names annotation ids of the import bundle. The `tool_output` set equals the import's set field by field.
- `test_every_fixture_file_validates_against_the_json_schemas_alone`: only `jsonschema` and the files in `src/ontospan/schema/` are used. `manifest.json` is checked against `bundle-manifest-1.1.json`, every document against `annotated-document-1.1.json`, and every `hpo-phenotype` annotation against `hpo-phenotype-annotation-1.1.json`. This is the I8 consumer path.
- `test_offset_cases_match_the_helper`: every case in `offsets.json` gives the expected span or code.

**Steps:**
- [ ] Write the tests. Run `uv run pytest tests/test_integration_fixtures.py -q`; they fail (no fixtures).
- [ ] Write the generator and run `uv run python tests/integration_cases.py`.
- [ ] Run `uv run pytest tests/test_integration_fixtures.py -q` until it passes, then `uv run pytest -q`.
- [ ] Check `git diff --stat` shows LF-only JSON (`git ls-files --eol conformance/integration`).
- [ ] Apply the commit rule and commit.

**Acceptance:** `uv run pytest tests/test_integration_fixtures.py -q` passes. Commit: `test: integration fixtures for import, release and offset mapping`.

---

### Task 5: Documentation, version 1.2.0 and the merge gate

> **Open question Q36 (technical):** which package version? Default: package `1.2.0`, `SCHEMA_VERSION` stays `1.1.0`. The package adds public API (minor in SemVer), the format does not change (I6), and the two numbers are already separate in `_version.py`.

**Modify** `src/ontospan/_version.py` (`__version__ = "1.2.0"`), `pyproject.toml`, `tests/test_package.py` (`__version__ == "1.2.0"`, `SCHEMA_VERSION == "1.1.0"`), `CHANGELOG.md` (section 1.2.0: new modules, codes, fixtures; "no format change"), `README.md`:
- **"Offsets for converters":** the I6 example, the run rule in two sentences, the code table of Task 2, and "report, do not snap".
- **"Reading a release":** pick `finals()`; resolve lineage with `origins()`; sets are linked by `text_sha256`; human actors are pseudonyms; `contributors` holds only consenting names; variants are separate units; `release.supersedes` names the corrected release by bundle id and manifest hash; verify the manifest hash against the producer's record.
- **"Without the Python package":** the JSON Schemas plus `conformance/` are the contract (I8). The release rules of Task 3 are plain enough to re-implement, and `conformance/integration/release/` is the test case.
- **Versions:** the package version and `schema_version` are independent; 1.2.0 carries format 1.1.

**Gate:**

```bash
uv run python -m ontospan.schema_export --check
uv run ruff check . && uv run ruff format --check . && uv run mypy src
uv run pytest -q
uv build && uv run --isolated --with dist/ontospan-1.2.0-py3-none-any.whl python -c "import ontospan; from ontospan import canonicalize_with_offsets, read_release"
```

**Release of the change:** **stop** here and report. Pushing the branch, opening the PR against `main` (`gh pr create`) and merging all need the user's confirmation. Part B Task 9 and Part C start only after the merge.

**Acceptance:** the gate passes. Commit: `docs: offsets and release reading; version 1.2.0`.

---

## Part B: Ontocurator (Tasks 6–10)

Ontocurator stays generic (U1): no names, defaults or formats of a particular producer or consumer. Test fixtures use the fictitious `example-tool` and `example-curator`.

### Task 6: Only tool proposal sets are imported (T7c; on `feat/t3a-admin-backend`)

> **Open question Q33:** which annotation sets may an import carry? Default: an import may carry empty sets of any kind (they create documents only, O2) and non-empty sets of kind `tool_output` whose actors are all tools (I3). A non-empty set of any other kind (`individual`, `stage_result`, `adjudicated` or `release`, e.g. human annotations from another tool, or an Ontocurator release) refuses the whole import, and the refusal lists the affected units. To bring human annotations from another tool in for review, its converter delivers them as `tool_output` of that tool (with name and version). Reasons: T4b's release builder treats imported sets as `tool_output` when it collects imported origins (O3); and foreign human actor ids are not project pseudonyms (T1 F10).

**Modify** `exchange/uploads.py` (T3a's `read_t1_upload`; extend whichever file T3a gave it), the T3a error-code table, `tests/test_import_plan.py`, `tests/test_uploads_api.py`.

**Rule (in `read_t1_upload`, next to `T1_TOOL_PROVENANCE`):** for each unit with a non-empty set, `set_kind == "tool_output"` and every actor has `kind == "tool"`. Otherwise the reader reports `T1_SET_KIND` with `{units: [{document_id, annotation_set_id, set_kind, actor_kinds}]}`. The plan is not committable (same severity as `T1_TOOL_PROVENANCE`, Q11 precedent). The CLI `admin import` fails with the same code.

**Tests:**
- `tests/test_import_plan.py::test_only_tool_output_sets_become_proposals`.
- `tests/test_import_plan.py::test_a_human_set_refuses_the_import_with_the_units_named`: an `individual` set gives `T1_SET_KIND` naming the unit; nothing is planned.
- `tests/test_import_plan.py::test_a_tool_output_set_with_a_human_actor_is_refused`.
- `tests/test_import_plan.py::test_an_empty_set_of_any_kind_creates_the_document`: an empty `individual` set is "document only".
- `tests/test_uploads_api.py::test_a_release_bundle_cannot_be_used_as_input`: the upload preview of a bundle written by `ontospan.write_bundle` with a `release` set has status `invalid` with `T1_SET_KIND`.

**Acceptance:** `uv run pytest tests/test_import_plan.py tests/test_uploads_api.py tests/test_t1_import.py -q` passes; regenerate the contract. Commit: `feat(exchange): import only tool proposal sets and document-only units`.

---

### Task 7: The producer block of import bundles (T7d; on `feat/t5-variants-review`)

An import bundle may fill the manifest `release` block, typically `producer` (I7). Ontocurator shows and records it. It never acts on it: `supersedes` in an import bundle replaces nothing, because imported sets stay immutable and a newer set never replaces an older one (I3).

**Modify** `exchange/uploads.py` (`IncomingUnit` gains `manifest_release: ontospan.ReleaseInfo | None`), `exchange/plan.py` (`ImportPlan.bundles: [{bundle_id, manifest_sha256, release_name, producer: {name, version} | null, supersedes: [{bundle_id, manifest_sha256}]}]`), `exchange/jobs.py` (audit), the T3b upload preview component (`frontend/src/admin/…UploadPreview…`; extend the file T3b created), `tests/test_import_plan.py`, `tests/test_uploads_api.py`, the T3b preview Vitest file.

**Audit:** `project.import` details gain `manifest_producer`, `release_name` and `supersedes` (I9). The T2d keys `producers` (tool actors) stay.

**Tests:**
- `tests/test_import_plan.py::test_the_plan_names_the_bundle_producer`.
- `tests/test_import_plan.py::test_a_bundle_without_release_block_has_no_producer`.
- `tests/test_uploads_api.py::test_the_import_audit_records_producer_release_name_and_supersedes`.
- `tests/test_uploads_api.py::test_a_superseding_import_bundle_replaces_nothing`: bundle B names bundle A in `release.supersedes`. After both imports, both `proposal_sets` rows exist and the proposals of A are unchanged.
- Vitest: "shows the bundle producer in the preview header" (`example-tool 2.0`).

**Acceptance:** `uv run pytest tests/test_import_plan.py tests/test_uploads_api.py -q`, `npm --prefix frontend test -- <preview test file>` and `npm --prefix frontend run typecheck` pass; regenerate the contract. Commit: `feat(exchange): show and audit the producer of import bundles`.

---

### Task 8: Proposal sets for finished documents (T7e; on `feat/t4a-workflows`)

> **Open question Q34:** what happens when a proposal set arrives for a document whose workflow is already finished (it has a final result, and may already be in a release)? Default: the set is stored and listed with the document's proposal sets. Nobody gets a notice, no stage reopens, and no release changes. The upload preview warns which documents are finished. If the lead wants the set reviewed, they reopen the document (T4a `reopen_to`). The drafts of the reopened stage then receive the set as normal input (T4a O5 rule: sets that exist when a draft is created are input).

**Modify** `exchange/plan.py` (`ProjectImportState` gains `finished_documents: frozenset[str]`; the warning), `exchange/uploads.py` or `exchange/jobs.py` (load the state from T4a's `document_stages`), the T3b preview message table, `tests/test_late_proposals.py`, `tests/test_import_plan.py`.

**Rule:** a planned proposal set whose document has a stage chain with a final result (`document_stages.final_result_id` set on its last stage, or `declare_final`) adds the warning `PROPOSALS_FOR_FINISHED_DOCUMENTS` with `{documents: [document_id]}`. The import still proceeds.

**Tests:**
- `tests/test_import_plan.py::test_the_preview_warns_about_finished_documents`.
- `tests/test_late_proposals.py::test_a_set_for_a_finished_document_changes_no_stage`: no stage status changes, no draft gets a notice, and `final_result_id` is unchanged.
- `tests/test_late_proposals.py::test_reopening_offers_the_set_as_input`: after `reopen_to`, the new draft has the set among its targets, marked `input`.
- `tests/test_late_proposals.py::test_a_set_for_a_document_without_workflow_is_plain_input`: when the workflow starts later, the first stage's drafts get it as input (O5).
- Vitest: "lists finished documents as a warning in the preview".

**Acceptance:** `uv run pytest tests/test_late_proposals.py tests/test_import_plan.py -q` and the Vitest file pass; regenerate the contract. Commit: `feat(workflow): proposal sets for finished documents warn and wait for a reopen`.

---

### Task 9: Shared reader in the release job and the contract tests (T7e; on `feat/t7-integration-contract`)

Set up: `git worktree add .worktrees/t7-integration-contract -b feat/t7-integration-contract feat/t4b-adjudication-releases`, `uv sync`, `npm --prefix frontend ci`. Baseline: `scripts/check.sh`. Needs Part A merged on ontospan `main`.

> **Open question Q38 (technical):** how does Ontocurator get the ontospan integration fixtures? Default: a vendored copy in `tests/fixtures/ontospan-integration/`, written by `scripts/sync_ontospan_fixtures.py`, with a `SOURCE.json` that records the ontospan version, the commit and the SHA-256 of every file. The wheel does not ship `conformance/`, and a copy is what I8 foresees for consumers.

**Re-pin:** `uv add "ontospan @ git+https://github.com/janpower/ontospan.git@<full 40-character merge hash>"` (index D-n pattern; `git -C ../ontospan rev-parse origin/main`). `uv run python -c "import ontospan; assert ontospan.__version__ == '1.2.0'"`.

**Create** `scripts/sync_ontospan_fixtures.py [--src ../ontospan] [--check]` (it takes the pinned commit from `pyproject.toml`, so the checkout's current branch does not matter; it reads `conformance/integration/{import,release}/` with `git -C SRC ls-tree`/`git show <commit>:<path>`, writes the copies and `SOURCE.json`, and with `--check` it compares without writing), `tests/fixtures/ontospan-integration/` (generated), `tests/fixtures/ontospan_integration_profile.json` (a `TaskProfile` with layer `hpo`, ontology `hp` release `2026-06-23` and the `hpo-phenotype` axis values, pinned to `tests/fixtures/hp.json`), `tests/test_t7_contract.py`. **Modify** `.gitattributes` (`tests/fixtures/ontospan-integration/**/*.json text eol=lf`), `src/ontocurator/release/jobs.py`.

**Release job (D-ag):** the read-back after `write_bundle` uses `ontospan.read_release(target, ontologies, report=…)` instead of `read_bundle`. A `FormatError` fails the job with `RELEASE_FORMAT: {"codes": [...], "issues": [...]}`, and no `releases` row is written. Add `RELEASE_FORMAT` to T4b's error-code table.

**Tests (`tests/test_t7_contract.py`):**
- `test_the_vendored_fixtures_match_their_source`: every file's SHA-256 equals `SOURCE.json`, and `SOURCE.json["ontospan_version"] == ontospan.__version__`.
- `test_the_ontospan_import_bundle_imports`: through the upload preview and commit into a project created from the profile fixture.
  - Two "document only" units (O2), one case with a German translation in `ready_for_review` (I2).
  - `parse_annotation_ref` of each proposal gives the fixture's bundle, set and annotation ids (O1).
  - The proposal-set API returns tool name, version, model, run id and notes (I3).
  - The audit has `manifest_producer == {name: "example-tool", version: "2.0"}` (I7, Task 7).
- `test_the_ontospan_release_bundle_is_refused_as_input`: `T1_SET_KIND` (Q33, Task 6).
- `test_an_ontocurator_release_reads_with_the_shared_reader`: build a release with T4b's `tests/release_factory.py` and the release job. `ontospan.read_release` passes; `finals()` has one unit per selected document; every release annotation's `origins(set_kind="tool_output")` equals the imported origins in its `source_refs` (O3).
- `test_an_ontocurator_release_validates_against_the_json_schemas_alone`: the same check as ontospan Task 4, on the release ZIP's entries, with schema files from `importlib.resources.files("ontospan") / "schema"`.
- `test_the_release_job_fails_on_a_shared_reader_error`: `build_release` is monkeypatched to emit a second `release` set for one document. The job fails with `RELEASE_FORMAT` naming `release_final_duplicate`, and the `releases` table is unchanged.

**Steps:**
- [ ] Re-pin ontospan and run `uv run pytest -q` (unchanged behaviour).
- [ ] Write the tests. Run `uv run pytest tests/test_t7_contract.py -q`; they fail.
- [ ] Write the sync script, run `uv run python scripts/sync_ontospan_fixtures.py`, and add the profile fixture (project languages `en` and `de`) and the `.gitattributes` line.
- [ ] Switch the release job's read-back to `read_release`.
- [ ] Run `uv run pytest tests/test_t7_contract.py tests/test_releases.py tests/test_integration_roundtrip.py -q` until it passes, then `uv run pytest -q`.
- [ ] Apply the commit rule and commit (two commits: `build: pin ontospan 1.2` and the rest).

**Acceptance:** the tests above pass; `uv run python scripts/sync_ontospan_fixtures.py --check` exits 0. Commit: `test(integration): contract tests against the ontospan integration fixtures`.

---

### Task 10: Integration guide and the round-trip script

**Create** `docs/integration.md`, `tests/test_integration_guide.py`. **Modify** `scripts/check_integration_roundtrip.py` (T4b Task 14), `docs/operations.md` (a link in "Integration round trip before tagging").

**`docs/integration.md`** (generic; no producer or consumer is named except as an example of the role):
1. **Producing input:**
   - Documents only: units with an empty set (O2).
   - Proposals: `tool_output` sets with a tool actor (`name` and `version` required; `model`, `run_id` and notes optional), all as delivered (O1).
   - Translations and versions: format 1.1 fields; the status on import; the lead's override (I2).
   - Canonical text is required; `ontospan.offsets` maps pre-existing offsets (I6).
   - The bundle must match the project: ontology pins, `allowed_roots`, `contiguous_mentions_only` and hidden axis values (O4).
   - Re-imports are idempotent; late sets and sets for finished documents behave as in O7 and Q34.
   - Entry points: `ontocurator admin import` and the upload page. Every import is audited with the bundle id and the manifest SHA-256.
2. **Consuming releases:**
   - The bundle content (I5) and the `release` block (I7).
   - `ontospan.read_release`, or the JSON Schemas alone.
   - Lineage, pseudonyms and consent; variants; supersedes.
   - How to get a release: the download, or `ontocurator admin export-release`.
   - How to verify it: the manifest hash in the release list and in the audit log.
3. **What Ontocurator never does:** live APIs, webhooks, suggestions from external services (E5), and translation or LLM calls.

**Round-trip script:** after the existing step 8 checks, add two steps:
- "shared reader": `ontospan.read_release` passes on the downloaded release;
- "JSON Schema alone": every entry validates against the schema files.

Both print `PASS`/`FAIL` like the other steps.

**Tests (`tests/test_integration_guide.py`):**
- `test_the_integration_guide_names_existing_cli_commands`: every `ontocurator admin …` command in a code block of the guide runs `--help` with exit code 0 (`CliRunner`).
- `test_the_integration_guide_names_existing_error_codes`: every `T1_…`, `UPLOAD_…`, `VARIANT_…` and `RELEASE_…` code in the guide occurs in `src/`.

**Final gate:**
- `uv run pytest tests/test_integration_guide.py tests/test_t7_contract.py -q` passes.
- With `docker compose -f docker-compose.dev.yml up -d --build --wait`, `uv run python scripts/check_integration_roundtrip.py --base-url http://127.0.0.1:8000` passes; then `docker compose -f docker-compose.dev.yml down -v`.
- `scripts/check.sh` prints `All local checks passed.`
- Commit: `docs: integration guide for producers and consumers; round trip checks the shared reader`.

---

## Part C: Consumer repositories (not Ontocurator; Tasks 11–13)

These tasks change other repositories. The T7 spec leaves the adapters' behaviour to their owners (T7 appendix), so each task is planned in detail in its own repository before it starts. The work there starts only after the user confirms. Commands follow each repository's own conventions. Nothing here adds code, names or defaults to Ontocurator (U1).

### Task 11: Phentrieve reads releases as benchmark gold

> **Consumer question Q40:** may Phentrieve, a public repository, contain copies of the ontospan JSON Schemas and one release fixture while ontospan itself is private (I8)? Default: yes. I8 names copied schemas and fixtures as the contract for consumers that cannot depend on the package, and Phentrieve cannot depend on a private Git package. Each copy records the ontospan version and commit.

> **Consumer question Q41:** which annotations count as Phentrieve gold, and how do the axes map to its assertion values? Default: only the `release` set of each document variant. Mapping: `present` → `PRESENT`, `absent` → `ABSENT`, `uncertain` → `UNCERTAIN`. `experiencer = family_member` → `FAMILY_HISTORY`. `experiencer` `other` or `unknown` is left out and counted. `temporality` is not used. Each variant is its own benchmark document with the id `document_id`, or `"{document_id}:{language}:v{version}"` when the release has several variants of one document.

- **Files (Phentrieve):** create `phentrieve/benchmark/ontospan_release.py`, `phentrieve/benchmark/schemas/ontospan/` (three 1.1 schema files plus `SOURCE.json`), `tests/fixtures/ontospan/release/` (the copy of `conformance/integration/release/`) and `tests/unit/benchmark/test_ontospan_release.py`. Modify `phentrieve/benchmark/data_loader.py`: `load_benchmark_data` detects a bundle (a directory or ZIP with a `manifest.json` whose `artifact_type` is `bundle`).
- **Contract:** `load_ontospan_release(path) -> dict` returns the loader's document format `{metadata, documents: [{id, text, gold_hpo_terms: [{id, label, assertion, evidence_spans: [{start_char, end_char, text_snippet}]}], source_dataset}]}`.
  - Offsets are the release's code-point offsets on canonical text (T1 F2); Phentrieve's line-ending normalisation is a no-op on them.
  - A discontinuous mention gives one evidence span per segment. A document-level annotation gives no span.
  - The reader validates with `jsonschema` and the copied schemas, and re-implements the release rules of Part A Task 3 (`lineage_unresolved` is checked only for the `release` sets it uses).
- **Tests:** `test_a_release_loads_as_benchmark_documents`, `test_axes_map_to_assertions` (Q41 table), `test_only_release_sets_become_gold`, `test_discontinuous_mentions_give_one_span_per_segment`, `test_a_bundle_that_fails_the_schema_is_refused`, `test_load_benchmark_data_detects_a_release_bundle`.
- **Verification:** `uv run pytest tests/unit/benchmark/test_ontospan_release.py -q`, `make lint`, `make typecheck`.

### Task 12: phentrieve-benchmark writes import bundles

- **Scope:** a subpackage `phentrieve_benchmark.ontocurator`, with an `export` command that replaces `scripts/build_editor_packages.py` (E6; the v2 work package is gone).
  - Documents and translations are written as units with empty sets and the format 1.1 variant fields.
  - LLM proposals become `tool_output` sets. The tool actor carries `name`, `version`, `model` and `run_id`, and the run provenance goes into `provenance.notes`.
  - Offsets are mapped with `ontospan.offsets`, because the benchmark keeps a leading BOM that ontospan strips. Spans that cannot be mapped are reported, never snapped.
  - The manifest `release.producer` names the benchmark.
- **Dependency:** `ontospan` through the local overlay pattern the script uses today (`uv run --with ../ontospan`), since the package is private (I8).
- **Acceptance:** for every written bundle, `ontospan.read_bundle` with the project's ontology passes, and `ontocurator admin import` on the dev stack imports it. The import's `T1_*` and `PIN_MISMATCH` lists are empty.

### Task 13: phentrieve-benchmark reads releases

- **Scope:** an `import-release` command that turns a release into the benchmark's own gold models (`curated-annotation-set`, review decisions; benchmark spec §8.2 and §14). It uses `ontospan.read_release`, `finals()` and `origins()`. It records the release's bundle id and manifest SHA-256 as provenance.
- **Acceptance:** the command runs on `conformance/integration/release/` and on a release produced by Task 9. Every `release` annotation is mapped or listed as skipped with a reason, and the manifest hash is part of the output's provenance.

---

## Spec coverage

| Spec item | Task |
|---|---|
| Goal 1: documents, translations, versions and proposal sets via CLI or upload | T2d Task 4, T3a Task 6, T5 Task 3; here 6, 7, 10 |
| Goal 2: proposals keep provenance and appear as proposals | T2d Task 4, T3b Task 10; here 9 |
| Goal 3: releases readable with ontospan or the JSON Schema alone | T4b Tasks 8, 9; here 3, 4, 9 |
| Goal 4: one shared, tested offset mapping | 1, 2, 4 |
| I1: one format, three interfaces; jobs and audit | T2d, T3a, T4b; here 7 (bundle producer) |
| I2: document import, translations and versions | T5 Task 3; here 9 (fixture) |
| I3: proposal sets are `tool_output` with tool actors; provenance required; several sets; late sets | T2d, T3a, T4a Task 8; here 6 (set kind, Q33), 8 (finished documents, Q34) |
| I4 O1–O7 | see "What this plan does not repeat"; here 9 checks O1, O2, O3 against the shared fixtures |
| I5: release content, pseudonyms, variants, access, `export-release` | T4b Tasks 8, 9; here 3 (reader), 9 |
| I6: `ontospan.offsets`, fast path, runs, no snapping, self-check, no schema change | 1, 2, 5 |
| I7: `release` block; import bundles may fill `producer` | ontospan `4105ec1`; here 7 |
| I8: ontospan private; schemas and fixtures as the contract | 4, 5, 9 (Q38), 11 (Q40) |
| I9: hash-linked chain from producer to consumer | T2d, T4b; here 7, 9, 13 |
| I10 ontospan tests: offsets cases, release block schema tests, `conformance/integration/` | 1, 2, 4 (release block schema tests exist since 1.1) |
| I10 Ontocurator tests and `scripts/check_integration_roundtrip.py` | T3a, T5, T4a, T4b Task 14; here 9, 10 |
| Appendix: consumer notes | 11, 12, 13 |

## Open questions

Each is marked in its task as `> **Open question Qn:**` with the default the task implements.

**User flow and domain (Ontocurator):**

| # | Question | Proposed default | Task |
|---|---|---|---|
| Q33 | Which annotation sets may an import carry? | Empty sets of any kind (document only) and `tool_output` sets with tool actors. Any other non-empty set refuses the import with the units listed. Human annotations from another tool come in as that tool's `tool_output`. | 6 |
| Q34 | What happens to a proposal set for a document whose workflow is finished? | Stored and listed; no notice, no reopening, no change to releases. The preview warns. The lead reopens the document if the set should be reviewed, and the reopened stage gets it as input. | 8 |
| Q35 | Should a release also contain proposal sets that no final annotation descends from (e.g. a dismissed late set)? | No, as the spec says (I5). The producer already holds all of its own outputs, and statistics over every proposal use the producer's bundle together with the release, joined by the preserved ids (O1). | – (T4b `test_unused_proposal_sets_are_left_out` stays) |

**Technical:**

| # | Question | Proposed default | Task |
|---|---|---|---|
| Q36 | ontospan package version for the additions | `1.2.0`; `SCHEMA_VERSION` stays `1.1.0` | 5 |
| Q37 | A public release reader in ontospan, or a README recipe only? | Public `ontospan.release` (`read_release`, `check_lineage`, `ReleaseView`) | 3 |
| Q38 | How Ontocurator gets the integration fixtures | A vendored copy with `SOURCE.json` hashes and a sync script with `--check` | 9 |
| Q39 | Which offsets inside a run are refused: only inside runs whose length changed (I6 wording), or inside any changed run? | Any changed run, which also covers equal-length reorderings of combining marks. The quoted text then always matches exactly; no realistic span ends inside such a run. | 1, 2 |

**For the consumer repositories (not Ontocurator; decided when Part C starts):**

| # | Question | Proposed default | Task |
|---|---|---|---|
| Q40 | May the public Phentrieve repository contain copies of the ontospan schemas and a release fixture while ontospan is private? | Yes, as I8 foresees, with version and commit recorded | 11 |
| Q41 | Which annotations are Phentrieve gold, and how do axes map to its assertions? | Only `release` sets; present/absent/uncertain map directly; a family member gives `FAMILY_HISTORY`; other experiencers are skipped and counted; one benchmark document per variant | 11 |

## Deviations from the spec

- **I6, interior offsets:** refused inside any run that canonicalisation changed, not only inside runs whose length changed (Q39).
- **I6 scope:** a public `ontospan.release` reader is added beyond the offset helper (Q37). The format and the schemas are unchanged.
- **I10 fixtures:** `conformance/integration/` also holds `offsets.json`, so converters in other languages can test the mapping.
- **T3 A1 / I1 ("contained annotation sets become proposals"):** narrowed to `tool_output` sets (Q33).
- **I10, Ontocurator import tests:** most are already in T2d–T4b. This plan adds the contract tests against the ontospan fixtures (Task 9) instead of repeating them.

## Risks

- **Unicode edge cases (Tasks 1–2):** the run rule is subtle around Hangul and combining marks. The two exhaustive tests and the `offset_map_inconsistent` guard catch mistakes in the rule, not in the callers.
- **ontospan merge gate:** Task 9 and Part C wait for the user to merge the ontospan PR.
- **Fixture drift:** the vendored copy in Ontocurator can fall behind ontospan. `SOURCE.json` ties it to the pinned version, and `sync_ontospan_fixtures.py --check` is part of the re-pin step.
- **Tasks on other branches (6–8):** they can be forgotten when T3a, T5 and T4a run. Task 9 fails if Task 6 is missing (`test_the_ontospan_release_bundle_is_refused_as_input`) or Task 7 is missing (producer audit). Task 8 has no such guard, so the coordinator adds it to the T4a task list.
- **Public consumer of a private format (Task 11):** copies in Phentrieve make the 1.1 schemas public before I8's publication decision (Q40).
