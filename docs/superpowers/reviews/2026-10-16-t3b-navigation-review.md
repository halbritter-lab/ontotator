# T3b navigation, assigned editor and own profile acceptance

Tasks 1–3 are accepted at runtime/frontend source `07e161eafd63af5ede770e5cf3e489a0d2aa936b` on `feat/t3b-admin-ui`. This accepts the integrated routing, assigned-task editor and own-profile slice, not the complete administration UI or the later Task 11 distribution gate.

The App renders one authenticated shell, task list, assignment-authorized editor and profile. Assignment identity and server task order determine navigation. Submitted work opens read-only across controls and retained callbacks. Profile changes adopt the actual returned display name without replacing the session identity. Ordinary navigation flush/discard/cancel remains distinct from logout Save/Discard, and preserves the editor and queue while a decision is pending.

Accepted prerequisites include final T3a `fa2af4e` (runtime `6458b34`), the ontology upload-results compatibility seam `e2651cf` (29 actual database cases), and the optional assignment review-round selector `2a2c6b9` (14 actual database cases at documentation-only merge `b29542f`). T3a evidence is recorded separately in its final acceptance record.

The initial frontend integration `8365055`, based on `7eee099`, passed all 630 frontend tests across 65 files, with no skips. Independent review found two P2 issues: repeated native Back operations could overwrite an intermediate history entry, and one migrated tree test replaced real reload with fragment navigation. A complete browser run at runtime-identical `55dcc048` also exposed nine failures: editor space consumed by the permanent navigation, and two obsolete dashboard/order expectations.

Correction `07e161e` journals and restores all temporarily changed history entries, restores actual reload coverage, and places reading-mode navigation in a keyboard-accessible native Sections disclosure. Compact administration pages retain the sidebar. All role-filtered navigation links and guarded callbacks remain available. Existing editor breakpoints and span logic are unchanged. Actual post-submit server order and translation persistence assertions replace the obsolete expectations. Eight exact height strings were updated to measured values after the compact header freed six pixels; no usability floors, ratios, docking, containment, focus or viewport assertions were lowered or removed.

Verification at the final source:

- 43 affected App/Shell tests passed, with TypeScript, OpenAPI drift and browser/stack source type checking.
- Original strong reviewer approved all eight correction paths and cleared both P2 findings. Four independently executed new history/disclosure regressions passed; previously reviewed components were not re-audited.
- Root's complete browser retry passed **all 39 scenarios**, exit 0, **139.95 seconds**, 2026-10-16 08:09:28–08:11:48 UTC. The final source remained exactly `07e161e`, with a clean worktree. Evidence: ignored `build/t3b-task-1-2-browser-retry/{execution.json,browser.log}`. The preceding 30-pass/nine-failure run and focused 25-pass/one-golden-failure run remain recorded; neither is represented as a passing command.
- Own Profile, LanguagesField, task ordering, router and task-list component reviews/tests were previously banked and are included in the accepted integration.

Embedded assets and the matching new production image have not been refreshed for this slice. The complete T3b Task 11 gate will rebuild those assets and verify the real stack after the remaining pages are integrated. User, ontology, project, document, assignment, progress/export and provenance integration remains subsequent work. P9 latency acceptance remains open; T7 integrations remain parked. No main merge, push or deployment occurred.
