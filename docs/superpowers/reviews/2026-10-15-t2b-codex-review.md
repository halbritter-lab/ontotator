Found **3 Important and 2 Minor issues** at `2920c6c`. This was a static, read-only review; no files changed and no tests were run.

1. **Important — New accounts can inherit another annotator’s existing work.**  
   [accounts.py:264](C:/Users/jan-p/Development/ontocurator/.worktrees/t2b-accounts-sessions/src/ontotator/auth/accounts.py:264)

   `_next_pseudonym()` checks only `users`. Migration 0002 starts the sequence at 1 without reserving identifiers already present in T2a drafts and submissions. If existing work belongs to `ann-0002`, bootstrapping the administrator and creating an unrelated regular user assigns that user `ann-0002`. The identity checks then accept access to the historical workspace, including edits and exports.

   **Fix:** Reserve existing annotator identifiers during migration and require an explicit administrator mapping to claim historical identities. Automatically generated pseudonyms must avoid reserved identifiers. Add an upgrade test with populated T2a workspaces; current account tests start with empty identity data.

2. **Important — Concurrent logins exceed the address rate limit.**  
   [sessions.py:152](C:/Users/jan-p/Development/ontocurator/.worktrees/t2b-accounts-sessions/src/ontotator/auth/sessions.py:152)

   The failure count and attempt insertion are separate operations protected only by the selected user’s row lock. Requests for different usernames can therefore observe the same available address allowance. With 29 recorded failures, concurrent requests can both pass the address check; one can create a session after another commits the thirtieth failure. The excess grows with concurrent requests and server processes. Spoofing forwarded headers is unnecessary.

   **Fix:** Serialize enforcement per client address, using a transaction advisory lock or an atomic limiter record, with consistent lock ordering. Obtain the enforcement timestamp after acquiring locks. Add a concurrent test starting immediately below the threshold; the existing address-limit test is sequential.

3. **Important — A failed lease reconnection permanently disables recovery exclusion.**  
   [lease.py:86](C:/Users/jan-p/Development/ontocurator/.worktrees/t2b-accounts-sessions/src/ontotator/storage/lease.py:86)

   After detecting a lost connection, `check()` clears `_conn` and attempts reconnection at line 98. If PostgreSQL is still unavailable, reconnection raises. Every subsequent check sees `_conn is None` and returns success without retrying. Once PostgreSQL returns, normal pooled requests can resume while the server holds no runtime lease, allowing `recover-admin` to run alongside it indefinitely.

   **Fix:** Track whether the running server requires the lease and retry acquisition while that requirement remains active. Add a test where the first replacement connection fails and a later check succeeds; existing tests cover immediate replacement only.

4. **Minor — Login timing still reveals account existence.**  
   [sessions.py:143](C:/Users/jan-p/Development/ontocurator/.worktrees/t2b-accounts-sessions/src/ontotator/auth/sessions.py:143), [passwords.py:106](C:/Users/jan-p/Development/ontocurator/.worktrees/t2b-accounts-sessions/src/ontotator/auth/passwords.py:106)

   Concurrent failed logins for an existing username serialize behind its row lock throughout Argon2 verification. The same requests for a nonexistent username run concurrently because no row is locked. This provides an enumeration signal without knowing a password. Separately, accepted stronger bootstrap/recovery hashes take more work than the fixed, cheaper dummy hash, producing another timing distinction.

   **Fix:** Apply equivalent serialization to normalized usernames whether they exist or not, and equalize failed-login verification cost across supported hash policies. Tests currently verify identical responses and one Argon2 invocation, which do not establish equivalent timing.

5. **Minor — Supplied-hash validation accepts severely truncated hashes.**  
   [passwords.py:148](C:/Users/jan-p/Development/ontocurator/.worktrees/t2b-accounts-sessions/src/ontotator/auth/passwords.py:148)

   `assert_policy()` validates memory, iterations and parallelism, but never checks digest or salt length. An otherwise valid Argon2id hash generated with `hash_len=4` and `salt_len=8` passes bootstrap/recovery validation despite the application normally using a 32-byte digest and 16-byte salt. The four-byte digest limits resistance to an offline matching-password search to approximately 32 bits. Rehashing after successful login leaves the weak credential exposed until then.

   **Fix:** Validate decoded hash and salt lengths against the application’s minimums, as `needs_rehash()` already does. Add supplied-hash rejection tests for short digests and salts.

**Verdict:** Request changes before merging, particularly for historical identity ownership, concurrent address throttling, and lease recovery.