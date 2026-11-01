# Lead: results, decisions and export

This chapter is for project leads. It covers choosing the final result of each text, consolidations, the decisions on translations, text changes and problem reports, and the export. Back to the [lead overview](lead.md).

## Accepting results and consolidation

Each text version gets one final result: one submission or one consolidation that you accept. Only final results go into the final export. You do this in the **Finalization** part of the [text card](lead-documents.md#the-text-card).

How to choose:

- If all submissions agree, accept one.
- If they differ in a few findings and one is clearly right, read them and use that one.
- If they differ and you want each difference decided on its own, start a consolidation.

### Accept a result or compare results

What for: choose the final result of a text.

1. On **Documents**, tab **Needs your decision**, click **Accept result…** or **Compare results…** in the row. The row reads **Accept result…** when there is one result to accept or the submissions agree in full, also on notes and modifier text spans, and **Compare results…** when they differ in anything. The card opens at **Finalization**.
2. With one submission or a submitted consolidation, check it and click **Accept result**. For a consolidation, the card says how its findings came about, for example *Consolidated by Carla Diaz · 32 matching, 1 decided by Carla, 2 groups left out*. Left-out groups are not in the result. If an annotator left findings **Unresolved**, the card lists them with who wrote each note. Accepting a submission directly keeps the flag and the note in the export; open the submission to check them first.
3. If all annotations agree, the card says so. Click **Accept result**. A finding an annotator left **Unresolved** never counts as agreed, so that text goes through the next step instead.
4. If they differ, the card shows the agreement, for example *Agreement: 5 of 9 findings match, 1 differs in context only*. When matching findings still differ in a note, a text span or a modifier text span, a line below names them, for example *Notes differ on 1 finding: Ataxia*. Findings an annotator left **Unresolved** count as differences and are listed with who wrote each note. **How is this counted?** explains the numbers. Open a submission with **Open submission** to read it in the read-only text view.
5. Warning: the next action saves at once, without a confirmation. Click **Use as final** in the row of the submission you want. Or [start a consolidation](#start-a-consolidation) instead.

After saving, the card moves on to the next text that needs a decision. The decided row stays in the tab with a *Resolved* badge until you click **Refresh** or change the tab. To undo, [change the final result](#change-a-final-result).

![The Finalization part comparing two submissions, with the agreement line and Use as final](images/lead-compare-results.png)

If the project rule says the consolidator may not be an annotator, you cannot accept your own result; another lead must do it.

### Accept early while other annotations are open

What for: accept a result before everyone has submitted.

1. Open the text card at **Finalization**. It lists the annotations still open.
2. Optional: remove open work with **Remove assignment…**.
3. Choose the result as in [Accept a result or compare results](#accept-a-result-or-compare-results).

Open work stays assigned unless you remove it.

### Start a consolidation

What for: let one person decide the differences between submissions and build one result.

Before you start: the text needs at least two submissions. The consolidator must have the **Consolidator** role in the project ([Change a member's roles](lead-settings.md#change-a-members-roles)), or be you.

1. In the text card, open **Finalization** and click **Consolidate…**. The form **Consolidate submitted results** opens with the compared submissions already ticked.
2. Under **Submissions to merge**, check the ticked submissions (at least two).
3. Under **Consolidator**, choose a person. The list starts with **Choose a consolidator**, then you (*You (Mia Lead)*), then every member with the Consolidator role; the hint under the list links **Settings → People**, where you give the role to someone who is missing. If the project rule forbids it, people who annotated this text are shown but cannot be chosen (*— Ana Weber annotated this text*).
4. If the person's profile lists languages but not the text's language, tick the box *Assign this consolidator despite missing en in their profile*, right under the list.
5. Optional: enter **Consolidation reason (optional)**. The consolidator sees it in **My tasks** and above the groups; it is also kept in the history.
6. Click **Start consolidation**.

If the button stays inactive, the form says why: *Select at least two submissions.*, *Choose a consolidator.*, *Confirm the consolidator despite missing en.*, or someone already has a consolidation in progress on this text. If that is you, the button reads **Continue consolidation**.

After the start:

- If you chose someone else: Ontotator sends no e-mail. Tell the person that a consolidation is waiting in their **My tasks**.
- If you chose yourself: you get the Consolidator role for this project. Click **Open consolidation** in the text card or **Open my task** in the text's row on **Documents**. Each opens your task, where you decide and submit.

While the consolidation runs, the card shows the consolidator and how many groups are still open. What the consolidator does is in the [consolidator chapter](consolidator.md).

### Read a submitted consolidation

What for: see how a consolidation result came about before you accept it.

1. In the text card, click **Open consolidation**. Or, if the card shows flagged findings ("guidelines unclear"), click **Open** next to one to go straight to that group.
2. The heading reads, for example, *Consolidation of CASE-1 en v1*. The banner says who submitted it. The view is read-only.
3. In decided groups, the chosen value of each conflicting row is tagged **kept**, including the chosen passage and modifiers. The consolidator's notes show as *Note: …*, in the list under each closed group as well, and flagged groups show **Flagged: guidelines unclear**. Added findings say who added them and list their values.
4. Click **Back to documents**.

### Accept a consolidation

What for: make a submitted consolidation the final result.

1. Click **Accept result…** in the row.
2. Read the consolidation first ([Read a submitted consolidation](#read-a-submitted-consolidation)). Pay attention to groups flagged **Flagged: guidelines unclear** and to the notes: they show where your guidelines need a clearer rule ([Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version)).
3. Click **Accept result**.

A submitted consolidation cannot be reopened or reassigned. If it contains a mistake, choose **Choose another result…** in **Finalization**, then **Consolidate…** to start a new consolidation; the earlier consolidation can be one of its submissions.

### Review changes to a final result

What for: confirm a final result after something changed, for example a newer submission or a corrected text. The row's next step is **Confirm final result**.

1. In the row, click **Review changes…**. The card lists what changed.
2. Optional: if the text changed, click **Show changes** to see the changed passages.
3. Choose one:
   - Keep the final result on the old version, for example *Keep final on v1*.
   - **Use the newer result**. If annotators marked findings in it **Unresolved**, the block lists them with who wrote each note.
   - Carry it to the new version, for example *Carry to v2…* (see [Carry submitted work to a new text version](#carry-submitted-work-to-a-new-text-version)).

### Change a final result

What for: pick another result after you already chose one.

1. Open the text card at **Finalization**.
2. Click **Change final…**.
3. Click **Use as final** in the row of the result you want.

## Translation and text-change decisions

### Resolve a rejected or queried translation

What for: decide what happens after a reviewer rejected or queried a translation. The row's next step is **Resolve rejected translation** or **Resolve queried translation**.

1. In the row, click **Resolve…**. The options open below the row with the reviewer's rationale. When someone holds an annotation that waits for this translation, a line names them, for example *Ana Weber is waiting for this decision to start the annotation.*
2. Choose one:
   - **Assign a new review…**: someone reviews it again.
   - **Correct the translation…**: you correct it yourself ([Correct a translation yourself](#correct-a-translation-yourself)).
   - The discard item, for example *Discard the de translation…*: enter a **Reason** and click **Discard**. Nothing is deleted; the versions are marked as discarded.
3. Or click **Cancel**.

### Correct a translation yourself

What for: fix a queried or rejected translation without assigning another review.

1. In the row, click **Resolve…**, then **Correct the translation…** (or **Continue your correction**).
2. Read the panel: you review the version yourself, and your corrected text becomes the next text version and counts as accepted. If your profile lists languages but not this one, tick *Correct despite missing de in your profile*.
3. Click **Open translation review**. The screen says **You are correcting this translation as project lead.**
4. Correct the translation as described in [Review a translation](annotator.md#review-a-translation). Only **Accepted with corrections** is offered.
5. Submit with **Submit review…** (or `Ctrl+Enter`), then click **Back to Documents**.

### Accept a translation that was not reviewed

What for: annotate a translation that was reviewed outside Ontotator. The row's next step is **Translation not accepted**.

1. In the row, click **Assign review or accept…**.
2. Choose one:
   - Click **Turn translation review on**, then assign a review.
   - Tick **This translation was reviewed outside Ontotator — accept it as it is**, enter a **Reason** and click **Accept and annotate**.

Ontotator records the acceptance with your name, the reason and the time. To have an accepted translation reviewed after all, click **Assign a new review…** in the **Translation** part of the text card.

### Handle a text change for open annotation work

What for: decide what happens when a text gets a new version while someone is still annotating the old one. The row's next step is **Handle text change**.

Before you start: if the task is paused by a problem report, [decide the report](#decide-on-a-problem-report) first.

1. In the row, click **Handle text change…**. A task from proposals, or a task on a correction that was not accepted, only offers **Withdraw**: tool proposals mark places in the old text and cannot follow the new one. The dialog says why and what to do next.
2. Choose one:
   - Move to the new version: the annotator continues on the corrected text; their draft findings are carried and marked for checking.
   - Let the annotator finish on the old version: the result is carried to the new version for them to check.
   - **Withdraw**: the task ends, nothing of the draft is carried, and the new version needs a new annotation. Assign it afterwards.
3. Click **Apply**.

### Carry submitted work to a new text version

What for: reuse submitted findings after the text was corrected. The row's next step reads, for example, *Carry to v2…*.

1. In the row, click the carry button, for example *Carry to v2…*.
2. Choose who continues: the author, **Someone else…** (then pick the **Annotator**), or annotate the new version from scratch.
3. Click **Assign**.

The annotator must check the carried findings before submitting ([Review carried findings](annotator.md#review-carried-findings)).

## Problem reports

Annotators and reviewers can report a problem with a text. This pauses their task until you decide.

### Decide on a problem report

What for: answer a report and let the work go on.

1. On **Documents**, click **Decide on report…** in the row. Or click **Open report** in the text card.
2. Read the report: who reported it, the reason and the history.
3. In the common case, write an optional answer and click the close-and-resume button, for example *Close and resume Task 12*.
4. For other cases, open **Other decisions** and choose one:
   - **Close report…** or **Close, keep paused…**: close it with an outcome for the reporter.
   - **Release pause…**: let paused tasks continue.
   - **Pause other tasks…**: pause other tasks on the same text or project.
   - **Agree empty restart…**: restart the task with an empty round, after agreeing with the reporter.
   - **Reopen report…**: open a closed report again.
5. Confirm in the form that opens.
6. Click **Back to Documents**, or go to the next decision.

![The decision card of a problem report. Close and resume is the common decision; the others are under Other decisions.](images/lead-problem-report.png)

A final result is never changed here. If a task is still paused after the report was closed, the row shows **Resume task…**; click it and release the pause.

## Export

### Export final results

What for: download the accepted final results.

1. In the sidebar, click **Export**. Or click **Export final results…** on **Documents** or **Progress**.
2. The card **Final results** checks every text. It lists texts that need your decision and texts left out because they have no final result.
3. If texts need your decision or are left out, a tick box names how many results are exported and how many texts are left out, for example *Export the 3 results as they are; leave out the other 243 texts*. Tick it to export now anyway. Without the tick, **Create final export** does not start. The export's README.txt lists the left-out texts and the warnings you acknowledged with this tick.
4. Click **Create final export**.
5. When it is ready, click **Download (ZIP)**.

![The final results check on the Export page](images/lead-export.png)

Click **Check again** after you accepted more results. **What is in the file?** explains the contents. Values that annotators never confirmed are marked as *defaulted* in the file; proposals still unresolved in an accepted submission keep their reviewer flag and note. Once a consolidator decides such a group, the result is a normal decided finding, or no finding if left out, and the annotator's note stays in the provenance part of the export. The file formats are described in the [scientific workflow guide](../scientific-workflow.md) and the [translation review export guide](../translation-review-export.md).

Each text in an export names the ontology release its work was made under, which can be older than the project's current release. If the texts of one export were made under different releases, the newest keeps the layer ID (for example `hpo-layer`) and each older release gets a layer of its own (`hpo-layer@<start of its checksum>`), which the file lists with its release and checksum.

### Export research data

What for: download raw material for analysis. People appear as pseudonyms.

1. On **Export**, go to **Research data**.
2. Choose a row: **Annotation results**, **Edit log** or **Translation reviews**.
3. Click **Create**, then **Download** when it is ready.

How to analyse these files is described in the [scientific workflow guide](../scientific-workflow.md).
