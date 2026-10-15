# T3a users and profile acceptance

Task 3 adds administrator user/code management, self profile/languages and
password changes. The existing authentication response remains unchanged.
Profile changes preserve omission versus nullable clears. Compound updates,
audits, credential generation and session revocation share their transaction;
failed current-password attempts commit before the API reports failure.

Implementation `4aa4af2` initially passed 124 focused PostgreSQL/auth tests.
Independent source review found a reciprocal administrator-edit deadlock through
target user locks and audit actor foreign keys, plus missing coverage of rollback
after actual compound flag writes. Both findings were resolved in `21c6360`.

Two deterministic concurrent HTTP regressions reproduced real PostgreSQL
deadlocks before the lock-mode correction. The corrected account helper uses
`FOR NO KEY UPDATE` for non-key mutations, retaining write serialization and
allowing audit foreign-key checks. A third regression verifies rollback of
completed flag changes, generation, sessions and mutation audits on a later
invalid profile value.

The final affected PostgreSQL/auth batch passed all 127 tests in 73.79 seconds.
Ruff, source formatting, mypy on 90 files and contract checks passed. The earlier
generated TypeScript/API checks passed; the lock correction changed no wire
contract. Existing Starlette deprecation noise is unchanged. The original
reviewer approved the scoped correction with no remaining findings.

Local detailed reports are retained under the administration plan's ignored SDD
workspace. Serial integration preserves the exact tested runtime source at
`21c6360`; documentation differs. Later T3a tasks, combined final browser/container
acceptance and the separate P9 latency acceptance remain open.
