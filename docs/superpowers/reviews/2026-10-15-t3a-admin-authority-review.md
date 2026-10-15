# Administrator-write authority follow-up

Accepted source `b1f4f4dea15d43c7ee6ffe104aa6905c36fcefbd` is integrated through
`9e25f9aff183c619637c564d4cbb9dbe2c4975a2`. Independent scoped specification
and quality review approved the correction with no findings. The shared
authority helper is identical to the helper already accepted with Task 4.
Whole-tree Ruff and formatting passed after integration (267 files).

Previously, an administrator request could pass its initial permission check,
wait behind another administrator's demotion, then restore its own admin flag.
Create, reset-code and user PATCH now recheck current actor authority and
session validity after ordered user-row lock waits. Actor SHARE/target NO KEY
UPDATE locks retain authority through the write transaction, preserve audit
foreign-key compatibility and avoid reciprocal lock-order cycles. Existing
admin-removal locking, compound rollback and trusted account-service/CLI
behavior remain intact. Session expiry uses the session service's clock.

Actual verification:

- Thirteen authority regressions failed before the correction; fifteen focused
  authority/reciprocal cases passed afterward.
- The affected accounts/session/auth/admin/me/CLI batch passed 160 tests in
  203.48 seconds, with one expected Windows POSIX-permission skip.
- Three additional clock regressions reproduced valid-session refusal and
  missed virtual expiry. After the narrow clock correction, all 38 touched
  administrator/authority tests passed in 31.82 seconds.
- Final Ruff, formatting, mypy and OpenAPI drift checks passed. There is no
  wire-contract change. The inherited Starlette TestClient warning remains.

The broader affected batch predates the clock-only correction; the final
touched suite covers that correction. Current session validation is a read
after user locks, without a new guarantee to serialize standalone logout
committed after that read. Final combined administration acceptance remains
part of the later full gate; no new container or latency result is claimed.
