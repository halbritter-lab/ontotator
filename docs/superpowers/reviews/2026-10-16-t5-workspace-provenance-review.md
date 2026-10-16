# T5 Task14 dependency: offered workspace proposal metadata

The isolated backend dependency is accepted on 2026-10-16 at verified source
`5f082a6fffb2cd6552039821ae5f5444aa4b1def`. This does not complete Task14's UI.
Independent specification and quality reviews passed the production delta and
both narrow test-fixture corrections. Production source remains identical to
`aa33ddd947f763f7b3229f7b1d104e62c24c7583`.

Workspace views now include unique producer metadata for their actually offered
annotation inputs. The existing public metadata model is shared without changing
its fields or widening public proposal/ref/pending permissions. A bounded query
matches exact project/document/annotation/version/set associations and permitted
stored layers. The scoped read rechecks the current actor, mode, exact assignment
and workspace identity, including empty offers. Blind, hidden, foreign, sibling
and pending-only data cannot become metadata through this carrier.

Actual new PostgreSQL verification: all15 cases passed in30.80s at clean5f082a6.
They include current-authority negatives, real HTTP composition, one metadata
query for1/100 proposals, public denials and real durable reanchor provenance.
The one directly affected four-file selection then passed all119 cases in72.71s
at the same unchanged source. Both runs exited0 and retain the existing
Starlette/httpx deprecation warning. Logs, complete argv/UTC/source manifests and
clean before/after identity are retained in the owning worktree's
build/t5-workspace-provenance/root-pg-r2 and root-affected artifacts.

The first actual15-case attempt failed before its intended assertions because
the test profile made its default layer read-only. A test-only correction selects
the existing editable default. An earlier source review also corrected a second
exclusive ZIP import to use a fresh directory. Neither correction changes
production behavior, roles, scopes or negative assertions; all failures remain
recorded. Pure carrier/scope-registry checks, Python types/lint, generated
contracts and frontend type checks also have the separately reviewed source
evidence recorded in the canonical root reports, with their attribution limits.

Frontend consumption, pending-item display, final prerequisite integration,
browser acceptance and the complete T5 package/gate remain pending. This proof
adds documentation only; no main integration, remote push or deployment occurs.
