# Lead: project settings

This chapter is for project leads. It covers every tab under **Settings**: the project name and languages, the ontology, the submission rules, the workflow, the people and the guidelines. Back to the [lead overview](lead.md).

General, Annotation, Workflow and Ontology have a **Save changes** button at the bottom. People and Guidelines save each change at once.

| Tab | What you set there |
| --- | --- |
| **General** | [Name and description](#change-the-project-name-and-description), [languages of the texts](#set-the-languages-of-the-texts) |
| **Annotation** | [Submission rules](#set-the-submission-rules), [prefilled values](#set-prefilled-values-for-new-findings), [values annotators can choose](#limit-the-values-annotators-can-choose) |
| **Workflow** | [Plan for new imports](#choose-the-plan-for-new-imports), [texts with tool proposals](#choose-how-texts-with-tool-proposals-are-annotated), [annotators per text and consolidation rules](#set-annotators-per-text-and-the-consolidation-rules) |
| **Guidelines** | [Publish](#publish-the-first-or-a-new-guideline-version), [see who read them](#see-who-has-read-the-guidelines), [republish](#republish-an-earlier-guideline-version), [withdraw](#withdraw-a-guideline-version) |
| **People** | [Add](#add-a-member), [change roles](#change-a-members-roles), [remove](#remove-a-member) |
| **Ontology** | [Ontology version and annotation scheme](#choose-the-ontology-version-branches-and-annotation-scheme), [task profile](#replace-the-task-profile), [move to a newer release](#move-a-started-project-to-a-newer-release) |

## Open project settings

What for: reach all settings of the current project.

1. In the sidebar, click **Settings**. You can also click **Settings** in the project's row on **Projects**.
2. Choose a tab: **General**, **Annotation**, **Workflow**, **Guidelines**, **People** or **Ontology**.
3. After a change, click **Save changes**. The page then says, for example, *General saved.*
4. To undo your edits before saving, click **Discard changes**.

If you leave a tab with unsaved edits, a dialog asks you to **Save changes**, **Discard changes** or **Cancel**.

## Change the project name and description

What for: give the project a clear name and a short description on **Projects**.

1. Open **Settings**, tab **General**.
2. In the card **Name and description**, edit **Name** and **Description**.
3. Click **Save changes**.

## Set the languages of the texts

What for: make sure every imported text is in a language you expect. An import refuses texts in other languages. Leave the list empty to allow any language.

1. Open **Settings**, tab **General**, card **Languages**.
2. Type a language code into **Languages of the texts**, for example `de`.
3. Press Enter or click **Add language**.
4. To remove a language, click ✕ next to its code (its name is *Remove de*, for example).
5. Click **Save changes**.

A typed code that you did not add blocks saving: **Add this language code before saving.**

## Choose the ontology version, branches and annotation scheme

What for: decide which ontology release annotators search in.

Before you start: you can change this until the first work is submitted. After that, see [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).

1. Open **Settings**, tab **Ontology**.
2. In **Ontology version**, choose the release for each ontology. Only releases an administrator uploaded on **Ontologies** are offered.
3. Optional: open **Advanced**.
   - Limit the terms to some branches (parts of the ontology below one term): enter term codes separated by commas, for example `HP:0000118`. Empty means every term.
   - Choose the annotation scheme: **HPO phenotype (fixed qualifiers, modifiers)** or **Generic (free qualifiers)**. "Qualifiers" are the value fields of a finding.
4. Click **Save changes**. If the change would rewrite or flag terms in drafts, a check opens first, as in [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).

## Replace the task profile

What for: change the layers, finding types and value fields annotators work with. The task profile is the JSON file that defines them.

Before you start: this is only possible before work starts.

1. Open **Settings**, tab **Ontology**, and open **Advanced: task profile**.
2. Check **Current profile layers**.
3. Choose a JSON file in **Profile file (JSON)**. The new layers appear under **Profile layers**.
4. Click **Save changes**. The page says *Task profile saved.*

## Move a started project to a newer release

What for: move to a newer ontology release after work was submitted. Drafts are updated; submitted work stays as it was submitted.

Before you start: an administrator must have uploaded the new release ([Upload ontology releases](admin.md#upload-ontology-releases-and-translation-files)).

1. Open **Settings**, tab **Ontology**. The card **Ontology** shows the current release.
2. Under **Move to another release**, choose the new release.
3. Click **Check changes**.
4. Read the panel **Check before moving**:
   - The first table (**Becomes**, **Why**) lists draft terms that will be replaced by their successor.
   - The second table (**Status**, **Suggestions**) lists draft terms that are obsolete or missing in the new release. Their annotators must change them before submitting.
5. Click **Move to this release**, or **Cancel**. The page says **Ontology release changed.**

![The check before moving to another release. The first table shows which draft terms are replaced automatically, the second which ones annotators must change by hand.](images/lead-move-release-check.png)

If drafts changed meanwhile, you see **Drafts or pins changed since the check. Check the changes again before moving.** Click **Check changes** again.

## Set the submission rules

What for: decide what annotators must do before they can submit.

1. Open **Settings**, tab **Annotation**, card **When submitting**.
2. In **Findings that point to no text passage**, choose **Not allowed**, **Allowed with a reason** or **Allowed, reason optional**.
3. Tick **Annotators must confirm every value before submitting** if prefilled values may not be submitted unconfirmed.
4. Tick **A finding must be one continuous passage** if a finding may not have several text segments.
5. Click **Save changes**. The rules apply to every submission from now on.

## Set prefilled values for new findings

What for: new findings start with these values. They stay marked as not confirmed until the annotator confirms or changes them.

1. Open **Settings**, tab **Annotation**, card **Prefilled values**.
2. For each value field, choose a value, or **No prefill**.
3. Click **Save changes**.

## Limit the values annotators can choose

What for: hide values the project does not use from the editor.

1. Open **Settings**, tab **Annotation**, and open **Values annotators can choose**.
2. Click a value to switch it off (hidden) or on (shown). The prefilled value of a value field cannot be hidden.
3. Click **Save changes**.

Existing findings keep their values. A finding with a hidden value must be changed before it is saved again.

## Choose the plan for new imports

What for: decide whether newly imported translations get a translation review and an annotation by default.

1. Open **Settings**, tab **Workflow**, card **New imports**.
2. Choose **Plan review and annotation for every translation** or **Plan nothing; I plan texts on Documents**.
3. Click **Save changes**.

With **Plan nothing; I plan texts on Documents**, new texts appear on **Documents** as *Not decided* (filter **Not decided**) until you plan them ([Plan several texts at once](lead-documents.md#plan-several-texts-at-once)).

## Choose how texts with tool proposals are annotated

What for: set the project default for texts that came with tool proposals.

1. Open **Settings**, tab **Workflow**, card **Texts with tool proposals**.
2. Choose **Annotators work from the proposals** (they confirm, reject, correct and add) or **Annotators start from scratch** (proposals are hidden).
3. Click **Save changes**.

A text's own plan can override this until work on it starts.

## Set annotators per text and the consolidation rules

What for: decide how many people annotate each text and who may consolidate.

1. Open **Settings**, tab **Workflow**, card **Annotation and consolidation**.
2. Set **Annotators per text** (1 to 5). It is an upper limit; fewer is fine.
3. Tick **Annotate only after the translation review is accepted** if translations must be reviewed before annotation.
4. Tick **Consolidator must not be one of the text's annotators** if annotators may not consolidate their own texts.
5. Click **Save changes**.

Lowering the number removes nobody; existing assignments stay.

## Add a member

What for: let a person work in this project.

Before you start: the person needs an account ([Create a user account](admin.md#create-a-user-account)).

1. Open **Settings**, tab **People**.
2. Click **Add member…**.
3. In **Username**, type at least three letters of the name, or the exact username or e-mail. Pick the person from the suggestions.
4. Tick one or more roles: **Lead**, **Annotator**, **Consolidator**.
5. Click **Add member**. The page confirms the new role.

Annotators also do translation reviews. Only people with the **Consolidator** role can be chosen as consolidator of a text. Ontotator sends no e-mail; tell the person that they were added.

## Change a member's roles

What for: give or take away a role.

1. Open **Settings**, tab **People**. The table **Project members** shows one row per person.
2. Tick a role checkbox to give the role. It saves at once.
3. Untick a role checkbox to take it away, then confirm with **Remove role**. This logs the person out on all devices; they can log in again right away.

A project needs at least one lead: **Add another project lead before removing the last lead.**

The system administrator who created the project is a member with all three roles. If they do not annotate or consolidate, take away those roles so that they no longer appear in the assign lists.

## Remove a member

What for: take someone off the project.

Warning: if the person still has open work, removing them revokes their open assignments. Submitted work stays in the history.

1. Open **Settings**, tab **People**.
2. In the person's row, click **Remove…**.
3. Confirm with **Remove from project**.
4. If the person still has open work, the dialog **Revoke affected assignments?** lists it. Click **Remove and revoke their open assignments**.

## Publish the first or a new guideline version

What for: give annotators and reviewers the rules they work by. They find the guidelines in every task.

Before you start: published versions cannot be edited, only withdrawn. Check the file before you publish.

1. Open **Settings**, tab **Guidelines**.
2. Without guidelines, the form is already open (**No guidelines yet**). Otherwise, click **Publish a new version**.
3. Choose a `.md` or `.txt` file (UTF-8, up to 256 KB) in **Guideline file (.md or .txt, up to 256 KB)**.
4. Check the preview.
5. Optional: describe the change in **What changed? (optional)**.
6. Click the publish button, for example *Publish as v2*. Or click **Discard**.

Everyone sees a notice in their next task.

## See who has read the guidelines

What for: check which version is in force and who has not opened it yet.

1. Open **Settings**, tab **Guidelines**. The top card shows the version **In force**.
2. Read **Seen by**. Open **who not yet?** to see the names.
3. Click **Read** to read a version. Close it with ✕.

Older versions are listed under **All versions**.

## Republish an earlier guideline version

What for: go back to an earlier text.

1. Open **Settings**, tab **Guidelines**.
2. In the row of the old version, click **More…**, then the republish item, for example *Republish v1…*.
3. The form opens with the old text. Click the publish button, for example *Publish as v3*.

## Withdraw a guideline version

What for: remove a version that must no longer be read, for example because it contains a mistake.

Warning: the text of the withdrawn version is deleted for good. The version number stays, and results made under it show it as withdrawn. No guideline is in force until you publish or republish one.

1. Open **Settings**, tab **Guidelines**.
2. In the version's row, click **More…**, then the withdraw item, for example *Withdraw v2…*.
3. Optional: enter **Reason (optional)**. Do not repeat confidential content.
4. Confirm, for example with *Withdraw v2*.
