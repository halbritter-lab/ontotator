# Work Package Format v2 (`ontocurator-work-package/v2`)

## Overview

The work package (`ontocurator-work-package/v2`) is an unencrypted, strictly validated ZIP archive for lossless roundtripping of multi-layered ontology annotation and review tasks between Ontocurator instances. It encapsulates immutable document texts, pinned task profiles, ontology references, snapshots, review submissions, and search provenance.

## Key Changes from v1

- **Format Version**: `ontocurator-work-package/v2` (legacy v1 packages are cleanly rejected at import).
- **TaskProfile**: Mandatory profile declaring multi-ontology bindings, configured layers (`editable` vs `reference`), annotation types, contextual axes, and evidence policies.
- **AnnotationSnapshot V3**: Uses format `ontocurator-annotation/v3` with compound identity `(annotation_id, version)` binding `layer_id`, `type_id`, `term_id`, `axes_values`, `evidence_refs`, `layer_config_sha256`, and `ontology_sha256`.
- **TaskScope**: Deterministic workspace scope computed from task profile and mode (`independent`, `assisted`, `review`), determining layer editability, reference layers, and mandatory checkmark obligations.
- **Embedded vs External Ontologies**: Declared ontologies may be bundled inside the archive (e.g. `ontologies/hp.json`) or resolved externally via `--ontology` CLI flag. Missing ontologies are reported together.

## Archive Structure

A valid v2 work package ZIP archive contains:

1. `manifest.json`: Root package manifest:
   - `format_version`: `"ontocurator-work-package/v2"`
   - `package_id`: Unique identifier of the work package
   - `document_order`: Canonical ordered list of document IDs (`[doc1, doc2, ...]`) preserving case sequence
   - `task_profile`: Full inline `TaskProfile` object
   - `task_profile_sha256`: Canonical SHA-256 digest of `task_profile`
   - `file_hashes`: SHA-256 hex digests for all other payload files in the archive
   - `origin_package_id` & `origin_manifest_hash`: Optional provenance tracking for scoped exports
2. `documents.jsonl`: UTF-8 newline-delimited documents with `document_id`, `text`, `language`, and `text_sha256`.
3. `annotations.jsonl`: Immutable `AnnotationSnapshot` (v3) records.
4. `evidence.jsonl`: Immutable `EvidenceSnapshot` records.
5. `submissions.jsonl`: Immutable `Submission` records with `checked_layer_ids`, `targets`, `snapshots`, and `decisions`.
6. `search-events.jsonl`: Audit log of search operations with `layer_id`, `query`, candidates, ranking, and selections.
7. Optional embedded ontology files declared in `task_profile.ontologies[*].resource_path` (e.g. `ontologies/hp.json`).

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
      "sha256": "279123a1ae5314e4632a0f85be2d82efd50f44ebf0d98e0100ed6859d7cb83e4",
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
