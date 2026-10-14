# T7: Integration Interfaces (Document and Proposal Import, Release Export)

Date: 2026-10-14 · Status: **design agreed** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E4, E5, E6, E7, E8) · Builds on T1 (`ontospan`), T2 (D5, D6), T3 (A1, A5), T4 (W1, W2, W4, W7), T5 (V4, format 1.1)

T7 defines Ontocurator's generic interfaces to other tools. Ontocurator is a standalone annotation tool, and every external system is just a consumer or a producer of files. All exchange uses **ontospan bundles** (T1). There is no live coupling to any tool (E5) and no shared database.

There are four interfaces:
- **document import**, including translations and text versions;
- **proposal import** from any external tool, e.g. an LLM run;
- **release export**;
- **offset mapping** for importers with pre-existing offsets, provided by `ontospan`.

## Starting point

**Ontocurator after T2–T5**
- T2 D5: documents and proposals are imported in the T1 format through `ontocurator admin …`. Submitted results are exported in the T1 format.
- T3 A1: upload of T1 bundles and plain text with a preview.
  - Contained annotation sets become proposals.
  - Ontology pins and `allowed_roots` must match the project.
- T3 A5: export of submitted results and the optional edit log (T2 D6).
- T4 W4: a per-stage tool-proposal policy, `hidden` | `toggle` | `shown`.
- T4 W7: frozen releases (`set_kind: release`, stored on `/data` with a hash).
- T5 V4: cases and variants. Format 1.1 adds `case_id`, `variant` and `translation`.

**ontospan (T1, implemented, private repository `janpower/ontospan`)**
- Public API:
  - `canonical_text`, `make_document`, `segment`;
  - `validate`, `load_annotated_document`, `read_bundle`/`write_bundle`;
  - `match_annotations`/`agreement`;
  - `urn:ontospan:` references.
- Missing for T7:
  - A helper that maps offsets of a raw text onto its canonical text. The T1 plan note asks for one (CRLF, NFC, BOM).
  - Manifest fields for release metadata. The manifest has `bundle_id`, `release_name`, `created_at`, `layers`, `contributors` and `files`, but nothing for a superseded release, the producer or the project.
- The format requires exactly one annotation set per unit, with at least one actor.

**Existing producer:** the first external producer is the `phentrieve-benchmark` repository. It has LLM span proposals with code-point offsets and full run provenance. Today `scripts/build_editor_packages.py` turns them into v2 work packages, a format that is dropped (E6). Consumer-specific notes are in the appendix; they do not shape the interfaces.

## Goals

1. Any tool can deliver documents, including translations and text versions, and proposal sets as ontospan bundles, through the CLI (T2) or the upload page (T3).
2. Proposals keep their tool, run and model provenance and appear to annotators as proposals.
3. Releases are complete, self-describing bundles that any consumer can read with ontospan or the JSON Schema alone.
4. Converter authors get one shared, tested offset mapping instead of writing their own.

## Non-goals

- Converters for specific external formats or projects, e.g. the benchmark or Phentrieve. They live with their owners (appendix).
- Live APIs or webhooks for external tools. Programmatic API tokens are not part of T7 either.
- Phentrieve suggestions (E5).
- Translating, or calling LLMs, from Ontocurator (T5).
- Import of `ontocurator-work-package/v2` (E6).
- Scoring, projections onto other vocabularies, and publication metrics (E7: in the consumers).
- CI pipelines. GitHub Actions are not available, so every check runs locally (I10).

## Decisions

### I1: One exchange format, three interfaces

| Interface | Direction | Entry points | Bundle content |
|---|---|---|---|
| Document import | in | `ontocurator admin import` (T2), upload page (T3) | units whose annotation set is empty (I2) |
| Proposal import | in | same | units with `set_kind: tool_output` (I3) |
| Release export | out | release page download (T4), `ontocurator admin export-release` | final plus lineage sets (I5) |

- Documents and proposals may arrive in one bundle or in separate bundles. The import preview (T3 A1) lists both.
- Plain-text import (T3 A1) stays as it is. T7 adds nothing there.
- Every import and export is a job (T2 P6) and an `audit_events` entry that records the bundle ID and the manifest SHA-256.

### I2: Document import, including translations and versions

- **A document-only unit** carries an empty annotation set. This is needed because the format requires exactly one set per unit.
  - Ontocurator creates the document and **no** proposal set (O2).
  - The set's actor is recorded as the importing tool in the audit entry.
- **Canonical text is required.** Ontocurator rejects non-canonical text, as the ontospan validation does (`text_not_canonical`). Converters with pre-existing offsets use `ontospan.offsets` (I6).
- **Translations and versions** use the T5 format 1.1 fields: `case_id`, `variant` (`version`, `origin`, `derived_from` as text hash) and `translation` (provider, model, recipe/run ID, checks).
  - A source text and its translation may arrive in one bundle. Ontocurator builds the case from `case_id` and resolves `derived_from` by text hash. A `derived_from` that matches no variant in the bundle or in the project is an error.
  - **Translation status on import:**
    - `automatic_check_failed` if any imported check failed;
    - otherwise `ready_for_review`.
  - The project lead may set `accepted` in the preview for selected variants, e.g. when a review was done elsewhere. This requires a reason, is audited, and is shown on the variant.
  - Rationale: the default keeps the T5 V6 gate meaningful, and the override avoids a forced second review of already-reviewed texts.
- **Collisions:**
  - Same `document_id` with a different text: refused in T3. With T5, it is imported as a new version only if `variant.version` and `derived_from` say so.
  - Duplicates by `text_sha256` are listed in the preview (T3 A1).

### I3: Proposal import from any external tool

A proposal set is a unit with `set_kind: tool_output` whose actors are of kind `tool`.

**Required provenance**
- Each tool actor needs `name` and `version`.
- `model` and `run_id` are optional but shown when present, e.g. for LLM runs.
- A set without `name`/`version` is refused in the preview with the unit named.

**Validation**
- Full ontospan validation with the project ontology: term activity, `allowed_roots` and modifier rules.
- Project restrictions are checked as at submission (O4):
  - a proposal with a discontinuous mention in a `contiguous_mentions_only` project;
  - a proposal with an axis value the project hides.

  Such proposals are listed and not imported. The rest of the set is imported.
- Axis `basis` is kept as delivered. Tools set `chosen` only for values they determined (T1 F8).

**Identity:** `annotation_set_id`, `annotation_id` and the bundle ID are stored and kept (O1). Every annotation derived from a proposal points to it with `urn:ontospan:` references, so the lineage in a release leads back to the producer's IDs without a lookup table.

**Several sets per document:**
- Allowed, e.g. two tools or two runs. Each is shown with its own actor label.
- A newer set does not replace an older one. Both stay immutable.

**Arrival after work has started**
- A proposal set imported for a document whose stage has already started does not change existing drafts.
- It feeds only stages that have not started. The progress view marks such documents.
- The project lead may reopen the stage (T4 W1) to use the new set.

**Display**
- Proposals carry the existing AI badge. The detail pane shows tool name, version, model, run ID and `provenance.notes`.
- **First round = assisted** (user decision 2026-10-14):
  - When a project has imported proposals, its first stage takes the proposal set as working input (O5). The annotator works through every proposal with the W2 checklist: confirm, change or delete.
  - Each outcome is recorded with `method` `adopted` or `edited` and `source_refs` to the proposal. A deletion is recorded in the edit log (T2 D6).
  - Blinding against proposals is the existing T4 W4 toggle and stage policy. It can be configured for later rounds.

### I4: Requirements on Ontocurator (fed into the T2–T5 plans)

| # | Requirement | Spec |
|---|---|---|
| O1 | Imported `annotation_set_id`, `annotation_id` and bundle ID are stored unchanged. Derived annotations reference them with `urn:ontospan:` references. | T2 D5, T3 A1 |
| O2 | An imported empty annotation set creates the document only, with no proposal set. | T2 D5, T3 A1 |
| O3 | Release annotations carry, in `source_refs`, their direct parents **and** their transitive imported origins (the proposals they descend from). | T4 W7 |
| O4 | Project options `contiguous_mentions_only`, and a restriction of a profile's axis values (e.g. hiding `unknown`). Both are checked at submission and on proposal import. | T3 A5 |
| O5 | A stage can take an imported proposal set as its working input, using the W2 checklist. This is the assisted first round. | T4 W1, W2 |
| O6 | Release bundles contain lineage sets (I5) and fill the manifest `release` block (I7). | T4 W7 |

### I5: Release export

The release bundle (T4 W7) **always** contains, per document (user decision 2026-10-14):
- the final set (`set_kind: release`);
- every contributing set: the `individual` submissions, the `stage_result` sets and the `adjudicated` set;
- the imported proposal sets the release descends from (`tool_output`), so the lineage resolves inside the bundle.

The sets are linked by identical `text_sha256` (T1 F3) and by `source_refs` (O3). This makes inter-annotator agreement and proposal statistics computable from the release alone (E7).

**Pseudonymisation**
- Human actors appear only as project pseudonyms (T1 F10).
- `contributors[]` lists names and ORCIDs only with consent.
- Comments and the edit log are not part of the release (T4 W8, T2 D6).

**Variants:** a release covers the selected variants. Each unit carries its format 1.1 variant fields, so translations and text versions stay distinguishable.

**Access**
- All project members can see and download releases (E8). Downloading needs the export right (E3).
- `ontocurator admin export-release <project> <release>` writes the identical bytes for operators.

### I6: Offset mapping helper (`ontospan.offsets`)

The helper is for converters that bring offsets measured on a non-canonical or UTF-16 text. Ontocurator itself only accepts canonical bundles.

```python
canonical, offset_map = canonicalize_with_offsets(raw)            # raw: str
start, end = offset_map.span(raw_start, raw_end)                   # code points
start, end = offset_map.span_utf16(u16_start, u16_end)             # UTF-16 (XMI, JavaScript)
```

**Fast path:** if `canonical_text(raw) == raw`, the map is the identity.

**Construction**
- The raw text is split into runs at stable boundaries: code points with canonical combining class 0 that do not compose with their predecessor.
- Each run is normalized to NFC on its own. CRLF/CR → LF and the leading BOM are explicit deletions.
- The concatenation of the runs must equal `canonical_text(raw)`. Otherwise the function raises.

**No snapping**
- A start or end inside a run whose length changed is the error `offset_inside_normalization`. Examples are an offset between `\r` and `\n`, or between a base letter and a combining mark that NFC merges.
- Converters report such spans and do not guess.

**Self-check:** the mapped segment text is `canonical[start:end]`. If the source carries a snippet, `canonical_text(snippet)` must equal it (`snippet_mismatch`).

**Scope:** a library addition with no schema change. It needs a package version bump; `schema_version` is unaffected.

### I7: Release metadata in the manifest (format minor)

The manifest gains an optional `release` object:
- `name`;
- `description`;
- `project_id`;
- `producer {name, version}`;
- `supersedes[]` (`bundle_id`, `manifest_sha256`).

`release_name` stays for compatibility and must equal `release.name` when both are set.
- **Versioning:** this ships together with T5's 1.1 if 1.1 is not yet released, otherwise as 1.2. It contains new optional fields only (T1 F3).
- **Where it is filled:** Ontocurator fills it for releases (O6). Import bundles may fill `producer`.

### I8: ontospan stays private for now

- ontospan remains a private Git dependency (T1 F12). Consumers that can reach it pin a tag; local builds use the developer's Git credentials, and there is no CI token problem (I10).
- Consumers that cannot depend on it rely on the binding contract: the JSON Schemas, the profile schema and the conformance fixtures, which can be copied as files.
- Publication (PyPI, licence, public repository) is revisited when an external consumer needs the Python package itself, e.g. for matching (E7).

### I9: Versioning and provenance

- **Imports:** every import records the bundle ID, the manifest SHA-256, producer actors and the importing user in `audit_events`. Imported sets are immutable.
- **Releases:** every release is a frozen bundle with a recorded hash. A correction is a new release whose `release.supersedes` names the earlier one.
- **The chain is fully hash-linked:** producer bundle → import audit entry → derived annotations (`source_refs`) → release bundle → consumer.
- **Line endings:** bundles checked into Git need `*.json text eol=lf` (ontospan README).

### I10: Testing (local only)

GitHub Actions are not available. Every repository runs `uv run pytest` locally, and the end-to-end check is a local script. There are no workflow files.
- **ontospan**
  - Unit and conformance tests for `ontospan.offsets`: CRLF, lone CR, BOM, combining sequences, Hangul jamo, astral characters and surrogate pairs, offsets inside a changed run, snippet mismatch.
  - Schema tests for the `release` block, with the frozen 1.0 schemas unchanged.
  - A fixture set `conformance/integration/`: a document-and-proposal bundle with variants, and a matching release bundle with lineage.
- **Ontocurator**
  - Import tests on the fixtures:
    - O1 (IDs kept), O2 (empty sets);
    - missing tool provenance refused;
    - project restrictions (O4);
    - variants and translation status (I2);
    - a late proposal set not altering drafts.
  - An API-level test: import → assisted first round (O5) → adjudicate → release → export. It checks the lineage sets, O3 and the `release` block against ontospan validation.
- **Local end-to-end script** `scripts/check_integration_roundtrip.py`: it runs against the dev compose stack with the fixtures and is run by hand before tagging a release.

## Sequencing relative to T2–T5

| Phase | With | Content |
|---|---|---|
| T7a | now, parallel to T2 | `ontospan.offsets`, integration fixtures |
| T7b | T2 D5 | CLI import of documents and proposals: O1, O2, required tool provenance |
| T7c | T3 | Upload preview with proposal sets and tools; O4 |
| T7d | T5 | Variant import (format 1.1), translation status on import (I2) |
| T7e | T4 | O3, O5, O6, `release` block (I7), release export with lineage (I5) |

## Open questions

_(none at the moment)_

## Appendix: consumer notes (non-normative)

These notes record where external adapters would live and what they need from Ontocurator. They make no decisions about the adapters' behaviour, which belongs to their repositories.

### phentrieve-benchmark

**Where adapters would live**
- In the benchmark repository, e.g. a subpackage `phentrieve_benchmark.ontocurator`, depending on `ontospan` (I8).
- An exporter writing document and proposal bundles would replace `scripts/build_editor_packages.py` (E6).
- An importer would turn releases into the benchmark's own gold models (`curated-annotation-set`, review decisions, the planned handoff files of its pipeline spec §14).

**What it relies on**
- Verbatim `document_id`s.
- `text_sha256` equal to its `document_sha256`. Both are canonical, but the benchmark keeps a leading BOM and ontospan strips it.
- An ontology pin matching the Ontocurator project. The project pins the OBO Graph JSON file; the benchmark pins `hp.obo`.
- Tool provenance fields for its LLM runs (`model`, `run_id`, notes).
- Preserved IDs (O1), lineage (O3, I5) and release metadata (I7).
- Its guideline rules R3 and R4 map onto the project options O4.

### Phentrieve

**Reading releases.** Phentrieve could read releases directly with ontospan, or read files converted by another consumer into its existing gold format (`phentrieve/benchmark/data_loader.py`).

**What it relies on**
- Document-relative code-point offsets on canonical text (T1 F2). Phentrieve's own line-ending normalization is a no-op on such text.
- The JSON Schema contract if ontospan stays private (I8).
