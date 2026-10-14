# Review of the T0 and T1 implementation plans

Date: 2026-10-14. Reviewed:
- `plans/2026-10-14-t0-tree-term-id-link.md`
- `plans/2026-10-14-t1-ontospan.md`

There were two independent reviews with the same brief:
- **Claude**, a subagent. It extracted all T1 plan code into a temporary project and ran it with Python 3.12, pydantic 2.14, jsonschema, phenopackets, mypy and ruff 0.15. It also traced T0 against the source files by hand.
- **Codex** (`gpt-6-astra`, read-only sandbox). It reproduced several findings with short Python runs.

Each item lists who found it (C = Claude, X = Codex) and the planned resolution. Items marked **decision** need the user's choice.

## T0

| # | Severity | Finding | By | Resolution |
|---|---|---|---|---|
| T0-1 | critical | Exact-dict assertions in `tests/test_tree_api.py` (lines ≈203–228, 311–317, 967–971) fail once nodes carry `external_url` | C, X | Task 2 updates those expectations and commits the file |
| T0-2 | critical | `frontend/browser/tree.spec.ts:136,156` compare the full text of `.tree-detail__id`; after the change it becomes `"HP:…↗"` | C | ID in its own span `.tree-detail__id-text`, link beside it; point the old assertions at the span; the new Vitest test does not assert `"HP:A↗"` |
| T0-3 | major | `frontend/tests/treeState.test.ts:41–43` (`toEqual` on rows) fails with the new `externalUrl: null` | C, X | Task 4 adds `externalUrl` to that expectation and a test that maps it through |
| T0-4 | minor | `new URL(...)` in TreeBrowser throws for relative or invalid URLs (T3 templates) | C | Export `hostOf` from TermTree and reuse it |
| T0-5 | minor | Treeitem accessible name grows (label + ID + link); nested interactive link; Enter on the focused link is caught by the tree | C | `aria-labelledby` on the `li` pointing at the label; test that Enter on the row still selects |
| T0-6 | minor | `ruff format --check` fails on the new test file | C | Write it formatted |
| T0-7 | minor | Worktree setup missing (`uv sync`, `npm ci`, Playwright browser) | C | Add a setup task |

## T1: execution errors (fix in the plan)

| # | Severity | Finding | By | Resolution |
|---|---|---|---|---|
| T1-1 | major | mypy: `layer` reused as `Layer \| None` in `_check_content` | C, X | Rename the lookup variable |
| T1-2 | minor | ruff `I001` in `bundle.py`, `phenopacket.py` and tests; 15 files not formatted | C, X | Code written formatted; each task runs `ruff check --fix && ruff format` before committing |
| T1-3 | minor | `unzip` missing in Git Bash; `touch` missing in PowerShell; "Task 12" should be Task 11 | C | `python -m zipfile -l`; create the file with Python; fix the reference |
| T1-4 | minor | Malformed JSON, non-object top level and conflicting layers raise raw exceptions instead of `FormatError` | C, X | Check top-level type, catch `JSONDecodeError`, translate into issues; tests |
| T1-5 | minor | Naive datetimes accepted; JSON Schema `format` not checked; naive `created_at` shifts the Phenopacket time | C, X | `AwareDatetime`; `FORMAT_CHECKER`; tests for date-only, naive and offset |
| T1-6 | minor | `make_document(str)` keeps a leading BOM | C | Strip U+FEFF in `canonical_text` |

## T1: design and spec issues

| # | Severity | Finding | By | Resolution |
|---|---|---|---|---|
| T1-7 | major | Greedy pairing is not optimal and understates tolerant F1, e.g. 0.5 instead of 1.0 | C, X | Optimal bipartite assignment: maximise equal pairs, then compatible, then conflicts; deterministic tie-break; regression test |
| T1-8 | major | Matching ignores `layer_id`: HPO vs MAxO on one span becomes a term conflict; different layers give F1 1.0 | C, X | Match within each layer; term-agreement keys include the layer |
| T1-9 | major | Agreement is annotation-level, but T4 W6 says "F1 on mentions" | X | **decision D1** |
| T1-10 | major | Newer-minor reading: unknown profile is an error, new axes are errors, `Literal` enums cannot grow, `extra="ignore"` drops fields on re-export | C, X | **decision D2** |
| T1-11 | major | Schema files: `…-1.0.json` is always regenerated, so "ships all minor schemas, validates against the declared version" (F3) is impossible | C | Name the file after the current version and freeze older ones. The drift test checks the current file only; `check_schema` picks the file for the declared minor |
| T1-12 | major | Profile rules are not in the binding JSON Schema; F12 makes the schema the contract for Phentrieve | C, X | Per-annotation profile schema `hpo-phenotype-annotation-1.0.json` for what JSON Schema can express (axes, values, ID pattern, `document_level`). Conformance fixtures `conformance/{valid,invalid}/*.json` with expected codes for the rest. Non-schema rules documented in the README |
| T1-13 | major | References collide: the URN lacks `annotation_set_id`; IDs contain `:`; `source_refs` has no syntax | C, X | One reference syntax `urn:ontospan:<set>:<annotation>` with percent-encoded parts, plus the bundle ID in exports. It is used for Phenopacket references and documented for `source_refs`. Test with two sets per document |
| T1-14 | major | Ontologies resolved by id only; versions not checked; export uses the first layer's version | X | `OntologyView` gains `release`. The validator reports `ontology_release_mismatch` when the given view's release differs from the layer's `ontology.version`. The export uses the matching layer's version |
| T1-15 | major | Bundle reading: duplicate ZIP or manifest entries overwrite each other; directory symlinks are followed; no size limit for directories | C, X | Reject duplicates; check containment and size before reading; tests |
| T1-16 | major | Bundle hashes break when a directory bundle is checked out with CRLF (`core.autocrlf=true` on this machine) | C | Ship `.gitattributes` (`*.json text eol=lf`) and document it for consumers. Readers also fail with a clear `crlf_checkout` hint when the CRLF→LF content matches the hash |
| T1-17 | major | F9 gaps: no grouping by `subject_id`; non-HPO layers and `historical` not reported; categories lumped together | C, X | `to_phenopackets(units, group_by_subject=True)`. Report counts per category: family, other, unknown, uncertain, non-HPO layer, historical, frequency |
| T1-18 | minor | A segment that normalises to nothing (", ") makes mentions "identical" | C | Validation warning `empty_after_normalization`; such mentions never match |
| T1-19 | minor | Document-level vs mention-based annotation of the same term never pair | C | **decision D3** |
| T1-20 | minor | `match_annotations` output in rank order; T4 needs text order | C | Return groups sorted by text position |
| T1-21 | minor | `validate_phenopacket` is only protobuf structural parsing; `{}` passes | X | Rename to `parse_phenopacket` and document it as structural only; tests assert content |
| T1-22 | minor | Manifest layer comparison depends on order; duplicate `annotation_set_id` not detected | C | Compare by `layer_id`; reject duplicate set IDs |
| T1-23 | minor | `ObographOntology.version` is an IRI, while layers use a release string | C | `release` property that derives `2026-06-23` from the version IRI |
| T1-24 | minor | `schema_version` has no default; `$id` uses `.local` | C | Default `SCHEMA_VERSION`; `$id` as `urn:ontospan:schema:<name>` |
| T1-25 | minor | Missing tests: unordered segments, duplicate layer, unlisted, missing or too-large files, discontinuous mentions in matching, cross-layer | C | Add them |
| T1-26 | note | Tool actors' `name`/`version` and `require_chosen_axes` not enforced | C | Validator options `require_tool_identity` (warning) and `require_chosen_axes` (error), both off by default |
| T1-27 | note | Private Git dependency needs credentials in the T2 Docker/CI build | C | Noted for T2 |
| T1-28 | note | Committed schemas depend on the pydantic version | C | Pin pydantic minor in the dev group; drift test explains the failure |
| T1-29 | note | k > 2 clustering for T4 adjudication | C | T4 work; the T1 API stays pairwise |

## Decisions (user, 2026-10-14)

- **D1, agreement level: both.**
  - *Annotation level:* term, axes and mentions as one unit, strict and tolerant.
  - *Mention level:* every mention counts with the term and axes of its annotation, strict and tolerant.
  - *Term level per document:* as before.
- **D2, minor versions:**
  - Minor versions may add optional fields and new profiles.
  - Older readers accept them with warnings. An unknown profile is a warning, and its annotations are not profile-checked.
  - Unknown fields are kept when a unit is read and written again (`extra="allow"`; the generated schema still closes objects).
  - New values for closed lists (`set_kind`, `method`, `kind`, `basis`, profile axis values) require a new major version.
- **D3, document-level vs mention-based annotations** with the same term, axes and layer are `compatible`: a tolerant match, not a strict one. The merge proposes the version with a text span.
