# Scientific usability corrections

The user requested implementation of the scientific-usability review, with emphasis on consequential changes and avoiding a large statistics or adjudication product. The reviewed baseline is `ccfcc88`. Success means ordinary annotation/review and exported results agree, historical audit data cannot silently become current results, and the recorded study conditions can be reproduced.

## Review and import correctness

Every document is reviewable, including documents with zero proposals. Review-only distributions support adding missed findings and submitting checked-negative cases. Navigation includes every document in package order.

Opening review without explicit targets resumes an existing local/imported round for the same annotator and document. If several rounds qualify, return an explicit ambiguity requiring round selection; never silently combine them. Explicit target sets continue to permit new rounds. For a new reviewer of an exported result, select latest submitted results, not dependency/history snapshots. Keep initial packages without submissions usable as proposal packages. Preserve server-side independent-mode isolation.

Adopted counterversions remain linked to their source. Changing a decision away from an adopted replacement must not submit an abandoned clone as an unrelated additional finding. The ordinary UI transition cleans up its adopted counterversion (with explicit confirmation where needed to avoid losing edits); intentional independent additional findings remain supported. Submission validation prevents unresolved adopted copies from being approved accidentally.

Select the highest `draft_revision` within a full origin workspace key, irrespective of wall-clock order. Never compare revisions across different origin keys. Ambiguous branches/rounds are reported rather than guessed. Use shared selection semantics for restoration, review input selection, and analysis.

Package import validates changed-decision replacement dependencies and outcome/result consistency, document, layer and type binding; malformed archives fail before commit. Reject unsupported/inconsistent submissions while preserving valid immutable history.

## Reproducible search conditions

Keep v2 packages and v4 workspaces backward-readable. Add optional, validated search-condition metadata and content-addressed resources; old packages explicitly lack captured historical conditions. Capture ontology digest, translation filenames/digests/bytes, index algorithm parameters, actual application build identity and relevant runtime versions. Preserve imported historical condition metadata rather than attributing old searches to the current runtime.

Bind each package's searches to an immutable captured resource set, at a documented boundary (first use is acceptable for older/unconfigured packages). Later global uploads must not change an already captured package. Exports include all resources needed for those conditions, and fresh-workspace imports use them instead of ambient translations. Validate resource hashes, archive paths, limits, and condition-to-ontology binding. Conditions distinguish runtime drift explicitly; do not claim historical recomputation under a different runtime is exact. Existing ranked/displayed audit lists remain intact.

Selected search languages define the TF-IDF fitting corpus, not just a post-scoring mask. Installing disabled translations must leave English-only ranks and scores unchanged. Cache language-specific indexes with bounded memory and record the selected fitting condition.

## Minimal analysis adapter

Provide a small Python/CLI adapter for validated exported packages, emitting a documented JSON analysis dataset. Per document, annotator, mode, layer and review round, distinguish missing work, checked-negative submissions, positive submissions and review uncertainty. Choose latest revisions only within the same origin. Flag ambiguous branches/rounds; do not invent a gold standard or silently merge people/modes. Include identities and exact term, axes and evidence spans for downstream agreement analysis. A completed review with uncertain decisions is not a fully adjudicated negative case.

## Limits and validation

Preserve visible source provenance in review; this workflow is not source-blinded. Preserve text bytes, codepoint offsets, original snapshots and histories. No runtime network calls, new external services, metric dashboards, automatic gold selection, or destructive migration. The real clinician pilot cannot be simulated here; supply a small reproducible technical study workflow and checklist instead.

Regression tests cover the reviewed failures and actual export/import continuation. Run full backend/frontend/browser suites, type checks, lint/format and API drift checks. Rebuild embedded assets and verify release packaging serially after all dependency installations. Finish on the feature branch with changes reviewable; merge/push only if authorized for this implementation.
