# Phase 0 plan review (2026-10-17)

Baseline: `4de9aaa`. Scope: six Phase 0 documents (execution index and five batch plans), roadmap synchronization, stale acceptance checkout path.

The independent content review identified two material gaps in B0.3. Both were corrected and the scoped second review found no new material blocker:

1. Pending-only proposal sets were not represented by the existing annotation-target selection. The plan now defines default/custom selection, freezes it per workspace, rejects conflicting reopen selections and explicitly handles first post-upgrade initialization.
2. Ordinary adoption cannot reference predecessor-text snapshots. The plan now defines an authorized dedicated re-create command while preserving the existing adoption boundary.

The review found no additional material blocker in the D2 structured-format/import limitation, D3 historical hash strategy, D16 task/role distinction, coupled scrolling, or separate candidate preparation. P0-S/A/R/U remain explicit product questions until answered; they stop only their dependent tasks. D6–D15 remain recommendations, not decisions.

Documentation checks: `git diff --check` passed; all six plans' relative Markdown links and required goal/architecture/spec/task/acceptance sections were checked and passed.

Implementation readiness checks on unchanged product code:

- `uv sync --frozen` and `npm --prefix frontend ci` restored the locked environments. Initially ontospan was absent and three frontend suites could not resolve `diff`; rerunning after setup passed.
- `uv run pytest tests/test_submission_scope_integrity.py tests/test_annotation_versions.py -q`: 39 passed, one existing Starlette/httpx deprecation warning.
- `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx tests/comparePane.test.tsx tests/translationReview.test.tsx tests/caseScreen.test.tsx tests/reviewActions.test.tsx`: 85 passed; an existing React act warning occurred in the CaseScreen help test.

These are focused baseline checks, not the full merge gate or feature acceptance. No product implementation, demo interaction, merge or push was part of this review.
