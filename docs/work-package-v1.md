# Work Package Format v1 (Historical Reference)

> [!NOTE]
> This document describes the legacy v1 work package format (`ontocurator-work-package/v1` and `hpo-editor-work-package/v1`).
> For the current multi-layer task profile format, see [Work Package Format v2](work-package-v2.md).
> Ontocurator rejects v1 work packages at import to guarantee strict layer and profile integrity.

## Overview


The work package is an unencrypted, validated ZIP archive for lossless roundtripping of ontology annotation tasks between editor instances. It encapsulates immutable document texts, ontology references, historical or newly created snapshots, review submissions, and search provenance.

Supported format versions:
- `ontocurator-work-package/v1`: Current default format supporting configurable axes profiles and arbitrary OBO Foundry ontologies.
- `hpo-editor-work-package/v1`: Legacy v1 format preserved for 100% backward compatibility.

## File Manifest

The ZIP archive must contain exactly the following six files at the archive root (no directories, no symlinks):

1. `manifest.json`: Package metadata, format version, pinned ontology reference, axes definition, optional inline axes profile config (`axes_config`), profile hash (`axes_config_sha256`), and SHA-256 hashes of all five JSONL files.
2. `documents.jsonl`: Immutable documents with exact UTF-8 byte hashes.
3. `annotations.jsonl`: Immutable `AnnotationSnapshot` records with compound keys `(annotation_id, version)`.
4. `evidence.jsonl`: Immutable `EvidenceSnapshot` records with compound keys `(evidence_id, version)`.
5. `submissions.jsonl`: Immutable `Submission` records representing finalized review or annotation rounds.
6. `search-events.jsonl`: Audit log of search queries, candidates, displayed positions, and selections.

## Axes Profiles & Resolution Precedence

Work packages associate each task with a defined set of context axes. Profiles are resolved at import/upload using the following precedence:
1. **Inline Manifest Profile**: If `manifest.axes_config` is explicitly specified (including empty `[]`), it takes precedence. Its canonical hash must match `manifest.axes_config_sha256`.
2. **Built-in System Profiles**: Built-ins `editor-axes/v1` and `clinical-phenotype/v1` are resolved automatically without requiring external config files. Attempting to override these reserved names with contradictory configurations is rejected.
3. **CLI Fallback (`--axes-config PATH`)**: When starting the server (`ontocurator serve --axes-config path/to/axes.json`), an external JSON profile definition can be loaded. If a package declares an `axes_definition` matching this profile's `definition_name`, the CLI profile is used as the fallback resolver.
4. **Unresolvable Profile**: If an unknown `axes_definition` is referenced without an inline `axes_config` or matching CLI profile, the package is rejected with an `UNRESOLVABLE_PROFILE` error.

## Legacy Encoding & Mixed-History Exports

1. **Legacy Wire Preservation**: Snapshots imported from legacy packages (`schema_version = None`) preserve their exact byte-for-byte wire representation and RFC-8785 canonical hash.
2. **Generic v2 Snapshots**: Newly created snapshots use `schema_version = "ontocurator-annotation/v2"` with generic `term_id` and structured `axes: {definition_name, values}`.
3. **Mixed-History Exports**: When exporting a workspace that contains both historical v1 proposals and newly authored v2 snapshots, each snapshot retains its respective native wire format, ensuring zero verification regressions across generations.

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
