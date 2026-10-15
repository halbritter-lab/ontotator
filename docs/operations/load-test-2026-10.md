# P9 representative load test — 2026-10-15

The first representative run **failed**. Performance acceptance is open; the
results below do not establish support for 30 concurrent users.

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
