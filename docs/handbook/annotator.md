# Annotator

This chapter is for annotators and translation reviewers. It explains how to mark findings in a text, check tool proposals, check carried findings, submit a text and review a translation.

How to sign in, find your tasks and open one is in [getting-started.md](getting-started.md). Words such as finding, mention, axis and modifier are explained in [README.md](README.md).

## Read the editor layout and status

What for: know where things are before you start.

1. Open a task from **My tasks**. The text is on the left, the findings column on the right.
2. The toolbar shows the text name, its language and the mode:
   - **Annotate from scratch**: you see neither the tool's proposals nor other people's work.
   - **Annotate from proposals**: you see the tool's proposals, never other people's work.
   - **Review carried findings** (or the round name, for example "Round 2, continued from Round 1") or **Check after text change**: findings were carried over from earlier work (see below).
3. The save status next to it tells you whether your work is stored: **Saved**, **Saving...** or **Unsaved changes**. Work is saved automatically. If it reads **Offline** or an error, click **Retry**.
4. The **More** menu holds **Work rounds**, **Report a text problem…**, the guidelines (for example "Guidelines v2") and **Keyboard shortcuts (?)**.
5. To make the findings column wider or narrower, drag the divider between text and column (**Resize findings column**).
6. On a narrow screen, switch between **Findings**, **Document** and **Details** with the tabs at the top. **Back to text** returns to the text.

If the text was changed elsewhere, a **Revision conflict** notice appears. Click **Reload case**. A submitted task is read-only: "Read-only. The project lead can reopen it for changes."

## Annotate from scratch: mark text and add a finding

What for: record a term that the text mentions.

1. Select the words in the text with the mouse. With the keyboard: hold Shift, move with the arrow keys, then release Shift.
2. The panel **New finding** shows the marked text. To adjust it, drag the edge handles at its start and end.
3. Type the term name or code into **Search term** (for example "seizure" or "HP:0001250").
4. Press Enter to add the top hit, or click a hit.
5. The finding is created with the project's prefilled values. Confirm or change them (see [Set values and confirm defaults](#set-values-and-confirm-defaults)).

To drop a mark without adding a finding, click **Discard** or press Esc.

![The New finding panel with marked text and the term search open](images/annotator-new-finding.png)

## Search a term

What for: find the right ontology term quickly.

1. Press `/` or click **Change term** to focus the search.
2. Type a name or a code. Hits appear in the list **Terms**.
3. Move with ↓ and ↑, press Enter to take the active hit, Esc to cancel.
4. To search only modifier terms (severity, onset, …), switch on **Modifiers only**.
5. To search names in other languages, click the language button next to the field (it lists the languages searched, for example "EN, DE"). In the menu **Search languages**, tick the languages. English names are always searched.

Hits tagged **Modifier** are modifier terms. Use one as a finding only if it names the finding itself; otherwise add it under **Modifiers**. Obsolete terms cannot be chosen.

If nothing matches, change the words, try a code or switch search languages.

## Browse the ontology tree

What for: pick a broader or narrower term than the one you have.

1. Select a finding and click **Show in tree**. The **Ontology tree** opens at the current term.
2. Click a term in the tree. Its **Synonyms**, **Translated names** and other parents (**Also under**) are shown.
3. Click **Use this term** to give the selected finding this term.
4. Click **Close tree** when done.

## Set values and confirm defaults

What for: record the context of a finding, for example whether it is present, who has it and when.

1. Select the finding. The section **Values** lists each axis, such as assertion (**Present**, **Absent**, **Uncertain**) or experiencer (**Patient**, **Family member**, …).
2. Values the project prefills are tagged **Default**. They count as not confirmed until you confirm or change them.
3. To change a value, click another option. Press `v` to jump to the values with the keyboard.
4. To confirm all prefilled values at once, click **Confirm defaults** or press `d`. To confirm one, click the highlighted default.

Findings with open defaults show **Defaults to confirm** in the list.

## Manage mentions of a finding

What for: link a finding to every place in the text that supports it.

1. Select the finding.
2. To add another place: click **Add mention**, then mark the text. Esc cancels.
3. To add a second piece to the same mention (for words that are apart): click **Add segment** on the mention, then mark the text.
4. To resize a mention, drag its edge handles, or focus an edge and use ← and →.
5. To give one mention its own finding: click **Move to a new finding**. The new finding keeps term and values; change them as needed.
6. To detach a mention: click **Remove**, then **Yes, remove**.

You cannot remove the last mention when the project requires a text span. If the project allows findings without a span, enter a reason in the note first.

## Add a finding without a text span

What for: record a finding that the text implies but does not state in one passage. Only possible when the project allows it.

1. In the **Findings** header, click **Add finding without a text span**.
2. In the panel **New finding without a text span**, fill in **Reason for no text span** (if the project requires a reason).
3. Search and choose the term. If you chose the term first, click **Add annotation**.
4. The finding is listed as **Spanless**.

Click **Cancel** to stop.

## Change term, note or delete a finding

What for: correct a finding you made.

1. Select the finding.
2. To change the term, click **Change term** and search a new one.
3. To add a comment, type into **Note**. It is saved with the finding.
4. To delete the finding and all its mentions, click **Delete finding**, then **Yes, delete**.

If a term has become obsolete, the panel says so. Change the term or delete the finding.

## Add modifiers to a finding

What for: add severity, onset, pattern and similar details to a finding.

1. Select the finding. In **Modifiers**, click **+ Add modifier…**, type into **Search modifier** and choose the modifier.
2. To link the modifier to the words that state it, click **Link a text span** and mark the text.

You can also start from the text:

1. Mark the words, for example "severe", and pick a modifier hit.
2. The panel asks which finding it belongs to. Click the finding in the list or in the text. The nearest ones are listed under **Nearest in this sentence:**.
3. If the modifier names the finding itself, choose the option to use it as the finding instead.

To change a modifier later, open its row menu: **Link a text span…**, **Remove text span** or **Remove modifier**. A removal can be undone with **Undo** or Ctrl+Z.

## Turn a standalone modifier finding into a modifier

What for: fix a finding that is really a modifier of another finding.

1. Select the finding. A warning says it is a modifier term.
2. Click **Turn into modifier…**.
3. Click the finding it belongs to. The list marks candidates with **Becomes a modifier of the finding you choose**.

## Layers and annotation type

What for: work in projects with more than one layer (for example two ontologies). With one layer this panel is not shown.

1. Open **Layers & Ontologies** in the findings column.
2. Use the visibility toggle next to a layer to show or hide a layer. Layers tagged **Reference** are read-only.
3. Click **Activate** on the layer you want to annotate. **Locked** layers cannot be edited.
4. Choose the **Annotation type** for new findings.

## Annotate from proposals: review each proposal

What for: check the tool's proposals one by one and add what the tool missed.

1. The column **Review Proposals** lists every proposal. Your additions are under **Your own findings**.
2. Select a proposal (or move with `j` and `k`). The text shows where it was found.
3. Decide:
   - **Confirm**: the proposal is right as it is.
   - **Reject**: the proposal is wrong.
   - **Edit & Replace**: the proposal is nearly right. You get an editable copy that replaces it; change term, values or text span in the copy.
   - **Unresolved**: you cannot decide. Write a **Reviewer note**, then click **Save decision**.
4. After each decision the next open proposal is selected. Press `K` right after a decision to go back to it.
5. To undo a decision, click **Reset decision (open)** or press `0`.
6. Add findings the tool missed as in [Annotate from scratch](#annotate-from-scratch-mark-text-and-add-a-finding).

Unresolved is a reviewer flag, not clinical uncertainty. For clinical uncertainty, use the value **Uncertain**.

![A proposal selected, with the Confirm, Reject, Edit & Replace and Unresolved buttons](images/annotator-proposal-review.png)

## Review carried findings

What for: check findings that were carried over from an earlier round, for example after a lead reopened your work or the text changed.

1. The toolbar names the round, for example "Round 2, continued from Round 1", or reads **Review carried findings** when the round has no name. The progress line counts checked findings.
2. Click **Next unchecked** (or press `n`) to select the next finding marked **Check needed**.
3. Read **What to check**: the text span, the values or the note. Carried values are not confirmed.
4. To see the finding as it was, click **Show original evidence**.
5. If it is right (after any edits), click **Mark as checked** or press `c`.
6. If it does not apply to this text, open **Does not apply…**, give a reason and click **Dismiss**.

If you change a finding after checking it, it needs a new check.

A row **Not on this text** means the finding could not be placed in this text. Select it and choose one: **Mark in text**, **Link to an existing finding**, or **Dismiss with reason…**.

![A carried finding with What to check and the Mark as checked button](images/annotator-carried-finding.png)

## Re-create findings after a text correction

What for: move your findings to the corrected text after a lead changed it.

1. The toolbar reads **Check after text change**. The panel **Needs review after the text change** lists the findings to place again.
2. For each item, click **Re-create here** and mark the supporting text in the corrected version.
3. Check the term, then click **Save re-created finding**. You can choose a different term below.
4. Check the text span and the values of the saved finding, then click **Complete text-change review**. A later change to the finding needs this again.
5. If the finding no longer fits, click **Dismiss with reason**, fill in **Reason for dismissal** and click **Save dismissal**.

## Submit the text

What for: hand your finished work to the lead.

1. Click **Next open item** to jump to things that still need attention.
2. Click **Finish & submit text**. While items are open, the button shows how many.
3. A dialog named after the text, for example "Submit CASE-1 en?", lists what is still open: **Carried findings to check**, **Findings that need attention**, **Findings after text correction**, **Proposals not decided**. Click **Go to** to fix an item.
4. When nothing blocks, click **Submit text**. If only warnings are left, the button reads **Submit with** and the number of warnings.
5. The next open task opens. To see what you sent, click **View result** in the message.

Submitting also says you checked the whole text for further findings. Afterwards only the project lead can reopen it.

## Confirm values and acknowledge warnings in the submit dialog

What for: finish prefilled values and modifier warnings without leaving the dialog.

1. The group **Values not chosen yet** lists findings with prefilled values.
2. Click **Confirm as shown** on a row, or, with more than one row, **Confirm all as shown**. Click **Go to** to change a value instead.
3. The group **Modifier warnings** lists, for example, a modifier used as a finding or two severities on one finding. Click **Go to** to fix one.
4. Click the submit button. Warnings you leave are submitted as they are.

If the project requires chosen values, unconfirmed values block submitting instead of warning.

![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)

## View my submissions

What for: look at what you submitted earlier.

1. Open the task. On a narrow screen, switch to **Details**.
2. Under **My submissions**, click **View** next to a round.
3. The dialog **Historical submission** shows the findings, values, notes and decisions of that submission.
4. Click **Close**.

## Work rounds

What for: see the rounds of your task and start a new one.

1. Open **More** and choose **Work rounds**.
2. The table **Rounds** lists each round with its state and submission. **You are here** marks the current one; **Open** opens another.
3. To start again, go to **Start a new round**:
   - **Start empty round** starts with no findings.
   - Or choose a submission under **Continue from** and click **Continue from this submission**. Every carried finding must then be checked again.
4. Click **Close**.

Starting a round does not change the final result.

## Report a text problem

What for: tell the lead that the text cannot be annotated as it is (for example cut off or wrong text). This pauses your task.

1. Open **More** and choose **Report a text problem…**. In a translation review or consolidation, use the button **Report a text problem** in the header.
2. Describe the problem under **What is the problem?**. Only you and project leads can read it.
3. Click **Report and pause my task**.
4. The task is paused. You cannot save or submit until the pause is released. Your saved work stays.

If you already reported a problem, the menu item reads **Text problems**; the dialog lists **Your reports** and offers **New report**.

## Resume a paused task or withdraw a report

What for: continue work after a report, or take a report back.

1. Open **More**, then **Text problems**. Your report card shows its state and your task's state.
2. To continue: click **Resume my task…**, fill in **Why can you continue?** and click **Resume my task**. The report stays open for the lead.
3. To take the report back: click **Withdraw report…**, fill in **Why are you withdrawing it?** and click **Withdraw report**. Your task is no longer paused by this report.
4. When the lead answers, the task shows a banner with **Open the answer**, and **My tasks** shows **Answer to your report**.

If a project lead paused the task, only a project lead can release the pause.

## Translation review

What for: check a machine or human translation before it is annotated. Your profile must contain your qualification, see [getting-started.md](getting-started.md).

1. Open the task. The **Source** is on the left, the **Translation** on the right.
2. Read the automatic checks band at the top. Click **Details** to see which checks failed.
3. Correct the translation directly in the right column. Use **Show changes** to see your edits and **Couple scrolling** to scroll both columns together. **Show matching paragraph** (Alt+M) jumps to the paired paragraph.
4. To compare with another text, click the button that starts with **Compare with**, for example "Compare with … de". With several texts to compare, it opens a menu **Compare with…**.
5. Under **Your review**, choose a **Decision**:
   - **Accepted unchanged**: the translation is right.
   - **Accepted with corrections**: you corrected it. Editing chooses this for you.
   - **Query**: you have a question for the lead.
   - **Rejected**: the translation cannot be used.
6. If you changed the meaning, tick **Clinically relevant change** and choose at least one category. Add a **Rationale** if needed.
7. Click **Submit review…** (or Ctrl+Enter), then **Submit review**. A submitted review cannot be changed later.
8. Click **Next task** or **Back to my tasks**.

If the source text was updated, **Source updates to review** appears. Open it, compare **Original source** and **Updated source**, and click **Submit review and resolve source update**.

## Keyboard shortcuts

What for: work without the mouse. Press `?` anywhere to see all shortcuts (**Keyboard shortcuts**). Shortcuts are off while you type in a field.

| Key | Action |
|---|---|
| `/` | Focus the term search |
| ↓ / ↑, Enter | Move through term hits; add the active hit |
| `v` | Focus the values |
| `d` | Confirm all default values |
| Esc | Discard the marked text, clear the selection, cancel adding a mention |
| Shift + arrows | Select text with the keyboard |
| ←, →, Ctrl + ← / → | Move the focused mention edge |
| `j` / `k` | Next / previous proposal |
| `1` `2` `3` `4` | Confirm, Reject, Edit & Replace, Unresolved |
| `0` | Reset the decision to open |
| `K` | Right after a decision: back to that proposal |
| `n` / Shift + N | Next / previous unchecked carried finding |
| `c` | Mark carried finding as checked |
| Ctrl+Z | Undo removing a modifier |
| Alt+← / Alt+→ | Previous / next text |
| Alt+P | Switch project |

In a translation review: `1` to `4` choose a decision, Ctrl+Enter submits (with a confirmation), Alt+M shows the matching paragraph.
