# T5 variant-storage acceptance

Task2 is accepted at `c2bb9047d475f7d4b591436d645c5ffe75fd04f8` on
`feat/t5-variants-review`. The completed format1.1 prerequisite remains unchanged.
Final accepted T3b proof `b9544a693934006e17fd2f192f6c540df999b085` was merged
before actual T5 PostgreSQL execution. This record/status update are docs only.

Migration0006 adds variant identity/ancestry/status metadata and native backfill,
the qualification and default-true annotation-gate columns, append-only
translation reviews, mutable review drafts and reanchor-set storage. Both real
native document writers populate case/external identity. New metadata-only
repository reads retain current exact-document visibility and explicit scope
overrides. The independent override policy matrix grants the project action only
to administrators and leads. Later tasks add import, review and gate behavior.

All production source, mappings/migration names/defaults/FKs/grants/history
triggers, native writers and current metadata authority passed independent
specification and quality review. Two missing raw SQL fixture identities were
corrected through a scoped review; an additional qualified table-insert fixture
was found by actual PostgreSQL execution and corrected without changing its
stale-plan assertions. No unresolved finding remains.

Actual verification, retained in ignored `build/t5-task2-pg`:

- **25 new PostgreSQL cases passed**, 15.51 seconds: migration/backfill, strong
  constraints, app/owner immutable history, mutable drafts, both native writers,
  bounded metadata and current authority.
- The thirteen-file affected batch recorded **364 passed, one fixture failure**,
  210.50 seconds. It includes schema/scope/visibility, assignments/distribution,
  project/progress/upload APIs, repository and T1 import/export preservation.
- The exact affected five-case function then **passed all five**, 16.16 seconds,
  after adding only its native case/external identity fields. The364 unaffected
  passes remain applicable to unchanged production code. There was no single
  all365-green invocation; the original failure/log/metadata remain preserved.
- Earlier pure chain/policy tests:104 passed, plus one scope-enumeration check.
  Ruff/format/mypy110 and exact final committed-range whitespace checks passed.
  The final fixture correction passed its scoped Ruff/format checks.

Source during PostgreSQL runs was `ad4a8e5` with the documented final fixture
delta committed as `c2bb904`. All sessions closed and the exclusive heavy token
returned. Independent final scoped source/evidence review confirmed the actual
three log/JSON sets, unchanged production code and clean final source. The
shared T5 SDD task-2-report.md and task-2-review.md retain complete evidence.

Task3 variant import is in progress in its separate branch. Approved pure review
rules and codepoint reanchoring banks remain separate for their planned later
integration. The next combined application gate follows the Part1 backend work;
Task2 acceptance does not claim application review UI or reanchor-job completion.
P9 latency remains open; T7 is parked. No main merge, push or deployment occurred.
