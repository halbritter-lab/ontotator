# T7: Integrations (Benchmark Import/Export, Release Reader for Phentrieve)

Date: 2026-10-14 · Status: **draft, questions open** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E4, E5, E6, E7, E8) · Builds on T1 (`ontospan`), T2 (D5), T3 (A1), T4 (W4, W7), T5 (V4, format 1.1)

T7 connects Ontocurator to the two neighbouring repositories through the T1 format only:
- the benchmark sends corpora and machine proposals **into** Ontocurator;
- Ontocurator releases flow **back** into the benchmark and on to Phentrieve's evaluation.

There is no live coupling, no Phentrieve pre-annotation (E5) and no shared database.

## Starting point

Facts as of benchmark HEAD `373b45a`, Phentrieve HEAD `8433995` and ontospan HEAD `6709c3a`.

### Benchmark (`phentrieve-benchmark`)

**Corpora**
- **E3C v2.0.0 layer 1:** 246 reports (84 EN, 81 FR, 81 ES).
  - They are split into four annotation groups, DE 61, EN 63, FR 61 and ES 61 (`datasets/e3c-de/selections/e3c-annotation-groups-v1.json`).
  - Each report is annotated in exactly one language. Groups are never pooled (pipeline spec §14).
- **RAG-HPO GSC (114) and CSC (116):** stored in `datasets/raghpo/`. Their `AnnotationSet`s carry document-level HPO IDs with empty `evidence_spans`. Work on them is paused.

**Documents**
- `models/document.py` defines document IDs such as `e3c:v2.0.0:en:EN100017:native`. Each document has a `case_group_id` and a `document_sha256`.
- The canonical text is defined by `provenance/canonical.py::canonical_text_bytes`: NFC, then CRLF/CR → LF. Unlike `ontospan.canonical_text`, it does **not** strip a leading BOM.
- Offsets are zero-based, half-open Unicode code points. E3C XMI offsets are UTF-16 and are mapped by `normalization/text.py::utf16_span`.

**Gold models**
- `models/annotation.py` (`annotation-set/v1`).
- `models/curated_annotation.py` (`curated-annotation-set/v1`): content-hash IDs and `derivations`.
- `models/review_decision.py` (`review-decision-set/v1`): outcomes `confirmed | rejected | changes_requested` and an optional `counterproposal`.
- `curated-annotation-set/v2` is specified but not built (`docs/superpowers/specs/2026-10-06-e3c-multilingual-span-annotation-design.md` §8.1). It adds `family_member`, drops `future`, and adds the derivation source `llm_proposal`.

**Guideline** (`docs/annotation-guidelines/hpo-span-annotation.md`)
- R0: only terms under HP:0000118, HPO v2026-06-23.
- R3: axes without `unknown`.
- R4: no discontinuous spans.
- R5: all occurrences with the same term and status form one annotation.
- R7: a text correction creates a new document version.

**LLM proposals** (`datasets/e3c-de/proposals/`)
- 13 runs, with models `claude-sonnet-5-5` and `claude-opus-5-5`. Each run has:
  - `run.json` (`e3c-hpo-proposal-run/v1`), which records the model, prompt, guideline commit and the HPO and corpus hashes;
  - raw batches without offsets;
  - `validation.json` (`e3c-hpo-proposal-validation/v1`) with resolved code-point offsets.
- `current-proposals.json` selects the current run per document: 185 reports, 2,242 proposals and 2,718 mentions. The German group is not yet included.
- The UMLS→HPO mapping of E3C entities is stored separately (`datasets/e3c-de/mappings/`).

**Translations**
- The raw snapshot is `datasets/e3c-de/translations/e3c-de-full-246-google-tllm-v1/`.
- The 61 texts of the German group are reviewed in `e3c-de-group-61-review-v1/`. That folder holds `translation-review-record/v1` records, diffs and an import manifest; the resulting annotation corpus is `ba3f557f…`.
- The review was an **LLM-supported pre-review** (`antigravity-gemini-4-argon-pre-review-v1`), not a physician adjudication. 35 texts were accepted unchanged and 26 corrected.

**Editor interface**
- `scripts/build_editor_packages.py` builds `ontocurator-work-package/v2` ZIPs, with or without proposals. It runs in an overlay environment (`uv run --with-editable ../ontocurator`).
- Text-free build records are kept in `datasets/e3c-de/editor-packages/`.
- The import back (spec §8.2: export → `ReviewDecisionSet` + curated v2 + review statistics) is designed but not implemented.

**Evaluation and handoff**
- Scoring lives in the sibling repository `phentrieve-manuscript` (`experiments/benchmarking/`). It reads Phentrieve's per-document gold JSON and projects it to document-level HPO ID sets (`projection: positive_hpo_present_v1`).
- The planned handoff bundle (pipeline spec §14) includes `phentrieve/annotations/*.json` in that same contract.
- The `ReleaseManifest` (`models/manifest.py`) exists, but release generation is not built.

### Phentrieve

**Gold loading**
- Gold is read by `phentrieve/benchmark/data_loader.py::load_benchmark_data`. It dispatches by path shape and has no registry.
- Directory format: `<base>/<DATASET>/annotations/*.json` with `{doc_id, language, source, full_text, metadata, annotations:[{hpo_id, label, assertion_status, evidence_spans:[{start_char,end_char,text_snippet}]}]}`.
- The normalized output dict is the de facto internal contract for `extraction_benchmark.py`, `llm_benchmark.py` and `run_identity.py`.

**Metrics**
- Metrics are document-level `(hpo_id, assertion)` sets (`evaluation/extraction_metrics.py`, `assertion_metrics.py`). Evidence spans are only echoed in detailed output.
- Assertions map through `CANONICAL_ASSERTION_MAP` to `PRESENT | ABSENT | UNCERTAIN | FAMILY_HISTORY`.

**Sidecar** `phenotype_annotation_bundle` v1 (`phentrieve/phenopackets/schemas/…v1.schema.json`, `phenopackets/sidecar.py`)
- It is write-only; nothing reads it back.
- Its spans are whole chunks, not mentions. Offsets refer to the raw input before line-ending normalization.
- Mention offsets elsewhere are chunk-relative.

**Packaging**
- Python ≥ 3.11. Pydantic is only transitive (2.13). Typer is pinned < 0.26.
- The repository is public. There is no mention of `ontospan` or `ontocurator`.

### ontospan (T1, implemented)

**Public API**
- `canonical_text`, `make_document`, `segment`, `validate`, `load_annotated_document`, `read_bundle`/`write_bundle`.
- `match_annotations`/`agreement`.
- `to_phenopacket(s)`.
- The `urn:ontospan:` references.

**Missing pieces**
- No helper maps offsets of a raw text onto its canonical text. The T1 plan note for T7 asks for one (CRLF, NFC, BOM).
- The `Manifest` has `bundle_id`, `release_name`, `created_at`, `layers`, `contributors` and `files`. It has no field for the release a bundle supersedes, the producing tool or the project.

**Repository:** private (`janpower/ontospan`). Ontocurator pins it as a Git dependency (T1 F12).

## Goals

1. **Corpus and proposal export from the benchmark** as T1 bundles. It replaces `build_editor_packages.py` (E6) and is imported via the admin CLI (T2 D5) or the upload page (T3 A1).
2. **LLM proposals become Ontocurator proposals** with full provenance back to run, batch and proposal ID.
3. **Release import into the benchmark:** an Ontocurator release becomes the benchmark's curated gold, review statistics and the Phentrieve/manuscript handoff files, reproducibly and hash-linked.
4. **Phentrieve evaluates against releases** without a live link (E5).
5. **One offset and canonical-text implementation** for all importers, in `ontospan`.

## Non-goals

- Phentrieve output as Ontocurator proposals (E5).
- Migrating the Phentrieve sidecar v1 to ontospan. E4 foresees it, but no T7 data flow needs it (see open question Q6).
- Span-level scoring inside Phentrieve (Q5).
- Calling translation providers or LLMs from Ontocurator (T5).
- Importing `ontocurator-work-package/v2` or implementing the benchmark spec §8.2 adapter for the old editor (E6). §8.2 is superseded by I7.
- Scoring rules and headline metrics. They stay in the benchmark and the manuscript repository (E7).
- CI pipelines. GitHub Actions are not available, so all checks in this spec run locally (I12).

## Decisions

### I1: All exchange is ontospan bundles; converters live next to the data they own

| Component | Repository | Role |
|---|---|---|
| `ontospan.offsets` (new module) | ontospan | Maps raw or UTF-16 offsets onto canonical text (I3). |
| Manifest `release` block (format minor) | ontospan | Release metadata (I9). |
| `phentrieve_benchmark.ontocurator` (new subpackage) | benchmark | Exporter (I4, I5) and release importer (I7, I8). |
| Ontocurator import/export | Ontocurator (T2/T3/T4) | Requirements O1–O6 below; no T7-specific code paths. |
| Phentrieve | – | Phase 1: no change. It reads converted files (I8). Phase 2 is optional (Q6). |

- The benchmark is the hub. It knows corpus identities, proposal runs, guideline versions and the manuscript handoff. Ontocurator stays generic and knows nothing about E3C.
- The benchmark depends on `ontospan` as a pinned Git dependency (tag), like Ontocurator.
  - The `--with-editable ../ontocurator` overlay is dropped: the benchmark no longer imports Ontocurator code.
  - Without CI there is no token problem; local `uv sync` uses the developer's Git credentials.
- Benchmark CLI commands (Typer, under `phentrieve-benchmark ontocurator …`):
  - `export-corpus`;
  - `import-release`;
  - `export-phentrieve-gold`;
  - `import-translation-reviews`.

### I2: Identity is kept verbatim across systems

- **`document_id`:** the benchmark `document_id` is used verbatim, e.g. `e3c:v2.0.0:de:EN100022:translated`. `subject_id` is the benchmark `case_group_id` if present.
- **`text_sha256`** must equal the benchmark `document_sha256`. The exporter checks this for every document and fails on a mismatch.
  - The only known source of difference is a leading BOM. The benchmark keeps it; ontospan strips it.
  - The benchmark adopts `ontospan.canonical_text` for new artifacts. Existing corpus documents are checked once for a leading BOM; none is expected.
- **Imported IDs are preserved** by Ontocurator (requirement O1): `annotation_set_id`, `annotation_id` and the bundle ID. Release lineage therefore resolves to the benchmark's proposal IDs without a lookup table.
- **Pseudonyms** map deterministically to the benchmark's `namespace:id` form: `ontocurator:<project-slug>:<actor_id>`, e.g. `ontocurator:e3c-de:ann-03`. This removes the §8.2 import configuration that mapped free-text editor initials.

### I3: Offsets onto canonical text (`ontospan.offsets`)

Every importer with pre-existing offsets uses one function:

```python
canonical, offset_map = canonicalize_with_offsets(raw)            # raw: str
start, end = offset_map.span(raw_start, raw_end)                   # code points
start, end = offset_map.span_utf16(u16_start, u16_end)             # UTF-16 input (E3C XMI, JS)
```

**Fast path:** if `canonical_text(raw) == raw`, the map is the identity. This is the expected case for the whole benchmark corpus.

**Construction**
- The raw text is split into runs at stable boundaries: code points with canonical combining class 0 that do not compose with their predecessor.
- Each run is normalized to NFC on its own. CRLF/CR → LF and the leading BOM are handled as explicit deletions.
- The concatenation of the runs must equal `canonical_text(raw)`. Otherwise the function raises, so there is no silent fallback.

**Boundary rule: no snapping**
- A start or end offset that falls *inside* a run whose length changed is an error `offset_inside_normalization`. Examples are offsets between `\r` and `\n`, or between a base letter and a combining mark that NFC merges.
- The importer lists such spans and refuses the document, as T1 does with other loss. Snapping would silently change gold spans.

**Self-check**
- After mapping, the segment text is `canonical[start:end]`.
- If the source carries a snippet, `canonical_text(snippet)` must equal it. Otherwise the error is `snippet_mismatch`.

**Scope**
- This is a library addition only: no schema change, and `schema_version` is unaffected.
- Conformance cases cover CRLF, lone CR, BOM, combining sequences, Hangul jamo, astral characters (UTF-16 surrogate pairs) and an offset inside a changed run.

### I4: Corpus export (benchmark → Ontocurator)

`export-corpus` writes one ontospan bundle per annotation group and language. Groups are never mixed in one bundle, matching §14.

**Units**
- One unit per document. The document is the canonical corpus text.
- Its annotation set is either:
  - the current LLM proposal set for that document (I5); or
  - an **empty corpus set**: `set_kind: tool_output`, actor `{actor_id: "phentrieve-benchmark", kind: tool, name: "phentrieve-benchmark-corpus", version: <benchmark commit>}`, no annotations.

  Ontocurator imports an empty set as a document without proposals (requirement O2).

**Layer**
- `hpo`, profile `hpo-phenotype`, `allowed_roots: ["HP:0000118"]` (R0).
- The ontology is `{id: hp, version: v2026-06-23, sha256: <hp.json>}`.
- The SHA-256 is that of the **OBO Graph JSON** file uploaded to the Ontocurator project, not the benchmark's pinned `hp.obo`. The benchmark ontology config gains `obograph_json_sha256` so the two pins are linked. T3 A1 refuses a bundle whose pin differs from the project's.

**`guideline_ref`:** `phentrieve-benchmark@<guideline_commit>` of the proposal run, or of the current guideline for empty sets.

**Blind versus proposal packages**
- There is no separate blind build. Whether proposals are visible is the per-stage policy of T4 W4.
- One bundle per group is therefore enough.

**Determinism**
- The `created_at` and `bundle_id` of the manifest derive from the inputs:
  - `bundle_id` = `e3c-<lang>-<group>-<content hash prefix>`;
  - `created_at` = the latest input timestamp.
- Rebuilding reproduces the manifest hash.
- A text-free build record (`ontospan-export-build/v1`) replaces `e3c-editor-package-build/v1`. It stores the manifest SHA-256, proposal index hash, runs, corpus manifest hash and guideline commits.
- The builder refuses a changed record under the same version, as today.

**Translations:** German documents carry the T5 format 1.1 fields:
- `case_id` = the benchmark `source_case_id`;
- `variant.origin: machine_translation` or `correction`;
- `derived_from` = the source text hash;
- `translation` = provider, model, recipe ID and checks.

The source-language original is exported as a `native` variant of the same case. It is used for the side-by-side view (T5 V3) and is not assigned for annotation. The translation status sent with it depends on Q4.

### I5: LLM proposals → Ontocurator proposals

Source: `current-proposals.json` → each run's `run.json` and `validation.json`. Only validated mentions are used; rejected mentions are not imported and are counted in the build record.

| ontospan | from |
|---|---|
| `annotation_set_id` | `e3c-proposals:<run_id>:<case_id>` |
| `set_kind` | `tool_output` |
| `actors[0]` | `{actor_id: "llm:<model_id>", kind: tool, name: "phentrieve-benchmark-proposals", version: <prompt_sha256>, model: <model_id>, run_id: <run_id>}` |
| `annotation_id` | `<run_id>:<case_id>:<proposal_id>` (as in today's packages) |
| `term_id`, axes | proposal `hpo_id`, `assertion`, `experiencer`, `temporality`, each with `basis: chosen` (the model determined them, T1 F8) |
| `mentions` | one per validated mention, one segment each. Segment text is taken from the canonical text. |
| `provenance` | `method: tool`, `notes: ["validation_sha256:<…>", "verbalized:<bool>", "note:<model note>"]` |

- Proposals are mapped 1:1 to annotations and are not merged by R5. This keeps every proposal individually traceable for the review statistics (I7). Merging happens in curation.
- `verbalized` is no longer an axis (R6 revision of 2026-10-09). It is kept as a note so that a reviewer can see it.
- `hpo_label` is not exported. Labels come from the pinned ontology.
- For the German group, proposals exist only once a run covers it. Until then its units carry the empty corpus set.

### I6: Requirements on Ontocurator (fed into T2–T5 plans)

| # | Requirement | Spec |
|---|---|---|
| O1 | Imported `annotation_set_id`, `annotation_id` and bundle ID are stored and kept, and every derived annotation's `source_refs` uses `urn:ontospan:` references to them. | T2 D5, T3 A1 |
| O2 | An imported empty annotation set creates the document only, with no proposal set. | T2 D5, T3 A1 |
| O3 | Release annotations carry, in `source_refs`, both their direct parents and the **transitive imported origins**, i.e. the proposal annotations they descend from. This makes statistics possible from the release alone (I7). | T4 W7 |
| O4 | A project option `contiguous_mentions_only`, checked at submission (benchmark R4). A project option restricting axis values, so `unknown` can be hidden for experiencer and temporality (R3). | T3 A5 |
| O5 | A revise stage can take an imported proposal set as its input. This gives the checklist that forces a decision per proposal (T4 W2). It is used only if Q2 chooses that flow. | T4 W1/W2 |
| O6 | The release bundle fills the manifest `release` block (I9). | T4 W7 |

### I7: Release import (Ontocurator → benchmark gold)

`import-release <bundle> --proposals <export bundle(s)>`:

1. **Verify**
   - The bundle is read with `ontospan.read_bundle` with the HPO ontology loaded. Any error stops the import.
   - Every unit's `text_sha256` must equal the `document_sha256` of a corpus document.
   - `release_name` must be set, and the units must have `set_kind: release`.
   - Exports of submissions or stage results (T3 A5) are refused, because the benchmark cites only releases (E8).
2. **Enforce guideline constraints**
   - Discontinuous mentions are an error (R4).
   - Axis value `unknown` is an error (R3, the T1 note on `unknown`).
   - Terms outside HP:0000118 are already caught by `allowed_roots`.
   - All three checks are redundant with O4 but are not trusted to it.
3. **Map to `curated-annotation-set/v2`** (implemented in the same phase as §8.1 requires):
   - Each ontospan annotation becomes one curated annotation. Its mentions become `evidence_spans`, with the snippet taken from the corpus text.
   - Same term and axes with several mentions is already R5's shape.
   - Derivations:
     - source kind `ontocurator_release` (release bundle ID, manifest SHA-256, annotation reference);
     - plus `llm_proposal` for every transitive origin in `source_refs` (O3) that resolves to an exported proposal (validation hash from the note, proposal ID from the annotation ID).
4. **Review decisions** are derived by content comparison. For each exported proposal, the release annotations whose `source_refs` contain it are compared with `ontospan.match_annotations`:
   - **equal** → `confirmed`;
   - **any difference** → `changes_requested` with the release annotation as `counterproposal`; the scope is derived from the match result (term, axes or span);
   - **not referenced** → `rejected`;
   - **no proposal origin** → reviewer addition.

   Reviewer = the release set's adjudicating or final actor pseudonym (I2). `decided_at` = release `created_at`, truncated to whole UTC seconds.
5. **Review statistics** (§8.2, text-free, per group): confirmed unchanged, changed (term, span, axes), rejected, added, and the share of gold that originates from a proposal.
6. **Record**
   - A text-free `ontocurator-release-import/v1` record, tracked in git. It stores the release name, bundle ID, manifest SHA-256, the release it supersedes, the ontospan version, counts, and the hashes of all derived artifacts.
   - The release bundle itself goes to the content-addressed object store (`.artifacts/objects`), because it contains texts.

**Superseding releases:** a new release with `supersedes` (I9) produces a new import record. The earlier one stays valid and citable.

### I8: Release → Phentrieve and manuscript evaluation

**Phase 1 (decided): converter in the benchmark, no Phentrieve change.**
- `export-phentrieve-gold` writes Phentrieve's existing directory format `<out>/<STRATUM>/annotations/<doc>.json`, which is also §14's `phentrieve/annotations/`.
  - There is one stratum per annotation group and language. Native and translated documents never share a stratum.
- **Fields:**
  - `doc_id` = `document_id`;
  - `full_text` = canonical text;
  - `language`;
  - `metadata` = `{release_name, bundle_id, manifest_sha256, projection}`;
  - `annotations[]` with `hpo_id`, `label` (from the pinned ontology), `assertion_status` and `evidence_spans`. Evidence spans are one per mention; a document-level annotation has an empty list.
- **Named, versioned projections** decide how the three axes collapse into Phentrieve's single `assertion_status`:
  - `ontospan-patient-present/v1`: `present` + `patient` → `affirmed`. Everything else is dropped. This is equivalent to the manuscript's `positive_hpo_present_v1`.
  - `ontospan-assertion-aware/v1`, for `patient`: `present` → `affirmed`, `absent` → `negated`, `uncertain` → `uncertain`. For `family_member` + `present` → `family_history`. `other` is dropped, and temporality is ignored.

  Which projection is the headline is a scoring question (Q5). The converter writes both on request.
- **Report:** every conversion writes a text-free report with dropped counts per reason (experiencer, temporality, assertion, projection) and the input and output hashes. `run_identity.py` in Phentrieve fingerprints the files as today, so no Phentrieve change is needed.
- **Offsets:** Phentrieve treats `full_text` as is. The text is already LF and NFC, so Phentrieve's `normalize_line_endings` is a no-op, and document offsets stay valid.

**Phase 2 (only if Q6 says so): native reader in Phentrieve.**
- `phentrieve/benchmark/ontospan_loader.py` reads a release bundle and returns the same normalized dict as `load_benchmark_data`. It is dispatched there when the path is a bundle (a `manifest.json` with `artifact_type: bundle`).
- `ontospan` is imported lazily through an extra `phentrieve[ontospan]`.
- The projections of phase 1 move into ontospan as data (a small `projections` module), so both paths count identically (E7).

### I9: Release metadata in the manifest (format minor)

The manifest gains an optional `release` object:
- `name`;
- `description`;
- `project_id`;
- `producer {name, version}`;
- `supersedes[]` (`bundle_id`, `manifest_sha256`).

`release_name` stays for compatibility and must equal `release.name` when both are present.
- **Versioning:** this ships together with T5's 1.1 if 1.1 is not yet released, otherwise as 1.2. It is a minor version per T1 F3: new optional fields only.
- **Where it is filled:** Ontocurator fills it for releases (O6). The benchmark exporter fills only `producer`.

### I10: Translations

- **Export:** German texts and their source originals are exported as described in I4.
- **Review results:** a review done in Ontocurator (T5 V1) is exported as `translation-review-record/v1` with the German decision values mapped back.
  - `import-translation-reviews` adds them to a new review import manifest and corpus manifest, replacing the Excel round trip.
  - An `accepted_corrected` review produces a new German document (R7): a new `document_id` version and a new `document_sha256`. Annotations stay bound to the version they were made on.
- **No span projection** across languages (T5 V2, benchmark §8.4).

### I11: Versioning and provenance summary

- **Artifacts:** every artifact crossing a repository border is an ontospan bundle with a manifest hash. Every converter writes a text-free record with:
  - the input hashes, output hashes and tool versions (package version and git commit);
  - the ontospan version and `schema_version`;
  - the HPO release and SHA-256;
  - the projection ID where one applies.
- **The chain is fully hash-linked:** benchmark build record → manifest hash → Ontocurator import (audit event, T3 A1) → release `source_refs` → release manifest hash → import record → derived gold and Phentrieve files.
- **Text placement:** texts stay out of git in the benchmark object store. Text-free records are tracked.
- **Line endings:** bundles checked into any repository need `*.json text eol=lf` (ontospan README).

### I12: Testing (local only)

GitHub Actions are not available. Every repository runs `uv run pytest` locally, and the cross-repository check is a local script. There are no workflow files.
- **ontospan**
  - Unit and conformance tests for `ontospan.offsets` (I3 cases).
  - Schema tests for the 1.x `release` block, keeping the frozen 1.0 files unchanged.
  - A new fixture set `conformance/integration/`:
    - a small corpus export bundle with proposals;
    - a matching release bundle with lineage `source_refs`;
    - the expected Phentrieve directory output for both projections.
- **Benchmark**
  - Exporter tests: identity check (I2), BOM and hash mismatch failure, deterministic manifest hash, proposal mapping (I5).
  - Importer tests on the integration fixtures: verification failures, R3/R4 enforcement, review-decision derivation for every outcome, statistics, and golden-file outputs.
  - Projection tests.
- **Ontocurator:** an API-level test imports the fixture export bundle, annotates through the service, creates a release and checks O1, O3 and O6 on the exported bundle. It runs from T4 on.
- **Phentrieve (phase 1):** a test that `load_benchmark_data` reads the fixture's directory output and that `benchmark extraction run` completes on it. Phase 2 adds equivalence between the native reader and the directory output.
- **Cross-repository smoke check:** `scripts/check_ontocurator_roundtrip.py` in the benchmark uses sibling checkouts. It exports, imports into a throwaway Ontocurator (dev compose), releases, re-imports and converts. It is run by hand before tagging any of the three repositories. An optional local pre-push hook may call it.

## Sequencing relative to T2–T5

| Phase | With | Content | Needs |
|---|---|---|---|
| T7a | now, parallel to T2 | `ontospan.offsets`; benchmark `export-corpus` and proposal mapping (I4, I5) tested against ontospan validation only; `obograph_json_sha256` pin | T1 |
| T7b | T2 D5 | First real import through `ontocurator admin import`; verify O1, O2 | T2 |
| T7c | T3 | Upload through the admin page; project option O4 | T3 |
| T7d | T5 | Format 1.1 variant fields in the export; `import-translation-reviews` | T5 |
| T7e | T4 W7 | Manifest `release` block (I9), O3, O5, O6; `import-release`, curated v2, review decisions, `export-phentrieve-gold` | T4 |
| T7f | optional | Phentrieve native reader (I8 phase 2) | Q6 |

The release importer and the Phentrieve converter can be written against the ontospan integration fixtures before T4 exists. Only the end-to-end check waits for T4.

## Open questions

Decisions on user flow and curation, to be answered by the user.

**Q1: Which corpora and proposal layers go into Ontocurator?**
- (a) The E3C four annotation groups with the current LLM proposals only.
- (b) Also the E3C UMLS→HPO mapped entities as a second proposal set.
- (c) Also RAG-HPO GSC/CSC, which have document-level gold only and are paused.
- (d) Also Phentrieve's test gold sets (GSC+, ID-68, GeneReviews).

*Recommendation: (a).* A second proposal source doubles review effort and mixes provenance. (c) and (d) have no open curation task.

**Q2: How do annotators meet the LLM proposals?**
- (a) Assisted review: one annotator per document revises the proposals with the decide-every-proposal checklist (O5). This matches today's proposal packages and §8.2.
- (b) Blind double annotation (k=2, proposals `hidden`), then adjudication.
- (c) (a) for the bulk, plus a blind subsample per group (e.g. 10 documents) annotated with proposals hidden, to measure anchoring.

*Recommendation: (c).* §8.2 notes that anchoring stays unmeasured with (a) alone. (b) for all 246 reports is likely beyond annotator capacity.

**Q3: What happens to existing benchmark gold (RAG-HPO GSC/CSC, Phentrieve test sets)?**
- (a) It stays outside Ontocurator.
- (b) It is imported as proposals from an external human actor when spans are to be re-annotated.
- (c) It is imported as a frozen "external release".

*Recommendation: (a) now, (b) only for a concrete re-annotation project, never (c).* Ontocurator releases should contain only work curated in Ontocurator.

**Q4: Which status do the 61 German translations get?** They passed an LLM-supported pre-review, not a physician review.
- (a) Import them as `accepted` with the benchmark review records, so annotation can start.
- (b) Import them as `ready_for_review` and run a physician review in Ontocurator (T5) before annotation.
- (c) (a) now, with a physician review in parallel. Corrections create new versions (R7) and force re-anchoring.

*Recommendation: (b).* The release manifest reports physician review coverage, and T5 exists for this. The EN, FR and ES groups can start annotation meanwhile.

**Q5: What does Phentrieve do with the gold, and which projection is the headline?**
- (a) Document-level extraction evaluation only, with both projections reported (present-only patient, assertion-aware).
- (b) Additionally span-level evaluation. This needs mention-level document offsets in Phentrieve first.
- (c) Also use the gold for tuning, few-shot examples or thresholds.

*Recommendation: (a) now. (b) later as a Phentrieve project. Not (c) with test gold, because of leakage.* The headline projection is decided in the benchmark after annotation (benchmark spec §10).

**Q6: Should ontospan be published so that Phentrieve can read releases natively and later migrate its sidecar?**
- (a) Publish on PyPI (public repository and licence), then add the `phentrieve[ontospan]` reader and later the sidecar v1 → ontospan migration (E4).
- (b) Keep ontospan private. The benchmark converts releases into Phentrieve's existing format (I8 phase 1).
- (c) Vendor the JSON Schemas into Phentrieve with a minimal reader.

*Recommendation: (b) now. (a) once span-level evaluation (Q5b) or the sidecar migration is wanted.* (c) duplicates the matching rules that E7 wants in one place.

**Q7: Does a release carry the individual and stage sets as well?** They would be pseudonymised, under the same release name.
- (a) Yes, always.
- (b) Only in a separate lineage bundle visible to project leads.
- (c) No. Final sets only.

*Recommendation: (a).* E7 puts the citable agreement in the benchmark, and that needs the individual sets. Statistics against proposals already work without them (O3).

**Q8: When does E3C annotation start?**
- (a) Now, in the local editor with v2 packages. Its data is not carried over (E6), and the §8.2 adapter would have to be built.
- (b) After T2, on the server with the existing review mode. Gold follows with T4 releases.
- (c) After T4.

*Recommendation: (b).* No throwaway adapter is needed, and submissions are already in the T1 format.
