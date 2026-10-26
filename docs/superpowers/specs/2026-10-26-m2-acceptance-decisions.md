# M2 acceptance: decisions to implement

Date: 2026-10-26. Source: manual acceptance (M2) of `feat/ux-calm` on the native test server,
projects e3c-proposals and t5-acceptance. Base for the work: `feat/ux-calm` at the commit that
adds this file.

Context files next to this spec (folder `2026-10-26-m2-acceptance/`):

- `findings.md`: all acceptance findings F1–F27 with causes and code references.
- `settings-audit.md`: the Settings audit (inventory, problems P1–P10, proposed structure, D1–D8).
- `mockups-source.tsx.txt`: the source of the local decision mockups (vitest + jsdom rendering
  real app components). It shows the intended markup and copy of every option; the recommended
  option of each section is the one to build.

## Already done on `feat/ux-calm` (do not redo)

F1, F3, F5, F6/F16, F7, F11, F14, F15, F19 (undo restores choices), F22, F23 (task-specific
reason, "Add me as annotator"; adding a role no longer ends sessions), F24, review fixes
(Edit & Replace copies modifiers best-effort).

## Decided by the user: build these

All recommended options of the mockups were accepted, with the clarifications below.

| # | Finding | Decision |
|---|---|---|
| M-1 | F2 | The two plan presets leave the selection bar; the bar keeps Assign…, Plan…, Clear selection. The Plan dialog gets a "Quick choice" row with the two presets, shown only when the selection holds translations. |
| M-1a | F27 | Plan dialog: "Keep (2 off)" / "Keep (12 on, 8 off)" becomes "No change (2 not planned)" / "No change (12 planned, 8 not)". |
| M-2 | F4 | The auto-advance status line becomes a framed strip (success InlineMessage with a check icon, own background, spacing below) at the top of the details pane; it stays a permanent `aria-live="polite"` region. |
| M-3 | F9 | Term search: a "Modifiers only" filter chip; typing the prefix `mod:` switches the chip on (and is removed from the query). With an HPO-phenotype profile the chip limits results to modifier terms (the profile's modifier classification, e.g. Clinical modifier HP:0012823). A visible hint names the prefix. |
| M-4 | F10 | "Move to a new finding" on each mention card in the details pane of an own finding (and of an Edit & Replace copy): the mention leaves the finding and becomes a new finding with the same term and values, which the user can then change. Rationale: HPO guide principle 3 (one term + one set of attributes per annotation; an occurrence with a different attribute or modifier is its own annotation). Proposals themselves stay immutable: on a proposal the action runs Edit & Replace first. |
| M-5 | F12 + F25 | Attach mode: proposals (open or confirmed) and the Edit & Replace copy being edited are attach targets, both as marks in the text and as rows in the findings list (↑ ↓ Enter in the list). Attaching to a proposal runs Edit & Replace implicitly (copy incl. the proposal's modifiers, plus the new modifier; "changed" decision), announced in the attach panel before and in the status line after ("Vaginal hemorrhage replaced by your copy with Mild"). F25 (copy not offered as target) did not reproduce in a unit test; verify it with this change in a browser test. |
| M-6 | F13 | After submit there is no second modal: the next task opens automatically (same order as My tasks); without a next task the user lands on My tasks. A toast "EN100068 submitted · View result" opens the submitted result. |
| M-7a | F17 | Consolidation: one "Open in full editor" in the screen header (next to Report problem) with a tooltip "For span changes and findings the comparison cannot express"; it leaves the cards. |
| M-7b | F18 | Resolved/agreed rows have no bordered "Change" button; the whole row is the control (click/Enter expands it; "Change" appears inside the expanded row). |
| M-7c | F18 | Open card actions: one primary (Keep …), one secondary (Not in result), the rest in a "More…" menu (Edit values…, Other term…); one line at 1280 px. |
| M-7d | F20 | A field/modifier choice only stages (the Result line updates); one explicit "Keep" saves. No auto-resolve on a click. The per-person "Keep <person>'s finding" shortcut row is dropped. |
| M-7e | F21 | Every row of the finding is always visible (term, the three axes, text, modifiers); agreed rows muted with one value spanning the columns; conflicting rows highlighted; axis values as `AxisValue` chips. The folded "agreed on …" line goes away. |
| M-7f | Leave out | "Leave out" is renamed "Not in result" everywhere (button, result line, announcements, history). |
| M-7g | F26 | After a resolve, the undo sits inline in the resolved row ("Kept · Undo"), plus Ctrl/Cmd+Z (not in text fields) until the next action; the bottom-left toast goes. |
| M-8a | F8 D1/D2 | Settings: six job tabs in this order: People, Workflow, Annotation, Guidelines, General, Ontology; `…/settings` opens People. Old section routes stay as aliases. |
| M-8b | D3 | Workflow tab in the order a text moves through work, with the new copy from the audit (§3.2); the consolidator rule moves here. |
| M-8c | D7 | Annotation tab: submit rules + prefilled values (creation defaults) merged, one Save; hidden values as per-axis shown-value toggles, collapsed with a count. |
| M-8d | D6 | Save model: every form "Save changes" + "Discard changes" when dirty and a status line; Members saves each role change at once and confirms it ("Ana Weber is now Consolidator."). |
| M-8e | D4, D5, D8 | D4: show the project description on the Projects page (check whether the listing returns it; small backend change allowed). D5: inline "Change…" for annotators per text in the assign dialog (existing settings API and target preview). D8: Ontology tab — locked: plain summary, technical details collapsed; unlocked: version select visible, roots / T1 profile / profile JSON under "Advanced" with plain labels. Also fix P9 (no full-width focus ring on section containers) and the wording items of P4. |

## Other open items to close in the same work

- F23 follow-up: `POST` add-member (`authz/memberships.py` `add`, around line 199) still revokes
  sessions when it adds roles; apply the same rule as `set_roles` (revoke only on removal) and
  update `docs/superpowers/plans/2026-10-14-t2c-projects-authorization-audit.md`, which still says
  "a role change revokes the affected sessions".
- M1 follow-ups spec 2026-10-25, open question 1 (tool proposal icon after assignment): the
  proposal (keep the icon) applies; nothing to build unless the code differs.

## Not in this repository

- Proposal generator (benchmark repo): emit modifiers and merge occurrences only when term,
  attributes and modifiers are equal; the HPO guide should say that modifiers count as attributes
  for principle 3. A note was sent to the benchmark session.

## Done means

- Every row above implemented with unit tests; browser specs updated for changed flows.
- Gate green: `bash scripts/check.sh --only static`, `--only frontend`, `--only backend`
  (only if backend code changed), `--only browser`; contracts regenerated if an API model
  changes; embedded bundle rebuilt last (`npm --prefix frontend run build`, then replace
  `src/ontocurator/web` with `frontend/dist`, commit "build: update embedded frontend bundle").
- No AI attribution in commits. No GitHub Actions (CI runs only on `main`).
