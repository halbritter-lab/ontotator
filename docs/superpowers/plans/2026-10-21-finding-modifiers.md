# Finding Modifiers and Family-Member Experiencer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Realigned 2026-10-25 with `feat/acceptance-20261023` (`9cc0e9e8`); branch `spec/modifiers-realign`.** The plan was first written on 2026-10-21 against `feat/annotator-ui` (main `a4ab560`). Since then the base gained: the annotator UI (AV, AS, AR, AT, AP pending mark with edge handles and `PendingMarkBar`, AH project switcher), the removal of the annotation review task, assisted mode and keep-both data (`c766d5fd`, `10c6887a`, migration `0020_remove_legacy_workflows`), annotate from proposals (proposal check), the text card replacing the row panel, one-line Documents rows, the rebuilt consolidation (one finding per group, `keep_both`/`term_choices` refused, comparison table with ✓ per value and a result line, `ac8eccde`, `2e71d0f9`; consolidator wording `2cbd8981`), per-proposal decisions in the export (`5b31c3db`) and `ui/Popover` flip-above (`2cb72d43`). Every WP block below was re-checked with `grep -n` on 2026-10-25; line numbers stay marked `~` and are re-checked again before editing (report drift, never guess). Questions the current UI raises that the spec does not answer are in "Decisions needed (realignment 2026-10-25)"; the WPs are planned on the recommendations marked **pending** there.

**Base branch:** `feat/acceptance-20261023` (48 commits ahead of main `1f49c420` on 2026-10-25, not merged yet). Execution starts from its tip, or from main once it is merged.

**Goal:** Implement [2026-10-21-finding-modifiers-design.md](../specs/2026-10-21-finding-modifiers-design.md): modifiers on findings (data model, validation, editing commands, subtree search, editor UI, consolidation, T1 import/export, re-anchoring) and the experiencer value `family_member`. Delivered later as a separate GitHub PR from branch `feat/modifiers` (not fast-forwarded into any branch); its base (`main` after `feat/acceptance-20261023` is merged, else `feat/acceptance-20261023`) is asked of the user at that time. Pushing anything to ontospan needs the user's OK first (Step 0).

**Architecture:** `Annotation.modifiers: list[Modifier]` (omitted from the content hash while empty, so no stored hash changes and no migration). A per-ontology classifier (`ontology/modifiers.py`) decides modifier / cohort / exclusive class from the HP:0012823, HP:0040279, HP:0012824, HP:0003674 subtrees and serves validation, search (`within`, `role`), submit rules and grouping. Grouping (`domain/agreement.py`) compares modifiers with segments (`modifiers_differ`, `modifier_as_finding`), `compare()` keeps comparing term-id sets. The editor gets a Modifiers section, an "Attach to finding" popover and modifier marks; consolidation gets a Modifiers row with the U-rule union. ontospan 1.2.1 adds `duplicate_modifier` and `exclusive_modifier_class`.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy + PostgreSQL (`pg_harness`), pytest; React 18, TypeScript, Vitest + Testing Library, Playwright + axe-core against `tests/browser_server.py`; ontospan (private Git dependency, `janpower/ontospan`).

**Binding inputs:** the spec (decisions M1–M11, rules R1–R12, scenarios S1–S23, copy), `DESIGN.md`, `PRODUCT.md`, T1 spec `2026-10-14-t1-shared-annotation-format-design.md` (F5, F6, F9, F11).

**Plan decisions (not fixed by the spec; the main session confirms them with the user before wave 3 only if the user asks, otherwise they stand):**

- D-a Classifier location: new module `ontology/modifiers.py` (the spec names `ontology/registry.py`); `OntologyRegistry` installs itself as the process-wide service source, so DB-side code (consolidation read, take-over, final panel) classifies without threading a registry through every service.
- D-b Term roles also reach `TermLabel` (`role`, `exclusive_class`) and `TreeNode` (`role`), so chips, "Cohort term" tags and "Two severities" work after a reload and the tree browser can disable modifier terms.
- D-c Consolidation modifier views carry `exclusive_class` (needed for the "Two severities" warning on options).
- D-d Modifier lists in the UI are ordered alphabetically by term label (spec examples are inconsistent; "sorted" in S2).
- D-e `modifier_majority` counts all members of a group (identical to "same-term members" for one-term groups; in a `term_differs` group the Modifiers row compares all members, S11/S12). **Deviation from the spec** (M9 says "same-term members"): name it in the PR body.
- D-f Submit warning copy (M7, M5): kinds "Modifier used as a finding" (blocking), "Cohort term as modifier", "Two severities" / "Two onsets"; acknowledgement checkbox "Submit with {n} unconfirmed values and {m} modifier warnings" / "Submit with {m} modifier warnings" (unchanged label when only values remain); consolidation summary adds "{m} findings have modifier warnings (cohort term or two of one kind)." and the checkbox reads "I checked these values and modifiers" when modifier warnings exist.
- D-g ontospan: branch `feat/modifier-checks` from the pinned commit `738f3d4` (branch `feat/review-resolution-format`, not merged into ontospan main); first tag of the repo `v1.2.1`. State on 2026-10-25 (verified locally): the pin in `pyproject.toml` / `uv.lock` is still `738f3d43…` (`__version__ = "1.2.0"`, `cohort_frequency` exists, `duplicate_modifier` and `exclusive_modifier_class` do not); no `feat/modifier-checks` branch, no tags, no worktree for it; O1 has not run.
- D-h Fixture ontology (**deviation from the spec**, "Testing > Fixture ontology"; name it in the PR body): the spec edits `tests/fixtures/hp.json`, `hp-de.babelon.tsv` and `examples/t5-acceptance/hp.json` in place. That changes the fixture's sha256, which `tests/fixtures/smoke-profile.json` pins (`test_smoke_bundle.py` ~`:44`; the spec forbids editing that file), which `smoke-bundle.zip`, `examples/t5-acceptance/demo.zip` (no generator) and `examples/t5-acceptance/manifest.json` hash, and which the golden version in `test_t1_mapping.py` ~`:708` (R11 guard) derives from; term counts (`test_review_findings.py` ~`:622`, `test_translation_api.py`: 11 terms, de 4) and hit lists (`test_tree_api.py` ~`:223/349`, `test_search_auto.py` ~`:224`, `tree.spec.ts`, `consolidation.spec.ts`) would change too. Instead F0 adds a **separate** fixture `tests/fixtures/modifiers/hp-modifiers.json` (= `hp.json` + the modifier subtree + Focal-onset seizure) and `tests/fixtures/modifiers/hp-de.modifiers.babelon.tsv` (only the two new German rows), plus `tests/modifier_fixtures.py` with `MOD_PATH`, `MOD_SHA`, `MOD_DE`, `MOD_PIN` and `create_modifier_project`. Every modifier test and browser scenario uses `MOD_PIN`; `tests/fixtures/hp.json`, `hp-de.babelon.tsv`, `smoke-*`, and the whole `examples/t5-acceptance/` ontology/demo set stay byte-identical. The subdirectory keeps the files out of every non-recursive discovery of `tests/fixtures` (translation files bind by the `hp` prefix: `ontology/translations.py` `_TRANSLATION_NAME`; the name `hp-de.modifiers.babelon.tsv` matches it).

## Decisions needed (realignment 2026-10-25)

The rebuilt consolidation (one finding per group; a comparison table with one column per person, a ✓ per value in conflicting rows, the last missing ✓ resolves the group; an always visible result line; "Keep both" removed) and the proposal check raise questions the spec does not answer. The main session asks the user (German, short) before wave 3. Until answered, every recommendation is **pending**; the WP blocks are planned on it. The spec decisions M1–M11 are not reopened: M5 (own Modifiers row, one person's set or the union) and M9 (no computed majority, label "(2 of 3)") stand; the questions are only about where they sit in the new table.

| ID   | Question                                                                                                                                                                                                                                                                                                    | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Recommendation (pending)                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| DN-1 | Where does the union option ("Both: …" / "All: …", M5, U-rule) go in the comparison table? It belongs to no person's column.                                                                                                                                                                                | **A** A control in the Modifiers row below the person cells, spanning the columns ("Take both: Severe “schwere”, Recurrent “wiederholt”"), a toggle like the ✓ buttons (`aria-pressed`). **B** An extra column "Union" that exists only in the Modifiers row. **C** No union in the table; the consolidator builds it with "Edit values…" (only offered on groups without conflicts, so the union would be lost for conflicting groups; contradicts M5). | **A**: keeps the one-column-per-person table and the ✓ model; one click like a ✓.     |
| DN-2 | Where does the union's sub-row "Text of {term}" (S8: conflicting segments of one term) go?                                                                                                                                                                                                                  | **A** An extra conflict row directly under Modifiers, shown only while the union is taken, with a ✓ in the cells of the people holding that term ("“schwere”" / "“sehr schwere”"), "—" in the others; it counts in "n fields to decide" and the last ✓ resolves. **B** A radio group inside the union control.                                                                                                                                           | **A**: reuses the row/✓/`choicesComplete` mechanics.                                  |
| DN-3 | Where does the majority label "(2 of 3)" (M9) go? Axis majorities are no longer shown in the table since `ac8eccde`.                                                                                                                                                                                        | **A** After the set text in each cell whose set is the majority set ("Severe · (2 of 3)"); never preselected. **B** Drop it for modifiers too, like for axes (changes M9; needs the user's explicit OK). **C** Only in the ✓ button's accessible name.                                                                                                                                                                                                   | **A**: keeps M9 as decided.                                                           |
| DN-4 | Is a segment-only difference (S6 with vs without text, S7 different texts, S20 one character more) a required choice? Since `428e4488` / `ac8eccde` the Text row is a choice only on a genuine span conflict; otherwise it reads "(overlapping, comes with the chosen finding)".                            | **A** As the spec: the Modifiers row is a conflict whenever the kind `modifiers_differ` is set (term sets or segments differ); S6/S7/S20 need one ✓. **B** A conflict only when the term-id sets differ or one term's segments genuinely conflict (the `spans_conflict` rule per term); otherwise the row reads "(comes with the chosen finding)" and the group needs one "Keep" (still never `match`, never auto, no W1: R5/R6 unchanged).              | **A**: no new rule, matches S6/S7/S20 as specified.                                   |
| DN-5 | How does the result line ("Result: 1 finding, Hypotonia (HP:0001252), …") name the modifiers?                                                                                                                                                                                                               | **A** Append one part: "modifiers: Severe “schwere”, Recurrent" / "no modifiers" / "modifiers not chosen yet" (also the collapsed "decided: …" summary). **B** A second line "Modifiers: …" under the result.                                                                                                                                                                                                                                            | **A**: one line, same pattern as "assertion not chosen yet".                          |
| DN-6 | Spec acceptance "a round with S1, S4, S9 (two groups) and S13 needs 5 consolidator clicks from opening to submitted". The current flow needs 6: S4 union, S9 ×2, S13 "Keep Ana Weber's finding" (the next open group is selected automatically), "Submit consolidation", and the summary dialog's "Submit". | **A** Restate the acceptance as 6 clicks (4 decisions + Submit + the dialog's confirm); no flow change. **B** Keep 5: skip the summary dialog when it shows no warning (changes every consolidation's submit). **C** Count only the decisions (4) and the submit button (5), excluding the dialog's confirm.                                                                                                                                             | **A**: no change to the existing submit flow.                                         |
| DN-7 | How are modifier segments drawn in the consolidation text pane? Person lanes are told apart by line style (solid, dashed, dotted, **double** for lane 4), so the editor's double underline `run--modifier` cannot mark modifiers there.                                                                     | **A** In the person's lane with the lane's own line, told apart in words (title and accessible text "Severe, modifier of Seizure (Ana Weber)"), framed with `mark-selected` when its group is selected. **B** Not drawn in the lanes; only framed while its group is selected. **C** A new modifier line style for every lane (e.g. a thinner line above the lane).                                                                                      | **A**: no new style; S9 still shows "schwere" in both lanes.                          |
| DN-8 | Which actions does the standalone-modifier card (S18, `modifier_as_finding`) offer in the new actions bar, where a no-conflict partial group shows "Keep …", "Leave out", "Edit values…" and "Other term…"?                                                                                                 | **A** "Attach to a finding…", "Leave out" and "Other term…" (lets the consolidator turn the mark into a real finding; modifier terms refused, `MODIFIER_AS_FINDING`). **B** Only "Attach to a finding…" and "Leave out" (spec as written; no Keep, Edit values… or Other term…).                                                                                                                                                                         | **B**: spec as written; "Add finding" on the text stays available for a real finding. |
| DN-9 | Should a tool proposal's modifiers be visible in "Annotate from proposals"? A selected proposal is shown by `ReviewActions` (term, values), not by `AnnotationPanel`, so the annotator would confirm modifiers without seeing them.                                                                         | **A** Read-only Modifiers chips (M4's `ModifiersSection`, read-only) under the proposal's values in `ReviewActions`. **B** Not shown; modifiers appear only after "correct" adopts the proposal.                                                                                                                                                                                                                                                         | **A**: spec "Read-only views show the chips without actions".                         |

Checked and **not** needing a decision: the editor's Modifiers section still sits under Values and before "Mentions (n)" in `AnnotationPanel`; the attach popover still anchors at the pending mark (`PendingMarkBar` placement) with the pending search in the inspector; `ui/Popover` already flips above its anchor; "Edit values…" still exists for groups without conflicts and gains the Modifiers section; "Take {name}'s finding" takes that member's modifiers with the rest.

---

## Step 0 (main session, once)

- [ ] Confirm the base: `feat/acceptance-20261023` is finished (its acceptance run and any last commits, e.g. a backend perf commit, are in), or it is merged into main. Use its tip (or main after the merge) as `<base>` below; record the SHA.
- [ ] The user answers the "Decisions needed (realignment 2026-10-25)" items (or accepts the recommendations) before wave 3 (M4 needs DN-9, M5 DN-1…DN-8; waves 1 and 2 do not depend on them).
- [ ] **Ask the user once (German, short):** "Darf ich nach O1 den ontospan-Branch `feat/modifier-checks` und den Tag `v1.2.1` nach `janpower/ontospan` pushen? (nötig für den Pin in `pyproject.toml`)". Without a yes, wave 1 still runs; the pin bump (between wave 1 and 2) waits for it, and M3's export tests that need the new ontospan codes are marked `xfail(strict=True, reason="ontospan 1.2.1 pin")` until then.
- [ ] Create the implementation worktree and bring the spec and this plan over (the realigned commits of `spec/modifiers-realign`, not the 2026-10-21 `spec/modifiers` ones):

  ```bash
  git -C C:/Users/jan-p/Development/ontocurator worktree add C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers -b feat/modifiers <base>
  base=$(git -C C:/Users/jan-p/Development/ontocurator merge-base <base> spec/modifiers-realign)
  git -C C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers cherry-pick "$base"..spec/modifiers-realign
  ```

- [ ] Dependencies: `uv sync` and `npm --prefix C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers/frontend ci`.
- [ ] Create `build/with-lock.sh` (content in rule 7, `root=/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers`), `chmod +x`.
- [ ] ontospan checkout: `C:/Users/jan-p/Development/ontospan` exists (verified 2026-10-25: main checkout on `feat/shared-annotation-format` `6709c3a`; worktrees `.worktrees/format-1-1` and `.worktrees/format-1-2` on the pinned `738f3d4`; no `feat/modifier-checks` yet). If it is absent: `git clone https://github.com/janpower/ontospan.git C:/Users/jan-p/Development/ontospan`. Then:

  ```bash
  git -C C:/Users/jan-p/Development/ontospan fetch origin
  git -C C:/Users/jan-p/Development/ontospan worktree add C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks -b feat/modifier-checks 738f3d43ca0896c9d146a15fb9538b938229368a
  cd C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks && uv sync && uv run pytest -q
  ```

  The pytest run must be green before O1 is dispatched.

- [ ] Re-check line references (`grep -n`) of the anchors named in the WP blocks (checked 2026-10-25 on `9cc0e9e8`; values in brackets): `frontend/src/app/CaseScreen.tsx` (3490 lines; `submissionAxisWarning` [:150], `mentionsDisplay` [:495], `pendingSearchProps` [:1557], `cancelPending` [:1577], `discardPending` [:1586], `createPendingAnnotation` [:1596], `unconfirmedRows(` [:2192], `collectOpenItems(` [:2245], `<FindingRow` [:3078], `<PendingMarkBar` [:3146], pending `SearchPanel` [:3226-3233], `<ReviewActions` [:3265], `<AnnotationPanel` [:3307], `<TreeBrowser` [:3374], `<SubmitCaseDialog` [:3439]), `frontend/src/editor/AnnotationPanel.tsx` (`values-heading-row` [:310], `Mentions (` [:393]), `frontend/src/editor/PendingMarkBar.tsx` (`PendingMarkBar` [:18], its placement `update` [:21]), `frontend/src/ui/Popover.tsx` (Esc [:101], outside pointer down [:93], `closeOnTabOut` [:16], flip-above [:55], the `(max-width: 699px)` sheet [:38, :98]), `frontend/src/spans/adapter.ts` (`MentionDisplay` [:17], already with `label?`; `SpanEditorHandle` [:39]), `frontend/src/vendor/spans.js` (`run--${m.kind}` [:525], `_onHover` [:638]), `frontend/src/consolidation/groupModel.ts` (`comparisonRows`, `resultLine`, `resolvePayload`, `takeFinding`), `frontend/src/consolidation/ComparisonTable.tsx`, `src/ontocurator/application/consolidation.py` (`finding_of(` [:196, :398], `is_open` [:241], `consolidation_progress` [:254], `_state` [:552]), `src/ontocurator/exchange/t1.py` (`_refuse_unrepresentable` [:326-337], `unit_to_proposals` [:393], `_mentions` [:518], `ontospan.Annotation(` [:732]). Put the drift into the dispatch prompts.
- [ ] Baseline: `WP=base bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh backend env CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick src/ontocurator/domain/agreement.py src/ontocurator/domain/annotations.py frontend/src/app/CaseScreen.tsx` is green; a red baseline is fixed or reported first.

## Global rules (every WP; an agent reads this section, "Shared contracts", "Shared-file chains" and its WP block)

Worktree `C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers` (Git Bash `/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers`), branch `feat/modifiers`. All agents of a wave share this worktree. O1 works only in `C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks`.

1. **Ownership.** A WP writes only the files in its **Owns** list (tests included). Within a wave the Owns lists are disjoint. "Conditional" Owns may be edited only if the WP's change breaks them. Need another file → stop and report. Never `git add -A`, `git add .`, `git stash`, `git reset`, `git checkout -- <file>`, `git clean`, never push, never `uv sync`/`uv lock` (main session only).
2. **Commits.** The agent commits its own files only: `git add <owned paths>` then `git commit -m "<message>" -- <owned paths>`. If `.git/index.lock` exists, retry after 10 s. Conventional message (`feat(modifiers): …`), English, **no AI co-author trailer or "Generated with" line**. One or more commits per WP; report every SHA.
3. **TDD.** Write the listed failing tests, run them red, implement, run green, then the WP gate.
4. **WP gate (explicit paths).** `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <owned paths>` (static checks plus the tests affected by those paths). Do **not** use `--base main`. A gate that runs pytest runs inside the backend lock (rule 5). The static part (ruff, mypy, eslint, tsc, prettier, contract drift) sees siblings' uncommitted files: fix only failures in your Owns; report others with file names and rerun after the sibling's commit. Also run, by hand, every Vitest file that renders a component you changed but lives outside your Owns and report failures instead of editing them.
5. **Backend lock (16 GB RAM).** Every command that runs pytest against PostgreSQL (the gate included when Python paths are affected) holds `build/backend.lock`. Never run one while your own Playwright run is going. Pure tests (`tests/test_agreement_*.py`, `tests/test_modifier_classifier.py`) may run outside the lock with `uv run pytest -p no:cacheprovider <file>`.
6. **Playwright lock.** Only one Playwright run at a time across all agents: hold `build/playwright.lock`. `test:e2e` rebuilds the shared `frontend/dist` inside the lock. Command: `HPO_E2E_PORT=<port> npm --prefix frontend run test:e2e -- <spec files>`. Ports: wave slot 1 → 18774, slot 2 → 18775, slot 3 → 18776, final phase → 18777. At most ~6 spec files per locked run; release between batches.
7. **Lock protocol** (both locks). Use the **Bash tool** (Git Bash), never PowerShell, absolute paths only (cwd resets between calls). Acquire, run and release in one wrapper with `trap … EXIT`. Step 0 creates `/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh`; agents only call it:

   ```bash
   #!/usr/bin/env bash
   # Usage: WP=<ID> bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh <backend|playwright> <command...>
   set -u
   : "${WP:?set WP=<ID>}"
   root=/c/Users/jan-p/Development/ontocurator/.worktrees/modifiers
   lock="$root/build/$1.lock"
   shift
   mkdir -p "$root/build"
   until ( set -o noclobber; echo "$WP $(date -Iseconds)" > "$lock" ) 2>/dev/null; do
       echo "waiting for $lock (held by: $(cat "$lock" 2>/dev/null))"
       sleep 15
   done
   trap 'grep -q "^$WP " "$lock" 2>/dev/null && rm -f "$lock"' EXIT
   cd "$root" || exit 1
   "$@"
   exit $?
   ```

   Examples: `WP=M1 bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh backend env CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick src/ontocurator/domain/annotations.py tests/test_annotation_modifiers.py` and `WP=M4 HPO_E2E_PORT=18775 bash /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers/build/with-lock.sh playwright npm --prefix frontend run test:e2e -- browser/modifiers.spec.ts`. Run every Playwright call and every call that may wait or exceed 10 min with `run_in_background: true`; never foreground `sleep`; never delete another agent's lock. A lock older than 45 min whose owner has reported is removed by the main session only.

8. **Contracts.** Only the wave's **contract owner** (wave 2: M1, wave 3: M2, wave 4: M1b) changes `contracts/openapi.json` (`uv run python scripts/export_openapi.py`), `frontend/src/api/generated.ts` (`npm --prefix frontend run api:generate`) and `frontend/src/api/client.ts`. New fields are optional or defaulted so existing clients keep working. Typecheck fallout of the regenerated types in frontend files that no sibling owns is fixed by the contract owner with minimal additive edits (listed in the hand-back); fallout in a sibling's Owns is reported to the main session.
9. **Backend rules.** Domain modules stay pure (no DB, no ontology loading); error codes are `DomainError("<CODE>", {...})` with the codes of "Shared contracts"; no SQL migration (snapshot payloads are JSONB); `exclude_if` keeps every empty new field out of hashes and dumps.
10. **Frontend rules.** English copy verbatim from the spec (or D-f); status never by colour alone; unavailable actions use `aria-disabled` + reason (existing `Button`), never `disabled`; icons from `frontend/src/ui/icons.tsx`; no colour literals outside `tokens.css`, DESIGN.md tokens only; shortcuts only through `useShortcut`; no `style={…}` and no glyphs `↳ ✓` in `AnnotationPanel.tsx` / `SearchPanel.tsx` (`frontend/tests/annotationPanelStyles.test.ts`); no `line-clamp`/`text-overflow: ellipsis` inside the editor.css Values block markers. Offsets are Unicode code points (`Array.from(text)`), never UTF-16 indices.
11. **Evidence** (screenshots) only under `build/modifiers/evidence/` in the worktree; delete Playwright scratch output (`frontend/test-results`, traces) before committing.
12. **Reviews.** WPs marked "Review: yes" get one read-only `superpowers:code-reviewer` pass after their commit (findings to `C:/Users/jan-p/Development/ontocurator-reviews/2026-10-21-modifiers-<ID>-claude.md`), then one fix agent (effort medium) that owns the WP's files. M1's review and fix land before wave 3; M2's and M4's before wave 4; M5's, M1b's and M7's before the final phase. The M2 reviewer also reviews G1's `domain/agreement.py` diff.
13. **Hand-back** (report format): changed/created/deleted files; tests added/updated with counts (e.g. "pytest tests/test_editing_modifiers.py: 21 passed"); gate command + result; Playwright specs + result; commit SHA(s); deviations, line drift, open risks. Max 250 words.

## Shared contracts

### C1 Data model (M1) — `src/ontocurator/domain/annotations.py`

```python
from ontocurator.domain.documents import Document, EvidenceRef, EvidenceSnapshot, Segment

class Modifier(BaseModel):
    """A clinical modifier of one finding (T1 F6): a term and 0..n segments."""

    model_config = ConfigDict(extra="forbid")

    term_id: str
    segments: list[Segment] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )

# Annotation, after `note`:
    modifiers: list[Modifier] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )
```

`validate_and_sort`: each `term_id` matches `CURIE_PATTERN`; a repeated `term_id` raises `InvalidAnnotation("Duplicate modifier term '<id>'")`; segments of one modifier are sorted by `(start, end)` and overlapping ones raise `InvalidAnnotation("Modifier segments overlap: …")`; modifiers are sorted by `term_id`. `annotation_content` adds `content["modifiers"] = [m.model_dump() for m in annotation.modifiers]` only when non-empty (`model_dump` drops empty `segments` through `exclude_if`). `snapshot()` calls `validate_segments(document.text, [s for m in annotation.modifiers for s in m.segments])`.

`ConsolidationMark` (`domain/review.py`, M2): `attached_to: str | None = Field(default=None, exclude_if=lambda value: value is None)` (after `content_sha256`; `ConsolidationAction` stays `"auto" | "keep" | "choose" | "leave_out"`, keep-both is gone since `c766d5fd`).

### C2 Classifier (M1) — new `src/ontocurator/ontology/modifiers.py`

```python
CLINICAL_MODIFIER = "HP:0012823"
FREQUENCY = "HP:0040279"
SEVERITY = "HP:0012824"
ONSET = "HP:0003674"
MODIFIER_ROOTS: tuple[str, ...] = (CLINICAL_MODIFIER, FREQUENCY)  # "+ Add modifier…" `within`
ModifierKind = Literal["modifier", "cohort"]
ExclusiveClass = Literal["severity", "onset"]
TermRole = Literal["finding", "modifier", "cohort"]

@dataclass(frozen=True)
class ModifierClassifier:
    clinical: frozenset[str]  # HP:0012823 subtree, root included
    cohort: frozenset[str]    # HP:0040279 subtree, root included
    severity: frozenset[str]
    onset: frozenset[str]

    def kind(self, term_id: str) -> ModifierKind | None: ...      # cohort first, then clinical
    def exclusive_class(self, term_id: str) -> ExclusiveClass | None: ...
    def role(self, term_id: str) -> TermRole: ...                 # kind or "finding"

NO_MODIFIERS = ModifierClassifier(frozenset(), frozenset(), frozenset(), frozenset())

def subtree(service: OntologyService, root: str) -> frozenset[str]: ...
    # root + descendants (children_of, breadth first); unknown root -> frozenset();
    # cached per (service.ref.sha256, root) under a lock
def classifier_of(service: OntologyService) -> ModifierClassifier: ...  # cached per sha256

class TermRoles:
    """Classifiers of a project's layers whose pin has the T1 profile hpo-phenotype."""
    def __init__(self, by_layer: Mapping[str, ModifierClassifier]) -> None: ...
    def supports(self, layer_id: str) -> bool: ...
    def kind(self, layer_id: str, term_id: str) -> ModifierKind | None: ...
    def exclusive_class(self, layer_id: str, term_id: str) -> ExclusiveClass | None: ...
    def role(self, layer_id: str, term_id: str) -> TermRole: ...   # "finding" for other layers

NO_TERM_ROLES = TermRoles({})

def install_service_source(source: Callable[[str], OntologyService | None]) -> None: ...
    # OntologyRegistry.__init__ calls install_service_source(self.get_service)
def term_roles(profile: TaskProfile, pins: Mapping[str, _PinLike]) -> TermRoles: ...
    # every layer whose pins[layer.ontology_id].t1_profile == "hpo-phenotype";
    # a sha256 the source cannot load raises DomainError("ONTOLOGY_NOT_FOUND", {"sha256": sha})
def term_roles_for_services(
    profile: TaskProfile, pins: Mapping[str, _PinLike], services: Mapping[str, OntologyService]
) -> TermRoles: ...  # editing: uses the already resolved per-layer services
```

`_PinLike` is a `Protocol` with `sha256: str` and `t1_profile: str` (no import from `exchange`). `domain/project_rules.py` gets a structural `ModifierRoles` `Protocol` (`kind`, `exclusive_class`) so the domain does not import `ontology`.

### C3 Editing commands and error codes (M1) — `application/editing.py`

```python
class AddModifierCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["add_modifier"] = "add_modifier"
    annotation_id: str
    term_id: str
    segments: list[Segment] = Field(default_factory=list)

class SetModifierSegmentsCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["set_modifier_segments"] = "set_modifier_segments"
    annotation_id: str
    term_id: str
    segments: list[Segment]

class RemoveModifierCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["remove_modifier"] = "remove_modifier"
    annotation_id: str
    term_id: str

class ConvertToModifierCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["convert_to_modifier"] = "convert_to_modifier"
    annotation_id: str
    target_annotation_id: str
    link_span: bool = True
```

| Code                      | Details                                            | Raised by                                                                                                                          |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `MODIFIERS_NOT_SUPPORTED` | `{layer_id}`                                       | modifier commands, resolve `choice.modifiers`, `attach_to` on a layer whose pin is not `hpo-phenotype`                             |
| `MODIFIER_NOT_ALLOWED`    | `{term_id}`                                        | term not under HP:0012823 / HP:0040279                                                                                             |
| `DUPLICATE_MODIFIER`      | `{term_id}`                                        | term already on the finding (not for `add_modifier` of a spanless existing term with segments: that links)                         |
| `MODIFIER_NOT_FOUND`      | `{term_id}`                                        | `set_modifier_segments`, `remove_modifier` of a term the finding does not have                                                     |
| `MODIFIER_AS_FINDING`     | `{term_id}`                                        | `create_annotation`, `set_term`, adoption, `recreate_reanchor` with a modifier term; resolve `choice.term_id` with a modifier term |
| `UNKNOWN_TERM`            | as today                                           | unknown modifier term                                                                                                              |
| `OBSOLETE_TERM`           | as today                                           | obsolete modifier term                                                                                                             |
| `PROJECT_RULE_VIOLATION`  | `{violations: [{rule: "modifier_as_finding", …}]}` | submit with a standalone modifier finding                                                                                          |

Client payload types (`client.ts`, M1): `AddModifierPayload`, `SetModifierSegmentsPayload`, `RemoveModifierPayload`, `ConvertToModifierPayload` mirroring the classes (segments `{ start: number; end: number }[]`), and `export type Modifier = components["schemas"]["Modifier"]`.

### C4 Search, labels, tree (M1)

- `SearchRequest.within: list[str] | None = Field(default=None, max_length=8)` (each a CURIE, else 422). `SearchCandidate.role: Literal["finding", "modifier", "cohort"] = "finding"` (filled by the route for `hpo-phenotype` layers). `SearchEventRecord.within: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)`.
- `TermLabel` (`api/routes.py`): `role: Literal["finding", "modifier", "cohort"] = "finding"`, `exclusive_class: Literal["severity", "onset"] | None = None`. No new request parameter: every requested term of `TermLabelsRequest` already carries its `layer_id` (`resolve_term_labels` ~`:348` loops `payload.terms` with `term.layer_id`), so the route resolves the role per term from that layer's pin in `payload.project_key` (`finding` unless the pin is `hpo-phenotype`).
- `TreeNode` (`ontology/tree.py`): `role: Literal["finding", "modifier", "cohort"] = "finding"` (filled by `api/tree_routes.py` for `hpo-phenotype` layers).
- `WorkspaceView` (`application/workspaces.py`): `modifier_layer_ids: list[str] = Field(default_factory=list)` (layers whose pin has the T1 profile `hpo-phenotype`; the editor shows the Modifiers section and treats modifier hits specially only there).

### C5 Submit rules and warnings (M1) — `domain/project_rules.py`, `application/submissions.py`

- `RuleViolation.rule` gains `"modifier_as_finding"`, `"cohort_modifier"`, `"exclusive_modifier_class"`.
- `rule_violations(..., modifier_findings: frozenset[str] = frozenset())`: one blocking `RuleViolation(annotation_id, "modifier_as_finding", {"term_id": term})` per snapshot whose annotation id is in `modifier_findings` (the caller computes the set with `TermRoles.kind(layer, term) is not None`).
- New pure `modifier_warnings(snapshots, roles: ModifierRoles) -> list[RuleViolation]`: per snapshot, per modifier with `kind == "cohort"`: `RuleViolation(id, "cohort_modifier", {"term_id": term})`; per exclusive class with ≥ 2 modifiers: `RuleViolation(id, "exclusive_modifier_class", {"class": "severity" | "onset"})`. Snapshot order, then modifier order.
- `_create_submission`: `warnings = (axis warnings when not require_chosen_axes) + [asdict(v) for v in modifier_warnings(...)]`; the acknowledgement digest covers the whole list (unchanged shape `{annotation_id, rule, detail}`), error code still `AXIS_CONFIRMATION_WARNING`. Without modifiers the list and digest are byte-identical to today.

### C6 Re-anchoring (M1b) — `domain/reanchor.py`

```python
ReviewReason = Literal[..., "changed_cue", "changed_modifier_segment"]

@dataclass(frozen=True)
class MappedModifier:
    term_id: str
    segments: tuple[Span, ...]

@dataclass(frozen=True)
class OldModifier:
    term_id: str
    segments: tuple[TextSpan, ...]

# Carried: modifiers: tuple[MappedModifier, ...] = ()
# NeedsReview: old_modifiers: tuple[OldModifier, ...] = ()
```

Every modifier segment is mapped with `map_span` plus the text-equality check; a failure sets `failure = failure or "changed_modifier_segment"` (the whole claim needs review). Every caller that builds the carried annotation writes `modifiers=[Modifier(term_id=m.term_id, segments=[Segment(start=s.start, end=s.end) for s in m.segments]) for m in carried.modifiers]`.

### C7 Grouping (G1) — `src/ontocurator/domain/agreement.py`

```python
ModifierSpans = tuple[tuple[str, tuple[Span, ...]], ...]  # sorted (term, sorted segments)
GroupKind = Literal["match", "values_differ", "span_differs", "notes_differ", "term_differs",
                    "partial", "modifiers_differ", "modifier_as_finding"]

# Finding (new fields, after cues):
    modifier_spans: ModifierSpans = ()
    standalone_modifier: bool = False

# Group (new last field, after span_conflict):
    modifier_majority: ModifierSpans | None = None
```

`Group.span_conflict` (the "Text" row is a decision only on a genuine span conflict, `spans_conflict`) is unchanged; modifier segments never feed it (cue segments do not either).

### C8 Consolidation API (M2) — `api/consolidation_routes.py`, `application/consolidation_resolve.py`

```python
class ConsolidationModifierView(_View):
    term_id: str
    term_label: str
    kind: Literal["modifier", "cohort"]
    exclusive_class: Literal["severity", "onset"] | None = None
    segments: list[tuple[int, int]] = []

class ModifierRefView(_View):
    term_id: str
    segments: list[tuple[int, int]] = []

# ConsolidationMemberView: modifiers: list[ConsolidationModifierView] = []
# ConsolidationGroupView:  modifier_majority: list[ModifierRefView] | None = None
#                          attached_to: str | None = None   # leave_out with attach (S18)

class ModifierIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    term_id: str
    segments: list[Segment] = Field(default_factory=list)

# ResolveChoice: modifiers: list[ModifierIn] | None = None   (omitted: the span member's)
# ResolveCommand: attach_to: str | None = None   (a cons-… annotation id; only with leave_out
#                 on a modifier_as_finding group, else DomainError("INVALID_RESOLUTION"))
# ConsolidationView: modifier_layer_ids: list[str] = []   (as WorkspaceView, for "Edit values…")
```

`client.ts` (M2): `ConsolidationResolvePayload.choice.modifiers?: { term_id: string; segments: { start: number; end: number }[] }[]` and `attach_to?: string`; type aliases `ConsolidationModifierView`, `ModifierRefView`.

### C9 Marks display (E1) — `spans/adapter.ts`, `vendor/spans.js`, `editor/TextPane.tsx`

```ts
// spans/adapter.ts
export interface MentionDisplay {
  // existing fields …
  kind?: "own" | "target" | "source" | "context" | "modifier";
  /** Run title and accessible description, e.g. "Severe, modifier of Seizure". */
  label?: string;
}
export interface SpanEditorHandle {
  // existing …
  /** Evidence ids whose runs get the `run--framed` frame (hover, focus, selection of a finding). */
  setFramed: (evidenceIds: string[]) => void;
}
export type HoverCallback = (evidenceIds: string[]) => void; // [] when the pointer leaves a run

// editor/TextPane.tsx (TextPaneProps, additive)
framedIds?: readonly string[];
onHoverMentions?: (evidenceIds: string[]) => void;
```

Modifier runs: `run--modifier` (1 px double underline in `--mark-line`), fill slot of their finding (`colorIndex` = the finding's slot), never a tab stop, never resizable; a click reports the modifier's display id through `onPick`. Display ids are built only by `modifierDisplayId(annotationId, termId)` = `` `mod:${annotationId}:${termId}` `` and parsed by `parseModifierDisplayId` (`editor/modifiers.ts`).

### C10 Pure editor helpers (E1) — new `frontend/src/editor/modifiers.ts`

```ts
export interface Seg {
  start: number;
  end: number;
}
export interface ModifierLike {
  term_id: string;
  segments?: readonly Seg[];
}
export interface TermInfo {
  label: string;
  role: "finding" | "modifier" | "cohort";
  exclusiveClass: "severity" | "onset" | null;
}
export const COHORT_TAG = "Cohort term";
export const MODIFIER_ROOTS = ["HP:0012823", "HP:0040279"] as const; // "+ Add modifier…" `within`
export function modifierDisplayId(annotationId: string, termId: string): string;
export function parseModifierDisplayId(
  id: string,
): { annotationId: string; termId: string } | null;
/** [start, end) code points of the sentence around `offset`. */
export function sentenceBounds(text: string, offset: number): [number, number];
export interface AttachFinding {
  annotationId: string;
  term: string;
  termId: string;
  segments: readonly Seg[];
  quote: string;
}
export interface AttachCandidate extends AttachFinding {
  distance: number;
  after: boolean;
}
/** Findings with a mention segment in the mark's sentence, nearest first; on a tie the one after the mark. */
export function attachCandidates(
  text: string,
  mark: Seg,
  findings: readonly AttachFinding[],
): AttachCandidate[];
/** "Severe · “schwere”", "Recurrent", "Frequent · “oft” · Cohort term". */
export function chipText(
  label: string,
  quote: string | null,
  role: TermInfo["role"],
): string;
/** "Two severities" / "Two onsets" lines for a finding's modifiers, in that order. */
export function exclusiveWarnings(
  modifiers: readonly ModifierLike[],
  info: (termId: string) => TermInfo | undefined,
): string[];
/** Labels sorted case-insensitively (D-d). */
export function sortByLabel<T extends ModifierLike>(
  modifiers: readonly T[],
  info: (termId: string) => TermInfo | undefined,
): T[];
/** Mark displays for the modifier segments of the given findings. */
export function modifierMarks(
  findings: readonly {
    annotationId: string;
    term: string;
    termId: string;
    colorIndex: number;
    modifiers: readonly ModifierLike[];
  }[],
  text: string,
  info: (termId: string) => TermInfo | undefined,
): MentionDisplay[];
/** "Seizure, modifiers: Severe (“schwere”)"; null without modifiers. */
export function findingDescription(
  term: string,
  modifiers: readonly ModifierLike[],
  text: string,
  info: (termId: string) => TermInfo | undefined,
): string | null;
```

### C11 Consolidation modifier sets (E1) — new `frontend/src/consolidation/modifierSets.ts`

```ts
export interface ModifierView {
  term_id: string;
  term_label: string;
  kind: "modifier" | "cohort";
  exclusive_class: "severity" | "onset" | null;
  segments: [number, number][];
}
export interface MemberSet {
  inputId: string;
  personId: string;
  personName: string;
  modifiers: readonly ModifierView[];
}
export interface SetOption {
  id: string;
  modifiers: ModifierView[];
  personIds: string[];
  inputIds: string[];
  union: boolean;
  majority: string | null /* "(2 of 3)" */;
  warnings: string[]; /* "Two severities" … */
}
export interface SegmentConflict {
  termId: string;
  termLabel: string;
  options: { id: string; segments: [number, number][]; personIds: string[] }[];
}
export function setKey(modifiers: readonly ModifierView[]): string;
export function modifierSetOptions(
  members: readonly MemberSet[],
  majority: readonly { term_id: string; segments: [number, number][] }[] | null,
): { options: SetOption[]; conflicts: SegmentConflict[] };
export function resolveUnion(
  option: SetOption,
  conflicts: readonly SegmentConflict[],
  picks: Readonly<Record<string, string>>,
): ModifierView[];
export function setText(
  modifiers: readonly ModifierView[],
  text: string,
  noTextTerms?: ReadonlySet<string>,
): string; // "Severe “schwere”, Recurrent" / "None"
export function optionLabel(
  option: SetOption,
  text: string,
  people: number,
): string; // "Severe “schwere” · Ana Weber" / "No modifiers · Cem Arslan" / "Both: …" / "All: …"
export interface CrossLink {
  personId: string;
  personName: string;
  termLabel: string;
  quote: string;
  groupId: string;
  findingLabel: string;
}
export function crossLinks(
  groupId: string,
  groups: readonly {
    groupId: string;
    members: readonly (MemberSet & { termLabel: string })[];
  }[],
  text: string,
): CrossLink[];
```

U-rule exactly as the spec ("Consolidation scenarios", U-rule): union = every term of every compared member; per term one distinct non-empty segment list → taken; none → none; ≥ 2 → a `SegmentConflict` (sub-row "Text of {term}"). The union option is offered when some resolution of its conflicts gives a set different from every person's set (S6, S7: not offered; S8: offered). Majority label on the option whose `setKey` equals the majority's. No computed majority or intersection option.

`modifierSets.ts` stays a pure model independent of the layout. Since `ac8eccde` the consolidation UI has no option list: `consolidation/groupModel.ts` builds `comparisonRows` (one column per member, ✓ per value in conflicting rows, the last missing choice resolves the group), `resultLine` and `resolvePayload`. M5 maps the person options onto the members' cells of a `modifiers` row, and the union option, the "Text of {term}" sub-row and the "(2 of 3)" label onto that table as decided in DN-1, DN-2 and DN-3 (pending). `optionLabel` then serves as the accessible name of the ✓ / union control and as the collapsed summary text.

## Shared-file chains (one writer per wave)

| File(s)                                                                                                                                                                                                                                           | Writers (wave)                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`                                                                                                                                                           | M1 (2) → M1 review fix → M2 (3) → M2 review fix → M1b (4) → M1b review fix                                                    |
| `pyproject.toml`, `uv.lock`                                                                                                                                                                                                                       | main session only (pin bump between waves 1 and 2)                                                                            |
| `tests/fixtures/modifiers/hp-modifiers.json`, `tests/fixtures/modifiers/hp-de.modifiers.babelon.tsv`, `tests/modifier_fixtures.py`                                                                                                                | F0 (1)                                                                                                                        |
| `examples/t5-acceptance/profile.json`, `examples/t5-acceptance/manifest.json`                                                                                                                                                                     | F1 (1)                                                                                                                        |
| `src/ontocurator/domain/agreement.py`                                                                                                                                                                                                             | G1 (1) → M2 (3, conditional: fixes only)                                                                                      |
| `tests/browser_server.py`                                                                                                                                                                                                                         | M1 (2, modifier editor scenario) → M2 (3, conditional)                                                                        |
| `tests/browser_consolidation_scenarios.py`                                                                                                                                                                                                        | M2 (3)                                                                                                                        |
| `frontend/src/spans/adapter.ts`, `frontend/src/vendor/spans.js`, `frontend/src/editor/TextPane.tsx`                                                                                                                                               | E1 (2)                                                                                                                        |
| `frontend/src/styles/screens/editor.css`, `frontend/tests/tokens.test.ts`, `frontend/src/editor/markColours.ts`                                                                                                                                   | E1 (2)                                                                                                                        |
| `DESIGN.md`                                                                                                                                                                                                                                       | E1 (2, mark state) → M4 (3, editor rows) → M5 (4, consolidation rows) → M5 review-fix agent (M7's submit and convert rows)    |
| `frontend/src/app/CaseScreen.tsx`, `frontend/tests/caseScreen.test.tsx`                                                                                                                                                                           | M4 (3) → M4 review fix → M7 (4)                                                                                               |
| `frontend/src/editor/AnnotationPanel.tsx`, `AttachPopover.tsx`, `useModifierCommands.ts`, `frontend/tests/attachPopover.test.tsx`                                                                                                                 | M4 (3) → M4 review fix → M7 (4, convert flow and the R3 notice slot only)                                                     |
| `frontend/src/editor/ModifiersSection.tsx`                                                                                                                                                                                                        | M4 (3) → M4 review fix (props for M5's "Edit values…", see M4)                                                                |
| `frontend/src/editor/SearchPanel.tsx`, `TreeBrowser.tsx`, `searchState.ts`, `FindingRow.tsx`, `ReviewActions.tsx` (DN-9, pending)                                                                                                                 | M4 (3)                                                                                                                        |
| `frontend/src/editor/openItems.ts`, `SubmitCaseDialog.tsx`, `UnconfirmedValuesSection.tsx`, `unconfirmedValues.ts`                                                                                                                                | M7 (4)                                                                                                                        |
| `frontend/src/consolidation/*` (incl. `ComparisonTable.tsx`, `ResultLine.tsx`, `SubmitBar.tsx`), `frontend/tests/consolidation/*`                                                                                                                 | E1 (2, only the new `modifierSets.ts` + its test) → M2 (3, conditional: `tests/consolidation/fixtures.ts` typecheck) → M5 (4) |
| `frontend/src/documents/finalPanelText.ts`                                                                                                                                                                                                        | E1 (2, on behalf of M6)                                                                                                       |
| `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/jobs.py`                                                                                                                                                                              | M3 (3)                                                                                                                        |
| `src/ontocurator/domain/reanchor.py`, `reanchor_resolution.py`, `application/work_rounds.py`, `application/text_changes.py`, `exchange/reanchor_job.py`, `frontend/src/editor/carried/instructions.ts`, `frontend/src/variants/ReanchorPanel.tsx` | M1b (4)                                                                                                                       |
| ontospan worktree `C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks`                                                                                                                                                                | O1 (1)                                                                                                                        |

## Waves

| Wave | Slot 1 (port 18774)                                                                                                                                                                                                | Slot 2 (18775)   | Slot 3 (18776)                | Contract owner |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------- | -------------- |
| 1    | G1 (M, pure grouping)                                                                                                                                                                                              | O1 (S, ontospan) | F1 then F0 (S + S, one agent) | none           |
| —    | main session: full backend run once G1 and F have committed (failures go back to the F agent or G1); push ontospan (user OK from Step 0), bump the pin, `uv lock`, `uv sync`, commit `build(deps): ontospan 1.2.1` |                  |                               |                |
| 2    | M1 (L, review)                                                                                                                                                                                                     | E1 (M, incl. M6) | —                             | M1             |
| —    | M1 review → one fix agent (before wave 3)                                                                                                                                                                          |                  |                               |                |
| 3    | M2 (L, review)                                                                                                                                                                                                     | M4 (L, review)   | M3 (M)                        | M2             |
| —    | M2 review and M4 review (parallel) → one fix agent each (before wave 4)                                                                                                                                            |                  |                               |                |
| 4    | M5 (L, review)                                                                                                                                                                                                     | M7 (L, review)   | M1b (M, review: re-anchoring) | M1b            |
| —    | M5, M7 and M1b reviews (parallel) → one fix agent each (the M5 fix agent also writes M7's DESIGN.md rows)                                                                                                          |                  |                               |                |
| 5    | Final phase (main session + one reviewer + one fix agent)                                                                                                                                                          |                  |                               |                |

Dependencies: M1 ← F0 (`MOD_PIN` fixture with the modifier subtree), F1 (`family_member` in the standard axes, used by M1's browser scenario profile). M2 ← G1 (`Finding` fields, kinds), M1 (model, classifier, `TermRoles`, contract). M3 ← M1 (model), pin bump (ontospan codes). M4 ← M1 (commands, `role`, `within`, `TermLabel.role`), E1 (`editor/modifiers.ts`, marks display). M5 ← M2 (contract), E1 (`modifierSets.ts`), M4 review fix (`ModifiersSection` props). M7 ← M4 (`CaseScreen.tsx`, `AttachPopover.tsx`, `useModifierCommands.ts`), M1 (warning rules, `convert_to_modifier`). M1b ← M1 (model, `Modifier`); it is the only wave-4 contract writer (`ReviewReason` literal). Between M1 and M1b, carried annotations keep their modifiers through `model_copy` but their segments are not re-mapped; M1b closes that before the final phase. Critical path: G1 → M1 → M1 review/fix → M2 → M2 review/fix → M5 → M5 review/fix → final phase. Wave 2 slot 3 stays idle (every remaining WP needs M1's contract). Wave 3 is dispatched only after the user has answered (or accepted the recommendations of) "Decisions needed (realignment 2026-10-25)": DN-9 shapes M4 (wave 3), DN-1…DN-8 shape M5 (wave 4); M2's backend does not depend on them (the server takes the explicit modifier list).

## Dispatch prompt template

```text
You implement WP <ID> of docs/superpowers/plans/2026-10-21-finding-modifiers.md
in the worktree C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers
(branch feat/modifiers; Git Bash path /c/Users/jan-p/Development/ontocurator/.worktrees/modifiers).
Read: the "Plan decisions", "Decisions needed (realignment 2026-10-25)", "Global rules", "Shared contracts", "Shared-file chains" and the block
"### <ID>" of the plan, and the spec docs/superpowers/specs/2026-10-21-finding-modifiers-design.md
sections named in the block.
Use the Bash tool (Git Bash) with absolute paths for every shell command, never PowerShell.
Set WP=<ID> in every shell. Your Playwright port: HPO_E2E_PORT=<port>.
Rules: write only your Owns files; TDD; commit only your files with
`git commit -m "<msg>" -- <paths>` (no AI co-author trailer, no push); run PostgreSQL pytest and
Playwright only through build/with-lock.sh (rules 5–7); gate
`CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 bash scripts/check.sh --quick <your owned paths>` (rule 4).
Contract owner of this wave: <ID or "none">; only it changes the contract files (rule 8).
Line drift found in Step 0: <notes or "none">.
User answers to "Decisions needed (realignment 2026-10-25)" that affect this WP: <DN ids + answers or "recommendations accepted">.
Siblings working in parallel: <IDs + their Owns summary>. Do not touch their files.
Open review findings handed to you (rule 12): <findings or "none">.
Report (max 250 words): changed files; tests added/updated and run with pass counts; gate result;
Playwright specs and result; commit SHA(s); deviations and risks.
```

O1's prompt replaces the worktree with `C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks` (branch `feat/modifier-checks`) and its gate with `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q` in that worktree (no locks). The F agent's prompt names "WP F1, then WP F0 (separate commits)".

---

## WP blocks

### O1 — ontospan 1.2.1: `duplicate_modifier`, `exclusive_modifier_class`

**Goal:** spec WP O1, R12, "Validation" rows "term already on the finding" and "a finding with two modifiers of one exclusive class". **Size S. Review: no.**

**Owns (ontospan worktree):** `src/ontospan/profiles/hpo.py`, `tests/test_profiles.py`, `src/ontospan/_version.py`, `pyproject.toml`, `uv.lock` (ontospan's own), `tests/test_package.py`, `CHANGELOG.md`, `README.md` (validation codes list). `SCHEMA_VERSION` stays `"1.2.0"` (no schema change).

**Tests that break:** `tests/test_package.py::test_the_package_states_its_version_and_schema_version` (`__version__ == "1.2.0"` → `"1.2.1"`).

**Tests to add (`tests/test_profiles.py`, builders from `tests/builders.py`):**

```python
def test_a_modifier_term_twice_is_an_error_even_without_ontology() -> None:
    modifiers = [(SEVERE, [(55, 62)]), (SEVERE, [])]
    item = annotation("a1", SEIZURE, [(63, 76)], modifiers=modifiers)
    assert codes(item, None) == [("error", "duplicate_modifier")]


def test_two_severities_or_two_onsets_only_warn(hp: ObographOntology) -> None:
    modifiers = [
        ("HP:0012824", []),  # Severity (the root counts as its class)
        (SEVERE, []),
        ("HP:0410280", []),  # Pediatric onset
        ("HP:0003593", []),  # Infantile onset
    ]
    item = annotation("a1", SEIZURE, [(63, 76)], modifiers=modifiers)
    assert codes(item, hp) == [
        ("warning", "exclusive_modifier_class"),
        ("warning", "exclusive_modifier_class"),
    ]


def test_one_severity_and_one_onset_do_not_warn(hp: ObographOntology) -> None:
    item = annotation(
        "a1", SEIZURE, [(63, 76)], modifiers=[(SEVERE, []), ("HP:0003593", [])]
    )
    assert codes(item, hp) == []
```

Also assert the issue path: the duplicate is reported at `a.modifiers[1].term_id`, the class warning at `a.modifiers` with the message naming the class (`"2 severity modifiers: ['HP:0012824', 'HP:0012828']"`).

**Steps:**

- [ ] Red: the three tests and the version assertion `"1.2.1"`; `uv run pytest tests/test_profiles.py tests/test_package.py -q` fails.
- [ ] `profiles/hpo.py`, the ontology-free modifier loop becomes:

  ```python
  seen: set[str] = set()
  for index, modifier in enumerate(annotation.modifiers):
      where = f"{path}.modifiers[{index}].term_id"
      if not _HPO_ID.match(modifier.term_id):
          add("not_an_hpo_id", where, f"{modifier.term_id!r} is not an HPO id")
      if modifier.term_id in seen:
          add(
              "duplicate_modifier",
              where,
              f"{modifier.term_id} is already a modifier of this annotation",
          )
      seen.add(modifier.term_id)
  ```

  and after the ontology loop over the modifiers:

  ```python
  for root, name in ((SEVERITY, "severity"), (ONSET, "onset")):
      under = sorted(
          {
              m.term_id
              for m in annotation.modifiers
              if ontology.is_active(m.term_id) and is_under(ontology, m.term_id, root)
          }
      )
      if len(under) > 1:
          add(
              "exclusive_modifier_class",
              f"{path}.modifiers",
              f"{len(under)} {name} modifiers: {under}",
              "warning",
          )
  ```

- [ ] Version `1.2.1` in `pyproject.toml` and `_version.py`; `uv lock` in the ontospan worktree; CHANGELOG `## 1.2.1` ("Validation: `duplicate_modifier` (error) for a modifier term repeated on one annotation; `exclusive_modifier_class` (warning) for two or more modifiers under Severity HP:0012824 or Onset HP:0003674. No schema change."); README validation-codes paragraph names both codes.
- [ ] Gate (ontospan): `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest -q`.
- [ ] Commit `feat(hpo): duplicate modifiers and exclusive modifier classes`; tag `git -C C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks tag -a v1.2.1 -m "ontospan 1.2.1"`. **No push** (main session, after the user's OK). Hand back the full commit SHA.

**Acceptance:** green ontospan suite; `to_phenopackets` unchanged (first severity → `severity`, the rest → `modifiers[]`, existing test).

### F1 — Experiencer `family_member` (M7)

**Goal:** spec "Experiencer “Family member” (M7)". **Size S. Review: no.** Done by the F agent before F0.

**Owns:** `src/ontocurator/domain/axes.py`, `src/ontocurator/domain/profile_templates.py`, `examples/t5-acceptance/profile.json`, `examples/t5-acceptance/manifest.json` (only its `sha256["profile.json"]` entry), `tests/test_axes.py`, `tests/test_profile_template_family_member.py` (new). Conditional: tests that assert `STANDARD_CLINICAL_AXES` options or its `config_sha256` (find with `grep -rn '"patient", "other"' tests`; 2026-10-25 hits: `tests/test_axes.py:133` asserts the standard axes; `tests/layered_fixtures.py:81`, `tests/test_domain.py:59`, `tests/test_storage.py:64` and `tests/test_t1_mapping.py:665` define their own profiles and stay unchanged); `frontend/browser/values-block.spec.ts` and `frontend/browser/editor-layout.spec.ts` (only expectations of the experiencer options). **Not** `tests/fixtures/smoke-profile.json`, `tests/layered_fixtures.py` (spec: unchanged), **not** `examples/t5-acceptance/demo.zip` (its bundle manifest carries no axis options; verified) and not the other t5 files.

The standard profile lives in code (`STANDARD_CLINICAL_AXES`, `profile_templates.py`); `examples/t5-acceptance/profile.json` is the T5 seed's own profile (spec: "the seed's profile gets the option"), so F1 edits it and must re-hash it in `manifest.json` (`scripts/seed_t5_acceptance.py` checks the four hashes; `tests/test_seed_t5_acceptance.py::test_public_input_manifest_matches_byte_stable_shipped_inputs`).

**Tests that break:** `tests/test_axes.py` ~`:131-133` (`("experiencer", "Experiencer", ["patient", "other"])`).

**Tests to add:**

- `tests/test_axes.py`: experiencer options `["patient", "family_member", "other"]`; `validate_axes({"experiencer": "family_member"}, …)` accepts it.
- `tests/test_profile_template_family_member.py`: `profile_templates.TEMPLATES["hpo-phenotype"](ontology_file)` (use the existing template test's ontology argument; `grep -rn "hpo_phenotype(" tests`) has experiencer options in that order and the creation default stays `patient`; `check_t1_profile(profile, {ontology_id: Pin(sha256="x", t1_profile="hpo-phenotype")})` raises nothing; `examples/t5-acceptance/profile.json` loads and lists `family_member` between `patient` and `other`.

**Steps:**

- [ ] Red, then `axes.py`: `ExperiencerType = Literal["patient", "family_member", "other"]`; `STANDARD_CLINICAL_AXES` experiencer `options=["patient", "family_member", "other"]` (~`:73`); `profile_templates.py` ~`:48` the same; `examples/t5-acceptance/profile.json` ~`:42` insert `"family_member"` after `"patient"`. If the axis definition model has a description field, set the experiencer description to "Patient: the patient. Family member: a relative (“Mutter mit Epilepsie”). Other person: someone who is not a relative."; otherwise none (there is no guidelines file to edit).
- [ ] `manifest.json`: replace `sha256["profile.json"]` with `sha256sum examples/t5-acceptance/profile.json` (keep the file's formatting; the other three hashes stay). Run (do not edit) `uv run pytest tests/test_seed_t5_acceptance.py -q` under the backend lock.
- [ ] Green; gate (backend lock) with the owned paths. Browser (Playwright lock, port 18776): `values-block.spec.ts editor-layout.spec.ts` — the experiencer control shows three options (Patient · Family member · Other person) and the layout spec stays green; fix only experiencer-option expectations. Commit `feat(axes): family member experiencer`.

**Acceptance:** standard profile shows Patient · Family member · Other person (editor labels exist in `editor/axisLabels.ts`; the fixed axis colour exists too: `ui/AxisValue.tsx` maps `family_member` to `axis-value--family`, tokens `--axis-family-*`; no colour work); t5 manifest verifies; both browser specs green.

### F0 — Fixture ontology with the modifier subtree

**Goal:** spec "Testing > Fixture ontology", **as a separate fixture (D-h, deviation from the spec)**. **Size S. Review: no.** Done by the F agent after F1.

**Owns:** `tests/fixtures/modifiers/hp-modifiers.json` (new), `tests/fixtures/modifiers/hp-de.modifiers.babelon.tsv` (new), `tests/modifier_fixtures.py` (new), `tests/test_fixture_ontology.py` (new). **Never** `tests/fixtures/hp.json`, `tests/fixtures/hp-de.babelon.tsv`, `tests/fixtures/smoke-*`, anything under `examples/` (D-h): their bytes must stay identical.

`tests/modifier_fixtures.py` (pattern of `tests/t1_fixtures.py`, which it imports from instead of copying):

```python
MOD_DIR = Path(__file__).parent / "fixtures" / "modifiers"
MOD_PATH = MOD_DIR / "hp-modifiers.json"
MOD_DE = MOD_DIR / "hp-de.modifiers.babelon.tsv"
MOD_SHA = hashlib.sha256(MOD_PATH.read_bytes()).hexdigest()
MOD_PIN = Pin(
    sha256=MOD_SHA, allowed_roots=("HP:0000118",), t1_profile="hpo-phenotype"
)

def create_modifier_project(db: Database, key: str = "mods") -> None:
    """Store hp-modifiers.json (and its German file) and create a project pinning MOD_PIN."""
```

`allowed_roots` stays `("HP:0000118",)` like `t1_fixtures.PIN`: it restricts finding terms only and the modifier subtrees stay usable (spec "Search subtree filter").

**Terms to add** (obographs nodes `{"id": "http://purl.obolibrary.org/obo/HP_xxxxxxx", "lbl": …, "type": "CLASS"}` and `is_a` edges, same shape as the existing ones):

| Id         | Label               | Parent (`is_a`)      |
| ---------- | ------------------- | -------------------- |
| HP:0012823 | Clinical modifier   | HP:0000001 All       |
| HP:0012824 | Severity            | HP:0012823           |
| HP:0012825 | Mild                | HP:0012824           |
| HP:0012828 | Severe              | HP:0012824           |
| HP:0031797 | Clinical course     | HP:0012823           |
| HP:0003674 | Onset               | HP:0031797           |
| HP:0410280 | Pediatric onset     | HP:0003674           |
| HP:0003623 | Neonatal onset      | HP:0410280           |
| HP:0011008 | Temporal pattern    | HP:0031797           |
| HP:0031796 | Recurrent           | HP:0011008           |
| HP:0012830 | Position            | HP:0012823           |
| HP:0012831 | Laterality          | HP:0012830           |
| HP:0012832 | Bilateral           | HP:0012831           |
| HP:0040279 | Frequency           | HP:0000001           |
| HP:0040282 | Frequent            | HP:0040279           |
| HP:0007359 | Focal-onset seizure | HP:0001250 (Seizure) |

Check every label and parent against the pinned HPO release (ontospan's `tests/fixtures/hp-mini.json` in the ontospan checkout has Clinical course, Pediatric onset, Position, Laterality, Bilateral, Frequency, Frequent with their parents; for the rest use the full HPO if `examples/full-hpo-sources.json` points at a local copy, else hpo.jax.org); report every difference and follow the release. `hp-modifiers.json` = a byte copy of `tests/fixtures/hp.json` (same `meta.version` release `2026-06-23`) plus these nodes and edges; if the ontology store refuses a second `hp` file with the same release next to `hp.json` in one database (browser server), give it the version `…/releases/2026-06-23-modifiers/hp.json` and report. German (`hp-de.modifiers.babelon.tsv`, header and column layout of `hp-de.babelon.tsv`, only these two rows): `HP:0012828 rdfs:label en Severe de Schwer OFFICIAL` and `HP:0031796 rdfs:label en Recurrent de Wiederkehrend OFFICIAL`.

**Tests to add (`tests/test_fixture_ontology.py`, load the fixture like `tests/test_search_translations.py` does):** every table term exists with its label and parent; `all_ancestors_of("HP:0003623")` contains HP:0003674 and HP:0012823; `all_ancestors_of("HP:0040282")` contains HP:0040279 but not HP:0012823; a German search `SearchRequest(query="schwere", languages=["de"], …)` on a service built with `MOD_DE` lists HP:0012828 among its candidates; every node and edge of `tests/fixtures/hp.json` is in `hp-modifiers.json` (superset); `t1_fixtures.HP_SHA` and the sha256 of `hp-de.babelon.tsv` equal literals pasted from the unchanged files (guards D-h); `discover_translation_files([FIXTURES])` does not list the new German file (subdirectory).

**Steps:**

- [ ] Red (`tests/test_fixture_ontology.py`), create the two files and `tests/modifier_fixtures.py`; green.
- [ ] Under the backend lock: `uv run pytest tests/test_fixture_ontology.py tests/test_search_translations.py tests/test_translation_api.py tests/test_admin_cli.py tests/test_smoke_bundle.py tests/test_seed_t5_acceptance.py -q` (fixture-directory discovery and the pinned hashes stay green). `git diff --stat <base> -- tests/fixtures/hp.json tests/fixtures/hp-de.babelon.tsv tests/fixtures/smoke-profile.json tests/fixtures/smoke-bundle.zip examples/` shows only F1's `profile.json` and `manifest.json`.
- [ ] Commit `test(fixtures): separate HPO fixture with the clinical modifier subtree`. Gate with the owned paths. **No full backend run here:** G1 works in the same worktree and its uncommitted `agreement.py` would be in it; the main session runs the full backend suite after wave 1 (Waves table).

**Acceptance:** the modifier fixture carries the subtree and the German label; existing fixtures and the t5 example are byte-identical; full backend suite green in the main session's post-wave-1 run.

### G1 — Grouping with modifiers (pure domain)

**Goal:** spec "Agreement and grouping (pure domain)", R4, R5, R6 (the domain part), M9; scenarios S1–S20 at the `groups()`/`compare()` level. **Size M. Review: no (the M2 reviewer reviews this diff).**

**Owns:** `src/ontocurator/domain/agreement.py`, `tests/test_agreement_modifiers.py` (new). Run (do not edit) `tests/test_agreement_domain.py`, `tests/test_agreement_groups.py`.

**Tests that break:** none expected (new fields have defaults).

**Tests to add (`tests/test_agreement_modifiers.py`, pure, no DB):**

```python
TEXT = "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."
SEIZURE, HYPOTONIA, FOCAL = "HP:0001250", "HP:0001252", "HP:0007359"
SEVERE, MILD, RECURRENT = "HP:0012828", "HP:0012825", "HP:0031796"
FREQUENT = "HP:0040282"
AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}


def at(word: str, nth: int = 0) -> tuple[int, int]:
    start = -1
    for _ in range(nth + 1):
        start = TEXT.index(word, start + 1)
    return (start, start + len(word))


def f(key, term, spans=(), mods=(), *, standalone=False, order=0, axes=AXES):
    return Finding(
        key=key, layer_id="hpo", term_id=term, axes=dict(axes),
        modifiers=frozenset(t for t, _ in mods), spans=tuple(spans), order=order,
        type_id="phenotype",
        modifier_spans=tuple(sorted((t, tuple(sorted(s))) for t, s in mods)),
        standalone_modifier=standalone,
    )
```

One test per scenario, asserting `kinds` (and where named `modifier_majority`, number of groups, and `compare()`'s `matching` / `context_differences` / `only_here`):

| Test                                         | Input (A = "a", B = "b", C = "c")                                                                          | Expected                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `test_s1_same_modifier_and_text_match`       | A, B Seizure `at("Krampfanfälle")` `{SEVERE: [at("schwere")]}`                                             | `{"match"}`; compare matching 1                                                                      |
| `test_s2_spanless_modifier_sets_match`       | A, B `{SEVERE: [], RECURRENT: []}`                                                                         | `{"match"}`                                                                                          |
| `test_s3_subset_differs`                     | A `{SEVERE}`, B `{SEVERE, RECURRENT}`                                                                      | `{"modifiers_differ"}`; compare context_differences 1                                                |
| `test_s4_disjoint_sets`                      | A `{SEVERE: [at("schwere")]}`, B `{RECURRENT: [at("wiederholt")]}`                                         | `{"modifiers_differ"}`; compare context_differences 1                                                |
| `test_s5_none_versus_one`                    | A `{}`, B `{SEVERE: [schwere]}`                                                                            | `{"modifiers_differ"}`                                                                               |
| `test_s6_text_versus_no_text`                | A `{SEVERE: [schwere]}`, B `{SEVERE: []}`                                                                  | `{"modifiers_differ"}`; compare **matching 1** (R4)                                                  |
| `test_s7_different_texts`                    | A `{SEVERE: [at("schwere")]}`, B `{SEVERE: [at("wiederholt schwere")]}`                                    | `{"modifiers_differ"}`; compare matching 1                                                           |
| `test_s8_union_with_conflicting_spans`       | A `{SEVERE: [at("schwere")]}`, B `{SEVERE: [at("wiederholt schwere")], RECURRENT: []}`                     | `{"modifiers_differ"}`; compare context_differences 1; `modifier_majority is None`                   |
| `test_s9_same_text_on_different_findings`    | A Seizure `{SEVERE: [schwere]}`, Hypotonia `{}`; B Seizure `{}`, Hypotonia `{SEVERE: [schwere]}`           | two groups, each `{"modifiers_differ"}`                                                              |
| `test_s10_combined_rows`                     | A present, span "Krampfanfälle", `{SEVERE}`; B uncertain, span "schwere Krampfanfälle", `{}`               | `{"values_differ", "span_differs", "modifiers_differ"}`                                              |
| `test_s11_term_differs_compares_all_members` | A Seizure `{SEVERE: [schwere]}`, B Focal `{RECURRENT}` overlapping                                         | one group `{"term_differs", "modifiers_differ"}` (one finding per group); compare only_here a 1, b 1 |
| `test_s12_three_people_term_differs`         | A Seizure `{SEVERE}`, B Seizure `{}`, C Focal `{MILD}`                                                     | one group ⊇ `{"term_differs", "modifiers_differ"}`; `modifier_majority is None`                      |
| `test_s13_partial`                           | A Seizure `{SEVERE: [schwere]}`, B nothing                                                                 | `{"partial"}`                                                                                        |
| `test_s14_partial_with_three`                | A `{SEVERE}`, B `{}`, C nothing                                                                            | `{"partial", "modifiers_differ"}`                                                                    |
| `test_s15_majority_label_source`             | A `{SEVERE}`, B `{SEVERE}`, C `{}`                                                                         | `{"modifiers_differ"}`; `modifier_majority == ((SEVERE, ()),)`                                       |
| `test_s16_no_majority`                       | A `{SEVERE}`, B `{SEVERE, RECURRENT}`, C `{MILD}`                                                          | kinds exactly `{"modifiers_differ"}`; `modifier_majority is None`                                    |
| `test_s17_cohort_sets`                       | A `{FREQUENT}`, B `{RECURRENT}`; variant A, B both `{FREQUENT}`                                            | `{"modifiers_differ"}`, context_differences 1; variant `{"match"}`, matching 1                       |
| `test_s18_standalone_never_merges`           | A standalone Severe on "schwere Krampfanfälle"; B Seizure on "schwere Krampfanfälle" `{SEVERE: [schwere]}` | two groups: A's `{"modifier_as_finding", "partial"}`, B's `{"partial"}` (overlap ignored)            |
| `test_s19_both_standalone`                   | A, B standalone Severe on "schwere"                                                                        | `{"modifier_as_finding"}`; compare matching 1                                                        |
| `test_s20_one_more_character_differs`        | A `[at("schwere")]`, B `[at("schwere ")]`                                                                  | `{"modifiers_differ"}`; compare matching 1                                                           |
| `test_without_modifiers_nothing_changes`     | the fixtures of `test_agreement_groups.py`'s main table with default fields                                | identical `groups()` and `compare()` results (call both modules' helpers)                            |

**Steps:**

- [ ] Red: `uv run pytest -p no:cacheprovider tests/test_agreement_modifiers.py -q`.
- [ ] `agreement.py`: C7 types; extend the module docstring (modifier sets compared by `compare` as term-id sets; `groups` compares `modifier_spans` exactly). In `groups()`: `candidates = [i for i, cluster in enumerate(clusters) if len(cluster.members) < len(order) and not cluster.first.standalone_modifier]` (standalone clusters never join the term merge, and a merge partner that is standalone is excluded by the same filter). In `_group`, after the existing loop:

  ```python
  modifier_sets = [finding.modifier_spans for _, finding in members]
  # D-e: a person's exact set (with segments) held by > half of >= 3 members.
  majority_set: ModifierSpans | None = None
  if len(members) >= 3:
      counts: dict[ModifierSpans, int] = {}
      for value in modifier_sets:
          counts[value] = counts.get(value, 0) + 1
      majority_set = next(
          (value for value, count in counts.items() if count * 2 > len(members)), None
      )
  ```

  kinds: `if len(set(modifier_sets)) > 1: kinds.add("modifiers_differ")`; `if any(f.standalone_modifier for _, f in members): kinds.add("modifier_as_finding")` (both before the `match` fallback); `Group(..., modifier_majority=majority_set if "modifiers_differ" in kinds else None)`. `_relation` and `compare` stay unchanged.

- [ ] Green, plus `uv run pytest -p no:cacheprovider tests/test_agreement_domain.py tests/test_agreement_groups.py -q`. Gate (backend lock: the quick gate may pick DB tests that import the module). Commit `feat(agreement): group modifiers with their text spans`.

**Acceptance:** S1–S20 domain tests green (S4, S8, S16 kinds and S17 included); existing agreement tests unchanged.

### M1 — Data model, classifier, editing commands, search, submit rules, contract

**Goal:** spec "Data model and content hash", "Validation (server side)", "Editing commands", "Search subtree filter", R1–R3, R10–R12; contract C1–C5. Re-anchoring ("Text versions", R9, C6) is M1b. **Size L. Review: yes (L, contract, data model).** Contract owner of wave 2.

**Owns:** `src/ontocurator/domain/annotations.py`, `src/ontocurator/domain/project_rules.py`, `src/ontocurator/application/editing.py`, `src/ontocurator/application/submissions.py`, `src/ontocurator/ontology/modifiers.py` (new), `src/ontocurator/ontology/registry.py`, `src/ontocurator/ontology/service.py`, `src/ontocurator/ontology/provenance.py`, `src/ontocurator/ontology/tree.py`, `src/ontocurator/api/tree_routes.py`, `src/ontocurator/api/routes.py`, `src/ontocurator/packages/models.py`, `src/ontocurator/application/workspaces.py` (`modifier_layer_ids`), `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, tests: `tests/test_annotation_modifiers.py`, `tests/test_modifier_classifier.py`, `tests/test_editing_modifiers.py`, `tests/test_search_within.py`, `tests/test_submission_modifier_rules.py`, `tests/test_modifier_exports.py` (new), `tests/browser_modifier_scenarios.py` (new), `tests/browser_server.py`, `tests/test_browser_modifier_fixture.py` (new). Conditional: other Python tests broken by the new error paths (report each); frontend typecheck fallout (rule 8).

**Tests that break:** none by design (empty modifiers are invisible); `tests/test_search_*` seeds must stay identical (written first as characterization, below).

**Tests to add:**

- `tests/test_annotation_modifiers.py` (pure):
  1. `test_existing_versions_and_submission_id_are_unchanged` — **written and run green on the unchanged code first**: build three snapshots with fixed inputs (a spanless finding, a finding with one mention and `axes_defaulted`, a finding with a note and two mentions; fixed `ontology_sha256`, `layer_config_sha256` from a fixed small `TaskProfile` **with its own axis definitions written out in the test, never `STANDARD_CLINICAL_AXES`** (F1 changed it; its `config_sha256` is not stable across this plan)) and one `canonical_hash` of a submission content dict built like `_create_submission` (`key`, `scope`, `targets`, `draft_revision`, `snapshots`, `decisions`); paste the four values as literals.
  2. modifiers sorted by `term_id`; segments sorted; duplicate term → `InvalidAnnotation`; overlapping segments in one modifier → `InvalidAnnotation`; overlap between modifiers and with the mention allowed.
  3. `annotation_content` without modifiers has no `modifiers` key; with `[Modifier("HP:0031796"), Modifier("HP:0012828", [Segment(25, 32)])]` it is `[{"term_id": "HP:0012828", "segments": [{"start": 25, "end": 32}]}, {"term_id": "HP:0031796"}]`.
  4. `snapshot()` refuses a modifier segment beyond `len(document.text)`.
  5. `decode_snapshot` of an old payload (no `modifiers`) round-trips to the same version.
- `tests/test_modifier_classifier.py` (pure, `modifier_fixtures.MOD_PATH`): `kind`: Severe → `modifier`, Frequent → `cohort`, Seizure → `None`, the roots themselves classified; `exclusive_class`: Mild/Severe → `severity`, Neonatal onset → `onset`, Recurrent → `None`; `subtree(service, "HP:0011008")` = {HP:0011008, HP:0031796}; unknown root → empty; `classifier_of` returns the cached object on the second call; `TermRoles` gives `finding` for a layer that is not `hpo-phenotype`; `term_roles` raises `ONTOLOGY_NOT_FOUND` for an unknown sha256.
- `tests/test_editing_modifiers.py` (PostgreSQL; project from `modifier_fixtures.create_modifier_project` (`MOD_PIN`, `hpo-phenotype`), fixture text "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie."; reuse the editing test helpers of `tests/test_editing.py`): add without and with segments; add of a spanless existing term with segments links them; add duplicate with segments when one exists → `DUPLICATE_MODIFIER`; `MODIFIER_NOT_ALLOWED` (Seizure as modifier); `UNKNOWN_TERM`, `OBSOLETE_TERM` (HP:0000123); alternative id stored as primary; Frequency accepted; Mild + Severe accepted; segment out of bounds → `InvalidAnnotation` error code as today; `set_modifier_segments` replace and `[]`; `MODIFIER_NOT_FOUND`; `remove_modifier`; layer pinned `generic` → `MODIFIERS_NOT_SUPPORTED`; reference layer → `REFERENCE_LAYER_READ_ONLY`; `create_annotation` with Severe → `MODIFIER_AS_FINDING` `{term_id}`; `set_term` to Severe → `MODIFIER_AS_FINDING`; `set_term` keeps modifiers; adoption of a proposal whose term is Severe → `MODIFIER_AS_FINDING`; adoption of a tool proposal that carries modifiers (annotate from proposals: "correct" copies the proposal into the own layer, `_adoption_source` ~`:659`) copies them when it copies axes and note, and the proposal-check decision stays whatever the annotator records (outcomes are explicit, nothing is derived from content); delete removes the modifiers with the finding; every command clears `checked_layer_ids` of the layer and repoints a consolidation-marked decision (`_update_decision_replacements`); the workspace view lists the `hpo-phenotype` layer in `modifier_layer_ids` and not a `generic` one; `convert_to_modifier` with `link_span=True` deletes the standalone finding and adds Severe with its first mention's segments to the target in one revision, with `link_span=False` without segments, refusals `ANNOTATION_NOT_FOUND`, `DUPLICATE_MODIFIER`, `MODIFIER_NOT_ALLOWED` (source is not a modifier term).
- `tests/test_search_within.py` (pure service tests on `MOD_PATH` with `MOD_DE` plus one API test on a `MOD_PIN` project): **characterization first** — seeds of three existing searches (`auto` keyword, `lexical`, with and without `languages`) on `tests/fixtures/hp.json` recorded on the unchanged code and pasted as literals; `within=["HP:0012823", "HP:0040279"]` with query "se" returns only subtree terms and as many as exist up to `k` (filter before the cut: a query whose top 10 unfiltered hits contain fewer than `k` modifier terms still returns `k` when they exist); `within` changes the seed, its absence does not; `route="browse"` with `within` uses them as roots; the stored event has `within`; `SearchCandidate.role` is `modifier`/`cohort`/`finding` on an `hpo-phenotype` layer and always `finding` on a `generic` one; `/terms/labels` returns `role` and `exclusive_class`; tree node `role`.
- `tests/test_submission_modifier_rules.py` (PostgreSQL): a standalone Severe finding (inserted through the repository like old data, bypassing the command) → `PROJECT_RULE_VIOLATION` with rule `modifier_as_finding`; a finding with Frequent → `AXIS_CONFIRMATION_WARNING` whose `warnings` contains `{"rule": "cohort_modifier", "detail": {"term_id": "HP:0040282"}}`, the returned acknowledgement submits; Mild + Severe → `exclusive_modifier_class` `{"class": "severity"}`; with `require_chosen_axes` the modifier warnings still need the acknowledgement; without modifiers the warnings list and the acknowledgement digest equal **literals recorded on the unchanged code** (a draft with only defaulted axes on a fixed profile with its own axes, not `STANDARD_CLINICAL_AXES`; written and run green before C5 is implemented, committed with the other characterization tests; comparing with a digest computed at test time would be circular). `validate_draft_terms`: a draft whose finding carries an unknown modifier term → `UNKNOWN_TERM`, an obsolete one (HP:0000123 as modifier) → `OBSOLETE_TERM`, the message names the modifier (`"modifier HP:… of …"`).
- `tests/test_modifier_exports.py` (PostgreSQL, spec "Data model": "no consumer may assume a closed key set"): list every serialiser of annotation content (`grep -rn "annotation_content(\|model_dump(" src/ontocurator/application src/ontocurator/api src/ontocurator/exchange`; at least the review export (`exchange/review_export.py`), the edit-log export and the final content (`exchange/final_content.py`, `exchange/final_export.py`); `exchange/proposal_checks.py` (per-proposal decisions, `5b31c3db`) writes ids, refs and counts only and needs no test beyond a check that it stays so); for each, one test that a finding with `[Severe “schwere”]` serialises `modifiers` and one that a finding without modifiers has no `modifiers` key; grep for consumers that compare key sets (`set(content)`, `keys() ==`, `extra="forbid"` models parsing stored content) and list each in the hand-back as fixed (owned) or reported.
- `tests/test_browser_modifier_fixture.py`: the new scenario builds (project pinned with `MOD_PIN`, `hp-modifiers.json` and `hp-de.modifiers.babelon.tsv` stored through the real store, with the F1 standard axes, document "Seit 2 Wochen wiederholt schwere Krampfanfälle und eine Muskelhypotonie.", one annotator task, German search language on; variant `with_finding=1` pre-creates Seizure on "Krampfanfälle"; variant `standalone=1` pre-inserts a standalone Severe finding on "schwere").

**Steps:**

- [ ] Characterization tests (golden versions, search seeds) green on the unchanged code; commit them first: `test(modifiers): pin existing hashes and search seeds`.
- [ ] Red for the rest.
- [ ] `domain/annotations.py` per C1. `validate_and_sort` additions:

  ```python
  seen: set[str] = set()
  for modifier in self.modifiers:
      if not CURIE_PATTERN.match(modifier.term_id):
          raise InvalidAnnotation(
              f"Invalid ontology CURIE format for modifier: '{modifier.term_id}'"
          )
      if modifier.term_id in seen:
          raise InvalidAnnotation(f"Duplicate modifier term '{modifier.term_id}'")
      seen.add(modifier.term_id)
      ordered = sorted(modifier.segments, key=lambda s: (s.start, s.end))
      for left, right in zip(ordered, ordered[1:]):
          if left.end > right.start:
              raise InvalidAnnotation(
                  f"Modifier segments overlap: {left} and {right}"
              )
      modifier.segments = ordered
  self.modifiers = sorted(self.modifiers, key=lambda m: m.term_id)
  ```

  `annotation_content`: `if annotation.modifiers: content["modifiers"] = [m.model_dump() for m in annotation.modifiers]`. `snapshot()`: `validate_segments(document.text, [s for m in annotation.modifiers for s in m.segments])` after the evidence check.

- [ ] `ontology/modifiers.py` per C2 (`subtree` walks `service.ontology.children_of`; caches are module dicts guarded by one `threading.Lock`, keyed by sha256). `registry.py`: `install_service_source(self.get_service)` at the end of `__init__`.
- [ ] `editing.py`: the four commands (C3) into `EditCommand`; add them to the preparation tuple next to `SetTermCommand` (they need the layer's service); read `pins = self.repo.project_pins(key.project_key)` once before `operation`; helpers:

  ```python
  def _modifier_layer(self, profile, pins, layer_id, services) -> ModifierClassifier:
      roles = term_roles_for_services(profile, pins, {layer_id: services[layer_id]})
      if not roles.supports(layer_id):
          raise DomainError("MODIFIERS_NOT_SUPPORTED", {"layer_id": layer_id})
      return classifier_of(services[layer_id])

  def _modifier_term(self, service, classifier, term_id) -> str:
      primary = self._validate_term_for_layer(service, term_id)  # UNKNOWN/OBSOLETE
      if classifier.kind(primary) is None:
          raise DomainError("MODIFIER_NOT_ALLOWED", {"term_id": primary})
      return primary

  def _replace(self, draft, existing, annotation, doc, profile) -> None:
      new_snap = snapshot(annotation, existing.evidence, doc, profile)
      draft.annotations = [
          new_snap if a.annotation.annotation_id == annotation.annotation_id else a
          for a in draft.annotations
      ]
      layer = annotation.layer_id
      draft.checked_layer_ids = [lid for lid in draft.checked_layer_ids if lid != layer]
      self._update_decision_replacements(draft, annotation.annotation_id, new_snap)
  ```

  `add_modifier`: existing term without segments + given segments → link; existing term otherwise → `DUPLICATE_MODIFIER`; else append `Modifier(term_id=primary, segments=cmd.segments)`; `validate_segments(doc.text, cmd.segments)`. `set_modifier_segments` / `remove_modifier`: `MODIFIER_NOT_FOUND` when absent (term compared after primary-id resolution). `convert_to_modifier`: source must be in the draft, in an editable layer, with `classifier.kind(source.term_id)` set (else `MODIFIER_NOT_ALLOWED`); target in the same layer; segments = the source's first evidence (by `evidence_refs` order) mention segments when `link_span`; refuses `DUPLICATE_MODIFIER` when the target has the term with other segments; then `remove_draft_annotation(draft, source_id)` and `_replace(target)`. `_create_annotation`, `_set_term`, recreate and adoption (also the branch with `source.annotation.term_id == cmd.term_id`): after the term is resolved, `if layer supports modifiers and classifier.kind(term_id) is not None: raise DomainError("MODIFIER_AS_FINDING", {"term_id": term_id})`. `set_term` keeps `modifiers` (only `term_id` changes). Adoption copies the source's modifiers if it copies its axes and note (check `_create_annotation`; same rule).

- [ ] Search (`provenance.py`, `service.py`, `api/routes.py`, `packages/models.py`, `tree.py`, `tree_routes.py`) per C4. `OntologyService.search`: with `request.within`, `allowed = frozenset().union(*(subtree(self, root) for root in request.within))`; `_auto_hits` filters the exact block by `allowed` and fetches the similar block with a widening depth until `remaining` hits survive or the ranking is exhausted:

  ```python
  depth = request.k + len(exact)
  while True:
      fetched = self._similar(query, depth, languages)
      ranked = [h for h in fetched if h["hpo_id"] not in taken and (allowed is None or h["hpo_id"] in allowed)]
      if len(ranked) >= remaining or len(fetched) < depth:
          break
      depth = depth * 10 if depth < request.k * 10 else len(self.ontology)  # k × 10, then all
  ranked = ranked[:remaining]
  ```

  (`len(self.ontology)` = the term count; use the existing accessor.) `_route_hits` filters the same way; `browse` with `within` returns the `within` roots in their order. `_seed`: keep the current code path byte-identical and only when `request.within` is set hash once more: `hashlib.sha256(f"{seed}|within:{','.join(sorted(request.within))}".encode()).hexdigest()[:16]`. The search route sets `event.within = req.within` and, when the layer's pin is `hpo-phenotype`, `candidate.role = classifier_of(ontology).role(candidate.term_id)`; the labels route fills `role`/`exclusive_class` the same way; tree routes fill `TreeNode.role`.

- [ ] Submit rules per C5: `project_rules.py` (`modifier_findings` parameter, `modifier_warnings`, `ModifierRoles` protocol); `submissions.py` builds `roles = term_roles(task_profile, self.repo.project_pins(key.project_key))`, `modifier_findings = frozenset(s.annotation.annotation_id for s in deduped_snaps if roles.kind(s.annotation.layer_id, s.annotation.term_id) is not None)` and passes it to the blocking `rule_violations` call; the warnings list as in C5. `validate_draft_terms` also validates modifier terms (unknown/obsolete modifier → the same error codes as findings, message names the modifier).
- [ ] Contract: `uv run python scripts/export_openapi.py`, `npm --prefix frontend run api:generate`; `client.ts` payload types and aliases (C3); fix typecheck fallout (rule 8).
- [ ] Browser scenario `tests/browser_modifier_scenarios.py` (pattern of `tests/browser_values_scenarios.py`, but `MOD_PIN` from `tests/modifier_fixtures.py`; the scenario stores `hp-modifiers.json` and `hp-de.modifiers.babelon.tsv` through the real `OntologyStore`, not through `/__test_ontology__`, whose allow-list stays `hp.json`/`mondo.json`), registered in `tests/browser_server.py` (next to `register_values_scenario_route` ~`:1420`); `tests/test_browser_modifier_fixture.py`. The extra German file binds to the `hp` prefix, so it is also offered next to `hp.json` in the same server run: check that `values-block.spec.ts annotation-loop.spec.ts` stay green when run in one Playwright batch **after** a spec that builds the modifier scenario (port 18774); if they do not, store the scenario's files in their own data directory and report.
- [ ] Green; gate (backend lock) with all owned paths; also `uv run pytest tests/test_editing.py tests/test_layered_editing.py tests/test_search_auto.py tests/test_reanchor*.py tests/test_t1_*.py` under the lock. Commits: `test(modifiers): pin existing hashes, digests and search seeds`, `feat(annotations): finding modifiers in the data model`, `feat(ontology): modifier classifier and subtree search`, `feat(editing): modifier commands and refusals`, `feat(submit): modifier rules and warnings`, `test(modifiers): exports keep an open key set`, `test(browser): modifier editor scenario`.

**Acceptance:** golden versions, acknowledgement digest and seeds unchanged (pasted literals); every refusal code tested; exports checked for an open key set; contract regenerated; no migration.

### E1 — Frontend pure helpers, modifier marks, final panel copy (incl. M6)

**Goal:** spec "Display (M4)" (marks layer only), "Attach to finding" steps 3 (pure ranking), "Consolidation > Frontend" U-rule (pure), "Final panel copy" (WP M6); contracts C9–C11. No contract change; uses local input types. **Size M. Review: no.**

**Owns:** `frontend/src/editor/modifiers.ts` (new), `frontend/src/consolidation/modifierSets.ts` (new), `frontend/src/spans/adapter.ts`, `frontend/src/vendor/spans.js`, `frontend/src/editor/TextPane.tsx`, `frontend/src/editor/markColours.ts` (doc comment only), `frontend/src/styles/screens/editor.css`, `frontend/src/documents/finalPanelText.ts`, `DESIGN.md` ("Mark states" table), tests: `frontend/tests/editorModifiers.test.ts` (new), `frontend/tests/consolidation/modifierSets.test.ts` (new), `frontend/tests/textPaneMarkers.test.tsx`, `frontend/tests/tokens.test.ts`, `frontend/tests/documents/finalPanel.test.tsx` (no test asserts `AGREEMENT_EXPLANATION` on 2026-10-25; add the assertion there, the file already imports `finalPanelText`). The explanation is rendered in `documents/FinalPanel.tsx` (~`:435`, "How is this counted?"; `DecisionBlock` is used by `admin/DocumentsPage.tsx` ~`:608`).

**Tests to add:**

- `editorModifiers.test.ts`: `sentenceBounds` — mid sentence, first and last sentence, "Dr. med." is a boundary only when followed by whitespace (document the limitation in the test name), `!`/`?`, line break, text with an emoji before the offset (code points); `attachCandidates` — same-sentence filter, distance ordering, tie → the finding after the mark ("schwere" between "Krampfanfälle" after and an equally distant one before), overlap distance 0, spanless findings excluded; `chipText` ("Severe · “schwere”", "Recurrent", "Frequent · “oft” · Cohort term"); `exclusiveWarnings` (["Two severities"], ["Two severities", "Two onsets"], []); `sortByLabel`; `modifierDisplayId`/`parseModifierDisplayId` round trip incl. a term id with ":"; `modifierMarks` (kind `modifier`, finding's `colorIndex`, label "Severe, modifier of Seizure", spanless modifiers produce no mark); `findingDescription` ("Seizure, modifiers: Severe (“schwere”), Recurrent").
- `consolidation/modifierSets.test.ts`: S3 (two options, no union), S4 (union "Both: Recurrent “wiederholt”, Severe “schwere”" per D-d), S5, S6 (no union; `setText` with `noTextTerms` gives "Severe (no text)"), S7 (no union), S8 (union offered, one conflict "Text of Severe" with two options; `resolveUnion` with Ana's pick → Recurrent + Severe “schwere”), S12/S16 ("All: Mild, Recurrent, Severe" with warning "Two severities"), S15 (option of Ana and Ben has majority "(2 of 3)", no preselection field), S17 (cohort label "Frequent · Cohort term · Ana Weber"), `crossLinks` S9 ("Ben Roth linked “schwere” (Severe) to Hypotonia." data for the Seizure group and the reverse).
- `textPaneMarkers.test.tsx`: a `kind: "modifier"` mention renders runs with `run--modifier` and its `colorIndex` slot, `title` = label, not focusable, no resize handles; `framedIds` adds `run--framed` to exactly those runs and removes it on change; hovering a run calls `onHoverMentions` with its ids and `[]` on leave; a click on a modifier run calls `onPick` with the modifier display id.
- `tokens.test.ts`: the `.run--modifier` rule uses `--mark-line` and `text-decoration-style: double` (or a double box-shadow: whatever E1 uses, asserted), `.run--framed` uses `--mark-selected` via box shadow and no padding/margin; forced-colours block maps them to `CanvasText` / `Highlight`.
- Final panel copy test: `AGREEMENT_EXPLANATION` ends with "Modifier text spans do not count here. “All findings match” also needs the same text spans, notes and modifier text spans."

**Steps:**

- [ ] Red, then `editor/modifiers.ts` per C10:

  ```ts
  export function sentenceBounds(
    text: string,
    offset: number,
  ): [number, number] {
    const chars = Array.from(text);
    const at = Math.max(0, Math.min(offset, chars.length));
    const isBreak = (i: number) => chars[i] === "\n" || chars[i] === "\r";
    const ends = (i: number) =>
      /[.!?]/.test(chars[i]) &&
      (i + 1 >= chars.length || /\s/.test(chars[i + 1]));
    let start = 0;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (isBreak(i) || ends(i)) {
        start = i + 1;
        break;
      }
    }
    let end = chars.length;
    for (let i = at; i < chars.length; i += 1) {
      if (isBreak(i)) {
        end = i;
        break;
      }
      if (ends(i)) {
        end = i + 1;
        break;
      }
    }
    return [start, end];
  }

  export function attachCandidates(
    text: string,
    mark: Seg,
    findings: readonly AttachFinding[],
  ): AttachCandidate[] {
    const [from, to] = sentenceBounds(text, mark.start);
    const gap = (s: Seg) =>
      s.start >= mark.end
        ? s.start - mark.end
        : mark.start >= s.end
          ? mark.start - s.end
          : 0;
    return findings
      .map((finding, index) => {
        const inside = finding.segments.filter(
          (s) => s.start < to && s.end > from,
        );
        if (!inside.length) return null;
        const nearest = inside.reduce((best, s) =>
          gap(s) < gap(best) ? s : best,
        );
        return {
          ...finding,
          distance: gap(nearest),
          after: nearest.start >= mark.end,
          index,
        };
      })
      .filter((c): c is AttachCandidate & { index: number } => c !== null)
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          Number(b.after) - Number(a.after) ||
          a.index - b.index,
      )
      .map(({ index: _index, ...candidate }) => candidate);
  }
  ```

- [ ] `consolidation/modifierSets.ts` per C11 (pure; the union enumeration over conflict resolutions is bounded by ≤ 4 people per term).
- [ ] Marks per C9: vendor — `kind === "modifier"` runs get `run--modifier`, `title` from the mention's label (`label` already flows through `mentionsToVendor`; pass it on), are skipped by the resize-handle and keyboard-mark logic, and `setFramed(ids)` toggles `run--framed` on runs that contain any of the ids (same loop pattern as `run--hot`); adapter — `setFramed`, `onHoverMentions` wiring into the existing vendor `_onHover`; TextPane — `framedIds`, `onHoverMentions` props (effect on `framedIds` like `selectedEvidenceId`). `editor.css` (outside the Values block markers):

  ```css
  .run--modifier {
    text-decoration-line: underline;
    text-decoration-style: double;
    text-decoration-thickness: 1px;
    text-decoration-color: var(--mark-line);
    text-underline-offset: 3px;
  }
  .run--framed {
    box-shadow: 0 0 0 2px var(--mark-selected);
  }
  @media (forced-colors: active) {
    .run--modifier {
      text-decoration-color: CanvasText;
    }
    .run--framed {
      box-shadow: none;
      outline: 2px solid Highlight;
    }
  }
  @media (prefers-reduced-motion: no-preference) {
    .run--framed {
      transition: box-shadow 120ms ease-out;
    }
  }
  ```

  (Check how `run--target`/`run--source` draw their lines and follow the same technique if they use box shadows; `run--multi` keeps its rule.) These classes are for the editor text pane only: the consolidation text pane (`consolidation/TextPane.tsx`) draws person lanes as stacked background lines whose line styles are solid / dashed / dotted / **double** (lane 4), so a double underline cannot mark modifiers there (DN-7, M5).

- [ ] `markColours.ts`: doc comment: a modifier segment takes its finding's slot. DESIGN.md "Mark states" table: new row "Modifier of a finding | `run--modifier`: 1 px double underline in `mark-line`, fill of its finding's term slot; not a tab stop; title "Severe, modifier of Seizure"" and "Framed (hover / focus / selected finding) | `run--framed`: 2 px `mark-selected` box shadow, no layout shift; `Highlight` outline in forced colours".
- [ ] `finalPanelText.ts`: append the sentence (verbatim from the spec) to `AGREEMENT_EXPLANATION`.
- [ ] Green; gate with the owned paths; `npm --prefix frontend run test -- textPane spans` for siblings' renders. Browser: `spans.spec.ts spans-resize.spec.ts annotation-loop.spec.ts` (port 18775) must stay green (no modifier data yet). Commits `feat(editor): modifier helpers and marks`, `feat(consolidation): modifier set options`, `docs(final): modifier text spans in the agreement explanation`.

**Acceptance:** pure tests cover sentence rules, ranking, U-rule (S3–S8, S12, S15–S17), cross links; marks render without changing existing mark tests.

### M2 — Grouping inputs, consolidation read and resolve, W1, contract

**Goal:** spec "Agreement and grouping" (`finding_of`, W1), "Consolidation > Backend", S1–S23 backend behaviour, R5–R8; contract C8. **Size L. Review: yes (L, contract; the reviewer also covers G1's diff).** Contract owner of wave 3.

**Owns:** `src/ontocurator/domain/review.py`, `src/ontocurator/application/document_row_panel.py`, `src/ontocurator/application/consolidation.py`, `src/ontocurator/application/consolidation_resolve.py`, `src/ontocurator/application/document_row_submissions.py` (only if a signature changes), `src/ontocurator/application/document_rows.py` (conditional: only its `consolidation_progress(` call ~`:1021`, which then passes the draft's annotations), `src/ontocurator/api/consolidation_routes.py`, `src/ontocurator/domain/agreement.py` (conditional: fixes), `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts`, `frontend/tests/consolidation/fixtures.ts` (conditional: typecheck), `tests/browser_consolidation_scenarios.py`, `tests/test_browser_consolidation_fixture.py`, tests: `tests/test_consolidation_modifiers_read.py` (new), `tests/test_consolidation_modifiers_resolve.py` (new), `tests/test_final_panel_modifiers.py` (new), `tests/test_consolidation_auto_take_over.py`, `tests/test_review_consolidation_mark.py`.

**Tests that break:** none by design; `tests/test_review_consolidation_mark.py` decision-hash tests must stay unchanged (add a case that `attached_to=None` is not dumped).

**Characterization first (before any change, green on the unchanged code, committed as `test(consolidation): pin content and decision hashes`):** in `tests/test_review_consolidation_mark.py` pin one `consolidated_content_sha256(annotation)` of a fixed `cons-…` annotation without modifiers and one decision hash (the hash the decision record stores for a `ConsolidationMark` without `attached_to`) as **pasted literals**; the fixed profile writes its own axes out (never `STANDARD_CLINICAL_AXES`). These literals must still hold after M2.

**Tests to add (PostgreSQL; build rounds with the helpers of `tests/test_consolidation_resolve_api.py` / `test_consolidation_read_api.py`; text and terms of the spec scenarios; project from `modifier_fixtures.create_modifier_project` (`MOD_PIN`, `hpo-phenotype`)):**

- `test_consolidation_modifiers_read.py`: `modifier_layer_ids` on the view; member `modifiers` with `term_label`, `kind` (Frequent → `cohort`), `exclusive_class`, `segments`; `_added` findings carry modifiers; group `modifier_majority` for S15, `None` for S16; kinds per S1, S3, S9, S18 (`modifier_as_finding`, `partial`) through the API; standalone findings are flagged only on `hpo-phenotype` layers.
- `test_consolidation_modifiers_resolve.py`: S3 choose with explicit `modifiers` (Ben's set) → `cons-…` has them; omitted `modifiers` → the span member's (S10: B's span with A's modifiers sent explicitly); S4/S8 union list sent by the client stored as given (sorted, one Severe); "Edit values…" may add a modifier nobody had; refusals in `choice.modifiers`: `MODIFIER_NOT_ALLOWED`, `DUPLICATE_MODIFIER`, `UNKNOWN_TERM`; `choice.term_id` a modifier term → `MODIFIER_AS_FINDING`; `keep` keeps the member's modifiers; S11 `choose` with term Focal-onset seizure and A's modifier set sent explicitly → one `cons-…` finding with that term and `{Severe “schwere”}` (modifiers come from the list, not from the term's member); S12 `choose` with term Seizure and C's `{Mild}` → `{Mild}`; `keep_both` and `term_choices` stay refused (existing tests, `consolidation_resolve.py` ~`:467-470`; no new case); `leave_out` none; S18 `attach_to`: target gains Severe with A's segments, target decisions' `content_sha256` updated (group does not read edited), mark `attached_to`; target already has Severe with another span → `DUPLICATE_MODIFIER`; `attach_to` on a non-`modifier_as_finding` group → `INVALID_RESOLUTION`; S21 reopen of the S18 group removes the attached modifier when unchanged; reopen of the target group drops it and S18's group reads open (`state == "open"`, counted by `open_group_count`, submit gated); S22 editor edit of a `cons-…` annotation's modifiers reads `edited` and stays resolved.
- `test_consolidation_auto_take_over.py`: S1 identical sets with segments → `auto`; S17 variant (A, B both `{Frequent}`) → `auto` (the cohort warning never blocks a match) and the kept annotation carries Frequent; S6, S20 → not taken over; S19 → not taken over.
- `test_final_panel_modifiers.py`: `all_match` false for S3, S6, S18; true for S1, S2; `compare` counts for S6 (match) and S11 (two only-here).
- `tests/test_browser_consolidation_fixture.py`: the `modifiers` scenario builds with the kinds listed below.

**Steps:**

- [ ] Red.
- [ ] `review.py`: `ConsolidationMark.attached_to` (C1).
- [ ] `document_row_panel.py`: `finding_of(..., roles: ModifierRoles = NO_TERM_ROLES)` fills

  ```python
  modifiers=frozenset(m.term_id for m in annotation.modifiers),
  modifier_spans=tuple(
      sorted(
          (m.term_id, tuple(sorted((s.start, s.end) for s in m.segments)))
          for m in annotation.modifiers
      )
  ),
  standalone_modifier=roles.kind(annotation.layer_id, annotation.term_id) is not None,
  ```

  `findings_of(..., roles=…)`; new `project_roles(conn, pid, profile) -> TermRoles` (`term_roles(profile, Repository._pins(conn, pid))`). Pass real roles at every production call site: `consolidation.py` ~`:196` (`round_members`), ~`:398` (`_added`), `document_row_panel.py` ~`:286`, ~`:315` (`_all_match` ~`:290` and the compare counts; `grep -rn "finding_of(\|findings_of(\|round_members(" src`: `round_members` is also called by `consolidation_progress`, `consolidation_resolve.py` ~`:274`, ~`:658`, ~`:691` and `document_row_submissions.py` ~`:111`, so `round_members` computes `project_roles(conn, pid, profile)` itself and its callers stay unchanged); the default exists only for pure tests. Update the `findings_of` docstring ("modifiers are not part of the annotation model" is obsolete).

- [ ] `consolidation.py`: member payload `modifiers` (labels filled by the route like `term_label`, ~`consolidation_routes.py:127`), `kind`/`exclusive_class` from the roles; group `modifier_majority`; `is_open(targets, decisions, annotations=None)` (~`:241`): a `leave_out` decision with `consolidation.attached_to` whose target annotation is missing from `annotations` or lacks the attached term → open; pass the draft's annotations from `consolidation_progress` (~`:254`; it now backs `open_group_count`, the submit gating and the text card's "consolidating (n of m groups open)"), `_state` (~`:552`) and every other `is_open` caller (`grep -rn "is_open(" src`).
- [ ] `consolidation_resolve.py`: `ModifierIn`, `ResolveChoice.modifiers`, `ResolveCommand.attach_to` (C8); in `choose`, `annotation.model_copy(update={"modifiers": final})` where `final` = explicit list validated with the round's `TermRoles` and `self.valid_term` (canonical id or `UNKNOWN_TERM`; `kind is None` → `MODIFIER_NOT_ALLOWED`; repeated → `DUPLICATE_MODIFIER`; layer not supported → `MODIFIERS_NOT_SUPPORTED`), else the span member's modifiers; `choice.term_id` with `kind is not None` → `MODIFIER_AS_FINDING`. `leave_out` + `attach_to`: find the target `cons-…` snapshot in the draft (else `INVALID_RESOLUTION`), add `Modifier(term_id=standalone.term_id, segments=<first mention segments of the standalone member>)` (link when the term is there without segments; same segments → no-op; other segments → `DUPLICATE_MODIFIER`), re-snapshot the target, repoint the target group's decisions to the new version and set their mark's `content_sha256` to `consolidated_content_sha256(new.annotation)`; the S18 group's decisions get `ConsolidationMark(action="leave_out", attached_to=target_id)`. Reopen of a group with `attached_to`: remove the modifier from the target if the target still has exactly that term and segments, then update the target marks' hash again. `take_over_matches` needs no change (kinds already exclude differences); test it.
- [ ] Routes and contract (C8); `client.ts`; typecheck fallout in `frontend/tests/consolidation/fixtures.ts` (`modifiers: []`, `modifier_majority: null`).
- [ ] Browser scenario `modifiers` in `tests/browser_consolidation_scenarios.py` (`POST /__test_consolidation__` today takes `started` and `people` (2–3, ~`:191`); add the query parameter `scenario=modifiers`; default unchanged; project pinned with `MOD_PIN`, ontology stored from `MOD_PATH`), two annotators A, B, English text, for example "Recurrent focal seizures. Severe seizures and hypotonia since birth. Bilateral hearing loss. Reduced reflexes.": S4 on "focal seizures" (Focal-onset seizure HP:0007359, A `{Recurrent “Recurrent”}`, B `{Severe}`); S9 on "seizures"/"hypotonia" of the second sentence (A Seizure `{Severe “Severe”}`, Hypotonia `{}`; B the reverse); S1 on "hearing loss" (HP:0000407, both `{Bilateral “Bilateral”}`); S13 on "Reduced reflexes" (HP:0001284, A only, `{Bilateral}`). Expected kinds asserted in the fixture test: S1 `match` (auto), S4 and both S9 groups `modifiers_differ`, S13 `partial`.
- [ ] Green; gate (backend lock); also `uv run pytest tests/test_consolidation_*.py tests/test_document_rows_submissions.py tests/test_agreement_*.py` under the lock. Commits `test(consolidation): pin content and decision hashes` (first), `feat(consolidation): modifiers in grouping and the read view`, `feat(consolidation): resolve modifiers and attach standalone modifiers`, `test(browser): consolidation modifier scenario`.

**Acceptance:** S1–S22 backend tests green (S17 auto-keep included); W1 false whenever modifiers or their segments differ; the pinned content-hash and decision-hash literals unchanged.

### M3 — T1 import and export of modifiers, Phenopacket check

**Goal:** spec "Import and export", M6, R10 and R12 report counts; S23. **Size M. Review: no (final branch review).** Needs the ontospan 1.2.1 pin (main session, between waves 1 and 2).

**Owns:** `src/ontocurator/exchange/t1.py`, `src/ontocurator/exchange/jobs.py`, `tests/test_t1_modifiers.py` (new), `tests/test_t1_import.py`, `tests/test_t1_export.py`, `tests/t1_builders.py` (conditional).

**Tests that break:** the import test that expects `T1_UNSUPPORTED` for modifiers (`grep -n "T1_UNSUPPORTED" tests/test_t1_*.py`): it now expects acceptance on `hpo-phenotype` layers and `T1_UNSUPPORTED` on `generic` layers.

**Tests to add (`tests/test_t1_modifiers.py`, PostgreSQL where jobs run; projects and units on `MOD_PIN` / `MOD_PATH`, never the shared `t1_fixtures.PIN`):**

- import: proposals keep `Modifier(term_id, segments)` (offsets only) on an `hpo-phenotype` layer; a modifier on a `generic` layer → `T1_UNSUPPORTED` `{annotations: [...]}`; a standalone modifier annotation → `T1_INVALID` with ontospan `modifier_as_annotation`; `not_a_modifier` → `T1_INVALID`; duplicate modifier → `T1_INVALID` with `duplicate_modifier`; Frequent and Mild + Severe accepted with `cohort_frequency` / `exclusive_modifier_class` in the import report's warnings; `family_member` experiencer accepted where the profile has it, `T1_UNKNOWN_AXIS_VALUE` where it does not.
- export: S23 — a consolidated finding `{Recurrent, Severe “schwere”}` exports `modifiers: [{term_id: "HP:0012828", segments: [{start, end, text: "schwere"}]}, {term_id: "HP:0031796"}]` with provenance `merged`; Frequent and two severities appear as job warnings and report counts; export → import round trip keeps modifiers and segments.
- Phenopacket: `ontospan.to_phenopacket(unit, ontology)` on an exported unit maps Severe to `severity`, a second severity (Mild) into `modifiers[]`, Neonatal onset to `onset.ontologyClass`, Frequent into `modifiers[]` with `report.frequency_modifiers == 1`; a `family_member` finding is omitted (`report.omitted_family == 1`).

**Steps:**

- [ ] Red.
- [ ] `t1.py`: `_refuse_unrepresentable` (~`:326-337`) refuses modifiers only on layers whose T1 profile is not `hpo-phenotype`; `unit_to_proposals` (~`:393`) maps `item.modifiers` to `Modifier(term_id=m.term_id, segments=_segments(m.segments))`; the export (`ontospan.Annotation(` ~`:732`) passes `modifiers=tuple(ontospan.Modifier(term_id=m.term_id, segments=tuple(<ontospan.Segment with text from the document text>)) for m in snap.annotation.modifiers)` (reuse the segment-with-text builder of `_mentions` ~`:518`). Imported proposals with modifiers are what "Annotate from proposals" works through; nothing else in the proposal-check path changes (the per-proposal decision export `exchange/proposal_checks.py` carries refs and outcomes only).
- [ ] `jobs.py`: `_warnings` (~`:111`) returns the sorted set of warning codes only (verified 2026-10-25: no counts); add per-code counts to the import and export job results (`warning_counts: {code: n}`) next to the existing `warnings` list; `_validate` (~`:115`) unchanged.
- [ ] Green; gate (backend lock). Commit `feat(t1): import and export finding modifiers`.

**Acceptance:** round trip keeps modifiers; Phenopacket mapping as specified; reports count cohort and exclusive-class warnings.

### M4 — Editor UI: Modifiers section, attach popover, search roles, link-a-span, marks wiring

**Goal:** spec "Editor" (Modifiers section, Attach to finding 1–8, Display M4 wiring), "Accessibility" (editor parts), acceptance bullets 1–3 and "Two severities" at the finding. The "Turn into modifier…" flow of R3 (convert mode, `convert_to_modifier`, the notice) is **M7**. **Size L. Review: yes.**

**Owns:** `frontend/src/editor/ModifiersSection.tsx` (new), `frontend/src/editor/AttachPopover.tsx` (new), `frontend/src/editor/useModifierCommands.ts` (new), `frontend/src/editor/modifiers.css` (new, imported by both components), `frontend/src/editor/AnnotationPanel.tsx`, `frontend/src/editor/SearchPanel.tsx`, `frontend/src/editor/searchState.ts`, `frontend/src/editor/TreeBrowser.tsx`, `frontend/src/editor/TermTree.tsx` (if node rendering lives there), `frontend/src/editor/FindingRow.tsx`, `frontend/src/editor/useTermLabels.ts`, `frontend/src/editor/ReviewActions.tsx` (DN-9, pending: read-only chips of a selected tool proposal), `frontend/src/app/CaseScreen.tsx`, `DESIGN.md` (editor rows), tests: `frontend/tests/modifiersSection.test.tsx` (new), `frontend/tests/attachPopover.test.tsx` (new), `frontend/tests/searchPanel.test.tsx`, `frontend/tests/treeBrowser.test.tsx`, `frontend/tests/findingRow.test.tsx`, `frontend/tests/caseScreen.test.tsx`, the `ReviewActions` Vitest file (`grep -rln "ReviewActions" frontend/tests`; DN-9), `frontend/tests/valuesBlock.test.tsx` (conditional), `frontend/browser/modifiers.spec.ts` (new). Conditional: `frontend/tests/annotationPanelStyles.test.ts` (only if a new allowed file must be listed). `frontend/src/ui/Popover.tsx` is **not** owned any more: it flips above its anchor and caps its height to the free space since `2cb72d43`.

Placement in the current editor (verified 2026-10-25, no decision needed): the inspector's `AnnotationPanel` still renders the Values section (`data-values-section`, `values-heading-row` ~`:310`) followed by "Mentions (n)" (~`:393`), so the Modifiers section goes between them as specified; the pending mark keeps its `PendingMarkBar` at the mark (`CaseScreen` ~`:3146`, it follows the mark when the pane moves, `b78942c9`) and its prefilled `SearchPanel` in the inspector (~`:3226-3233`), so the attach popover anchors at the mark as specified. In "Annotate from proposals" a selected tool proposal is shown by `ReviewActions` (~`:3265`), not by `AnnotationPanel`; see DN-9.

**Tests that break:** SearchPanel snapshot/row tests if a role tag appears for `finding` (it must not: tags only for `modifier`/`cohort`).

**Tests to add:**

- `modifiersSection.test.tsx`: `h3` "Modifiers" in `[data-modifiers-section]` under Values; `ul` labelled "Modifiers of Seizure"; chips "Severe · “schwere”", "Recurrent", Frequent chip with "Cohort term" text in `warning` style class; "Two severities" line for Mild + Severe; chip menu button "Actions, Severe" with "Link a text span…" (no span) / "Change text span…" (span), "Remove text span" (span only), "Remove modifier"; "+ Add modifier…" opens the search in modifier mode (label "Search modifier", placeholder "Severity, onset, pattern…", empty query, request `within: ["HP:0012823", "HP:0040279"]`); Enter adds (`add_modifier` without segments), focus returns to "+ Add modifier…", polite status "Added Severe to Seizure. Link a text span?" with action "Link a text span"; remove → Undo toast "Removed Severe from Seizure" and Ctrl+Z restores (`add_modifier` with the old segments); read-only shows chips without actions.
- `attachPopover.test.tsx` (behaviour per "Attach popover: keyboard, focus and layout" below): `role="dialog"` named "Attach Severe to a finding", non-modal; radio group "Finding" with options "Seizure · “Krampfanfälle”", nearest preselected and focused; Enter on a radio = Attach (`onAttach(annotationId)`), a click on Attach the same; Esc = Discard (`onDiscard`, consumed: a page-level Escape handler spy is not called); outside pointer down and Tab out past either end call `onDismiss` (not `onDiscard`); "Other finding…" is a button with `aria-expanded` false/true and `aria-controls` = the list id; expanding lists every finding (incl. spanless) with a labelled filter field "Filter findings" (`getByLabelText`); Enter in the filter field does not attach; none in the sentence → "No finding in this sentence.", "Other finding…" expanded, Attach `aria-disabled` with reason "Choose a finding first." (`aria-describedby`), Enter does nothing; no finding at all → "Severe is a modifier. Create the finding first, then add Severe under Modifiers." and only "OK" (= `onDismiss`); already has Severe without span → button "Link “schwere” to Severe"; with another span → line "Seizure already has Severe (“sehr schwere”). Attaching replaces its text span." and button "Replace text span"; at `(max-width: 699px)` (mock `matchMedia` like `frontend/tests/caseScreen.test.tsx` does) it renders the `ui-popover-sheet` dialog. No axe in Vitest (`vitest-axe` is not a dependency; verified): axe runs in `modifiers.spec.ts`.
- `searchPanel.test.tsx`: hits with `role: "modifier"` show the tag "Modifier", `cohort` "Cohort term" (text, not colour only); with `assignMode="change"` modifier hits are `aria-disabled` with "Modifier — add it under Modifiers instead." and Enter skips them; modifier mode passes `within` to the search request.
- `treeBrowser.test.tsx`: nodes with `role` `modifier` are `aria-disabled` for "Change term" with the same reason.
- `findingRow.test.tsx`: muted second line "Severe · Recurrent" (D-d order).
- `reviewActions.test.tsx` (DN-9, pending): a proposal with `[Severe “schwere”]` shows the read-only chip list "Modifiers of Seizure" without actions; a proposal without modifiers shows no Modifiers section.
- `caseScreen.test.tsx`: (1) new mark → Enter on a modifier hit opens the popover (no `create_annotation`) and `PendingMarkBar` is not rendered while it is open; Enter sends `add_modifier` with the mark segment to the preselected finding, the finding is selected, its new chip in the inspector's Modifiers section has focus, status "Attached Severe to Seizure"; (2) Esc or Discard in the popover drops the mark through `discardPending()` (text focus request at the mark's end offset, "Marked text discarded."); the pending `SearchPanel`'s `onEscape` is not called; (2b) outside click / Tab out closes the popover, keeps the pending mark, its search and its query, and `PendingMarkBar` returns; (3) link-a-span mode: status "Select the text for Severe, then press Enter. Esc cancels.", a selection sends `set_modifier_segments`, Esc returns focus to the chip; (4) hovering or focusing a finding row passes its mention and modifier display ids as `framedIds`; hovering a modifier run frames its finding; clicking a modifier run selects the finding and focuses the chip; (5) "Change term" never offers a modifier term.
- `browser/modifiers.spec.ts` (port 18775; scenario of M1 with `with_finding=1`): mark "schwere" with `selectText` → prefilled search shows Severe with "Modifier" → Enter → popover with Seizure preselected → Enter: two keys after marking; chip "Severe · “schwere”" focused; hover the Seizure mark → the "schwere" run has `run--framed`, no layout shift (bounding boxes of the text block unchanged); "+ Add modifier…" with "Frequent" shows "Cohort term"; Mild + Severe show "Two severities"; axe (`@axe-core/playwright`) on the open popover and the Modifiers section; Esc in the popover discards the mark and leaves focus in the text at the mark's end; at a 600 px wide viewport the popover is the `ui-popover-sheet` dialog and Enter still attaches. Evidence screenshot `modifiers-attach.png`.

**Attach popover: keyboard, focus and layout (binding for `AttachPopover.tsx` and its `CaseScreen` wiring):**

- **Base:** built on `ui/Popover` (`label` "Attach {term} to a finding", `closeOnTabOut`; non-modal anchored `role="dialog"` from 700 px; below 700 px `ui/Popover` itself renders the modal sheet `Dialog` with class `ui-popover-sheet`, so the narrow layout is the same sheet as every other `ui/Popover`). `anchorRef` points at the pending mark's last `.run` element (found like `PendingMarkBar.update` does, via `data-mentions` containing the pending evidence id). `ui/Popover` places below the anchor and flips above it when there is more room there (with a height cap), so no positioning by hand and no change to `ui/Popover`.
- **Esc owner:** the popover. All its controls live in `children` (no `footer`) inside one wrapper whose `onKeyDown` handles Escape first (`preventDefault`, `stopPropagation`, then `onDiscard`), so neither `ui/Popover`'s own Esc (which would only close) nor the pending `SearchPanel`'s `onEscape` nor page shortcuts run. Esc = Discard = AP's `discardPending()`.
- **PendingMarkBar:** not rendered while the popover is open (same anchor; its "Discard Esc" would duplicate the popover's); it returns when the popover closes without attaching or discarding.
- **Focus on open:** the preselected (nearest) radio; when no candidate is in the sentence, the filter field.
- **Focus after Attach:** the new modifier chip in the finding's inspector (`ModifiersSection`, `data-modifier-chip=<term id>`); if the inspector is not rendered, the text at the mark's end offset (`setTextFocusRequest({ offset: <mark end> })`). After Discard: the text at the mark's end offset (what `discardPending()` already does; this is "the text after the mark").
- **Outside click / Tab out** (`ui/Popover`'s `onClose`, mapped to `onDismiss`): close the popover, **keep** the pending mark, its prefilled search and query; focus is not moved on pointer down and moves on as usual on Tab. Enter on the modifier hit again reopens the popover.
- **Keys:** arrow keys move between radios (native group); **Enter on a radio = Attach** (explicit `onKeyDown`, not implicit form submission); Enter in the filter field = no-op; Enter on an `aria-disabled` Attach = no-op.
- **Names:** dialog name as above; radio group as `<fieldset>` with legend "Finding"; "Other finding…" button with `aria-expanded` + `aria-controls`; filter field with a visible label "Filter findings"; Attach's disabled reason via `aria-describedby`; result announced in the existing polite status region.

**Steps:**

- [ ] Red.
- [ ] `useTermLabels.ts`: keep `role` and `exclusive_class` of `TermLabel` and expose `termInfo(termId): TermInfo | undefined` (C10).
- [ ] `searchState.ts`: `SearchContext.within?: string[]`, sent in the request when set. `SearchPanel.tsx`: props `mode?: "finding" | "modifier"` (modifier: label "Search modifier", placeholder "Severity, onset, pattern…", `within = MODIFIER_ROOTS`, a frontend constant `["HP:0012823", "HP:0040279"]` exported from `editor/modifiers.ts`), `assignMode?: "new" | "change" | "modifier"`; role tags in `.candidate-header` (`<span className="candidate-role">Modifier</span>` / "Cohort term", tokens only, no `style`); in "change" mode a modifier hit is not usable (`isUsable` false, the reason line as text). New-mark mode keeps modifier hits usable but reports them through `onPickModifier(candidate)` instead of assigning.
- [ ] `ModifiersSection.tsx` (props: `finding`, `modifiers`, `text`, `termInfo`, `readOnly`, `onAdd(termId)`, `onLinkSpan?(termId)`, `onRemoveSpan?(termId)`, `onRemove(termId)`, `searchProps`; the span actions are hidden when their callback is absent and nothing depends on `CaseScreen` state, so M5 can render it in the consolidation "Edit values…" editor with `onAdd`/`onRemove` and the modifier search only. M5 cannot edit this file: the M4 review-fix pass checks these props against M5's needs (chips, "+ Add modifier…" with `within`, read-only) and adjusts them), using `chipText`, `exclusiveWarnings`, `sortByLabel`; menu via the existing `ui/MenuButton.tsx`. Rendered by `AnnotationPanel.tsx` between the Values block and "Mentions (n)" only when the finding's layer is in `view.modifier_layer_ids` (prop `modifiersSupported`).
- [ ] `AttachPopover.tsx` (props: `termLabel`, `markQuote`, `candidates: AttachCandidate[]`, `allFindings: AttachFinding[]`, `existing(annotationId) → { segmentsQuote: string | null } | undefined`, `anchorRef`, `onAttach(annotationId)`, `onDiscard()`, `onDismiss()`), per "Attach popover: keyboard, focus and layout" above. M7 adds the convert mode; keep the copy (title, primary label) in one place so a `mode` prop can switch it.
- [ ] `useModifierCommands.ts`: wraps `add_modifier`, `set_modifier_segments`, `remove_modifier` (M7 adds `convert_to_modifier`) through the existing command queue (same envelope helper as `set_axes`), the Undo toast, the link-a-span mode state (`{ annotationId, termId } | null`) and status texts.
- [ ] `CaseScreen.tsx` wiring: pending mark + modifier hit (`onPickModifier` on the pending `SearchPanel` ~`:3227-3233`) → popover with `attachCandidates(view.document.text, mark, ownEditableFindings)`; `PendingMarkBar` hidden while it is open; Attach → `add_modifier` then select the finding, focus its new chip; Esc/Discard → AP's `discardPending()`; dismiss → close only; selection callback while link-a-span mode is on → `set_modifier_segments` instead of a new mark; `mentionsDisplay` (~`:495`) gets `modifierMarks(...)` appended and the finding marks' `label` gets `findingDescription(...)`; `framedIds` from hovered/focused/selected finding (mention ids + its modifier display ids) and from a hovered modifier run (its finding's mention ids); `onPick` with a modifier display id selects the finding and focuses the chip; "Change term" `SearchPanel` gets `assignMode="change"`; `TreeBrowser` gets the same rule. (The R3 notice and convert flow are M7.)
- [ ] `ReviewActions.tsx` (DN-9, pending recommendation A): when the selected tool proposal has modifiers, render `ModifiersSection` read-only under its values list (`findingAxes` block ~`:204`), with the proposal's text for the quotes; nothing else in the proposal-check flow changes ("correct" adopts the proposal, M1 copies its modifiers).
- [ ] `FindingRow.tsx`: second line (muted) with the modifier labels.
- [ ] DESIGN.md: rows "Modifiers section (`editor/ModifiersSection.tsx`)" and "Attach popover (`editor/AttachPopover.tsx`)" with the spec copy, states, focus rules, forced colours; "Term search" row: role tags and disabled modifier hits in "Change term".
- [ ] Green (unit); browser batches under the lock (port 18775): `modifiers.spec.ts annotation-loop.spec.ts spans.spec.ts tree.spec.ts values-block.spec.ts editor-layout.spec.ts`, then `proposal-check.spec.ts spans-resize.spec.ts`.
- [ ] Commits `feat(editor): modifiers section`, `feat(editor): attach a modifier to a finding`, `feat(editor): modifier marks and hover framing`, `docs(design): modifier rows`. Gate.

**Acceptance:** spec acceptance bullets 1–3 (two keys after marking; "+ Add modifier…" only modifier subtrees with "Cohort term"; creating a finding with a modifier term impossible through the UI); "Two severities" at the finding; no layout shift on hover; the popover keyboard/focus rules covered by unit and browser tests, axe clean in the browser.

### M5 — Consolidation UI: Modifiers row, union, sub-rows, cross links, standalone card

**Goal:** spec "Consolidation > Frontend", S1–S23 UI behaviour, M5, M9, R12 option warning, acceptance "consolidator clicks" (S1, S4, S9 ×2, S13; count per DN-6); summary dialog warnings (D-f). Built on the comparison table of `ac8eccde` (one finding per group, ✓ per value in conflicting rows, the last missing choice resolves the group, result line always visible). The layout points not fixed by the spec follow DN-1…DN-8 (**pending**; the steps below use the recommendations). **Size L. Review: yes.**

**Owns:** `frontend/src/consolidation/groupModel.ts`, `ComparisonTable.tsx`, `ResultLine.tsx`, `GroupCard.tsx`, `consolidationText.ts`, `TextPane.tsx`, `lanes.ts`, `ConsolidationScreen.tsx`, `GroupList.tsx`, `SummaryDialog.tsx`, `useConsolidation.ts`, `TermPicker.tsx` (Edit values… modifier search), `consolidation.css`, `modifierSets.ts` (fixes only), `frontend/tests/consolidation/*` (incl. `comparisonTable.test.tsx`, `groupCard.test.tsx`, `model.test.ts`, `screen.test.tsx`, `lanes.test.ts`), `frontend/tests/consolidationEditor.test.tsx`, `frontend/tests/leadConsolidation.test.tsx`, `frontend/browser/consolidation-modifiers.spec.ts` (new), `frontend/browser/consolidation.spec.ts`, `consolidation-three.spec.ts` and `consolidation-a11y.spec.ts` (conditional), `DESIGN.md` (consolidation rows).

**Tests to add:**

- `tests/consolidation/model.test.ts` (`groupModel.ts`): `comparisonRows` adds a row `kind: "modifiers"`, id `modifiers`, label "Modifiers", after "Text" and before "Note", only when a member has modifiers; cell display = `setText` ("Severe “schwere”, Recurrent", "None", S6 "Severe (no text)"); `conflict` = `modifiers_differ` (DN-4 A), else one agreed line "Severe “schwere” (all agree)"; the cell value is the member's `setKey`; DN-3 A: the cells whose set equals `modifier_majority` carry "(2 of 3)" (S15), never a preselection; DN-1 A: the row offers the union control "Both: …" / "All: …" only under the U-rule (S4, S8, S12, S16 yes; S3, S5, S6, S7, S15 no) with the warning "Two severities" / "Two onsets" (S12, S16) and per cell for a person's set that has two of one kind; DN-2 A: after the union is taken, one conflict row per conflicting term, id `modifier-text:<term>`, label "Text of Severe", cells of the holders with their segment text, "—" for the others; `choicesComplete` then needs those rows too; `takeFinding` also takes the member's modifier set; `resultLine` (DN-5 A) appends "modifiers: Severe “schwere”, Recurrent" / "no modifiers" / "modifiers not chosen yet"; `resolvePayload` sends `choice.modifiers` with every `choose` when a Modifiers row exists (the chosen set, the resolved union, or the base member's set when the row is not a conflict), segments as `{start, end}`; a no-conflict `keep` stays `keep` (the server keeps the member's modifiers); S11/S12 (term differs): the Modifiers row compares **all** members and is decided independently of the term row (one finding per group, no keep-both).
- `tests/consolidation/comparisonTable.test.tsx`: the Modifiers row renders cells, ✓ buttons named with `optionLabel` ("Take Severe “schwere” from Ana Weber for Modifiers"), the union control (DN-1 A) with `aria-pressed`, "Cohort term" in words, and the "Text of Severe" sub-row; read-only shows values only.
- `tests/consolidation/groupCard.test.tsx`: the last ✓ (incl. a sub-row) resolves the group with `choice.modifiers`; "Edit values…" (no-conflict groups) shows the Modifiers section (M4's `ModifiersSection` with `onAdd`/`onRemove` and the modifier search) and "Keep with these values" sends the edited list; DN-8 B: an S18 group (`modifier_as_finding`) shows "Ana Weber marked a modifier as a finding. Severe can only describe another finding." and only "Attach to a finding…" and "Leave out" (no Keep, Edit values… or Other term…); attach lists the resolved findings of the round in the same sentence, nearest first (`attachCandidates`), and sends `leave_out` with `attach_to`.
- `tests/consolidation/screen.test.tsx`: cross-link hint "Ben Roth linked “schwere” (Severe) to Hypotonia." under the Modifiers row is a link that selects that group; text pane draws members' modifier segments per DN-7 A (the person's lane line, accessible text "Severe, modifier of Seizure (Ana Weber)") and frames them for the selected group; `SummaryDialog` with modifier warnings shows the D-f line and checkbox label; **S21:** after a modifier choice the Undo toast and Ctrl+Z send the reopen, the `cons-…` annotation with its modifiers is gone from the next view, the group is open again with its ✓ cleared (no preselection); "Change" on a resolved group does the same; reopening an S18 attach (fixture with `attached_to`) sends the reopen and the target's chip list no longer shows the attached modifier.
- `tests/consolidation/lanes.test.ts` (only if `lanes.ts` changes for DN-7).
- `browser/consolidation-modifiers.spec.ts` (port 18774; M2's `modifiers` scenario): open → S1 agreed automatically → S4: take the union "Both: …" → S9 Seizure: ✓ Ana's set → S9 Hypotonia: ✓ Ben's set (hint visible and linked) → S13 "Keep Ana Weber's finding" → "Submit consolidation" → the summary dialog's "Submit"; the next open group is selected automatically after each resolve (`ConsolidationScreen` `resolve`), so no expand clicks. Assert the click count of DN-6 (recommendation A: 6 = 4 group decisions + "Submit consolidation" + the dialog's "Submit"; count every `click()`/key activation in the spec). If the count differs from the user's answer, do **not** weaken the assertion or change the flow: stop and report. Axe on a group card with a Modifiers row. Evidence `consolidation-modifiers.png`.

**Steps:**

- [ ] Red; implement with `modifierSets.ts` (E1) mapped from `ConsolidationMemberView.modifiers` (`MemberSet.personName` from `lanes.personName`); `RowKind` gains `"modifiers" | "modifier-text"`; `useConsolidation.axisWarningOf` keeps rule counts (`axis` vs modifier rules) for the summary dialog.
- [ ] DESIGN.md "Consolidation view" rows: Modifiers row (cells, union control, majority label), "Text of …" sub-row, result-line modifiers part, cross-link hint, standalone card, lanes.
- [ ] Green; browser (port 18774): `consolidation-modifiers.spec.ts consolidation.spec.ts consolidation-three.spec.ts consolidation-a11y.spec.ts final-workflow.spec.ts`. Commits `feat(consolidation): modifiers row and union`, `feat(consolidation): attach a standalone modifier`, `docs(design): consolidation modifier rows`. Gate.

**Acceptance:** scenario UI behaviour per S1–S22 (S21 undo/reopen included); no computed majority set; one finding per group throughout; the click count of DN-6 (or the user's answer recorded by the main session).

### M7 — Submit check (modifier open items and warnings) and “Turn into modifier…”

**Goal:** spec "Open items (submit check)", R3 (blocking item and the "Turn into modifier…" convert flow, moved here from M4), R10, R12 (warnings in the submit list), acceptance "A finding with Mild and Severe … submit is not blocked"; D-f copy. **Size L. Review: yes.**

**Owns:** `frontend/src/editor/openItems.ts`, `frontend/src/editor/SubmitCaseDialog.tsx`, `frontend/src/editor/UnconfirmedValuesSection.tsx` (only if the acknowledgement block moves), `frontend/src/editor/ModifierWarningsSection.tsx` (new), `frontend/src/editor/unconfirmedValues.ts`, `frontend/src/editor/submitDialog.css`, `frontend/src/app/CaseScreen.tsx`, `frontend/src/editor/AttachPopover.tsx` (convert mode only), `frontend/src/editor/useModifierCommands.ts` (`convert_to_modifier` only), `frontend/src/editor/ModifierAsFindingNotice.tsx` (new), `frontend/src/editor/AnnotationPanel.tsx` (only the slot that renders the notice above the Values block), tests: `frontend/tests/openItems.test.ts`, `frontend/tests/submitDialog.test.tsx`, `frontend/tests/unconfirmedValues.test.ts`, `frontend/tests/caseScreen.test.tsx`, `frontend/tests/attachPopover.test.tsx`, `frontend/tests/modifierAsFindingNotice.test.tsx` (new), `frontend/browser/modifier-submit.spec.ts` (new), `frontend/browser/modifier-convert.spec.ts` (new).

**Tests to add:**

- `openItems.test.ts`: kinds `modifier-as-finding` (blocking, line "Severe is a modifier. Turn it into a modifier of another finding.", focus `[data-turn-into-modifier]`), `cohort-modifier` (warning, line "Frequent is a cohort term."), `exclusive-modifiers` (warning, line "Two severities: Mild, Severe."); `summaryLine` phrases "1 finding uses a modifier term" / "1 finding has a cohort term as modifier" / "1 finding has two modifiers of one kind"; `submitBlockedReason` "Turn 1 modifier used as a finding into a modifier before submitting." (plural "Turn 2 modifiers used as findings into modifiers before submitting."), before the values reason.
- `submitDialog.test.tsx`: section `h3` "Modifier warnings · {m}" (after `UnconfirmedValuesSection`, before the acknowledgement block `submit-ack` ~`SubmitCaseDialog.tsx:144`) listing rows "{term}: {line}" with "Go to {term}"; the warning kinds are listed there, not in the generic list (add them to `DIALOG_HIDDEN_KINDS`, `openItems.ts` ~`:94`); the acknowledgement checkbox label per D-f (today `Submit with ${n} unconfirmed values`); blocked reason with that label; the blocking item listed in the generic list with "Go to".
- `unconfirmedValues.test.ts` / `caseScreen.test.tsx`: `submissionAxisWarning` (`CaseScreen` ~`:150`) keeps every warning as a key: axis warnings as today (`pairKey(annotationId, axisId)`, `unconfirmedValues.ts` ~`:45`), modifier warnings as `pairKey(annotationId, "cohort:<term>")` / `pairKey(annotationId, "exclusive:<class>")`; the D1 single resend compares the full set (axis rows + client-computed modifier warnings); a server warning set with an extra modifier pair does not resend and shows "The unconfirmed values changed. Check the list again."; submit with only modifier warnings and the box ticked submits with the acknowledgement (two requests, one user action).
- `browser/modifier-submit.spec.ts` (port 18775; M1 scenario): Mild + Severe on Seizure → Submit lists "Two severities" → tick the box → submitted; Frequent → "Cohort term as modifier" listed; standalone scenario: Submit blocked with the reason, "Go to Severe" focuses "Turn into modifier…".
- `attachPopover.test.tsx` (convert mode, R3): title "Turn Severe into a modifier", primary "Turn into modifier", the source finding excluded from the options; Esc/outside click close without converting (the standalone finding stays); every keyboard/focus rule of M4's "Attach popover: keyboard, focus and layout" holds in this mode too, except that Esc only closes (there is no pending mark to discard) and focus returns to "Turn into modifier…".
- `modifierAsFindingNotice.test.tsx`: for a snapshot whose `termInfo(term).role !== "finding"` the notice "Severe is a modifier. Turn it into a modifier of another finding." with the button "Turn into modifier…" (`data-turn-into-modifier`); none for findings; read-only shows the text without the button.
- `caseScreen.test.tsx` (moved from M4): the notice's "Turn into modifier…" opens the popover in convert mode anchored at the button; Enter sends `convert_to_modifier` with `link_span: true` to the preselected finding; afterwards the target finding is selected and its new chip focused; status "Turned Severe into a modifier of Seizure".
- `browser/modifier-convert.spec.ts` (port 18775; M1 scenario `standalone=1`): "Turn into modifier…" flow end to end (the standalone finding disappears, Seizure shows "Severe · “schwere”"), axe on the convert popover.

**Steps:**

- [ ] Red; implement; client-side warnings computed from the draft with `termInfo` (`kind`, `exclusive_class`) so the set matches the server's `cohort_modifier` / `exclusive_modifier_class` warnings.
- [ ] Convert flow: `AttachPopover` gets `mode: "attach" | "convert"` (copy switch, source excluded); `useModifierCommands` gets `convert(sourceId, targetId, linkSpan)`; `ModifierAsFindingNotice.tsx` renders in the `AnnotationPanel` slot for snapshots whose `termInfo(term).role !== "finding"`; `CaseScreen` opens the popover in convert mode and wires the open item's focus target `[data-turn-into-modifier]`.
- [ ] Hand back the final copy and DOM facts for DESIGN.md (the M5 review-fix agent writes the rows "Submit dialog: modifier warnings" and "Turn into modifier (convert popover, notice)").
- [ ] Green; browser (port 18775): `modifier-submit.spec.ts modifier-convert.spec.ts modifiers.spec.ts submit-unconfirmed.spec.ts decision-semantics.spec.ts`. Commits `feat(submit): modifier warnings and the modifier-as-finding item`, `feat(editor): turn a standalone modifier into a modifier`. Gate.

**Acceptance:** "Two severities" in the submit list, never blocking; standalone modifier blocks with a working path to fix it ("Turn into modifier…" converts in one action).

### M1b — Re-anchoring of modifier segments (text versions)

**Goal:** spec "Text versions", R9; contract C6 (`ReviewReason` gains `changed_modifier_segment`). **Size M. Review: yes (backend-critical: every carry path).** Wave 4, slot 3 (port 18776), **contract owner of wave 4** (rule 8). Split out of M1 to keep M1's size manageable.

**Owns:** `src/ontocurator/domain/reanchor.py`, `src/ontocurator/domain/reanchor_resolution.py` (reason literal), `src/ontocurator/exchange/reanchor_job.py`, `src/ontocurator/application/work_rounds.py`, `src/ontocurator/application/text_changes.py`, `contracts/openapi.json`, `frontend/src/api/generated.ts`, `frontend/src/api/client.ts` (only if the reason type is aliased there), `frontend/src/editor/carried/instructions.ts` and `frontend/src/variants/ReanchorPanel.tsx` (only the `changed_modifier_segment` entry and the `old_modifiers` lines), tests: `tests/test_reanchor.py`, `tests/test_reanchor_job.py`, `tests/test_text_change_modifiers.py` (new), the existing round-carry test module (`grep -rln "reanchor_annotation\|carry" tests`; conditional), the `ReanchorPanel` / carried-instructions Vitest files (`grep -rln "changed_cue" frontend/tests`; conditional). Not `application/editing.py` (M1 already refuses a modifier term in `recreate_reanchor`).

**Tests to add (fixture `MOD_PIN`):**

- `tests/test_reanchor.py` (pure): modifier segment mapped (`Carried.modifiers`); text of the modifier changed → `NeedsReview` reason `changed_modifier_segment` with `old_modifiers`; spanless modifiers carried unchanged; a finding without modifiers maps exactly as today (existing tests unchanged).
- `tests/test_reanchor_job.py`: a carried annotation keeps its mapped modifiers in the target draft; a modifier whose text changed sends the whole claim to review.
- `tests/test_text_change_modifiers.py` (PostgreSQL): the `text_changes.py` carry path (~`:105`) keeps a mapped modifier segment and sends a claim with a changed modifier text to review with `changed_modifier_segment`.
- Round creation carry (`work_rounds.py` ~`:628`): one test in the existing round-carry module (or `tests/test_reanchor_job.py`).
- Frontend: `changed_modifier_segment` copy in the carried instructions and the panel; `old_modifiers` rendered as `Text of {label} changed: “{text}”`.

**Steps:**

- [ ] Re-anchoring per C6: `reanchor.py` maps modifier segments after the evidence loop (same `TextSpan`/`map_span` checks); `_needs_review` carries `old_modifiers`. Writers: `exchange/reanchor_job.py` ~`:140`, `application/work_rounds.py` ~`:628`, `application/text_changes.py` ~`:105` (list every other path that copies an annotation onto another text: `grep -rn "model_copy(.*evidence_refs\|evidence_refs=" src/ontocurator/application src/ontocurator/exchange`; handle each or report why it does not apply; work annotated from proposals is never moved or carried to a new version (spec 2026-10-23 §1), but re-anchored tool proposals go through `reanchor_job.py` and keep their mapped modifiers). `reanchor_resolution.py` (~`:68`): extend the reason literal. Frontend copy: `carried/instructions.ts` `changed_modifier_segment: "The text of one of its modifiers was changed by the correction, so it could not be placed automatically."`; `ReanchorPanel.tsx` `changed_modifier_segment: "The text of a modifier changed."`; "What to check" names the modifier ("Text of Severe changed: “schwere”") where the panel lists the old segments: render `old_modifiers` as `Text of {label} changed: “{text}”` (label via the panel's existing term label lookup).
- [ ] Contract: `uv run python scripts/export_openapi.py`, `npm --prefix frontend run api:generate` (the reason literal; nothing else changes — diff `contracts/openapi.json` and report any other change); typecheck fallout (rule 8).
- [ ] Green; gate (backend lock) with all owned paths; also `uv run pytest tests/test_reanchor*.py tests/test_text_changes*.py tests/test_work_rounds*.py -q` under the lock; browser (port 18776) the re-anchor specs (`grep -ln "Reanchor\|re-anchor" frontend/browser/*.spec.ts`, at most 6). Commit `feat(reanchor): carry modifier segments`.

**Acceptance:** every carry path (re-anchor job, round creation, text change, any further writer found by the grep) maps modifier segments or sends the claim to review; spanless modifiers carried; contract regenerated by M1b alone in wave 4.

## Between-wave steps (main session)

- **After wave 1:** once G1 and the F agent have committed, the full backend suite in the background: `WP=wave1 bash …/build/with-lock.sh backend env CHECK_PYTEST_WORKERS=4 bash scripts/check.sh --only backend` (it must be green with `tests/fixtures/hp.json` untouched; failures go back to the WP that caused them). Then, with the user's OK from Step 0: `git -C C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks push -u origin feat/modifier-checks` and `git -C C:/Users/jan-p/Development/ontospan/.worktrees/modifier-checks push origin v1.2.1`; in Ontocurator replace the commit in `pyproject.toml` (`ontospan @ git+https://github.com/janpower/ontospan.git@<O1 full sha>`), `uv lock`, `uv sync`, run `WP=pin bash …/build/with-lock.sh backend uv run pytest tests/test_t1_export.py tests/test_t1_import.py tests/test_t1_mapping.py -q`, commit `build(deps): ontospan 1.2.1` with `pyproject.toml uv.lock`. Do not open an ontospan PR (not asked).
- **After wave 2:** M1 review → fix agent; dispatch wave 3 when committed.
- **After wave 3:** M2 and M4 reviews in parallel → one fix agent each (disjoint Owns); dispatch wave 4 when both are committed.
- **After wave 4:** M5, M7 and M1b reviews in parallel → one fix agent each (disjoint Owns; the M5 fix agent also writes M7's DESIGN.md rows from M7's hand-back, commit `docs(design): submit modifier warnings and convert`).

## Final phase (main session)

- [ ] Every WP and review fix committed; `git status` clean; stale locks removed.
- [ ] **Pin check (must fail the phase, not pass quietly):** `grep -rn 'reason="ontospan 1.2.1 pin"' tests` is empty and `pyproject.toml` pins ontospan at O1's full SHA (`build(deps): ontospan 1.2.1` exists). `xfail(strict=True)` tests stay green while the pin is old, so the gate alone does not catch it. If the user never approved the push, stop here: report that the branch cannot be opened as a PR until the pin is bumped (no PR, no workaround).
- [ ] One `superpowers:code-reviewer` pass over `git diff <base>...feat/modifiers` against the spec (focus: hash compatibility, refusal codes, classifier caching and the process-wide source, `within` filter before the cut, grouping kinds vs W1 and take-over, attach/reopen consistency, T1 round trip, attach popover keyboard/a11y, U-rule). Findings to `C:/Users/jan-p/Development/ontocurator-reviews/2026-10-21-modifiers-branch-claude.md`.
- [ ] One fix agent (effort medium) applies the findings, TDD, commits.
- [ ] Full gate alone on the machine: `CHECK_PYTEST_WORKERS=4 CHECK_VITEST_WORKERS=3 HPO_E2E_PORT=18777 bash scripts/check.sh` (no `CHECK_CONTAINERS`). Failures go to the same fix agent.
- [ ] Rebuild the embedded bundle: `npm --prefix frontend run build`; replace `src/ontocurator/web/index.html` and the hashed bundle files in `src/ontocurator/web/assets/` (`index-*.js`, `index-*.css` and the split chunks such as `MarkdownBody-*.js`) with those of `frontend/dist/` (remove superseded hashed files); `bash scripts/check.sh --only static`; commit `build: update embedded frontend bundle`.
- [ ] **No fast-forward of any branch.** Report to the user (German, short): commits, gate result, open points, the plan decisions D-a…D-h and the DN answers, and ask: "Darf ich `feat/modifiers` nach GitHub pushen und einen PR gegen `<pr-base>` öffnen?" (`<pr-base>` = `main` if `feat/acceptance-20261023` is merged by then, else ask whether to target `feat/acceptance-20261023`; if main moved past `<base>`, rebase or merge only after the user's OK). Only after a yes: `git -C C:/Users/jan-p/Development/ontocurator/.worktrees/modifiers push -u origin feat/modifiers` and `gh pr create --base <pr-base> --head feat/modifiers --title "Finding modifiers and family-member experiencer" --body-file <body>` (body: summary, spec link, test evidence, **deviations from the spec: D-e (`modifier_majority` counts all members of a group, spec M9 says "same-term members") and D-h (separate fixture `tests/fixtures/modifiers/hp-modifiers.json` instead of editing `tests/fixtures/hp.json` and the t5 example ontology)**, plus D-a (classifier module) and any DN answer that departs from the spec (e.g. DN-6 click count); no AI attribution line, no GitHub Actions — the gate ran locally).

## Self-review against the spec

| Spec item                                                                        | WP                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| M1, R1 data model, R11 hash, `snapshot()` bounds, overlap rules                  | M1                                                     |
| M2, R2, R10, R12 validation table, classifier cache                              | M1 (O1 for ontospan)                                   |
| R3 refusals (create, set_term, adoption), submit rule, open item, group kind     | M1, M7 (incl. convert), G1/M2                          |
| Editing commands incl. `convert_to_modifier`, contract                           | M1                                                     |
| Search `within`, `role`, seeds, browse, stored event                             | M1                                                     |
| Editor Modifiers section, attach popover 1–8, link-a-span                        | M4 (E1 pure ranking)                                   |
| Display M4 (double underline, framing, colour slot, a11y)                        | E1 (marks), M4 (wiring)                                |
| Open items (three kinds)                                                         | M7                                                     |
| `Finding` fields, `groups()` kinds, majority (M9), W1                            | G1, M2                                                 |
| Consolidation backend read/resolve/attach_to/reopen/edited (S1–S22)              | M2                                                     |
| Consolidation frontend (row, union U-rule, sub-row, hints, card, lanes, summary) | E1 (pure), M5 (comparison table, DN-1…DN-8)            |
| T1 import/export, Phenopacket test (M6, S23)                                     | M3, O1                                                 |
| Experiencer `family_member` (M7, M11)                                            | F1                                                     |
| Final panel copy                                                                 | E1 (WP M6 of the spec)                                 |
| Text versions R9                                                                 | M1b                                                    |
| Fixture ontology + German label                                                  | F0 (separate fixture, D-h)                             |
| Accessibility (popover, chips, marks, consolidation)                             | M4, M5, E1                                             |
| Acceptance bullets                                                               | M4 (1–3), M1 (4), M2/M5 (5), M3 (6), F1 (7), M4/M7 (8) |
| Separate PR, no GitHub Actions                                                   | Final phase                                            |
