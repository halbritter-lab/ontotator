# T5 translation-review task and annotation-gate acceptance

Task6 is accepted at `eafafe0f7790053c7187fb09b06bf4277a2ef2bf` on
`feat/t5-review-task`, based on accepted Task5 proof
`f2c0818fc73915fc3d7766bc27c0822b8568d6cd`. This record and the status update
change documentation only. Real correction-trigger integration remains Task7;
the frontend task screen and whole Part1/final gates remain downstream.

Translation review now has actual assignment/distribution and dedicated HTTP
open/draft/submit/history routes. Shared eligibility checks current work role,
activity, original-source and target languages, explicit language overrides and
the annotate/review-only disjointness rule. Exact retries and management reopen
retain their distinct semantics. Native and already-accepted new review targets
are refused; qualification is required only at submission.

The default-on project gate protects new annotation assignments, editable opens
and new mutations/submits while preserving submitted read-only history and
successful receipt replay. Authority still precedes replay; the gate follows it
under current locks. Qualification APIs preserve omission/null/blank/max200
semantics; settings preserve explicit false. Current-owned task metadata and
MyTasks emit actual task/external identity and source/target languages without
opening work or adding per-task queries.

Full independent review found one boundedness issue: individual operations loaded
the project inventory, and confirmation repeated it per row. Exact-target
recursive metadata closure now follows only necessary predecessors and the
original translation source. Bulk confirmation reuses its just-revalidated
server snapshot while preserving current target checks and savepoints. A later
affected test exposed one extra snapshot query; selected positions and full
metadata now share one query, retaining the original query cap and SQL order.
Audit reconstruction and a private test-wrapper signature were updated without
removing existing assertions. Final independent scoped specification/quality and
evidence review passed with no remaining finding.

Actual verification is cumulative across the stated sources and reviewed deltas:

- Initial new API/PG selection: **28 passed, one fixture-expectation failure**,
  47.20s. The server correctly concealed records from an unassigned reviewer.
  The corrected case retains that denial and obtains real exact authority.
  A focused correction/new-edge selection then recorded **five passed**, 17.63s;
  the later actual-external-ID amendment recorded **one passed**, 11.36s.
- Three genuine SQL/materialization regressions failed before the first query
  correction. **Eleven focused PG cases passed**, 27.23s, including one-row
  native reads, exact two/three-row translation/correction closures, finite
  corrupt-lineage refusal, one inventory for multiple allocations, receipt
  replay/gate behavior and a real project-lock waiter. All four tested blobs
  match frozen `51a397e`.
- One affected invocation at clean `51a397e`: **69 passed, two failed**, 45.93s.
  The failures were the retained query cap and incomplete test reconstruction
  of newly recorded snapshot state. One separately authorized savepoint-wrapper
  case genuinely failed before its signature adaptation, 9.08s.
- The final bounded correction recorded **eleven passed**, 21.83s, from
  11:29:47.057501 to 11:30:11.955320 UTC on 2026-10-16. It covers both affected
  failures, actual post-create savepoint rollback, inventory reuse, all five
  new freshness inputs and stored/null-position order. All four tested blobs
  match final `eafafe0`; no subsequent source change occurred.
- A separate five-file frontend invocation at `51a397e` recorded **84 passed**,
  36.72s. Its frontend/API source is unchanged by the final backend/test delta.
  Scoped Ruff/format, mypy119, OpenAPI/catalogue/API drift checks passed; earlier
  focused catalogue/activation and error-map checks recorded four and seven
  passes respectively.

Working-delta runs are identified as such, with normalized blob comparisons;
they are not relabeled as clean parent/final-commit runs. No all34/all71 final
single invocation, repeated whole bank or whole-application gate is claimed.
Root read the full reports/reviews, final source corrections, actual logs,
command/time/exit metadata and comparisons in ignored `build/t5-task6-pg`.
All processes closed and the exclusive token returned. Detailed narratives remain
in the shared T5 SDD records. Format1.1 is unchanged, P9 latency remains open,
T7 parked; no main merge, push or deployment occurred.
