# T0 and T1 implementation and review record

Date: 2026-10-14. Local implementation, independent reviews and corrections are complete. No Critical or Important findings remain open. Minor findings and deliberate boundaries are listed below.

## Branches and scope

- T0: `feat/tree-term-links`, worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/tree-term-links`, based on the user's current planning branch at `cfa1553`. Final code commit: `7870aa2`.
- T1: new local repository `C:/Users/jan-p/Development/ontospan`, branch `feat/shared-annotation-format`, empty `main` baseline `92d0ebc`. Final code commit: `acba84c`.
- Both reviewed plans were implemented. T1 Task 13, private GitHub repository creation, remains a separate publication step requiring explicit confirmation. No remote was created; no branch was pushed or merged. The original Ontocurator planning checkout remains unchanged.

## Review evidence

Two fresh-context Codex agents independently reviewed the repositories read-only: T0 `cfa1553..6d550cc`, T1 `92d0ebc..52fb89a`. Two additional read-only Claude Code 2.1.296 sessions reviewed the same implementations. Claude's original reports are preserved unchanged:

- [T0 Claude Code review](2026-10-14-t0-claude-code-review.md)
- [T1 Claude Code review](2026-10-14-t1-claude-code-review.md)

The original reports describe the pre-correction state. The coordinator assessed severity by actual effect on consumers, combined overlapping findings, and completed one correction round. Every correction has a regression observed failing before the fix and passing afterward. No second review was claimed; the final verification below covers the corrected code.

The T0 agent reproduced focused-link Enter interception in React and Chromium, and duplicate accessible-label IDs across two component instances. It verified embedded assets against the built frontend and wheel. The T1 agent reproduced newer-minor bundle failures, duplicate manifest layers, schema/loader inconsistencies, archive exceptions and malformed reference decoding. Claude independently identified label squeezing, warning loss, export granularity and additional parser edge cases; its T1 review also checked optimal assignment against 3,000 brute-force examples.

## Corrected findings

| Area | Result and regression evidence |
|---|---|
| T0 focused row link | Enter now performs native link activation while preserving row selection. Component regression failed on prevented default; Chromium verifies a new popup for both mouse and Enter activation. |
| T0 tablet labels | Label width was 52.53 px at 800 px viewport. A 10ch minimum and metadata wrapping keep labels readable without hiding IDs or links. Layout regression, full browser suite and final desktop/tablet/narrow captures pass. |
| T1 newer-minor bundles | Manifests declare a version appropriate to their units; completed manifests are checked before writing. Directory and ZIP round trips retain future optional layer/ontology fields. |
| T1 manifest identity | Identical and conflicting duplicate layer IDs are rejected before constructing a lookup. |
| T1 serialized contracts | Both `schema_version` and `artifact_type` are required in document and manifest JSON schemas, including newer-minor reads. Constructor defaults remain convenient. Conformance fixtures cover missing discriminators and versions. |
| T1 archives | Invalid ZIP, CRC and decompression failures become `FormatError` with `invalid_archive`; unrelated filesystem errors retain their native types. |
| T1 references | Malformed percent escapes and invalid UTF-8 are rejected. Valid Unicode, literal percent signs and encoded colons retain their identity. |
| T1 Unicode | Recursive checks cover document text, keys and unknown fields. Loading and dumping invalid Unicode produce structured errors instead of leaking encoding exceptions. |
| T1 known field types | Newer-minor reads retain strict JSON types for known fields while accepting future fields/profiles. ISO timestamps and JSON arrays remain valid. |
| T1 agreement | `terms_a`, `terms_b` and `terms_equal` expose the distinct term-set counts needed for micro-averaging. |
| T1 warnings | Optional `report=` sinks preserve loader warnings and prefix bundle unit issues with file paths. Existing return types are unchanged. |
| T1 parser boundaries | ASCII SemVer, duplicate JSON keys and all leading BOMs have explicit validation/idempotence regressions. |
| T1 Phenopackets | Default export is per document/unit; subject grouping is explicit. Alternate sets of one document cannot be silently combined, duplicate-document packet IDs include set identity, and ontology release conflicts/mismatches are rejected. |

## Final verification

The coordinator independently ran the following checks on the corrected implementations:

| Repository | Verification |
|---|---|
| Ontocurator | `uv run pytest -q`: **661 passed**; `npm --prefix frontend test`: **323 passed**; complete Playwright suite: **36 passed**. Ruff check and format, mypy (57 source files), TypeScript, OpenAPI drift and generated TS drift all pass. Wheel rebuilt and embedded assets verified. |
| Ontospan | `uv run pytest -q`: **181 passed, 1 skipped**; Ruff check/format (35 files), mypy (18 source files), schema drift, sdist and wheel build all pass. The single skip is the directory-symlink test because this Windows environment lacks symlink creation permission. |

Ontospan's wheel also imports successfully in a clean environment without the optional Phenopacket dependency. The wheel includes all three JSON schemas. No application test required a live ontology website; the tree popup test blocks external requests. Existing Starlette/React test warnings do not cause failures.

## Decisions and deviations

The following decisions include their rationale and practical consequence; this also preserves the execution ledgers' rulings.

1. T0 starts from the current documentation branch rather than `main`, as the user requested. Reviewed plans accompany the implementation; the original checkout stays untouched.
2. T1 is implemented on a feature branch rather than directly on `main`. Its code stays in the separate repository specified by the plan.
3. The execution ledgers were retained through final review instead of being cleaned up before coordination. Their decisions are preserved here before scratch cleanup.
4. The T1 scaffold smoke test was written before implementation; the editable package was subsequently reinstalled once because the first installation saw an empty source tree. This changes development setup only.
5. The T1 schema directory may include Python's `__pycache__`; verification checks the three actual schema files rather than an exact directory listing. No contract file is omitted.
6. The plan generator defines five valid and thirteen invalid initial fixtures, despite prose saying fourteen invalid. All defined cases were retained, and review regressions add further conformance cases.
7. The T0 synthetic response bound changes from 40 kB to 70 kB to account for per-node URLs. Root/stub exclusion checks remain; the accepted response budget is 30 kB larger.
8. The detail link becomes an explicit Tab stop in both navigation directions, as required for keyboard access. Row links remain outside the Tab order.
9. The four-row layout budget uses a single-line root's height, since metadata on a current row can now wrap. A separate minimum-label-width regression and no-overflow assertions protect readability; four multiline labels may require scrolling.
10. Mouse focus on a row link still moves the roving Tab stop to that row, as the approved plan documents. Enter is fixed directly instead of suppressing pointer focus; Tab may follow the last interacted row rather than the selected row.
11. Whitespace-containing CURIEs are rejected by production ingestion. Unsupported component-only whitespace keys were not added to scope; relaxing ingestion later requires safe label IDs.
12. Unicode crashes, known-type coercion and missing term denominators were raised from Minor to Important because they break advertised validation, compatibility and micro-averaging behavior. They are fixed rather than deferred.
13. Subject grouping defaults to `False` because binding spec F9 explicitly makes grouping optional, overriding the plan code's `True`. Callers must opt into grouping.
14. Current unreleased 1.0 schema files were regenerated to repair required discriminators; constructor defaults are retained. Consumers of the development schemas must update them before release.
15. Optional `report=` sinks preserve existing loader return types. Callers must supply a sink to inspect warnings; README shows the supported usage.
16. Grouped exports reject alternate sets, conflicting releases and a mismatched ontology instead of selecting data silently. Callers select one set per document and provide the matching ontology.
17. The conformance index supplies `artifact_type` externally, because an invalid fixture may omit its own discriminator. External fixture runners use that index to select schemas.
18. Missing files and filesystem permission failures retain native exceptions; corrupt archive data uses `FormatError`. Import callers handle those two classes separately.

## Deferred minor findings

These findings remain explicit follow-up work, with no open Critical or Important finding:

- T0: duplicate accessible-label DOM IDs if two trees are mounted simultaneously; the current case screen mounts one tree.
- T0: child count is no longer in the label-only accessible name; `aria-describedby` can restore that information without changing the planned name.
- T0: row links have a small touch target.
- T1: uppercase `.ZIP` chooses a directory; suffix handling can become case-insensitive.
- T1: Windows junction-specific regression coverage; the symlink regression requires privileges unavailable here.
- T1: optimal matching has cubic worst-case runtime; large live-agreement workloads can use prepared keys and overlap components later.
- T1: after an out-of-range segment, additional ordering diagnostics may be incomplete; the input is already rejected.
- T1: `allowed_roots` syntax/existence checks and further model/bundle conformance fixtures.
- T1: listed units outside `documents/` are accepted by the reader, though the writer emits the planned directory structure.

## Explicit review boundaries

- All unlisted bundle files, including hidden OS files, remain rejected to preserve the manifest integrity contract; consumers remove incidental files before importing directory bundles.
- Valid percent-escape hex case is not normalized; decoded reference identity is preserved. Source references may point outside the current bundle, so existence checks are not imposed on external references.
- External website availability was not tested. URL templates and OLS fallback follow the approved spec until configurable templates in T3.
- Screenreader announcements were not manually tested with NVDA/JAWS/VoiceOver; component accessible-name and keyboard/browser checks are recorded above.
- Directory reading assumes stable input during validation; protection against concurrent filesystem swaps is deferred to a separate trust-boundary design.
- No live ontology download, multi-set adjudication, downstream migration, clinical Phenopacket validation or publication is claimed. Mini-ontology fixtures and structural Phenopacket parsing cover the current package scope. Historical finding export and the fixed ECO identifiers follow the binding spec.

Both branches and built artifacts are retained locally for the user's next step.
