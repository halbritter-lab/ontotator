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

## Exports and Resubmissions

Two export flavours produce v2 packages with `origin_package_id` / `origin_manifest_hash` set:

- **Workspace export** (`GET /api/v1/workspaces/{id}/export`): one document, one annotator, one mode.
- **Package export** (`GET /api/v1/packages/{package_id}/export?annotator_id=...[&mode=...]`): every workspace of one annotator in the package, all documents in package order. Exports of different annotators share documents, task profile and `origin_manifest_hash`, so they can be compared for inter-annotator agreement.

`submissions.jsonl` is an **append-only audit trail**: when an annotator submits a document, reopens it and submits again, *every* submission is exported, not only the last one. Consumers that want the current result must select the latest submission themselves:

1. Group submissions by their full `origin_key` (`package_id`, `document_id`, `annotator_id`, `mode`, `scope_id`, `target_set_id`). One group is one workspace; its `scope` names the editable layers the submission covers (`scope.editable_layer_ids`), so the latest submission of a group is the latest result for each of those layers of that document and annotator.
2. Within a group, the latest submission is the one with the highest `draft_revision`. It is a strictly increasing integer per workspace: every edit and every submit bumps the workspace revision, and a submission records the revision it created. Use `created_at` (ISO-8601 UTC timestamp) only as a tie-breaker / for display; it is not guaranteed to be monotonic across machines with skewed clocks.
3. To get one result per *(document, annotator, layer)*, take the latest submission of each group whose `scope.editable_layer_ids` contains the layer and keep only its snapshots with that `layer_id`. If several groups qualify (e.g. different modes, or work continued after re-importing an export, which keeps the original `origin_key.package_id`), `draft_revision` is not comparable across groups; pick by `created_at` and report the ambiguity rather than merging.

```python
latest = {}
for sub in submissions:
    k = tuple(
        sub["origin_key"][f]
        for f in (
            "package_id",
            "document_id",
            "annotator_id",
            "mode",
            "scope_id",
            "target_set_id",
        )
    )
    if k not in latest or (sub["draft_revision"], sub["created_at"]) > (
        latest[k]["draft_revision"],
        latest[k]["created_at"],
    ):
        latest[k] = sub
```

Earlier submissions are never needed to interpret the latest one: each submission carries the complete set of snapshots and decisions of the workspace at that revision.

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
