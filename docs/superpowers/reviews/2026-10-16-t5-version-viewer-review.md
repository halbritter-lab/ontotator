# T5 Task10: version viewer and guarded case navigation

Accepted on 2026-10-16 after independent specification/quality review of product
source `e43acae6f13161f5f5fc9672b13587d597bcefb2` and the final browser correction
`18d57e02f7273b96e7172f07941b5c8159054106`. The accepted Task9/Part1 proof is an
ancestor. No actionable findings remain in the reviewed Task10 scope.

The case viewer and editor consume exact opaque case/document identities,
server-offered annotation references and immutable text. Historical annotations
remain read-only; current task drafts retain their existing guarded navigation,
retry and submission behavior. Current actor/assignment authority is checked
independently of same-case text access. Version selection, tool provenance,
submitted history, reopened tasks and native history navigation are covered.

Product verification: 25 new focused cases passed, followed by 101 affected
router/editor/assignment/document cases. TypeScript, API drift and source identity
checks passed. Independent reviews inspected the exact tested source.

Actual browser evidence is cumulative across two invocations, not one13-pass
run. At clean `9f1b169`, all five existing design cases and six new variant cases
passed; two new interaction tests failed. Narrow test/fixture corrections retained
all assertions and ordinary-user privileges. At clean `18d57e`, both failed cases
passed their retry (28.8s). These exercise real UI submission/history locking and
dirty failed-save Cancel/focus/native Back/Forward/retry. The earlier passing
cases cover opaque identities, current authority, wide text/inspector/tree floors
and responsive1024/800/600 containment. Production source was unchanged by the
correction. Both real import-child jobs succeeded with no pending/proposal data.

The retry log retains a shutdown-order database error after both tests and child
jobs succeeded: the existing global teardown removes PostgreSQL before the
fixture worker stops polling. Closure checks found no retained listener, server
or own-run container. Task15 will assess the harness ordering. This is not an
error-free teardown claim.

Full producer/reviewer reports remain in the canonical root T5 controller
directory; actual browser logs, execution/source metadata, traces and closure
records are retained under the owning worktree's build/task10-browser directory.
Task10 is accepted. Comparison/review/admin integration, complete new UI browser
coverage, final embedded assets/image and the runnable interim remain pending.
No remote push or deployment occurred.
