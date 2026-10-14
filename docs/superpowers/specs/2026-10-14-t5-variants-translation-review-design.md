# T5: Document Variants and Translation Review

Date: 2026-10-14 · Status: **design agreed** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E8, E10) · Builds on T2, T3

T5 lets one case exist in several languages and text versions, adds a task for reviewing translations, and lets users switch between languages, text versions and annotation versions.

## Starting point

- **Ontocurator** stores one immutable text per `document_id` and has no notion of a translation or a corrected text.
- **The benchmark** (`phentrieve-benchmark`):
  - The E3C EN/FR/ES → DE corpus has 246 machine translations (Google Translation LLM, `translation_id e3c-de-full-246-google-tllm-v1`). 185 are `ready_for_review`, 61 are `automatic_check_failed`, and none have been reviewed.
  - **`TranslationRecord`** (`models/translation.py`) holds:
    - source and target language and text hashes;
    - provider and model;
    - `previous_translation_id`;
    - status `translated | automatic_check_failed | ready_for_review | reviewed | accepted`;
    - automatic `checks[{code, passed, detail}]`, e.g. `units_added`.
  - **`TranslationReviewRecord`** (`models/translation_review.py`) holds reviewer ID, qualification, the languages the reviewer reads, the date, the review policy and `proposed_text_sha256`. Its decision table:

    | Decision | Requirement |
    |---|---|
    | `unverändert akzeptiert` | text equal to the machine translation, no clinical change |
    | `korrigiert akzeptiert` | text differs; a clinical change needs a category and a rationale |
    | `Rückfrage` | clinical change present, with category and rationale |
    | `abgelehnt` | clinical change present, with category and rationale |

    Clinical change categories: `Auslassung`, `Hinzufügung`, `Negation oder Aussagesicherheit`, `Zahl oder Einheit`, `Anatomie oder Lateralität`, `Terminologie`, `Quellproblem`.
  - The review export can carry an optional second translation (NMT) for comparison.
  - Today the review runs as an Excel round trip (`review-workbook export-e3c / import-e3c`).
  - Only accepted reviews admit German texts to the annotation corpus (`models/annotation_corpus.py`).
  - Guideline R7: a text correction creates a new document version, and spans are re-anchored to it. Automatic cross-language span projection is not planned.
- **T1** deferred variant references (`variant_of`, `previous_text_sha256`) to T5.

## Decisions

- **V1, review scheme = the benchmark scheme, built in.**
  - It has four decisions, the clinical-change flag, seven categories plus a rationale, and the decision table enforced on the server.
  - Internal codes are English:

    | Internal code | Benchmark value |
    |---|---|
    | `accepted_unchanged` | `unverändert akzeptiert` |
    | `accepted_corrected` | `korrigiert akzeptiert` |
    | `query` | `Rückfrage` |
    | `rejected` | `abgelehnt` |

    The clinical-change categories use English codes too: `omission`, `addition`, `assertion`, `value`, `anatomy`, `terminology`, `source`.
  - UI labels are translatable.
  - The export produces records that the benchmark validates as `translation-review-record/v1`, with the German values mapped back. This replaces the Excel round trip.
  - Per-project configurable schemes are not planned.
- **V2, re-anchoring annotations on a new text version (same language).**
  - A codepoint-level diff between the old and the new text version maps segments in unchanged regions automatically: offsets are shifted and the segment text is re-checked (T1 F2).
  - The result is a proposal set on the new version with `method: tool` and the tool name `ontocurator-reanchor`. `source_refs` point to the original annotations.
  - The annotations do not count as done until a person confirms them in a review task.
  - A segment that touches a changed region is not transferred. Its annotation is listed as **needs review**, together with the old text, the new text and the diff.
  - The old version and its annotations, submissions and releases stay unchanged and valid for that version.
  - Cross-language projection (source → translation) is not done, per guideline R7 and the benchmark spec §8.4.
- **V3, viewing: switcher plus optional second pane.**
  - The document view has three selectors: language, text version and annotation version.
  - The annotation versions offered follow E8: the user's own versions, releases, and, inside a workflow task, the stage results that the task may see.
  - A button opens a second pane with its own selectors, e.g. original | translation or annotation set A | release. Scrolling is coupled by paragraph.
  - The translation review task always opens with source | translation side by side.
  - Blind rules (T4) also apply to the second pane. Annotations the user may not see are not offered.
- **V4, data model.**
  - A **case** (`case_id`, e.g. `EN100017`) groups its **variants**. A variant is one text in one language at one version:
    - `variant_id`, `case_id`, `language`, `version` (1, 2, …);
    - canonical text, `text_sha256` and `source_text_sha256`;
    - `origin`: `native`, `machine_translation`, `human_translation` or `correction`;
    - `derived_from`: the source variant for a translation, or the previous version for a correction;
    - for machine translations: provider, model, recipe/run ID and the automatic `checks[]`.
  - **Translation status** per variant mirrors the benchmark: `translated`, `automatic_check_failed`, `ready_for_review`, `reviewed`, `accepted`.
  - An `accepted_corrected` review creates a new variant version (`origin: correction`) from the reviewed text. The machine translation stays as it was.
  - Existing T2/T3 documents become cases with a single native variant.
  - **T1 format 1.1** (minor version, F3) adds optional `case_id`, `variant` (`version`, `origin`, `derived_from` as text hash) and `translation` (provider, model, checks) to the document part.
- **V5, translation review task.**
  - The task is `translation_review`. An assignment (T3 A4) targets one translation variant.
  - **Layout:**
    - left: source, read-only;
    - right: an editable translation with a live diff against the machine translation;
    - optional third column: a comparison translation (e.g. NMT), read-only.
  - Failed automatic checks are shown above the text.
  - The decision form enforces the decision table. Submitting writes an immutable review record (D6 provenance) and moves the variant status.
  - The automatic distribution proposal (T3 A2) only proposes reviewers who read **both** the source and the target language.
  - User profiles gain a `qualification` field (free text, e.g. "physician, German native"), required by the benchmark record.
- **V6, gate for annotation.** Project option `annotate_accepted_translations_only`, default **on**. A translation variant can only be assigned for annotation after its review is `accepted`. This matches the benchmark rule in `models/annotation_corpus.py`.

## Not in T5

- Cross-language span projection (V2).
- Producing translations inside Ontocurator. Translations are imported. Calling a translation provider stays in the benchmark.
- Sentence-level alignment. The second pane couples scrolling by paragraph only.
