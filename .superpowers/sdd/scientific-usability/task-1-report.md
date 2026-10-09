# Task 1 — Review and submission integrity

Implemented the approved review-integrity scope on `feat/scientific-usability`.

## Behavior and design

- `domain/results.py::latest_submissions` selects the greatest `draft_revision` within every complete origin WorkspaceKey, including package, document, annotator, mode, scope, and target set. It orders origins deterministically, preserves separate branches, ignores timestamps for selection, accepts identical duplicates, and rejects unequal records sharing an origin and revision, including superseded conflicts.
- Review opening without explicit targets first resumes the same annotator/document/scope's local or imported round. Several qualifying rounds produce `AMBIGUOUS_REVIEW_ROUND` with exact round IDs. The optional `review_round_target_set_id` request and small UI selector resume a chosen round; the explicit-target API still creates/selects its exact target set. Multiple origins bound to one local round produce `AMBIGUOUS_SUBMISSION_ORIGIN` before a new workspace commits.
- New reviewers receive the latest submitted snapshots rather than all audit/dependency annotations. Proposal packages without submissions still use raw editable-layer proposals. Multiple latest origins/rounds of one contributor/mode/scope produce `AMBIGUOUS_REVIEW_INPUTS`; distinct contributors remain visible as separate review proposals. All historical snapshots stay available for provenance and explicit target sets.
- Empty review target sets open normally, allow authored missed findings and checked-negative submissions, and participate in previous/next/dropdown/post-submit navigation in package order. The frontend no longer fetches every historical proposal and constructs a new round each time a case opens. Independent-mode isolation remains server enforced.
- Restored drafts retain submitted revision and checkmarks. Further submissions continue the imported logical origin through a separate local binding, so an export/import continuation does not invent a new origin branch. The storage origin column also records that logical origin. Document progress compares revisions only within a matching round/origin, including under clock skew.
- Decision transitions remove only counterversions adopted from that target whose annotation identity is no longer selected as replacement. Independently authored annotations remain. Evidence cleanup removes only discarded-copy references unused by retained annotations, preserving unrelated pending mentions. UI transitions ask before discarding adopted edits, and cancellation leaves the decision untouched.
- Submission rejects unresolved adopted copies and rechecks replacement layer/type. Import checks submission format/revision, exact review coverage, reviewer identity, outcome/result agreement, replacement presence/document/layer/type, unresolved adopted copies, and equal-revision conflicts before storage. Original snapshots/submissions are preserved as immutable audit dependencies.
- Review input selection uses a focused package/document submission query rather than exporting the full package. Workspace lookup for statuses/resumption filters the document in SQL. Dashboard listing does not perform repeated whole-package exports.
- OpenAPI and generated TypeScript contracts were regenerated for the optional round selector. Structured API errors retain their detail object while rendering its message as a readable string.

## Regression process

The first backend run showed 11 expected failures for raw/default review opening, imported continuation/current-result targets, adopted-copy decision changes, unresolved copies, round ambiguity, clock-skew revision restoration, inconsistent imported outcomes, and the absent shared selection helper. Updated navigation and dashboard regressions showed seven expected frontend failures before implementation. Follow-up regressions caught discard-confirmation source-ref encoding, unrelated orphan-evidence cleanup, package-wide input loading, conflicting equal revisions and origin branches. Existing tests that required skipping empty cases or resetting imported draft revisions were updated to the approved behavior.

The real export/import continuation tests exercise changed counterversions, reapproval after editing a submitted counterversion, retained history, a fresh reviewer targeting only its latest approved version, and continued original lineage. An API test creates two explicit rounds, checks the ambiguity payload, selects one, and rejects non-review round selection.

## Verification

- `uv run pytest tests/test_scientific_review_integrity.py tests/test_reviews.py tests/test_review_roundtrip_regressions.py tests/test_review_validation_regressions.py tests/test_review_findings.py tests/test_packages.py tests/test_storage.py tests/test_storage_regressions.py tests/test_api.py tests/test_api_regressions.py -q`: **124 passed**.
- `npm test`: **315 passed across 33 files**, including component workflow tests.
- `npm run typecheck`: passed.
- Ruff check and format checks on the seven changed production modules, new helper, and changed backend regression files: passed.
- Mypy on the seven changed production modules/helper: passed.
- `uv run python scripts/export_openapi.py --check`: passed.
- `npm run api:check`: passed.
- No `npm ci`, release build, browser build, merge, push, or migration was run by this task worker. Root owns final whole-branch backend/browser/release checks.

## Concerns and limits

- Unrelated branches are deliberately not merged or chosen by timestamp. Round ambiguity is selectable in the UI; conflicting origin branches require an explicit source/target choice outside default reopening, and the service reports their identities.
- Historic invalid archives that submitted an abandoned adopted copy, omitted an approved replacement, or contradict their decisions now fail validation. This is intentional integrity enforcement; valid v2 package history and v4 workspaces remain readable.
- Frontend suites emit React `act(...)` warnings in several existing async component tests and some new dashboard/continuation tests, but no test failures. Backend API tests emit the existing Starlette/httpx deprecation warning. These do not justify dependency or broad test-harness changes in this task.
- The reviewer still sees source provenance; this implementation does not claim source blinding or clinical-pilot validation.
