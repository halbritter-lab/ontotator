# Work Package Format v1 (`hpo-editor-work-package/v1`)

## Overview

The work package is an unencrypted, validated ZIP archive for lossless roundtripping of HPO annotation tasks between editor instances. It encapsulates immutable document texts, ontology references, historical or newly created snapshots, review submissions, and search provenance.

## File Manifest

The ZIP archive must contain exactly the following six files at the archive root (no directories, no symlinks):

1. `manifest.json`: Package metadata, format version, pinned ontology reference, axes definition, and SHA-256 hashes of all five JSONL files.
2. `documents.jsonl`: Immutable documents with exact UTF-8 byte hashes.
3. `annotations.jsonl`: Immutable `AnnotationSnapshot` records with compound keys `(annotation_id, version)`.
4. `evidence.jsonl`: Immutable `EvidenceSnapshot` records with compound keys `(evidence_id, version)`.
5. `submissions.jsonl`: Immutable `Submission` records representing finalized review or annotation rounds.
6. `search-events.jsonl`: Audit log of search queries, candidates, displayed positions, and selections.

## Archive Limits & Security Constraints

- Maximum compressed archive size: 64 MiB (67,108,864 bytes).
- Maximum uncompressed total size: 256 MiB (268,435,456 bytes), enforced by streaming counts.
- Maximum number of documents: 10,000.
- Maximum single document text size: 2 MiB (2,097,152 UTF-8 bytes).
- Disallowed: path traversal (`..`), absolute paths, directories, duplicate entries, symlinks.
- Atomic export: ZIP archives are constructed in a temporary file and atomically renamed/replaced.

## Validation Invariants

1. Every file listed in `manifest.json` matches its recorded SHA-256 digest.
2. Every document's UTF-8 byte hash matches its `text_sha256`.
3. Every `AnnotationSnapshot` and `EvidenceSnapshot` matches its RFC-8785 canonical hash `version`.
4. All `evidence_refs` in annotations resolve to an existing `(evidence_id, version)` in `evidence.jsonl`.
5. All references in `Submission` records (`targets`, `snapshots`, `decisions`) resolve within the package.
6. Compound key collision with conflicting content is strictly rejected.
