# T1: Shared Annotation Format (Ontocurator · Phentrieve · Benchmark)

As of: 2026-10-14 · Status: **Design agreed** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E4, E5, E7)

## Starting Point

| | Phentrieve sidecar v1 | Benchmark `AnnotationSet` | Ontocurator `annotation/v3` |
|---|---|---|---|
| Ontology | HPO only (`hpo_id`) | HPO only (`HP:\d{7}`) | any (CURIE, multiple ontologies) |
| Axes | `assertion` mixed (affirmed/negated/uncertain/family_history/unknown) | separate: assertion/experiencer/temporality | freely configurable |
| Spans | `start_char/end_char`; offset reference inconsistent depending on path | `start_char/end_char/text_snippet`, checked against text | codepoint segments, discontinuous mentions, cue segments |
| Document binding | `phenopacket_id` + feature index | `document_sha256` | `document_id` + `text_sha256` |
| Provenance | free-form (`additionalProperties`) | separate `derivations` | `actor{id, kind human/tool}`, `method`, `source_refs` |

## Decisions

### F1: Scope
- The core is **generic** and ontology-neutral.
  - `term_id` is a CURIE. The ontology is given as a resource with version and SHA-256.
  - Axes are freely definable.
  - Every annotation belongs to a **layer** (`layer_id`), and every layer to a **profile**.
  - An annotation set may contain annotations from several layers, e.g. later HPO and MAxO.
- Shipped with it is the strictly validated **profile `hpo-phenotype`** with fixed axes, modifier rules and the Phenopacket mapping. Phentrieve and the benchmark use only this profile.

### F2: Text and offsets
- **Canonical text:** Unicode NFC, LF line endings.
- **Offsets:** Unicode codepoints `[start, end)`, relative to the whole document. Chunk-relative offsets are forbidden.
- **`text_sha256`:** computed over the UTF-8 bytes of the canonical text.
- **Import:** Importers normalize the text and store the hash of the original as `source_text_sha256`.
- **Self-check:** Every segment carries the quoted text (`text`). The validator compares it with the document.

### F3: Container
- **The atomic unit is the "annotated document"**, one JSON file. It contains:
  - the document with `document_id`, language, canonical text and hashes;
  - **exactly one** annotation set.
- **A bundle** is a directory or ZIP file with `manifest.json` and `documents/*.json`.
  - The manifest contains:
    - bundle ID and optional release name;
    - the profiles with `allowed_roots`;
    - the ontology resources with version and SHA-256;
    - `contributors[]`;
    - the hashes of all files.
- Several annotation sets for the same text, e.g. from annotator A, annotator B and the adjudication, are several units in the bundle. Identical `text_sha256` links them.
- Phentrieve writes individual units. Releases and the benchmark use bundles.
- `schema_version` follows SemVer and starts at `1.0.0`.
  - **Minor versions** only add optional fields or new profiles. Readers accept higher minor versions of the same major version and ignore unknown fields. The strict validator checks against the version named in the document; the package ships all minor schemas.
  - **Major versions** are incompatible. Readers reject unknown major versions.

### F4: Annotation model
- An annotation consists of `term_id` and axis values and applies per document. It has 0 to n **mentions**.
- Each mention consists of 1 to n **segments**. Discontinuous mentions are thus allowed.
- In addition there are optional **cue segments**, i.e. the triggering word such as "Keine" or "Verdacht auf".
- The same term with different axis values is a separate annotation.
- Annotations without a mention are document-wide statements. In the HPO profile they are only allowed with `document_level: true`.
- For readers without support for discontinuous mentions there are defined helper functions (`spanning_segment()`, `segments_flat()`). There are no silent losses.

### F5: Allowed terms
- The HPO profile allows **all active HPO terms**. Besides *Phenotypic abnormality* (HP:0000118) these include:
  - *Past medical history* (HP:0032443): surgical, medication, exposure, pregnancy and family history;
  - *Mode of inheritance*;
  - *Biospecimen phenotypic feature*;
  - *Blood group*.
- *Clinical modifier* (HP:0012823) and *Frequency* (HP:0040279) appear only as modifiers (F6), not as annotations of their own.
- According to the HPO definition, *Frequency* (HP:0040279) is the frequency of a feature **within a patient cohort** (e.g. *Frequent* = 30–79 % of cases). It is not really intended for single-case texts. However, it is **not rejected**: *Frequency* terms are allowed as **modifiers** of an annotation, and the validator issues a **warning** for them, not an error. Projects can exclude them via their term selection.
  - How often a finding occurs **in one patient** is described by modifiers under *Temporal pattern* (HP:0011008), e.g. *Recurrent*, *Transient*, *Nocturnal* or *Fluctuating*, or by dedicated phenotype terms such as *Seizure cluster* (HP:0033349).
  - Exact statements such as "3 seizures per week" cannot be represented in HPO. They are preserved in the marked text.
- The restriction is a **project setting**: The manifest lists the allowed root terms as `allowed_roots`.
  - The benchmark project (E3C, rule R0) sets `["HP:0000118"]`.
  - Readers can tell from the manifest for which term space an annotation is complete.
- Consequence for Ontocurator: search and tree show all subtrees or those of the project. The project filter comes with T3.

### F6: Modifiers
- An annotation carries `modifiers[]` with terms from *Clinical modifier* (HP:0012823, 357 terms). Examples are Severity, Laterality, Onset, Pace of progression, Triggered by and Pain characteristic.
- Modifiers can **optionally have their own segments**, e.g. "schwere" → Severe or "beidseits" → Bilateral.
- Modifiers derived from context are also allowed without a segment, e.g. the onset from an age statement.

### F7: Interventions
- HPO covers interventions only as history or exposure. This is covered by F5.
- Ongoing therapies and measures belong to **MAxO** (Medical Action Ontology).
  - A later profile `medical-action` is planned. It maps to the Phenopacket element `medicalActions`.
  - **It will only be implemented when a project needs it.** The core already supports it via layers (F1).
  - Links between annotations, e.g. "therapy treats phenotype", will then be added as an optional field in a minor version (see F3, versioning). Nothing is reserved today.

### F8: Axes of the HPO profile
They correspond to benchmark guideline R3. For experiencer and temporality, `unknown` is added in each case.
- `assertion`: `present` | `absent` | `uncertain`
  - `uncertain` means: the text expresses a suspicion. It does not mean: "I don't know."
- `experiencer`: `patient` | `family_member` | `other` | `unknown`
- `temporality`: `current` | `historical` | `unknown`

Hypothetical statements are not annotated. Therefore there is no `future`.

**Every axis always has a value and a provenance marker:** `{"value": …, "basis": "chosen" | "defaulted"}`.
- **Default** for a new annotation: `present` / `patient` / `current` with `basis: defaulted`.
- Every active choice or confirmation sets `basis: chosen`.
- **Project option `require_chosen_axes`** (default: off): When it is on, submission is only possible once all axes are `chosen`.
- `basis` enables evaluations, e.g. the share of untouched defaults or whether the defaults influence agreement.
- Tools without provenance information set `basis: chosen` only if the value was actually determined. Otherwise they set `defaulted`.

### F9: Phenopacket v2 export (derived and lossy)
- **What goes in:** only annotations with `experiencer: patient`. For `unknown` nothing is exported; it is counted in the report.
- **Exclusion:** `absent` becomes `excluded: true`.
- **Uncertain findings:** `uncertain` is **omitted by default**.
  - With `include_uncertain=true` they are exported as `excluded: false`. The uncertainty is then stated in `evidence[].reference.description`.
- **Modifiers:**
  - Modifiers under *Severity* (HP:0012824) become `severity`.
  - Modifiers under *Onset* (HP:0003674) become `onset.ontologyClass`.
  - All other modifiers become `modifiers[]`.
- **Evidence:**
  - Human-curated annotations get ECO:0000218 ("manual assertion").
  - Tool results get ECO:0007636.
- **Back-reference:** via `evidence[].reference` to bundle, document and `annotation_id` (URN). The spans stay in the annotation format.
- **`metaData.resources`:** HPO version from the manifest.
- **Granularity:** by default one Phenopacket per document. Optionally, documents with the same `subject_id` are combined, e.g. the benchmark's `case_group_id`.
- **Export report:** counts everything that was not mapped, e.g. `uncertain`, family findings and findings in other persons.
- *Frequency* modifiers become `modifiers[]`. Because they are cohort concepts, the export report additionally notes them.
- The `phenopackets` library is an optional extra of the package (`[phenopacket]`).

### F10: Identity and provenance
- **Actors:** Persons appear only as a **project-wide stable pseudonym**, e.g. `ann-03`, with `kind: human`.
  - Name and ORCID appear in `contributors[]` only with consent in the user profile.
  - The mapping from pseudonym to person stays in Ontocurator.
- **Tools:** `kind: tool` with `name`, `version` and optionally `model`/`run_id`.
- **Annotation set:**
  - `set_kind`: `individual`, `stage_result`, `adjudicated`, `release` or `tool_output`.
  - In addition `stage`, `actors[]`, `created_at`, optionally `guideline_ref` and `blind: true|false`. The latter states whether other annotators' annotations were visible.
- **Annotation:**
  - `actor` and `method`: `manual`, `adopted`, `edited`, `merged` or `tool`.
  - `source_refs[]`: which annotations it originated from.

### F11: Matching rules
There is a single implementation in the package. Ontocurator (merge, live agreement) and the benchmark use the same one. For ancestor detection it is passed an ontology hierarchy.

- **Normalization of a segment:** Unicode whitespace and punctuation (category `P*`) are trimmed at the edges. The offsets are shifted; the text stays unchanged.
- **Mentions** are compared as sets of normalized segments:
  - **identical:** equal sets.
  - **compatible:** at least one overlapping codepoint, but not identical.
  - **disjoint:** no overlap.
- **Annotations**, matched per document:

  | Result | Condition |
  |---|---|
  | **equal** | same `term_id`, same axes, identical mentions |
  | **compatible** | same term and same axes, mentions compatible. Not a hard conflict; the merge suggests one variant (default: the longer one). |
  | **axis conflict** | same term, overlapping mentions, different axes |
  | **term conflict** | overlapping mentions, different terms. If one term is an ancestor of the other, `ancestor` is additionally marked. |
  | **A only / B only** | no counterpart |

- Axes are compared only via `value`. `basis` plays no role in matching.
- **Modifiers** are compared per annotation as a term set. Differences are a separate conflict type.
- **Agreement:** metrics always **strict** ("equal" only) **and tolerant** ("equal" or "compatible"). In addition there is term agreement at document level as a set of (`term_id`, axes).

### F12: Repo and distribution
- The package lives in a **new private repo in the user's own GitHub account**. It is developed locally under `Development/<package-name>`.
- Ontocurator includes it as a Git dependency (uv, pinned commit or tag).
- **Consequence:** Public projects such as Phentrieve cannot use a private package as a dependency. For the later Phentrieve and benchmark integration (T7) it will be decided whether the package is published, whether only the JSON Schema is exported, or whether Phentrieve vendors it. Until then **the JSON Schema is the binding contract**.

## Sketch of a Unit (informative, not normative)

```json
{
  "schema_version": "1.0.0",
  "artifact_type": "annotated_document",
  "document": {
    "document_id": "e3c:v2.0.0:en:EN100017:de-tllm-v1",
    "language": "de",
    "text": "Keine Krampfanfälle in der Neonatalzeit. Seit 2 Wochen schwere Krampfanfälle.",
    "text_sha256": "…",
    "source_text_sha256": "…",
    "subject_id": null
  },
  "annotation_set": {
    "annotation_set_id": "…",
    "set_kind": "individual",
    "stage": "annotation",
    "actors": [{"actor_id": "ann-03", "kind": "human"}],
    "created_at": "2026-10-14T12:00:00Z",
    "blind": true,
    "guideline_ref": "phentrieve-benchmark@1e56a18",
    "annotations": [
      {
        "annotation_id": "a1",
        "layer_id": "hpo",
        "term_id": "HP:0001250",
        "axes": {"assertion":   {"value": "absent",  "basis": "chosen"},
                 "experiencer": {"value": "patient", "basis": "defaulted"},
                 "temporality": {"value": "historical", "basis": "chosen"}},
        "mentions": [{"segments": [{"start": 6, "end": 19, "text": "Krampfanfälle"}],
                      "cue_segments": [{"start": 0, "end": 5, "text": "Keine"}]}],
        "modifiers": [],
        "provenance": {"actor": {"actor_id": "ann-03", "kind": "human"}, "method": "manual", "source_refs": []}
      },
      {
        "annotation_id": "a2",
        "layer_id": "hpo",
        "term_id": "HP:0001250",
        "axes": {"assertion":   {"value": "present", "basis": "defaulted"},
                 "experiencer": {"value": "patient", "basis": "defaulted"},
                 "temporality": {"value": "current", "basis": "chosen"}},
        "mentions": [{"segments": [{"start": 63, "end": 76, "text": "Krampfanfälle"}], "cue_segments": []}],
        "modifiers": [{"term_id": "HP:0012828", "segments": [{"start": 55, "end": 62, "text": "schwere"}]}],
        "provenance": {"actor": {"actor_id": "ann-03", "kind": "human"}, "method": "manual", "source_refs": []}
      }
    ]
  }
}
```

The offsets in the sketch have been verified. The JSON Schema and fixtures of the package are binding.

## Not Part of T1

- Translation or document variants (language × version) as a model. This comes with T5. For this the format only needs `document_id`, `language` and hashes. Optional references such as `variant_of` and `previous_text_sha256` are added in T5.
- Migrating Phentrieve and the benchmark to the format (T7).
- Ontocurator's storage model (T2). Ontocurator exports and imports this format but stores data internally according to its own schema.

## Notes for Later Migrations (not format decisions)

- **Phentrieve:** When Phentrieve replaces its sidecar v1 with this format, it has to convert its internal values. Proposal:

  | Phentrieve | shared format |
  |---|---|
  | `affirmed` | `present` |
  | `negated` | `absent` |
  | `normal` | `absent` + note `normal_finding` in the provenance |
  | `uncertain` | `uncertain` |
  | `family_history` | `present` + `experiencer: family_member` |
  | `unknown` | do not export |

  In addition, the chunk-relative offsets of the REST and MCP paths are converted to document offsets (F2).
- **Benchmark:** `build_editor_packages.py` and the planned editor import (spec §8.2) are switched to this format. The restriction to HP:0000118 is retained as `allowed_roots` as long as guideline R0 applies. Guideline R3 has no `unknown`. The benchmark has to define on import how it handles it, e.g. exclude it or evaluate it as a separate category.

## Refinements While Planning (2026-10-14)

- **Package name:** `ontospan`, import `ontospan`. Developed under `Development/ontospan`.
- **Layers inside the unit:** a single annotated document must be self-describing, because Phentrieve writes single units. Therefore `annotation_set.layers[]` declares each layer: `layer_id`, `profile`, ontology resource and `allowed_roots`. The bundle manifest repeats the union of all layers. Units whose layers conflict with each other cannot form a bundle.
- **Ontology `sha256` is optional in the format.** Tools that know only a release version (e.g. Phentrieve's HPO database) can still write valid units. Ontocurator always sets it, and releases carry it.
- **Phenopacket export without a hard dependency:** the export builds the protobuf-JSON structure directly. The `[phenopacket]` extra only adds validation against the official `phenopackets` classes.
