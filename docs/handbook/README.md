# Ontotator user handbook

This handbook explains how to work with Ontotator in the browser. It is for everyone who uses the app: annotators, consolidators, leads and system administrators. If you run the server, read [operations.md](../operations.md) instead.

## What Ontotator is

Ontotator is a web app for marking findings in clinical texts and linking each one to a term of an ontology, for example the Human Phenotype Ontology (HPO). Several people work on the same text on their own. A lead then compares their work and chooses one final result per text. The final results are exported for research.

## Roles

You can have more than one role. Roles other than system administrator apply to one project. The header shows your roles under your name.

| Role in the UI | What you do | Chapter |
| --- | --- | --- |
| **Annotator** | Mark findings in the texts assigned to you, check tool proposals, submit your work. | [annotator.md](annotator.md) |
| **Translation reviewer** | An annotator who checks a translated text in a translation review task. | [annotator.md](annotator.md) |
| **Consolidator** | Resolve the differences between several submissions on one text into one result. | [consolidator.md](consolidator.md) |
| **Lead** | Upload texts, plan and assign work, publish guidelines, accept results, export. | [lead.md](lead.md) |
| **System administrator** | Create user accounts, upload ontology releases, create projects. | [admin.md](admin.md) |

## How work flows

annotate → review → consolidate → export

1. Annotate: the lead assigns a text to one or more annotators. Each annotator marks findings, either from scratch or from tool proposals, and submits the text.
2. Review: the lead sees all submissions of a text on the Documents page. When they agree, the lead accepts one as the final result.
3. Consolidate: when submissions differ, the lead starts a consolidation. A consolidator goes through the differences and builds one result.
4. Export: the lead exports the final results of the project.

Some texts are translations. Then a translation review can come before the annotation.

## Glossary

Words you meet in the app, in alphabetical order.

| Word | Meaning |
| --- | --- |
| Axis | A context field of a finding with a fixed list of values, for example Present / Absent / Uncertain, or Patient / Family member. The editor shows the axis name, such as "Assertion". |
| Case ID | The identifier of a case. All language versions of a text share it. |
| Consolidation | A task that merges differing submissions on one text into one result. You can see where each finding came from. |
| Default (prefilled value) | A value a new finding starts with. It counts as not confirmed until you confirm or change it. |
| Final result | The one submission or consolidation per text that the lead accepts. Only final results are exported. |
| Finding | One ontology term marked in a text, with its values and zero or more mentions. |
| Group | In a consolidation: the findings from different submissions that belong together and are decided together. |
| Guidelines | The project's annotation rules. Leads publish numbered versions (v1, v2, …); you read the version in force. |
| Layer | Part of the annotation setup with its own ontology. Each required layer must be checked before you submit. |
| Mention | A marked passage of text that supports a finding. A finding can have several mentions. |
| Modifier | An HPO term such as a severity or an onset, attached to a finding. |
| Ontology release | A loaded version of an ontology, for example one HPO release. Each project uses one release. |
| Problem report | A report that a text has a problem. It pauses your task until the lead decides. |
| Project | A unit of work with its own texts, people, ontology release, guidelines and settings. |
| Pseudonym | Your stable ID, for example `ann-0004`. Exports show it instead of your name. |
| Round | One pass of work on a task. A task can have several rounds, for example after the text changed. |
| Spanless finding | A finding that points to no text passage. The project decides whether this is allowed and whether it needs a reason. |
| Submission | The fixed result of a task. Editing again starts a new round. |
| Task | Your piece of work on one text: Annotation, Translation review or Consolidation. |
| Text version | One revision of a text (v1, v2, …). A correction creates a new version; the old one stays. |
| Tool proposal | A finding suggested by an external tool and uploaded with the text. You confirm, reject or replace it. |
| Translation review | A task in which you check a translated text and accept it, correct it, query it or reject it. |

## Chapters

1. [Getting started](getting-started.md): log in, set your password, find your tasks, edit your profile.
2. [Annotator](annotator.md): annotate a text, work with tool proposals, report a text problem, submit, review a translation.
3. [Consolidator](consolidator.md): work through the groups of a consolidation and finish it.
4. [Lead](lead.md): project settings, guidelines, uploading texts, assigning work, accepting results, export.
5. [System administrator](admin.md): user accounts, ontology releases, projects.
6. [FAQ](faq.md): typical problems and what to do.

Server installation, backups and the command line are in [operations.md](../operations.md).
