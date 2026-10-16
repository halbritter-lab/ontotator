# T5 case/text and annotation-version API acceptance

Task4 is accepted at `c627535769fd3771cf9d9d1778c6f3728c71764c` on
`feat/t5-case-api`, based on accepted Task3 proof
`81b0787eabfa3477852dc7d57a0e26c1fbfd9374`. This record and the status update
change documentation only. Review services and later task/UI integrations remain.

The API now exposes metadata-only cases and exact variant metadata, immutable
text, current server-offered annotation-version references and their selected
snapshots, and typed pending reanchor information. Current sibling assignments
can grant case text without granting another variant's annotations or work.
Own submission history requires exact current annotation authority and the
current user's persisted local binding. Proposal references/payloads require
exact review authority or current management authority. Payload retrieval
rechecks the same offered-reference policy; unavailable IDs remain concealed.
Existing document lists keep exact-assignment visibility and bounded metadata
queries, with the added variant identity/status filters.

Independent specification/quality review found two issues: encoded opaque IDs
containing endpoint markers could select the wrong route, and an existing
central-guard enumeration lacked the new methods. The narrow route class now
matches encoded ASGI boundaries and decodes its captured identifiers once,
without replacing the request scope. The enumeration retains prior negative
and completeness assertions and checks the distinct named authority policies.
Original and scoped independent reviews passed with both findings resolved.

Actual evidence is cumulative, not one successful combined invocation:

- Initial new PostgreSQL/API bank: **21 passed, 36.01 seconds**, at accepted
  Task3 HEAD plus the captured working feature delta.
- A missing-target existence regression genuinely failed, then **six focused
  cases passed, 16.84 seconds**. Captured source comparisons show only its two
  Python/test paths changed among the initial tested feature blobs; two later
  frontend fixture additions supply required metadata and retain assertions.
- One affected invocation at clean `b5edb95`: **101 passed, one failed,
  44.24 seconds**. The failure was the enumeration corrected above; the original
  failed invocation is retained.
- The routing regression genuinely failed before correction. The final bounded
  routing/guard selection then recorded **nine passed, 18.16 seconds**, from
  10:38:31.377520 to 10:38:52.659441 UTC on 2026-10-16. It includes six actual
  PG/HTTP cases, the existing PG enumeration and two direct matcher cases.
  All five tested correction blobs equal frozen `c627535`.
- Scoped Ruff/format, mypy115, OpenAPI/catalogue checks and frontend type/API
  drift checks passed. Earlier catalogue and frontend error checks recorded
  three and seven passes respectively.

HTTP checks assert exact identities, text, current authentication and concealed
foreign/missing records for endpoint-marker IDs, version IDs ending in endpoint
names, slash/space/hash/Unicode and literal percent encodings. ASGI raw_path is
required to retain encoded parameter boundaries; its absence delegates the
normal stack behavior. Actual root-path HTTP evidence covers proxy-stripped
incoming API paths. Prefix-included matching is directly checked, but prior
full-app attempts exposed an existing authentication middleware limitation for
that deployment shape. Those failed attempts remain recorded; this change does
not claim new prefix-included authentication support.

Root read the producer report, final scoped source delta, independent reviews,
actual execution metadata and source comparisons. Detailed logs remain in
ignored `build/t5-task4-pg` in the case API worktree; producer/review narratives
remain in the shared T5 SDD records. All heavy processes closed and the token
returned. No repeated whole-bank pass, whole T5 completion, reanchor runtime,
main merge, push or deployment is claimed. Format1.1 remains complete and
unchanged; P9 latency remains open and T7 parked.
