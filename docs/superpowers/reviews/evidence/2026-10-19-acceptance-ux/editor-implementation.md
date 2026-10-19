# Editor acceptance remediation

Owner: editor agent. Worktree: `.worktrees/phase0-implementation`. No commits, pushes, demo resets or running-demo replacements.

## Implemented Tasks 2–5

- Settings keep explicit section-owned actions and show unsaved state after failure or an unrelated save. A late pin draft survives its save response with truthful success plus newer-unsaved feedback. Sections have visible spacing and boundaries.
- Missing spanless reason retains the exact selected term/search event. Repair exposes explicit **Add annotation**, disabled until valid; editing the reason never creates an annotation. Complete input retains one-action creation, and existing prohibited/optional/duplicate behavior remains guarded.
- Saved findings display every profile axis in profile order, including unspecified values, using shared labels across summaries, radios and large selects. Generic axes retain supplied labels/values. Spanless state is separate from workflow state. Finding rows support Enter/Space selection and expose selected state.
- The left list is 260px on desktop (220px at the incumbent intermediate layout), leaving more room for the reading pane without selection-driven resizing. Existing narrow-screen pane controls remain.
- Submission history has a named access point and empty state. Exact historical snapshots render their stored annotation notes, separately from reviewer notes, with multiline text preserved and markup rendered literally. Current draft notes never substitute for historical notes.
- Unresolved selects a draft intent, focuses its reason and requires **Save decision**. Per-exact-target intent survives re-selection. Timer, blur and unmount cannot autosave that reason onto the former Confirmed/Rejected decision. Failed save retains input for explicit retry; ordinary saved-decision note editing retains autosave. Shortcut 4 enters the same form. Leaving/submitting protects an unsaved intent.
- Immutable proposal defaults explain why direct confirmation is unavailable, preserve Unresolved and its note, and explain the strict-rule conflict. Edit & Replace is described as a consequential separate decision.
- Text-correction recreation saves an ordinary finding without resolving. Explicit **Complete text-change review** flushes notes and resolves the latest queued snapshot. Existing-source recovery prevents duplicate recreation after save/link failures. Later edits return the item to pending.
- Reanchor display validates original server windows/opcodes, then uses the existing word diff for readable exact old/new text. Backend alignment, codepoint offsets and shared DiffView remain unchanged. Malformed windows remain unavailable; repeated text/Unicode round trips are covered.
- Selection instructions persist independently of the transient context highlight. Completed items collapse into history and link back to the saved finding. Dismissal retains its separate reason form.

## Implemented Task 8 UI and coordinated contracts

- Project settings configure creation defaults by layer/type/axis in an independent form, with an explicit No preset choice and hidden values excluded. Existing snapshots remain unchanged. The existing require_chosen_axes switch explains warning versus required behavior.
- New creation uses only server-projected presets and sends chosen_axis_ids=[]; prefilled values do not imply confirmation. Source-derived and reanchor values retain their source semantics.
- Submission shows a server-issued warning with exact affected values. An unchecked explicit acknowledgement gates Continue and submit. The retry sends the exact draft/policy revision and digest; a renewed server warning requires renewed acknowledgement. Acknowledgement never invokes clinical confirmation.
- Expected warning responses are returned through the queue at its unchanged revision, preventing an advisory warning from incrementing rejected-edit state and blocking subsequent navigation.
- Regenerated OpenAPI, generated frontend API and administration error catalog after backend owner confirmed Task8 shapes. Added AXIS_CONFIRMATION_WARNING wording. Existing typed fixtures explicitly use warning mode and policy revision 1.
- Coordinated Task9 document-scoped search overrides by passing actual document language and document ID to the shared hook. Temporary toggles do not overwrite personal defaults.

## Verification evidence

- `editor-red.log`: 3 expected new failures / 103 passed (retained term, settings dirty feedback, Confirmed-to-Unresolved autosave race).
- `editor-stage-red.log`: intended history/axis/staged completion/word diff failures before implementation; 8 failed / 90 passed, including old shortcut expectations subsequently updated for the approved explicit-save flow.
- `editor-defaults-red.log`: 3 expected defaults/acknowledgement failures / 92 passed before Task8 UI.
- `editor-green-confirm.log`: 135/135 in focused settings/editor/review/reanchor tests after Tasks2–5.
- `editor-defaults-green.log`: 165/165 in focused defaults/editor tests.
- `editor-final-unit.log`: 213/213 in 12 focused files, max 2 Vitest workers. Existing async React act warnings are logged (review-findings, project creation upload, CaseViewer history, resize). No broad suite run by this agent.
- `editor-typecheck.log`: TypeScript passes after fixture updates.
- `editor-build.log`: production build passes; Vite reports its existing >500kB chunk advisory.
- Focused browser coverage completed: all 16 sidebar/reanchor/decision-semantics scenarios passed across targeted confirmations. `editor-browser.log` exposed stale staged-flow expectations plus a real late previous-decision response race; `editor-late-intent-red.log` reproduces that race, fixed by per-target intent tokens (`editor-late-intent-green.log`, 91/91). `editor-browser-confirm.log` passed three corrected scenarios; its remaining three were blocked by a concurrently changed backend helper signature. After the backend owner repaired it, `editor-browser-backend-confirm.log` passed the final three (exit 0). Disposable shutdown emitted a teardown-only SQLAlchemy connection error after passing tests.
- Changed-file whitespace check passes; Git prints its normal LF-to-CRLF advisory for reanchorPanel.test.tsx.

## Implemented Tasks 10–11 UI

- Task editor exposes explicit work-round history and exact round reopening, a distinct empty ordinary round, and carry-forward from a deliberately selected eligible own immutable submission. Eligible sources come from the authorized server endpoint, including exact correction ancestors. Stable request identities and a write lock protect retries and repeated clicks. Submitted history remains readable; no automatic final selection occurs.
- Every carry input needs explicit completion against a current saved finding or dismissal with a reason, including unchanged/spansless inputs. Exact stale/deleted output hashes return to pending and block submission. Changed evidence requires deliberate output selection; original evidence is fetched on demand and its exact source text hash is checked before display. Completing flushes notes and links the latest current snapshot.
- Consolidation keeps ordinary per-target decisions, with a separate deliberate merge surface: select at least two frozen inputs and one compatible saved finding. Queue integration flushes notes, resolves the current output hash, invokes server merge provenance and updates draft/checked state. Failed merges retain selection, output and note.
- Reporting requires a reason and explicitly pauses the personal task. A failed save preserves local clinical input and requires an explicit checkbox to report the last saved work while keeping local input in the session. Report retries retain request identity. Reporting/resuming updates assignment metadata without remounting annotation or translation editors.
- Own report history and reasoned resume release only the selected report pause. Lead detail supports explicit task selection for hold extension/release, resolution with holds left intact, and a reasoned owner-agreed empty restart. The lead route is owned by the navigation agent. Lead-inherited pauses show only the authorized pause reason, never another annotator’s private report.
- Paused editors retain annotation reason, pending reanchor state and translation text/review choices. Editing/submission is disabled; local annotation input receives an explicit leave/logout discard warning. Translation read-only from a hold is distinguished from immutable submitted status, so tasks initially opened while held can resume. Reload remains available to open a lead-agreed new state. Preserved abandoned translation drafts are readable in report history.

## Additional evidence and artifacts

- `editor-round-edge-green.log`: 10/10 focused round start/retry/exact open/carry/hash checks.
- `editor-report-red.log` and `editor-merge-red.log`: intended missing-component red runs before report/merge implementation.
- `editor-report-regression.log`: latest 48/48 across workRoundActions (10), problemReports (8), mergeInputs (2), translationReview (28), max2 workers. Covers held local annotation leave cancellation, translation local choice preservation, initial-held recovery and exact report resume. No full suite/build repeated after Tasks10–11; root owns fresh full gate/typecheck.
- `editor-round-report-typecheck.log` initially found missing checkbox IDs and revoked-status comparison; those were corrected before the final gate. Root must run final TypeScript against current code.
- `editor-screenshots/` contains editor screenshots at 1440/1024/768/720/390/320 plus desktop/narrow/resolved reanchor and policy-repair states. Bounded visual inspection completed at desktop,720,390,320 and reanchor desktop/narrow/resolved; no layout defect found. These screenshots precede10–11 surfaces; navigation’s integrated workflow browser run covers the new journey.
- `editor-design-detect.json`: Impeccable detector returned [] for the Tasks2–5/8 editor/settings surfaces. PRODUCT.md and DESIGN.md preserved.

## Remaining

- Root owns fresh full verification and independent final review. Navigation owns the integrated new round/consolidation/final-selection/export browser journey and current lead route checks.
- Root owns full integrated gate and final acceptance. Actual 200% browser zoom/manual user acceptance are not inferred from unit tests.
- Original protocol manual checks remain distinct: actual 200% browser zoom, human acceptance of clinical wording and full multilingual large-ontology responsiveness are not established by these focused tests. Task13 timing evidence belongs to navigation; no backend implementation is claimed by this report.

## Final review corrections and bounded UX A batch

- C5: MyTasks retains the underlying task status, adds the separate Paused badge and authorized reason, counts paused tasks for the current project filter and names the still-readable route View paused task. Two stale full-gate tests now expect shared Absent wording and explicit Save decision. `editor-final-c5-red.log` demonstrated only the new pause regression failing (40 passed); `editor-final-c5-green.log` passed41/41 in the three requested files.
- UX A priority1: successful submission immediately adds the exact returned immutable receipt to local history, invalidates authorized version metadata and locks the current workspace read-only. Staying in the case no longer shows a false empty history. The success dialog also offers View submitted result. Stored notes and exact receipt identity are preserved without refetching a broad case for ordinary annotators.
- UX A priority5: below699px, the project selector takes the available header action width and its menu anchors within that width using border-box sizing. This addresses negative menu coordinates rather than relying on document scrollWidth alone.
- Argon A6 UI: a resolved report offers only release of remaining pauses; a fully released resolved report shows its completed state without further resolve/extend/restart actions. Submission checks also derive the permitted action from current report state.
- UX A settings: native local section-jump buttons scroll and focus the existing mounted forms without changing router state or resetting local drafts. Rules save/discard and section-owned dirty/error/success feedback sit before the first rule control. Secondary hidden-axis configuration is a collapsed disclosure. Existing per-section transport/dirty semantics are preserved.
- `editor-uxa-red.log`:2 intended history/resolved-action failures with82 passed. `editor-uxa-settings-red.log`: intended missing local section-navigation failure with23 passed.
- `editor-uxa-green.log`:108/108 in the three focused affected files (CaseScreen75, problemReports9, projectSettings24), max2 workers. Existing ProjectNewPage async React act warnings remain logged. No PG/full suite/build/browser was run for this batch.
- Root requested freeze after the108 checks. Native390px project-picker confirmation remains pending the rebuilt candidate: inspect menu, both labels and both input/select rectangles for left>=0 and right<=viewportWidth, then visually verify text starts remain readable. Do not infer this from page scrollWidth. Root/navigation own the remaining CaseViewer comparison alignment and Documents hierarchy fixes; no CaseScreen comparison host was added, per root scope decision.
