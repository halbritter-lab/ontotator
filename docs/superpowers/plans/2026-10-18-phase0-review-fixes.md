# Phase 0 review fixes implementation plan

> **For agentic workers:** Use superpowers:executing-plans for integration and verification; independent fixes use superpowers:dispatching-parallel-agents.

**Goal:** Resolve all findings in the Opus review, verify the integrated candidate, and merge Phase 0 into local main as authorized on 2026-10-18.

**Architecture:** Preserve existing workflows and privacy boundaries. Re-creation copies clinical context from the server-verified predecessor. Submission guidance uses current policy while legacy incremental editing remains compatible. Export failures retain structured context and explain recovery.

**Tech Stack:** Python/FastAPI/PostgreSQL, React/TypeScript, Vitest and Playwright.

**Spec:** `docs/superpowers/reviews/2026-10-18-phase0-opus55-review.md`, with the subsequent verified corrections and user authorization to implement all findings and merge.

## Global constraints

- Preserve exact snapshot provenance, Unicode offsets, frozen review inputs and authorization.
- Preserve axes values and their defaulted provenance independently.
- Legacy incremental edits remain allowed; current policy governs submission.
- Keep the existing English UI, local assets, design tokens and reading layout.
- No publication requested. Merge locally after verification; preserve unrelated work and evidence.

## Review focus

- Absent/past predecessor and defaulted axes survive recreation and export.
- Diagnostic re-anchor rows disclose no unverified clinical content.
- Every repair jump focuses the actionable control, including proposals and hidden layers.
- Changed server rules and invalid unresolved terms produce actionable recovery without duplicated errors.
- Legacy drafts, narrow screens and historical jobs retain compatibility.

### Task 1: Clinical fidelity and re-anchor queue

Files: domain/reanchor_resolution.py, storage/repository.py, application/editing.py, CaseScreen.tsx, ReanchorPanel.tsx and re-anchor tests.

- [x] Add failing predecessor-fidelity and default-provenance regressions.
- [x] Expose verified source axes and copy them server-side; show them before recreation.
- [x] Reduce repeated context, disclose technical IDs on demand and preserve exact context navigation.
- [x] Cover the P0-R browser submit blocker and focus jump; run affected tests.

### Task 2: Submission recovery and editor guidance

Files: CaseScreen.tsx, ReviewActions.tsx, AnnotationPanel.tsx, ProjectSettingsPage.tsx, errors.ts, editor CSS and tests.

- [x] Add regressions for reason-specific focus, proposal repairs, stale rules, legacy guidance and defaulted proposal details.
- [x] Correct rule copy, provide explicit legacy submission guidance and keep incremental compatibility.
- [x] Choose repair focus by issue; surface invalid terms in the submit checklist and explain server rejections with reload recovery.
- [x] Mark proposal defaults, use a multiline reviewer note, fix pluralization, heading wrapping and primary-action hierarchy.
- [x] Run affected frontend suites.

### Task 3: Historical export failures

Files: exchange/jobs.py, jobs/queue.py, admin error catalog, ExportPage.tsx and export tests.

- [x] Assert exact underlying codes for unknown, obsolete and profile-invalid historical targets.
- [x] Carry structured document/submission/annotation context and show a recovery message, preserving old jobs.
- [x] Run affected backend and frontend suites.

### Task 4: Responsive coupling and accessibility

Files: useCoupledScroll.ts, ComparePane.tsx, TranslationReviewScreen.tsx, authz/versions.py and tests.

- [x] Test narrow/wide resize and opt-in behavior.
- [x] Disable unsupported coupling with an explanation; make pairing status accessible.
- [x] Remove stale P0-A comment and run affected suites.

### Task 5: Integrate, verify and merge

- [x] Regenerate OpenAPI, TypeScript and error catalog contracts and rebuild embedded frontend.
- [x] Review the complete change with a fresh reviewer and resolve substantive findings.
- [x] Run the complete local gate, plus bounded browser visual checks at desktop and narrow widths; after correcting one obsolete browser assertion, rerun the full browser stage successfully.
- [x] Record evidence and resolution of every review item, commit changes, merge into local main and verify the merged tree (`778e3a0`; identical tree hashes recorded in the resolution report).
