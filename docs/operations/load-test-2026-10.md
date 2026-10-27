# P9 representative load test — 2026-10-15

Both representative runs **failed the P9 latency targets**. Performance
acceptance remains open. The second run completed without request failures,
but does not establish the required response times for 30 concurrent users.

## Reproduction and resources

Run the seeder and Locust commands in [the load-test guide](../../loadtest/README.md)
against a fresh, disposable dev Compose project. This run used source
`0f271181d815fd74b29d97242a745c42628e352b` and image
`sha256:46880966ddcffba281a483b65c2a332a51339787a120ccf82101f40f76af35ef`.

- Host: AMD Ryzen 5 2600, 6 cores / 12 logical processors, 17,125,634,048 bytes RAM.
- Docker Desktop: 4.95.0.242831; Engine 29.8.2; VM: 12 CPUs,
  6,213,025,792 bytes RAM.
- App: 2 CPUs, 2 GiB RAM, 2 Uvicorn workers, 256 PIDs, read-only root filesystem.
- PostgreSQL: 1 CPU, 1 GiB RAM, 256 PIDs, read-only root filesystem.
- HPO: release 2026-06-23, SHA256
  `3b646565695329aa399e937883c68d5d424d0df5eaab2f22baa0e08d44fdbe87`.
- Corpus: 1,000 synthetic documents, 1,500–3,000 characters each, three tool
  proposals per document; fixed RNG seed 20261014. No patient data.
- Load: 30 synthetic users, ramp 5 users/second, 0.5–1.5 seconds think time.
  Task weights: search 5, open 2, write 4, dashboard 1. A write task performs two
  measured command requests. Sessions, Origin, CSRF and revisions are enforced.
- Warmup: separate one-minute Locust process. Measurement: fresh five-minute
  process, including its six-second ramp; no warmup samples are included.

Seeding succeeded in 177.26 seconds. Warmup exited 1 after 62.19 seconds;
measurement exited 1 after 301.97 seconds. The owned Compose project and its
volumes were removed afterward. No application resource limits, connection pools
or acceptance thresholds were increased.

## Baseline results

Times are milliseconds; percentiles are Locust histogram estimates.

| Operation | Requests | Failures | p50 | p95 | p99 | Required p95 |
|---|---:|---:|---:|---:|---:|---:|
| Search | 120 | 9 | 530 | 31,000 | 43,000 | <150 |
| Open | 76 | 3 | 4,400 | 68,000 | 76,000 | <300 |
| Write | 188 | 7 | 460 | 30,000 | 38,000 | <150 |
| Dashboard | 11 | 0 | 201,000 | 212,000 | 212,000 | <500 |
| Setup/login | 30 | 0 | 2,500 | 7,500 | 8,000 | — |

There were 425 completed requests and 19 HTTP 500 responses. Failed users stop
rather than retry ambiguous commands. Consequently, this failed run is **not a
measurement of sustained throughput at 30 active users**. Dashboard's zero
failures does not meet its latency target.

The local evidence is retained under `build/p9-baseline/`: seed manifest, warmup
and measured logs, CSV statistics/failures/exceptions/history, `measured.html`,
runtime limits and `execution.json`. Machine identity is in
`build/p9-machine.json`. These generated artifacts remain ignored because they
include session-derived workspace identifiers.

## Diagnosis and follow-up

Runtime observations showed the app reaching approximately 200% CPU and its
2 GiB RAM limit, while PostgreSQL used approximately 125 MiB. Cgroup snapshots
recorded 857,960,448 bytes of swap, 113,368 major page faults and 2,350,753 direct
reclaim scans. No OOM kill was observed. App logs repeatedly reported SQLAlchemy
pool checkout timeouts (pool 5, overflow 10, timeout 30 seconds). Advisory-lock
waits and idle transactions appeared during the run and later eased; the
evidence does not demonstrate a permanent deadlock.

Source inspection identified three bounded causes to address:

1. Concurrent package-service cache misses can each build the same large lexical
   index before publication. Pinned services also rebuild ontology/index data
   when captured translation resources exactly match the base resources. The
   duplicate-build capability is established by code; the number of builds in
   this measured run was not instrumented.
2. Editing can resolve a cold package service inside a mutation transaction and
   draft advisory lock, retaining a connection during index construction or
   waiting. This amplifies connection starvation.
3. The dashboard resolves progress separately for each document. Static tracing
   predicts roughly 5,000 SQL statements and 3,000 transaction scopes for an
   otherwise empty 1,000-document dashboard. These are source-derived counts,
   not executed-query measurements.

Follow-up work deduplicates service construction, shares data only for exactly
matching captured resources, moves cold resolution before mutation transactions,
and batches status facts while retaining authorization and status semantics.
Focused regressions and review precede a rebuilt image and another full P9 run
under the same limits. Until that measurement passes, P9 remains open.

## Focused batch-query evidence

The batch-status follow-up (`b1f5452`, reviewed and integrated separately) used
SQLAlchemy `before_cursor_execute` around the real workspace listing against
PostgreSQL. Fixture preparation and authentication are excluded from these
counts. At 1,000 empty documents, independent and assisted listings each went
from **5,001 to 5 executed statements**, and review listings with proposal
presence from **6,001 to 6**. The new counts are also 5/6 at one document. A
1,000-document fixture with populated revision-1 drafts executes 5 statements.

Independent expected-status tests cover checked layers, draft content, later
edits, multiple submission origins, imported workspace aliases and review
rounds; scope tests cover project and user visibility. These focused checks
establish the reduced query count and tested semantics. They do not establish
latency, memory limits or full-workload acceptance.

## Rerun after the two contained fixes

Source: `0d51f5417ad5b6fa641f6bdcdd41870159ac20ed`; rebuilt image:
`sha256:3abc065be2a007d995a4c97cb464729c7f7b9fe7a4582cb4dff7a0e4a2f7ea6b`.
Machine, HPO, corpus, accounts, workload, warmup, thresholds, worker count and
Compose CPU/RAM limits were unchanged. Seeding exited 0 in 174.61 seconds;
warmup exited 1 in 61.67 seconds; the five-minute measured process exited 1 in
301.64 seconds. Its owned project/volumes were removed afterward.

The final console table records:

| Operation | Requests | Failures | p50 ms | p95 ms | p99 ms | Result |
|---|---:|---:|---:|---:|---:|---|
| Search | 2,238 | 0 | 380 | 1,400 | 1,900 | FAIL (<150 ms required) |
| Open | 907 | 0 | 230 | 1,100 | 1,400 | FAIL (<300 ms required) |
| Write | 3,679 | 0 | 300 | 1,300 | 1,900 | FAIL (<150 ms required) |
| Dashboard | 444 | 0 | 550 | 2,000 | 2,600 | FAIL (<500 ms required) |
| Setup/login | 30 | 0 | 230 | 1,000 | 1,200 | — |

The final console totals 7,298 requests with no failures; no failure-driven user
stops were observed. The last periodic CSV snapshot contains 7,294 requests
(two fewer search and two fewer write completions) at approximately 24.36
requests/second, also with zero failures and the same displayed percentiles.
These original artifacts are retained as written; they have not been reconciled
by editing the results. Evidence is under `build/p9/`: logs, CSV/HTML, execution
identity/limits and 30-second runtime samples. The instrument-free application
image was used; external runtime observations did not change its configuration.

The sampled cgroup peak was 2,115,624,960 bytes, close to the 2 GiB limit, with
zero swap and zero max/OOM events. Runtime observations found approximately
two CPUs consumed by the app, CPU pressure/throttling, and substantially less
PostgreSQL CPU/memory use. Two PostgreSQL snapshots had no ungranted locks;
sampled transactions were short, and the inspected app log tail had no pool
timeout/traceback matches. These observations support CPU saturation rather
than recurrence of the baseline swap/pool collapse. They do not exclude brief
unobserved waits or identify the specific function consuming CPU.

At this checkpoint the dashboard's full-text `Document` construction, lexical
scoring and endpoint model/SQL work were candidates without measured function
attribution. The separate diagnostics below investigate them. Instrumented
latencies are diagnostic only. P9 remains open; no resource, pool, workload or
target relaxation has been used.

## Diagnostic attribution and sparse-layout experiment

The initial concurrent function-profiler attempts produced absent or impossible
function timings and were rejected. They do not support an optimization claim.
Their ignored drivers remain disabled and their original artifacts are retained.
An alternative uses ordinary wall/thread-CPU clocks around twelve fixed sync
boundaries, with same-thread child subtraction, bounded numeric output and
concurrency/conservation checks. Independent local validation passed, including
160 concurrent nested-router requests and all twelve boundaries.

Diagnostic image `sha256:880cdd5440f8d2107c3af5058d40116d7b266f95da328dd87baed68b8e98fccb`
inherits the unchanged `0d51f54` image above. Its own project used the same HPO,
30 accounts, 1,000 documents and CPU/RAM limits. Seeding passed in 171.89 seconds;
the 61.11-second warmup exited 1 on its latency targets. The strict diagnostic
gate then stopped: one HTTP 400 request lacked an endpoint record, producing
one invalid-record and one status-error count. It occurred at phase offset
61.016 seconds, close to client shutdown; its cause is not established. The
server log summary had zero ERROR/traceback/timeout matches. No separate measured
diagnostic phase ran, and owned containers/volumes were removed.

The other 1,261 completed HTTP 200 requests have finite, nonnegative timings and
zero conservation/thread/exception counters. An explicitly labelled analysis of
completed responses after phase offset 20 seconds excludes that HTTP 400 and
the initial completion window. This is a short diagnostic slice, not acceptance:

| Operation | Completed requests | Selected sync CPU ms/request | Largest exclusive selected stage |
|---|---:|---:|---|
| Search | 342 | 92.155 | Lexical search: 51.541 ms |
| Open | 131 | 38.555 | SQL execution: 15.191 ms |
| Write | 537 | 46.843 | SQL execution: 21.458 ms |
| Dashboard | 65 | 87.632 | Full document load/construction: 42.955 ms |

These boundaries omit async validation/serialization, background/native worker
CPU and some transaction/fetch details. Inclusive parent/child times are not
added together. Evidence is retained in
`build/p9-stages/20261015-190912/`, including the failed gate and excluded status;
the analysis does not turn that gate green.

A further offline experiment used one Linux Python process and one profiler,
with sequential lexical calls and no server/concurrent Python profilers. On the
same real HPO, 24 fixed-seed substring queries took 0.835 seconds elapsed and
0.835 seconds main-thread CPU; summed profiler self time was also 0.835 seconds.
Twenty-four full sparse-layout conversions consumed 0.776 seconds, whereas
argsort consumed 0.008 seconds. The CSR matrix had shape 44,814 by 71,657,
3,041,487 nonzero values and 36,677,104 bytes of sparse storage.

Converting the fitted matrix once to CSC preserves the existing sparse scoring
operation while avoiding this full conversion per query. An in-memory probe
returned exactly identical hit dictionaries, including scores, for all 24
queries. One-time conversion took about 0.031 seconds and subsequent calls about
0.029 seconds total. The before loop was profiled and the after loop was not;
that ratio is not a controlled speedup measurement. Artifacts are under
`build/p9-lexical-serial/`. A narrow source fix, regression tests, review and a
fresh unchanged-workload P9 run are required before acceptance. No production
latency or memory improvement is claimed from this experiment.

## Combined reviewed-image rerun

The sparse-layout fix `9b98404` was independently reviewed and integrated with
the pinned-data isolation correction. Complete/subset corpora, raw scores,
ranking/ties and pinned views passed regression coverage; the final functional
gate passed all 1,050 backend, 436 frontend and 39 browser tests, plus real-stack
smoke/container checks.

This P9 run used source `a17fb6a4bad16af6656916091fff51fddb0ecc59` and image
`sha256:eb0dcc146d5952026ae9ce64b5b46a95bab4eccf096879d0d3abc177cf7483ed`.
Post-run verification matched all 79 installed application Python files against
the checkout byte for byte, including the CSC and pinned-view changes. The
instrument-free app retained the same two workers, 2 CPU/2 GiB app limit,
1 CPU/1 GiB PostgreSQL limit, HPO, accounts, documents, weights and think times.
Seeding passed in 176.45 seconds; warmup exited 1 in 61.58 seconds; measurement
exited 1 in 302.14 seconds. Owned containers/volumes were removed.

| Operation | Requests | Failures | p50 ms | p95 ms | p99 ms | Result |
|---|---:|---:|---:|---:|---:|---|
| Search | 1,931 | 0 | 610 | 1,700 | 3,000 | FAIL (<150 ms required) |
| Open | 731 | 0 | 540 | 1,600 | 2,500 | FAIL (<300 ms required) |
| Write | 3,082 | 0 | 650 | 1,800 | 3,100 | FAIL (<150 ms required) |
| Dashboard | 376 | 0 | 910 | 1,900 | 2,400 | FAIL (<500 ms required) |
| Setup/login | 30 | 0 | 260 | 640 | 770 | — |

The final console records 6,150 requests and no failures. The last periodic CSV
records 6,144 at 20.53 requests/second (one fewer search/open and four fewer write
completions), with the same p95 values. Both are retained unchanged under
`build/p9-final/`, with execution identity, HTML, logs, 17 runtime samples, an
additional PostgreSQL observation and the installed-source hash proof.

Sampled peak memory was 1,206,853,632 bytes, with zero swap and max/OOM events.
The app still reached roughly two CPUs. One PostgreSQL observation was 47% CPU
and 132.3 MiB. The lower memory peak does not establish a latency improvement:
this run fails every p95 target, and three p95 values are worse than the previous
run. The current evidence does not attribute that end-to-end behavior to one
function or justify another speculative change.

P9 remains an explicit open performance task. The reviewed functional foundation
and complete local gate permit the next independent administration plan to
proceed, without treating this failed acceptance as green. Existing diagnostics
and a read-only request-read preflight remain available for further investigation.
No resources, workload or thresholds were relaxed.

## Local profiling 2026-10-26 (not a P9 run)

**This is not a P9 measurement and does not claim a pass.** It is a
sequential, single-user profiling note made on a shared development machine
(Windows host, one in-process app, PostgreSQL 16 in Docker without the
Compose CPU/RAM limits). Base: `feat/ux-calm` at `12d5e3f8`.

Data: the `loadtest/seed.py` corpus (1,000 documents, 30 annotators, real HPO
2026-06-23), seeded locally through the admin CLI. On this base the seed script
no longer completes unchanged: `annotations_per_text` (1..5) refuses 30
assignments per document, new assignments default to the `proposals`
annotation mode (the Locust `independent` opens are refused), and spanless
findings need a note. For profiling only, the throwaway database had its
`annotations_per_text` check removed, assignments set to `scratch`, and
`require_spanless_note` off. The seeder and Locust file must be updated before
the next real P9 run.

Method: per endpoint, the Locust request bodies sent sequentially (50 opens,
50 searches, 100 commands, 17 listings), measuring wall time, executed SQL
statements (`before_cursor_execute`) and process CPU; plus `cProfile` and a
per-statement call-site trace.

Findings: request CPU was dominated by SQLAlchemy/psycopg work per statement,
not by lexical search. Editor requests executed 79–92 statements, mostly
repeated authorization re-checks; `require_document` loaded every assigned
document id (~1,000 rows) 5–8 times per request; search opened and locked the
whole draft only to check an annotation's layer; the documents listing rendered
IN lists of ~1,000 binds that psycopg re-parsed on every request.

| Endpoint | Before: mean ms / statements / CPU ms | After: mean ms / statements / CPU ms |
|---|---:|---:|
| Open | 258 / 92 / 110 | 199 / 68 / 78 |
| Search | 230 / 90 / 96 | 145 / 50 / 60 |
| Write | 192 / 79 / 85 | 165 / 65 / 73 |
| Dashboard | 124 / 16 / 74 | 87 / 14 / 50 |

Wall times include ~1–2 ms Docker Desktop round trips per statement and are
not comparable with Compose-network latencies; the machine was shared
(about ±10% noise). Commits: `9705d0c7`, `8266b0b1`, `c6fec5db`, `17e8c7d3`.

Still open: the remaining statements are layered re-checks (`require_workable`
3–5 times, project-id lookups ~10 times per write). A real P9 run under the
documented limits is required to know whether the ~25–40% lower per-request
CPU moves the CPU-saturated stack below its targets.

### Round 2 (same day): seeder repaired, request-scoped authorization memo

The seeder and Locust file now run on this base unchanged: a synthetic lead
raises `annotations_per_text` to 5 through the settings API, each annotator is
assigned one sixth of the corpus (every text has five annotators, ~167 texts per
user), opens use `proposal_check` (the mode the seeded assignments get) on the
user's own texts, and spanless findings carry a note. The local database was
re-seeded through `loadtest/seed.py` itself (admin CLI run locally instead of
`docker compose exec`, HPO 2026-09-01), so the open numbers below are
proposal-check opens and are not comparable with the round 1 table.

`ScopedRepository` (one per request) now memoizes the project-id lookup, the
document/visible-documents checks and the role/document part of
`require_workable` for the rest of the request. An entry is dropped as soon as
the request's thread executes any non-`SELECT` statement, and
`_before_workspace_locks` clears the memo once its locks are held, so checks that
guard a write are still read under the locks; the assignment row (status) is
always read fresh. Nothing is cached across requests.

| Endpoint | Before: mean ms / statements / CPU ms | After: mean ms / statements / CPU ms |
|---|---:|---:|
| Open (proposal check) | 464 / 129 / 164 | 326 / 92 / 125 |
| Search | 167 / 50 / 62 | 120 / 36 / 46 |
| Write | 171 / 65 / 66 | 144 / 52 / 62 |
| Dashboard | 78 / 18 / 24 | 86 / 18 / 38 |

Same method and noise caveats as above (50 opens/searches, 100 commands,
17 listings). The dashboard path does not use these checks; its change is noise.
The remaining open statements are mostly not authorization: the proposal-check
open opens the draft twice and re-reads the task profile and search conditions
four times each. A real P9 run is still required.

## P9 rerun 2026-10-27

**Result: FAIL.** Every p95 target is missed, by a wider margin than on
2026-10-15. Performance acceptance remains open.

Source `integration/2026-10-27` at `2efbb38e` (includes the 2026-10-26
profiling commits and the round 2 authorization memo); image
`sha256:55c4f799150a889ed45624de73b1a26b2992f5a4239f1f8e936a67bd2d4eebc3`,
built from that worktree. Docker Desktop 4.96.3, Engine 29.9.2, VM 12 CPUs /
6,213,029,888 bytes; same host as above. Fresh dev Compose project with the
image swapped in, verified limits: app 2 CPU / 2 GiB / 2 Uvicorn workers /
256 PIDs / read-only root, PostgreSQL 1 CPU / 1 GiB / 256 PIDs / read-only
root. HPO 2026-06-23, SHA256 `3b646565…fdbe87` (the release used above).
`loadtest/seed.py` and the locustfile ran unchanged: 1,000 documents, 30
annotators plus a synthetic lead, five annotators per text. 30 users, ramp 5/s,
0.5–1.5 s think time, weights unchanged. Seeding exited 0 in 465 s; the
one-minute warmup and the five-minute measurement both exited 1 (targets).

The workload is the round 2 one, not the 2026-10-15 one: opens are
`proposal_check` opens of the user's own assignments and every text has five
annotators. The same limits, users, weights and duration make it the
comparable acceptance test, but per-endpoint numbers are not directly
comparable with the earlier tables.

| Operation | Requests | Failures | p50 ms | p95 ms | p99 ms | Required p95 | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Search | 1,199 | 0 | 1,200 | 2,000 | 2,300 | <150 | FAIL |
| Open | 558 | 0 | 2,900 | 4,500 | 5,200 | <300 | FAIL |
| Write | 1,984 | 0 | 1,400 | 2,400 | 2,700 | <150 | FAIL |
| Dashboard | 259 | 0 | 560 | 900 | 970 | <500 | FAIL |
| Setup/login | 30 | 0 | 300 | 1,200 | 1,500 | — | — |

4,030 requests, no failures, 13.45 requests/second (20.53 on 2026-10-15).
`docker stats` every ~17 s during the measurement: app 193–209% CPU (the
2-CPU limit, saturated throughout), 1.26–1.27 GiB memory; PostgreSQL 60–102%
of its 1 CPU, 166–196 MiB. No swap or OOM. Evidence (logs, CSV/HTML, samples,
profiles) is under the ignored `build/p9-20261027/`; the stack and volumes were
removed afterwards.

Diagnostic profile (not part of the measurement): `py-spy record --gil` on
both workers for 40 s during a separate 30-user load. Shares of GIL-holding
samples:

1. SQLAlchemy/psycopg per-statement work: 73% inclusive (statement building,
   cache keys, coercion, execute/prepare). SQL compilation itself is ~2%, lexical
   search ~7%, pydantic ~2%. The app is CPU-bound on the number of statements,
   not on any one query or on search.
2. Authorization checks: 70% inclusive (`require_workable` 17%,
   `require_document` 14%, the memo wrapper 20%, `active_for` 7%,
   `require_annotation_gate`/`load_variants` 6%), spread over every endpoint.
3. Commands: 33% of GIL time (`run_mutation` 25%, of which the pre-lock
   checks `_before_workspace_locks` 9%); opens 19% (`open_draft` 7%); searches
   ~20%, of which `save_search_event` (a write per search) is ~10%.
4. PostgreSQL at 60–100% of its single CPU is close to becoming the next limit
   once app CPU drops.

The round 2 per-request reductions (25–40% fewer statements) are not enough:
under load each request still runs tens of statements, each costing about a
millisecond of Python CPU, and two saturated CPUs cannot serve 30 users
within the targets. No resources, workload or thresholds were changed.
