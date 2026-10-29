# Ontotator user handbook

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
| Pseudonym | Your stable ID, for example `ann-0004`. Exports show it instead of your name. |
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
- Keys are written like `Ctrl+Z` (macOS: `Cmd+Z`). A letter key such as `j` means the plain key; `Shift+K` means with Shift.
