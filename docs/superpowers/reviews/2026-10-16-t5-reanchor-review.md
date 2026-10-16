# T5 Task 7: durable correction proposal reanchoring

Accepted on 2026-10-16 at runtime `e6e164e4a513e8ca5931f9653a942213fdf3f9c2`,
including accepted Task6 proof `2cb30d9` and the unchanged approved pure mapper
`520ba55`. This record also closes the separately deferred Task3 and Task5
correction-trigger obligations. It does not complete all of T5.

Both actual import entrypoints and accepted-corrected review submission enqueue
the real registered handler inside the same variant/review creation transaction.
Persisted producer identity proves the exact project, requester and correction
pair; workers recheck current authority without granting reviewers import or
proposal-reading privileges. Genuine precursor jobs are processed oldest-first,
including when later versions are claimed first. Existing scientific history,
raw imports and individual submissions remain immutable.

The worker rebuilds real target snapshots and validated T1 proposal sets from
exact predecessor source sets, retaining source references, namespaces, notes,
axes and defaulted basis. Changed whole annotations become typed pending items;
empty sources produce no output. Generated identity conflicts fail closed.
Replay inserts no duplicate sets or mutation audit, including after committed
handler effects precede an outcome-recording failure.

## Review and corrective evidence

Independent full specification/quality review found one Important issue: a
first successful import-parent outcome write could fail, after which the queue's
failure recording erased the already committed pair proof. Both real import
entrypoints reproduced that failure before the source correction. Success
outcome persistence now sits outside the handler exception block, propagating
its failure to existing worker handling and retaining the running parent's
proof. Genuine handler failure semantics and status/worker guards are unchanged.
The original independent reviewer approved the exact scoped correction with
no remaining source findings. Automatic recovery of a running parent is not
claimed.

Actual evidence is cumulative and retains exact invocation attribution:

- Initial new PG file at clean `4587606`: 27 passed, 5 failed in 110.73s.
  The failures were three exclusive-create fixture paths, an empty-set fixture
  expectation and computed output passed back into a strict input DTO.
- Test-only `ec7423d` correction: exactly those five nodes passed in 50.13s;
  tested working test blob equals the committed file, production unchanged.
- Parent-outcome regression at `ec7423d` plus test-only delta: both import
  parameters failed in 14.68s, proving actual committed proof loss.
- Corrective queue/test delta, later committed as `e6e164e`: four focused cases
  passed in 14.75s, including both new parameters, child-outcome replay and
  genuine failed-handler/null-result behavior. Both tested blobs match commit.
- One affected selection at clean `e6e164e`: all 33 cases passed in 53.89s,
  UTC 11:53:05.3289356Z–11:54:02.1706643Z. It covers queue, review atomicity,
  immutable/reopened history, locks, import/upload, T1 and sibling visibility.
  Source and status stayed unchanged through that invocation.

Full producer artifacts are retained in the owning reanchor-runtime worktree's
`build/task7-initial-pg`, `task7-five-followup`, `task7-parent-finish-red`,
`task7-parent-finish-green` and `task7-affected` directories. Each contains its
complete log and execution metadata; corrective runs retain working captures.
There was no all-34 passing invocation and no repeat of the unchanged pure38
bank. Scoped runtime Ruff/format/mypy, catalogue/OpenAPI/API/type checks and the
20-case reconstruction/affected-pure selection passed as recorded separately.
Root read the actual logs, metadata, source corrections and independent review.

Task8 export and the complete Part1 gate remain next. Frontend Tasks9–15 and
final matching assets/image/browser/container acceptance remain pending. P9
latency is still open; no main merge, push or deployment occurred. All required
Task7 test processes closed and returned the exclusive heavy token.
