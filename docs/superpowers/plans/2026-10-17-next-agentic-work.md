# Next agentic work after T5 and the UX critique (2026-10-17)

Execution update: [the usability-first index](2026-10-17-phase0-priorities.md)
and its five Phase 0 plans refine the batches below against `main` at `4de9aaa`.
The user authorized finishing the plans and then implementing already decided
functions autonomously. The new index controls execution order, shared-file
ownership and narrow unresolved policy questions. Merge and push still require
approval; the reserved port-18080 demo stays untouched.

Basis: main at `2aee6a7` (T2, T3a/b, T5, T6a, UX critique fixes). Inputs: the
UX critique (`../reviews/2026-10-17-ux-critique.md`), a feature audit and an
analysis of the open plans, both run read-only on 2026-10-17. This plan orders
the remaining work into agent batches and lists the decisions the user must
make first. Batches follow the usual rule: one fresh agent per 2–5 coupled
tasks, implementation agents at effort medium, Codex review (gpt-6.1-sol,
high) per finished plan, one fix agent, full gate (`scripts/check.sh`) before
each merge, no GitHub Actions.

## 1. Findings that drive the plan

### 1.1 Coupled scrolling is not alignment

- Anchor: paragraph index from DOM markers, mapped linearly between panes
  (`variants/useCoupledScroll.ts:29-58`); paragraphs come from blank-line
  heuristics (`variants/paragraphs.ts:78-108`). The data model stores no
  alignment between source and translation; the T5 spec excluded it
  (`specs/2026-10-14-t5-variants-translation-review-design.md:91`).
- Failure modes verified on the demo: a merge plus a split with equal counts
  pairs wrong paragraphs silently (no warning, off by one); one extra paragraph
  spreads the error linearly; the follower snaps to paragraph starts and pulls
  the reader back.
- Regression from the UX fix: coupling now also runs while the reviewer edits
  the translation (`translation/TranslationReviewScreen.tsx:85`). Coupling is
  on by default in review and compare.

### 1.2 Features with clinical or semantic risk

| Feature | Risk | Location |
| --- | --- | --- |
| "+ New Annotation" creates a spanless finding | Most prominent create button produces a finding without text evidence | `app/CaseScreen.tsx:1803-1810`, `:925` |
| Decision "Uncertain" | Silently excluded from export; collides with axis value "uncertain" | `exchange/t1.py:540,576`, `domain/axes.py:7` |
| Defaulted axis values | Unconfirmed "present" can be submitted unseen | `AnnotationPanel.tsx:213-270`, `CaseScreen.tsx:1819` |
| Keys 1/2/4 toggle | Pressing a decision key twice clears the decision | `CaseScreen.tsx:1470-1484` |
| Re-anchor items | Listed but not decidable | `variants/ReanchorPanel.tsx:74-90` |
| "Layer verified" vs "Entire text checked" | Two completion concepts, one non-binding | `CaseScreen.tsx:1869-1876`, `:2146` |
| Hidden axis values | Silently shrink the clinical vocabulary | project settings |

Smaller: "Assign replacement from draft…" duplicates Edit & Replace; three
version selectors above the text for annotators; language flags instead of
codes; Progress placeholder about agreement; Previous submissions show raw ids.

### 1.3 Open roadmap and its staleness

- T4a (17 tasks) and T4b (14 tasks) predate T3b/T5. Eleven mismatches block
  execution, among them: T4a plans a second open route although
  `POST /assignments/{id}/open` exists; the stage draft key `stage:{id}` is
  rejected by the target-set hash check (`application/workspaces.py:286-293`);
  wrong paths (`assignments/` package, `application/preferences.py`); the
  distribution snapshot hash must include the stage; `TaskSummary`,
  `useShortcut`, `TaskEditor` dispatch, new stylesheet layout, missing
  `rights` in `ProjectSummary`, renamed test routes.
- T6b has no spec. `App.tsx` is already 207 lines; `CaseScreen.tsx` (2,177
  lines) is the real target.
- P9: the last load run failed all four p95 targets by ~10x; the locust
  workload uses removed endpoints.
- Carry-over risk: login throttling serialises users behind one NAT address;
  `login_attempts` is never pruned. Relevant for hospital networks.
- T7 parked; its Task 7 (producer block) was meant to ride on T5 and is
  missing.
- T5 user acceptance is pending; the demo image predates the UX fixes.

### 1.4 Scope candidates for cutting (decide in section 2)

T4a interventions (six actions), three overlapping blind-mode controls,
late-proposal notices with polling, the T4b live agreement page, the release
builder, threaded comments.

## 2. Decisions needed before the batches start

Recommended option first.

| # | Question | Options |
| --- | --- | --- |
| D1 | Coupled scrolling | (a) opt-in, off while editing, visible paragraph pairing, no snap-back; (b) replace with "Show matching paragraph" on click; (c) stored alignment and aligned rows (needs MT import to deliver segment maps) |
| D2 | "Uncertain" proposals | (a) export flagged as uncertain, note required; (b) stay excluded but say so in UI and export; (c) route to adjudication |
| D3 | Spanless findings | (a) allowed with a required note, demoted button; (b) project rule can disable them; (c) unchanged |
| D4 | Defaulted axis values at submit | (a) warning with count in the submit dialog; (b) always blocked; (c) informational |
| D5 | Completion concept | (a) one "Entire text checked" confirmation, layer verification removed; (b) layer verification required per editable layer |
| D6 | Workflow scope (T4a) | (a) templates (single, sequential, parallel + adjudication) with reopen, reassign, skip, declare final; (b) full chain editor with six interventions |
| D7 | Blind mode | (a) one per-stage policy plus the show-others switch; (b) policy + switch + personal preference as planned |
| D8 | Late tool proposals | (a) defer to T7; (b) notice with adopt/ignore |
| D9 | Agreement | (a) one number per document in Progress and Adjudication; (b) own page |
| D10 | Releases | (a) minimal frozen export of final results; (b) full builder; (c) defer |
| D11 | Comments | (a) one note per annotation, visible to lead and next stage; (b) threads; (c) none |
| D12 | Names | (a) leads see display names, adjudicators neutral letters; (b) pseudonyms everywhere |
| D13 | Case/Task/Document/Variant naming | (a) "Document" for users, version/language as attributes; (b) keep separate; needed before T4a Part 2 |
| D14 | P9 priority | (a) parallel hardening batch, targets re-checked for the real deployment size; (b) before T4 |
| D15 | Q15–Q32 defaults | confirm as a block, or review Q23, Q25, Q29 individually |
| D16 | Version/compare access for annotators in independent mode | (a) leads and adjudicators only; (b) unchanged |

### Decided on 2026-10-17

- D1: (a) opt-in coupling, never while editing, visible paragraph pairing, no snap-back.
- D2: (a) export "Uncertain" decisions flagged as uncertain, note required, renamed so it cannot be confused with the axis value.
- D3: (b) spanless findings need a note, the button is renamed and demoted, and a project rule can disable them.
- D4: (a) warning with count and jump in the submit dialog, badge in the list.
- D5: (a) only the "Entire text checked" confirmation; per-layer "verified" is removed.
- Re-anchor items: resolved by the reviewer in the case ("re-create here" or "dismiss with reason").
- D16: (a) version selectors and compare only for leads and adjudicators; annotators see their task text (enforce in the backend too).

## 3. Batches

### Phase 0 — safety fixes for main (implement on local feature branches)

- **B0.1 Coupled scrolling (D1):** off by default; never while editing; paragraph
  numbers in both panes with the paired paragraph highlighted; follower moves
  proportionally inside the paragraph, the leading pane never snaps; warning
  wording "Paragraphs are paired by position, not by meaning". Files:
  `variants/useCoupledScroll.ts`, `translation/TranslationReviewScreen.tsx`,
  `variants/ComparePane.tsx`. Unit + browser tests for merge/split pairing.
- **B0.2 Decision semantics (D2–D5):** rename/demote spanless creation; rename
  "Uncertain" and state its export treatment in UI and Export; defaulted-axis
  badge in the list and count in the submit dialog; idempotent decision keys
  plus a reset key; one completion concept. Files: `CaseScreen.tsx`,
  `ReviewActions.tsx`, `AnnotationPanel.tsx`, `exchange/t1.py` (if D2a).
  Note: overlaps T4a Part 2 files; land before the T4a revision so the plan
  revision can rebase onto it.
- **B0.3 Re-anchor decisions:** each item resolves to "re-create here" or
  "dismiss with reason", recorded with provenance. The reviewer in the case
  is already decided above; the new plan addresses per-reviewer persistence.
- **B0.4 Access and small cleanups:** enforce D16 in the backend and UI first;
  then remove "Assign replacement from draft…", put
  version selectors behind "Versions", language codes instead of flags, drop
  the Progress placeholder, readable Previous submissions, hidden-axis note for
  leads.
- **B0.5 Acceptance candidate:** build a separate candidate with fresh volumes
  and its own port so T5 acceptance can see the current UI without changing
  the reserved demo. See the detailed plan for source/image verification and
  the separate approval needed to replace the original environment.

### Phase 1 — plan revision (one agent, docs only)

- **B1.1 Revise T4a and T4b** against main: patch the eleven mismatches,
  apply D6–D13 scope cuts, fold in the "Deferred to T4a" UX items, add T7 Task 7
  (producer block) and Task 8 hooks where still wanted. Codex review of the
  revised plans, one fix pass.
- **B1.2 Write the T6b spec** (parallel): `CaseScreen.tsx` split into a
  container plus panels, 1024-px detail rail, compare drawer, one shell and
  breadcrumb, word-snapping selection, remaining `editor.css` sizes, help and
  onboarding (first-run hint near the text, guideline link, glossary).

### Phase 2 — T4a (after Phase 1)

- **A** Tasks 1–3: tables, chain, state machine.
- **B** Tasks 4, 5, 10: stage assignments, opening via `/assignments/{id}/open`,
  redesigned draft key and round handling, export.
- **C** Tasks 6–7 (+8 if D8b): stage results, visibility.
- **D** Task 9 reduced to the D6 interventions.
- **E** Tasks 11–13: task list and editor UI including deferred label fixes.
- **F** Tasks 15–17 (+14 if D8b): lead UI and mode-code cleanup.
- Codex review, fix agent, full gate, merge.

### Phase 3 — T4b (reduced per D9–D11)

- **G** adjudication (Tasks 1–4); **H** agreement as per-document numbers;
  **I** notes per annotation; **J** minimal release or deferred.

### Phase 4 — T6b

- **K** per the T6b spec from B1.2.

### Parallel hardening (any time, max two test-heavy agents overall)

- **L1** login throttling behind shared addresses, `login_attempts` pruning.
- **L2** P9: refresh the locust workload (`/assignments/{id}/open`, My tasks),
  then profile one bottleneck at a time (search index, connection pool).

## 4. Order and parallelism

1. D1–D5 and D16 are decided; do not ask them again. Prepare D6–D15 for Phase 1.
2. Follow the usability-first index: B0.1, B0.2 completion/controls, B0.4 access,
   B0.2 notes/rules/export, B0.3, B0.4 remaining cleanups, then B0.5. Shared
   CaseScreen and generated-contract edits are sequential.
3. L1 can run beside Phase 0; L2 after B0.5.
4. Phase 1 after Phase 0 merges; Phases 2–4 sequential.
