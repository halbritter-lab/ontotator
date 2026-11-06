# Lead: change course in a running project

This chapter is for project leads whose project is already under way and must change direction: a better translation turns up, finished texts must be annotated again, or there are more texts than the team can finish. Each procedure says what Ontotator does today and where it stops. Back to the [lead overview](lead.md).

What stays fixed in every case:

- Texts cannot be deleted. A text you no longer want stays in the project; you take it out of the plan ([Narrow the scope](#narrow-the-scope)).
- A submission never changes. New work is a new round or a new submission; the earlier one stays in the history.
- A final result can be replaced with **Change final…**, never withdrawn. While a text has a final result, its annotation mode cannot be changed.
- There is no pause button for texts. A task is paused only by a problem report ([Decide on a problem report](lead-results.md#decide-on-a-problem-report)).

## Use another translation of a text

What for: bring in a translation made elsewhere, for example by another machine translation system or a person, for a text that already has a translation in the project.

Before you start: decide whether the new text replaces the current translation or stands beside it.

- *Replace*: the new text becomes the next version of the translation, for example v2. Annotation moves on to it; the old version stays in the history.
- *Beside it*: the new text is a parallel translation of the same source in the same language. Each one is reviewed on its own. With **Annotate only after the translation review is accepted** on, annotation of the text waits until every translation of it is accepted.

### Replace the translation in the app

This works without a file. The new text is pasted into a translation review.

1. Open the text card and click **Translation**.
2. If the current version is accepted: at the version, click **Request correction…**, choose the **Translation reviewer**, enter the **Reason for another review** (say where the new text comes from) and click **Assign correction review**. The reviewer replaces the text, writes the origin into the **Rationale** and submits **Accepted with corrections** ([Request a translation correction](lead-documents.md#request-a-translation-correction)).
3. If the current version was rejected or queried: click **Resolve…**, then **Correct the translation…**, paste the new text yourself and submit ([Correct a translation yourself](lead-results.md#correct-a-translation-yourself)).
4. The corrected text becomes the next version and counts as accepted.

**Request correction…** is offered only at an accepted version, and **Correct the translation…** only at the newest version after a rejection or a query. The provider or model of the new text can only be named in the **Rationale**; Ontotator has no field for it.

### Replace or add a translation by file

1. Build an Ontospan bundle with the new text, as described in [Corrections and parallel translations in a bundle](lead-documents.md#corrections-and-parallel-translations-in-a-bundle).
2. On **Documents**, click **Upload texts…**, choose the **Format** **Ontospan bundle**, choose the file and click **Check**.
3. In the preview, open **Texts in this upload** and choose **Corrections** (or **Translations**) under **Show** to check that each new text was recognised as you meant.
4. Import the upload.
5. Decide whether the new version is reviewed:
   - With **Translation review** on for the text, the row's next step is **Assign review…**. Assign a reviewer as usual ([Assign work for one text](lead-documents.md#assign-work-for-one-text)).
   - With it off, the row's next step is **Assign review or accept…** ([Accept a translation that was not reviewed](lead-results.md#accept-a-translation-that-was-not-reviewed)).
   - To accept it without a review while Review is on: open the text card, click **Translation** and set **Review** to **Off**. If annotation must wait for an accepted translation, the card asks for a **Reason**; click **Save change**. This accepts the newest version of every translation of the text, parallel translations included, not only the one you uploaded.
6. If someone is still annotating the old version, or a submission exists on it, the row shows **Handle text change…** or *Carry to v2…*. Decide as in [Handle a text change for open annotation work](lead-results.md#handle-a-text-change-for-open-annotation-work) and [Carry submitted work to a new text version](lead-results.md#carry-submitted-work-to-a-new-text-version).
7. If the text already has a final result, the row asks you to confirm it: [Review changes to a final result](lead-results.md#review-changes-to-a-final-result).

The checkbox **These translations were reviewed outside Ontotator — accept them as they are** in the upload applies only to texts new to the project. A correction of an existing text is accepted with step 5.

To drop a translation, it must first be rejected or queried in a review: the discard item is offered only under **Resolve…** ([Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation)).

## Annotate texts again

What for: have texts annotated again, for example after a guideline change, with new tool proposals, or by more people.

Before you start: [publish the new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version) if the rules changed.

### The same annotators revise their work

1. Open the text card and click **Annotation**.
2. In each person's row, click **Reopen…**, enter a **Reason (optional)** (for example what changed in the guidelines) and click **Reopen assignment**.
3. The task shows **Reopened** in their **My tasks**. They continue on their submitted work as it was: nothing is carried and nothing is marked **Check needed**.
4. When they submit again and the text already has a final result, the row's next step is **Confirm final result**. Choose the newer result or keep the old one ([Review changes to a final result](lead-results.md#review-changes-to-a-final-result)).

Annotators can also do this themselves: **More** › **Work rounds** › **Continue from** starts a new round from their submission, where each carried finding must be checked again ([Start a new work round](annotator.md#start-a-new-work-round)).

An empty start is possible only before the first submission (**Start empty round**). After a submission, an empty round needs your agreement: the annotator [reports a text problem](annotator.md#report-a-text-problem) and you choose **Agree empty restart…** ([Decide on a problem report](lead-results.md#decide-on-a-problem-report)). A task from proposals restarted this way has no proposals.

### Work from new tool proposals

A proposal set you import later is used only by annotation rounds that start after the import, for example for a new assignment of a text planned **Annotate from proposals**. A task keeps the proposals its round started with, also after **Reopen…** or a new round from a submission.

1. Import the new proposals in an Ontospan bundle ([Upload texts](lead-documents.md#upload-texts)). Only sets of kind `tool_output`, made entirely by tools, can be imported.
2. For a text without assignments, assign it: it starts from the newest proposals.
3. For a text with work on it and no final result: open the text card, click **Annotation** and click **Change mode…**. Enter the **Reason** and click **Discard work and change mode** (or **Change mode**). The text is now from scratch, and the work on the whole text is discarded, submitted work included; the assignments are removed ([Change the annotation mode of one text](lead-documents.md#change-the-annotation-mode-of-one-text)). Then choose **From proposals** under **Annotation** and assign the text again.

For a text with a final result this is not possible: **Change mode…** is refused with *A final result was chosen for this text, so its annotation mode stays.*

### More annotators on finished texts

1. Raise the limit: **Settings**, tab **Workflow**, **Annotators per text** ([Set annotators per text and the consolidation rules](lead-settings.md#set-annotators-per-text-and-the-consolidation-rules)).
2. For texts without a final result, assign as usual: select them and click **Assign annotation…**.
3. Texts with a final result are left out of the assign dialog, for one text as for many: it says *This text is at another step of the plan.* Only the command line or the API add an annotator to such a text ([On the command line](#on-the-command-line)).
4. When their submissions arrive, the row asks you to confirm the final result. To use another result, click **Change final…** and **Use as final** ([Change a final result](lead-results.md#change-a-final-result)), or start a consolidation.

## Narrow the scope

What for: finish fewer texts than planned, for example when the work goes slower than hoped.

1. Select the texts to take out. Use **Select by case IDs…** with a list from a spreadsheet, or a filter and the checkbox in the table header ([Select texts](lead-documents.md#select-texts)). The dialog only selects the IDs you paste; to keep a list of texts and take out all others, build the list of the others outside Ontotator. One selection holds at most 2000 cases.
2. Click **Plan…** in the selection bar.
3. Under **Annotation**, choose **Off (not annotated)** for each language. Under **Translation review**, choose **Off** if the reviews should stop too.
4. Read what will change. Open tasks are withdrawn; annotation drafts are kept. Final results of these texts stay in the history but are no longer exported.
5. Tick **I understand** (or **I understand — withdraw the open tasks**) and save again.

Texts with neither a translation review nor an annotation planned leave the main list. To see them, tick **Show texts not in plan** on the tab **All**. On **Export**, they are listed under **Not planned, not exported**; the export's README.txt does not name them.

To take the change back, click **Undo** in the message. It restores the plan and the final results as they were, without asking you to confirm them again, but not the withdrawn tasks: assign those again. Planning a text again later, instead of Undo, asks you to confirm its earlier final result.

Other ways to make the work smaller:

- Fewer people per text: lower **Annotators per text**. Nobody is removed; texts that already have more annotators keep them. Lowered from the info button in the assign dialog, the limit says how many texts already have more, but there is no list of them. Remove the extra people one by one with **Remove…** in the text card ([Remove, reassign or reopen an assignment](lead-documents.md#remove-reassign-or-reopen-an-assignment)).
- Order of work: there is no priority. **My tasks** lists open tasks by status, then in the order the texts were imported, so texts uploaded later come last. Assign the urgent texts first and the rest later.
- Stop work for a while without withdrawing it: only through a problem report, with **Pause other tasks…**.

## On the command line

Whoever runs the server can do some of this on the command line ([Server operations](../operations.md#users-ontologies-and-projects)):

- `ontotator admin import PROJECT FILE` imports a bundle as **Upload texts…** does. `--accept-translation EXTERNAL_ID:LANG:VERSION=REASON` accepts exactly one translation version of the bundle, a correction included, as reviewed outside Ontotator; repeat it for more.
- `ontotator admin assign PROJECT USER --document ID` assigns an annotation of the text with that document ID (see **Technical details** in the text card's **Details**), also on a text with a final result, within **Annotators per text**. Repeat `--document` for more texts. It cannot assign translation reviews or consolidations.

There is no command to request a translation correction, to discard a translation or to change the annotation mode; use the app for these.
