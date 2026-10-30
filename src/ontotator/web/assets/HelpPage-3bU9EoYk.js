import{r,a as m,j as a,b as h}from"./index-hWtTQpl8.js";import{M as f,r as g}from"./index-BFSSo1W5.js";function w(){const[e,t]=r.useState(null);return r.useEffect(()=>{let o=!0;return m.getAbout().then(n=>{o&&t(n)},()=>{}),()=>{o=!1}},[]),e?a.jsxs("p",{className:"help-version",title:e.revision??void 0,children:["Ontotator ",e.version,e.revision&&a.jsxs(a.Fragment,{children:[" · commit ",e.revision.slice(0,7)]})]}):null}const y=`# Ontotator user handbook

This handbook explains how to work with Ontotator in the browser. It is for everyone who uses the app: annotators, translation reviewers, consolidators, leads and system administrators. It describes the version of Ontotator that you open it from. If you run the server, read the [server operations guide (for server operators)](../operations.md) instead.

## Start here

| You are… | Read first | Then |
| --- | --- | --- |
| New to Ontotator, any role | [Getting started](getting-started.md) | the chapter for your role |
| Annotator or translation reviewer | [Your first task, start to finish](first-task.md) | [Annotator reference](annotator.md) |
| Consolidator | [Typical consolidation, start to finish](consolidator.md#typical-consolidation-start-to-finish) | [Consolidator chapter](consolidator.md) |
| Project lead | [Lead overview and typical project](lead.md) | [Settings](lead-settings.md), [Documents](lead-documents.md), [Results and export](lead-results.md) |
| System administrator | [Administration](admin.md) | |

Stuck? See the [frequently asked questions](faq.md).

## What Ontotator is

Ontotator is a web app for marking findings in clinical texts and linking each one to a term of an ontology, for example the Human Phenotype Ontology (HPO). Several people annotate the same text, each on their own. The project lead then chooses one final result per text, either one submission or a merged consolidation. The final results are exported for research.

### Why people work independently

Each annotator works blind: you never see other people's work on the same text, only your own and, in some tasks, a tool's proposals. This keeps the results independent, so that the project can measure how well annotators agree and find texts or rules that are unclear. Only leads and consolidators see everyone's work.

### What happens to your work

- While you work, everything is saved automatically as a draft. Nobody else sees your draft.
- When you submit, your work becomes a fixed **submission**. The lead sees it; other annotators do not.
- The lead accepts one result per text as the **final result**, or asks a consolidator to merge differing submissions. Only final results are exported. Exports show your pseudonym, not your name.

## Roles

You can have more than one role. Roles other than system administrator apply to one project. The header shows your roles under your name.

| Role in the UI | What you do | Chapter |
| --- | --- | --- |
| **Annotator** | Mark findings in the texts assigned to you, check tool proposals, submit your work. Annotators also do translation reviews. | [Annotator reference](annotator.md) |
| **Translation reviewer** | Not a separate role you can be given: any annotator can get a translation review task. The header shows this name while you work on one. | [Review a translation](annotator.md#review-a-translation) |
| **Consolidator** | Merge the differing submissions on one text into one result. | [Consolidator chapter](consolidator.md) |
| **Lead** | Set up the project, upload texts, plan and assign work, publish guidelines, accept results, export. | [Lead overview](lead.md) |
| **System administrator** | Create user accounts, upload ontology releases, create projects. | [Administration](admin.md) |

## How work flows

(translation review →) annotate → accept, or consolidate and accept → export

![How work flows: the lead uploads clinical texts, some of them translated; a reviewer checks each translation against its source; several annotators each annotate the same text on their own; if their submissions agree, the lead accepts one as the result; if they differ, a consolidator merges them into one result; the lead exports one final result per text](images/workflow.png)

1. **Translation review** (only for translated texts, if the project plans it): an annotator checks the translation against the source and accepts, corrects, queries or rejects it. The lead decides what happens with queried or rejected translations.
2. **Annotate**: the lead assigns a text to one or more annotators. Each annotator marks findings, either from scratch or from tool proposals. In a task from proposals, the annotator confirms, rejects or replaces each proposal. Then they submit the text.
3. **Accept**: on the **Documents** page, the lead sees all submissions of a text. If they agree, or if one is clearly right, the lead clicks **Accept result** or **Use as final**.
4. **Consolidate**: if the submissions differ, the lead clicks **Consolidate…** and picks a consolidator. The consolidator decides each difference and submits one merged result. The lead then accepts it.
5. **Export**: the lead exports the final results of the project.

A lead can also reopen a submission, and an annotator can continue from their own submission in a new work round. A problem report pauses a task until it is decided.

## Glossary

Words you meet in the app, in alphabetical order. The handbook uses one word per concept; where the app uses a second word, it is named here.

| Word | Meaning |
| --- | --- |
| Agreement | On the lead's text card: how many findings of the submissions on a text match. Findings that match in term and passage but differ in a value "differ in context only". |
| Annotation scheme | The set of value fields and modifiers a project uses, for example **HPO phenotype (fixed qualifiers, modifiers)**. |
| Branch | A part of an ontology: one term and everything below it. A project can limit search to some branches. |
| Carried finding | A finding taken over from an earlier round or text version into your current task. You check each one before you submit: it is marked **Check needed** until you do. To *carry* work means to take it over this way. |
| Case | One clinical document in all its languages, identified by its **case ID**. A case has one text per language. |
| Consolidation | A task that merges differing submissions on one text into one result. |
| Consolidator | The person who does a consolidation. Needs the **Consolidator** role in the project. |
| Default (prefilled value) | A value a new finding starts with, tagged **Default**. It counts as not confirmed until you confirm or change it. |
| Document | The app's word for a text on the **Documents** page and in a few labels such as **People per document**. Same as *text* in this handbook. |
| Final result | The one submission or consolidation per text that the lead accepts. Only final results are exported. |
| Finalization | The third part of the lead's text card, where the lead accepts the final result or starts a consolidation. |
| Finding | One ontology term marked in a text, with its values, modifiers and zero or more mentions. |
| Group | In a consolidation: the findings from different submissions on overlapping passages, decided together. |
| Guidelines | The project's annotation rules. Leads publish numbered versions (v1, v2, …); you read the version in force. |
| Layer | Part of the annotation setup with its own ontology. Each required layer must be checked before you submit. A **Reference** layer is read-only; a **Locked** layer cannot be edited. |
| Mention | A marked passage of text that supports a finding. A finding can have several mentions. |
| Modifier | An HPO term such as a severity or an onset, attached to a finding. |
| Ontology release | A loaded version of an ontology, for example one HPO release. Each project uses one release. |
| Ontospan bundle | A file format for uploading texts together with their translations and tool proposals. See [Prepare files for upload](lead-documents.md#prepare-files-for-upload). |
| Paused | A task that waits for a decision on a problem report. You can read it but not change or submit it. |
| Pin | A project *pins* the ontology release it uses. **Pinned by** on the **Ontologies** page lists those projects. |
| Problem report | A report that a text has a problem. It pauses your task until the lead decides. |
| Project | A unit of work with its own texts, people, ontology release, guidelines and settings. |
| Proposal layer | The tool proposals uploaded with a text. |
| Pseudonym | Your stable ID, for example \`ann-0004\`. Exports show it instead of your name. |
| Reopened | A submission the lead opened again for changes. Your task shows **Reopened** with the lead's reason. |
| Round | One pass of work on a task. A task can have several rounds, for example after you continue from your submission or after the text changed. |
| Spanless finding | A finding that points to no text passage. The project decides whether this is allowed and whether it needs a reason. |
| Submission | The fixed result of a task or round. To change it, a new round starts. |
| Task | Your piece of work on one text: Annotation, Translation review or Consolidation. |
| Task profile | The JSON file that defines a project's layers, finding types and value fields. |
| Text | One language version of a case, for example *CASE-1 en*. Tasks are always on one text. |
| Text card | The panel that opens on the lead's **Documents** page for one text, with the parts **Translation**, **Annotation** and **Finalization**. |
| Text version | One revision of a text (v1, v2, …). A correction creates a new version; the old one stays. |
| Tool proposal | A finding suggested by an external tool and uploaded with the text. You confirm, reject or replace it. |
| Translation review | A task in which you check a translated text and accept it, correct it, query it or reject it. |
| Unresolved | A decision on a tool proposal: you cannot decide it and leave a note for the lead. Not the same as clinical uncertainty (the value **Uncertain**). |
| Value field | One line under **Values** in a finding, with a fixed list of values, for example the assertion (**Present**, **Absent**, **Uncertain**). Scheme names call them *qualifiers*. |
| Work plan | Per text: whether it gets a translation review, and whether and how it is annotated. |

## Chapters

1. [Getting started](getting-started.md): log in, set your password, find your tasks, edit your profile.
2. [Your first task, start to finish](first-task.md): one annotation task from login to submission.
3. [Annotator reference](annotator.md): the editor, findings, values, tool proposals, carried findings, submitting, problem reports, translation review.
4. [Consolidator chapter](consolidator.md): how to decide, the groups, finishing a consolidation.
5. [Lead overview](lead.md): the typical project, with [Settings](lead-settings.md), [Documents](lead-documents.md) and [Results and export](lead-results.md).
6. [Administration](admin.md): user accounts, ontology releases, projects.
7. [FAQ](faq.md): typical problems and what to do.

## How the handbook writes things

- **Bold** text is a label exactly as the app shows it, for example **My tasks**. <!-- handbook: not-a-label -->
- *Italic* text is an example of a label or message that changes, for example *Publish as v2* or *CASE-1 en*.
- Keys are written like \`Ctrl+Z\` (macOS: \`Cmd+Z\`). A letter key such as \`j\` means the plain key; \`Shift+K\` means with Shift.
`,k=`# Administration

This chapter is for system administrators. You manage user accounts, ontology releases and projects in the app. Back to the [handbook overview](README.md).

Server set-up, the command line, backups, upgrades and deployment are in the [server operations guide (for server operators)](../operations.md). A lost administrator password is also handled there: see [Lost admin password](../operations.md#lost-admin-password).

Ontotator sends no e-mail. New users and users who forgot their password get a one-time code from you, by hand.

## Set up a new project for a lead

The usual first day, in order:

1. [Upload the ontology release](#upload-ontology-releases-and-translation-files) the project needs.
2. [Create the project](#create-a-project).
3. [Create a user account](#create-a-user-account) for the lead, with the **Lead** role in the new project.
4. [Hand over the setup code](#hand-over-a-setup-or-reset-code) to the lead.

The lead then sets up the rest; see the [lead overview](lead.md).

Try it with the demo project: the [demo project guide](../../examples/demo-project/README.md) has an HPO release link, suggested users and all files to upload for a fully synthetic project.

## Reach the administration pages

What for: find the pages only system administrators see.

1. Log in. Your role line in the header reads **System administrator**.
2. In the sidebar, open the group **Administration**.
3. Click **Users**, **Ontologies** or **New project**.

Other users do not see this group. If they open such a page by its address, they get a short explanation instead.

## Find and review user accounts

What for: check who has an account, whether they finished setup and when they last logged in.

1. In the sidebar, open **Administration** › **Users**.
2. Type a username or display name into **Filter users**.
3. Read the table. **Setup** shows **Pending** until the person has set a password. **Last login** shows **Never** if they have not logged in yet. **Active** reads **Yes**, **No** or **Anonymised**. **Projects** shows how many projects the person belongs to; click it to see the projects and the person's roles in each.
4. Click a row to highlight it. Click it again to clear the highlight.
5. Click **Refresh users** to reload the list.

## Create a user account

What for: give a new person access to Ontotator.

1. On **Users**, click **New user…**.
2. Fill **Username** and **Display name**. **E-mail**, **Qualification** and **Languages** are optional.
   - **Qualification**, for example *physician*, is needed before the person can submit a translation review.
   - **Languages** are the languages the person reads. Leads see them when they assign work, and **Distribute evenly…** proposes only people who read a text's languages. Leave them empty if you do not know them: no languages count as unknown, not as "reads nothing", and such a person is proposed only where nobody who lists the language is left.
3. Tick **System administrator** only if the person should manage the whole server.
4. Optional: under **Add to projects (optional)**, tick a role per project: **Lead**, **Annotator** or **Consolidator**. With many projects, type into **Find project** to narrow the list.
5. Click **Create user**.
6. The setup-code dialog opens. [Hand over the code](#hand-over-a-setup-or-reset-code).

The username uses 3–64 lower-case letters, digits, dots, hyphens or underscores. If it is taken or invalid, the message appears at the field.

## Hand over a setup or reset code

What for: let a person set their own password. Codes are shown only once.

1. A dialog opens with the title **Setup code** or **Reset code** and the username. It shows the code and when it expires.
2. Click **Copy hand-over text**. This copies short instructions with the login address, the username and the code. Open **Hand-over text** to read it first. **Copy** copies only the code.
3. Give the text to the person in person or by a secure channel.
4. Tick **I have handed over or stored the code**.
5. Click **Close**.

![Setup code dialog with the hand-over text open and the confirmation box](images/admin-setup-code.png)

You cannot close the dialog or leave the page until the box is ticked. Setup codes last 24 hours, reset codes 2 hours. The person then uses **I have a setup or reset code** on the login page, see [Getting started](getting-started.md#set-your-password-with-a-setup-or-reset-code).

## Issue a new setup or reset code

What for: a code expired, got lost, or someone forgot their password.

1. On **Users**, click **More…** in the person's row.
2. Choose **New setup code** (setup still pending) or **Reset code** (password already set).
3. Confirm with **New setup code** or **Reset code**. Any earlier unused code stops working. With a reset code, the current password keeps working until the new code is used.
4. [Hand over the code](#hand-over-a-setup-or-reset-code).

Deactivated accounts get no new code. Activate the account first.

## Edit a user's profile and administrator role

What for: correct a name, e-mail, qualification or languages, or grant or remove the administrator role.

1. On **Users**, click **Edit** in the row.
2. Change **Display name**, **E-mail**, **Qualification**, **Languages** or **System administrator**.
3. Click **Save changes**.
4. If you changed the administrator role, confirm with **Save changes** again. The person is logged out everywhere.

You cannot remove your own administrator role. The last active system administrator cannot lose the role either; add another one first.

## Deactivate or activate an account

What for: stop someone from logging in, without deleting their work.

1. On **Users**, click **More…** in the row.
2. Choose **Deactivate…**.
3. Confirm with **Deactivate**. The person is logged out everywhere.
4. To undo, open **More…** again and choose **Activate**.

You cannot deactivate your own account. In project member lists the person shows as **Inactive**.

## See a user's history

What for: check what was changed on an account and by whom.

1. On **Users**, click **More…** in the row and choose **History**. For anonymised accounts, click the **History** button in the row.
2. Read the table: **When**, **By**, **What**, **Whom**, **Project**, **Details**.
3. The dialog shows the newest 200 entries. For the whole trail, use the command \`ontotator admin audit\`, see [Server operations](../operations.md#users-ontologies-and-projects).

## Anonymise a deactivated account

What for: erase a person's personal data for good, while keeping their work.

Warning: anonymising cannot be undone.

Before you start: [deactivate the account](#deactivate-or-activate-an-account).

1. On **Users**, click **More…** in the row and choose **Anonymise…**.
2. Read what is erased. The pseudonym and all work stay, so results and exports remain complete.
3. Type the username into the confirmation field.
4. Click **Anonymise permanently**.

## Upload ontology releases and translation files

What for: make a new ontology release (for example a newer HPO) or a translation file available to projects.

1. In the sidebar, open **Administration** › **Ontologies**.
2. In **Ontology files**, choose one or more files: OBO Graph JSON ontologies (\`.json\`) or Babelon translation files (\`.tsv\`).
3. Click **Upload files**.
4. Read **Upload results**: **Added** or **Already present** per file.

Each file is stored on its own. If one file fails, earlier files may already be in the list below. Incomplete HPO releases are refused: a missing or obsolete main branch, or too many terms that do not reach the root. The message names the problem; upload a complete release instead.

## Check the ontology inventory and which projects use a file

What for: see which releases are on the server and which projects use them.

1. On **Ontologies**, look at **Uploaded files**.
2. The table lists file name, kind, release, language, checksum and upload time.
3. **Pinned by** lists the projects that use (*pin*) a file. Click a project key to open its settings on the **Ontology** tab. Unused files read **Not pinned**.
4. Click **Copy** next to a checksum to copy it.
5. Click **Refresh inventory** to reload the list.

To move a project to a newer release, upload it here, then follow [Move a started project to a newer release](lead-settings.md#move-a-started-project-to-a-newer-release).

## Create a project

What for: start a new project with its ontology and annotation scheme. Only system administrators can do this.

Before you start: [upload the ontology release](#upload-ontology-releases-and-translation-files) the project needs.

1. In the sidebar, open **Administration** › **New project**.
2. Fill **Project key** (2–63 lower-case letters, digits or hyphens) and **Name**. **Description** and **Languages of the texts** are optional.
3. Under **Profile source**, keep **Built-in template** and choose a template. Or choose **Upload profile JSON** and pick a task profile file. Which one you need: see [Task profiles](lead-settings.md#task-profiles).
4. For each ontology, choose the release in its ontology file field. With an uploaded profile, choose the file whose checksum the profile names. Optionally limit the allowed branches and choose the annotation scheme. With the template, HPO starts with the branch \`HP:0000118\` and the scheme **HPO phenotype (fixed qualifiers, modifiers)**; with an uploaded profile, the branches and the scheme start with what the file sets ([\`allowed_roots\`, \`t1_profile\`](lead-settings.md#what-a-profile-file-looks-like)), and the branches start empty (every term) if it sets none. The hint under an empty field says *Whole ontology*. What you enter here wins over the file.
5. Click **Create project**.
6. The project's settings open on **People**. [Add the lead](lead-settings.md#add-a-member) and the other members.

You are now a member of the project with all three roles. The assign dialog for reviews and annotations marks system administrators with an *Administrator* badge so that nobody assigns you work by mistake. If you do not take part in the project, [remove your roles](lead-settings.md#change-a-members-roles) once a lead is added.

![New project form with key, name, template and ontology file filled in](images/admin-new-project.png)

The template fits only Ontospan bundles that use its ontology ID (\`hp\` or \`HP\`), its layer \`hpo-layer\`, exactly the branch \`HP:0000118\` and its values; for other bundles upload the matching profile. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

The project key and the ontology of the task profile cannot be changed later. Everything else, such as name, workflow and members, is set in the [project settings](lead-settings.md).

## Open and manage any project

What for: as system administrator you can manage every project, also without a project role.

1. Click **Projects** in the sidebar, or **All projects** in the project switcher.
2. In the project's row, click **Open** to go to its documents, or **Settings** to change it.
3. Work as a lead would; see the [lead overview](lead.md).
`,b=`# Annotator reference

This chapter is for annotators and translation reviewers. It explains the editor, how to mark findings, check tool proposals and carried findings, submit a text and review a translation. Back to the [handbook overview](README.md).

New here? Start with [Your first task, start to finish](first-task.md). How to log in, find your tasks and open one is in [Getting started](getting-started.md). Words such as finding, mention, value field and modifier are explained in the [glossary](README.md#glossary).

## Contents

- Basics: [The editor screen](#the-editor-screen), [When is a task done?](#when-is-a-task-done)
- Findings: [Mark text and add a finding](#mark-text-and-add-a-finding), [Search a term](#search-a-term), [Browse the ontology tree](#browse-the-ontology-tree), [Set values and confirm defaults](#set-values-and-confirm-defaults), [Manage mentions](#manage-mentions-of-a-finding), [Add a finding without a text span](#add-a-finding-without-a-text-span), [Change term, note or delete a finding](#change-term-note-or-delete-a-finding), [Add modifiers](#add-modifiers-to-a-finding), [Turn a finding into a modifier](#turn-a-standalone-modifier-finding-into-a-modifier), [Work in several layers](#work-in-several-layers)
- Special tasks: [Review tool proposals](#review-tool-proposals), [Review carried findings](#review-carried-findings), [Re-create findings after a text correction](#re-create-findings-after-a-text-correction)
- Finishing: [Submit the text](#submit-the-text), [Confirm values and acknowledge warnings](#confirm-values-and-acknowledge-warnings-in-the-submit-dialog), [View your submissions](#view-your-submissions), [Start a new work round](#start-a-new-work-round)
- Problems: [Report a text problem](#report-a-text-problem), [Resume a paused task or withdraw a report](#resume-a-paused-task-or-withdraw-a-report)
- [Review a translation](#review-a-translation)
- [Keyboard shortcuts](#keyboard-shortcuts)

## The editor screen

![The editor: the findings list on the left, the text in the middle and the selected finding Hypotonia with its values on the right; the toolbar shows Annotate from scratch and Saved](images/annotator-editor.png)

The editor has three columns:

| Column | What is in it |
| --- | --- |
| Left: **Findings** | The list of your findings. In a task from proposals: **Review Proposals** and **Your own findings**. |
| Middle: the text | The text you annotate. Marked passages are highlighted. |
| Right: details | The selected finding: **Values**, **Modifiers**, **Note**, its mentions and the term search. With nothing selected, the **New finding** panel opens here when you mark text. |

To make the findings list wider or narrower, drag the divider between the findings list and the text (**Resize findings column**), or focus it and press \`←\` or \`→\`. On a narrow screen, the tabs **Findings**, **Document** and **Details** switch between the columns; **Back to text** returns to the text.

The toolbar shows the text name, its language and the mode:

| Mode | Meaning |
| --- | --- |
| **Annotate from scratch** | You see neither tool proposals nor other people's work. |
| **Annotate from proposals** | You see a tool's proposals, never other people's work. See [Review tool proposals](#review-tool-proposals). |
| **Review carried findings**, or the round name such as *Round 2, continued from Round 1* | Findings were carried over from earlier work. See [Review carried findings](#review-carried-findings). |
| **Check after text change** | The text was corrected. See [Re-create findings after a text correction](#re-create-findings-after-a-text-correction). |

Next to the mode, the save status tells you whether your work is stored: **Saved**, **Saving...** or **Unsaved changes**. Work is saved automatically; there is no save button. If it reads **Offline** or shows an error, click **Retry**.

The **More** menu holds **Work rounds**, **Report a text problem…**, the guidelines (for example *Guidelines v2*) and **Keyboard shortcuts (?)**.

If the text was changed elsewhere, a **Revision conflict** notice appears; click **Reload case**. A submitted task is read-only.

### Marks and badges

| You see | Meaning |
| --- | --- |
| Fill colour of a mark | The term. The same term always has the same colour; the colour says nothing about the state. |
| Solid underline | Your own finding. |
| Dashed underline | A tool proposal under review. |
| Dotted underline | A read-only reference finding. |
| Diagonal hatching | A finding with the value **Absent**. |
| Thicker underline | Overlapping findings. |
| Frame | The finding you point at or selected. |
| **AI** | Proposed by a tool. Point at the badge to see which tool. |
| **Pending** | A proposal you have not decided yet. Decided proposals show **Confirmed**, **Rejected**, **Replaced** or **Unresolved**. |
| **Defaults to confirm** | The finding still has prefilled values you have not confirmed. |
| **Check needed** | A carried finding you have not checked yet. |
| **Spanless** | A finding without a text passage. |

## When is a task done?

A task is done when you submit it. Before that:

- every finding the text states is marked, following the project guidelines;
- every value is chosen or confirmed (no **Default** left that you did not check);
- in a task from proposals, every proposal is decided;
- in a carried round, every carried finding is checked;
- you have read the whole text once more for findings you missed.

**Next open item** takes you to everything that still needs you. After you submit, the lead receives your work; see [What happens next](first-task.md#9-what-happens-next).

## Mark text and add a finding

What for: record a term that the text mentions.

1. Select the words in the text with the mouse. With the keyboard: click before the first word (or press Tab until the text has focus), hold Shift and move with the arrow keys.
2. The panel **New finding** shows the marked text. To adjust it, drag the edge handles at its start and end, or focus a handle and press \`←\` or \`→\`.
3. **Search term** is already filled with the marked words, and the hits are listed under **Terms**. Change the words, or type a code such as \`HP:0001250\`, if the right term is not among them.
4. Press Enter to add the top hit, or click a hit.
5. The finding is created with the project's prefilled values. [Confirm or change them](#set-values-and-confirm-defaults).

To drop a mark without adding a finding, click **Discard** or press Esc.

## Search a term

What for: find the right ontology term quickly.

1. Press \`/\` or click **Change term** to focus the search.
2. Type a name or a code. Hits appear in the list **Terms**.
3. Move with \`↓\` and \`↑\`, or point at a hit. Below the hits, the full definition of the active hit is shown. Read it, then press Enter or click the hit to take it, or press Esc to cancel. Enter and a click take the hit at once.

Search options:

- To search only modifier terms (severity, onset, …), switch on **Modifiers only**, or type \`mod:\` before the word.
- The language of the text is searched too. To search names in other languages, click the language button next to the field (it lists the languages searched, for example *EN, DE*) and tick them under **Search languages**. English names are always searched.
- Hits tagged **Modifier** are modifier terms. Use one as a finding only if it names the finding itself; otherwise add it under **Modifiers**. Obsolete terms cannot be chosen.

The search compares the words you type with term names and synonyms, letter by letter; it does not understand what they mean. Terms whose name or synonym equals your words come first. Next come terms whose name or synonym contains all your words, those with the fewest other words first. Other similar terms follow in a shuffled order, so the best one is not always on top. Read the hits before you choose one. If nothing matches, try another word or a synonym, type a code or switch search languages.

## Browse the ontology tree

What for: pick a broader or narrower term than the one you have.

1. Select a finding and click **Show in tree**. The **Ontology tree** opens at the current term.
2. Click a term in the tree. Its **Synonyms**, **Translated names** and other parents (**Also under**) are shown.
3. Click **Use this term** to give the selected finding this term.
4. Click **Close tree**.

## Set values and confirm defaults

What for: record the context of a finding: whether it is present, who has it and when.

1. Select the finding. The section **Values** lists each value field, such as the assertion (**Present**, **Absent**, **Uncertain**) or the experiencer (**Patient**, **Family member**, …). Press \`v\` to jump there with the keyboard.
2. Read the passage in context. "No seizures" is **Absent**; "his mother has seizures" is not the patient.
3. To change a value, choose another one. Value fields with few values are buttons; others are a dropdown.
4. Values the project prefills are tagged **Default**. They count as not confirmed until you confirm or change them. If all shown values are right, click **Confirm defaults** or press \`d\`. This confirms every default of this finding. To confirm one default only, click its highlighted button on a button field, or **Confirm** next to a dropdown field.

Findings with open defaults show **Defaults to confirm** in the list.

![A new finding on “seizure”: under Values, Present, Patient and Current are tagged Default, with the Confirm defaults (3) button above them](images/annotator-finding-values.png)

## Manage mentions of a finding

What for: link a finding to every place in the text that supports it.

1. Select the finding.
2. Use the action you need:
   - **Add mention**, then mark the text: adds another place. Esc cancels.
   - **Add segment** on a mention, then mark the text: adds a second piece to the same mention, for words that are apart.
   - Drag a mention's edge handles, or focus an edge and press \`←\` or \`→\` (\`Ctrl+←\` / \`Ctrl+→\` moves by word): resizes it.
   - **Move to a new finding**: gives one mention its own finding with the same term and values. The new finding is selected, so you can change it right away; modifiers stay with the original finding.
   - **Remove**, then **Yes, remove**: detaches the mention.

You cannot remove the last mention when the project requires a text span. If the project allows findings without a span, enter a reason in the note first.

## Add a finding without a text span

What for: record a finding that the text implies but does not state in one passage.

Before you start: the project must allow findings without a text span. Otherwise the button is inactive.

1. In the **Findings** header, click **Add finding without a text span**.
2. In the panel **New finding without a text span**, fill in **Reason for no text span** (if the project requires a reason).
3. Search and choose the term. If you chose the term first, click **Add annotation**.
4. The finding is listed as **Spanless**.

Click **Cancel** to stop. The reason is kept as the finding's note.

## Change term, note or delete a finding

What for: correct a finding you made.

1. Select the finding.
2. Use the action you need:
   - **Change term**, then search a new one: changes the term and keeps the mentions.
   - **Note**: type a comment. It is saved with the finding and the lead can read it.
   - **Delete finding**, then **Yes, delete**: deletes the finding and all its mentions. The message that follows offers **Undo**; \`Ctrl+Z\` (macOS: \`Cmd+Z\`) does the same while you are not typing in a field. Undo puts the finding back with its mentions, values, note and modifiers, and selects it.

Undo is offered only right after deleting, until the message closes. A restored carried finding may need a new check.

If a term has become obsolete, the panel says so. Change the term or delete the finding.

## Add modifiers to a finding

What for: add severity, onset, pattern and similar details to a finding.

1. Select the finding. In **Modifiers**, click **+ Add modifier…**, type into **Search modifier** and choose the modifier.
2. Optional: to link the modifier to the words that state it, click **Link a text span** and mark the text.

You can also start from the text:

1. Mark the words, for example "severe", and pick a modifier hit.
2. The panel asks which finding it belongs to. Click the finding in the list or in the text. The nearest ones are listed under **Nearest in this sentence:**.
3. If the modifier names the finding itself, choose the option to use it as the finding instead.

To change a modifier later, open its row menu: **Link a text span…**, **Remove text span** or **Remove modifier**. A removal can be undone with **Undo** or \`Ctrl+Z\`.

## Turn a standalone modifier finding into a modifier

What for: fix a finding that is really a modifier of another finding.

1. Select the finding. A warning says it is a modifier term.
2. Click **Turn into modifier…**.
3. Click the finding it belongs to. The list marks candidates with **Becomes a modifier of the finding you choose**.

## Work in several layers

What for: work in projects with more than one layer (for example two ontologies). With one layer this panel is not shown.

1. Open **Layers & Ontologies** in the findings list.
2. Use the visibility toggle next to a layer to show or hide it. Layers tagged **Reference** are read-only.
3. Click **Activate** on the layer you want to annotate. **Locked** layers cannot be edited.
4. Choose the **Annotation type** for new findings.

## Review tool proposals

What for: check a tool's proposals one by one and add what the tool missed. Your mode reads **Annotate from proposals**.

Tools make mistakes. Check every proposal as if you had marked it yourself: the marked text, the term and every value. Negations are a common error: a proposal for "Keine Krampfanfälle" (no seizures) with **Present** is wrong.

1. The list **Review Proposals** shows every proposal. Your additions are under **Your own findings**.
2. Select a proposal, or move with \`j\` and \`k\`. The text shows where it was found.
3. Check the marked text, the term and each value.
4. Decide:
   - **Confirm**: the passage, term and all values are right. Values tagged **Defaulted** were not set by the tool but prefilled; Confirm accepts them as shown, so check them too.
   - **Reject**: the proposal is wrong and nothing should replace it.
   - **Edit & Replace**: the proposal is nearly right. You get an editable copy that replaces it; correct the term, values or text span in the copy. The copy is listed under **Your own findings**. Above it, the editor names the proposal it replaces and what you changed, for example *Assertion: Present → Absent*. Click **Done, back to the proposal** when you are finished. The proposal then reads *Replaced by* with the term and your changes.
   - **Unresolved**: only if you really cannot decide; the other three decisions are the normal case. Write a **Reviewer note** saying why, then click **Save decision**. The proposal is submitted with your note and a reviewer flag. It does not block submitting; the lead (and a consolidator, if there is one) decides it. Only **Confirm** confirms a proposal's prefilled values: on an unresolved proposal they stay recorded as defaults, and its row shows **Defaults not confirmed**. The result line under **Your own findings** counts such a proposal as unresolved, for example "1 confirmed proposal, 1 unresolved proposal, 1 own finding".
5. After each decision, the next open proposal is selected. Press \`k\` right after a decision to go back to it.
6. When all proposals are decided, read the whole text again and add findings the tool missed: mark text that has no proposal, choose the term in **New finding** and set the values, as in [Mark text and add a finding](#mark-text-and-add-a-finding). Your additions appear under **Your own findings**, next to the proposals.

To undo a decision, click **Reset decision (open)** or press \`0\`.

**Unresolved** is a flag for the lead, not clinical uncertainty. For clinical uncertainty ("possible seizures"), use the value **Uncertain**.

![The tool proposed “Keine Krampfanfälle” (no seizures) as Present. The annotator chose Edit & Replace: the editable copy keeps Seizure and sets the assertion to Absent](images/annotator-proposal-review.png)

## Review carried findings

What for: check findings that were carried over from an earlier round, for example after you continued from your submission, a lead reopened your work, or the text changed.

1. The toolbar names the round, for example *Round 2, continued from Round 1*, or reads **Review carried findings**. The progress line counts checked findings.
2. Click **Next unchecked** (or press \`n\`) to select the next finding marked **Check needed**.
3. Read **What to check**: the text span, the values or the note. For a finding without a text span the note is listed as its **Reason for no text span**. Carried values are not confirmed.
4. Optional: to see the finding as it was, click **Show original evidence**.
5. If it is right (after any edits), click **Mark as checked** or press \`c\`.
6. If it does not apply to this text, open **Does not apply…**, give a reason and click **Dismiss**.

If you change a finding after checking it, it needs a new check.

A row **Not on this text** means the finding could not be placed in this text. Select it and choose one: **Mark in text**, **Link to an existing finding**, or **Dismiss with reason…**. A finding re-created with **Mark in text** keeps the original's term, values and note.

![A carried finding with What to check and the Mark as checked button](images/annotator-carried-finding.png)

## Re-create findings after a text correction

What for: move your findings to the corrected text after a lead changed it. The toolbar reads **Check after text change**.

1. The panel **Needs review after the text change** lists the findings to place again.
2. For each item, click **Re-create here** and mark the supporting text in the corrected version.
3. Check the term, then click **Save re-created finding**. You can choose a different term below.
4. Check the text span and the values of the saved finding, then click **Complete text-change review**. A later change to the finding needs this again.

If the finding no longer fits, click **Dismiss with reason**, fill in **Reason for dismissal** and click **Save dismissal**.

## Submit the text

What for: hand your finished work to the lead.

Before you start: submitting says you checked the whole text for further findings, not only the ones you marked. See [When is a task done?](#when-is-a-task-done).

1. Click **Next open item** to jump to things that still need attention.
2. Click **Finish & submit text**. While items are open, the button shows how many. The full editor of a consolidation has no submit button; see [Work in the full editor](consolidator.md#work-in-the-full-editor).
3. A dialog named after the text, for example *Submit CASE-1 en?*, lists what is still open: **Carried findings to check**, **Findings that need attention**, **Findings after text correction**, **Proposals not decided**. Click **Go to** to fix an item.
4. When nothing blocks, click **Submit text**. If only warnings are left, the button reads **Submit with** and the number of warnings; see [Confirm values and acknowledge warnings](#confirm-values-and-acknowledge-warnings-in-the-submit-dialog) first.
5. The next open task opens, preferably one of the same kind (another review after a review), or **My tasks** if none is left. To see what you sent, click **View result** in the message.

The task is now read-only. To change it later, [start a new work round](#start-a-new-work-round) yourself under **More** › **Work rounds**; you do not need the lead for that. The submit dialog says the same.

## Confirm values and acknowledge warnings in the submit dialog

What for: finish prefilled values and modifier warnings without leaving the dialog.

Check each value before you confirm it. **Confirm as shown** says "I checked this value and it is right"; it is not a way to make the warning go away. A value you leave unconfirmed is submitted as shown, but recorded as *defaulted*, not chosen. The lead and the export see this difference.

1. The group **Values not chosen yet** lists findings with prefilled values.
2. Click **Go to** to check a finding in the text and change a value. If the shown values are right, click **Confirm as shown** on the row, or, with more than one row, **Confirm all as shown**.
3. The group **Modifier warnings** lists, for example, a modifier used as a finding or two severities on one finding. Click **Go to** to fix one.
4. Click the submit button. Warnings you leave are submitted as they are; the group **Values not chosen yet** says so in one line.

If the project requires chosen values, unconfirmed values block submitting instead of warning.

![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)

## View your submissions

What for: look at what you submitted earlier.

1. Open the task. On a narrow screen, switch to **Details**.
2. Under **My submissions**, click **View** next to a round.
3. The dialog **Historical submission** shows the findings, values, notes and decisions of that submission.
4. Click **Close**.

## Start a new work round

What for: change your work after you submitted it, or start over. A submission itself never changes; a new round replaces it once you submit the round.

1. Open the task, then open **More** and choose **Work rounds**.
2. The table **Rounds** lists each round with its state and submission. **You are here** marks the current one; **Open** opens another.
3. Under **Start a new round**, choose one:
   - To continue from your work: choose the submission under **Continue from**, read what the dialog says will happen, and click **Continue from this submission**. Your findings are carried into the new round, and each must be checked again ([Review carried findings](#review-carried-findings)). You can do this yourself; you do not need the lead.
   - To start over: click **Start empty round**. The new round has no findings.
4. Click **Close**, make your changes and [submit the text](#submit-the-text) again.

What happens to your earlier work:

- The earlier round stays in the history and is marked *Replaced by Round 2* (or the next number). Starting a round does not change the final result.
- Your earlier submission no longer counts as submitted. Your task shows **Open** in **My tasks** again, with **Continue**, and the number after **My tasks** in the sidebar counts it again.
- The lead sees your task as not submitted, and a new consolidation cannot start from the replaced submission. The lead can still read it.
- If the lead had already accepted your earlier submission as the final result, the lead is asked to review that choice.
- You must [submit](#submit-the-text) the new round to hand in your work again.

## Report a text problem

What for: tell the lead that the text cannot be annotated as it is, for example cut off or the wrong text. For questions about the rules, ask your lead directly instead.

Before you start: a report pauses your task. You cannot save or submit until the pause is released. Your saved work stays.

1. Open **More** and choose **Report a text problem…**. In a translation review or consolidation, use the button **Report a text problem** in the header.
2. Describe the problem under **What is the problem?**. Only you and project leads can read it.
3. Click **Report and pause my task**.

The menu item reads **Text problems** when there is something to see, for example your earlier reports. The dialog lists **Your reports** and offers **New report**.

## Resume a paused task or withdraw a report

What for: continue work after a report, or take a report back.

1. Open **More**, then **Text problems**. Your report card shows its state and your task's state.
2. Choose one:
   - To continue: click **Resume my task…**, fill in **Why can you continue?** and click **Resume my task**. The card confirms it, for example *Resumed. The report stays open.*, and the dialog shows *Your task: Active*. The report stays open for the lead.
   - To take the report back: click **Withdraw report…**, fill in **Why are you withdrawing it?** and click **Withdraw report**. Your task is no longer paused by this report.

When the lead answers, the task shows a banner with **Open the answer**, and **My tasks** shows **Answer to your report**. If a project lead paused the task, only a project lead can release the pause.

## Review a translation

What for: check a machine or human translation before it is annotated. Your task is *Translation review*.

Before you start: your profile must contain your **Qualification** ([Edit your profile](getting-started.md#edit-your-profile)). A submitted review cannot be changed.

What to check: compare each paragraph with the source. Look for the problems the app lets you record:

| Category | Look for |
| --- | --- |
| **Omission** | Something in the source is missing in the translation. |
| **Addition** | The translation says something the source does not. |
| **Negation or certainty** | "no", "possible", "suspected" lost or changed. |
| **Number or unit** | Numbers, doses, units, dates. |
| **Anatomy or laterality** | Body parts, left and right. |
| **Terminology** | A clinical term translated wrongly or too loosely. |
| **Problem in the source** | The source itself is wrong or unreadable. |

Then decide:

| Decision | Use it when | What happens next |
| --- | --- | --- |
| **Accepted unchanged** | The translation is right as it stands. | It becomes available for annotation. Annotation tasks already assigned open by themselves. |
| **Accepted with corrections** | You corrected it and it is now right. Editing chooses this for you. | Your corrected text is saved as a new text version, which is accepted for annotation. |
| **Query** | The meaning may differ clinically and you are not sure. | Not accepted. The lead reads your rationale and decides. Annotation tasks already assigned keep waiting. |
| **Rejected** | The translation changes the clinical meaning. | Not accepted. The lead decides: a new review, a correction or discarding it. Annotation tasks already assigned keep waiting. |

Steps:

1. Open the task. The **Source** is on the left, the **Translation** on the right.
2. Read the automatic checks band at the top. Click **Details** to see which checks failed and why.
3. Type your corrections directly in the translation column. Your edits are saved as you type, and the decision switches to **Accepted with corrections**. Use **Show changes** to see your edits and **Couple scrolling** to scroll both columns together. **Show matching paragraph** (\`Alt+M\`) jumps to the paired paragraph.
4. Optional: to compare with another text, click the button that starts with **Compare with**, for example *Compare with … de*. With several texts to compare, it opens a menu **Compare with…**.
5. Under **Your review**, choose a **Decision** (or press \`1\` to \`4\`).
6. Fill in what the decision needs:
   - **Query** and **Rejected** always count as a clinically relevant change: choose at least one category and write a **Rationale**. Put your question for the lead in the rationale.
   - **Accepted with corrections**: tick **Clinically relevant change** if your correction changes the clinical meaning; then a category and a **Rationale** are required.
   - **Accepted unchanged** after a failed automatic check: say in the **Rationale** why the flagged difference is correct.
7. Click **Submit review…** (or press \`Ctrl+Enter\`), read what will happen, then click **Submit review**.
8. A message confirms the review, with **View result**. Your next open task opens on its own, another translation review first, or **My tasks** if none is left.

If the source text was updated, **Source updates to review** appears. Open it, compare **Original source** and **Updated source**, and click **Submit review and resolve source update**.

![A translation review: the source on the left, the translation on the right, the failed automatic check above them. On the right, Query is chosen with the category Number or unit and a rationale, above Submit review…](images/annotator-translation-review.png)

## Keyboard shortcuts

What for: work without the mouse. Shortcuts are off while you type in a field or when a dialog is open. Letter keys work in lower and upper case alike. **Keyboard shortcuts (?)** in **More**, or \`?\`, lists the shortcuts of the current screen, grouped for example under *Finding*, *Decisions* and *Carried findings*. A key that needs something first, such as a selected finding or proposal, is listed with *(not available right now)*. Many buttons also show their key next to the label.

| Key | Action |
|---|---|
| \`/\` | Focus the term search |
| \`↓\` / \`↑\`, Enter | Move through term hits; add the active hit |
| \`v\` | Focus the values |
| \`d\` | Confirm all default values of the selected finding |
| Esc | Discard the marked text, clear the selection, cancel adding a mention |
| Shift+arrow keys | Select text with the keyboard (after clicking into the text) |
| \`←\` / \`→\`, \`Ctrl+←\` / \`Ctrl+→\` | Move the focused mention edge |
| \`j\` / \`k\` | Next open / previous proposal. Right after a decision, \`k\` goes back to that proposal. |
| \`1\` \`2\` \`3\` \`4\` | Confirm, Reject, Edit & Replace, Unresolved |
| \`0\` | Reset the decision to open |
| \`n\` / \`Shift+N\` | Next / previous unchecked carried finding |
| \`c\` | Mark carried finding as checked |
| \`Ctrl+Z\` (macOS: \`Cmd+Z\`) | Undo deleting a finding or removing a modifier |
| \`Alt+←\` / \`Alt+→\` | Previous / next text |
| \`Alt+P\` | Switch project |

In a translation review: \`1\` to \`4\` choose a decision (outside the text), \`Ctrl+Enter\` submits (with a confirmation), \`Alt+M\` shows the matching paragraph.
`,v=`# Consolidator

This chapter is for consolidators. A consolidation merges two or more submissions on one text into one result: findings that everyone agrees on are taken over, and you decide the rest. Back to the [handbook overview](README.md).

How to open tasks is in [Getting started](getting-started.md). How a lead starts a consolidation and accepts the result is in [Lead: results, decisions and export](lead-results.md#start-a-consolidation). Reporting a text problem works as in the [annotator reference](annotator.md#report-a-text-problem).

## Typical consolidation, start to finish

1. Open **My tasks** and click **Start** in the row whose task is **Consolidation** ([Open a consolidation task](#open-a-consolidation-task)).
2. Open the project guidelines (the guidelines button in the header) and keep them at hand ([How to decide](#how-to-decide)).
3. Read the whole text once. The underlines show who marked what.
4. Click **Next open group**. For each open group, read the passage in context, choose the right value in each highlighted row with ✓ and click **Keep** ([Decide a group in the ✓ table](#decide-a-group-in-the--table)). Drop findings the text does not support with **Not in result**.
5. If the guidelines did not settle a group, write a **Note for the lead** and tick **Guidelines unclear here**.
6. Add any finding everyone missed ([Add a finding everyone missed](#add-a-finding-everyone-missed)).
7. When the progress card reads **Ready to submit**, click **Submit consolidation** and confirm ([Finish a consolidation](#finish-a-consolidation)).
8. The lead reads your result, your notes and flags, and accepts it as the final result.

## How to decide

Decide each group by the text and the project guidelines, as if you were annotating it yourself.

- Not by majority. Two people can make the same mistake. If two of three said **Present** for "No muscular hypotonia", the right value is still **Absent**.
- Not by seniority. Whose finding it was does not matter.
- Read the passage in context. Check negation ("no", "without"), who has the finding (patient or family member), and when (now or in the past).
- Prefer the term the text supports. Usually that is the most specific term the text states; follow the guidelines if they say otherwise.
- If none of the versions is right, use **More…** › **Other term…** or **Edit values…** ([Edit values or pick another term](#edit-values-or-pick-another-term)).
- If the guidelines do not settle it, decide as well as you can, write a **Note for the lead** and tick **Guidelines unclear here**. The lead sees both and can improve the guidelines.

Open the guidelines with the guidelines button in the header, for example *Guidelines v2* ([Read the project guidelines](getting-started.md#read-the-project-guidelines)).

## Groups and their states

Ontotator puts the findings that different people marked on overlapping passages into one *group*. You decide a group as a whole.

| State | Meaning |
| --- | --- |
| **agreed** | Everyone who marked it chose the same term and values. It is already in the result and counts as decided. Open it and click **Reopen** if it is wrong. |
| **to decide**, or *2 fields to decide* | Still open. The number counts the highlighted rows that need your choice. |
| **Conflict** mark | People chose different terms or values. |
| **to decide** without **Conflict** | Only the passage differs, or not everyone marked the finding. |
| **decided** | You decided it. |
| **not in result** | You left it out. |
| **attached** | A modifier term you attached to another finding. |

A new consolidation already shows agreed groups as decided, for example *4 of 8 groups open · 4 decided*.

## Open a consolidation task

What for: start or continue your consolidation work.

1. In **My tasks**, find the row whose task is **Consolidation**.
2. Click **Start**, **Continue** or **View**.
3. The consolidation screen opens. Its heading reads, for example, *Consolidate CASE-1 en v1*. The path above it shows how many groups are still open.

If the lead gave a reason when starting the consolidation, it shows above the groups, for example *Reason from the lead: Term and assertion differ*, and under the task in **My tasks**.

The header holds **Open in full editor**, **Report a text problem** and, if the project has guidelines, a button such as *Guidelines v2*. **More…** appears once you decided a group.

The screen is read-only after you submitted, when the task is no longer yours, when it is paused, or when a submission used here was withdrawn. A banner tells you which.

## Read the text and walk the groups

What for: see who marked what and work through the differences in order.

1. The **Clinical text** shows one underline per person. The legend below says which line style belongs to whom. Kept findings are shaded; the selected group is framed.
2. Beside it, the list **Groups** holds the groups in text order, each with its passage and [its state](#groups-and-their-states).
3. One group is open at a time. Click a group, or a marked passage in the text, to open it.
4. Press \`j\` for the next open group and \`k\` for the previous one, or click **Next open group** on the progress card.

On a smaller screen, use **Hide text** and **Show text** to make room. On a phone-sized screen, each group shows its own text snippet instead.

## Decide a group in the ✓ table

What for: decide a group by choosing, per row, the value that is right.

1. Open a group. The table has one column per person. A robot icon marks findings from a tool proposal.
2. The rows are **Term**, one row per value field (for example the assertion), **Text**, **Modifiers** (only if someone used modifiers) and **Note**. Rows where people disagree come first and are highlighted; *(all agree)* marks rows that need no choice. You can mix: take the term from one person and a value from another.
3. In each highlighted row, click the ✓ next to the value you want. Its button is named after the value, for example *Take Hypotonia … for Term*.
4. Read the result line below the table. It starts with "Result:" and lists what is still not chosen, for example *Term not chosen yet* or *text not chosen yet*. Once the term is chosen, **Not taken:** lists other people's terms that are not in the result.
5. Optional: click **+ note** to write a **Note for the lead**, and tick **Guidelines unclear here** if the guidelines did not settle the case.
6. Click **Keep**. The group reads **decided**, the message **Decision saved** appears with **Undo**, and the next open group opens. A note shows under the closed group in the list, so you and the lead see it without opening the group.

![An open group with the comparison table, the ✓ choices for Hypotonia and Absent, and the Keep button](images/consolidator-group-table.png)

**Keep** stays inactive until every highlighted row has a choice. Value colours only help you scan; they carry no meaning beyond the value.

Special cases:

- Not everyone marked it. The card names who did, for example *Ana Weber, Luc Martin marked this. Tom Reis has nothing here.* The button reads **Keep the finding**, or *Keep Luc Martin's finding* for one person. Keep it only if the text supports it.
- Different passages. If people marked overlapping but different passages, the group is open without a highlighted row. The **Text** row shows each person's passage; the ✓ of the passage that goes into the result is pressed, and the result line names it, for example *text "Absent reflexes"*. Compare the underlines in the text. To use another person's passage, click its ✓; its note comes with it. Then click **Keep**. For a passage nobody marked, [work in the full editor](#work-in-the-full-editor).
- Modifiers. Each modifier has its own ✓, so you can combine modifiers that different people chose. Modifiers of one kind, such as two severities, exclude each other. If someone linked a modifier to a different finding, the card says so, for example *Ben Roth linked "Severe" (Severe) to Hypotonia.* Check which finding the text means.
- Same term twice. If the same term is already in the result from another group, the card warns you. **Keep** then adds a second finding with that term.

## Leave a finding out of the result

What for: drop a finding that the text does not support, that breaks the guidelines, or that duplicates another one.

1. Open the group.
2. Optional: write a **Note for the lead** if the reason is not obvious.
3. Click **Not in result**. The group reads **not in result**.

To take it back, click **Undo** in the message, or open the group later and click **Reopen**.

## Attach a modifier to a finding

What for: when someone used a modifier term (such as "Severe") as a finding of its own, turn it into a modifier of the right finding.

1. Open the group. The card says that a modifier term was used as a finding.
2. Click **Attach to a finding…** and choose the finding from the menu.
3. The group reads **attached**. The target group lists the modifier under **Attached modifier:**.

## Edit values or pick another term

What for: keep a finding with a value or term that nobody chose.

1. Open the group and click **More…**. It is offered when no row is in conflict or when the terms differ.
2. Choose one:
   - **Edit values…**: set each value and the modifiers, then click **Keep with these values**. This is offered only when no row is in conflict.
   - **Other term…**: search and pick a term; the search works as in the editor ([Search a term](annotator.md#search-a-term)) and shows the full definition of the active hit below the hits. If there was no term conflict, it is saved at once; otherwise choose the remaining highlighted rows with ✓ and click **Keep**.

Click **Cancel** to stop without changes.

## Add a finding everyone missed

What for: add a finding that no submission has.

1. Select the passage in the text. Or click **Add finding**, type the passage into **Passage from the text** (choose the **Occurrence** if it appears more than once) and click **Continue**.
2. Search and pick the term. Read the definition of the active hit below the hits before you press Enter or click it.
3. A message confirms the new finding. It is listed under **Added by you** with its values, which start as the project's defaults (for example *Present, Patient, Current*). Its value fields open right away: change what the text says, for example **Assertion** to *Absent* for a negated finding, and click **Save values**. Click **Cancel** to keep the defaults.
4. To change the values later, click **Edit values…** next to the added finding.

If the passage is not found, type it exactly as written, or select it in the text.

## Change or undo a decision

What for: correct a decision you made.

1. Choose what fits:
   - Right after a decision: click **Undo** in the message, or press \`Ctrl+Z\` (macOS: \`Cmd+Z\`) while you are not typing in a field. This undoes the last decision only.
   - Later: open the decided group and click **Reopen**. Decide it again.
   - Only the note or the flag: use **Edit note** and **Save note**, or the **Guidelines unclear here** box. These save at once.
2. To start over: open **More…** in the header and choose **Reopen all decisions…**, then **Reopen all**. Groups where everyone agreed are taken over again; every other group opens without a choice. The message offers **Undo**.

If you changed a group in the full editor, reopening it drops that edit. You are asked to confirm.

## Finish a consolidation

What for: hand the merged result to the lead.

Before you start: after you submit, you cannot change the consolidation.

1. When no group is open, the progress card reads **Ready to submit**.
2. Click **Submit consolidation**.
3. The dialog **Submit consolidation?** says who accepts the result (*The lead then accepts the result.*; if you are the lead yourself: *Then accept the result in Documents.*) and shows how many groups and findings the result has, and how many are not in the result.
4. Click **Submit**.
5. If there are warnings (values filled in by default, a modifier used as a finding, two severities), the dialog now lists them under **Check before you submit**, and the button reads **Submit with** and the number of warnings. Click **Back** to fix them, or submit with warnings only if you checked that the values are right.
6. The screen confirms: *Consolidation submitted. The lead then accepts the result.* (If you are the lead yourself: *Consolidation submitted. Accept the result in Documents.*) Open your next task or click **Back to my tasks**.

While groups are open, **Submit consolidation** stays inactive and says how many groups are left.

![The Submit consolidation? dialog: the summary of groups and findings, Check before you submit with one warning, and the buttons Back and Submit with 1 warning](images/consolidator-submit-dialog.png)

What happens next: the lead reads the result with your notes and flags, and accepts it as the final result or chooses another result. If you notice a mistake after submitting, tell the lead: they can start a new consolidation, which can include yours.

## Work in the full editor

What for: change text spans or add findings that the comparison table cannot express.

1. Click **Open in full editor**.
2. The editor shows the mode **Consolidate** and the list **Selected submitted findings** with each finding's author. *Replaced by* on a submitted finding shows which result finding took its place; point at it for a short explanation, click it to jump to that finding. The editor works as described in the [annotator reference](annotator.md), except that it has no submit button.
3. Click **Back to consolidation** at the end of the toolbar to return. Next to it the editor says *Submit on the consolidation screen.*

Groups you changed here are tagged **edited in editor** on the consolidation screen. You submit the consolidation only there, with **Submit consolidation** (see [Finish a consolidation](#finish-a-consolidation)).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| \`j\` / \`k\` | Next / previous open group |
| \`Ctrl+Z\` (macOS: \`Cmd+Z\`) | Undo the last decision |
| \`?\` | Show all shortcuts of this screen |

## Read others' work in the text view

Consolidators can open the text view of a text they consolidate to read each person's findings side by side. See [Read a text and other people's work in the text view](lead-documents.md#read-a-text-and-other-peoples-work-in-the-text-view).
`,x=`# Frequently asked questions

Short answers to problems people often meet. Each answer links to the chapter with the full steps.

## Logging in

### I forgot my password

Ask a system administrator for a reset code. Ontotator sends no e-mail. Then click **I have a setup or reset code** on the login page and set a new password. See [Set your password with a setup or reset code](getting-started.md#set-your-password-with-a-setup-or-reset-code). Administrators: see [Issue a new setup or reset code](admin.md#issue-a-new-setup-or-reset-code).

### The login says "Username or password is wrong, or the account is temporarily locked."

Check the spelling of your username. After 5 wrong passwords within 15 minutes, login for that username from your network is locked for up to 15 minutes; wait and try again. If you no longer know the password, ask an administrator for a reset code.

### My setup or reset code does not work

Codes work once and expire: setup codes after 24 hours, reset codes after 2 hours. A newer code also cancels an older one. Ask an administrator for a new code. Capital letters, spaces and hyphens in the code do not matter.

### A login window appears while I am working

Your session has ended. Log in again in that window. Your unsaved edits stay in the open editor and are saved after you log in. See [Log in](getting-started.md#log-in).

### The page says "The page is out of date; reload it." or "Your page is out of date."

Reload the page in the browser, then repeat the last action. If the message asks you to, log in again ([Log in](getting-started.md#log-in)).

## Tasks and projects

### The page says "The project is busy, so nothing was changed."

Another operation, often a running import, is holding the project. What you just did was not applied, so nothing needs undoing. Wait a moment and click **Retry**, or repeat the action. In the editor your unsaved edits stay on the page until the save goes through.

### After login I see Projects, not My tasks

Ontotator opens the project you used last, or **Projects** the first time. Click **My tasks** in the sidebar. See [Log in](getting-started.md#log-in).

### My tasks is empty

A project lead has not assigned you a text yet. Assigned texts appear under **My tasks** automatically. Also check the status tabs: **All** shows every task. See [See your tasks](getting-started.md#see-your-tasks).

### I see "You are not a member of any project yet."

Ask your project lead or an administrator to add you to a project, then click **My tasks** or reload the page. Leads: see [Add a member](lead-settings.md#add-a-member).

### A task opens with "Task not found or not yours"

The task was removed or given to someone else, or you followed a link meant for another person. Go back to **My tasks** ([See your tasks](getting-started.md#see-your-tasks)).

### My task is paused

A problem report pauses the task, yours or the lead's. You can read your saved work but not change or submit it. If you reported the problem yourself, you can resume with a reason. If the lead paused it, only the lead can release it. See [Resume a paused task or withdraw a report](annotator.md#resume-a-paused-task-or-withdraw-a-report).

### My submitted task is read-only

A submission cannot be edited. To change your work, open the task, choose **More** › **Work rounds** and click **Continue from this submission**. Your findings are carried into a new round; check them, make your changes and submit again. See [Start a new work round](annotator.md#start-a-new-work-round). A lead can also reopen your task; it then shows **Reopened** with the lead's reason.

### I cannot open project settings, Ontologies or New project

Project settings are for project leads. **Ontologies**, **Users** and **New project** are for system administrators. The page tells you whom to ask. See [Roles](README.md#roles).

## Annotating

### Why is "Finish & submit" disabled?

Something is still open. Click **Next open item** to jump to it, or open the submit dialog: it lists every open item with **Go to**. Typical reasons are undecided proposals, carried findings not yet checked, findings after a text correction, or values not yet chosen. See [Submit the text](annotator.md#submit-the-text).

### The submit dialog shows "Values not chosen yet"

Some findings still have prefilled values you did not confirm. Click **Confirm as shown** per finding, or **Confirm all as shown**, or **Go to** the finding and choose another value. In some projects you must confirm them before you can submit. See [Confirm values and acknowledge warnings in the submit dialog](annotator.md#confirm-values-and-acknowledge-warnings-in-the-submit-dialog).

### The submit dialog shows "Modifier warnings"

A finding uses a modifier term (such as a severity) as the finding itself, or has two modifiers of one kind. Check it with **Go to**. If it is correct, submit anyway with the button that names the number of warnings. See [Add modifiers to a finding](annotator.md#add-modifiers-to-a-finding).

### Submitting fails with "Replace obsolete terms" or "Replace unknown terms"

The project moved to a newer ontology release and a term in your draft no longer exists there. Pick another term for that finding, or reject or replace the affected proposal. Then submit again. See [Change term, note or delete a finding](annotator.md#change-term-note-or-delete-a-finding).

### "Add finding without a text span" is disabled

Your project requires a text span for every finding. Mark the text passage instead. See [Add a finding without a text span](annotator.md#add-a-finding-without-a-text-span).

### The save status says "Changed elsewhere – reload required"

The same task was changed in another window or by someone else. Click **Reload case**. See [The editor screen](annotator.md#the-editor-screen).

### The save status says "Offline – changes not saved"

The connection to the server is lost. Keep the window open; your input stays in the editor. When the connection is back, saving usually resumes on its own; if the status stays, click **Retry**. See [The editor screen](annotator.md#the-editor-screen).

### The term search does not find the right term

The search compares your words with term names and synonyms; it does not understand meaning. Terms whose name or synonym equals your words come first, then terms whose name or synonym contains all your words; other similar terms follow in a shuffled order. Read all hits, then try another word, a synonym, the English name or a code. See [Search a term](annotator.md#search-a-term).

## Translation review

### I cannot submit my review: "Your qualification is required to submit."

Add your qualification (for example "physician, native German speaker") in your profile, then submit again. Use the link **Add your qualification in your profile**. See [Edit your profile](getting-started.md#edit-your-profile).

### What does "automatic check failed" mean?

The translation tool checked its own output and found a possible problem, for example numbers or units that differ from the source. Click **Details** to read the check, what the tool reported and what to do if the translation is right anyway. Open **Technical details** for the technical code of the check. If Ontotator has no description for a check, ask the project lead what it checks. See [Review a translation](annotator.md#review-a-translation).

## Consolidating

### Why is "Submit consolidation" disabled?

Some groups are still open. Decide each open group first; the progress card counts what is left. See [Finish a consolidation](consolidator.md#finish-a-consolidation).

### I submitted a consolidation with a mistake

A submitted consolidation cannot be changed. Tell the lead: they can start a new consolidation on the text, which can include yours as one of the submissions. See [Finish a consolidation](consolidator.md#finish-a-consolidation) and [Accept a consolidation](lead-results.md#accept-a-consolidation).

### "Could not add the finding. Nothing changed."

The finding was not saved, for example because the connection dropped. Reload the page and add it again. If it keeps failing, tell your lead. See [Add a finding everyone missed](consolidator.md#add-a-finding-everyone-missed).

### The consolidation asks me to "Check before you submit"

The result has findings with values filled in by default, modifier terms used as findings, or modifier warnings. Check them; if they are correct, submit with the warnings. See [Finish a consolidation](consolidator.md#finish-a-consolidation).

## Leading a project

### I cannot accept a result

In projects where the consolidator of a text may not be one of its annotators, you cannot choose a result you made yourself. Another lead must choose it. See [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results).

### My uploaded texts do not show up

An import runs in the background; reload **Documents** when it is done. If the project plan for new imports is **Plan nothing; I plan texts on Documents**, the new texts show as *Not decided* until you plan them. See [Upload texts](lead-documents.md#upload-texts).

### The upload says "The file name is not a valid text ID."

For plain text, each file name without \`.txt\` becomes the text ID. Rename the file: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. See [Prepare files for upload](lead-documents.md#prepare-files-for-upload).

### I cannot change the ontology release or the task profile

The ontology release can be chosen freely only until the first work is submitted; after that, use **Move to another release**. The task profile can only be replaced before work starts, and only by a file with the same ontology ID as the project (upper and lower case count as the same) and the checksum of the chosen release. See [Move a started project to a newer release](lead-settings.md#move-a-started-project-to-a-newer-release) and [Replace the task profile](lead-settings.md#replace-the-task-profile).

### My bundle is refused: the ontology settings do not match

The check names, per text, what the bundle uses, what the project uses and who can change it: a lead changes the release, branches or annotation scheme under **Settings**, tab **Ontology**; the ontology ID of a project cannot change. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

### A text has no assign button

The text is not in the work plan. Plan it first. See [Add a text to the plan](lead-documents.md#add-a-text-to-the-plan).

### A task is still paused after I closed the report

Closing a report does not always release the pause. The row shows **Resume task…**; click it and release the pause. See [Decide on a problem report](lead-results.md#decide-on-a-problem-report).

### I chose myself as consolidator: where do I work?

While your consolidation runs, **Open consolidation** in the text card opens your task, as does **Open my task** in the row on **Documents** or the row in **My tasks**. After you submitted, **Open consolidation** shows the read-only result. See [Start a consolidation](lead-results.md#start-a-consolidation).

### The consolidator list does not show a person

Only you and the members with the **Consolidator** role are listed; the hint under the list says so and links **Settings → People**. Give the role first. See [Change a member's roles](lead-settings.md#change-a-members-roles).

### The export asks me to tick a box

Some texts still need your decision or have no final result. Either decide them in **Documents** first, or tick the box to export the ready results and leave the others out. See [Export final results](lead-results.md#export-final-results).

### I cannot remove a lead

A project needs at least one lead. Add another lead first, then remove the role. See [Change a member's roles](lead-settings.md#change-a-members-roles).

### "Save changes" is disabled in the settings

Nothing has changed yet. The button turns on as soon as you edit a field. **People** and **Guidelines** save on their own and have no save button. See [Open project settings](lead-settings.md#open-project-settings).

## Administration

### I cannot close the setup-code dialog

Tick **I have handed over or stored the code** first. The code is shown only once. See [Hand over a setup or reset code](admin.md#hand-over-a-setup-or-reset-code).

### "You cannot remove your own administrator role."

This protects you from locking yourself out. Another system administrator must do it; you also cannot deactivate yourself. The last active system administrator always keeps the role. See [Edit a user's profile and administrator role](admin.md#edit-a-users-profile-and-administrator-role).

### An ontology upload is refused

The file could not be read, is too large, or is an incomplete HPO release. Read the detail below the message and upload a complete release. See [Upload ontology releases and translation files](admin.md#upload-ontology-releases-and-translation-files).

### The administrator lost the password

This is fixed on the server, not in the app. See [Lost admin password](../operations.md#lost-admin-password) in the server operations guide.
`,T=`# Your first task, start to finish

This chapter takes you through one annotation task, from your first login to a submitted text. Do it once in this order; afterwards, look things up in the [annotator reference](annotator.md). Back to the [handbook overview](README.md).

Before you start: you need the address of your Ontotator server, your username and a setup code from your administrator, and a lead must have assigned a text to you.

## 1. Log in

1. Open the address of your Ontotator server.
2. The first time: click **I have a setup or reset code**, enter your **Username**, the code and a new password twice, then click **Set password and log in** ([details](getting-started.md#set-your-password-with-a-setup-or-reset-code)).
3. Later: enter your **Username** and **Password** and click **Log in**.

## 2. Find your task

After login you see **My tasks**, or **Projects** the first time.

1. Click **My tasks** in the sidebar.
2. On the tab **To do**, find a row whose **Task** is *Annotation, from scratch* or *Annotation, from proposals*.
3. Click **Start**. A task marked **Waiting for translation review** cannot be started yet; it opens by itself once the translation review is accepted.

The editor opens. If you have no task, you see **No texts are assigned to you yet.**; ask your lead.

## 3. Read the guidelines

The first time you open a task in a project with guidelines, a notice asks you to read them. Click the read button in the notice, for example *Read guidelines v2*. Later you find them under **More** in the toolbar.

The guidelines tell you what to mark and how: which findings count, how much text to mark, how to handle negations or family history. When in doubt, follow the guidelines; if they do not answer your question, ask your lead.

## 4. Get to know the screen

The editor has three columns: the list of **Findings** on the left, the text in the middle and the details of the selected finding on the right. The toolbar shows the mode, for example **Annotate from scratch**, and the save status. Everything is saved automatically; **Saved** means your work is stored. See [The editor screen](annotator.md#the-editor-screen).

## 5. Mark a finding

1. Read the text from the start. When it names a finding, for example "seizures", select the words with the mouse.
2. The panel **New finding** opens. **Search term** already holds the marked words, and the hits are listed under **Terms**.
3. Read the hits before you choose: the search matches words, not meaning, and only a term whose name or synonym equals your words is sure to be on top. If the top hit is the right term, press Enter. Otherwise, click another hit, or try another word or a synonym in **Search term**.

![The New finding panel with the marked text and the term search open](images/annotator-new-finding.png)

## 6. Choose the values

The new finding starts with the project's prefilled values, for example **Present** for the assertion and **Patient** for the experiencer. They are tagged **Default** and do not count as chosen yet.

1. Read the passage again in context. Does the text say the finding is there, absent ("no seizures") or uncertain? Is it the patient's or a family member's?
2. If a value is wrong, choose the right one under **Values**.
3. If all shown values are right, click **Confirm defaults** (or press \`d\`).

![A new finding on “seizure”: under Values, Present, Patient and Current are tagged Default, with the Confirm defaults (3) button above them](images/annotator-finding-values.png)

Repeat steps 5 and 6 for every finding in the text.

## 7. Check the tool proposals (tasks from proposals only)

In a task *Annotation, from proposals*, the column **Review Proposals** lists findings a tool suggested. Tools make mistakes, especially with negations: a tool may propose "Keine Krampfanfälle" (no seizures) as **Present**.

1. Select the first proposal. The text shows where it was found.
2. Check three things: the marked text, the term and every value.
3. Click **Confirm** if all three are right, **Reject** if the proposal is wrong, or **Edit & Replace** to correct it in a copy, then click **Done, back to the proposal**. Only if you really cannot decide, click **Unresolved** and write a **Reviewer note** saying why.
4. The next open proposal is selected. Go on until every proposal is decided.
5. Then read the whole text for findings the tool missed. Mark text that has no proposal and add the finding as in step 5. It appears under **Your own findings**, next to the proposals.

![The tool proposed “Keine Krampfanfälle” (no seizures) as Present. The annotator chose Edit & Replace: the editable copy keeps Seizure and sets the assertion to Absent](images/annotator-proposal-review.png)

Details: [Review tool proposals](annotator.md#review-tool-proposals).

## 8. Submit

Before you start: submitting means you checked the whole text, not only the findings you marked.

1. Click **Next open item** until nothing is left. It takes you to every proposal, value or finding that still needs you.
2. Click **Finish & submit text**. (A consolidation is submitted on its own screen; see [Consolidator](consolidator.md).)
3. The dialog lists what is still open, with **Go to** for each item. Values you have not confirmed are under **Values not chosen yet**: confirm them only if you checked that they are right. A value you leave is submitted as shown but recorded as defaulted, not chosen; the lead and the export see this.
4. Click **Submit text**.

![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)

Details: [Submit the text](annotator.md#submit-the-text).

## 9. What happens next

- Your task shows **Submitted** in **My tasks**. It is read-only now; click **View** to look at it.
- The next open task opens on its own, or **My tasks** if none is left.
- The lead sees your submission next to the other annotators' work on the same text, and accepts one result or starts a consolidation. You do not see other people's work.
- Your task is done. You do not need to do anything else unless the lead reopens it (**Reopened** in **My tasks**) or you notice a mistake.

If you notice a mistake after submitting: open the task, choose **More** › **Work rounds** and click **Continue from this submission** ([Start a new work round](annotator.md#start-a-new-work-round)). Fix the finding, check the carried findings and submit again.

If something is wrong with the text itself (cut off, wrong patient, unreadable): **More** › **Report a text problem…** ([Report a text problem](annotator.md#report-a-text-problem)).

## If you were given a translation review

A *Translation review* task shows the source and the translation side by side. You correct the translation if needed and choose a decision. See [Review a translation](annotator.md#review-a-translation).
`,C=`# Getting started

This chapter is for everyone. It shows how to log in, find your tasks and keep your profile up to date. Back to the [handbook overview](README.md).

## Before you start

- Your administrator gives you the address of your Ontotator server, your username and a one-time setup code.
- Use a current version of Chrome, Firefox, Edge or Safari.
- Everything you do is saved automatically. There is no **Save** button in tasks, and you can close the browser tab at any time and continue later.

## Set your password with a setup or reset code

What for: your first login, or a new password after an administrator reset it.

Before you start: you need a setup or reset code from your administrator. A code works once. Setup codes expire after 24 hours, reset codes after 2 hours.

1. Open the address of your Ontotator server in your browser. You see the login screen.
2. Click **I have a setup or reset code**. The form **Set your password** opens.
3. Enter your **Username**.
4. Enter the code in **Setup or reset code**.
5. Enter a password in **New password**: 12 to 256 characters, different from your username.
6. Enter it again in **Repeat the new password**.
7. Click **Set password and log in**.

![The Set your password form with the fields Username, Setup or reset code, New password and Repeat the new password](images/getting-started-set-password.png)

Ontotator sets the password and logs you in at once. The first time, you land on **Projects** (see [Log in](#log-in) for where you land later). Only if that login fails afterwards, for example because the account is locked for a while, the login screen opens with **Your password is set. Log in with it now.**; the password is set, so [log in](#log-in) with it later. If you see **The two passwords differ.**, type both passwords again. To go back without a code, click **Back to login**.

## Log in

What for: start working.

1. Open the address of your Ontotator server in your browser. You see the heading **Log in to Ontotator**.
2. Enter your **Username** and **Password**.
3. Click **Log in**.

After logging in, Ontotator opens the project you used last on this browser:

- annotators and consolidators see **My tasks** for that project;
- leads see the project's **Documents** page.

The first time, or if that project is no longer yours, you see **Projects**. Click **My tasks** in the sidebar to see your work. On **Projects**, **Needs your decision** counts texts that wait for a lead's decision, and **Your open tasks** counts your tasks.

If your session ends while you work, a login box opens with **Your session has ended. Please log in again.** Log in there. Your unsaved input is kept.

## Log out

What for: end your session, for example on a shared computer.

1. Click **Log out** in the header.
2. If a dialog **Unsaved changes** opens, click **Save and log out**.
3. If a dialog **Unsaved profile changes** opens, click **Save and log out** to keep your changes, or **Discard and log out**.

## Find your way around

What for: know where things are.

The header is the same on every page:

- **Ontotator** on the left takes you to the start page.
- The breadcrumb shows where you are, for example **My tasks** or **Documents**.
- On the right are your display name, your pseudonym, your roles and **Log out**.
- **Handbook** in the header opens this handbook inside the app. On the Documents, consolidation and translation review screens, **Help** opens the handbook section about that screen; in the editor it is **More** > **Help for this screen**. On the project forms, a link next to the task profile opens the section that explains it. Click a screenshot in the handbook to open it at full size in a new tab.
- Below the chapter list, the handbook shows the app's version and commit, for example \`Ontotator 0.3.0 · commit cc65cea\`. Quote it when you report a problem.

The sidebar lists **My tasks**, **Projects** and **Profile**. The number after **My tasks** counts your open tasks, the same tasks as the **To do** tab; it updates as soon as you submit a text. Clicking **My tasks** or **Projects** loads your projects and the count again, so a project you were just added to shows up without reloading the page. Leads also see their project's pages (**Documents**, **Progress**, **Settings**, **Export**). System administrators also see **Administration** with **Users**, **Ontologies** and **New project** (see [Administration](admin.md)). In the editor, the sidebar folds into **Sections**; click it to open it.

## Switch project

What for: work in another project.

1. Click the project switcher in the sidebar. It shows **Project** and the current project name. The shortcut is \`Alt+P\`.
2. Type part of the name in **Find project**.
3. Click the project, or choose it with the arrow keys and press Enter.

**All projects** opens the **Projects** page. There you see each project with **Your roles** and **Your open tasks**; click **Open** to go to a project.

## See your tasks

What for: find the texts you have to work on.

1. Click **My tasks** in the sidebar.
2. Choose a tab: **To do**, **Submitted** or **All**. The tab **Paused** appears only while one of your tasks is paused.
3. If you work in several projects, choose a project in **Filter my tasks by project**, or **All my tasks**.

![My tasks with the status tabs and a table of tasks, each with its Text, Task, Status and an action button](images/getting-started-my-tasks.png)

Each row is one task. The **Task** column says what to do, for example **Annotation, from scratch**, **Annotation, from proposals**, **Consolidation** or **Translation review**. The **Status** column shows **Open**, **In progress**, **Submitted** or **Reopened**.

- **Reopened**: the lead reopened your submission. Click the badge to read why.
- A **Consolidation** task shows the lead's reason under the task, for example *Reason from the lead: Term and assertion differ*, if the lead gave one.
- **Paused**: the task waits for a decision on a problem report. **Answer to your report** means the lead has replied.
- **Waiting for translation review**: the lead assigned the annotation ahead, and the translation is still being reviewed. You cannot start yet; the **Action** column says **Opens after the review**. Once the review is accepted, the task shows **Start** by itself. If the review leads to a corrected version, the task opens on that version.
- **Waiting for the project lead**: the text of this task was corrected and the task cannot follow by itself. You cannot start it; the lead decides how it continues, and it may leave your list.

If the project has guidelines, a link such as *Project guidelines v2* appears above the table. Read them before you start: they say what to mark and how.

If you see **No texts are assigned to you yet.**, wait until your lead assigns texts to you.

## Open a task

What for: start or continue your work on a text.

1. In **My tasks**, find the row of the task.
2. Click the button in the **Action** column:
   - **Start** for a new task,
   - **Continue** for a task in progress or a reopened one,
   - **View** for a submitted task (read-only),
   - **View paused task** for a paused task (read-only).
3. The task opens. While it loads you see **Opening task…**.

A link to a task that still waits shows **Waiting for translation review** instead of the text. Nothing is lost; the task opens by itself once the review is accepted. A link to a task the lead has to decide on shows **Waiting for the project lead**.

To move to your next or previous task without going back, use **Previous text** and **Next text** in the toolbar (\`Alt+←\` and \`Alt+→\`), or pick one in **Select text**.

How to work inside the task: [Your first task, start to finish](first-task.md), the [annotator reference](annotator.md) and, for consolidations, the [consolidator chapter](consolidator.md).

If you see **Task not found or not yours**, the task was withdrawn or is assigned to someone else. Click **My tasks** to go back.

## Read the project guidelines

What for: check the annotation rules of the project.

1. Open a task.
2. Open **More** in the toolbar and choose the guidelines, for example *Guidelines v2*. *(new)* after it means the guidelines changed since you last read them. In a translation review or consolidation, the guidelines are a button in the header instead, with a **New** badge.
3. The guidelines open beside the text. Click **All versions** to see older versions, or **Close** to hide them.

The first time you open a task in a project with guidelines, a notice asks you to read them. Click the read button in the notice, for example *Read guidelines v2*. The notice also says where you find them later: under **More** › *Guidelines* in the editor, or the guidelines button in the header of a translation review or consolidation.

The guidelines are your project's rules: what counts as a finding, how much text to mark, how to handle negation or family history. The handbook explains the app, not these rules. If the project has no guidelines or they do not answer your question, ask your lead.

## Edit your profile

What for: keep your name, languages and qualification up to date.

1. Click **Profile** in the sidebar.
2. Change **Display name**, **E-mail**, **Languages you can read**, **Qualification** or **ORCID**.
3. To be named in exports, tick **Name me (display name and ORCID) as a contributor in exports**.
4. Click **Save**. You see **Saved.**

Your **Username** and **Pseudonym** cannot be changed. Exports show your pseudonym, not your name, unless you tick the box in step 3.

Fill in **Qualification** if you do translation reviews: you cannot submit a translation review without it.

## Set your search preferences

What for: search ontology terms in your own languages too.

1. Click **Profile** in the sidebar.
2. Go to **Search preferences**.
3. Tick **Search translated names** to search the translated names of terms.
4. Choose your **Preferred search languages**.
5. Tick **Automatically include the document language** to also search in the language of the text you work on.
6. Click **Save search preferences**. You see **Search preferences saved.**

## Change your password

What for: replace your password with a new one.

1. Click **Profile** in the sidebar.
2. Go to **Change password**.
3. Enter your **Current password**.
4. Enter a **New password** with 12 to 256 characters. It must differ from your username.
5. Enter it again in **Repeat new password**.
6. Click **Change password**. You see **Password changed. Other sessions were logged out.**

If you forgot your password, ask an administrator for a reset code and follow [Set your password with a setup or reset code](#set-your-password-with-a-setup-or-reset-code).
`,A=`# Lead: texts, work plans and progress

This chapter is for project leads. It covers the **Documents** page: uploading texts, the text card, planning and assigning work, and following progress. Back to the [lead overview](lead.md).

On **Documents**, each row is one text: one language version of a case. See [case, text and document](README.md#glossary).

## Upload texts

### Prepare files for upload

Ontotator takes two formats:

| Format | Use it for | What goes in |
| --- | --- | --- |
| **Plain text** (.txt, or a .zip of .txt files) | Texts in one language, without tool proposals. | One UTF-8 text file per text. The file name without \`.txt\` becomes the text's ID: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. Each name may occur once. All files of one upload get the same **Upload language**. |
| **Ontospan bundle** (.zip or .json) | Texts with translations and tool proposals. | A ZIP with \`manifest.json\` and one JSON file per text under \`documents/\`, or a single exchange file (.json). Each text file holds the text, its language and case ID, whether it is a translation, and the tool proposals for it. |

Example of a plain-text ZIP:

\`\`\`
texts.zip
  case-201.txt
  case-202.txt
\`\`\`

Example of an Ontospan bundle:

\`\`\`
bundle.zip
  manifest.json
  documents/
    case-201-de.json    (source text, with proposals)
    case-201-en.json    (translation of case-201)
\`\`\`

Ontospan bundles are written by the Ontospan tools that produce the translations and proposals. Ask whoever runs those tools for a bundle.

A bundle fits a project only if its ontology ID, layer IDs, ontology release, branches, annotation scheme and values match the project's [task profile](lead-settings.md#task-profiles) and ontology settings. The built-in template *HPO phenotype* fits only bundles with ontology \`hp\`, layer \`hpo-layer\` and exactly the branch \`HP:0000118\`. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

### Upload texts

What for: bring texts into the project, with or without tool proposals.

Before you start: [prepare the files](#prepare-files-for-upload). Check the [languages of the texts](lead-settings.md#set-the-languages-of-the-texts) and the [plan for new imports](lead-settings.md#choose-the-plan-for-new-imports).

1. Open **Documents** and click **Upload texts…**.
2. Choose the **Format**. For plain text, also choose the **Upload language**.
3. Click **Choose files…** and select your files.
4. Click **Check**. Nothing is imported yet; the dialog shows *Checking 2 files …*.
5. Read the preview: the number of cases, proposals and texts already in the project, and any **Notes**. For plain text, the first note shows which text ID each file name became. A note says what, if anything, you need to do; **Show** lists the texts and proposals it concerns.
6. Check the **Work plan**: for each language, whether it gets a **Translation review** and an annotation. Click **Adjust per case…** for exceptions.
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

1. Type into the search field **Case ID…**. Any part of the ID is enough, in upper or lower case: \`fr100994\` and \`100994\` both find \`FR100994\`. To find one language, add it: \`FR100994 fr\`.
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
- **Previous text** and **Next text** walk through the table (keys \`K\` and \`J\`).
- **Other languages** switches to another language of the same case.
- In **Finalization**, **Open consolidation** opens your own running consolidation as your task; a submitted one opens read-only.
- ✕ or Esc closes the card.

### Read the history and details of a text

What for: see what happened to a text and its technical IDs.

1. In the text card footer, click **History** or **Details**.
   - **History** lists all activity, newest first, with reviewers' reasons.
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
3. The selection bar at the bottom shows how many texts are selected and their next steps, for example *next steps: Assign annotation (en, es)*.

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

Before you start: once someone started or submitted work in one mode, the mode is fixed.

1. Open the text card and click **Annotation**.
2. Under **Annotation**, choose **From proposals**, **From scratch** or **Off**. It saves at once.

### Assign work to the selected texts

What for: give translation reviews or annotations to people.

1. Select the texts, then click the assign button in the selection bar, for example **Assign annotation…**.
2. Check the **Task**, for example a translation review in one language.
3. In the table of people (**Person**, **Reads**, **Open tasks**), pick the reviewer, or tick everyone who should annotate. The task has one language: each ticked person gets every selected text in that language that still has a free place. *Administrator* marks a system administrator; the administrator who created the project is a member with all roles, so leave them unticked unless they take part.
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

If the selection has texts in several languages, the dialog assigns one language at a time. After the assign button, it stays open on the next language and lists what is already assigned; click **Close** when you are done. Cases that got nothing are offered in the message, for example *Select the 2 skipped cases*; the message stays until you close it.

### Assign work for one text

What for: assign a single review or annotation.

1. In the row, click **Assign review…** or **Assign annotation…**. In the text card, use **Assign review…** or **Assign annotators…**.
2. Tick the people. To annotate yourself without the Annotator role, click **Add me as annotator**.
3. Click the assign button, for example *Assign 2 people*.

To change the limit of annotators per text from here, click the info button (i) next to the limit, then **Change for all texts**.

### Distribute work evenly

What for: spread a batch of texts evenly across people.

The proposal uses the languages in each person's profile: a person is proposed for a text only if they read its languages, or list no languages at all. People who list the text's languages come first; people with no languages listed only fill the places left over. Among them, fewest open tasks come first.

1. In the assign dialog, click **Distribute evenly…**.
2. Set **People per document** and click **Propose**.
3. Check the proposal. Change a person in any cell, or click **Propose again**. Texts nobody can take are listed under **Unassignable documents**.
4. Click **Confirm**. Both dialogs close and the message says the assignments are saved.

If you chose someone whose profile lists other languages than the text needs, the dialog stays open after **Confirm** and asks; click **Assign anyway**, then **Close**.

### Remove, reassign or reopen an assignment

What for: change who works on a text, or let someone change a submitted annotation.

Warning: removing unsubmitted work deletes the draft for good. Submitted work stays in the history.

A task that waits for the translation review shows **Waiting for review** in the person's row and can be reassigned or removed like any open task.

1. Open the text card and click **Annotation** (or **Translation** for reviews).
2. In the person's row, click one of these:
   - **Reassign…**: choose the **New assignee** and click **Reassign**.
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
`,S=`# Lead: results, decisions and export

This chapter is for project leads. It covers choosing the final result of each text, consolidations, the decisions on translations, text changes and problem reports, and the export. Back to the [lead overview](lead.md).

## Accepting results and consolidation

Each text version gets one final result: one submission or one consolidation that you accept. Only final results go into the final export. You do this in the **Finalization** part of the [text card](lead-documents.md#the-text-card).

How to choose:

- If all submissions agree, accept one.
- If they differ in a few findings and one is clearly right, read them and use that one.
- If they differ and you want each difference decided on its own, start a consolidation.

### Accept a result or compare results

What for: choose the final result of a text.

1. On **Documents**, tab **Needs your decision**, click **Accept result…** or **Compare results…** in the row. The row reads **Accept result…** when there is one result to accept or all findings match, and **Compare results…** when submissions differ. The card opens at **Finalization**.
2. With one submission or a submitted consolidation, check it and click **Accept result**.
3. If all annotations agree, the card says so. Click **Accept result**.
4. If they differ, the card shows the agreement, for example *Agreement: 5 of 9 findings match, 1 differs in context only*. **How is this counted?** explains the numbers. Open a submission with **Open submission** to read it in the read-only text view.
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
- If you chose yourself: you get the Consolidator role for this project. Click **Open consolidation** in the text card, **Open my consolidation task** in the message, or **Open my task** in the text's row on **Documents**. Each opens your task, where you decide and submit.

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
   - **Use the newer result**.
   - Carry it to the new version, for example *Carry to v2…* (see [Carry submitted work to a new text version](#carry-submitted-work-to-a-new-text-version)).

### Change a final result

What for: pick another result after you already chose one.

1. Open the text card at **Finalization**.
2. Click **Change final…**.
3. Click **Use as final** in the row of the result you want.

## Translation and text-change decisions

### Resolve a rejected or queried translation

What for: decide what happens after a reviewer rejected or queried a translation. The row's next step is **Resolve rejected translation** or **Resolve queried translation**.

1. In the row, click **Resolve…**. The options open below the row with the reviewer's rationale.
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
5. Submit with **Submit review…** (or \`Ctrl+Enter\`), then click **Back to Documents**.

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

1. In the row, click **Handle text change…**. A task from proposals, or a task on a correction that was not accepted, only offers **Withdraw**.
2. Choose one:
   - Move to the new version: the annotator continues on the corrected text; their draft findings are carried and marked for checking.
   - Let the annotator finish on the old version: the result is carried to the new version for them to check.
   - **Withdraw**: the draft stays with them, and the new version needs a new annotation.
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

Click **Check again** after you accepted more results. **What is in the file?** explains the contents. Values that annotators never confirmed are marked as *defaulted* in the file; unresolved proposals keep their reviewer flag and note. The file formats are described in the [scientific workflow guide](../scientific-workflow.md) and the [translation review export guide](../translation-review-export.md).

### Export research data

What for: download raw material for analysis. People appear as pseudonyms.

1. On **Export**, go to **Research data**.
2. Choose a row: **Annotation results**, **Edit log** or **Translation reviews**.
3. Click **Create**, then **Download** when it is ready.

How to analyse these files is described in the [scientific workflow guide](../scientific-workflow.md).
`,j=`# Lead: project settings

This chapter is for project leads. It covers every tab under **Settings**: the project name and languages, the ontology, the submission rules, the workflow, the people and the guidelines. Back to the [lead overview](lead.md).

General, Annotation, Workflow and Ontology have a **Save changes** button at the bottom. People and Guidelines save each change at once.

| Tab | What you set there |
| --- | --- |
| **General** | [Name and description](#change-the-project-name-and-description), [languages of the texts](#set-the-languages-of-the-texts) |
| **Annotation** | [Submission rules](#set-the-submission-rules), [prefilled values](#set-prefilled-values-for-new-findings), [values annotators can choose](#limit-the-values-annotators-can-choose) |
| **Workflow** | [Plan for new imports](#choose-the-plan-for-new-imports), [texts with tool proposals](#choose-how-texts-with-tool-proposals-are-annotated), [annotators per text and consolidation rules](#set-annotators-per-text-and-the-consolidation-rules) |
| **Guidelines** | [Publish](#publish-the-first-or-a-new-guideline-version), [see who read them](#see-who-has-read-the-guidelines), [republish](#republish-an-earlier-guideline-version), [withdraw](#withdraw-a-guideline-version) |
| **People** | [Add](#add-a-member), [change roles](#change-a-members-roles), [remove](#remove-a-member) |
| **Ontology** | [Ontology version and annotation scheme](#choose-the-ontology-version-branches-and-annotation-scheme), [task profile](#task-profiles) and [replacing it](#replace-the-task-profile), [move to a newer release](#move-a-started-project-to-a-newer-release) |

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
2. Type a language code into **Languages of the texts**, for example \`de\`.
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
   - Limit the terms to some branches (parts of the ontology below one term): enter term codes separated by commas, for example \`HP:0000118\`. Empty means every term.
   - Choose the annotation scheme: **HPO phenotype (fixed qualifiers, modifiers)** or **Generic (free qualifiers)**. "Qualifiers" are the value fields of a finding.
4. Click **Save changes**. If the change would rewrite or flag terms in drafts, a check opens first, as in [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).

## Task profiles

What it is: the task profile is a JSON file that defines what annotators work with: the ontology, the layers (for example *Phenotypes*), the finding types in each layer and the value fields of each finding type with their values (for example *Assertion*: present, absent, uncertain). It holds neither texts nor the ontology itself. Every project has exactly one. An administrator sets it when [creating the project](admin.md#create-a-project); a lead can [replace it](#replace-the-task-profile) until the first work is submitted.

The other choices on the same form belong to the project, not to the profile: the ontology file (release), the allowed branches and the annotation scheme (*HPO phenotype* with fixed values and modifiers, or *Generic* with free values). A profile file can give a starting value for the branches and the scheme; after that they are the project's, and they can change later under **Settings**, tab **Ontology**. Replacing the profile does not change them.

### Template or own file

The built-in template *HPO phenotype* is a ready profile: ontology \`HP\`, one layer \`hpo-layer\` (*Phenotypes*), finding type \`phenotype\`, and the value fields *Assertion* (present, absent, uncertain), *Experiencer* (patient, family_member, other) and *Temporality* (current, historical). New project fills in the branch \`HP:0000118\` (Phenotypic abnormality) and the scheme *HPO phenotype*.

- Use the template if you upload only plain texts, or Ontospan bundles that fit it: layer \`hpo-layer\`, ontology \`hp\` (upper or lower case), branches exactly \`HP:0000118\`, and no value outside the lists above.
- Use your own file in every other case, for example a bundle with another layer ID, another ontology, other branches or the value \`unknown\`. Whoever produces the bundles usually has the matching profile; ask them for it.

### What a profile file looks like

A shortened example. The checksum (\`sha256\`) and \`release\` are those of the ontology file uploaded on **Ontologies**; click **Copy** next to its checksum.

\`\`\`json
{
  "schema_version": "ontotator-task-profile/v1",
  "profile_id": "lab-phenotypes/v1",
  "version": "1.0.0",
  "ontologies": [
    { "ontology_id": "hp", "label": "Human Phenotype Ontology",
      "release": "2026-09-01", "sha256": "20d4a647…d193d0" }
  ],
  "layers": [
    { "layer_id": "hpo-layer", "label": "Phenotypes", "ontology_id": "hp",
      "access": "editable", "default_type_id": "phenotype",
      "annotation_types": [
        { "type_id": "phenotype", "label": "Phenotype",
          "axes": [
            { "id": "assertion", "label": "Assertion", "options": ["present", "absent", "uncertain"] },
            { "id": "experiencer", "label": "Experiencer", "options": ["patient", "family_member", "other", "unknown"] },
            { "id": "temporality", "label": "Temporality", "options": ["current", "historical", "unknown"] }
          ] }
      ] }
  ],
  "default_layer_id": "hpo-layer"
}
\`\`\`

| Field | Meaning |
| --- | --- |
| \`ontology_id\` | The ontology's short ID, for example \`hp\`. Upper and lower case count as the same. It cannot change once the project exists. |
| \`release\`, \`sha256\` | The ontology file the project uses. They must be those of the file chosen on the form. |
| \`allowed_roots\` (optional) | The branches a new project starts with, for example \`["HP:0000118"]\`. \`[]\` means the whole ontology. Left out: the form starts empty, and \`ontotator admin projects create\` starts with \`HP:0000118\` for the scheme *HPO phenotype*. Use \`[]\` for bundles built for the whole ontology, as a new project must have the same branches as the bundle. |
| \`t1_profile\` (optional) | The annotation scheme a new project starts with: \`hpo-phenotype\` or \`generic\`. Left out: *HPO phenotype* for HPO on the form, *Generic* otherwise; \`ontotator admin projects create\` starts with *Generic*. |
| \`layer_id\` | The layer's ID. Bundles name it for each proposal. |
| \`axes\` | The value fields and their allowed values. With the scheme *HPO phenotype* only \`assertion\`, \`experiencer\` and \`temporality\` with the values above are possible; a profile may leave values out. |
| \`default_layer_id\` | The layer annotators start in. |

### What must match a bundle

An Ontospan bundle is checked against the project when you click **Check** in **Upload texts…**. Each layer of the bundle must fit:

| In the bundle | Must match | Who can change it |
| --- | --- | --- |
| Ontology ID | The profile's \`ontology_id\` (case does not matter) | Nobody: it is fixed when the project is created. An administrator creates a new project. |
| Layer ID | A \`layer_id\` of the profile | A lead, by [replacing the task profile](#replace-the-task-profile) until the first work is submitted |
| Ontology release | The project's ontology version | A lead, under **Settings**, tab **Ontology**; an administrator uploads the release first if it is missing |
| Allowed branches | Exactly the project's branches | A lead, under **Settings**, tab **Ontology**, **Advanced**, until the first work is submitted |
| Annotation scheme | The project's annotation scheme | As for the branches |
| Values of each proposal | One of the profile's values | A lead, by replacing the task profile |

When something differs, the check names it per text, for example *Layer hpo-layer: the bundle uses release 2026-09-01, this project uses release 2026-06-23*, and says who can change it. Nothing is imported.

## Replace the task profile

What for: change the layers, finding types and value fields annotators work with. See [Task profiles](#task-profiles).

Before you start: this is only possible until the first work is submitted. The new file must name the same ontologies as the project (the same \`ontology_id\`; upper and lower case count as the same) with the \`release\` and \`sha256\` of the version chosen under **Ontology version**. Otherwise saving is refused; the ontology of a project cannot change.

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
3. Tick **Annotate only after the translation review is accepted** if translations must be reviewed before annotation. Nobody can then annotate a translation that is not accepted; you can still assign annotators while the review is underway ([Assign work to the selected texts](lead-documents.md#assign-work-to-the-selected-texts)).
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
3. Choose a \`.md\` or \`.txt\` file (UTF-8, up to 256 KB) in **Guideline file (.md or .txt, up to 256 KB)**.
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
`,O=`# Lead overview

This chapter is for project leads. A lead sets up the project, uploads texts, plans and assigns the work, accepts the results and exports them. Back to the [handbook overview](README.md).

As a lead you see an extra group in the sidebar with the name of the current project: **Documents**, **Progress**, **Settings** and **Export**. System administrators see the same pages for every project ([Open and manage any project](admin.md#open-and-manage-any-project)). How annotators and consolidators do their tasks is in the [annotator reference](annotator.md) and the [consolidator chapter](consolidator.md).

The lead's tasks are in three chapters:

| Chapter | Screen | What is in it |
| --- | --- | --- |
| [Lead: project settings](lead-settings.md) | **Settings** | Name, languages, ontology, submission rules, workflow, people, guidelines |
| [Lead: texts, work plans and progress](lead-documents.md) | **Documents**, **Progress** | Upload, the Documents table, the text card, work plans, assigning, progress |
| [Lead: results, decisions and export](lead-results.md) | **Documents** (Finalization), **Export** | Accept results, consolidations, translation and text-change decisions, problem reports, export |

## Typical project, start to finish

1. An administrator creates the project and makes you its lead ([Set up a new project for a lead](admin.md#set-up-a-new-project-for-a-lead)).
2. Check the ontology, the languages and the rules: [Lead: project settings](lead-settings.md).
3. Add the people who work with you, and give the **Consolidator** role to those who may consolidate: [Add a member](lead-settings.md#add-a-member).
4. Publish the guidelines: [Publish the first or a new guideline version](lead-settings.md#publish-the-first-or-a-new-guideline-version).
5. Prepare and upload the texts and choose their work plan: [Upload texts](lead-documents.md#upload-texts).
6. Assign translation reviews and annotations: [Assign work to the selected texts](lead-documents.md#assign-work-to-the-selected-texts). Ontotator sends no e-mail; tell people that work is waiting in their **My tasks**.
7. Follow the work and answer what needs you: [Watch progress](lead-documents.md#watch-progress), [Decide on a problem report](lead-results.md#decide-on-a-problem-report), [Resolve a rejected or queried translation](lead-results.md#resolve-a-rejected-or-queried-translation).
8. Accept one result per text, or start a consolidation when annotators disagree: [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results), [Start a consolidation](lead-results.md#start-a-consolidation).
9. Read the consolidators' notes and flags, and improve the guidelines where they were unclear: [Accept a consolidation](lead-results.md#accept-a-consolidation).
10. Export the final results: [Export final results](lead-results.md#export-final-results).

Try it with the demo project: the [demo project guide](../../examples/demo-project/README.md) walks through every step with invented clinical letters, tool proposals, translations and guidelines.
`,I="/assets/admin-new-project-Cir0O66s.png",R="/assets/admin-setup-code-C_NzEJeU.png",W="/assets/annotator-carried-finding-yADspK5V.png",_="/assets/annotator-editor-dqHteLqT.png",P="/assets/annotator-finding-values-DF2d7KaZ.png",D="/assets/annotator-new-finding-Ck1Vt4sY.png",E="/assets/annotator-proposal-review-BfFE3fNQ.png",M="/assets/annotator-submit-dialog-DEybG3Zm.png",N="/assets/annotator-translation-review-DA3-4k_Z.png",U="/assets/consolidator-group-table-Dp7hujX8.png",Y="/assets/consolidator-submit-dialog-DJEkTQ6t.png",F="/assets/getting-started-my-tasks-ezmcCup8.png",L="/assets/getting-started-set-password-CC57Fe71.png",H="/assets/lead-assign-9KxFl6dY.png",B="/assets/lead-compare-results-DC6HkQJ3.png",G="/assets/lead-documents-CjycjdEv.png",q="/assets/lead-export-KFM5Mz1P.png",z="/assets/lead-move-release-check-BHRNaFox.png",K="/assets/lead-problem-report-C6J_XPtm.png",V="/assets/lead-progress-B0_lg4T2.png",Z="/assets/lead-text-card-DRw6CK7x.png",Q="/assets/lead-upload-preview-64cXvoTU.png",$="/assets/lead-work-plan-Dau0Rzps.png",J="/assets/workflow-Dii9V6xB.png",X="https://github.com/halbritter-lab/ontotator/blob/main",l="https://handbook.invalid/docs/handbook/",ee=Object.assign({"../../../docs/handbook/README.md":y,"../../../docs/handbook/admin.md":k,"../../../docs/handbook/annotator.md":b,"../../../docs/handbook/consolidator.md":v,"../../../docs/handbook/faq.md":x,"../../../docs/handbook/first-task.md":T,"../../../docs/handbook/getting-started.md":C,"../../../docs/handbook/lead-documents.md":A,"../../../docs/handbook/lead-results.md":S,"../../../docs/handbook/lead-settings.md":j,"../../../docs/handbook/lead.md":O}),te=Object.assign({"../../../docs/handbook/images/admin-new-project.png":I,"../../../docs/handbook/images/admin-setup-code.png":R,"../../../docs/handbook/images/annotator-carried-finding.png":W,"../../../docs/handbook/images/annotator-editor.png":_,"../../../docs/handbook/images/annotator-finding-values.png":P,"../../../docs/handbook/images/annotator-new-finding.png":D,"../../../docs/handbook/images/annotator-proposal-review.png":E,"../../../docs/handbook/images/annotator-submit-dialog.png":M,"../../../docs/handbook/images/annotator-translation-review.png":N,"../../../docs/handbook/images/consolidator-group-table.png":U,"../../../docs/handbook/images/consolidator-submit-dialog.png":Y,"../../../docs/handbook/images/getting-started-my-tasks.png":F,"../../../docs/handbook/images/getting-started-set-password.png":L,"../../../docs/handbook/images/lead-assign.png":H,"../../../docs/handbook/images/lead-compare-results.png":B,"../../../docs/handbook/images/lead-documents.png":G,"../../../docs/handbook/images/lead-export.png":q,"../../../docs/handbook/images/lead-move-release-check.png":z,"../../../docs/handbook/images/lead-problem-report.png":K,"../../../docs/handbook/images/lead-progress.png":V,"../../../docs/handbook/images/lead-text-card.png":Z,"../../../docs/handbook/images/lead-upload-preview.png":Q,"../../../docs/handbook/images/lead-work-plan.png":$,"../../../docs/handbook/images/workflow.png":J}),c=e=>e.slice(e.lastIndexOf("/")+1),i=Object.fromEntries(Object.entries(ee).map(([e,t])=>[c(e).replace(/\.md$/,""),t])),ne=Object.fromEntries(Object.entries(te).map(([e,t])=>[`images/${c(e)}`,t]));function oe(e){var t;return((t=/^# +(.+)$/m.exec(i[e]??""))==null?void 0:t[1].trim())??e}function ae(){const e=[...(i.README??"").matchAll(/\]\(([A-Za-z0-9_-]+)\.md[)#]/g)].map(t=>t[1]);return[...new Set(["README",...e,...Object.keys(i).sort()])].filter(t=>t in i)}function se(e){return e.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu,"").replace(/ /g,"-")}function ie(){const e=new Map;return t=>{const o=se(t);let n=o;for(;e.has(n);){const s=e.get(o)+1;e.set(o,s),n=`${o}-${s}`}return e.set(n,0),n}}function re(e,t){var d;if(/^[a-z][a-z0-9+.-]*:/i.test(e))return{kind:"external",href:e};const o=new URL(e,`${l}${t}.md`),n=decodeURIComponent(o.hash.slice(1)),s=(d=/^\/docs\/handbook\/([A-Za-z0-9_-]+)\.md$/.exec(o.pathname))==null?void 0:d[1];return s&&s in i?s===t&&n?{kind:"anchor",id:n}:{kind:"chapter",href:h({name:"help",chapter:s,...n?{section:n}:{}})}:{kind:"external",href:`${X}${o.pathname}${o.hash}`}}function he(e,t){if(/^[a-z][a-z0-9+.-]*:/i.test(e))return null;const o=new URL(e,`${l}${t}.md`).pathname.replace(/^\/docs\/handbook\//,"");return ne[o]??null}const u=e=>e.type==="text"?e.value:"children"in e?e.children.map(u).join(""):"";function de(){return e=>{const t=ie(),o=n=>n.children.forEach(s=>{s.type==="element"&&(/^h[1-6]$/.test(s.tagName)?s.properties.id=t(u(s)):o(s))});o(e)}}function p(e){var t;(t=document.getElementById(e))==null||t.scrollIntoView()}const le=e=>e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey;function ce(e){return{a:({href:t,children:o})=>{if(!t)return a.jsx(a.Fragment,{children:o});const n=re(t,e);return n.kind==="external"?a.jsx("a",{href:n.href,target:"_blank",rel:"noopener noreferrer",children:o}):n.kind==="chapter"?a.jsx("a",{href:n.href,children:o}):a.jsx("a",{href:h({name:"help",chapter:e,section:n.id}),onClick:s=>{le(s)&&(s.preventDefault(),p(n.id))},children:o})},img:({src:t,alt:o})=>{const n=t?he(t,e):null;return n?a.jsx("a",{className:"help-image-link",href:n,target:"_blank",rel:"noopener noreferrer",title:"Open the image at full size in a new tab",children:a.jsx("img",{className:"help-image",src:n,alt:o??"",loading:"lazy"})}):a.jsx("span",{className:"guideline-image-text",children:o?`Image: ${o}`:"Image"})},table:({children:t})=>a.jsx("div",{className:"guideline-table-scroll",tabIndex:0,role:"region","aria-label":"Table",children:a.jsx("table",{children:t})})}}function me({chapter:e="README",section:t}){const o=i[e];return r.useEffect(()=>{var n,s;t?p(t):(s=(n=document.getElementById("main"))==null?void 0:n.scrollTo)==null||s.call(n,0,0)},[e,t]),a.jsxs("div",{className:"help-page",children:[a.jsxs("nav",{className:"help-chapters","aria-label":"Handbook chapters",children:[a.jsx("ul",{children:ae().map(n=>a.jsx("li",{children:a.jsx("a",{href:h({name:"help",chapter:n}),"aria-current":n===e?"page":void 0,children:oe(n)})},n))}),a.jsx(w,{})]}),a.jsx("article",{className:"guideline-document help-document",children:o===void 0?a.jsxs(a.Fragment,{children:[a.jsx("h1",{children:"Chapter not found"}),a.jsxs("p",{children:["This handbook has no chapter “",e,"”. Pick one from the list."]})]}):a.jsx("div",{className:"guideline-markdown",children:a.jsx(f,{remarkPlugins:[g],rehypePlugins:[de],skipHtml:!0,components:ce(e),children:o})})})]})}export{me as default};
