# T5 final review and functional interim acceptance

2026-10-16. **Implementation Tasks 1–15: accepted for functional interim review.**
The user's acceptance remains pending. T4 is not started by this closure.

## Frozen runtime and local main

Runtime/source: `e72e2fa10c8f9527814ffb7e0f9127867ae5d26b`.
Immutable image: `sha256:f89b1437fcc36f46eb5cc040c5d42ff6c664cfcc2e4dd9c90ae88d08a1612ff1`.
Convenience tag: `ontotator:t5-interim-final`; the prepared stack uses the immutable ID.
The OCI revision equals the runtime source. The final acceptance commit changes
only documentation; its identity is separate from the runtime/image revision.

Local main was fast-forwarded from T3b proof b9544a6 to tested runtime134a930
at17:07:36 UTC, then to e72e2fa at17:16:08 after the fixture correction below.
Both operations recorded clean status and identical main/implementation trees.
No remote push or production deployment occurred. The main checkout is
`.worktrees/main-integration`; the original working checkout remains untouched.

## Source-bound verification

This is complete stage coverage across reviewed continuations, **not one
successful invocation of scripts/check.sh**. Failed runs and traces are retained.

| Check | Actual result and source |
| --- | --- |
| Ruff/format, mypy, OpenAPI, frontend types/API, lock/wheel | All passed in the134a continuation; no subsequent code/dependency/contract changes |
| Complete frontend | **1188 passed /116files**,185.36s at134a930 |
| Complete PostgreSQL backend | **2055 passed /1 expected POSIX skip /1 deprecation warning**,990.43s at0f4754f; all backend/test/dependency bytes remain identical |
| Browser | **74 unique passing cases**,73 in the complete134a run plus one original failed case in a same-source retry |
| Public demo profile | Native TaskProfile/check_t1_profile RED→GREEN, then **20 existing seed guards passed**,3.47s at e72e2fa |
| Matching final image | Complete installed manifest equals reviewed Git-archive manifest:156 package files,123 Python files,31 web files,LICENSES and notices |
| Final container/stack | **9 container checks +1 browser smoke passed**,81.07s at e72e2fa/f89b1437; smoke5.8s |

The original0f complete command failed eight existing geometry cases after its
backend pass. Reviewed layout composition/CSS restored the existing floors and
controls without lowering assertions. An old TextPane test double was updated
to render the new header slot; its authority assertions are unchanged. The134a
complete browser invocation had73 passes and one failure because Chromium's CSS
request failed with `net::ERR_NO_BUFFER_SPACE`; the unchanged original1000×700
tree case then passed in17.7s. Neither failed invocation is relabelled as passed.

The only134a→e72 change is the public demo profile and its manifest hash:
unsupported HPO temporality `future` was removed. All application code, backend
and browser tests, dependencies and assets are unchanged. The existing public
ZIP, ontology and cases retain their exact bytes. Profile SHA256 is
`32486b95866ad3df8a0f74870ae58cfd57a81da83d3e78d86e0720708196451b`.

Wheel SHA256: `3fb4ac29b3b560e25eca7f674e19c5c1cbdee8fbfe5c4f372d34915d0455468d`;
its156 package files match the working package. All31 web files match dist,
embedded assets, wheel and image. Git archive applies CRLF conversion to text;
installed-image bytes match that exact archive manifest. The working migration
0006 differs from the archive only in line endings, not Python content. The two
image payload manifests before/after the fixture correction are exactly equal.

## Actual persistent packaged validation

Dedicated project `ontotator-t5-acceptance-ready` runs the final image at
**http://127.0.0.1:18080**. PostgreSQL uses the internal Compose network; its
loopback15543 host binding is configured, but Docker reports no active PostgreSQL
host publication after restart. Owner migration completed successfully; app and
PostgreSQL are healthy. Both named data volumes
are retained. The first invalid-profile seed was stopped and retained separately;
it was never reset or retried on populated data.

Fresh seed passed in36.44s: six documents, two untouched OPEN user review
assignments1/2, a submitted unchanged review3 and OPEN annotation assignment4.
All three demo accounts are ordinary users with one role each. Repeated seed
was actually refused with exit1 before reseeding; credential/result files stayed
unchanged. Passwords remain only in the private local credentials file.

A separate `t5-validation-final` project and four ordinary users exercised the
packaged API in38.53s: unchanged acceptance, annotation opening, lead reopening,
corrected immutable review and a real succeeded reanchor child job3. Its result
is one carried annotation and one item needing review. Corrected child
`ready-translation~de~v2` is accepted and derives from the original; carried set7
identifies source version1. A bounded operator READ-ONLY lookup discovered the
exact child; the ordinary lead independently read the job through current API
authority. Old editable-workspace writes were refused with409; pending/foreign
review reads returned404 and the unrelated export download403.

Export job4 succeeded and downloaded two ordered immutable review records;
SHA256 `eb6d78d7728027059c0a9005867cd03f08abcf9b4abd924c0d5d11cf489f8b74` matches
job/result/download. The demo reviews stayed OPEN before and after validation.

Actual stop/up ran17:22:06–17:22:27 UTC using the same prepared project, image
and both volumes. Before/after public state and all three stored blob paths/
hashes are exactly equal, including reviews, versions, jobs and export bytes.
The post-restart browser displayed the corrected readonly version, literal old/
new pending contexts and carried source/version/tool/set metadata. It issued
zero work mutations; two exact same-origin term-label POSTs are metadata reads.
The probe's scoped navigation and read classification were independently
reviewed. Final ordinary-user readiness at17:28:03 confirms readyz200, minimal
roles, review assignments1/2 OPEN and annotation4 OPEN.

## Evidence and handoff

Retained implementation-checkout artifacts: `build/t5-final-gate-guard/`,
`t5-final-layout-mock-continuation/`, `t5-final-tree-1000-retry/`,
`t5-demo-fixture-recovery/`, `t5-final-image-demo/`,
`t5-final-demo-container-smoke/` and `t5-packaged-ui-complete/` under `build/`.
Actual failures remain alongside these results. Private main-checkout artifacts
are under `build/t5-acceptance/{demo-ready,validation-final,persistence-final}`;
never commit credentials, setup codes, cookies or these private outputs.
Independent source, stage, package and actual-runtime reviews are retained in
original-root `.superpowers/sdd/2026-10-16-t5-variants-review/`.

See the [local acceptance guide](../../operations/t5-interim-acceptance.md).
The persistent demo is intentionally left running. Temporary test stacks are
closed; the unrelated pre-existing PostgreSQL container was untouched.
**P9 latency acceptance remains OPEN; T4a/T4b and T6b remain OPEN; T7 is parked.**
This functional interim does not establish those later milestones.
