# Lead: texts, work plans and progress

This chapter is for project leads. It covers the **Documents** page: uploading texts, the text card, planning and assigning work, and following progress. Back to the [lead overview](lead.md).

On **Documents**, each row is one text: one language version of a case. See [case, text and document](README.md#glossary).

## Upload texts

### Prepare files for upload

Ontotator takes two formats:

| Format | Use it for | What goes in |
| --- | --- | --- |
| **Plain text** (.txt, or a .zip of .txt files) | Texts in one language, without tool proposals. | One UTF-8 text file per text. The file name without `.txt` becomes the text's ID: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. Each name may occur once. All files of one upload get the same **Upload language**. |
| **Ontospan bundle** (.zip or .json) | Texts with translations and tool proposals. | A ZIP with `manifest.json` and one JSON file per text under `documents/`, or a single exchange file (.json). Each text file holds the text, its language and case ID, whether it is a translation, and the tool proposals for it. |

Example of a plain-text ZIP:

```
texts.zip
  case-201.txt
  case-202.txt
```

Example of an Ontospan bundle:

```
bundle.zip
  manifest.json
  documents/
    case-201-de.json    (source text, with proposals)
    case-201-en.json    (translation of case-201)
```

Ontospan bundles are written by the Ontospan tools that produce the translations and proposals. Ask whoever runs those tools for a bundle.

A bundle fits a project only if its ontology ID, layer IDs, ontology release, branches, annotation scheme and values match the project's [task profile](lead-settings.md#task-profiles) and ontology settings. The built-in template *HPO phenotype* fits only bundles with ontology `hp`, layer `hpo-layer` and exactly the branch `HP:0000118`. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

### Upload texts

What for: bring texts into the project, with or without tool proposals.

Before you start: [prepare the files](#prepare-files-for-upload). Check the [languages of the texts](lead-settings.md#set-the-languages-of-the-texts) and the [plan for new imports](lead-settings.md#choose-the-plan-for-new-imports).

1. Open **Documents** and click **Upload texts…**.
2. Choose the **Format**. For plain text, also choose the **Upload language**.
3. Click **Choose files…** and select your files.
4. Click **Check**. Nothing is imported yet; the dialog shows *Checking 2 files …*.
5. Read the preview: the number of cases, proposals and texts already in the project, and any **Notes**. For plain text, the first note shows which text ID each file name became. A note says what, if anything, you need to do; **Show** lists the texts and proposals it concerns.
6. Check the **Work plan** before you import: it decides which tasks the imported texts get. For each language, click a chip to turn the **Translation review** or the annotation on or off. Sources marked *only cases without a translation* are annotated only where a case has no translation. Click **Adjust per case…** for exceptions. The line next to the import button repeats the plan, for example *Work plan: translation review de; annotate de*.
7. Optional: if translations are not marked as reviewed and you want them annotated without review, tick **These translations were reviewed outside Ontotator — accept them as they are** and enter a **Reason**.
8. Click the import button, for example *Import 20 cases*.

![The Upload texts dialog after the check, with the summary and the work plan](images/lead-upload-preview.png)

What you may see:

| Message | Meaning |
| --- | --- |
| *…: problems found. Nothing can be imported.* | The dialog names the problems per file and, for a bundle that does not fit the project, what the bundle uses, what the project uses and who can change it. Click **Discard** (or **Cancel**): the upload is dropped and the dialog closes. Fix the files or the settings and upload again. |
| **You can close this dialog; the import continues, and the texts appear after the next page load.** | The import runs. Reload **Documents** later. |
| *Imported 20 documents and 35 proposals.* | The import is done. |
| **This upload failed. Nothing was imported.** | **Discard it and upload the files again.** |

If you chose **Plan nothing; I plan texts on Documents**, the new texts appear as *Not decided* until you plan them ([Plan several texts at once](#plan-several-texts-at-once)).

## The Documents page

The **Documents** page lists every text of the project and what it needs next. Open it with **Documents** in the sidebar. A number next to it counts the texts that need your decision.

![The Documents page. The row with a coloured edge needs your decision; its Next step button opens that decision.](images/lead-documents.png)

### Columns of the Documents table

| Column or mark | Meaning |
| --- | --- |
| **Text** | The case ID, the language, the text version and a **NEW** badge for texts that are new since your last visit. |
| **Translation**, **Annotation**, **Finalization** | The state of each stage, with the names of the people involved. |
| Robot icon | The text has tool proposals. |
| **Waiting on** | Who the text waits for. **You** in bold means it waits for you. |
| **Next step** | A button for the next action on this text, for example **Assign annotation…**, **Accept result…** or, when submissions differ, **Compare results…**. Rows that need your decision also have a coloured left edge. |
| **Last activity** | When something last happened on the text. |

A task starts with the person's first saved change; opening it is not enough. Until then **Translation** and **Annotation** read *assigned, not started* with the person's name, in the table, its tooltip, the narrow cards and the text card. After the first save they read *in review* or *In progress*. With several people or parallel versions the cell counts them, for example *1 of 2 started*.

### Use the Documents tabs

What for: work through texts by what they need.

1. On **Documents**, choose a tab: **Needs your decision**, **To assign**, **In progress**, **Done** or **All**.
2. Click **Refresh** to reload the table and the counts.

A tab keeps your filters and search. A text that leaves the tab while you work on it, for example one you just assigned under **To assign**, stays in the table with a *Changed: …* or *Resolved* badge, so the list does not jump. **Refresh** or another tab removes such texts.

### Do a text's next step

What for: act on a text directly from its row.

1. In the **Next step** column, click the row's button, for example **Assign annotation…**, **Accept result…** or **Decide on report…**.
2. The matching dialog, card or page opens. The tasks in this chapter and in [Lead: results, decisions and export](lead-results.md) describe each one.

If you have an open task on the text yourself, the row shows **Open my task** instead. It opens your task in the editor or on the consolidation screen.

### Search texts

What for: find a text by its ID. The search does not look at the words in the text.

1. Type into the search field **Case ID…**. Any part of the ID is enough, in upper or lower case: `fr100994` and `100994` both find `FR100994`. To find one language, add it: `FR100994 fr`.
2. The list updates after a short pause or when you press Enter.

The search stays inside the open tab. If it finds nothing there but finds texts under another tab, the list says so and offers a button to show them under **All**, with your search kept.

To clear the search, click ✕ in the field.

### Filter the list

What for: show only texts in a certain state, language or origin, or the texts of one person.

1. Click **Filter**.
2. To see what a person was given, choose them under **Assigned to**. The list shows their texts in every task, open and submitted; revoked assignments are left out.
3. Tick the options you need, for example under **Language**, **Translation review**, **Annotation** or **Final**. Each choice applies at once.
4. Under **Order**, choose **Case ID**, **Import order** or **Last activity**.

Active filters show as chips above the table. Remove one with its ✕, or click **Clear all**. Options without texts are hidden; click the button below the options, for example *Show 4 empty filters*, to see them.

### Sort and page through the table

- Click the column header **Text** to sort by case ID, up or down.
- Click **Last activity** to sort newest or oldest first.
- The other headers sort only the rows on the current page.
- Below the table, click **Next** or **Previous** to see more rows.

### On a narrow screen

Below 700 px width, each case is a card with its texts. Click a stage status to see the latest activity and the actions for that stage. Click **Details** to open the full text card.

## The text card

The text card shows everything about one text and lets you act on it.

### Open the text card

1. Double-click a row, or focus the text name and press Enter.
2. The card shows the path **Translation**, **Annotation**, **Finalization**. Click a part to see it.

![The text card with its three parts. The Annotation part is open and lists the annotators.](images/lead-text-card.png)

In the card:

- **Open text** opens the [text view](#read-a-text-and-other-peoples-work-in-the-text-view).
- **Previous text** and **Next text** walk through the table (keys `K` and `J`).
- **Other languages** switches to another language of the same case.
- In **Finalization**, **Open consolidation** opens your own running consolidation as your task; a submitted one opens read-only.
- ✕ or Esc closes the card.

### Read the history and details of a text

What for: see what happened to a text and its technical IDs.

1. In the text card footer, click **History** or **Details**.
   - **History** lists all activity, newest first, with reviewers' reasons, reassignments and mode changes.
   - **Details** shows the **Plan**, the **Problem reports** and the **Technical details**.
2. Click **Back** to return to the path.

### Read a text and other people's work in the text view

What for: read a text with other people's findings or the final result, and compare two of them side by side. Leads and consolidators see other people's work; everyone else sees only their own.

1. Open the text view with **Open text** in the text card.
2. Choose the language and version in **Language and version**.
3. In **Show**, choose **Text only**, a proposal layer, someone's annotations or the result. Its findings are listed under **Findings**.
4. Optional: click **Compare** to open a second pane with its own **Language and version** and **Show**. Tick **Couple scrolling** to scroll both together. Click **Close comparison** to close it.
5. Optional: click **Submissions** to open the **Submission history**. Choose a row to show it, then click **Close**.

**Open my task** goes to your own task on this text.

### Review the translation versions of a text

What for: see each version of a translation, its reviews and its origin.

1. Open the text card and click **Translation**.
2. The list shows each version with its origin and status. Older ones are under **Older versions**.
3. Click **View text** to read a version, or **Translation reviews** to see every review decision.
4. Click **Compare with source** to compare the translation with the source text.

### Request a translation correction

What for: have a translation corrected by a reviewer.

1. Open the text card and click **Translation**.
2. At the version, click **Request correction…**.
3. Choose the **Translation reviewer** and enter the **Reason for another review**.
4. Click **Assign correction review**, then **Close**.

The corrected text becomes a new text version.

## Work plans and assignments

The work plan says, for each text, whether it gets a translation review and whether and how it is annotated. Planned texts show up in the main list; the others are hidden. Then the tab **All** says how many of its texts the table holds, for example *246 of 307*.

### Add a text to the plan

What for: start work on a text that is not planned yet.

1. On **Documents**, tab **All**, tick **Show texts not in plan**. Unplanned texts appear muted.
2. In the text's row, click **Add to plan…**.
3. Choose **Translation review** **On** or **Off**.
4. Choose the annotation: **Off (not annotated)**, **Annotate from proposals** or **Annotate from scratch**.
5. Click **Save**. The message has an **Undo** button.

### Select texts

What for: plan or assign many texts at once.

1. Click a row to select it. Shift+click selects a range; Ctrl+click (macOS: Cmd+click) adds single rows.
2. To select every filtered text, tick the checkbox in the table header.
3. The selection bar at the bottom shows how many texts are selected and their next steps, for example *next steps: Assign annotation (en, es)*. Selected texts the filters hide are counted too, and the bar says so, for example *4 texts in 2 cases selected (2 source texts not shown)*.

To list only the selected texts, across all pages, click **Show selected**. The list then ignores the tab and the filters and shows the chip **Selected texts**. Click **Show selected** again or remove the chip to return to your filters and page; changing a filter or tab also ends it.

To start over, click **Clear selection**.

### Select texts by pasting case IDs

What for: select texts from a list you have elsewhere, for example a spreadsheet.

1. Click **Select by case IDs…**.
2. Paste the IDs into **Paste case IDs**, one per line or separated by commas.
3. Check how many were found. Click **Copy unknown IDs** to copy the ones that do not exist.
4. Optional: to keep the current selection, tick **Add to the current selection instead**.
5. Click the select button, for example *Select 20*.

### Plan several texts at once

What for: set the work plan for a selection.

1. Select the texts, then click **Plan…** in the selection bar.
2. Optional: under **Quick choice for the selected translations**, pick **Translation review and annotation** or **Annotation only, no translation review**.
3. Or set it per language: **Translation review** and **Annotation**. **Leave as is** keeps the current plan.
4. Read what will change.
5. Click the save button, for example *Save for 20 cases*.
6. If work already exists, the dialog lists what happens to it. Tick **I understand** (or **I understand — withdraw the open tasks**) and save again.

![The Work plan dialog with the quick choice and one row per language](images/lead-work-plan.png)

**Undo** in the message restores the plan, not withdrawn tasks.

### Change the annotation mode of one text

What for: switch one text between from proposals, from scratch and not annotated.

1. Open the text card and click **Annotation**.
2. Under **Annotation**, choose **From proposals**, **From scratch** or **Off**. It saves at once.

Once someone is assigned, started or submitted work, a line *Fixed: …* says who fixes the mode:

- While the work is not submitted, remove the assignment ([Remove, reassign or reopen an assignment](#remove-reassign-or-reopen-an-assignment)), then choose.
- To change it anyway, click **Change mode…** next to the line. The dialog names whose work is affected. Enter the **Reason**, then click **Change mode**, or **Discard work and change mode** if submitted work is discarded. Their assignments are removed. Discarded work is kept, not deleted: it no longer counts for progress, consolidation, the final result or exports.
- **Restore…** in the text card brings the discarded work back while no new annotation has started.

**History** in the text card shows the change and its reason.

### Assign work to the selected texts

What for: give translation reviews or annotations to people.

1. Select the texts, then click the assign button in the selection bar, for example **Assign annotation…**.
2. Check what the selection needs. If it needs more than one task or language, the line **This selection needs** lists every step, one task in one language each, for example *Translation review de ✓ · Annotation de · Annotation en*. Steps you are through have a tick, a skipped step reads *(skipped)*, the current step is bold, and *Step 2 of 3* says where you are. Then check the **Task**. Annotation that waits for a review you skipped is no longer listed: it cannot start in this dialog.
3. In the table of people (**Person**, **Reads**, **Open tasks**), pick the reviewer, or tick everyone who should annotate. The task has one language: each ticked person gets every selected text in that language that still has a free place. *Administrator* marks a system administrator; leave them unticked unless they take part.
4. Read the summary below the table, for example *Ana Weber gets 3 translation reviews (de).*
5. Click the assign button, for example *Assign 20*.

![The assign dialog with members, their languages and open tasks](images/lead-assign.png)

**Reads** shows the languages in each person's profile. If someone's profile lists languages but not one the task needs, the dialog asks again; click **Assign anyway** or **Back**. A person with no languages listed counts as unknown and gets no warning. Ontotator sends no e-mail; the work appears in each person's **My tasks**.

With **Annotate only after the translation review is accepted** on, you can assign annotators to a text while its translation review is assigned or underway, so both steps are set up at once. The summary says *Still in translation review: the task opens once the review is accepted.* The annotator sees the task in **My tasks** as **Waiting for translation review** and cannot start it; it counts under **Open tasks**. When the review is accepted, the task opens with no further step from you. This also holds for **Distribute evenly…**. A text with no translation review under way still cannot get annotators: assign the review first. With parallel translations of one text, only the translation under review can get a waiting task; the others follow once every translation is accepted, and the dialog's summary says which were left out.

What happens to a waiting task:

- **Rejected** or **Query**: it keeps waiting. Decide on the text as usual.
- **Accepted with corrections**, a lead correction or an uploaded correction: the task moves to the new version and opens there once that version is accepted. A task from proposals stays on the old version, as the new version needs its own proposals: the annotator sees **Waiting for the project lead**, and once the new version is accepted the text shows **Handle text change…**, where **Withdraw** is the choice that works. A paused task stays too, until you decide its report.
- A task on an uploaded correction that was then **Rejected** or **Query**, with the older version accepted afterwards: the text shows **Handle text change…**; **Withdraw** the task, then assign the accepted version.
- You remove the review: the task keeps waiting, and the text shows the next step for the review.
- You turn Review off and accept the translation: the task opens. You turn Annotate off or discard the version: the task is withdrawn, as any open task.

The dialog works through the whole selection, one task and language at a time: translation reviews first, then annotation. After the assign button it stays open on the next step, lists what is already assigned and says what comes next. An annotation that waits for its review is the next step once the review is assigned. To pass a step without assigning it, click **Skip this task**; to go to another step, choose it under **Task**. Click **Close** when you are done, or assign the last step.

The closing message names what is left unassigned, for example *Left unassigned: annotation of case-0102 en*, and offers those cases, for example *Select the 2 skipped cases*. The message stays until you close it.

### Assign work for one text

What for: assign a single review or annotation.

1. In the row, click **Assign review…** or **Assign annotation…**. In the text card, use **Assign review…** or **Assign annotators…**.
2. Tick the people. To annotate yourself without the Annotator role, click **Add me as annotator**.
3. Click the assign button, for example *Assign 2 people*.

To change the limit of annotators per text from here, click the info button (i) next to the limit, then **Change for all texts**.

### Distribute work evenly

What for: spread a batch of texts evenly across people.

The proposal uses the languages in each person's profile: a person is proposed for a text only if they read its languages, or list no languages at all. People who list the text's languages come first; people with no languages listed only fill the places left over. Among them, fewest open tasks come first.

1. In the assign dialog, click **Distribute evenly…**. The proposal takes the place of the assign dialog; **Close** without confirming returns to it.
2. Set **People per document** and click **Propose**.
3. Check the proposal. Change a person in any cell, or click **Propose again**. Texts nobody can take are listed under **Unassignable documents**.
4. Click **Confirm**. This covers only the task shown in the assign dialog. If the selection needs more, the assign dialog comes back on the next step; otherwise it closes and the message says the assignments are saved.

If you chose someone whose profile lists other languages than the text needs, the dialog stays open after **Confirm** and asks; click **Assign anyway**. The other rows are already saved.

If a text is still without anyone after you close the proposal, the assign dialog comes back on the same step and names it. Choose someone there, or **Close**: the closing message lists what is left unassigned.

### Remove, reassign or reopen an assignment

What for: change who works on a text, or let someone change a submitted annotation.

Warning: removing unsubmitted work deletes the draft for good. Submitted work stays in the history.

A task that waits for the translation review shows **Waiting for review** in the person's row and can be reassigned or removed like any open task.

1. Open the text card and click **Annotation** (or **Translation** for reviews).
2. In the person's row, click one of these:
   - **Reassign…**: choose the **New assignee** and click **Reassign**. If work has started, confirm with **Reassign started work**. The new person starts from the document's inputs. The previous draft stays stored, but nobody can open it, its author included.
   - **Reopen…**: optional **Reason (optional)**, then **Reopen assignment**.
   - **Remove…**: confirm with **Remove** or **Confirm removal**.

Consolidations cannot be reassigned. Annotators can also continue from their own submission themselves ([Start a new work round](annotator.md#start-a-new-work-round)).

## Watch progress

What for: see the whole project at a glance.

1. In the sidebar, click **Progress**.
2. The first line counts cases, reviews and annotations. Click **need your decision** or **to assign** to jump to those texts.
3. The cards **Translation review**, **Annotation** and **Final result** count the texts per state. Each count opens **Documents** with the same texts.
4. The **People** table shows each person's open and submitted work; tasks that wait for a translation review count under **Waiting for review**, not as open. Click a name to see their texts.

![The Progress page with the stage cards and the People table](images/lead-progress.png)

Click **Refresh progress** to update.
