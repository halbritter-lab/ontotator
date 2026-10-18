# Usability-first execution roadmap (2026-10-17)

**Baseline:** Ontocurator `main` at `4de9aaa`. This is the execution index for the five Phase 0 plans. It refines the ordering in [the original roadmap](2026-10-17-next-agentic-work.md); original decisions remain the source of product intent.

**User instruction:** Finish planning autonomously, then implement already decided functions with efficient agents. Do not merge or push without approval. Preserve the user's T5 acceptance demo on port 18080. English files/commits, German conversation, no co-author trailers or generated-by lines.

## Priority and readiness

Deliver a reliable everyday annotation/review loop before workflow builders, reporting pages or cosmetic expansion. A batch is complete only with focused tests, review and recorded acceptance evidence; a written plan is not implementation completion.

| Priority | Deliverable | Plan / tasks | Dependency and readiness |
| --- | --- | --- | --- |
| P0.1 | Read source/translation without forced jumps or implied semantic alignment | [B0.1 scrolling](2026-10-17-phase0-coupled-scrolling.md) | D1 decided; ready |
| P0.2 | Stable decision keys, visible defaulted values, one explicit completion confirmation | [B0.2 semantics](2026-10-17-phase0-decision-semantics.md), Task 1 | D4/D5 decided; ready; sequence CaseScreen edits after B0.1 |
| P0.3 | Restrict independent version browsing without breaking assigned translation review | [B0.4 access](2026-10-17-phase0-access-and-cleanups.md), access tasks | D16 decided; P0-A clarifies own-history scope |
| P0.4 | Configure findings without text evidence: prohibited, required reason, optional reason | B0.2 Task 2 and 2026-10-18 clarification | All three modes implemented with migration 0009; approved P0-S now enforces the selected mode on every future submission |
| P0.5 | Distinguish unresolved review from clinical uncertainty; require note; export explicit flag | B0.2 Tasks 3–4 | Implemented: pinned ontospan 1.2, flagged unresolved export and approved P0-U validation |
| P0.6 | Finish reviewing findings after text correction | [B0.3 re-anchor](2026-10-17-phase0-reanchor-decisions.md) | Implemented: frozen queue and approved P0-R submission blocker; migration 0008 |
| P0.7 | Remove duplicate controls and opaque labels | B0.4 remaining tasks | Shared editor files stable; keep behind correctness tasks |
| P0.8 | Verify and prepare isolated acceptance candidate | [B0.5 acceptance](2026-10-17-phase0-demo-refresh.md) | Combined local gate; reproducible dependency pin; old demo untouched |
| P1 | Update T4a/T4b plans to current contracts, then minimum usable workflow | Original B1.1 and T4a batches | D6–D15 answers and Phase 0 contracts; do not execute stale T4 plans |
| P2 | Review/adjudication, final export and agreement within approved scope | Revised T4b | T4a and D9–D12 |
| P3 | Editor layout/refactoring, help and onboarding | T6b spec first | Preserve the working annotation loop; move a concrete usability blocker earlier only with evidence |

Login/NAT hardening can run independently when capacity exists. Refresh P9's removed-endpoint workload before treating its old latency numbers as current evidence. D14 determines performance priority/deployment targets. Do not let either consume all test capacity while the annotation loop is unfinished.

## Efficient execution protocol

- Coordinator owns this index, technical integration, decisions and final verification. Use the current coordinator; a model change is not required just to maintain the plan.
- `gpt-6.1-sol`, reasoning `medium`, implements each coherent 2–5-task batch. Supply fresh, bounded context: plan, relevant product/design constraints, exact workspace and file ownership, decisions, tests, expected output. Reuse that agent for its fixes instead of restarting the investigation.
- `gpt-6-astra`, reasoning `high`, performs one content/architecture review of the complete plans and a final implementation review focused on clinical semantics, data compatibility and permissions. Routine focused code review may use `gpt-6.1-sol` high. Escalate only unresolved problems, not every file.
- At most two implementation workers plus the coordinator; one test-heavy process at a time while sharing this 16 GB host (user RAM constraint, 2026-10-18). Use independent worktrees for implementation. Agents never change the shared checkout branch or merge their work.
- Work that touches CaseScreen, generated API files, repository.py or migration chains is sequential unless ownership is explicitly split. B0.1 and B0.4 are not automatically conflict-free merely because the old roadmap marked them parallel.
- Review/test a coherent deliverable once, fix findings, rerun affected checks. Run the full local gate on the integrated candidate before requesting merge. Do not repeat full suites for documentation-only changes.
- Implementation authorization is already given for decided functions. Do not ask again for routine code edits, branches, local commits or tests. Clinical gates below stop only dependent tasks; continue the ready tasks.
- Branches and commits remain local. Preserve `.impeccable/critique/` and all user changes. No write or automated acceptance journey against the reserved demo.

## Immediate policy register

These narrow questions resolve actual implementation gaps; they do not reopen D1–D5.

**Binding approval, 2026-10-18:** The user answered “ja darfst du alles” to the explicit six-item request. P0-S, P0-A, P0-R and P0-U below are approved as recommended. The same approval permits pushing only ontospan `feat/review-resolution-format` at `738f3d43ca0896c9d146a15fb9538b938229368a` without merging, and replacing the implementation worktree's embedded frontend with the verified build, removing obsolete generated bundles. The ontospan remote branch now resolves to that exact commit. No Ontocurator push or merge is authorized. Earlier pending statements below describe historical checkpoints and are superseded by this approval.

Technical execution: enforce P0-S when submitting every open draft; preserve the existing marker for incremental legacy edits and do not rewrite completed submissions. P0-A confirms existing exact own-history access. P0-R checks the frozen per-reviewer queue, not later document-wide arrivals. P0-U applies ordinary result validation to unresolved targets; historical export failures remain explicit. Refresh embedded assets after the remaining UI edits to avoid repeated generated changes.

On 2026-10-18 the user clarified D3: projects must also be able to allow spanless findings without a required reason. The three-mode correction is implemented and verified; the later six-item approval also settled P0-S. Keep the previously implemented required-reason default until a different default is selected. See the binding amendment in the decision-semantics plan. That earlier answer alone did not grant publication or asset replacement; the later six-item approval grants those two specific actions. Ontocurator merge/push remains unapproved.

| ID | Question | Recommendation | Status |
| --- | --- | --- | --- |
| P0-S | Apply the selected spanless rule to existing open drafts? | Keep completed submissions immutable; enforce the project's selected mode at the next submission: evidence/removal if prohibited, a note if required, or no mandatory note in optional mode. Imported proposals remain readable. | Approved and implemented 2026-10-18 |
| P0-A | Can independent annotators still read their own previous submissions? | Yes, through own-history access; restrict general version browsing/comparison. Assigned translation reviewers retain source/target access. | Approved 2026-10-18; existing implementation retained |
| P0-R | Must every frozen pending re-anchor item be resolved before submitting its review? | Yes; re-create or dismiss with a reason, with a count and jump from submit. | Approved and implemented 2026-10-18 |
| P0-U | May an unresolved proposal with unknown/obsolete term or incomplete required clinical content be submitted/exported as a finding? | Require correction or rejection for new submissions; preserve historical data and expose export failures explicitly. Do not silently discard or promote it. | Approved and implemented 2026-10-18 |

For D2, new unresolved decisions require a note as already approved. Historical decisions without notes remain readable; exports must not invent notes. The plan specifies an explicit legacy warning. Format field names and minor version are technical decisions, not an additional user approval gate.

## D6–D15: compact questions for the next product step

Recommendations are not decisions. Record each actual answer in this table before revising dependent implementation plans. They do not block ready Phase 0 tasks.

| ID | User question | Recommended option and alternative | Unblocks |
| --- | --- | --- | --- |
| D6 | Which workflow setup is needed first? | Templates for single, sequential, parallel + adjudication, with reopen/reassign/skip/declare-final; alternative: free chain editor and all six interventions. | T4a scope |
| D7 | How many blind-mode controls should users manage? | One stage policy plus the allowed show-others switch; alternative: also a personal preference. A switch must never override prohibited visibility. | T4a visibility |
| D8 | Handle tool proposals arriving after work starts now? | Defer adoption/ignore notices to T7; alternative: add explicit notices and adoption now. Frozen active inputs remain stable either way. | T4a late-input work |
| D9 | Where should agreement appear? | One explained number per document in Progress and Adjudication; alternative: a dedicated page. The measure and treatment of unresolved findings need a definition before implementation. | T4b agreement |
| D10 | What release/export UI is needed first? | Minimal immutable export of final results; alternatives: full release builder, or defer releases. D2's ordinary flagged export is distinct from final release eligibility. | T4b releases |
| D11 | How should comments work? | One annotation note visible to authorized lead/next stage; alternatives: threads, or no general comments. Required D2/D3 reasons remain mandatory regardless. | T4b comments |
| D12 | Which contributor names should reviewers see? | Leads see display names, adjudicators see neutral A/B/C; alternative: pseudonyms everywhere. | Identity display |
| D13 | Which primary noun should the UI use? | Document, with language/version attributes; alternative: retain distinct Case/Task/Document/Variant labels. Internal IDs/types remain explicit. | T4a UI labels |
| D14 | When should performance hardening run? | In parallel with functional work after fixing the workload, using deployment-size targets; alternative: block T4 until completed. Supply expected simultaneous users and document/ontology size when setting targets. | P9 scheduling |
| D15 | Which remaining provisional Q15–Q32 policies are accepted? | Review the conflicts below individually, then confirm unaffected defaults from the linked index as a block; alternative: review every Q separately. | T4 policy consistency |

D15 must not silently reconfirm superseded defaults from [the old index](2026-10-14-t3-t5-t4-index.md):

- Q23: may an ordinary export contain flagged unresolved findings while a final release requires all findings resolved? Recommendation: yes. This preserves D2 without declaring unresolved work final.
- Q25: after release, may earlier annotators see the final result through a dedicated result view, despite D16's restriction during independent work? Recommendation: yes after release, never during active blind work.
- Q28: unrestricted sibling text browsing conflicts with D16. Recommendation: D16 replaces it during independent annotation; translation-review source/target access remains task-scoped.
- Q29: may both annotators and adjudicators perform a revise stage? Recommendation: yes, with a valid assignment and stage visibility policy.
- Q22 versus Q25: seeing a released result and downloading a release are different rights. Recommendation: lead/admin download, eligible members read a released result; do not grant bundle download implicitly.
- Q24/Q31/D11: sending notes back to earlier annotators can reveal later-stage work. Recommendation: apply the same final-result visibility boundary; do not silently send later notes into an active independent task.
- Q32 overlaps D12: record the D12 answer once and apply it consistently.

## Verification and execution record

- Planning baseline checked: main SHA `4de9aaa`, one checkout, untracked critique artifacts, `build/t5-acceptance/demo-ready` present; stale worktree path corrected in operations docs.
- Docker was reachable during planning. Locked dependencies were restored with `uv sync --frozen` and `npm --prefix frontend ci`; the initial environment lacked ontospan and the frontend `diff` package. No dependency manifests or lockfiles were changed.
- Planning verification: inspect paths, links, task dependencies, decisions and `git diff --check`; no claim that product tests passed.
- [x] Plans reviewed and prepared for the local docs commit on `docs/phase0-execution-plans`; see `../reviews/2026-10-17-phase0-plan-review.md`.
- [x] P0.1 completed and reviewed (`2fcfa34`, review fixes `ed9bca9`); complete source gate passed.
- [x] P0.2 completed and reviewed (`9191b36`, journey tests `7b1fd89`, review fix `57f0f1e`); complete source gate passed.
- [x] P0.3 implemented and independently reviewed. P0-A approved exact own-history access; assigned translation review and independent restrictions are preserved.
- [x] P0.4 implemented and independently reviewed: migration 0009, notes/settings and all three modes; approved P0-S applies the selected rule to every future submission, including existing drafts.
- [x] P0.5 implemented and independently reviewed: ontospan 1.2 pin, faithful flagged exports, legacy warnings, explicit invalid-target failures and flagged-import refusal; exact downloaded-ZIP browser assertions passed.
- [x] P0.6 implemented and independently reviewed: frozen inputs, exact-version resolution and audit, approved P0-R count/block/jump, persistence, isolation and replay assertions.
- [x] P0.7 implemented and reviewed; editor/admin cleanups preserve approved own-history access.
- [x] Embedded frontend refreshed and its 31-file hash manifest verified against the fresh build and packaged image.
- [x] Final combined source gate12 exited0: 1,305 frontend, 2,183 backend (one Windows skip), 87 browser; 1,863 seconds.
- [ ] Candidate preparation status recorded; merge/push approval requested only for a concrete reviewed result.

Checked items above have implementation/review evidence; final integration and candidate readiness are tracked separately. If an external dependency publication or unanswered product policy blocks a subtask, record it precisely and continue independent authorized work.

### Historical implementation evidence

The entries below record successive checkpoints; their pending statements are superseded by the approved completion and current verification record.

- B0.1: 74 focused component tests and typecheck passed. The comparison/translation-review browser run passed 17 of 18 cases; the remaining native Windows clipboard assertion passed after normalizing only CRLF in the test. Two independent review findings were reproduced and fixed in `ed9bca9`, with 33 focused tests passing and a scoped rereview approving both fixes. Desktop/narrow screenshots were inspected. The complete final source gate also passed.
- B0.4 ready cleanups: `312554d` replaces flags with language codes, removes the Progress placeholder and explains hidden-axis effects. 47 focused tests passed; independent review found no actionable findings. This does not complete the access or remaining editor tasks.
- B0.2 Task 1: one explicit document confirmation, idempotent outcome shortcuts and defaulted-result warnings are implemented. 55 focused component tests, 47 navigation/session tests, seven browser cases and 55 final targeted backend tests passed. A broader backend run passed 289 cases and exposed one obsolete validation assertion, subsequently corrected and rerun. Review found an effective-result filtering error; five new regression cases and a scoped rereview verified `57f0f1e`. Historical per-layer fields remain readable.
- B0.4 decided D16 slice: `bf88e37` restricts public sibling text/metadata and generic browser controls while preserving assigned translation-review inputs and exact own output metadata. 76 UI tests, 68 targeted backend follow-ups, 117 policy/visibility tests, 16 lineage tests and five output/input/roundtrip tests passed. Browser failures in the initial 6/8 run were corrected and passed in a four-case follow-up. Independent Astra review through this commit found no actionable P1/P2 findings. Own-history policy remains pending; no new permission was inferred.
- B0.2 Task 3: `9909bd7`, `b0fd793`, `ac0935e` and `defe2ac` implement the reviewer-note requirement, visible Unresolved label, preserved local invalid edits, explicit route-discard behavior and legacy clean-state compatibility. 75 backend tests, 152 integration/component tests, four browser cases and 104 targeted tests after the final legacy fix passed. Astra approved the final scoped fix. Flagged export remains unfinished; UI explicitly says unresolved proposals are excluded by the current exporter.
- B0.4 remaining editor cleanups: duplicate manual replacement selection is removed; existing Edit & Replace remains. Existing own-history rows use readable dates and distinct ordinals, retaining exact IDs in details. This changes presentation only and does not settle P0-A.
- One final mechanical UI scan of the 13 changed TSX/CSS files reported no findings. Embedded-web refresh was rejected by automatic approval review even after narrowing removal to two named obsolete generated files; explicit permission is pending. Source validation continues, but the bundled frontend is not yet updated.
- Ontospan prerequisite: local reviewed commit `738f3d43ca0896c9d146a15fb9538b938229368a` adds format 1.2 structured review resolution, preserves frozen schemas and rejects lossy Phenopacket conversion. Upstream tests: 251 passed, one Windows symlink skip. Independent compatibility review approved it. Publication approval is pending; Ontocurator has not been pinned to an unavailable remote commit.
- Final source verification at `0e8fe52`: `scripts/check.sh` exited zero with 1,263 frontend tests, 2,089 backend tests (one Windows POSIX-permissions skip), 81 browser tests, static/type/contract checks and wheel lock/content checks. Integration failures were corrected without weakening semantic/security assertions; the only additional production change was the reviewed error-code catalog entry `54a3ea4`. See [the verification report](../reviews/2026-10-17-phase0-verification.md). The fresh frontend build passed, but embedded assets remain old pending permission; no release image or isolated acceptance candidate is claimed.
- Current integrated verification at `bf80b24`: `scripts/check.sh` exited zero with 1,289 frontend tests, 2,146 backend tests (one Windows POSIX-permissions skip), all 86 browser cases and static/type/contract/wheel checks, in 1,503 seconds. This covers the independently reviewed D3 new-draft and re-anchor storage/action implementations and integration corrections. The frontend build passed; the final five-file UI scan had no findings. Embedded assets, flagged export, unanswered policy slices and an isolated acceptance candidate remain open. Detailed evidence and the test-resource observation are in [the verification report](../reviews/2026-10-17-phase0-verification.md).
- Latest integrated verification on 2026-10-18 at `ad23b28`: three-mode D3 correction `240800c`/`1de4616` independently approved; test-only migration fixture correction `ad23b28` preserves the original assertions. `scripts/check.sh` exited zero with 1,298 frontend tests, 2,156 backend tests (one Windows POSIX-permissions skip), all 87 browser cases and static/type/contract/wheel checks, in 1,556 seconds. Fresh frontend build and bounded two-file UI scan passed. Existing-open-draft policy, other unanswered policies, flagged export, embedded assets and acceptance candidate remain open.


### Approved completion and resource constraint (2026-10-18)

P0-S/A/R/U are implemented and independently reviewed. Backend `873e466` and UI `0480fe2` cover flagged unresolved exports, current-rule submission validation and frozen re-anchor completion. The ontospan branch was published with specific approval and pinned to `738f3d43ca0896c9d146a15fb9538b938229368a`. Embedded frontend replacement is complete; all 31 paths/hashes match the fresh build, including removal of obsolete bundles in `4688ebb`. No manual deletion or policy answer remains for Phase 0.

The local runtime image is built from `001c6729487eee532647f80aa6d0e3442019d1f7`; disposable container contracts and the corrected real browser smoke passed. The full corrected gate exited0 with 1,305 frontend, 2,183 backend (one Windows skip) and 87 browser passes. Consult the [verification record](../reviews/2026-10-17-phase0-verification.md) for final evidence and identities.

The user also requested efficient local checks and RAM headroom for another process. Keep one heavy runner at a time. The bounded harness change adds explicit partial-stage execution, early cheap contract checks, failure/slow-test timings and a two-worker frontend default with a documented override. It does not cache success or treat a partial run as full verification. No GitHub Actions, extra PostgreSQL workers or browser parallelism are introduced.
