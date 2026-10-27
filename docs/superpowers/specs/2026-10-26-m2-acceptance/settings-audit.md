# Project Settings: UX audit

Branch `feat/ux-calm` (7d96d38b). Read-only: code plus the live test server (127.0.0.1:18210, lead account), projects `e3c-proposals` and `t5-acceptance`. Nothing saved or toggled.

Sources: `frontend/src/admin/ProjectSettingsPage.tsx`, `admin/projectFields.tsx`, `admin/GuidelinesSection.tsx`, `admin/MembersSection.tsx`, `admin/HiddenAxisValuesField.tsx`, `admin/LanguagesField.tsx`, `app/router.ts` (`SETTINGS_SECTIONS`); backend `src/ontotator/projects/service.py` (`ProjectSettingsChange`, `update_settings`), `domain/project_rules.py`, `assignments/*`, `exchange/uploads.py`, `exchange/plan.py`, `application/annotation_modes.py`, `application/final_results.py`; DESIGN.md "Settings sections".

Screenshots (1440x900): 01-e3c-general, 02-e3c-guidelines (focus outline around whole section), 03-e3c-rules (focus outline), 04-e3c-rules-hidden-values-open, 05-e3c-workflow, 06-e3c-creation-defaults, 07-e3c-ontology-profile (unlocked), 08-e3c-members, 09-t5-workflow, 10-t5-creation-defaults (with presets), 11-t5-ontology-profile (locked).

## 1. Inventory (page order)

7 tabs, one section per address (`#/projects/{key}/settings/{section}`). Frequency: Once = setup, Rare, Ongoing.

### 1.1 General (Save general)
| Label | What it does | Default | Who/how often | Effect shows |
|---|---|---|---|---|
| Name | Display name | from creation | Lead, Once | Shell, Projects |
| Description | Stored; not displayed anywhere else found | empty | Lead, Once | Practically nowhere |
| Document languages | Import rejects languages not listed (`LANGUAGE_NOT_IN_PROJECT`, uploads.py:240); empty = any | empty | Lead, Once | Documents import (error) |

### 1.2 Guidelines (publish, no Save)
Current version + "Seen by n of m"; Publish a new version; Versions table (Read, Republish, Withdraw…). Content management, not a setting.

### 1.3 Annotation rules (Save rules + Discard)
| Label | What it does | Default | Effect |
|---|---|---|---|
| Findings without a text span | `allow_spanless_findings` + `require_spanless_note`; submit block | required reason | Editor submit |
| Every axis must be chosen before submission | `require_chosen_axes`; off = warning | off | Submit dialog |
| The consolidator of a text may not be one of its annotators | `adjudicator_not_annotator`; blocks assignment, Consolidate launcher, own final. A staffing rule | off | Documents |
| Only contiguous mentions | `contiguous_mentions_only` | off | Editor submit |
| More rule settings: hidden axis values | `hidden_axis_values`; long checkbox list | none | Editor pickers |

### 1.4 Workflow (Save workflow)
| Label | What it does | Default | Effect |
|---|---|---|---|
| Plan for imported texts | `import_plan` initial plan for new imports; overridable in import preview and per text | Review and annotate | Import preview, Documents |
| Texts with tool proposals | `tool_proposal_mode` project default; per-text override; fixed once work exists | from proposals | Text card, Plan dialog, editor |
| Annotate translations only after an accepted review | `annotate_accepted_translations_only`; assign override checkbox | on | Assign dialog, import |
| Annotations per text (1–5) | Max annotators per text; Progress target; lowering shows preview | 1 | Assign dialog, Progress |

### 1.5 Creation defaults (Save + Discard)
Default Assertion / Experiencer / Temporality per layer/type, "No preset". Prefill new findings, unconfirmed until confirmed; interacts with "Every axis must be chosen" and hidden values.

### 1.6 Ontology and profile (Save pins, Save profile; read-only when locked)
Ontology file + SHA hint; Allowed roots (CURIEs); T1 profile (generic / hpo-phenotype: modifier checks); Profile JSON upload. Locked: info + raw pin line with SHA.

### 1.7 Members (each checkbox saves immediately)
Person / Username / Languages / Lead / Annotator / Consolidator; revoke dialog for open assignments; Add member…

## 2. Problems, ranked

- P1 Tabs follow the data model, not the lead's jobs. Ontology (one-time, later locked) mid-row; Members (most used) last; "Annotation rules" vs "Workflow" vs "Creation defaults" requires guessing.
- P2 Settings far from their effect, links one-way: annotations per text found only by hitting the limit (link loses the selection); plan/proposal mode overridden per text without Settings saying so; consolidator rule felt in the Consolidate launcher; languages felt as an import error.
- P3 Wrong grouping: consolidator rule (staffing) among submit rules; Creation defaults a separate tab although it interacts with "every axis chosen" and hidden values on another tab, with two Save buttons.
- P4 Technical wording: text span, contiguous mentions, axis, T1 profile, CURIEs, pins, Profile JSON, SHA; "Rules" vs "Annotation rules"; "Save general"; double-negative axis hint; "Nothing planned"; labels repeating "(Phenotypes / Phenotype)".
- P5 Save models mixed: Save in 5 sections (Discard on 2), Publish, click-to-save on Members without feedback.
- P6 Consequences missing: which work rules affect, per-text overrides, import language rejection, Members saving on click.
- P7 Rarely relevant content at daily level: Description shown nowhere; Ontology tab read-only yet top-level; raw IDs everywhere.
- P8 Duplicated plan controls (project default, import plan, per-text) without explained hierarchy.
- P9 Visual noise: full-width focus ring on Rules/Guidelines after navigation; legends repeat tab names.
- P10 Length: hidden values and creation defaults do not scale to multi-layer profiles.

## 3. Proposed structure

6 tabs by job and frequency: People, Workflow, Annotation, Guidelines, General, Ontology. All frontend-only unless marked.

- 3.1 People first: "Role changes save immediately.", confirmation per change, one line explaining roles.
- 3.2 Workflow in text-life order: New imports ("Plan review and annotation for every translation" / "Do not plan anything (plan texts on Documents)", hint on per-text changes); When a text has tool proposals (+ per-text hint); Wait for an accepted translation review before annotating (+ override hint); Annotators per text (+ "limit when you assign and target on Progress"); consolidator rule moved here. Assign dialog: inline "Change…" for the limit; Documents "follows project setting" links here.
- 3.3 Annotation (merges rules + creation defaults, one Save): When submitting (spanless "Findings that point to no text passage", "Annotators must confirm every value…", "A finding must be one continuous passage", group hint on which work rules apply to); Prefilled values (one layer heading, "No prefill"); Limit the values annotators can choose (collapsed, chips per axis).
- 3.4 Guidelines: no container focus ring; better empty state.
- 3.5 General: "Save"; "Languages of the texts" with import hint; Description shown on Projects or input hidden.
- 3.6 Ontology last: locked = plain summary, technical details collapsed; unlocked = version visible, rest under Advanced with plain labels.
- 3.7 Save model: "Save changes" + "Discard changes" when dirty + status line; Members click-to-save with confirmation.
- 3.8 Backend: nothing required (`ProjectSettingsChange` accepts partial updates). Optional: term-name lookup for roots, description in projects listing.

## 4. Open decisions (recommendation in bold)

- D1 Tab set: A keep 7 and relabel / **B 6 job tabs** / C one long anchored page.
- D2 Default tab: A General / **B People** / C last opened.
- D3 Consolidator rule: **A Workflow** / B People / C stays in rules.
- D4 Description: **A show on Projects page** (B hide input) / C as is.
- D5 Annotators per text from the assign dialog: **A inline "Change…"** / B keep link / C open Settings in new tab.
- D6 Save model: **A explicit Save everywhere, Members instant with confirmation** / B autosave with Undo / C as is.
- D7 Hidden values: A checkboxes / **B shown-value chips, collapsed with count** / C move to Ontology.
- D8 Ontology unlocked: A show everything / **B version visible, rest under Advanced** / C hide from non-admins.
