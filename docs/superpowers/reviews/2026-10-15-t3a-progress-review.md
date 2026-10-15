# T3a progress, exports and jobs acceptance

Accepted on 2026-10-15 at integrated runtime
`efba2df1082af7a922424acae678331236a79ff1`, matching tested source
`cd69a3f86771673eb9505c7f07ad1e0cff59086b`.

Progress groups document and assignee metadata without loading document text or
submission snapshots. Lead history retains unrevoked submitted/inactive-assignee
work. The existing document route adds language, assignment-status and literal
ID-prefix filters, current scoped visibility, privileged assignee metadata and
actual nullable stored positions. Its bounded status projection preserves legacy
origin/revision/alias handling and canonical early-exit/conflict behavior.

Exports enqueue real project/requester-associated jobs. Polling requires current
project visibility plus requester or progress authority; projectless jobs cannot
borrow authority from payload text. Downloads require current matching export
permission, a succeeded associated export and a valid existing blob. Responses
supply safe attachment names and MIME types; audit records authorized response
preparation, without claiming transfer completion.

## Review and verification

Independent full and scoped reviews passed. The initial source review found a
legacy status traversal mismatch; an actual pure comparison first failed, then
both canonical orders matched the existing reader. A narrow public-repository
boundary correction also passed the unchanged architecture regression. Accepted
Task 8 routes, assignment semantics and contracts were preserved on merge.

Actual final-source checks passed:

- Complete new API/PostgreSQL module: 50 passed in 48.09 seconds.
- Eight affected API/job/export/edit-log/status/mode/visibility suites:
  90 passed in 72.30 seconds.
- Two pure legacy-status differential cases and the unchanged architecture
  regression: three passed in 1.88 seconds.
- Ruff/format, mypy, OpenAPI/TypeScript generation and drift, frontend typecheck,
  whitespace and integrated whole-tree Ruff/format checks.

The first database execution exposed four test-fixture assumptions, not production
failures: a generated pseudonym was mistaken for the username, and three imported-
origin cases incorrectly called public draft restoration on ambiguous history.
Test-only corrections use a distinct real pseudonym and the established stored-
local-draft fixture pattern, preserving restoration refusal and status assertions.
Independent scoped review approved the 31-line fixture delta. The complete final
50-case rerun verifies every case against the corrected shared fixture; earlier
partial passes are not combined to imply a full passing command.

The integrated runtime is byte-equivalent to the tested source for runtime,
tests, frontend, scripts, contracts and lock/config files. This accepts Task 9.
The final combined normal/browser/container gate is still Task 10; earlier Task 7
whole-gate evidence is not relabelled as a complete Task 9 gate. P9 latency remains
open, T7 is parked, and no main merge, push or deployment occurred.
