# Work Package Format v2 (`ontotator-work-package/v2`)

## Overview

The work package (`ontotator-work-package/v2`) is an unencrypted, strictly validated ZIP archive for lossless roundtripping of multi-layered ontology annotation and review tasks between Ontotator instances. It encapsulates immutable document texts, pinned task profiles, ontology references, snapshots, review submissions, and search provenance.

## Key Changes from v1

- **Format Version**: `ontotator-work-package/v2` (legacy v1 packages are cleanly rejected at import).
- **TaskProfile**: Mandatory profile declaring multi-ontology bindings, configured layers (`editable` vs `reference`), annotation types, contextual axes, and evidence policies.
- **AnnotationSnapshot V3**: Uses format `ontotator-annotation/v3` with compound identity `(annotation_id, version)` binding `layer_id`, `type_id`, `term_id`, `axes_values`, `evidence_refs`, `layer_config_sha256`, and `ontology_sha256`.
- **TaskScope**: Deterministic workspace scope computed from task profile and mode (`independent`, `assisted`, `review`), determining layer editability, reference layers, and mandatory checkmark obligations.
- **Embedded vs External Ontologies**: Declared ontologies may be bundled inside the archive (e.g. `ontologies/hp.json`) or resolved externally via `--ontology` CLI flag. Missing ontologies are reported together.

## Archive Structure

A valid v2 work package ZIP archive contains:

1. `manifest.json`: Root package manifest:
   - `format_version`: `"ontotator-work-package/v2"`
   - `package_id`: Unique identifier of the work package
   - `document_order`: Canonical ordered list of document IDs (`[doc1, doc2, ...]`) preserving case sequence
   - `task_profile`: Full inline `TaskProfile` object
   - `task_profile_sha256`: Canonical SHA-256 digest of `task_profile`
   - `file_hashes`: SHA-256 hex digests for all other payload files in the archive
   - `origin_package_id` & `origin_manifest_hash`: Optional provenance tracking for scoped exports
   - `search_conditions`: Optional captured search inputs and runtime identities; absent on legacy packages
   - `earlier_search_conditions`: Optional conditions the project searched with before `search_conditions`, oldest first; absent when there are none
   - `unrecoverable_search_condition_ids`: Optional ids of conditions that search events name but the package cannot carry; absent when there are none
2. `documents.jsonl`: UTF-8 newline-delimited documents with `document_id`, `text`, `language`, and `text_sha256`.
3. `annotations.jsonl`: Immutable `AnnotationSnapshot` (v3) records.
4. `evidence.jsonl`: Immutable `EvidenceSnapshot` records.
5. `submissions.jsonl`: Immutable `Submission` records with `checked_layer_ids`, `targets`, `snapshots`, and `decisions`.
6. `search-events.jsonl`: Audit log of search operations with `layer_id`, `query`, candidates, ranking, and selections.
7. Optional embedded ontology files declared in `task_profile.ontologies[*].resource_path` (e.g. `ontologies/hp.json`).
8. Optional captured translations at `search-resources/<sha256>/<filename>`, declared by current or earlier search conditions and covered by `file_hashes`.

## Captured Search Conditions

`search_conditions`, when present, covers the profile's ontology digests. Each
`ontotator-search-condition/v1` record contains a canonical `condition_id`
digest, `ontology_sha256`, `translations`, `index` configuration and captured
`runtime`. Translation declarations retain their filename, digest, archive path
and languages; their bytes are included and validated during import. The
condition digest covers all fields except `condition_id` itself.

The runtime records the application version and artifact digest/kind plus
Python, NumPy, SciPy and scikit-learn versions. Index metadata describes the
selected-language character TF-IDF corpus and ranking/display algorithms.
Resources pin bytes, not precomputed numerical weights. New search events carry
`search_condition_id`, actual `execution` metadata and `runtime_drift`; the
execution records selected fitting languages and request size where applicable.
Historical events without these fields are not attributed to today's runtime.

Capture occurs at first package-specific ontology use for an unconfigured
package. Later ambient uploads cannot mutate its captured resource set. Export
adds this metadata without rewriting original profile, snapshot or origin
manifest hashes. Scoped independent exports retain only conditions/resources
for the projected profile, preserving reference-layer isolation.

### Ended conditions

A move to the newest translations or a change of pins or profile ends a
project's conditions; search events that ran with them keep their
`search_condition_id`. A whole-project export carries every ended condition the
project still has in `earlier_search_conditions`, with its captured files. An
earlier condition need not be bound to the current profile: after a change of
pins it is bound to the ontology it ran with. Only its files are validated.

A change of pins or profile before 0.8.0 deleted the conditions it ended and
their files. They cannot be recovered, and an ended condition whose files the
project no longer has is treated the same way. The export lists their ids in
`unrecoverable_search_condition_ids` instead of failing; the events keep their
`search_condition_id` and nothing else about them is checked.

Import checks every search event: its condition is current, earlier or listed as
unrecoverable. Any other reference fails with `INVALID_PACKAGE` ("Search event
condition is missing or bound to a different ontology"). Only an event of a
current condition must match its layer in the profile. An imported project
keeps the earlier conditions in its stored manifest and their files among its
resources, so its own export carries them again.

An external ontology remains an externally required digest-pinned artifact;
the captured translation bytes travel with the archive. See
[the scientific workflow](scientific-workflow.md#preserve-search-conditions) for
study setup and runtime-drift interpretation.

## Exports and Resubmissions

Two export flavours produce v2 packages with `origin_package_id` / `origin_manifest_hash` set:

- **Workspace export** (`GET /api/v1/workspaces/{id}/export`): one document, one annotator, one mode.
- **Package export** (`GET /api/v1/packages/{package_id}/export?annotator_id=...[&mode=...]`): every workspace of one annotator in the package, all documents in package order. Exports of different annotators share documents, task profile and `origin_manifest_hash`, so they can be compared for inter-annotator agreement.

`submissions.jsonl` is an **append-only audit trail**: when an annotator submits a document, reopens it and submits again, *every* submission is exported, not only the last one. Consumers that want the current result must select the latest submission themselves:

1. Group submissions by their full `origin_key` (`package_id`, `document_id`, `annotator_id`, `mode`, `scope_id`, `target_set_id`). One group is one workspace; its `scope` names the editable layers the submission covers (`scope.editable_layer_ids`), so the latest submission of a group is the latest result for each of those layers of that document and annotator.
2. Within a group, the current submission is the one with the highest `draft_revision`. It is a strictly increasing integer per workspace: every edit and every submit bumps the workspace revision, and a submission records the revision it created. `created_at` is for display and audit only; clocks may differ between machines. Identical duplicate records are accepted, but different records sharing an origin and revision are rejected as conflicting history.
3. Keep people, modes, scopes and review rounds separate. For each group, retain the snapshots in the requested editable layer. Reimported continuation retains its original logical origin and revision sequence. Revisions cannot rank unrelated groups: multiple qualifying origins remain explicitly ambiguous, and separate rounds require a study-defined choice before aggregation.

```python
from ontotator.domain.results import latest_submissions

# Input: validated Submission models, not raw archive JSON.
current = latest_submissions(submissions)
```

Each submission references its complete approved snapshot set and review decisions. The archive also retains original targets, replacement versions and evidence dependencies; these historical records are not additional approved results. A returning reviewer resumes the recorded target set. A new reviewer receives the current submitted results. Cases with no proposals can still be checked and submitted as negative or supplemented with authored findings.

Submitted snapshots and review targets must belong to the mode's editable
layers. Reference-layer snapshots remain valid archive dependencies, but cannot
be submitted results or review targets. Continued work retains its original
logical origin and scope identity, including after an independent export projects
reference layers out of the local profile; completion is validated against the
current local permissions.

Use `ontotator analyze PACKAGE --annotator ID --output results.json` for versioned current-result rows, explicit missing/checked-negative/uncertain states, full evidence and round ambiguity. See [the scientific workflow](scientific-workflow.md) for the two-annotator technical pilot and interpretation rules.

## TaskProfile Schema

```json
{
  "profile_id": "hpo-context-example/v1",
  "version": "1.0.0",
  "preset": "hpo-context-example",
  "ontologies": [
    {
      "ontology_id": "hp",
      "label": "Human Phenotype Ontology",
      "release": "2026-06-23",
      "sha256": "20d4a647b8a3a15569423c96f29a7a9e8f3a14ce59867fe6f0a46fd409d193d0",
      "format": "obo-graph-json",
      "resource_path": "ontologies/hp.json"
    }
  ],
  "layers": [
    {
      "layer_id": "hpo-layer",
      "label": "Phenotypes",
      "ontology_id": "hp",
      "access": "editable",
      "default_visible": true,
      "default_type_id": "phenotype",
      "annotation_types": [
        {
          "type_id": "phenotype",
          "label": "Phenotype",
          "axes": [
            {
              "id": "assertion",
              "label": "Assertion",
              "options": ["present", "absent", "uncertain"],
              "allow_empty": true
            }
          ],
          "evidence_policy": "optional"
        }
      ]
    }
  ],
  "default_layer_id": "hpo-layer"
}
```

## Layer Access Modes & Workspace Scoping

- **`editable` layer**: Can be actively annotated, edited, and checked off. In multi-editable configurations, all editable layers must have their completeness checkmark set before submission.
- **`reference` layer**: Read-only background context (e.g. Mondo disease annotations). Annotators can toggle visibility and inspect reference annotations, but cannot add/modify them or select them as active authoring layers. Reference layers incur zero checking obligations.
- **Single-Layer Optimization**: Packages with a single editable layer and no reference layers automatically hide layer-management controls, ensuring zero mandatory extra clicks for standard single-ontology curation workflows.

## Archive Limits & Security Constraints

- Maximum compressed archive size: 64 MiB (67,108,864 bytes).
- Maximum uncompressed total size: 256 MiB (268,435,456 bytes).
- Disallowed: path traversal (`..`), backslashes, absolute paths, duplicate ZIP entries, symlinks.
- Non-manifest files not explicitly declared in `BASE_ALLOWED_FILES` or `resource_path` are rejected.
- Offline runtime: Zero external network requests; all operations execute locally against SQLite and embedded/local ontology graphs.
