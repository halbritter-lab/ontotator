# M1 follow-ups: tool proposal icon and translation review gate

Date: 2026-10-25. Source: manual acceptance (M1) of `feat/acceptance-20261023` on the native
test server, project e3c-proposals. Findings file:
`.worktrees/acceptance-20261023/build/m1-20261024/FINDINGS-2026-10-24.md`.

## 1. Tool proposal icon

### Today

- The robot icon shows in the Documents Annotation cell only while all of these hold: the text
  is in the plan, its annotation mode is not "from scratch", it has tool proposals, and nobody
  has annotate work on it (`frontend/src/documents/RowCells.tsx:347-350`).
- Switching a text to "From scratch" in the card saves at once and the icon disappears, though
  the proposals still exist. The filter "With tool proposals" still lists the text
  (`document_row_facets.py:51-53` counts `proposal_count > 0` only).
- The card shows the proposal count only in "from proposals" mode; spec 2026-10-23 §2b says
  "the card always shows the count".

### Problem

The icon mixes two facts: "this text has tool proposals" and "the annotation will start from
them". The first stays true whatever the mode; hiding the icon suggests the proposals are gone.

### Change

- The icon means **"this text has tool proposals"**. It shows whenever `proposal_count > 0`
  and the text is in the plan, in every mode and also after someone is assigned.
- Its state tells how they are used:
  - from proposals: normal icon; tooltip and accessible text "17 tool proposals; the
    annotation starts from them";
  - from scratch: muted icon; "17 tool proposals; this text is annotated from scratch, the
    annotators do not see them";
  - status never by colour alone: the text differs, the muted icon also gets a slash or an
    outline variant from `ui/icons.tsx`.
- The card's Annotation part always shows the count ("17 tool proposals"), in both modes.
- The filter "With tool proposals" and the icon then agree.
- Switching the mode keeps saving at once; the card shows "Saved" and an Undo in the existing
  undo toast, so a misclick costs one click.

## 2. Translation review gate

### Today

- Project rule `annotate_accepted_translations_only` ("Annotate translations only after an
  accepted review", Settings, rules section, `ProjectSettingsPage.tsx:205`). Default true for
  new projects (`tables.py:135-137`, migration 0006).
- With the rule on, a translation that is not accepted cannot be annotated: next steps never
  offer "Assign annotation…" (`next_steps.py:177-178`), the Annotation cell reads "after
  translation review", and the assign endpoint refuses with `TRANSLATION_NOT_ACCEPTED`
  (`eligibility.py:116-121`).
- Native sources are never gated. A machine translation with a passed automatic check is
  `ready_for_review`, not accepted, so it is gated.
- **e3c-proposals has the rule off** (`false`; t5-acceptance has it on). So on e3c a German
  translation with a running review (EN100022 de) offers "Assign annotation…": the row's one
  button is the first step with an action, and with the rule off annotation may start in
  parallel.
- The rule lives under "rules", far from the Workflow section where review and annotation are
  planned, so a lead does not see why annotation is (not) gated.
- Gap: next steps require every root of a text to be accepted; the assign endpoint checks only
  the one variant's status.

### Change

- Move the checkbox to Settings → Workflow, right below "Texts with tool proposals", with the
  same label and a one-line explanation: "Translations can be annotated only after their review
  is accepted. Native source texts are never held back."
- With the rule off, a translation that is not accepted and has annotation planned shows a
  short grey note in its card's Annotation part: "Annotation may start before the translation
  review (project setting)". No note on native sources.
- Close the gap: the assign check uses the same "all roots accepted" test as next steps (one
  shared function in `domain/next_steps.py`, called from `eligibility.py`).
- Data: switching e3c-proposals to the rule on is a decision for the user (test data).

## Open questions

1. Icon after assignment: keep it (proposal: yes, it states a fact) or hide it once someone is
   assigned (spec 2026-10-23)?
2. e3c-proposals: turn the gate on?

## Tests

- Unit: icon states per mode, with and without assignment; card count in both modes; gate note
  shown only for translations with the rule off; shared accepted check.
- Backend: assign refused when one of several roots is not accepted.
- Browser: switch a text with proposals to "From scratch": muted icon stays, Undo restores.
