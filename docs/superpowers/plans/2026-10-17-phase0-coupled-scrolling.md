# Phase 0: Coupled Scrolling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement B0.1/D1: optional positional paragraph coupling that never moves an editing surface or feeds movement back into the leading pane.

**Architecture:** Coordinate all participating scrollports in one hook instance, measuring live paragraph-marker geometry. Keep the existing positional mapping, expose its paragraph numbers and active pairs, and carry progress within a paragraph into each follower. Coupling is a reading aid, with no stored or inferred semantic alignment.

**Tech Stack:** React 18, TypeScript, plain CSS, Vitest, Playwright; existing synthetic PostgreSQL browser fixture.

**Spec:** `PRODUCT.md`, `DESIGN.md`, `docs/superpowers/plans/2026-10-17-next-agentic-work.md` (D1, B0.1).

## Global Constraints

- English UI only. Light theme only. React 18 single-page app with plain CSS and no UI library.
- No request may leave the app's origin (no CDN, no external fonts).
- Unicode codepoint offsets are exact; clinical text and evidence coordinates must not change.
- WCAG 2.2 AA. Functional text is at least 12 px. Meaning never depends on colour alone.
- D1: opt-in coupling, never while editing, visible paragraph pairing, no snap-back.
- Exact warning: “Paragraphs are paired by position, not by meaning”. Display it whenever coupling is active, including equal paragraph counts.
- No new dependencies, semantic pairing heuristic, persisted alignment or translation-import changes.

## Review Focus

- Equal counts after a merge and a split still pair unrelated content; Task 3 must show the warning and the actual positional pair.
- Three-pane translation review must have one leader; Task 1 tests that neither follower becomes a new leader through its programmatic event.
- Short, empty and end-of-document paragraphs must not produce NaN or oscillation; Task 1 tests finite clamped follower positions.
- User changes direction or switches panes during momentum; Task 1 tests deliberate input transferring leadership without timer-based snap-back.
- Number adornments must not alter selected/copied clinical text or evidence offsets; Task 2 tests text nodes and Task 3 tests native selection with Unicode.

## Evidence and boundaries

`frontend/src/variants/useCoupledScroll.ts` currently maps `round(i*(m-1)/(n-1))` and snaps to the mapped paragraph start, with a 150 ms echo guard per hook. Both `ComparePane.tsx` and `TranslationReviewScreen.tsx` initialize coupling to true. Translation review currently creates two separate hook instances, including the editable target. Its `showChanges` branch renders read-only `DiffView`; the other branch renders `TranslationEditor`. Paragraphs are blank-line/line heuristics from `variants/paragraphs.ts`, not alignments.

`TextPane.tsx` passes paragraph starts into `spans/adapter.ts`, which invokes the existing span editor's `setParagraphStarts`. `translation/DiffView.tsx` renders its own empty `[data-paragraph]` markers. Do not modify the span-editor dependency to add labels: the coordinator can decorate existing markers with data attributes and CSS-generated visual labels, keeping marker text empty.

Follow `2026-10-17-phase0-priorities.md`: B0.1 first, then B0.2 Task 1, then B0.4 access tasks, followed by D3/D2 and re-anchor correctness work; B0.4 cosmetic tasks follow those correctness changes. These plans share CaseScreen/ComparePane; do not edit them concurrently. This plan has no domain-decision gate, and implementation of decided functions is already authorized.

## File map

- Modify `frontend/src/variants/useCoupledScroll.ts`: one group coordinator, active-pair attributes and event ownership.
- Modify `frontend/src/variants/ComparePane.tsx`: default off, editing gate, permanent active-coupling warning and pair readout.
- Modify `frontend/src/app/CaseScreen.tsx`: pass whether the left pane is editing; draft annotation work counts as editing.
- Modify `frontend/src/translation/TranslationReviewScreen.tsx`: one three-pane coordinator, default off, disable coupling in editable text view.
- Modify `frontend/src/styles/screens/editor.css`, `frontend/src/translation/translation.css`: static number adornments and active pair styling using existing tokens.
- Modify `frontend/tests/useCoupledScroll.test.tsx`, `comparePane.test.tsx`, `translationReview.test.tsx`, `caseVersions.test.tsx`.
- Modify `frontend/browser/compare.spec.ts`, `frontend/browser/translation-review.spec.ts`, and `tests/browser_server.py` only for synthetic merge/split fixture variants.

### Task 1: Coordinate positional movement and leadership

**Interfaces:** Replace the two-element hook with `useCoupledScroll(panes: readonly CoupledScrollPane[], options: { enabled: boolean }): CoupledScrollState`; export `CoupledScrollPane = { id: string; element: HTMLElement | null; starts: readonly number[] }` and `CoupledScrollState = { leaderId: string | null; pairs: ReadonlyArray<{ paneId: string; paragraph: number }> }`. `paragraph` is a zero-based index; UI adds one. Callers memoize the pane array. IDs are `left/right` for compare and `source/target/comparison` for translation review. Null panes are absent participants.

- [ ] Write failing Vitest cases in `frontend/tests/useCoupledScroll.test.tsx`: off means no listeners/movement/adornments; source paragraph 1 of 4 maps to follower paragraph 2 of 7; halfway through a 200 px source paragraph maps halfway through its 400 px partner; source scrollTop is unchanged by all follower events.
- [ ] Add three-pane cases: user scrolls source, both followers move once, dispatch their scroll events after more than 150 ms, and assert the source position and leader remain unchanged. A wheel, touchstart, pointerdown or navigation-key input on a follower makes that pane eligible to lead; a passive follower scroll event alone does not. Test Arrow/Page/Home/End/Space input, clamped no-ops, rapid reversal, unmount and pane replacement cleanup.
- [ ] Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx`; expect failures for the new interface and behavior before implementation.
- [ ] Implement the group coordinator. Preserve the existing positional formula `n <= 1 || m <= 1 ? 0 : Math.round(i * (m - 1) / (n - 1))`. Compute each paragraph's scroll-content start from its live marker; use the next marker as its end, or the content bottom for the last paragraph. Clamp the source fraction to `[0,1]`; follower target is partner start plus this fraction of partner height, then native scroll-range clamping. Skip missing/zero-height/nonfinite geometry without moving the leader. No smooth scrolling.
- [ ] Use shared leadership for the whole group: programmatic follower events cannot originate another sync; explicit input on that pane transfers ownership. Keep ownership until another pane receives input, disable, identity change or detach; do not expire protection after 150 ms. Support intentional keyboard scrolling without intercepting its native default. Respect the incumbent `(min-width: 1100px)` condition and detach below it.
- [ ] Decorate each existing marker with `data-paragraph-number` (one-based) and `data-coupled-active` only while enabled. Update returned pairs without a state update when they are unchanged. Clean up owned attributes/listeners on disable, breakpoint change, replacement and unmount.
- [ ] Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx`; expect all cases PASS, including empty panes, a one-paragraph document, tiny last paragraphs and no feedback after delayed events.

### Task 2: Apply the reading-only contract and visible pairing

**Interfaces:** Add `editing?: boolean` to `ComparePaneProps` (default false). Effective enabled state is requested coupling AND `!editing` AND `!suspended`; `CaseScreen` passes `editing={!serverReadOnly && display === null}`. Translation review uses `canCouple = readOnly || showChanges`; its editable `TranslationEditor` branch cannot couple. Preserve existing `suspended` fetching behavior. A mode or text identity change clears requested coupling, so returning from editing requires an explicit opt-in.

- [ ] Add failing component cases: compare/review starts unchecked; editing disables and clears the control; entering Show changes allows opt-in; leaving it immediately stops coupling; submitted read-only target supports opt-in. CaseScreen working draft cannot couple even when its annotation text DOM has markers.
- [ ] Add assertions that equal counts show the exact warning after opt-in, active numbers and a plain-text pair readout such as `Source paragraph 2 ↔ Translation paragraph 3` reflect the hook result, and turning coupling off removes pairing adornments. Three-pane readout names all participants. Number labels remain visible without relying on colour; clinical text nodes remain identical before/after.
- [ ] Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/comparePane.test.tsx tests/translationReview.test.tsx tests/caseVersions.test.tsx`; expect the new assertions to fail.
- [ ] Update the callers to Task 1's group interface and set initial requested coupling false. Disable the checkbox in editing mode and show “Coupled scrolling is available in read-only views.” near it. Render the exact warning whenever effective coupling is on, regardless of count equality; count differences may be supplemental information. Render the current pair readout outside the clinical text with a stable accessible description; avoid live announcements on every scroll frame.
- [ ] Style existing marker adornments with `::before` and `content: attr(data-paragraph-number)`, positioned in a gutter that is reserved independently of toggling coupling. Keep marker text empty, `aria-hidden`, `pointer-events: none` and unselectable. Use existing design tokens; give active numbers a border/shape plus colour, and provide the accessible pair readout outside the hidden adornments. Do not shift document line wrapping when toggling.
- [ ] Run `npm --prefix frontend test -- --maxWorkers=4 --minWorkers=1 tests/useCoupledScroll.test.tsx tests/comparePane.test.tsx tests/translationReview.test.tsx tests/caseVersions.test.tsx tests/textPaneMarkers.test.tsx tests/diffView.test.tsx` and `npm --prefix frontend run typecheck`; expect PASS.

### Task 3: Verify real wrapping, merge/split and editor transitions

**Interfaces:** Extend the existing `/__test_variants__?comparison=true` fixture and translation-review fixture with synthetic equal-count merge+split text; retain existing identifiers and fixture fields. No production route or demo modification.

- [ ] Update `frontend/browser/compare.spec.ts` expectations that currently describe paragraph “alignment” to positional pairing. Use a permitted lead/adjudicator account for general version browsing so B0.4's role restriction will not invalidate these tests.
- [ ] Add a real-browser case with four source paragraphs and four target paragraphs where source paragraphs 1–2 are merged and paragraph 4 is split in target. Assert coupling starts off, opt-in shows the exact warning despite equal counts, displayed partners follow indices rather than meaning, and both panes show numbers. Add a different-count case verifying the formula and pair readout.
- [ ] Measure real marker geometry at 25%, 50% and 75% within a long wrapped paragraph. Assert follower progress within a small pixel tolerance, leader scrollTop unchanged after follower events and a wait beyond the former 150 ms guard, and manual follower input transfers leadership. Repeat for source/target/comparison in translation review.
- [ ] Exercise edit → Show changes → opt-in → edit: editable target, source and comparison remain independently scrollable, coupling is unchecked on return and caret/selection is stable. At 1099 px coupling detaches; above 1100 px it works only after opt-in and only in a reading view.
- [ ] Select/copy a paragraph containing `µ`, `±`, Greek letters and an astral character across a marker; copied text and annotation codepoint offsets equal the original fixture. Verify keyboard toggle, labelled pair readout and no text reflow when coupling changes.
- [ ] Run `npm --prefix frontend run test:e2e -- browser/compare.spec.ts browser/translation-review.spec.ts`; expect PASS with real browser geometry, unchanged text payloads and no console errors. Docker and the existing test environment are prerequisites; do not start or reseed the acceptance demo.
- [ ] Review the diff against D1 and preserve the recorded test results. At eventual branch integration, run the repository gate `bash scripts/check.sh` once after all Phase 0 shared-file changes are combined; this planning task does not run it.

## Acceptance

Coupling requires opt-in for every new reading context, never operates during editing, names the actual positional pair, and always warns that position does not imply meaning. The follower retains progress within a paragraph and never pulls the leader back. Text, evidence offsets and native selection remain unchanged. No semantic alignment claim appears in labels, test names or implementation comments.
