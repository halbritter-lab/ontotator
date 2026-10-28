# Consolidator

This chapter is for Consolidators and for leads who start or read consolidations. A consolidation merges two or more submissions on one text into one result. Findings that everyone agrees on are taken over automatically; you decide the rest.

How to open tasks is in [getting-started.md](getting-started.md). Accepting the result is in [lead.md](lead.md). Reporting a text problem works as in [annotator.md](annotator.md#report-a-text-problem).

## Start a consolidation (lead)

What for: let a person merge the submissions of a text. Needs at least two submissions on the text.

1. On **Documents**, open the text card of the text.
2. In its final result part, click **Consolidate…**. The form **Consolidate submitted results** opens with the compared submissions already ticked.
3. Under **Submissions to merge**, tick the submissions to merge (at least two).
4. Under **Consolidator**, choose a person. The first choice is you. People who annotated this text may be greyed out, depending on the project rules.
5. Optionally fill in **Consolidation reason (optional)**.
6. Click **Start consolidation**.
7. A message confirms the start. If you chose yourself, you get the Consolidator role for this project and can click **Open consolidation**.

If the button stays inactive, the form says why, for example "Select at least two submissions." or "Choose a consolidator." If you already have a consolidation in progress on this text, the button reads **Continue consolidation**.

## Open a consolidation task

What for: start or continue your consolidation work.

1. In **My tasks**, find the row whose task is **Consolidation**.
2. Click **Start**, **Continue** or **View**.
3. The consolidation screen opens. Its heading reads, for example, "Consolidate CASE-1 en v1". The path above it shows how many groups are still open.
4. The header holds **Open in full editor**, the guidelines (for example "Guidelines v2") and **Report a text problem**.

The screen is read-only after you submitted, when the task is no longer yours, when it is paused, or when a submission used here was withdrawn. A banner tells you which.

## Read the text and walk the groups

What for: see who marked what and work through the differences in order.

1. On the left, the **Clinical text** shows one underline per person. The legend below says which line style belongs to whom. Kept findings are shaded; the selected group is framed.
2. On the right, the list **Groups** holds the findings in text order. Each group shows its passage and its state: **to decide** (or how many fields are left), **agreed**, **decided**, **not in result** or **attached**. A **Conflict** mark shows that people disagree.
3. One group is open at a time. Click a group, or a marked passage in the text, to open it.
4. Press `J` for the next open group and `K` for the previous one.
5. The progress card counts open and decided groups. **Next open group** jumps to the next one.

On a smaller screen, use **Hide text** and **Show text** to make room. On a phone-sized screen, each group shows its own text snippet instead.

## Compare values in the ✓ table and Keep

What for: decide a group by choosing, per field, the value that is right.

1. Open a group. The table has one column per person. A robot icon marks findings from a tool proposal.
2. The rows are **Term**, one row per value (for example the assertion), **Text**, **Modifiers** and **Note**. Rows where people disagree come first and are highlighted. Rows where all agree are marked "(all agree)".
3. In each highlighted row, click the ✓ next to the value you want.
4. Read the result line below the table. It starts with "Result:" and lists what is still not chosen, for example "text not chosen yet". **Not taken:** lists the values you left out.
5. Optional: click **+ note** to write a **Note for the lead**, and tick **Guidelines unclear here** if the guidelines did not settle the case.
6. Click **Keep**. The group reads **decided**, the message **Decision saved** appears with **Undo**, and the next open group opens.

**Keep** stays inactive until every highlighted row has a choice. If only one person marked the finding, the button names them, for example "Keep Luc Martin's finding".

If the same term is already in the result from another group, the card warns you. **Keep** then adds a second finding with that term.

![An open group with the comparison table, ✓ choices and the Keep button](images/consolidator-group-table.png)

## Leave a finding out of the result

What for: drop a finding that should not be in the result.

1. Open the group.
2. Click **Not in result**. The group reads **not in result**.

## Attach a modifier to a finding

What for: when someone used a modifier term (such as "Severe") as a finding of its own, turn it into a modifier of the right finding.

1. Open the group. The card says that a modifier term was used as a finding.
2. Click **Attach to a finding…** and choose the finding from the menu.
3. The group reads **attached**. The target group lists the modifier under **Attached modifier:**.

## Edit values or pick another term

What for: keep a finding with a value or term that nobody chose.

1. Open the group and click **More…**.
2. To change values: choose **Edit values…**, set each value and the modifiers, then click **Keep with these values**. This is offered only when no row is in conflict.
3. To use a different term: choose **Other term…**, search and pick a term. If there was no term conflict, it is saved at once; otherwise choose the remaining highlighted rows with ✓ and click **Keep**.

Click **Cancel** to stop without changes.

## Add a finding everyone missed

What for: add a finding that no submission has.

1. Select the passage in the text. Or click **Add finding**, type the passage into **Passage from the text** (choose the **Occurrence** if it appears more than once) and click **Continue**.
2. Search and pick the term.
3. A message confirms the new finding. It is listed under **Added by you**.

If the passage is not found, type it exactly as written, or select it in the text.

## Change or undo a decision

What for: correct a decision you made.

1. Right after a decision: click **Undo** in the group row, or press Ctrl+Z (Cmd+Z on a Mac).
2. Later: open the decided group and click **Reopen**. Decide it again.
3. To change only the note or the flag of a decided group, use **Edit note** and **Save note**, or the **Guidelines unclear here** box. These save at once.
4. To start over: open **More…** in the header and choose **Reopen all decisions…**, then **Reopen all**. The message offers **Undo**.

If you changed a group in the full editor, reopening it drops that edit. You are asked to confirm.

## Finish a consolidation

What for: hand the merged result to the lead.

1. When no group is open, the progress card reads **Ready to submit**.
2. Click **Submit consolidation**.
3. The dialog **Submit consolidation?** shows how many groups and findings the result has, and how many are not in the result.
4. If there are warnings (values filled in by default, a modifier used as a finding, two severities), they are listed under **Check before you submit**. Click **Back** to fix them, or submit anyway: the button then reads **Submit with** and the number of warnings.
5. Click **Submit**.
6. The screen confirms: "Consolidation submitted. The lead then accepts the result." Open your next task or click **Back to my tasks**.

While groups are open, **Submit consolidation** stays inactive and says how many groups are left.

![The Submit consolidation? dialog with the summary](images/consolidator-submit-dialog.png)

## Work in the full editor

What for: change text spans or add findings that the comparison table cannot express.

1. Click **Open in full editor**.
2. The editor shows the mode **Consolidate** and the list **Selected submitted findings** with each finding's author. It works as described in [annotator.md](annotator.md).
3. Click **Back to consolidation** to return.

Groups you changed here are tagged **edited in editor** on the consolidation screen.

## Read a submitted consolidation (lead)

What for: see how a consolidation result came about before you accept it.

1. On **Documents**, open the text card and click **Open consolidation**. Or, if the card shows flagged findings ("guidelines unclear"), click **Open** next to one to go straight to that group.
2. The heading reads, for example, "Consolidation of CASE-1 en v1". The banner says who submitted it. The view is read-only.
3. Decided groups show the Consolidator's note, the flag **Flagged: guidelines unclear** and the tag **kept** on the chosen values. Added findings say who added them.
4. Click **Back to documents** and accept the result there, see [lead.md](lead.md).

## Look at the text and others' work in the text view

What for: read a text with other people's findings or the result, and compare two of them side by side. Leads and Consolidators see other people's work; everyone else sees only their own.

1. Open the text view, for example from the text card or from **Documents**.
2. Choose the language and version in **Language and version**.
3. In **Show**, choose **Text only**, a proposal layer, someone's annotations or the result. Its findings are listed under **Findings**.
4. Click **Compare** to open a second pane with its own **Language and version** and **Show**. Tick **Couple scrolling** to scroll both together. Click **Close comparison** to close it.
5. Click **Submissions** to open the **Submission history**. Choose a row to show it. Click **Close**.
6. Click **Open my task** to go to your own task on this text.
