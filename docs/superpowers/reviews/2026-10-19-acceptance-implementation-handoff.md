# Acceptance remediation implementation — completed handoff

This is the implementation handoff for the [accepted plan](../plans/2026-10-18-acceptance-remediation.md), including its linked reviews and the [resolved workflow contracts](../specs/2026-10-18-acceptance-workflow-contracts.md). It is not user acceptance. No commits or pushes were made.

## Implementation

- Inventory-first T1 source normalization, immutable submitted history with notes, and frozen final exports with complete human-input provenance, merged references, source-review receipts and reviewed source texts.

- Explicit private carry-forward, consolidation and clean-restart rounds; exact source-change obligations and repeated translation corrections; reports, holds and lead-authorized handling with revisions and idempotent receipts.

- Lead-selected immutable result per case/language, shared dashboard/export warnings, finite-cause reaffirmation and deliberate warned export. Missing languages are explicit omissions, never implicit fallback results.

- Explicit default-policy confirmation, durable multilingual preferences, sectioned settings with local save feedback, stable annotation/review layout, staged reanchor decisions, active-project/account navigation and a collapsed logical text/language tree.

- Separate full-HPO runtime with official compatible translations; the original demo remains separate on port 18081.

The migrations add project defaults/rounds, immutable final selections/export snapshots, and report/hold state (0010–0013). OpenAPI, TypeScript bindings and administration error catalog are regenerated and checked. Legacy research export remains explicitly all-individual; final export uses an acknowledged immutable selection snapshot.

## Review disposition

The independent [Codex implementation review](2026-10-19-acceptance-codex-implementation-review.md) found five issues: missing pending-review warnings, unavailable finite-cause reaffirmation, unrelated source warnings, owner-only warning destinations and an invisible paused-task state. All five received narrow corrections. Subsequent bounded Codex source review found all five closed, with database/runtime verification tracked separately below.

The requested `agy --model gemini-4-argon-high --effort high` [Argon 4 review](2026-10-19-acceptance-argon-implementation-review.md) completed in source-only mode. Its seven findings were adjudicated rather than accepted wholesale:

| Finding | Disposition |

| --- | --- |

| A1 merged provenance loses all but last input | Confirmed; preserve all exact qualified sources and notes, plus the merged method. |

| A2 missing reviewed-source audit/text closure | Confirmed; freeze relevant immutable source resolutions/reviews and exact reviewed text ancestry in final artifacts. |

| A3 repeated assignment crashes | Rejected against the actual implementation: submitted assignment is reopened, not duplicated. Added a two-edge/reassignment regression. |

| A4 cross-person scoped readers | Hardened scoped readers with exact human-work predicates; existing API guards mean the claimed public disclosure was not demonstrated. |

| A5 warning/omission mismatch | Pending-review cause added; hold warning uses TASK_ON_HOLD; stale omission example corrected to the established case/language shape. |

| A6 actions on resolved reports | Reject new non-resume transitions; retain exact idempotent replay and legitimate resume. |

| A7 first report revision increments twice | Corrected to one transition revision including lazy round binding. |

Bounded Codex follow-up also found no obvious remaining source-level closure defect in A1/A2. The raw Argon report contains inaccurate references/runtime details and remains historical evidence, not an authoritative statement of the final state.

## UX review

See the [protocol-based UX synthesis](2026-10-19-acceptance-ux-review.md) for the complete F01–F33 disposition. Two independent assessments were kept isolated until both completed. Assessment A used task/heuristic review and actual candidate journeys; B used source detection, native browser overlays, responsive geometry and keyboard checks. Both recorded the original immutable candidate identity and their coverage limits.

One bounded correction batch addresses A’s five priorities: immediate submission-history freshness, discoverable Settings/Rules saving, collapsed document details, aligned comparison identity headers and a narrow-screen project picker. All five were confirmed on image `93a9ee49…` in a bounded native pass, with six screenshots and exact synthetic mutations recorded in the [confirmation](evidence/2026-10-19-acceptance-ux/native-final-confirmation.md). The final extra Documents label correction preserves “Accepted without review” and its reason; its focused suite passed 10/10. Actual 200% browser zoom was attempted but not achieved; it remains unverified. Additional ontologies (F15) remain intentionally deferred.

## Verification

- Final static stage passed: Ruff (467 files), mypy (151 source files), OpenAPI/catalog/TypeScript drift, 26 contract preflight tests, frontend type checking and locked wheel build.

- Complete frontend unit run: 1,393 passed, two stale assertions failed. Both assertions were corrected and their focused 41-test batch passed. Subsequent affected UI batches passed 108 and 34 tests; finite reaffirmation passed four tests. No redundant full frontend rerun.

- Final mapper and frozen-source closure batch: 40 passed.

- Full backend run: 2,267 passed, 48 failed, one POSIX-only skip. Failures were grouped into obsolete doubles/axis-choice fixtures, legacy package test adapters, legacy workspace opening and standalone submitted-work search provenance. All 48 original failing cases were subsequently covered by successful bounded checks. This is a full discovery run plus targeted final-state confirmation, not a repeated all-green full run.

- Serial review-delta database run: 129 passed, one newly added merged-note archive failure. Source-review receipts, repeated translation edges, privacy, report transitions, revision counters and warning projection passed. The remaining source-note defect was reproduced in a DB-free mapper test and corrected (39 mapper tests passed); real final/research archive confirmation subsequently passed.

- Failure-confirmation batch: 24 passed, two remaining fixture errors; those two were corrected to the actual generic-axis profile and explicit submission response validation, then both passed. DB-free updated-double batch: 53 passed. Opening-boundary/selection checks: 22 passed before the final narrow read-only presentation correction. Held-search provenance guards passed for save and append.

- Browser coverage completed: all 91 distinct cases passed across bounded groups (13 + 50 + 16 + 6 + 5 + 1), including corrected-text carry, agreed restart, permissions, export download, language persistence and responsive tree behavior. Failed discovery runs were followed only by failed/unrun cases; no redundant all-suite rerun. The last bounded Codex review found one presentation mismatch for a differing bound legacy workspace; writes were already rejected correctly. The read-only projection now refreshes assignment/round state and uses the existing persisted-key aliases; focused opening tests passed 14/14. [Bounded Codex closure review](2026-10-19-acceptance-codex-closure-review.md) reports no open findings in the reviewed deltas.

## Candidate and isolation

Base revision: `ba0b91b4ff3c73ae8d358896957a4dd84d20d57f`, branch `feat/phase0-acceptance-plan`, uncommitted implementation. Candidate: <http://127.0.0.1:18190>, Compose `ontotator-t5-acceptance-full-hpo`, PostgreSQL loopback port 15590. Initial assessment image: `sha256:44186e3c2f685d693cea1f583f86613c1115bc57699a4670b61eb203f3c6a3e6`; source snapshot `bd9e039462665507359af72c7a8a2e264e97f8a17a9ef8bd8f9d31fa050bd875`. The upgraded candidate now runs image `sha256:93a9ee49d143fa91c9eb4caf9709ca88170f81e5a1002ea5b8f2aada03df15f6`, source snapshot `da15c693f0e0fb56e426612649e0e5bfd1b736935bc0ced5648e5cda1b6da6a4`. Exact PostgreSQL container/volume identity and fingerprints of 14 saved-state tables were retained; no reseed occurred. Original demo container IDs/images/start times remain identical to the pre-candidate baseline. A private database backup was made. The original startup verifier expected one Compose file-label origin for every container; the preserved PostgreSQL container correctly retains its old origin. A bounded verifier checked the exact old PostgreSQL origin and exact new app/migration origin separately before finalizing the upgrade receipt. The native confirmation on this image passed. A final Documents label correction was then deployed in a second preservation-checked upgrade; final identity follows below.

HPO v2026-09-01 contains 20,482 terms (19,894 live). Official translation commit `920d4eb3608b50a2c19ddb10290224ab35a759c5` contributes 17 files in 11 compatible languages: cs/de/es/fr/it/ja/nl/pt/tr/tw/zh. `tw` means Twi; dtp/nna are excluded by the existing two-letter contract. Exact upstream pins and file digests are in [the source manifest](../../../examples/t5-acceptance/full-hpo-sources.json). Credentials and downloaded ontology data remain private ignored runtime files.

Initial host measurements: complete index load 24.7 s; first language-subset query about 2.4 s; warm queries about 1–5 ms. These are host-only measurements, not browser latency or concurrent-load claims. Actual HTTP searches and restart verification passed on image `f8455c3f…`: first requests 199 ms (Krampfanfall), 3,432 ms (Hypotonie), 2,651 ms (Seizure), warm medians 125/114/189 ms. These are local sequential measurements, not a concurrency claim. Three ordinary roles were denied global administration; profiles/tasks, preferences, immutable accepted review and workspace/draft survived app restart. See the [runtime receipt](evidence/2026-10-19-acceptance-verification/runtime-verification.json). The subsequent final upgrade changes only mobile-tree CSS; its exact source identity and preserved-data receipt complete the evidence chain without repeating unchanged backend searches or restart scenarios.

## Final runtime identity

Final image: `sha256:308835c746dc36e943285e3faea2486743468295fa4abaa47365e8d8d3a45326`; source snapshot: `3e2af6fef37d9872e0b443e8def9ac84e4287d91935af4526fe6b0d560b1390f`. The last upgrade retained the exact PostgreSQL container, both volumes, all 14 saved-state table fingerprints and original demo identities/start times, without reseeding. [Production-source verification](evidence/2026-10-19-acceptance-verification/production-source-verification.json) matches the final image. Native five-fix confirmation used image93; the later application changes are the tested Documents status label and mobile tree detail/action allocation. The latter passed the exact 600x800 browser case with four visible rows, 60px term detail, fully visible actions, preserved pane-switch selection and no overflow. No assertion was weakened to accept clipping.

## Evidence archive

Sanitized [test ledger](evidence/2026-10-19-acceptance-verification/test-ledger.json), [runtime receipt](evidence/2026-10-19-acceptance-verification/runtime-verification.json) and [preserved-data upgrade receipt](evidence/2026-10-19-acceptance-verification/upgrade-verification.json) record exact image/source identities and results without credentials. Test counts overlap where fixes needed bounded confirmation; they must not be summed as a single suite run.

## Completion and remaining acceptance

Implementation tasks 1–14 are delivered, with resolved contracts, reviewed fixes, bounded verification and the isolated full-HPO candidate. The historical plan checklists are retained as the original instructions; this report is the execution record. No intermediate or final commit, push, or merge was performed. No original demo, credentials or saved work were replaced.

Actual 200% browser zoom remains unverified because the available browser control did not achieve it. The UX matrix lists native/manual journeys separately from automated coverage; no clinical or human acceptance is implied. Additional ontologies remain intentionally deferred (F15). Minor UX follow-ups listed in the synthesis are advisory, not hidden failed gates.
