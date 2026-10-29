import{r as i,a as p,j as o}from"./index-Dou6scD1.js";import{M as m,r as g}from"./index-DStFE9NZ.js";const f=`# Ontotator user handbook\r
\r
This handbook explains how to work with Ontotator in the browser. It is for everyone who uses the app: annotators, translation reviewers, consolidators, leads and system administrators. It describes the version of Ontotator that you open it from. If you run the server, read the [server operations guide (for server operators)](../operations.md) instead.\r
\r
## Start here\r
\r
| You are… | Read first | Then |\r
| --- | --- | --- |\r
| New to Ontotator, any role | [Getting started](getting-started.md) | the chapter for your role |\r
| Annotator or translation reviewer | [Your first task, start to finish](first-task.md) | [Annotator reference](annotator.md) |\r
| Consolidator | [Typical consolidation, start to finish](consolidator.md#typical-consolidation-start-to-finish) | [Consolidator chapter](consolidator.md) |\r
| Project lead | [Lead overview and typical project](lead.md) | [Settings](lead-settings.md), [Documents](lead-documents.md), [Results and export](lead-results.md) |\r
| System administrator | [Administration](admin.md) | |\r
\r
Stuck? See the [frequently asked questions](faq.md).\r
\r
## What Ontotator is\r
\r
Ontotator is a web app for marking findings in clinical texts and linking each one to a term of an ontology, for example the Human Phenotype Ontology (HPO). Several people annotate the same text, each on their own. The project lead then chooses one final result per text, either one submission or a merged consolidation. The final results are exported for research.\r
\r
### Why people work independently\r
\r
Each annotator works blind: you never see other people's work on the same text, only your own and, in some tasks, a tool's proposals. This keeps the results independent, so that the project can measure how well annotators agree and find texts or rules that are unclear. Only leads and consolidators see everyone's work.\r
\r
### What happens to your work\r
\r
- While you work, everything is saved automatically as a draft. Nobody else sees your draft.\r
- When you submit, your work becomes a fixed **submission**. The lead sees it; other annotators do not.\r
- The lead accepts one result per text as the **final result**, or asks a consolidator to merge differing submissions. Only final results are exported. Exports show your pseudonym, not your name.\r
\r
## Roles\r
\r
You can have more than one role. Roles other than system administrator apply to one project. The header shows your roles under your name.\r
\r
| Role in the UI | What you do | Chapter |\r
| --- | --- | --- |\r
| **Annotator** | Mark findings in the texts assigned to you, check tool proposals, submit your work. Annotators also do translation reviews. | [Annotator reference](annotator.md) |\r
| **Translation reviewer** | Not a separate role you can be given: any annotator can get a translation review task. The header shows this name while you work on one. | [Review a translation](annotator.md#review-a-translation) |\r
| **Consolidator** | Merge the differing submissions on one text into one result. | [Consolidator chapter](consolidator.md) |\r
| **Lead** | Set up the project, upload texts, plan and assign work, publish guidelines, accept results, export. | [Lead overview](lead.md) |\r
| **System administrator** | Create user accounts, upload ontology releases, create projects. | [Administration](admin.md) |\r
\r
## How work flows\r
\r
(translation review →) annotate → accept, or consolidate and accept → export\r
\r
1. **Translation review** (only for translated texts, if the project plans it): an annotator checks the translation against the source and accepts, corrects, queries or rejects it. The lead decides what happens with queried or rejected translations.\r
2. **Annotate**: the lead assigns a text to one or more annotators. Each annotator marks findings, either from scratch or from tool proposals. In a task from proposals, the annotator confirms, rejects or replaces each proposal. Then they submit the text.\r
3. **Accept**: on the **Documents** page, the lead sees all submissions of a text. If they agree, or if one is clearly right, the lead clicks **Accept result** or **Use as final**.\r
4. **Consolidate**: if the submissions differ, the lead clicks **Consolidate…** and picks a consolidator. The consolidator decides each difference and submits one merged result. The lead then accepts it.\r
5. **Export**: the lead exports the final results of the project.\r
\r
A lead can also reopen a submission, and an annotator can continue from their own submission in a new work round. A problem report pauses a task until it is decided.\r
\r
## Glossary\r
\r
Words you meet in the app, in alphabetical order. The handbook uses one word per concept; where the app uses a second word, it is named here.\r
\r
| Word | Meaning |\r
| --- | --- |\r
| Agreement | On the lead's text card: how many findings of the submissions on a text match. Findings that match in term and passage but differ in a value "differ in context only". |\r
| Annotation scheme | The set of value fields and modifiers a project uses, for example **HPO phenotype (fixed qualifiers, modifiers)**. |\r
| Branch | A part of an ontology: one term and everything below it. A project can limit search to some branches. |\r
| Carried finding | A finding taken over from an earlier round or text version into your current task. You check each one before you submit: it is marked **Check needed** until you do. To *carry* work means to take it over this way. |\r
| Case | One clinical document in all its languages, identified by its **case ID**. A case has one text per language. |\r
| Consolidation | A task that merges differing submissions on one text into one result. |\r
| Consolidator | The person who does a consolidation. Needs the **Consolidator** role in the project. |\r
| Default (prefilled value) | A value a new finding starts with, tagged **Default**. It counts as not confirmed until you confirm or change it. |\r
| Document | The app's word for a text on the **Documents** page and in a few labels such as **People per document**. Same as *text* in this handbook. |\r
| Final result | The one submission or consolidation per text that the lead accepts. Only final results are exported. |\r
| Finalization | The third part of the lead's text card, where the lead accepts the final result or starts a consolidation. |\r
| Finding | One ontology term marked in a text, with its values, modifiers and zero or more mentions. |\r
| Group | In a consolidation: the findings from different submissions on overlapping passages, decided together. |\r
| Guidelines | The project's annotation rules. Leads publish numbered versions (v1, v2, …); you read the version in force. |\r
| Layer | Part of the annotation setup with its own ontology. Each required layer must be checked before you submit. A **Reference** layer is read-only; a **Locked** layer cannot be edited. |\r
| Mention | A marked passage of text that supports a finding. A finding can have several mentions. |\r
| Modifier | An HPO term such as a severity or an onset, attached to a finding. |\r
| Ontology release | A loaded version of an ontology, for example one HPO release. Each project uses one release. |\r
| Ontospan bundle | A file format for uploading texts together with their translations and tool proposals. See [Prepare files for upload](lead-documents.md#prepare-files-for-upload). |\r
| Paused | A task that waits for a decision on a problem report. You can read it but not change or submit it. |\r
| Pin | A project *pins* the ontology release it uses. **Pinned by** on the **Ontologies** page lists those projects. |\r
| Problem report | A report that a text has a problem. It pauses your task until the lead decides. |\r
| Project | A unit of work with its own texts, people, ontology release, guidelines and settings. |\r
| Proposal layer | The tool proposals uploaded with a text. |\r
| Pseudonym | Your stable ID, for example \`ann-0004\`. Exports show it instead of your name. |\r
| Reopened | A submission the lead opened again for changes. Your task shows **Reopened** with the lead's reason. |\r
| Round | One pass of work on a task. A task can have several rounds, for example after you continue from your submission or after the text changed. |\r
| Spanless finding | A finding that points to no text passage. The project decides whether this is allowed and whether it needs a reason. |\r
| Submission | The fixed result of a task or round. To change it, a new round starts. |\r
| Task | Your piece of work on one text: Annotation, Translation review or Consolidation. |\r
| Task profile | The JSON file that defines a project's layers, finding types and value fields. |\r
| Text | One language version of a case, for example *CASE-1 en*. Tasks are always on one text. |\r
| Text card | The panel that opens on the lead's **Documents** page for one text, with the parts **Translation**, **Annotation** and **Finalization**. |\r
| Text version | One revision of a text (v1, v2, …). A correction creates a new version; the old one stays. |\r
| Tool proposal | A finding suggested by an external tool and uploaded with the text. You confirm, reject or replace it. |\r
| Translation review | A task in which you check a translated text and accept it, correct it, query it or reject it. |\r
| Unresolved | A decision on a tool proposal: you cannot decide it and leave a note for the lead. Not the same as clinical uncertainty (the value **Uncertain**). |\r
| Value field | One line under **Values** in a finding, with a fixed list of values, for example the assertion (**Present**, **Absent**, **Uncertain**). Scheme names call them *qualifiers*. |\r
| Work plan | Per text: whether it gets a translation review, and whether and how it is annotated. |\r
\r
## Chapters\r
\r
1. [Getting started](getting-started.md): log in, set your password, find your tasks, edit your profile.\r
2. [Your first task, start to finish](first-task.md): one annotation task from login to submission.\r
3. [Annotator reference](annotator.md): the editor, findings, values, tool proposals, carried findings, submitting, problem reports, translation review.\r
4. [Consolidator chapter](consolidator.md): how to decide, the groups, finishing a consolidation.\r
5. [Lead overview](lead.md): the typical project, with [Settings](lead-settings.md), [Documents](lead-documents.md) and [Results and export](lead-results.md).\r
6. [Administration](admin.md): user accounts, ontology releases, projects.\r
7. [FAQ](faq.md): typical problems and what to do.\r
\r
## How the handbook writes things\r
\r
- **Bold** text is a label exactly as the app shows it, for example **My tasks**. <!-- handbook: not-a-label -->\r
- *Italic* text is an example of a label or message that changes, for example *Publish as v2* or *CASE-1 en*.\r
- Keys are written like \`Ctrl+Z\` (macOS: \`Cmd+Z\`). A letter key such as \`j\` means the plain key; \`Shift+K\` means with Shift.\r
`,w=`# Administration\r
\r
This chapter is for system administrators. You manage user accounts, ontology releases and projects in the app. Back to the [handbook overview](README.md).\r
\r
Server set-up, the command line, backups, upgrades and deployment are in the [server operations guide (for server operators)](../operations.md). A lost administrator password is also handled there: see [Lost admin password](../operations.md#lost-admin-password).\r
\r
Ontotator sends no e-mail. New users and users who forgot their password get a one-time code from you, by hand.\r
\r
## Set up a new project for a lead\r
\r
The usual first day, in order:\r
\r
1. [Upload the ontology release](#upload-ontology-releases-and-translation-files) the project needs.\r
2. [Create the project](#create-a-project).\r
3. [Create a user account](#create-a-user-account) for the lead, with the **Lead** role in the new project.\r
4. [Hand over the setup code](#hand-over-a-setup-or-reset-code) to the lead.\r
\r
The lead then sets up the rest; see the [lead overview](lead.md).\r
\r
## Reach the administration pages\r
\r
What for: find the pages only system administrators see.\r
\r
1. Log in. Your role line in the header reads **System administrator**.\r
2. In the sidebar, open the group **Administration**.\r
3. Click **Users**, **Ontologies** or **New project**.\r
\r
Other users do not see this group. If they open such a page by its address, they get a short explanation instead.\r
\r
## Find and review user accounts\r
\r
What for: check who has an account, whether they finished setup and when they last logged in.\r
\r
1. In the sidebar, open **Administration** › **Users**.\r
2. Type a username or display name into **Filter users**.\r
3. Read the table. **Setup** shows **Pending** until the person has set a password. **Last login** shows **Never** if they have not logged in yet. **Active** reads **Yes**, **No** or **Anonymised**.\r
4. Click a row to highlight it. Click it again to clear the highlight.\r
5. Click **Refresh users** to reload the list.\r
\r
## Create a user account\r
\r
What for: give a new person access to Ontotator.\r
\r
1. On **Users**, click **New user…**.\r
2. Fill **Username** and **Display name**. **E-mail** and **Languages** are optional.\r
3. Tick **System administrator** only if the person should manage the whole server.\r
4. Optional: under **Add to projects (optional)**, tick a role per project: **Lead**, **Annotator** or **Consolidator**. With many projects, type into **Find project** to narrow the list.\r
5. Click **Create user**.\r
6. The setup-code dialog opens. [Hand over the code](#hand-over-a-setup-or-reset-code).\r
\r
The username uses 3–64 lower-case letters, digits, dots, hyphens or underscores. If it is taken or invalid, the message appears at the field.\r
\r
## Hand over a setup or reset code\r
\r
What for: let a person set their own password. Codes are shown only once.\r
\r
1. A dialog opens with the title **Setup code** or **Reset code** and the username. It shows the code and when it expires.\r
2. Click **Copy hand-over text**. This copies short instructions with the login address, the username and the code. Open **Hand-over text** to read it first. **Copy** copies only the code.\r
3. Give the text to the person in person or by a secure channel.\r
4. Tick **I have handed over or stored the code**.\r
5. Click **Close**.\r
\r
![Setup code dialog with the hand-over text open and the confirmation box](images/admin-setup-code.png)\r
\r
You cannot close the dialog or leave the page until the box is ticked. Setup codes last 24 hours, reset codes 2 hours. The person then uses **I have a setup or reset code** on the login page, see [Getting started](getting-started.md#set-your-password-with-a-setup-or-reset-code).\r
\r
## Issue a new setup or reset code\r
\r
What for: a code expired, got lost, or someone forgot their password.\r
\r
1. On **Users**, click **More…** in the person's row.\r
2. Choose **New setup code** (setup still pending) or **Reset code** (password already set).\r
3. Confirm with **New setup code** or **Reset code**. Any earlier unused code stops working. With a reset code, the current password keeps working until the new code is used.\r
4. [Hand over the code](#hand-over-a-setup-or-reset-code).\r
\r
Deactivated accounts get no new code. Activate the account first.\r
\r
## Edit a user's profile and administrator role\r
\r
What for: correct a name, e-mail, qualification or languages, or grant or remove the administrator role.\r
\r
1. On **Users**, click **Edit** in the row.\r
2. Change **Display name**, **E-mail**, **Qualification**, **Languages** or **System administrator**.\r
3. Click **Save changes**.\r
4. If you changed the administrator role, confirm with **Save changes** again. The person is logged out everywhere.\r
\r
You cannot remove your own administrator role. The last active system administrator cannot lose the role either; add another one first.\r
\r
## Deactivate or activate an account\r
\r
What for: stop someone from logging in, without deleting their work.\r
\r
1. On **Users**, click **More…** in the row.\r
2. Choose **Deactivate…**.\r
3. Confirm with **Deactivate**. The person is logged out everywhere.\r
4. To undo, open **More…** again and choose **Activate**.\r
\r
You cannot deactivate your own account. In project member lists the person shows as **Inactive**.\r
\r
## See a user's history\r
\r
What for: check what was changed on an account and by whom.\r
\r
1. On **Users**, click **More…** in the row and choose **History**. For anonymised accounts, click the **History** button in the row.\r
2. Read the table: **When**, **By**, **What**, **Whom**, **Project**, **Details**.\r
3. The dialog shows the newest 200 entries. For the whole trail, use the command \`ontotator admin audit\`, see [Server operations](../operations.md#users-ontologies-and-projects).\r
\r
## Anonymise a deactivated account\r
\r
What for: erase a person's personal data for good, while keeping their work.\r
\r
Warning: anonymising cannot be undone.\r
\r
Before you start: [deactivate the account](#deactivate-or-activate-an-account).\r
\r
1. On **Users**, click **More…** in the row and choose **Anonymise…**.\r
2. Read what is erased. The pseudonym and all work stay, so results and exports remain complete.\r
3. Type the username into the confirmation field.\r
4. Click **Anonymise permanently**.\r
\r
## Upload ontology releases and translation files\r
\r
What for: make a new ontology release (for example a newer HPO) or a translation file available to projects.\r
\r
1. In the sidebar, open **Administration** › **Ontologies**.\r
2. In **Ontology files**, choose one or more files: OBO Graph JSON ontologies (\`.json\`) or Babelon translation files (\`.tsv\`).\r
3. Click **Upload files**.\r
4. Read **Upload results**: **Added** or **Already present** per file.\r
\r
Each file is stored on its own. If one file fails, earlier files may already be in the list below. Incomplete HPO releases are refused: a missing or obsolete main branch, or too many terms that do not reach the root. The message names the problem; upload a complete release instead.\r
\r
## Check the ontology inventory and which projects use a file\r
\r
What for: see which releases are on the server and which projects use them.\r
\r
1. On **Ontologies**, look at **Uploaded files**.\r
2. The table lists file name, kind, release, language, checksum and upload time.\r
3. **Pinned by** lists the projects that use (*pin*) a file. Click a project key to open its settings; they open on **General**, so switch to the **Ontology** tab. Unused files read **Not pinned**.\r
4. Click **Copy** next to a checksum to copy it.\r
5. Click **Refresh inventory** to reload the list.\r
\r
To move a project to a newer release, upload it here, then follow [Move a started project to a newer release](lead-settings.md#move-a-started-project-to-a-newer-release).\r
\r
## Create a project\r
\r
What for: start a new project with its ontology and annotation scheme. Only system administrators can do this.\r
\r
Before you start: [upload the ontology release](#upload-ontology-releases-and-translation-files) the project needs.\r
\r
1. In the sidebar, open **Administration** › **New project**.\r
2. Fill **Project key** (2–63 lower-case letters, digits or hyphens) and **Name**. **Description** and **Languages of the texts** are optional.\r
3. Under **Profile source**, keep **Built-in template** and choose a template. Or choose **Upload profile JSON** and pick a task profile file.\r
4. For each ontology, choose the release in its ontology file field. Optionally limit the allowed branches and choose the annotation scheme. For HPO, both are filled in for you.\r
5. Click **Create project**.\r
6. The project's settings open on **People**. [Add the lead](lead-settings.md#add-a-member) and the other members.\r
\r
![New project form with key, name, template and ontology file filled in](images/admin-new-project.png)\r
\r
The project key cannot be changed later. Everything else, such as name, workflow and members, is set in the [project settings](lead-settings.md).\r
\r
## Open and manage any project\r
\r
What for: as system administrator you can manage every project, also without a project role.\r
\r
1. Click **Projects** in the sidebar, or **All projects** in the project switcher.\r
2. In the project's row, click **Open** to go to its documents, or **Settings** to change it.\r
3. Work as a lead would; see the [lead overview](lead.md).\r
`,k=`# Annotator reference\r
\r
This chapter is for annotators and translation reviewers. It explains the editor, how to mark findings, check tool proposals and carried findings, submit a text and review a translation. Back to the [handbook overview](README.md).\r
\r
New here? Start with [Your first task, start to finish](first-task.md). How to log in, find your tasks and open one is in [Getting started](getting-started.md). Words such as finding, mention, value field and modifier are explained in the [glossary](README.md#glossary).\r
\r
## Contents\r
\r
- Basics: [The editor screen](#the-editor-screen), [When is a task done?](#when-is-a-task-done)\r
- Findings: [Mark text and add a finding](#mark-text-and-add-a-finding), [Search a term](#search-a-term), [Browse the ontology tree](#browse-the-ontology-tree), [Set values and confirm defaults](#set-values-and-confirm-defaults), [Manage mentions](#manage-mentions-of-a-finding), [Add a finding without a text span](#add-a-finding-without-a-text-span), [Change term, note or delete a finding](#change-term-note-or-delete-a-finding), [Add modifiers](#add-modifiers-to-a-finding), [Turn a finding into a modifier](#turn-a-standalone-modifier-finding-into-a-modifier), [Work in several layers](#work-in-several-layers)\r
- Special tasks: [Review tool proposals](#review-tool-proposals), [Review carried findings](#review-carried-findings), [Re-create findings after a text correction](#re-create-findings-after-a-text-correction)\r
- Finishing: [Submit the text](#submit-the-text), [Confirm values and acknowledge warnings](#confirm-values-and-acknowledge-warnings-in-the-submit-dialog), [View your submissions](#view-your-submissions), [Start a new work round](#start-a-new-work-round)\r
- Problems: [Report a text problem](#report-a-text-problem), [Resume a paused task or withdraw a report](#resume-a-paused-task-or-withdraw-a-report)\r
- [Review a translation](#review-a-translation)\r
- [Keyboard shortcuts](#keyboard-shortcuts)\r
\r
## The editor screen\r
\r
![The editor with the findings list on the left, the text in the middle and the selected finding's details on the right](images/annotator-new-finding.png)\r
\r
The editor has three columns:\r
\r
| Column | What is in it |\r
| --- | --- |\r
| Left: **Findings** | The list of your findings. In a task from proposals: **Review Proposals** and **Your own findings**. |\r
| Middle: the text | The text you annotate. Marked passages are highlighted. |\r
| Right: details | The selected finding: **Values**, **Modifiers**, **Note**, its mentions and the term search. With nothing selected, the **New finding** panel opens here when you mark text. |\r
\r
To make the findings list wider or narrower, drag the divider between the findings list and the text (**Resize findings column**), or focus it and press \`←\` or \`→\`. On a narrow screen, the tabs **Findings**, **Document** and **Details** switch between the columns; **Back to text** returns to the text.\r
\r
The toolbar shows the text name, its language and the mode:\r
\r
| Mode | Meaning |\r
| --- | --- |\r
| **Annotate from scratch** | You see neither tool proposals nor other people's work. |\r
| **Annotate from proposals** | You see a tool's proposals, never other people's work. See [Review tool proposals](#review-tool-proposals). |\r
| **Review carried findings**, or the round name such as *Round 2, continued from Round 1* | Findings were carried over from earlier work. See [Review carried findings](#review-carried-findings). |\r
| **Check after text change** | The text was corrected. See [Re-create findings after a text correction](#re-create-findings-after-a-text-correction). |\r
\r
Next to the mode, the save status tells you whether your work is stored: **Saved**, **Saving...** or **Unsaved changes**. Work is saved automatically; there is no save button. If it reads **Offline** or shows an error, click **Retry**.\r
\r
The **More** menu holds **Work rounds**, **Report a text problem…**, the guidelines (for example *Guidelines v2*) and **Keyboard shortcuts (?)**.\r
\r
If the text was changed elsewhere, a **Revision conflict** notice appears; click **Reload case**. A submitted task is read-only.\r
\r
### Marks and badges\r
\r
| You see | Meaning |\r
| --- | --- |\r
| Fill colour of a mark | The term. The same term always has the same colour; the colour says nothing about the state. |\r
| Solid underline | Your own finding. |\r
| Dashed underline | A tool proposal under review. |\r
| Dotted underline | A read-only reference finding. |\r
| Diagonal hatching | A finding with the value **Absent**. |\r
| Thicker underline | Overlapping findings. |\r
| Frame | The finding you point at or selected. |\r
| **AI** | Proposed by a tool. Point at the badge to see which tool. |\r
| **Pending** | A proposal you have not decided yet. Decided proposals show **Confirmed**, **Rejected**, **Replaced** or **Unresolved**. |\r
| **Defaults to confirm** | The finding still has prefilled values you have not confirmed. |\r
| **Check needed** | A carried finding you have not checked yet. |\r
| **Spanless** | A finding without a text passage. |\r
\r
## When is a task done?\r
\r
A task is done when you submit it. Before that:\r
\r
- every finding the text states is marked, following the project guidelines;\r
- every value is chosen or confirmed (no **Default** left that you did not check);\r
- in a task from proposals, every proposal is decided;\r
- in a carried round, every carried finding is checked;\r
- you have read the whole text once more for findings you missed.\r
\r
**Next open item** takes you to everything that still needs you. After you submit, the lead receives your work; see [What happens next](first-task.md#9-what-happens-next).\r
\r
## Mark text and add a finding\r
\r
What for: record a term that the text mentions.\r
\r
1. Select the words in the text with the mouse. With the keyboard: click before the first word (or press Tab until the text has focus), hold Shift and move with the arrow keys.\r
2. The panel **New finding** shows the marked text. To adjust it, drag the edge handles at its start and end, or focus a handle and press \`←\` or \`→\`.\r
3. **Search term** is already filled with the marked words, and the hits are listed under **Terms**. Change the words, or type a code such as \`HP:0001250\`, if the right term is not among them.\r
4. Press Enter to add the top hit, or click a hit.\r
5. The finding is created with the project's prefilled values. [Confirm or change them](#set-values-and-confirm-defaults).\r
\r
To drop a mark without adding a finding, click **Discard** or press Esc.\r
\r
## Search a term\r
\r
What for: find the right ontology term quickly.\r
\r
1. Press \`/\` or click **Change term** to focus the search.\r
2. Type a name or a code. Hits appear in the list **Terms**.\r
3. Move with \`↓\` and \`↑\`; press Enter to take the active hit, or Esc to cancel.\r
\r
Search options:\r
\r
- To search only modifier terms (severity, onset, …), switch on **Modifiers only**, or type \`mod:\` before the word.\r
- The language of the text is searched too. To search names in other languages, click the language button next to the field (it lists the languages searched, for example *EN, DE*) and tick them under **Search languages**. English names are always searched.\r
- Hits tagged **Modifier** are modifier terms. Use one as a finding only if it names the finding itself; otherwise add it under **Modifiers**. Obsolete terms cannot be chosen.\r
\r
If nothing matches, change the words, try a code or switch search languages.\r
\r
## Browse the ontology tree\r
\r
What for: pick a broader or narrower term than the one you have.\r
\r
1. Select a finding and click **Show in tree**. The **Ontology tree** opens at the current term.\r
2. Click a term in the tree. Its **Synonyms**, **Translated names** and other parents (**Also under**) are shown.\r
3. Click **Use this term** to give the selected finding this term.\r
4. Click **Close tree**.\r
\r
## Set values and confirm defaults\r
\r
What for: record the context of a finding: whether it is present, who has it and when.\r
\r
1. Select the finding. The section **Values** lists each value field, such as the assertion (**Present**, **Absent**, **Uncertain**) or the experiencer (**Patient**, **Family member**, …). Press \`v\` to jump there with the keyboard.\r
2. Read the passage in context. "No seizures" is **Absent**; "his mother has seizures" is not the patient.\r
3. To change a value, choose another one. Value fields with few values are buttons; others are a dropdown.\r
4. Values the project prefills are tagged **Default**. They count as not confirmed until you confirm or change them. If all shown values are right, click **Confirm defaults** or press \`d\`. This confirms every default of this finding. On a button field you can also confirm one default by clicking its highlighted button.\r
\r
Findings with open defaults show **Defaults to confirm** in the list.\r
\r
## Manage mentions of a finding\r
\r
What for: link a finding to every place in the text that supports it.\r
\r
1. Select the finding.\r
2. Use the action you need:\r
   - **Add mention**, then mark the text: adds another place. Esc cancels.\r
   - **Add segment** on a mention, then mark the text: adds a second piece to the same mention, for words that are apart.\r
   - Drag a mention's edge handles, or focus an edge and press \`←\` or \`→\` (\`Ctrl+←\` / \`Ctrl+→\` moves by word): resizes it.\r
   - **Move to a new finding**: gives one mention its own finding with the same term and values. The original finding stays selected; the new one is added to the list. Select it there to change it.\r
   - **Remove**, then **Yes, remove**: detaches the mention.\r
\r
You cannot remove the last mention when the project requires a text span. If the project allows findings without a span, enter a reason in the note first.\r
\r
## Add a finding without a text span\r
\r
What for: record a finding that the text implies but does not state in one passage.\r
\r
Before you start: the project must allow findings without a text span. Otherwise the button is inactive.\r
\r
1. In the **Findings** header, click **Add finding without a text span**.\r
2. In the panel **New finding without a text span**, fill in **Reason for no text span** (if the project requires a reason).\r
3. Search and choose the term. If you chose the term first, click **Add annotation**.\r
4. The finding is listed as **Spanless**.\r
\r
Click **Cancel** to stop. The reason is kept as the finding's note.\r
\r
## Change term, note or delete a finding\r
\r
What for: correct a finding you made.\r
\r
1. Select the finding.\r
2. Use the action you need:\r
   - **Change term**, then search a new one: changes the term and keeps the mentions.\r
   - **Note**: type a comment. It is saved with the finding and the lead can read it.\r
   - **Delete finding**, then **Yes, delete**: deletes the finding and all its mentions.\r
\r
Warning: deleting a finding cannot be undone. Check that the right finding is selected first.\r
\r
If a term has become obsolete, the panel says so. Change the term or delete the finding.\r
\r
## Add modifiers to a finding\r
\r
What for: add severity, onset, pattern and similar details to a finding.\r
\r
1. Select the finding. In **Modifiers**, click **+ Add modifier…**, type into **Search modifier** and choose the modifier.\r
2. Optional: to link the modifier to the words that state it, click **Link a text span** and mark the text.\r
\r
You can also start from the text:\r
\r
1. Mark the words, for example "severe", and pick a modifier hit.\r
2. The panel asks which finding it belongs to. Click the finding in the list or in the text. The nearest ones are listed under **Nearest in this sentence:**.\r
3. If the modifier names the finding itself, choose the option to use it as the finding instead.\r
\r
To change a modifier later, open its row menu: **Link a text span…**, **Remove text span** or **Remove modifier**. A removal can be undone with **Undo** or \`Ctrl+Z\`.\r
\r
## Turn a standalone modifier finding into a modifier\r
\r
What for: fix a finding that is really a modifier of another finding.\r
\r
1. Select the finding. A warning says it is a modifier term.\r
2. Click **Turn into modifier…**.\r
3. Click the finding it belongs to. The list marks candidates with **Becomes a modifier of the finding you choose**.\r
\r
## Work in several layers\r
\r
What for: work in projects with more than one layer (for example two ontologies). With one layer this panel is not shown.\r
\r
1. Open **Layers & Ontologies** in the findings list.\r
2. Use the visibility toggle next to a layer to show or hide it. Layers tagged **Reference** are read-only.\r
3. Click **Activate** on the layer you want to annotate. **Locked** layers cannot be edited.\r
4. Choose the **Annotation type** for new findings.\r
\r
## Review tool proposals\r
\r
What for: check a tool's proposals one by one and add what the tool missed. Your mode reads **Annotate from proposals**.\r
\r
Tools make mistakes. Check every proposal as if you had marked it yourself: the marked text, the term and every value. Negations are a common error: a proposal for "Keine Krampfanfälle" (no seizures) with **Present** is wrong.\r
\r
1. The list **Review Proposals** shows every proposal. Your additions are under **Your own findings**.\r
2. Select a proposal, or move with \`j\` and \`k\`. The text shows where it was found.\r
3. Check the marked text, the term and each value.\r
4. Decide:\r
   - **Confirm**: the passage, term and all values are right. Values tagged **Defaulted** were not set by the tool but prefilled; Confirm accepts them as shown, so check them too.\r
   - **Reject**: the proposal is wrong and nothing should replace it.\r
   - **Edit & Replace**: the proposal is nearly right. You get an editable copy that replaces it; correct the term, values or text span in the copy.\r
   - **Unresolved**: you cannot decide. Write a **Reviewer note** saying why, then click **Save decision**. The proposal is submitted with your note and a reviewer flag. It does not block submitting; the lead (and a consolidator, if there is one) decides it.\r
5. After each decision, the next open proposal is selected. Press \`k\` right after a decision to go back to it.\r
6. When all proposals are decided, read the whole text again and add findings the tool missed as in [Mark text and add a finding](#mark-text-and-add-a-finding).\r
\r
To undo a decision, click **Reset decision (open)** or press \`0\`.\r
\r
**Unresolved** is a flag for the lead, not clinical uncertainty. For clinical uncertainty ("possible seizures"), use the value **Uncertain**.\r
\r
![A proposal selected, with the Confirm, Reject, Edit & Replace and Unresolved buttons](images/annotator-proposal-review.png)\r
\r
## Review carried findings\r
\r
What for: check findings that were carried over from an earlier round, for example after you continued from your submission, a lead reopened your work, or the text changed.\r
\r
1. The toolbar names the round, for example *Round 2, continued from Round 1*, or reads **Review carried findings**. The progress line counts checked findings.\r
2. Click **Next unchecked** (or press \`n\`) to select the next finding marked **Check needed**.\r
3. Read **What to check**: the text span, the values or the note. Carried values are not confirmed.\r
4. Optional: to see the finding as it was, click **Show original evidence**.\r
5. If it is right (after any edits), click **Mark as checked** or press \`c\`.\r
6. If it does not apply to this text, open **Does not apply…**, give a reason and click **Dismiss**.\r
\r
If you change a finding after checking it, it needs a new check.\r
\r
A row **Not on this text** means the finding could not be placed in this text. Select it and choose one: **Mark in text**, **Link to an existing finding**, or **Dismiss with reason…**.\r
\r
![A carried finding with What to check and the Mark as checked button](images/annotator-carried-finding.png)\r
\r
## Re-create findings after a text correction\r
\r
What for: move your findings to the corrected text after a lead changed it. The toolbar reads **Check after text change**.\r
\r
1. The panel **Needs review after the text change** lists the findings to place again.\r
2. For each item, click **Re-create here** and mark the supporting text in the corrected version.\r
3. Check the term, then click **Save re-created finding**. You can choose a different term below.\r
4. Check the text span and the values of the saved finding, then click **Complete text-change review**. A later change to the finding needs this again.\r
\r
If the finding no longer fits, click **Dismiss with reason**, fill in **Reason for dismissal** and click **Save dismissal**.\r
\r
## Submit the text\r
\r
What for: hand your finished work to the lead.\r
\r
Before you start: submitting says you checked the whole text for further findings, not only the ones you marked. See [When is a task done?](#when-is-a-task-done).\r
\r
1. Click **Next open item** to jump to things that still need attention.\r
2. Click **Finish & submit text**. While items are open, the button shows how many.\r
3. A dialog named after the text, for example *Submit CASE-1 en?*, lists what is still open: **Carried findings to check**, **Findings that need attention**, **Findings after text correction**, **Proposals not decided**. Click **Go to** to fix an item.\r
4. When nothing blocks, click **Submit text**. If only warnings are left, the button reads **Submit with** and the number of warnings; see [Confirm values and acknowledge warnings](#confirm-values-and-acknowledge-warnings-in-the-submit-dialog) first.\r
5. The next open task opens, or **My tasks** if none is left. To see what you sent, click **View result** in the message.\r
\r
The task is now read-only. To change it later, [start a new work round](#start-a-new-work-round).\r
\r
## Confirm values and acknowledge warnings in the submit dialog\r
\r
What for: finish prefilled values and modifier warnings without leaving the dialog.\r
\r
Check each value before you confirm it. **Confirm as shown** says "I checked this value and it is right"; it is not a way to make the warning go away. A value you leave unconfirmed is submitted as shown, but recorded as *defaulted*, not chosen. The lead and the export see this difference.\r
\r
1. The group **Values not chosen yet** lists findings with prefilled values.\r
2. Click **Go to** to check a finding in the text and change a value. If the shown values are right, click **Confirm as shown** on the row, or, with more than one row, **Confirm all as shown**.\r
3. The group **Modifier warnings** lists, for example, a modifier used as a finding or two severities on one finding. Click **Go to** to fix one.\r
4. Click the submit button. Warnings you leave are submitted as they are.\r
\r
If the project requires chosen values, unconfirmed values block submitting instead of warning.\r
\r
![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)\r
\r
## View your submissions\r
\r
What for: look at what you submitted earlier.\r
\r
1. Open the task. On a narrow screen, switch to **Details**.\r
2. Under **My submissions**, click **View** next to a round.\r
3. The dialog **Historical submission** shows the findings, values, notes and decisions of that submission.\r
4. Click **Close**.\r
\r
## Start a new work round\r
\r
What for: change your work after you submitted it, or start over. A submission itself never changes; a new round replaces it once you submit the round.\r
\r
1. Open the task, then open **More** and choose **Work rounds**.\r
2. The table **Rounds** lists each round with its state and submission. **You are here** marks the current one; **Open** opens another.\r
3. Under **Start a new round**, choose one:\r
   - To continue from your work: choose the submission under **Continue from** and click **Continue from this submission**. Your findings are carried into the new round, and each must be checked again ([Review carried findings](#review-carried-findings)).\r
   - To start over: click **Start empty round**. The new round has no findings.\r
4. Click **Close**, make your changes and [submit the text](#submit-the-text) again.\r
\r
What happens to your earlier work:\r
\r
- The earlier round stays in the history and is marked *Replaced by Round 2* (or the next number). Starting a round does not change the final result.\r
- Your task shows **Open** in **My tasks** again, with **Continue**. It no longer counts as submitted, so you must submit the new round.\r
- If the lead had already accepted your earlier submission as the final result, the lead is asked to review that choice.\r
\r
## Report a text problem\r
\r
What for: tell the lead that the text cannot be annotated as it is, for example cut off or the wrong text. For questions about the rules, ask your lead directly instead.\r
\r
Before you start: a report pauses your task. You cannot save or submit until the pause is released. Your saved work stays.\r
\r
1. Open **More** and choose **Report a text problem…**. In a translation review or consolidation, use the button **Report a text problem** in the header.\r
2. Describe the problem under **What is the problem?**. Only you and project leads can read it.\r
3. Click **Report and pause my task**.\r
\r
The menu item reads **Text problems** when there is something to see, for example your earlier reports. The dialog lists **Your reports** and offers **New report**.\r
\r
## Resume a paused task or withdraw a report\r
\r
What for: continue work after a report, or take a report back.\r
\r
1. Open **More**, then **Text problems**. Your report card shows its state and your task's state.\r
2. Choose one:\r
   - To continue: click **Resume my task…**, fill in **Why can you continue?** and click **Resume my task**. The report stays open for the lead.\r
   - To take the report back: click **Withdraw report…**, fill in **Why are you withdrawing it?** and click **Withdraw report**. Your task is no longer paused by this report.\r
\r
When the lead answers, the task shows a banner with **Open the answer**, and **My tasks** shows **Answer to your report**. If a project lead paused the task, only a project lead can release the pause.\r
\r
## Review a translation\r
\r
What for: check a machine or human translation before it is annotated. Your task is *Translation review*.\r
\r
Before you start: your profile must contain your **Qualification** ([Edit your profile](getting-started.md#edit-your-profile)). A submitted review cannot be changed.\r
\r
What to check: compare each paragraph with the source. Look for the problems the app lets you record:\r
\r
| Category | Look for |\r
| --- | --- |\r
| **Omission** | Something in the source is missing in the translation. |\r
| **Addition** | The translation says something the source does not. |\r
| **Negation or certainty** | "no", "possible", "suspected" lost or changed. |\r
| **Number or unit** | Numbers, doses, units, dates. |\r
| **Anatomy or laterality** | Body parts, left and right. |\r
| **Terminology** | A clinical term translated wrongly or too loosely. |\r
| **Problem in the source** | The source itself is wrong or unreadable. |\r
\r
Then decide:\r
\r
| Decision | Use it when | What happens next |\r
| --- | --- | --- |\r
| **Accepted unchanged** | The translation is right as it stands. | It becomes available for annotation. |\r
| **Accepted with corrections** | You corrected it and it is now right. Editing chooses this for you. | Your corrected text is saved as a new text version, which is accepted for annotation. |\r
| **Query** | The meaning may differ clinically and you are not sure. | Not accepted. The lead reads your rationale and decides. |\r
| **Rejected** | The translation changes the clinical meaning. | Not accepted. The lead decides: a new review, a correction or discarding it. |\r
\r
Steps:\r
\r
1. Open the task. The **Source** is on the left, the **Translation** on the right.\r
2. Read the automatic checks band at the top. Click **Details** to see which checks failed and why.\r
3. Type your corrections directly in the translation column. Your edits are saved as you type, and the decision switches to **Accepted with corrections**. Use **Show changes** to see your edits and **Couple scrolling** to scroll both columns together. **Show matching paragraph** (\`Alt+M\`) jumps to the paired paragraph.\r
4. Optional: to compare with another text, click the button that starts with **Compare with**, for example *Compare with … de*. With several texts to compare, it opens a menu **Compare with…**.\r
5. Under **Your review**, choose a **Decision** (or press \`1\` to \`4\`).\r
6. Fill in what the decision needs:\r
   - **Query** and **Rejected** always count as a clinically relevant change: choose at least one category and write a **Rationale**. Put your question for the lead in the rationale.\r
   - **Accepted with corrections**: tick **Clinically relevant change** if your correction changes the clinical meaning; then a category and a **Rationale** are required.\r
   - **Accepted unchanged** after a failed automatic check: say in the **Rationale** why the flagged difference is correct.\r
7. Click **Submit review…** (or press \`Ctrl+Enter\`), read what will happen, then click **Submit review**.\r
8. A message confirms the review, with **View result**. Your next open task opens on its own, or **My tasks** if none is left.\r
\r
If the source text was updated, **Source updates to review** appears. Open it, compare **Original source** and **Updated source**, and click **Submit review and resolve source update**.\r
\r
## Keyboard shortcuts\r
\r
What for: work without the mouse. Shortcuts are off while you type in a field or when a dialog is open. Letter keys work in lower and upper case alike. **Keyboard shortcuts (?)** in **More**, or \`?\`, lists the shortcuts of the current screen. Many buttons also show their key next to the label.\r
\r
| Key | Action |\r
|---|---|\r
| \`/\` | Focus the term search |\r
| \`↓\` / \`↑\`, Enter | Move through term hits; add the active hit |\r
| \`v\` | Focus the values |\r
| \`d\` | Confirm all default values of the selected finding |\r
| Esc | Discard the marked text, clear the selection, cancel adding a mention |\r
| Shift+arrow keys | Select text with the keyboard (after clicking into the text) |\r
| \`←\` / \`→\`, \`Ctrl+←\` / \`Ctrl+→\` | Move the focused mention edge |\r
| \`j\` / \`k\` | Next open / previous proposal. Right after a decision, \`k\` goes back to that proposal. |\r
| \`1\` \`2\` \`3\` \`4\` | Confirm, Reject, Edit & Replace, Unresolved |\r
| \`0\` | Reset the decision to open |\r
| \`n\` / \`Shift+N\` | Next / previous unchecked carried finding |\r
| \`c\` | Mark carried finding as checked |\r
| \`Ctrl+Z\` (macOS: \`Cmd+Z\`) | Undo removing a modifier |\r
| \`Alt+←\` / \`Alt+→\` | Previous / next text |\r
| \`Alt+P\` | Switch project |\r
\r
In a translation review: \`1\` to \`4\` choose a decision (outside the text), \`Ctrl+Enter\` submits (with a confirmation), \`Alt+M\` shows the matching paragraph.\r
`,y=`# Consolidator\r
\r
This chapter is for Consolidators and for leads who start or read consolidations. A consolidation merges two or more submissions on one text into one result. Findings that everyone agrees on are taken over automatically; you decide the rest.\r
\r
How to open tasks is in [getting-started.md](getting-started.md). Accepting the result is in [lead.md](lead.md). Reporting a text problem works as in [annotator.md](annotator.md#report-a-text-problem).\r
\r
## Start a consolidation (lead)\r
\r
What for: let a person merge the submissions of a text. Needs at least two submissions on the text.\r
\r
1. On **Documents**, open the text card of the text.\r
2. In its final result part, click **Consolidate…**. The form **Consolidate submitted results** opens with the compared submissions already ticked.\r
3. Under **Submissions to merge**, tick the submissions to merge (at least two).\r
4. Under **Consolidator**, choose a person. The first choice is you. People who annotated this text may be greyed out, depending on the project rules.\r
5. Optionally fill in **Consolidation reason (optional)**.\r
6. Click **Start consolidation**.\r
7. A message confirms the start. If you chose yourself, you get the Consolidator role for this project and can click **Open consolidation**.\r
\r
If the button stays inactive, the form says why, for example "Select at least two submissions." or "Choose a consolidator." If you already have a consolidation in progress on this text, the button reads **Continue consolidation**.\r
\r
## Open a consolidation task\r
\r
What for: start or continue your consolidation work.\r
\r
1. In **My tasks**, find the row whose task is **Consolidation**.\r
2. Click **Start**, **Continue** or **View**.\r
3. The consolidation screen opens. Its heading reads, for example, "Consolidate CASE-1 en v1". The path above it shows how many groups are still open.\r
4. The header holds **Open in full editor**, the guidelines (for example "Guidelines v2") and **Report a text problem**.\r
\r
The screen is read-only after you submitted, when the task is no longer yours, when it is paused, or when a submission used here was withdrawn. A banner tells you which.\r
\r
## Read the text and walk the groups\r
\r
What for: see who marked what and work through the differences in order.\r
\r
1. On the left, the **Clinical text** shows one underline per person. The legend below says which line style belongs to whom. Kept findings are shaded; the selected group is framed.\r
2. On the right, the list **Groups** holds the findings in text order. Each group shows its passage and its state: **to decide** (or how many fields are left), **agreed**, **decided**, **not in result** or **attached**. A **Conflict** mark shows that people disagree.\r
3. One group is open at a time. Click a group, or a marked passage in the text, to open it.\r
4. Press \`J\` for the next open group and \`K\` for the previous one.\r
5. The progress card counts open and decided groups. **Next open group** jumps to the next one.\r
\r
On a smaller screen, use **Hide text** and **Show text** to make room. On a phone-sized screen, each group shows its own text snippet instead.\r
\r
## Compare values in the ✓ table and Keep\r
\r
What for: decide a group by choosing, per field, the value that is right.\r
\r
1. Open a group. The table has one column per person. A robot icon marks findings from a tool proposal.\r
2. The rows are **Term**, one row per value (for example the assertion), **Text**, **Modifiers** and **Note**. Rows where people disagree come first and are highlighted; the other rows need no choice.\r
3. In each highlighted row, click the ✓ next to the value you want.\r
4. Read the result line below the table. It starts with "Result:" and lists what is still not chosen, for example "text not chosen yet". **Not taken:** lists the values you left out.\r
5. Optional: click **+ note** to write a **Note for the lead**, and tick **Guidelines unclear here** if the guidelines did not settle the case.\r
6. Click **Keep**. The group reads **decided**, the message **Decision saved** appears with **Undo**, and the next open group opens.\r
\r
**Keep** stays inactive until every highlighted row has a choice. If only one person marked the finding, the button names them, for example "Keep Luc Martin's finding".\r
\r
If the same term is already in the result from another group, the card warns you. **Keep** then adds a second finding with that term.\r
\r
![An open group with the comparison table, ✓ choices and the Keep button](images/consolidator-group-table.png)\r
\r
## Leave a finding out of the result\r
\r
What for: drop a finding that should not be in the result.\r
\r
1. Open the group.\r
2. Click **Not in result**. The group reads **not in result**.\r
\r
## Attach a modifier to a finding\r
\r
What for: when someone used a modifier term (such as "Severe") as a finding of its own, turn it into a modifier of the right finding.\r
\r
1. Open the group. The card says that a modifier term was used as a finding.\r
2. Click **Attach to a finding…** and choose the finding from the menu.\r
3. The group reads **attached**. The target group lists the modifier under **Attached modifier:**.\r
\r
## Edit values or pick another term\r
\r
What for: keep a finding with a value or term that nobody chose.\r
\r
1. Open the group and click **More…**. It is offered when no row is in conflict or when the terms differ.\r
2. To change values: choose **Edit values…**, set each value and the modifiers, then click **Keep with these values**. This is offered only when no row is in conflict.\r
3. To use a different term: choose **Other term…**, search and pick a term. If there was no term conflict, it is saved at once; otherwise choose the remaining highlighted rows with ✓ and click **Keep**.\r
\r
Click **Cancel** to stop without changes.\r
\r
## Add a finding everyone missed\r
\r
What for: add a finding that no submission has.\r
\r
1. Select the passage in the text. Or click **Add finding**, type the passage into **Passage from the text** (choose the **Occurrence** if it appears more than once) and click **Continue**.\r
2. Search and pick the term.\r
3. A message confirms the new finding. It is listed under **Added by you**.\r
\r
If the passage is not found, type it exactly as written, or select it in the text.\r
\r
## Change or undo a decision\r
\r
What for: correct a decision you made.\r
\r
1. Right after a decision: click **Undo** in the group row, or press Ctrl+Z (Cmd+Z on a Mac).\r
2. Later: open the decided group and click **Reopen**. Decide it again.\r
3. To change only the note or the flag of a decided group, use **Edit note** and **Save note**, or the **Guidelines unclear here** box. These save at once.\r
4. To start over: open **More…** in the header (shown once you decided a group) and choose **Reopen all decisions…**, then **Reopen all**. The message offers **Undo**.\r
\r
If you changed a group in the full editor, reopening it drops that edit. You are asked to confirm.\r
\r
## Finish a consolidation\r
\r
What for: hand the merged result to the lead.\r
\r
1. When no group is open, the progress card reads **Ready to submit**.\r
2. Click **Submit consolidation**.\r
3. The dialog **Submit consolidation?** shows how many groups and findings the result has, and how many are not in the result.\r
4. If there are warnings (values filled in by default, a modifier used as a finding, two severities), they are listed under **Check before you submit**. Click **Back** to fix them, or submit anyway: the button then reads **Submit with** and the number of warnings.\r
5. Click **Submit**.\r
6. The screen confirms: "Consolidation submitted. The lead then accepts the result." If you are the lead yourself, it reads "Consolidation submitted. Accept the result in Documents." Open your next task or click **Back to my tasks**.\r
\r
While groups are open, **Submit consolidation** stays inactive and says how many groups are left.\r
\r
![The Submit consolidation? dialog with the summary](images/consolidator-submit-dialog.png)\r
\r
## Work in the full editor\r
\r
What for: change text spans or add findings that the comparison table cannot express.\r
\r
1. Click **Open in full editor**.\r
2. The editor shows the mode **Consolidate** and the list **Selected submitted findings** with each finding's author. It works as described in [annotator.md](annotator.md).\r
3. Click **Back to consolidation** to return.\r
\r
Groups you changed here are tagged **edited in editor** on the consolidation screen.\r
\r
## Read a submitted consolidation (lead)\r
\r
What for: see how a consolidation result came about before you accept it.\r
\r
1. On **Documents**, open the text card and click **Open consolidation**. Or, if the card shows flagged findings ("guidelines unclear"), click **Open** next to one to go straight to that group.\r
2. The heading reads, for example, "Consolidation of CASE-1 en v1". The banner says who submitted it. The view is read-only.\r
3. Decided groups show the Consolidator's note, the flag **Flagged: guidelines unclear** and the tag **kept** on the chosen values. Added findings say who added them.\r
4. Click **Back to documents** and accept the result there, see [lead.md](lead.md).\r
\r
## Look at the text and others' work in the text view\r
\r
What for: read a text with other people's findings or the result, and compare two of them side by side. Leads and Consolidators see other people's work; everyone else sees only their own.\r
\r
1. Open the text view, for example from the text card or from **Documents**.\r
2. Choose the language and version in **Language and version**.\r
3. In **Show**, choose **Text only**, a proposal layer, someone's annotations or the result. Its findings are listed under **Findings**.\r
4. Click **Compare** to open a second pane with its own **Language and version** and **Show**. Tick **Couple scrolling** to scroll both together. Click **Close comparison** to close it.\r
5. Click **Submissions** to open the **Submission history**. Choose a row to show it. Click **Close**.\r
6. Click **Open my task** to go to your own task on this text.\r
`,b=`# Frequently asked questions\r
\r
Short answers to problems people often meet. Each answer links to the chapter with the full steps.\r
\r
## Logging in\r
\r
### I forgot my password\r
\r
Ask a system administrator for a reset code. Ontotator sends no e-mail. Then click **I have a setup or reset code** on the login page and set a new password. See [Set your password with a setup or reset code](getting-started.md#set-your-password-with-a-setup-or-reset-code). Administrators: see [Issue a new setup or reset code](admin.md#issue-a-new-setup-or-reset-code).\r
\r
### The login says "Username or password is wrong, or the account is temporarily locked."\r
\r
Check the spelling of your username. After 5 wrong passwords within 15 minutes, login for that username from your network is locked for up to 15 minutes; wait and try again. If you no longer know the password, ask an administrator for a reset code.\r
\r
### My setup or reset code does not work\r
\r
Codes work once and expire: setup codes after 24 hours, reset codes after 2 hours. A newer code also cancels an older one. Ask an administrator for a new code. Capital letters, spaces and hyphens in the code do not matter.\r
\r
### A login window appears while I am working\r
\r
Your session has ended. Log in again in that window. Your unsaved edits stay in the open editor and are saved after you log in. See [Log in](getting-started.md#log-in).\r
\r
### The page says "The page is out of date; reload it." or "Your page is out of date."\r
\r
Reload the page in the browser, then repeat the last action. If the message asks you to, log in again ([Log in](getting-started.md#log-in)).\r
\r
## Tasks and projects\r
\r
### My tasks is empty\r
\r
A project lead has not assigned you a text yet. Assigned texts appear under **My tasks** automatically. Also check the status tabs: **All** shows every task. See [See your tasks](getting-started.md#see-your-tasks).\r
\r
### I see "You are not a member of any project yet."\r
\r
Ask your project lead or an administrator to add you to a project, then reload the page. Leads: see [Add a member](lead-settings.md#add-a-member).\r
\r
### A task opens with "Task not found or not yours"\r
\r
The task was removed or given to someone else, or you followed a link meant for another person. Go back to **My tasks** ([See your tasks](getting-started.md#see-your-tasks)).\r
\r
### My task is paused\r
\r
A problem report pauses the task, yours or the lead's. You can read your saved work but not change or submit it. If you reported the problem yourself, you can resume with a reason. If the lead paused it, only the lead can release it. See [Resume a paused task or withdraw a report](annotator.md#resume-a-paused-task-or-withdraw-a-report).\r
\r
### My submitted task is read-only\r
\r
Submitted work cannot be changed. Ask the project lead to reopen it. A reopened task shows **Reopened** with the lead's reason.\r
\r
### I cannot open project settings, Ontologies or New project\r
\r
Project settings are for project leads. **Ontologies**, **Users** and **New project** are for system administrators. The page tells you whom to ask. See [Roles](README.md#roles).\r
\r
## Annotating\r
\r
### Why is "Finish & submit" disabled?\r
\r
Something is still open. Click **Next open item** to jump to it, or open the submit dialog: it lists every open item with **Go to**. Typical reasons are undecided proposals, carried findings not yet checked, findings after a text correction, or values not yet chosen. See [Submit the text](annotator.md#submit-the-text).\r
\r
### The submit dialog shows "Values not chosen yet"\r
\r
Some findings still have prefilled values you did not confirm. Click **Confirm as shown** per finding, or **Confirm all as shown**, or **Go to** the finding and choose another value. In some projects you must confirm them before you can submit. See [Confirm values and acknowledge warnings in the submit dialog](annotator.md#confirm-values-and-acknowledge-warnings-in-the-submit-dialog).\r
\r
### The submit dialog shows "Modifier warnings"\r
\r
A finding uses a modifier term (such as a severity) as the finding itself, or has two modifiers of one kind. Check it with **Go to**. If it is correct, submit anyway with the button that names the number of warnings. See [Add modifiers to a finding](annotator.md#add-modifiers-to-a-finding).\r
\r
### Submitting fails with "Replace obsolete terms" or "Replace unknown terms"\r
\r
The project moved to a newer ontology release and a term in your draft no longer exists there. Pick another term for that finding, or reject or replace the affected proposal. Then submit again. See [Change term, note or delete a finding](annotator.md#change-term-note-or-delete-a-finding).\r
\r
### "Add finding without a text span" is disabled\r
\r
Your project requires a text span for every finding. Mark the text passage instead. See [Add a finding without a text span](annotator.md#add-a-finding-without-a-text-span).\r
\r
### The save status says "Changed elsewhere – reload required"\r
\r
The same task was changed in another window or by someone else. Click **Reload case**. See [The editor screen](annotator.md#the-editor-screen).\r
\r
### The save status says "Offline – changes not saved"\r
\r
The connection to the server is lost. Keep the window open; your input stays in the editor. When the connection is back, saving usually resumes on its own; if the status stays, click **Retry**. See [The editor screen](annotator.md#the-editor-screen).\r
\r
## Translation review\r
\r
### I cannot submit my review: "Your qualification is required to submit."\r
\r
Add your qualification (for example "physician, native German speaker") in your profile, then submit again. Use the link **Add your qualification in your profile**. See [Edit your profile](getting-started.md#edit-your-profile).\r
\r
### What does "automatic check failed" mean?\r
\r
The translation tool checked its own output and found a possible problem, for example numbers or units that differ from the source. Click **Details** to read the check, what the tool reported and what to do if the translation is right anyway. Open **Technical details** for the technical code of the check. If Ontotator has no description for a check, ask the project lead what it checks. See [Review a translation](annotator.md#review-a-translation).\r
\r
## Consolidating\r
\r
### Why is "Submit consolidation" disabled?\r
\r
Some groups are still open. Decide each open group first; the progress card counts what is left. See [Finish a consolidation](consolidator.md#finish-a-consolidation).\r
\r
### The consolidation asks me to "Check before you submit"\r
\r
The result has findings with values filled in by default, modifier terms used as findings, or modifier warnings. Check them; if they are correct, submit with the warnings. See [Finish a consolidation](consolidator.md#finish-a-consolidation).\r
\r
## Leading a project\r
\r
### I cannot accept a result\r
\r
In projects where the consolidator of a text may not be one of its annotators, you cannot choose a result you made yourself. Another lead must choose it. See [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results).\r
\r
### The export asks me to tick a box\r
\r
Some texts still need your decision or have no final result. Either decide them in **Documents** first, or tick the box to export the ready results and leave the others out. See [Export final results](lead-results.md#export-final-results).\r
\r
### I cannot remove a lead\r
\r
A project needs at least one lead. Add another lead first, then remove the role. See [Change a member's roles](lead-settings.md#change-a-members-roles).\r
\r
### "Save changes" is disabled in the settings\r
\r
Nothing has changed yet. The button turns on as soon as you edit a field. **People** and **Guidelines** save on their own and have no save button. See [Open project settings](lead-settings.md#open-project-settings).\r
\r
## Administration\r
\r
### I cannot close the setup-code dialog\r
\r
Tick **I have handed over or stored the code** first. The code is shown only once. See [Hand over a setup or reset code](admin.md#hand-over-a-setup-or-reset-code).\r
\r
### "You cannot remove your own administrator role."\r
\r
This protects you from locking yourself out. Another system administrator must do it; you also cannot deactivate yourself. The last active system administrator always keeps the role. See [Edit a user's profile and administrator role](admin.md#edit-a-users-profile-and-administrator-role).\r
\r
### An ontology upload is refused\r
\r
The file could not be read, is too large, or is an incomplete HPO release. Read the detail below the message and upload a complete release. See [Upload ontology releases and translation files](admin.md#upload-ontology-releases-and-translation-files).\r
\r
### The administrator lost the password\r
\r
This is fixed on the server, not in the app. See [Lost admin password](../operations.md#lost-admin-password) in the server operations guide.\r
`,v=`# Your first task, start to finish\r
\r
This chapter takes you through one annotation task, from your first login to a submitted text. Do it once in this order; afterwards, look things up in the [annotator reference](annotator.md). Back to the [handbook overview](README.md).\r
\r
Before you start: you need the address of your Ontotator server, your username and a setup code from your administrator, and a lead must have assigned a text to you.\r
\r
## 1. Log in\r
\r
1. Open the address of your Ontotator server.\r
2. The first time: click **I have a setup or reset code**, enter your **Username**, the code and a new password twice, then click **Set password and log in** ([details](getting-started.md#set-your-password-with-a-setup-or-reset-code)).\r
3. Later: enter your **Username** and **Password** and click **Log in**.\r
\r
## 2. Find your task\r
\r
1. Click **My tasks** in the sidebar.\r
2. On the tab **To do**, find a row whose **Task** is *Annotation, from scratch* or *Annotation, from proposals*.\r
3. Click **Start**.\r
\r
The editor opens. If you see **Projects** instead of **My tasks** after logging in, click **My tasks** in the sidebar. If you have no task, you see **No texts are assigned to you yet.**; ask your lead.\r
\r
## 3. Read the guidelines\r
\r
The first time you open a task in a project with guidelines, a notice asks you to read them. Click the read button in the notice, for example *Read guidelines v2*. Later you find them under **More** in the toolbar.\r
\r
The guidelines tell you what to mark and how: which findings count, how much text to mark, how to handle negations or family history. When in doubt, follow the guidelines; if they do not answer your question, ask your lead.\r
\r
## 4. Get to know the screen\r
\r
The editor has three columns: the list of **Findings** on the left, the text in the middle and the details of the selected finding on the right. The toolbar shows the mode, for example **Annotate from scratch**, and the save status. Everything is saved automatically; **Saved** means your work is stored. See [The editor screen](annotator.md#the-editor-screen).\r
\r
## 5. Mark a finding\r
\r
1. Read the text from the start. When it names a finding, for example "seizures", select the words with the mouse.\r
2. The panel **New finding** opens. **Search term** already holds the marked words, and the hits are listed under **Terms**.\r
3. Check the top hit. If it is the right term, press Enter. Otherwise, click another hit or change the words in **Search term**.\r
\r
![The New finding panel with the marked text and the term search open](images/annotator-new-finding.png)\r
\r
## 6. Choose the values\r
\r
The new finding starts with the project's prefilled values, for example **Present** for the assertion and **Patient** for the experiencer. They are tagged **Default** and do not count as chosen yet.\r
\r
1. Read the passage again in context. Does the text say the finding is there, absent ("no seizures") or uncertain? Is it the patient's or a family member's?\r
2. If a value is wrong, choose the right one under **Values**.\r
3. If all shown values are right, click **Confirm defaults** (or press \`d\`).\r
\r
Repeat steps 5 and 6 for every finding in the text.\r
\r
## 7. Check the tool proposals (tasks from proposals only)\r
\r
In a task *Annotation, from proposals*, the column **Review Proposals** lists findings a tool suggested. Tools make mistakes, especially with negations: a tool may propose "Keine Krampfanfälle" (no seizures) as **Present**.\r
\r
1. Select the first proposal. The text shows where it was found.\r
2. Check three things: the marked text, the term and every value.\r
3. Click **Confirm** if all three are right, **Reject** if the proposal is wrong, or **Edit & Replace** to correct it. If you cannot decide, click **Unresolved** and write a **Reviewer note**.\r
4. The next open proposal is selected. Go on until every proposal is decided.\r
5. Then read the whole text for findings the tool missed and add them as in step 5.\r
\r
![A proposal selected, with the Confirm, Reject, Edit & Replace and Unresolved buttons](images/annotator-proposal-review.png)\r
\r
Details: [Review tool proposals](annotator.md#review-tool-proposals).\r
\r
## 8. Submit\r
\r
Before you start: submitting means you checked the whole text, not only the findings you marked.\r
\r
1. Click **Next open item** until nothing is left. It takes you to every proposal, value or finding that still needs you.\r
2. Click **Finish & submit text**.\r
3. The dialog lists what is still open, with **Go to** for each item. Values you have not confirmed are under **Values not chosen yet**: confirm them only if you checked that they are right.\r
4. Click **Submit text**.\r
\r
![The submit dialog with the Values not chosen yet group](images/annotator-submit-dialog.png)\r
\r
Details: [Submit the text](annotator.md#submit-the-text).\r
\r
## 9. What happens next\r
\r
- Your task shows **Submitted** in **My tasks**. It is read-only now; click **View** to look at it.\r
- The next open task opens on its own, or **My tasks** if none is left.\r
- The lead sees your submission next to the other annotators' work on the same text, and accepts one result or starts a consolidation. You do not see other people's work.\r
- Your task is done. You do not need to do anything else unless the lead reopens it (**Reopened** in **My tasks**) or you notice a mistake.\r
\r
If you notice a mistake after submitting: open the task, choose **More** › **Work rounds** and click **Continue from this submission** ([Start a new work round](annotator.md#start-a-new-work-round)). Fix the finding, check the carried findings and submit again.\r
\r
If something is wrong with the text itself (cut off, wrong patient, unreadable): **More** › **Report a text problem…** ([Report a text problem](annotator.md#report-a-text-problem)).\r
\r
## If you were given a translation review\r
\r
A *Translation review* task shows the source and the translation side by side. You correct the translation if needed and choose a decision. See [Review a translation](annotator.md#review-a-translation).\r
`,x=`# Getting started\r
\r
This chapter is for everyone. It shows how to log in, find your tasks and keep your profile up to date. Back to the [handbook overview](README.md).\r
\r
## Before you start\r
\r
- Your administrator gives you the address of your Ontotator server, your username and a one-time setup code.\r
- Use a current version of Chrome, Firefox, Edge or Safari.\r
- Everything you do is saved automatically. There is no **Save** button in tasks, and you can close the browser tab at any time and continue later.\r
\r
## Set your password with a setup or reset code\r
\r
What for: your first login, or a new password after an administrator reset it.\r
\r
Before you start: you need a setup or reset code from your administrator. A code works once. Setup codes expire after 24 hours, reset codes after 2 hours.\r
\r
1. Open the address of your Ontotator server in your browser. You see the login screen.\r
2. Click **I have a setup or reset code**. The form **Set your password** opens.\r
3. Enter your **Username**.\r
4. Enter the code in **Setup or reset code**.\r
5. Enter a password in **New password**: 12 to 256 characters, different from your username.\r
6. Enter it again in **Repeat the new password**.\r
7. Click **Set password and log in**.\r
\r
![The Set your password form with the fields Username, Setup or reset code, New password and Repeat the new password](images/getting-started-set-password.png)\r
\r
If you see **Your password is set. Log in with it now.**, the password worked; [log in](#log-in). If you see **The two passwords differ.**, type both passwords again. To go back without a code, click **Back to login**.\r
\r
## Log in\r
\r
What for: start working.\r
\r
1. Open the address of your Ontotator server in your browser. You see the heading **Log in to Ontotator**.\r
2. Enter your **Username** and **Password**.\r
3. Click **Log in**.\r
\r
After logging in, Ontotator opens the project you used last on this browser:\r
\r
- annotators and consolidators see **My tasks** for that project;\r
- leads see the project's **Documents** page.\r
\r
The first time, or if that project is no longer yours, you see **Projects**. Click **My tasks** in the sidebar to see your work. On **Projects**, **Needs your decision** counts texts that wait for a lead's decision, and **Your open tasks** counts your tasks.\r
\r
If your session ends while you work, a login box opens with **Your session has ended. Please log in again.** Log in there. Your unsaved input is kept.\r
\r
## Log out\r
\r
What for: end your session, for example on a shared computer.\r
\r
1. Click **Log out** in the header.\r
2. If a dialog **Unsaved changes** opens, click **Save and log out**.\r
3. If a dialog **Unsaved profile changes** opens, click **Save and log out** to keep your changes, or **Discard and log out**.\r
\r
## Find your way around\r
\r
What for: know where things are.\r
\r
The header is the same on every page:\r
\r
- **Ontotator** on the left takes you to the start page.\r
- The breadcrumb shows where you are, for example **My tasks** or **Documents**.\r
- On the right are your display name, your pseudonym, your roles and **Log out**.\r
- **Handbook** in the header opens this handbook in a new tab.\r
\r
The sidebar lists **My tasks**, **Projects** and **Profile**. The number after **My tasks** counts your open tasks. Leads also see their project's pages (**Documents**, **Progress**, **Settings**, **Export**). System administrators also see **Administration** with **Users**, **Ontologies** and **New project** (see [Administration](admin.md)). In the editor, the sidebar folds into **Sections**; click it to open it.\r
\r
## Switch project\r
\r
What for: work in another project.\r
\r
1. Click the project switcher in the sidebar. It shows **Project** and the current project name. The shortcut is \`Alt+P\`.\r
2. Type part of the name in **Find project**.\r
3. Click the project, or choose it with the arrow keys and press Enter.\r
\r
**All projects** opens the **Projects** page. There you see each project with **Your roles** and **Your open tasks**; click **Open** to go to a project.\r
\r
## See your tasks\r
\r
What for: find the texts you have to work on.\r
\r
1. Click **My tasks** in the sidebar.\r
2. Choose a tab: **To do**, **Submitted** or **All**. The tab **Paused** appears only while one of your tasks is paused.\r
3. If you work in several projects, choose a project in **Filter my tasks by project**, or **All my tasks**.\r
\r
![My tasks with the status tabs and a table of tasks, each with its Text, Task, Status and an action button](images/getting-started-my-tasks.png)\r
\r
Each row is one task. The **Task** column says what to do, for example **Annotation, from scratch**, **Annotation, from proposals**, **Consolidation** or **Translation review**. The **Status** column shows **Open**, **In progress**, **Submitted** or **Reopened**.\r
\r
- **Reopened**: the lead reopened your submission. Click the badge to read why.\r
- **Paused**: the task waits for a decision on a problem report. **Answer to your report** means the lead has replied.\r
\r
If the project has guidelines, a link such as *Project guidelines v2* appears above the table. Read them before you start: they say what to mark and how.\r
\r
If you see **No texts are assigned to you yet.**, wait until your lead assigns texts to you.\r
\r
## Open a task\r
\r
What for: start or continue your work on a text.\r
\r
1. In **My tasks**, find the row of the task.\r
2. Click the button in the **Action** column:\r
   - **Start** for a new task,\r
   - **Continue** for a task in progress or a reopened one,\r
   - **View** for a submitted task (read-only),\r
   - **View paused task** for a paused task (read-only).\r
3. The task opens. While it loads you see **Opening task…**.\r
\r
To move to your next or previous task without going back, use **Previous text** and **Next text** in the toolbar (\`Alt+←\` and \`Alt+→\`), or pick one in **Select text**.\r
\r
How to work inside the task: [Your first task, start to finish](first-task.md), the [annotator reference](annotator.md) and, for consolidations, the [consolidator chapter](consolidator.md).\r
\r
If you see **Task not found or not yours**, the task was withdrawn or is assigned to someone else. Click **My tasks** to go back.\r
\r
## Read the project guidelines\r
\r
What for: check the annotation rules of the project.\r
\r
1. Open a task.\r
2. Open **More** in the toolbar and choose the guidelines, for example *Guidelines v2*. *(new)* after it means the guidelines changed since you last read them. In a translation review or consolidation, the guidelines are a button in the header instead, with a **New** badge.\r
3. The guidelines open beside the text. Click **All versions** to see older versions, or **Close** to hide them.\r
\r
The first time you open a task in a project with guidelines, a notice asks you to read them. Click the read button in the notice, for example *Read guidelines v2*.\r
\r
The guidelines are your project's rules: what counts as a finding, how much text to mark, how to handle negation or family history. The handbook explains the app, not these rules. If the project has no guidelines or they do not answer your question, ask your lead.\r
\r
## Edit your profile\r
\r
What for: keep your name, languages and qualification up to date.\r
\r
1. Click **Profile** in the sidebar.\r
2. Change **Display name**, **E-mail**, **Languages you can read**, **Qualification** or **ORCID**.\r
3. To be named in exports, tick **Name me (display name and ORCID) as a contributor in exports**.\r
4. Click **Save**. You see **Saved.**\r
\r
Your **Username** and **Pseudonym** cannot be changed. Exports show your pseudonym, not your name, unless you tick the box in step 3.\r
\r
Fill in **Qualification** if you do translation reviews: you cannot submit a translation review without it.\r
\r
## Set your search preferences\r
\r
What for: search ontology terms in your own languages too.\r
\r
1. Click **Profile** in the sidebar.\r
2. Go to **Search preferences**.\r
3. Tick **Search translated names** to search the translated names of terms.\r
4. Choose your **Preferred search languages**.\r
5. Tick **Automatically include the document language** to also search in the language of the text you work on.\r
6. Click **Save search preferences**. You see **Search preferences saved.**\r
\r
## Change your password\r
\r
What for: replace your password with a new one.\r
\r
1. Click **Profile** in the sidebar.\r
2. Go to **Change password**.\r
3. Enter your **Current password**.\r
4. Enter a **New password** with 12 to 256 characters. It must differ from your username.\r
5. Enter it again in **Repeat new password**.\r
6. Click **Change password**. You see **Password changed. Other sessions were logged out.**\r
\r
If you forgot your password, ask an administrator for a reset code and follow [Set your password with a setup or reset code](#set-your-password-with-a-setup-or-reset-code).\r
`,C=`# Lead: texts, work plans and progress\r
\r
This chapter is for project leads. It covers the **Documents** page: uploading texts, the text card, planning and assigning work, and following progress. Back to the [lead overview](lead.md).\r
\r
On **Documents**, each row is one text: one language version of a case. See [case, text and document](README.md#glossary).\r
\r
## Upload texts\r
\r
### Prepare files for upload\r
\r
Ontotator takes two formats:\r
\r
| Format | Use it for | What goes in |\r
| --- | --- | --- |\r
| **Plain text** (.txt, or a .zip of .txt files) | Texts in one language, without tool proposals. | One UTF-8 text file per text. The file name without \`.txt\` becomes the text's ID: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. Each name may occur once. All files of one upload get the same **Upload language**. |\r
| **Ontospan bundle** (.zip or .json) | Texts with translations and tool proposals. | A ZIP with \`manifest.json\` and one JSON file per text under \`documents/\`, or a single exchange file (.json). Each text file holds the text, its language and case ID, whether it is a translation, and the tool proposals for it. |\r
\r
Example of a plain-text ZIP:\r
\r
\`\`\`\r
texts.zip\r
  case-201.txt\r
  case-202.txt\r
\`\`\`\r
\r
Example of an Ontospan bundle:\r
\r
\`\`\`\r
bundle.zip\r
  manifest.json\r
  documents/\r
    case-201-de.json    (source text, with proposals)\r
    case-201-en.json    (translation of case-201)\r
\`\`\`\r
\r
Ontospan bundles are written by the Ontospan tools that produce the translations and proposals. Ask whoever runs those tools for a bundle.\r
\r
### Upload texts\r
\r
What for: bring texts into the project, with or without tool proposals.\r
\r
Before you start: [prepare the files](#prepare-files-for-upload). Check the [languages of the texts](lead-settings.md#set-the-languages-of-the-texts) and the [plan for new imports](lead-settings.md#choose-the-plan-for-new-imports).\r
\r
1. Open **Documents** and click **Upload texts…**.\r
2. Choose the **Format**. For plain text, also choose the **Upload language**.\r
3. Click **Choose files…** and select your files.\r
4. Click **Check**. Nothing is imported yet; the dialog shows *Checking 2 files …*.\r
5. Read the preview: the number of cases, proposals and texts already in the project, and any **Notes**.\r
6. Check the **Work plan**: for each language, whether it gets a **Translation review** and an annotation. Click **Adjust per case…** for exceptions.\r
7. Optional: if translations are not marked as reviewed and you want them annotated without review, tick **These translations were reviewed outside Ontotator — accept them as they are** and enter a **Reason**.\r
8. Click the import button, for example *Import 20 cases*.\r
\r
![The Upload texts dialog after the check, with the summary and the work plan](images/lead-upload-preview.png)\r
\r
What you may see:\r
\r
| Message | Meaning |\r
| --- | --- |\r
| *…: problems found. Nothing can be imported.* | The dialog names the problems per file. Click **Discard**, fix the files and try again. |\r
| **You can close this dialog; the import continues, and the texts appear after the next page load.** | The import runs. Reload **Documents** later. |\r
| *Imported 20 documents and 35 proposals.* | The import is done. |\r
| **This upload failed. Nothing was imported.** | **Discard it and upload the files again.** |\r
\r
If you chose **Plan nothing; I plan texts on Documents**, the new texts appear as *Not decided* until you plan them ([Plan several texts at once](#plan-several-texts-at-once)).\r
\r
## The Documents page\r
\r
The **Documents** page lists every text of the project and what it needs next. Open it with **Documents** in the sidebar. A number next to it counts the texts that need your decision.\r
\r
![The Documents page. The row with a coloured edge needs your decision; its Next step button opens that decision.](images/lead-documents.png)\r
\r
### Columns of the Documents table\r
\r
| Column or mark | Meaning |\r
| --- | --- |\r
| **Text** | The case ID, the language, the text version and a **NEW** badge for texts that are new since your last visit. |\r
| **Translation**, **Annotation**, **Finalization** | The state of each stage, with the names of the people involved. |\r
| Robot icon | The text has tool proposals. |\r
| **Waiting on** | Who the text waits for. **You** in bold means it waits for you. |\r
| **Next step** | A button for the next action on this text, for example **Assign annotation…** or **Accept result…**. Rows that need your decision also have a coloured left edge. |\r
| **Last activity** | When something last happened on the text. |\r
\r
### Use the Documents tabs\r
\r
What for: work through texts by what they need.\r
\r
1. On **Documents**, choose a tab: **Needs your decision**, **To assign**, **In progress**, **Done** or **All**.\r
2. Click **Refresh** to update the counts.\r
\r
A tab keeps your filters and search.\r
\r
### Do a text's next step\r
\r
What for: act on a text directly from its row.\r
\r
1. In the **Next step** column, click the row's button, for example **Assign annotation…**, **Accept result…** or **Decide on report…**.\r
2. The matching dialog, card or page opens. The tasks in this chapter and in [Lead: results, decisions and export](lead-results.md) describe each one.\r
\r
If you have an open task on the text yourself, the row shows **Open my task** instead. It opens your task in the editor or on the consolidation screen.\r
\r
### Search texts\r
\r
What for: find a text by its case ID or by words in the text.\r
\r
1. Type into the search field **Case ID or text…**.\r
2. The list updates after a short pause or when you press Enter.\r
\r
To clear the search, click ✕ in the field.\r
\r
### Filter the list\r
\r
What for: show only texts in a certain state, language or origin.\r
\r
1. Click **Filter**.\r
2. Tick the options you need, for example under **Language**, **Translation review**, **Annotation** or **Final**. Each choice applies at once.\r
3. Under **Order**, choose **Case ID**, **Import order** or **Last activity**.\r
\r
Active filters show as chips above the table. Remove one with its ✕, or click **Clear all**. Options without texts are hidden; click the button below the options, for example *Show 4 empty filters*, to see them.\r
\r
### Sort and page through the table\r
\r
- Click the column header **Text** to sort by case ID, up or down.\r
- Click **Last activity** to sort newest or oldest first.\r
- The other headers sort only the rows on the current page.\r
- Below the table, click **Next** or **Previous** to see more rows.\r
\r
### On a narrow screen\r
\r
Below 700 px width, each case is a card with its texts. Click a stage status to see the latest activity and the actions for that stage. Click **Details** to open the full text card.\r
\r
## The text card\r
\r
The text card shows everything about one text and lets you act on it.\r
\r
### Open the text card\r
\r
1. Double-click a row, or focus the text name and press Enter.\r
2. The card shows the path **Translation**, **Annotation**, **Finalization**. Click a part to see it.\r
\r
![The text card with its three parts. The Annotation part is open and lists the annotators.](images/lead-text-card.png)\r
\r
In the card:\r
\r
- **Open text** opens the [text view](#read-a-text-and-other-peoples-work-in-the-text-view).\r
- **Previous text** and **Next text** walk through the table (keys \`K\` and \`J\`).\r
- **Other languages** switches to another language of the same case.\r
- ✕ or Esc closes the card.\r
\r
### Read the history and details of a text\r
\r
What for: see what happened to a text and its technical IDs.\r
\r
1. In the text card footer, click **History** or **Details**.\r
   - **History** lists all activity, newest first, with reviewers' reasons.\r
   - **Details** shows the **Plan**, the **Problem reports** and the **Technical details**.\r
2. Click **Back** to return to the path.\r
\r
### Read a text and other people's work in the text view\r
\r
What for: read a text with other people's findings or the final result, and compare two of them side by side. Leads and consolidators see other people's work; everyone else sees only their own.\r
\r
1. Open the text view with **Open text** in the text card.\r
2. Choose the language and version in **Language and version**.\r
3. In **Show**, choose **Text only**, a proposal layer, someone's annotations or the result. Its findings are listed under **Findings**.\r
4. Optional: click **Compare** to open a second pane with its own **Language and version** and **Show**. Tick **Couple scrolling** to scroll both together. Click **Close comparison** to close it.\r
5. Optional: click **Submissions** to open the **Submission history**. Choose a row to show it, then click **Close**.\r
\r
**Open my task** goes to your own task on this text.\r
\r
### Review the translation versions of a text\r
\r
What for: see each version of a translation, its reviews and its origin.\r
\r
1. Open the text card and click **Translation**.\r
2. The list shows each version with its origin and status. Older ones are under **Older versions**.\r
3. Click **View text** to read a version, or **Translation reviews** to see every review decision.\r
4. Click **Compare with source** to compare the translation with the source text.\r
\r
### Request a translation correction\r
\r
What for: have a translation corrected by a reviewer.\r
\r
1. Open the text card and click **Translation**.\r
2. At the version, click **Request correction…**.\r
3. Choose the **Translation reviewer** and enter the **Reason for another review**.\r
4. Click **Assign correction review**, then **Close**.\r
\r
The corrected text becomes a new text version.\r
\r
## Work plans and assignments\r
\r
The work plan says, for each text, whether it gets a translation review and whether and how it is annotated. Planned texts show up in the main list; the others are hidden.\r
\r
### Add a text to the plan\r
\r
What for: start work on a text that is not planned yet.\r
\r
1. On **Documents**, tab **All**, tick **Show texts not in plan**. Unplanned texts appear muted.\r
2. In the text's row, click **Add to plan…**.\r
3. Choose **Translation review** **On** or **Off**.\r
4. Choose the annotation: **Off (not annotated)**, **Annotate from proposals** or **Annotate from scratch**.\r
5. Click **Save**. The message has an **Undo** button.\r
\r
### Select texts\r
\r
What for: plan or assign many texts at once.\r
\r
1. Click a row to select it. Shift+click selects a range; Ctrl+click (macOS: Cmd+click) adds single rows.\r
2. To select every filtered text, tick the checkbox in the table header.\r
3. The selection bar at the bottom shows how many texts are selected and their next step.\r
\r
To start over, click **Clear selection**.\r
\r
### Select texts by pasting case IDs\r
\r
What for: select texts from a list you have elsewhere, for example a spreadsheet.\r
\r
1. Click **Select by case IDs…**.\r
2. Paste the IDs into **Paste case IDs**, one per line or separated by commas.\r
3. Check how many were found. Click **Copy unknown IDs** to copy the ones that do not exist.\r
4. Optional: to keep the current selection, tick **Add to the current selection instead**.\r
5. Click the select button, for example *Select 20*.\r
\r
### Plan several texts at once\r
\r
What for: set the work plan for a selection.\r
\r
1. Select the texts, then click **Plan…** in the selection bar.\r
2. Optional: under **Quick choice for the selected translations**, pick **Translation review and annotation** or **Annotation only, no translation review**.\r
3. Or set it per language: **Translation review** and **Annotation**. **Leave as is** keeps the current plan.\r
4. Read what will change.\r
5. Click the save button, for example *Save for 20 cases*.\r
6. If work already exists, the dialog lists what happens to it. Tick **I understand** (or **I understand — withdraw the open tasks**) and save again.\r
\r
![The Work plan dialog with the quick choice and one row per language](images/lead-work-plan.png)\r
\r
**Undo** in the message restores the plan, not withdrawn tasks.\r
\r
### Change the annotation mode of one text\r
\r
What for: switch one text between from proposals, from scratch and not annotated.\r
\r
Before you start: once someone started or submitted work in one mode, the mode is fixed.\r
\r
1. Open the text card and click **Annotation**.\r
2. Under **Annotation**, choose **From proposals**, **From scratch** or **Off**. It saves at once.\r
\r
### Assign work to the selected texts\r
\r
What for: give translation reviews or annotations to people.\r
\r
1. Select the texts, then click the assign button in the selection bar, for example **Assign annotation…**.\r
2. Check the **Task**, for example a translation review in one language.\r
3. In the table of people (**Person**, **Reads**, **Open tasks**), pick the reviewer, or tick everyone who should annotate. Each ticked person gets every selected text.\r
4. Read the summary below the table, for example *Ana Weber gets 3 translation reviews (de).*\r
5. Click the assign button, for example *Assign 20*.\r
\r
![The assign dialog with members, their languages and open tasks](images/lead-assign.png)\r
\r
If someone does not read a language the task needs, the dialog asks again; click **Assign anyway** or **Back**. Ontotator sends no e-mail; the work appears in each person's **My tasks**.\r
\r
### Assign work for one text\r
\r
What for: assign a single review or annotation.\r
\r
1. In the row, click **Assign review…** or **Assign annotation…**. In the text card, use **Assign review…** or **Assign annotators…**.\r
2. Tick the people. To annotate yourself without the Annotator role, click **Add me as annotator**.\r
3. Click the assign button, for example *Assign 2 people*.\r
\r
To change the limit of annotators per text from here, click the info button (i) next to the limit, then **Change for all texts**.\r
\r
### Distribute work evenly\r
\r
What for: spread a batch of texts evenly across people.\r
\r
1. In the assign dialog, click **Distribute evenly…**.\r
2. Set **People per document** and click **Propose**.\r
3. Check the proposal. Change a person in any cell, or click **Propose again**.\r
4. Click **Confirm**, then **Close**.\r
\r
### Remove, reassign or reopen an assignment\r
\r
What for: change who works on a text, or let someone change a submitted annotation.\r
\r
Warning: removing unsubmitted work deletes the draft for good. Submitted work stays in the history.\r
\r
1. Open the text card and click **Annotation** (or **Translation** for reviews).\r
2. In the person's row, click one of these:\r
   - **Reassign…**: choose the **New assignee** and click **Reassign**.\r
   - **Reopen…**: optional **Reason (optional)**, then **Reopen assignment**.\r
   - **Remove…**: confirm with **Remove** or **Confirm removal**.\r
\r
Consolidations cannot be reassigned. Annotators can also continue from their own submission themselves ([Start a new work round](annotator.md#start-a-new-work-round)).\r
\r
## Watch progress\r
\r
What for: see the whole project at a glance.\r
\r
1. In the sidebar, click **Progress**.\r
2. The first line counts cases, reviews and annotations. Click **need your decision** or **to assign** to jump to those texts.\r
3. The cards **Translation review**, **Annotation** and **Final result** count the texts per state. Each count opens **Documents** with the same texts.\r
4. The **People** table shows each person's open and submitted work. Click a name to see their texts.\r
\r
![The Progress page with the stage cards and the People table](images/lead-progress.png)\r
\r
Click **Refresh progress** to update.\r
`,T=`## Accepting results and consolidation\r
\r
Each text version gets one final result: one submission or one consolidation that you accept. Only final results go into the final export.\r
\r
### Accept a result or compare results\r
\r
What for: choose the final result of a text.\r
\r
1. On **Documents**, tab **Needs your decision**, click **Accept result…** or **Compare results…** in the row. The card opens at **Final result**.\r
2. With one submission or a submitted consolidation, check it and click **Accept result**.\r
3. If all annotations agree, the card says so. Click **Accept result**.\r
4. If they differ, the card shows how many findings match. Open a submission with **Open in editor** to read it, then click **Use as final** in its row. This saves at once, without a confirmation. Or start a consolidation (next task).\r
5. After saving, the card moves on to the next text that needs a decision.\r
\r
![The final result block comparing two submissions](images/lead-compare-results.png)\r
\r
If the project rule says the consolidator may not be an annotator, you cannot accept your own result; another lead must do it.\r
\r
### Accept early while other annotations are open\r
\r
What for: accept a result before everyone has submitted.\r
\r
1. Open the text card at **Finalization**. It lists the annotations still open.\r
2. Optional: remove open work with **Remove assignment…**.\r
3. Choose the result as in [Accept a result or compare results](#accept-a-result-or-compare-results).\r
\r
Open work stays assigned unless you remove it.\r
\r
### Start a consolidation\r
\r
What for: let one person resolve the differences between submissions into one result.\r
\r
1. In the text card's final result block click **Consolidate…**.\r
2. Check the submissions under **Submissions to merge**.\r
3. Choose the **Consolidator**. You can choose yourself.\r
4. Optional: enter **Consolidation reason (optional)**.\r
5. Click **Start consolidation**. If you chose yourself, click **Open consolidation** in the message to begin.\r
\r
The consolidator's work is described in [consolidator.md](consolidator.md). While it runs, the card shows the consolidator and how many groups are still open.\r
\r
### Accept a consolidation\r
\r
What for: make a submitted consolidation the final result.\r
\r
1. Click **Accept result…** in the row.\r
2. Optional: click **Open consolidation** to read it. It opens read-only. Click **Back to documents** to return.\r
3. Click **Accept result**.\r
\r
### Review changes to a final result\r
\r
What for: confirm a final result after something changed, for example a newer submission or a corrected text. The row's next step is **Confirm final result**.\r
\r
1. In the row click **Review changes…**. The card lists what changed.\r
2. If the text changed, click **Show changes** to see the changed passages.\r
3. Choose one:\r
   - Keep the final on the old version, for example *Keep final on v1*.\r
   - **Use the newer result**.\r
   - Carry it to the new version, for example *Carry to v2…* (see [Carry submitted work to a new text version](#carry-submitted-work-to-a-new-text-version)).\r
\r
### Change a final result\r
\r
What for: pick another result after you already chose one.\r
\r
1. Open the text card at **Finalization**.\r
2. Click **Change final…**.\r
3. Click **Use as final** in the row of the result you want.\r
\r
## Problem reports\r
\r
Annotators and reviewers can report a problem with a text. This pauses their task until you decide.\r
\r
### Decide on a problem report\r
\r
What for: answer a report and let the work go on.\r
\r
1. On **Documents** click **Decide on report…** in the row. Or click **Open report** in the text card.\r
2. Read the report: who reported it, the reason and the history.\r
3. In the common case, write an optional answer and click the close-and-resume button, for example *Close and resume Task 12*.\r
4. For other cases open **Other decisions**:\r
   - **Close report…** or **Close, keep paused…**: close it with an outcome for the reporter.\r
   - **Release pause…**: let paused tasks continue.\r
   - **Pause other tasks…**: pause other tasks on the same text or project.\r
   - **Agree empty restart…**: restart the task with an empty round, after agreeing with the reporter.\r
   - **Reopen report…**: open a closed report again.\r
5. Confirm in the form that opens.\r
6. Click **Back to Documents**, or go to the next decision.\r
\r
![The decision card of a problem report](images/lead-problem-report.png)\r
\r
A final result is never changed here. If a task is still paused after the report was closed, the row shows **Resume task…**; click it and release the pause.\r
\r
## Export\r
\r
### Export final results\r
\r
What for: download the accepted final results.\r
\r
1. In the sidebar click **Export**. Or click **Export final results…** on **Documents** or **Progress**.\r
2. The card **Final results** checks every text. It lists texts that need your decision and texts left out because they have no final result.\r
3. If you want to export now anyway, tick the box to leave out the other texts.\r
4. Click **Create final export**.\r
5. When it is ready, click **Download (ZIP)**.\r
\r
![The final results check on the Export page](images/lead-export.png)\r
\r
Click **Check again** after you accepted more results. **What is in the file?** explains the contents.\r
\r
### Export research data\r
\r
What for: download raw material for analysis. People appear as pseudonyms.\r
\r
1. On **Export**, go to **Research data**.\r
2. Choose a row: **Annotation results**, **Edit log** or **Translation reviews**.\r
3. Click **Create**, then **Download** when it is ready.\r
\r
How to analyse these files is described in [scientific-workflow.md](../scientific-workflow.md).\r
\r
## Translation and text-change decisions\r
\r
### Resolve a rejected or queried translation\r
\r
What for: decide what happens after a reviewer rejected or queried a translation. The row's next step is **Resolve rejected translation** or **Resolve queried translation**.\r
\r
1. In the row click **Resolve…**. The options open below the row with the reviewer's reason.\r
2. Choose one:\r
   - **Assign a new review…** to have someone review it again.\r
   - **Correct the translation…** to correct it yourself. Then click **Open translation review**. Your corrected text counts as accepted.\r
   - The discard item, for example *Discard the de translation…*, to drop it. Enter a **Reason** and click **Discard**. Nothing is deleted; the versions are marked as discarded.\r
3. Or click **Cancel**.\r
\r
### Accept a translation that was not reviewed\r
\r
What for: annotate a translation that was reviewed outside Ontotator. The row's next step is **Translation not accepted**.\r
\r
1. In the row click **Assign review or accept…**.\r
2. Either click **Turn translation review on**, then assign a review.\r
3. Or tick **This translation was reviewed outside Ontotator — accept it as it is**, enter a **Reason** and click **Accept and annotate**.\r
\r
The acceptance is recorded with your name, the reason and the time.\r
\r
To have an accepted translation reviewed after all, click **Assign a new review…** in the **Translation** part of the text card.\r
\r
### Handle a text change for open annotation work\r
\r
What for: decide what happens when a text gets a new version while someone is still annotating the old one. The row's next step is **Handle text change**.\r
\r
1. In the row click **Handle text change…**.\r
2. Choose one:\r
   - Move to the new version: the annotator continues on the corrected text; their draft findings are carried and marked for checking.\r
   - Let the annotator finish on the old version: the result is carried to the new version for them to check.\r
   - **Withdraw**: the draft stays with them, and the new version needs a new annotation.\r
3. Click **Apply**.\r
\r
If the task is paused by a problem report, decide the report first.\r
\r
### Carry submitted work to a new text version\r
\r
What for: reuse submitted findings after the text was corrected. The row's next step reads, for example, *Carry to v2…*.\r
\r
1. In the row click the carry button, for example *Carry to v2…*.\r
2. Choose who continues: the author, **Someone else…** (then pick the **Annotator**), or annotate the new version from scratch.\r
3. Click **Assign**.\r
\r
The carried findings must be checked by the annotator before submitting.\r
`,A=`# Lead: project settings\r
\r
This chapter is for project leads. It covers every tab under **Settings**: the project name and languages, the ontology, the submission rules, the workflow, the people and the guidelines. Back to the [lead overview](lead.md).\r
\r
General, Annotation, Workflow and Ontology have a **Save changes** button at the bottom. People and Guidelines save each change at once.\r
\r
| Tab | What you set there |\r
| --- | --- |\r
| **General** | [Name and description](#change-the-project-name-and-description), [languages of the texts](#set-the-languages-of-the-texts) |\r
| **Annotation** | [Submission rules](#set-the-submission-rules), [prefilled values](#set-prefilled-values-for-new-findings), [values annotators can choose](#limit-the-values-annotators-can-choose) |\r
| **Workflow** | [Plan for new imports](#choose-the-plan-for-new-imports), [texts with tool proposals](#choose-how-texts-with-tool-proposals-are-annotated), [annotators per text and consolidation rules](#set-annotators-per-text-and-the-consolidation-rules) |\r
| **Guidelines** | [Publish](#publish-the-first-or-a-new-guideline-version), [see who read them](#see-who-has-read-the-guidelines), [republish](#republish-an-earlier-guideline-version), [withdraw](#withdraw-a-guideline-version) |\r
| **People** | [Add](#add-a-member), [change roles](#change-a-members-roles), [remove](#remove-a-member) |\r
| **Ontology** | [Ontology version and annotation scheme](#choose-the-ontology-version-branches-and-annotation-scheme), [task profile](#replace-the-task-profile), [move to a newer release](#move-a-started-project-to-a-newer-release) |\r
\r
## Open project settings\r
\r
What for: reach all settings of the current project.\r
\r
1. In the sidebar, click **Settings**. You can also click **Settings** in the project's row on **Projects**.\r
2. Choose a tab: **General**, **Annotation**, **Workflow**, **Guidelines**, **People** or **Ontology**.\r
3. After a change, click **Save changes**. The page then says, for example, *General saved.*\r
4. To undo your edits before saving, click **Discard changes**.\r
\r
If you leave a tab with unsaved edits, a dialog asks you to **Save changes**, **Discard changes** or **Cancel**.\r
\r
## Change the project name and description\r
\r
What for: give the project a clear name and a short description on **Projects**.\r
\r
1. Open **Settings**, tab **General**.\r
2. In the card **Name and description**, edit **Name** and **Description**.\r
3. Click **Save changes**.\r
\r
## Set the languages of the texts\r
\r
What for: make sure every imported text is in a language you expect. An import refuses texts in other languages. Leave the list empty to allow any language.\r
\r
1. Open **Settings**, tab **General**, card **Languages**.\r
2. Type a language code into **Languages of the texts**, for example \`de\`.\r
3. Press Enter or click **Add language**.\r
4. To remove a language, click ✕ next to its code (its name is *Remove de*, for example).\r
5. Click **Save changes**.\r
\r
A typed code that you did not add blocks saving: **Add this language code before saving.**\r
\r
## Choose the ontology version, branches and annotation scheme\r
\r
What for: decide which ontology release annotators search in.\r
\r
Before you start: you can change this until the first work is submitted. After that, see [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).\r
\r
1. Open **Settings**, tab **Ontology**.\r
2. In **Ontology version**, choose the release for each ontology. Only releases an administrator uploaded on **Ontologies** are offered.\r
3. Optional: open **Advanced**.\r
   - Limit the terms to some branches (parts of the ontology below one term): enter term codes separated by commas, for example \`HP:0000118\`. Empty means every term.\r
   - Choose the annotation scheme: **HPO phenotype (fixed qualifiers, modifiers)** or **Generic (free qualifiers)**. "Qualifiers" are the value fields of a finding.\r
4. Click **Save changes**. If the change would rewrite or flag terms in drafts, a check opens first, as in [Move a started project to a newer release](#move-a-started-project-to-a-newer-release).\r
\r
## Replace the task profile\r
\r
What for: change the layers, finding types and value fields annotators work with. The task profile is the JSON file that defines them.\r
\r
Before you start: this is only possible before work starts.\r
\r
1. Open **Settings**, tab **Ontology**, and open **Advanced: task profile**.\r
2. Check **Current profile layers**.\r
3. Choose a JSON file in **Profile file (JSON)**. The new layers appear under **Profile layers**.\r
4. Click **Save changes**. The page says *Task profile saved.*\r
\r
## Move a started project to a newer release\r
\r
What for: move to a newer ontology release after work was submitted. Drafts are updated; submitted work stays as it was submitted.\r
\r
Before you start: an administrator must have uploaded the new release ([Upload ontology releases](admin.md#upload-ontology-releases-and-translation-files)).\r
\r
1. Open **Settings**, tab **Ontology**. The card **Ontology** shows the current release.\r
2. Under **Move to another release**, choose the new release.\r
3. Click **Check changes**.\r
4. Read the panel **Check before moving**:\r
   - The first table (**Becomes**, **Why**) lists draft terms that will be replaced by their successor.\r
   - The second table (**Status**, **Suggestions**) lists draft terms that are obsolete or missing in the new release. Their annotators must change them before submitting.\r
5. Click **Move to this release**, or **Cancel**. The page says **Ontology release changed.**\r
\r
![The check before moving to another release. The first table shows which draft terms are replaced automatically, the second which ones annotators must change by hand.](images/lead-move-release-check.png)\r
\r
If drafts changed meanwhile, you see **Drafts or pins changed since the check. Check the changes again before moving.** Click **Check changes** again.\r
\r
## Set the submission rules\r
\r
What for: decide what annotators must do before they can submit.\r
\r
1. Open **Settings**, tab **Annotation**, card **When submitting**.\r
2. In **Findings that point to no text passage**, choose **Not allowed**, **Allowed with a reason** or **Allowed, reason optional**.\r
3. Tick **Annotators must confirm every value before submitting** if prefilled values may not be submitted unconfirmed.\r
4. Tick **A finding must be one continuous passage** if a finding may not have several text segments.\r
5. Click **Save changes**. The rules apply to every submission from now on.\r
\r
## Set prefilled values for new findings\r
\r
What for: new findings start with these values. They stay marked as not confirmed until the annotator confirms or changes them.\r
\r
1. Open **Settings**, tab **Annotation**, card **Prefilled values**.\r
2. For each value field, choose a value, or **No prefill**.\r
3. Click **Save changes**.\r
\r
## Limit the values annotators can choose\r
\r
What for: hide values the project does not use from the editor.\r
\r
1. Open **Settings**, tab **Annotation**, and open **Values annotators can choose**.\r
2. Click a value to switch it off (hidden) or on (shown). The prefilled value of a value field cannot be hidden.\r
3. Click **Save changes**.\r
\r
Existing findings keep their values. A finding with a hidden value must be changed before it is saved again.\r
\r
## Choose the plan for new imports\r
\r
What for: decide whether newly imported translations get a translation review and an annotation by default.\r
\r
1. Open **Settings**, tab **Workflow**, card **New imports**.\r
2. Choose **Plan review and annotation for every translation** or **Plan nothing; I plan texts on Documents**.\r
3. Click **Save changes**.\r
\r
With **Plan nothing; I plan texts on Documents**, new texts appear on **Documents** as *Not decided* (filter **Not decided**) until you plan them ([Plan several texts at once](lead-documents.md#plan-several-texts-at-once)).\r
\r
## Choose how texts with tool proposals are annotated\r
\r
What for: set the project default for texts that came with tool proposals.\r
\r
1. Open **Settings**, tab **Workflow**, card **Texts with tool proposals**.\r
2. Choose **Annotators work from the proposals** (they confirm, reject, correct and add) or **Annotators start from scratch** (proposals are hidden).\r
3. Click **Save changes**.\r
\r
A text's own plan can override this until work on it starts.\r
\r
## Set annotators per text and the consolidation rules\r
\r
What for: decide how many people annotate each text and who may consolidate.\r
\r
1. Open **Settings**, tab **Workflow**, card **Annotation and consolidation**.\r
2. Set **Annotators per text** (1 to 5). It is an upper limit; fewer is fine.\r
3. Tick **Annotate only after the translation review is accepted** if translations must be reviewed before annotation.\r
4. Tick **Consolidator must not be one of the text's annotators** if annotators may not consolidate their own texts.\r
5. Click **Save changes**.\r
\r
Lowering the number removes nobody; existing assignments stay.\r
\r
## Add a member\r
\r
What for: let a person work in this project.\r
\r
Before you start: the person needs an account ([Create a user account](admin.md#create-a-user-account)).\r
\r
1. Open **Settings**, tab **People**.\r
2. Click **Add member…**.\r
3. In **Username**, type at least three letters of the name, or the exact username or e-mail. Pick the person from the suggestions.\r
4. Tick one or more roles: **Lead**, **Annotator**, **Consolidator**.\r
5. Click **Add member**. The page confirms the new role.\r
\r
Annotators also do translation reviews. Only people with the **Consolidator** role can be chosen as consolidator of a text. Ontotator sends no e-mail; tell the person that they were added.\r
\r
## Change a member's roles\r
\r
What for: give or take away a role.\r
\r
1. Open **Settings**, tab **People**. The table **Project members** shows one row per person.\r
2. Tick a role checkbox to give the role. It saves at once.\r
3. Untick a role checkbox to take it away, then confirm with **Remove role**. This logs the person out on all devices; they can log in again right away.\r
\r
A project needs at least one lead: **Add another project lead before removing the last lead.**\r
\r
## Remove a member\r
\r
What for: take someone off the project.\r
\r
Warning: if the person still has open work, removing them revokes their open assignments. Submitted work stays in the history.\r
\r
1. Open **Settings**, tab **People**.\r
2. In the person's row, click **Remove…**.\r
3. Confirm with **Remove from project**.\r
4. If the person still has open work, the dialog **Revoke affected assignments?** lists it. Click **Remove and revoke their open assignments**.\r
\r
## Publish the first or a new guideline version\r
\r
What for: give annotators and reviewers the rules they work by. They find the guidelines in every task.\r
\r
Before you start: published versions cannot be edited, only withdrawn. Check the file before you publish.\r
\r
1. Open **Settings**, tab **Guidelines**.\r
2. Without guidelines, the form is already open (**No guidelines yet**). Otherwise, click **Publish a new version**.\r
3. Choose a \`.md\` or \`.txt\` file (UTF-8, up to 256 KB) in **Guideline file (.md or .txt, up to 256 KB)**.\r
4. Check the preview.\r
5. Optional: describe the change in **What changed? (optional)**.\r
6. Click the publish button, for example *Publish as v2*. Or click **Discard**.\r
\r
Everyone sees a notice in their next task.\r
\r
## See who has read the guidelines\r
\r
What for: check which version is in force and who has not opened it yet.\r
\r
1. Open **Settings**, tab **Guidelines**. The top card shows the version **In force**.\r
2. Read **Seen by**. Open **who not yet?** to see the names.\r
3. Click **Read** to read a version. Close it with ✕.\r
\r
Older versions are listed under **All versions**.\r
\r
## Republish an earlier guideline version\r
\r
What for: go back to an earlier text.\r
\r
1. Open **Settings**, tab **Guidelines**.\r
2. In the row of the old version, click **More…**, then the republish item, for example *Republish v1…*.\r
3. The form opens with the old text. Click the publish button, for example *Publish as v3*.\r
\r
## Withdraw a guideline version\r
\r
What for: remove a version that must no longer be read, for example because it contains a mistake.\r
\r
Warning: the text of the withdrawn version is deleted for good. The version number stays, and results made under it show it as withdrawn. No guideline is in force until you publish or republish one.\r
\r
1. Open **Settings**, tab **Guidelines**.\r
2. In the version's row, click **More…**, then the withdraw item, for example *Withdraw v2…*.\r
3. Optional: enter **Reason (optional)**. Do not repeat confidential content.\r
4. Confirm, for example with *Withdraw v2*.\r
`,S=`# Lead overview

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
`,O="/assets/admin-new-project-Cir0O66s.png",j="/assets/admin-setup-code-C_NzEJeU.png",I="/assets/annotator-carried-finding-C5o7dlSY.png",R="/assets/annotator-new-finding-CucS7efi.png",W="/assets/annotator-proposal-review-CcVenSZz.png",_="/assets/annotator-submit-dialog-noNDDy6D.png",D="/assets/consolidator-group-table-D0nIZRze.png",P="/assets/consolidator-submit-dialog-sBiumxVr.png",E="/assets/getting-started-my-tasks-ezmcCup8.png",M="/assets/getting-started-set-password-CC57Fe71.png",N="/assets/lead-assign-9KxFl6dY.png",U="/assets/lead-compare-results-Da2L22C9.png",L="/assets/lead-documents-CJv5hir2.png",Y="/assets/lead-export-fnh-l0xn.png",F="/assets/lead-move-release-check-BHRNaFox.png",B="/assets/lead-problem-report-C6J_XPtm.png",G="/assets/lead-progress-DIfdbLwW.png",H="/assets/lead-text-card-DRw6CK7x.png",q="/assets/lead-upload-preview-64cXvoTU.png",z="/assets/lead-work-plan-Dau0Rzps.png",K="https://github.com/halbritter-lab/ontotator/blob/main",h="https://handbook.invalid/docs/handbook/",V=Object.assign({"../../../docs/handbook/README.md":f,"../../../docs/handbook/admin.md":w,"../../../docs/handbook/annotator.md":k,"../../../docs/handbook/consolidator.md":y,"../../../docs/handbook/faq.md":b,"../../../docs/handbook/first-task.md":v,"../../../docs/handbook/getting-started.md":x,"../../../docs/handbook/lead-documents.md":C,"../../../docs/handbook/lead-results.md":T,"../../../docs/handbook/lead-settings.md":A,"../../../docs/handbook/lead.md":S}),$=Object.assign({"../../../docs/handbook/images/admin-new-project.png":O,"../../../docs/handbook/images/admin-setup-code.png":j,"../../../docs/handbook/images/annotator-carried-finding.png":I,"../../../docs/handbook/images/annotator-new-finding.png":R,"../../../docs/handbook/images/annotator-proposal-review.png":W,"../../../docs/handbook/images/annotator-submit-dialog.png":_,"../../../docs/handbook/images/consolidator-group-table.png":D,"../../../docs/handbook/images/consolidator-submit-dialog.png":P,"../../../docs/handbook/images/getting-started-my-tasks.png":E,"../../../docs/handbook/images/getting-started-set-password.png":M,"../../../docs/handbook/images/lead-assign.png":N,"../../../docs/handbook/images/lead-compare-results.png":U,"../../../docs/handbook/images/lead-documents.png":L,"../../../docs/handbook/images/lead-export.png":Y,"../../../docs/handbook/images/lead-move-release-check.png":F,"../../../docs/handbook/images/lead-problem-report.png":B,"../../../docs/handbook/images/lead-progress.png":G,"../../../docs/handbook/images/lead-text-card.png":H,"../../../docs/handbook/images/lead-upload-preview.png":q,"../../../docs/handbook/images/lead-work-plan.png":z}),l=e=>e.slice(e.lastIndexOf("/")+1),s=Object.fromEntries(Object.entries(V).map(([e,t])=>[l(e).replace(/\.md$/,""),t])),Z=Object.fromEntries(Object.entries($).map(([e,t])=>[`images/${l(e)}`,t]));function J(e){var t;return((t=/^# +(.+)$/m.exec(s[e]??""))==null?void 0:t[1].trim())??e}function Q(){const e=[...(s.README??"").matchAll(/\]\(([A-Za-z0-9_-]+)\.md[)#]/g)].map(t=>t[1]);return[...new Set(["README",...e,...Object.keys(s).sort()])].filter(t=>t in s)}function X(e){return e.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu,"").replace(/ /g,"-")}function ee(){const e=new Map;return t=>{const r=X(t);let n=r;for(;e.has(n);){const a=e.get(r)+1;e.set(r,a),n=`${r}-${a}`}return e.set(n,0),n}}function te(e,t){var d;if(/^[a-z][a-z0-9+.-]*:/i.test(e))return{kind:"external",href:e};const r=new URL(e,`${h}${t}.md`),n=decodeURIComponent(r.hash.slice(1)),a=(d=/^\/docs\/handbook\/([A-Za-z0-9_-]+)\.md$/.exec(r.pathname))==null?void 0:d[1];return a&&a in s?a===t&&n?{kind:"anchor",id:n}:{kind:"chapter",href:i({name:"help",chapter:a,...n?{section:n}:{}})}:{kind:"external",href:`${K}${r.pathname}${r.hash}`}}function ne(e,t){if(/^[a-z][a-z0-9+.-]*:/i.test(e))return null;const r=new URL(e,`${h}${t}.md`).pathname.replace(/^\/docs\/handbook\//,"");return Z[r]??null}const c=e=>e.type==="text"?e.value:"children"in e?e.children.map(c).join(""):"";function re(){return e=>{const t=ee(),r=n=>n.children.forEach(a=>{a.type==="element"&&(/^h[1-6]$/.test(a.tagName)?a.properties.id=t(c(a)):r(a))});r(e)}}function u(e){var t;(t=document.getElementById(e))==null||t.scrollIntoView()}const oe=e=>e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey;function ae(e){return{a:({href:t,children:r})=>{if(!t)return o.jsx(o.Fragment,{children:r});const n=te(t,e);return n.kind==="external"?o.jsx("a",{href:n.href,target:"_blank",rel:"noopener noreferrer",children:r}):n.kind==="chapter"?o.jsx("a",{href:n.href,children:r}):o.jsx("a",{href:i({name:"help",chapter:e,section:n.id}),onClick:a=>{oe(a)&&(a.preventDefault(),u(n.id))},children:r})},img:({src:t,alt:r})=>{const n=t?ne(t,e):null;return n?o.jsx("img",{className:"help-image",src:n,alt:r??"",loading:"lazy"}):o.jsx("span",{className:"guideline-image-text",children:r?`Image: ${r}`:"Image"})},table:({children:t})=>o.jsx("div",{className:"guideline-table-scroll",tabIndex:0,role:"region","aria-label":"Table",children:o.jsx("table",{children:t})})}}function de({chapter:e="README",section:t}){const r=s[e];return p.useEffect(()=>{var n,a;t?u(t):(a=(n=document.getElementById("main"))==null?void 0:n.scrollTo)==null||a.call(n,0,0)},[e,t]),o.jsxs("div",{className:"help-page",children:[o.jsx("nav",{className:"help-chapters","aria-label":"Handbook chapters",children:o.jsx("ul",{children:Q().map(n=>o.jsx("li",{children:o.jsx("a",{href:i({name:"help",chapter:n}),"aria-current":n===e?"page":void 0,children:J(n)})},n))})}),o.jsx("article",{className:"guideline-document help-document",children:r===void 0?o.jsxs(o.Fragment,{children:[o.jsx("h1",{children:"Chapter not found"}),o.jsxs("p",{children:["This handbook has no chapter “",e,"”. Pick one from the list."]})]}):o.jsx("div",{className:"guideline-markdown",children:o.jsx(m,{remarkPlugins:[g],rehypePlugins:[re],skipHtml:!0,components:ae(e),children:r})})})]})}export{de as default};
