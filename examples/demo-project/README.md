# Demo project: invented neurology letters

A complete, fully synthetic demo for a real Ontotator instance: eleven invented clinical letters (English, three of them German with English machine translations), tool proposals with deliberate mistakes, project guidelines and five suggested users. An administrator and a lead set it up through the browser in about 30 minutes; the annotators' part then takes as long as you like.

Every name, age and finding is invented. No text describes a real patient. Do not load this demo into a server that holds real project data unless a separate project is fine for you.

Labels in **bold** are the app's labels; each step links to the handbook section that explains it in full.

## What is in this folder

| File | Upload where | What it is |
| --- | --- | --- |
| `texts/NEURO-2026-001.txt` … `NEURO-2026-004.txt` | **Upload texts…**, format *Plain text*, language `en` | Four English letters without proposals. Annotated from scratch. |
| `demo-bundle.zip` | **Upload texts…**, format *Ontospan bundle* | Seven cases: four English letters with tool proposals (NEURO-2026-005 to 008) and three German letters with English machine translations and proposals (NEURO-2026-009 to 011). |
| `guidelines.md` | **Settings** › **Guidelines** | Short project guidelines (assertion, experiencer, temporality, spans, tool proposals, translations). |
| `bundle-source.json` | nothing | The source of `demo-bundle.zip`, including what a careful annotator should do with each proposal (`demo` fields). |

You also need the official HPO release **2026-09-01**: [`hp.json`](https://github.com/obophenotype/human-phenotype-ontology/releases/download/v2026-09-01/hp.json), SHA-256 `a7b3a012e7b4007a35a7cf8da35f2373b54cc16907f80d13d62470d31f833501` (about 22 MB). The bundle is made for exactly this release: a project pinned to another release refuses it (see [Rebuild the bundle](#rebuild-the-bundle)).

## People

Create these accounts (or use your own names; only the roles and languages matter).

| Username | Display name | Project role | Languages | Does in the demo |
| --- | --- | --- | --- | --- |
| `ana.weber` | Ana Weber | Lead | en, de | Sets up the project, uploads, assigns, accepts, exports |
| `mia.kuehn` | Mia Kühn | Annotator | de, en | Reviews the three translations, then annotates |
| `luc.martin` | Luc Martin | Annotator | en, fr | Annotates |
| `sam.okafor` | Sam Okafor | Annotator | en | Annotates |
| `noor.haddad` | Noor Haddad | Consolidator | en | Merges differing submissions |

Mia Kühn also needs a **Qualification**, for example *Neurologist, native German speaker, fluent in English*: without it she cannot submit a translation review.

## Part 1: administrator (about 10 minutes)

Log in as a system administrator. Background: [Set up a new project for a lead](../../docs/handbook/admin.md#set-up-a-new-project-for-a-lead).

1. **Load the HPO release.** **Administration** › **Ontologies**, choose `hp.json` in **Ontology files**, click **Upload files**. **Upload results** reads **Added**, and **Uploaded files** lists release `2026-09-01` with checksum `a7b3a012e7b4`. See [Upload ontology releases and translation files](../../docs/handbook/admin.md#upload-ontology-releases-and-translation-files).
2. **Create the project.** **Administration** › **New project**:
   - **Project key** `neuro-demo`, **Name** *Neurology phenotype demo*, **Description** *Synthetic demo project: invented neurology letters, HPO phenotypes.*
   - **Languages of the texts**: type `en`, click **Add language**; type `de`, click **Add language**.
   - **Built-in template**: *HPO phenotype*. The ontology file (*hp 2026-09-01*), **Allowed roots for HP** (`HP:0000118`) and **Annotation scheme for HP** (*HPO phenotype (fixed qualifiers, modifiers)*) are filled in; keep them, the bundle expects exactly these.
   - Click **Create project**. The settings open on **People**. See [Create a project](../../docs/handbook/admin.md#create-a-project).
3. **Create the five users.** **Administration** › **Users** › **New user…**, once per row of the [people table](#people): fill **Username**, **Display name**, add each code of **Languages** with **Add language**, and under **Add to projects (optional)** tick the role in *Neurology phenotype demo*. Click **Create user**. See [Create a user account](../../docs/handbook/admin.md#create-a-user-account).
4. **Hand over each setup code.** In the setup-code dialog click **Copy hand-over text**, give it to the person, tick **I have handed over or stored the code** and click **Close**. For a demo run on your own, keep the codes and redeem them yourself in step 6. See [Hand over a setup or reset code](../../docs/handbook/admin.md#hand-over-a-setup-or-reset-code).
5. **Give the reviewer a qualification.** On **Users**, click **Edit** in the row of `mia.kuehn`, fill **Qualification** and click **Save changes**. See [Edit a user's profile and administrator role](../../docs/handbook/admin.md#edit-a-users-profile-and-administrator-role).
6. **Each person sets a password.** On the login page: **I have a setup or reset code**, then **Username**, **Setup or reset code**, **New password**, **Repeat the new password**, **Set password and log in**. See [Set your password with a setup or reset code](../../docs/handbook/getting-started.md#set-your-password-with-a-setup-or-reset-code).

The administrator who created the project is a member with all three roles. In the assign dialogs below, just leave the administrator unticked.

## Part 2: lead (about 15 minutes)

Log in as `ana.weber`. Background: [Lead overview](../../docs/handbook/lead.md#typical-project-start-to-finish).

1. **Check the settings.** **Settings** › **General** lists the languages `en` and `de`; **Ontology** shows release 2026-09-01. See [Lead: project settings](../../docs/handbook/lead-settings.md).
2. **Two annotators per text.** **Settings** › **Workflow**: set **Annotators per text** to `2`. Keep **Plan review and annotation for every translation**, **Annotators work from the proposals** and **Annotate only after the translation review is accepted**. Click **Save changes** (*Workflow saved.*). See [Set annotators per text and the consolidation rules](../../docs/handbook/lead-settings.md#set-annotators-per-text-and-the-consolidation-rules).
3. **Check the people.** **Settings** › **People** lists the five users with their roles. Nothing to change; see [Add a member](../../docs/handbook/lead-settings.md#add-a-member) if one is missing.
4. **Publish the guidelines.** **Settings** › **Guidelines**: choose `guidelines.md` in **Guideline file (.md or .txt, up to 256 KB)**, check the preview, optionally write *First version for the demo project.* in **What changed? (optional)**, click *Publish as v1*. See [Publish the first or a new guideline version](../../docs/handbook/lead-settings.md#publish-the-first-or-a-new-guideline-version).
5. **Upload the plain texts.** **Documents** › **Upload texts…**: **Format** *Plain text: .txt or .zip*, **Upload language** `en`, **Choose files…** and select the four files in `texts/`. Click **Check**: *Checked 4 files: ready to import.*, **Texts** 4 (en 4). Keep the **Work plan** (**Annotate**) and click *Import 4 texts*. See [Upload texts](../../docs/handbook/lead-documents.md#upload-texts).
6. **Upload the bundle.** **Upload texts…** again: **Format** *Ontospan bundle: .zip or .json*, choose `demo-bundle.zip`, click **Check**. The preview shows **Cases** 7, **Texts per language** de 3, en 7, **Proposals** 31, and under **Notes** *1 translation failed an automatic check.* (on purpose, see below). The **Work plan** annotates the sources that have no translation and gives the three English machine translations (*en MT (3)*) a **Translation review** and an annotation. The German sources are not annotated. Click *Import 7 cases*.
7. **Assign the translation reviews.** On **Documents**, tab **To assign**, tick NEURO-2026-009 en, 010 en and 011 en. In the selection bar click **Assign review…**, choose Mia Kühn and click *Assign 3*. See [Assign work to the selected texts](../../docs/handbook/lead-documents.md#assign-work-to-the-selected-texts).
8. **Distribute the annotations.** The table keeps showing the assigned rows until you reopen the tab: click **In progress**, then **To assign** again, which now lists the eight remaining texts. Tick **Select all 8 filtered texts**, click **Assign annotation…** and then **Distribute evenly…**. Set **People per document** to `2`, click **Propose**, check the table (each text gets two of Luc Martin, Sam Okafor and Mia Kühn), click **Confirm**, then **Close**. See [Distribute work evenly](../../docs/handbook/lead-documents.md#distribute-work-evenly).
9. **After the translation reviews** (Part 3), open **Documents** › **To assign** again: the three translations appear there with *✓ accepted*; two of them as *v2 corrected*. Tick **Select all 3 filtered texts**, click **Assign annotation…**, tick Luc Martin and Sam Okafor, and click the assign button.

Ontotator sends no e-mail; tell the people that work waits in their **My tasks**.

## Part 3: translation reviewer

Log in as `mia.kuehn`; open **My tasks** and **Start** each *Translation review (de to en)*. See [Review a translation](../../docs/handbook/annotator.md#review-a-translation).

| Case | What is wrong | What to do |
| --- | --- | --- |
| NEURO-2026-009 | Nothing. | **Accepted unchanged**, **Submit review…**, **Submit review**. |
| NEURO-2026-010 | The source says *keine Ptosis*; the translation says *Examination showed ptosis.* The automatic check passed anyway. | Correct the sentence to *Examination showed no ptosis.* in the translation column (the decision becomes **Accepted with corrections**), tick **Clinically relevant change** and **Negation or certainty**, write a **Rationale**, submit. |
| NEURO-2026-011 | The band reads *1 automatic check failed*; **Details** names **Numbers changed in translation**: the source says *14-jähriger*, the translation *4-year-old*. | Correct it to *14-year-old*, tick **Clinically relevant change** and **Number or unit**, write a **Rationale**, submit. (Or try **Query** to see the lead's side: [Resolve a rejected or queried translation](../../docs/handbook/lead-results.md#resolve-a-rejected-or-queried-translation).) |

The tool proposals move to the corrected version. On NEURO-2026-010 the *Ptosis* proposal still says **Present**: the annotator has to fix that.

## Part 4: annotators

Log in as `luc.martin`, `sam.okafor` or `mia.kuehn`; **My tasks** › **Start**. Read the guidelines from the notice (*Read guidelines v1*). See [Your first task, start to finish](../../docs/handbook/first-task.md) and [Review tool proposals](../../docs/handbook/annotator.md#review-tool-proposals).

Texts from scratch (*Annotation, from scratch*) test the rules on their own:

| Case | Exercises |
| --- | --- |
| NEURO-2026-001 | Historical febrile seizures, current focal seizures, absent developmental regression and ataxia, the mother's febrile seizures |
| NEURO-2026-002 | Gait ataxia mentioned twice (two mentions of one finding), dysarthria, nystagmus, normal hearing (absent), historical double vision, the father's walking problems |
| NEURO-2026-003 | Hypotonia, global developmental delay, *possible* microcephaly (uncertain), feeding difficulties, no seizures |
| NEURO-2026-004 | Distal weakness, pes cavus, absent ankle reflexes, reduced vibration sense, the brother's high-arched feet, no tremor |

Texts from proposals (*Annotation, from proposals*): the list **Review Proposals** shows the tool's findings. Some are right, some are wrong on purpose:

| Case | Proposal | Right decision |
| --- | --- | --- |
| NEURO-2026-005 | *Proximal muscle weakness*, *Elevated circulating creatine kinase activity* | **Confirm**; add *The weakness* as a second mention |
| | *Cardiomyopathy*, **Present** | **Edit & Replace**: **Absent** (*no cardiomyopathy*) |
| | *Muscle weakness* on the uncle, **Patient** | **Edit & Replace**: **Family member** |
| NEURO-2026-006 | *Migraine*, *Headache*, the mother's *Migraine* | **Confirm** |
| | *Hearing impairment* on *ringing in both ears* | **Edit & Replace** with *Tinnitus* |
| | *Ptosis*, **Present** | **Edit & Replace**: **Absent** |
| NEURO-2026-007 | *Delayed speech and language development*, *Autism*, *Ataxia* **Absent** | **Confirm** |
| | *Seizure* on the sister, **Patient** | **Edit & Replace**: **Family member** |
| NEURO-2026-008 | *Tremor* | **Edit & Replace** with *Resting tremor* |
| | *Bradykinesia*, *Hyposmia*, *REM sleep behavior disorder* **Uncertain**, *Depression* **Historical** | **Confirm** |
| NEURO-2026-009 | five proposals, among them *Microcephaly* **Absent** and the father's *Febrile seizure* | **Confirm** |
| NEURO-2026-010 | *Ptosis*, **Present** (from the wrong translation) | **Edit & Replace**: **Absent** |
| NEURO-2026-011 | four proposals | **Confirm** |

Then submit each text: [Submit the text](../../docs/handbook/annotator.md#submit-the-text). Because two people annotate every text and they will rarely agree completely, most texts end up needing a consolidation, which is what the next part is for.

## Part 5: lead and consolidator

1. As `ana.weber`, open **Documents**, tab **Needs your decision**. Where both submissions agree, accept one: [Accept a result or compare results](../../docs/handbook/lead-results.md#accept-a-result-or-compare-results).
2. Where they differ, click **Consolidate…** and choose Noor Haddad: [Start a consolidation](../../docs/handbook/lead-results.md#start-a-consolidation).
3. As `noor.haddad`, open the consolidation from **My tasks**, decide every group and click **Submit consolidation**: [Typical consolidation, start to finish](../../docs/handbook/consolidator.md#typical-consolidation-start-to-finish).
4. As `ana.weber`, accept the consolidation and export: [Accept a consolidation](../../docs/handbook/lead-results.md#accept-a-consolidation), [Export final results](../../docs/handbook/lead-results.md#export-final-results).

## Reset or run it again

Ontotator has no "delete project". To start over:

- **Throwaway instance**: drop its database and data directory (or the Compose volumes of a dedicated demo stack) and begin again with Part 1. See the [server operations guide](../../docs/operations.md).
- **Same instance**: create a second project, for example `neuro-demo-2`, and add the existing users on **Settings** › **People** › **Add member…** instead of creating them. Then follow Part 2. The release stays loaded.

## Rebuild the bundle

`demo-bundle.zip` is generated from `bundle-source.json`:

```bash
uv run python scripts/make_demo_bundle.py --hpo path/to/hp.json
```

`--hpo` checks every proposed term against the release; the bundle pins HPO 2026-09-01 (`HPO_RELEASE` and `HPO_SHA256` in the script). For another release, change both, rebuild, and pin the project to that release. `tests/test_demo_project.py` checks that the committed bundle matches its source and that the bundle and the plain texts pass the real import checks.
