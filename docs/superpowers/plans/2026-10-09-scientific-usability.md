# Scientific Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct scientific review results, preserve reproducible search conditions, and expose a minimal reliable analysis dataset.

**Architecture:** Extend existing domain/services and optional package metadata. Share latest-submission selection between restoration, new review rounds and analysis. Keep audit history separate from current results and use package-bound search resources.

**Tech Stack:** Python 3.11+, Pydantic, FastAPI, SQLite v4, React/TypeScript, pytest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-scientific-usability-design.md`

## Global Constraints

- No runtime network calls, new external services or destructive migration.
- Keep v2 packages and v4 workspaces backward-readable.
- Preserve independent-mode isolation, immutable snapshots/history and Unicode codepoint offsets.
- Explicit ambiguity beats selecting unrelated rounds or origin branches by timestamp.
- Keep the adapter small; no metrics dashboard or automatic gold selection.

## Review Focus

- Review-only package with zero proposals must permit checking the entire text and a negative submission.
- Reimport changed reviews and historical submissions without turning dependency snapshots into new mandatory targets.
- Decision changes after adopting/editing a counterversion must not approve that abandoned version.
- Same ontology, English-only search, different ambient/disabled translations must have the same rankings and scores.
- Multiple origin branches and uncertainty must survive analysis as explicit states, never false negatives.

### Task 1: Correct review and submission integrity

**Files:** Domain selection helper; `application/workspaces.py`, `application/reviews.py`, `application/submissions.py`, `storage/repository.py`, `packages/reader.py`, `api/routes.py`, frontend case/dashboard navigation and relevant tests.

**Interfaces:** Produce `domain/results.py` with `latest_submissions(submissions: Iterable[Submission]) -> list[Submission]` selecting one highest revision per full origin key, detecting conflicting equal revisions. Consumer must explicitly handle multiple origins. Preserve existing explicit-target API; add optional review-round selection only where needed.

- [x] Write and run failing regressions for zero-input review-only UI, A-to-B export/reimport continuation, new-reviewer current-result targets, clock skew restoration, abandoned adopted copies, missing/inconsistent imported replacement and ambiguous rounds.
- [x] Implement shared result selection, deterministic/resumable review opening and current-result input selection. Allow empty review and all-case navigation.
- [x] Reconcile adopted clones on decision transitions and reject unresolved adopted copies on submission, preserving intentionally authored findings.
- [x] Validate imported review results and replacement dependencies before commit.
- [x] Run targeted backend and frontend suites; regenerate OpenAPI/types if interface changed; commit.

### Task 2: Capture and preserve reproducible search conditions

**Files:** `ontology/translations.py`, `ontology/service.py`, `ontology/registry.py`; new focused search-condition module; optional `packages/models.py` metadata and reader/writer resource validation; storage/service integration; search/tree routes and tests.

**Interfaces:** Produce a validated optional package search-condition schema and a package-aware service resolver shared by search/tree and exposed to other term consumers as appropriate. Extend existing export/import; retain old search events without claiming captured conditions.

- [x] Write and run failing regressions for disabled translations changing English ranks, global upload after capture, fresh-workspace roundtrip with no ambient translations, condition hashes/path tampering and historical-runtime preservation.
- [x] Fit/cache indexes per selected language corpus and update algorithm identity.
- [x] Capture actual immutable resource bytes and application/runtime identity, bind search conditions to package, and resolve package searches from captured artifacts.
- [x] Persist/export/import validated resources without mutating original annotation/profile hashes; distinguish historical runtime from current execution identity.
- [x] Run targeted search, import, upload, export and API suites, type/lint checks; regenerate contracts/types; commit.

### Task 3: Provide minimal scientific analysis and workflow documentation

**Files:** `application/analysis.py` or focused equivalent, a small CLI entry point, tests, `README.md`, `docs/work-package-v2.md`, and a study-workflow document.

**Interfaces:** Consume `latest_submissions` and validated package/search metadata. Emit versioned JSON rows for document/annotator/mode/layer/round, with explicit missing, checked-negative, positive and uncertain statuses and ambiguity records.

- [x] Write and run failing tests with two annotators, reopened submissions, missing cases, checked-negative cases, uncertainty, multiple origins and exact multi-segment Unicode evidence.
- [x] Implement the adapter and CLI with no automatic gold selection, cross-mode pooling or metric definitions.
- [x] Document result selection, captured/legacy search conditions, provenance-visible review, and a small two-annotator pilot procedure.
- [x] Run adapter/CLI tests and integrated export/import analysis; commit.

### Task 4: Integration review and release verification

- [x] Independently review the complete change against the spec and fix material findings.
- [x] Run full backend, frontend and browser suites plus lint, format, type checks and schema drift checks.
- [x] Build embedded assets and verify release packaging after dependency installation has finished.
- [x] Record test evidence, task completion and remaining external pilot work. Keep the implementation on its feature branch unless integration is authorized.

## Completion evidence — 2026-10-09

All four tasks completed on `feat/scientific-usability`. Production source was
last changed in `24f4c75`; embedded frontend assets were refreshed in `527307e`.
Independent task reviews and the final whole-branch review found scope-integrity
and export/capture interleaving defects; all material findings were corrected and
their scoped re-reviews approved. No material findings remain.

| Verification | Result |
|---|---|
| Final full backend suite | 649 passed |
| Full frontend unit/component suite | 315 passed, 33 files |
| Full browser suite | 34 passed |
| Browser review/resume/export after final backend fixes | 1 passed |
| Ruff lint and format | Clean, 141 files |
| Mypy | Clean, 56 source files |
| TypeScript, OpenAPI and generated API drift | Clean |
| Wheel and Windows portable build | Built and verified |
| Actual frozen executable | Capture, translated search, export and analysis passed |

The final wheel is in `dist/scientific-release/` (SHA-256
`424cf2e68c030933c77ab562e115fcb9dca1f222684a1704bf29d1f80e81b3e1`).
The Windows portable ZIP is in `dist/scientific-portable/` (SHA-256
`b1b5cf017452863e2399f1348d37f1488d7ec7fa1424f2f3f72893aad32f645c`).
Artifacts and temporary smoke workspaces are local; no publication is part of
this task.

The documented two-annotator procedure is a technical acceptance workflow. A
real clinician pilot, study-specific guideline and agreement definitions remain
external study work. Review retains visible source provenance; captured legacy
search conditions are not invented retroactively.
