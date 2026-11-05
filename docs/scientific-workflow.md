# A small scientific annotation workflow

Ontotator records annotation and consolidation results. A submitted
consolidation is not automatically an adjudicated gold standard. Consolidation
displays source provenance; annotation from scratch (`independent` mode) shows
neither proposals nor other people's work.

## Before distributing work

Use a versioned task profile and a pinned ontology. State the annotation unit,
allowed types/axes, evidence requirements and inclusion/exclusion rules in a
shared annotation guideline. Record that guideline's version in the study
protocol alongside package/profile identities. Annotation is distributed
in `independent` mode; `review` is the consolidator's mode of a consolidation
round and is never distributed on its own.

A text's annotation mode (from proposals or from scratch) is fixed by its
first annotation work. A lead can still change it: the change names whose
submitted work is discarded, revokes the text's assignments and records who
changed it, when and why. Discarded submissions are kept but no longer count
for progress, consolidation inputs, final results or the annotation export;
"Restore…" makes them count again while no new annotation has started. The
work-package export still carries every submission.

Retain the original work package and the distributed application artifact. For
language comparisons, fix the search resources and language selection for each
condition. English remains available in every condition. Historical packages
without recorded search conditions cannot retroactively establish the software
or translation resources used for old searches.

## Preserve search conditions

A package without captured conditions is fixed at its first package-specific
ontology use. Install the intended translations before opening cases or querying
that package's ontologies. Later global translation uploads are available for new
packages; they do not change the resources of a package already captured.

Exports carry content-addressed translation bytes and optional
`manifest.search_conditions`: ontology digest, translation filenames/digests,
index parameters, application artifact identity and Python/numerical-library
versions. The case editor lists languages from those package resources. English
and the selected translations form the fitted search corpus; disabled languages
do not affect its ranks or scores.

Keep the application artifact and its locked environment as well as the export.
New search events refer to their `search_condition_id` and record actual
`execution` conditions, including the fitting languages. `runtime_drift` marks a
difference from the captured software/index conditions. Imported historical
conditions and events retain their original identity; using the same resource
bytes in a different runtime does not establish exact numerical reproduction.
Legacy events remain without this metadata.

If the task profile declares an external ontology rather than embedding it, a
fresh workspace still needs that exact ontology file. Its declared digest is
checked. Captured translations are included in the export and do not require
the importing machine's global translation files.

## Technical pilot with two annotators

1. Choose a small package containing positive findings, a genuine negative
   case, a case without proposals, and a difficult case likely to produce an
   uncertain review. Include at least one repeated or discontinuous mention.
2. Give two annotators their own user accounts and the same original package,
   ontology, application and guideline. The annotator ID is the logged-in
   user's pseudonym, so each person works under their own ID.
3. Each annotator works independently. Before submission, confirm that the
   whole text and each required layer were checked.
4. Reopen one submitted case, make a correction and submit again. Export the
   whole package for each annotator, retaining both exports unchanged.
5. Import one export into a fresh database. Log in as the same annotator, open
   their work and verify that its annotations and evidence are restored.
   Multiple rounds require explicit round selection.
6. Consolidate the two submissions of each case, accept the consolidations
   and create the final export. Check case coverage in `index.csv`, the
   negative and uncertain cases and the corrected case's quoted evidence in
   `findings.csv`, and the two annotators' agreement in `agreement.csv`.

This is a technical acceptance procedure. A clinician pilot is still needed to
assess whether the guideline and workflow produce useful, consistent annotation.

## Results for analysis

Ontotator has no analysis command. The results come as exports, which a
lead creates on the Export page; the research data exports are also
available as `ontotator admin export`, `export-edit-log` and
`export-translation-reviews`:

- **Final export** (ZIP, format `ontotator-final-export/v2`): the accepted
  final result of each text and the work behind it. Its files are described
  below.
- **Annotation results** (T1 bundle): the latest submission of every person,
  mode and text, final or not, for analyses outside the final results.
- **Edit log** (JSONL): one line per edit event in order, with the time (UTC,
  to the second), the text, the person's pseudonym, the working mode, the
  command and the submission it went into. No user or session ids.
- **Translation reviews**: see the
  [translation review export guide](translation-review-export.md).

People appear as pseudonyms in every export.

### Files of the final export

| File | Content |
|---|---|
| `README.txt` | Plain-language guide to the archive, with the left-out texts and the warnings acknowledged at export. |
| `index.csv` | One row per selected result (`row_type` `selected`), left-out text (`omitted`), earlier submission the results refer to (`provenance`) and other annotation of a text accepted directly (`compared`), naming the bundle file and entry that holds it. |
| `selected.t1.zip` | The final results as a T1 (ontospan) bundle, one unit per result. |
| `provenance.t1.zip` | The submissions the final results were consolidated or carried from. Not final results. |
| `compared.t1.zip` | For a text whose result was accepted directly, without consolidation: the other people's latest annotations of it, so that the agreement covers every text. Not final results. |
| `source-texts.jsonl` | The exact text versions, one per line; `source_text_line` in the tables names the line. |
| `findings.csv` | One row per finding of every submission in the two bundles. |
| `agreement.csv` | The agreement of every two annotators on each text. |
| `agreement-summary.csv` | The agreement over the project. |
| `proposals.csv` | Per tool and annotator what became of the tool's proposals, and per tool its precision and recall. |
| `receipt.json` | Audit receipt: selections, warnings, omissions, review decisions, proposal checks, consolidations and the SHA-256 of every other file. |

The CSV files are UTF-8 with a byte order mark and CRLF line ends. Text
positions are Unicode code points into the canonical text of the line of
`source-texts.jsonl` named in `source_text_line`. The tables are computed
from the two bundles, so each row describes what the bundles hold.

A T1 bundle names, per text, the ontology release recorded with its submission,
which can be older than the project's current release. If its texts were made
under different releases, the newest keeps the layer ID and each older release
gets a layer of its own, `<layer id>@<digest prefix>`, with its release and digest.

### findings.csv

One row per finding (annotation) of each unit of `selected.t1.zip`,
`compared.t1.zip` and `provenance.t1.zip`, in the order of `index.csv`:

- the text: `case_id`, `language`, `document_id`, `text_version`,
  `source_text_line`;
- the submission: `row_type` (`selected`, `compared` or `provenance`), `submission_id`,
  `submission_kind`, `archive_file`, `bundle_entry`, `pseudonym`;
- the finding: `annotation_id`, `layer_id`, `term_id`, `term_label` (the
  term's name in the release the text names), `ontology` and
  `ontology_release`;
- one `value_<axis>` column per value field (for example `value_assertion`),
  and `defaulted_values`, the value fields nobody chose (basis `defaulted`),
  joined by `;`;
- `modifiers`: the modifier term IDs, joined by `;`;
- `origin`: how the finding came about. `scratch` for annotation from
  scratch. In a proposal check `confirmed` (a proposal confirmed as it was),
  `changed` (the person's correction of a proposal), `added` (no proposal)
  or `uncertain` (a proposal left uncertain; kept in the bundle with its
  reviewer flag, but no finding of the person). In a result carried to a new
  text version `carried` or `added`. In a consolidation `matched`, `decided`
  or `added`, as under `consolidations` in `receipt.json`;
- `unresolved`: `yes` when the finding carries a reviewer's uncertain flag;
- `mentions`: each passage as `start-end`; the parts of a passage that is
  interrupted are joined by `+`, passages by `;`, for example
  `12-20+31-37;80-88`. `covered_text` quotes the passages in the same way.
  A finding of the whole text without a passage has both empty. The
  positions are authoritative when a quoted passage itself contains `+` or
  `;`.

An annotation whose assertion is `absent` is a finding; a text with no
finding is a checked negative.

### agreement.csv and agreement-summary.csv

`agreement.csv` compares, on each text version, every two annotation
submissions by different people that the bundles hold (annotation from
scratch and proposal checks; consolidations and carried results are no
annotation of their own). For a consolidated text these are the submissions
the consolidation merged, and only those: work submitted on the text after
the consolidation is not compared. For a text whose result was accepted
directly (the selected result is an annotation from scratch or a proposal
check), the export adds the other people's latest live annotations of it
(`compared.t1.zip`), chosen when the export is prepared as the annotation
results export chooses them, so that texts accepted because everyone agreed
are not left out. A result carried to a new text version gets no compared
annotations; its agreement is that of the earlier work it was carried from.
Proposals a proposal check left uncertain are not counted as findings.

The rows follow the text versions the bundles hold, so a text whose result
was carried or consolidated from work on an earlier version also has rows
for that earlier version (`text_version` and `source_text_line` name it).
They are the agreement behind the text's final result, and for a carried
result the only one; filter on `text_version` to compare one version only.

Each row names the text, both submissions and pseudonyms, and gives the
values of `ontospan.agreement`, the matching Ontotator's consolidation and the
ontospan benchmark share. Findings pair only within a layer, one to one, by
an optimal assignment:

- `annotation_strict_f1`: same term, values and passages;
- `annotation_tolerant_f1`: same term and values, overlapping passages (a
  finding of the whole text and one with a passage also match);
- `mention_strict_f1`, `mention_tolerant_f1`: the same per passage;
- `term_f1`: the sets of terms with their values, regardless of passages;
- `modifier_agreement`: the share of matched findings with the same
  modifiers, empty without matched findings.

The counts behind them follow: `findings_a`, `findings_b`, `equal`,
`compatible`, `axis_conflicts` (same term, other values), `term_conflicts`
(other term on overlapping text), `a_only`, `b_only`, the mention and term
counts, `modifiers_compared` and `modifiers_agreeing`. Two submissions
without findings agree (F1 1).

`agreement-summary.csv` has two rows. `macro_mean` averages each value over
the pairs of a text, then over the texts. `pooled` computes each value from
the counts summed over all pairs (micro average) and lists those sums.
Without any pair (for example when every text had one annotator), both rows
have `pairs` 0 and empty values.

Only F1 values are given. Span annotation has no countable negatives (every
place in a text where nobody marked anything would be one), so chance-corrected
coefficients such as Cohen's kappa are not defined for it. Define in the study
protocol which value is the primary measure; ontology-aware matching (an
ancestor term as a partial match) is not part of these values.

### proposals.csv

Rows of `row_type` `annotator`, one per tool, tool version and person, count
the person's proposal checks in the bundles: `submissions`, `proposals` (the
proposals decided), `confirmed`, `rejected`, `changed` and `uncertain` (the
decision words of Ontotator; `receipt.json` writes `corrected` for
`changed`), and `added`, the findings the person added without a proposal.
`tool` and `tool_version` are the name and version of the proposal's actor
as the imported bundle recorded them (the actor ID when it had no name). A
round on a text without proposals counts its findings under an empty tool.

Rows of `row_type` `source`, one per tool and version, compare the tool's
proposals on each text with that text's selected final result, using the
tolerant matching of `agreement.csv`: `texts` (texts with a selected result
on which the tool had the chance to propose), `proposals`, `final_findings`,
`matched`, `precision` (`matched / proposals`) and `recall`
(`matched / final_findings`), pooled over the texts. The tool had the chance
on a text when an imported proposal set of that text names it as a tool
actor. A text where it proposed nothing in that set still counts: with no
proposals, all its final findings are misses, so recall is not overstated by
leaving out the texts the tool was silent on. Proposals on texts without a
selected result in the export are not compared, nor are texts where the tool
did propose but no proposal check worked on its proposals. The import keeps
no set for a unit without any finding, so a text on which no tool of the
set proposed anything is not counted.

Preserve uncertain targets and ambiguous branches for adjudication. Hashes
establish content identity; the annotator ID is the logged-in user's
pseudonym, so it names the account that did the work.

## Working time

A project records working time only when its lead ticks **Record working time**
(Settings › Workflow, off by default). Annotation and translation review tasks
then count the person's active time; consolidations are not timed. An interval
starts when the task opens, or on the first input after a pause, and ends when
the editor pauses: after 3 minutes without keyboard, pointer, scroll or
selection input (`idle`, the 3 minutes count as reading time), when the tab is
hidden (`hidden`), on **Pause timer** (`manual_pause`) or when the task is left
(`closed`). The server's receipt times are the start and end; the browser's
clock only orders a batch. An interval never ends later than 4 minutes (one
heartbeat gap plus the idle threshold) after its last heartbeat; one whose
heartbeats stopped, for example a closed laptop, ends at its last heartbeat as
`lost`. Time a browser spent offline is therefore not counted.

Export it from **Export** › **Research data** › **Working time**
(`<project>-work-time-<timestamp>.jsonl`). Like the edit log it is pseudonymised: `annotator` is the
person's pseudonym and the file holds no user, session or assignment ids. One
line per closed interval, in the order the server recorded them:

```json
{"record":"interval","interval":12,"annotator":"ann-0003","document_id":"EN100017","task":"annotate","mode":"scratch","started_at":"2026-11-03T09:00:00Z","ended_at":"2026-11-03T09:12:41Z","active_seconds":761,"end_reason":"idle"}
```

followed by one active total per annotator, text, task and mode:

```json
{"record":"task_total","annotator":"ann-0003","document_id":"EN100017","task":"annotate","mode":"scratch","intervals":3,"active_seconds":1405}
```

`mode` is `proposals` or `scratch` for annotation and `translation_review` for a
review. Times are UTC to the second; `active_seconds` is rounded per line, so
the total is computed before rounding. Working time is a measure of effort, not
of quality: compare modes and texts in the study protocol, and keep in mind that
reading without input counts for at most 3 minutes at a time.

## Annotation from proposals in the export

In an "Annotate from proposals" round the person goes through the tool's
proposals one by one, confirms, rejects or corrects each, and adds the findings
the tool missed. In the final export these submissions have
`submission_kind` `proposal_check` in `index.csv`. `receipt.json` holds their
decisions under `proposal_checks`, keyed by submission ID:

- `proposal_set`: the tool proposal set the round worked on (`id` and
  `annotation_set_id`; `null` values for seed proposals without a set).
- `decisions`: one entry per proposal with `proposal_ref` (the proposal's
  URN), `proposal_annotation_id`, `proposal_version`, `decision` (`confirmed`,
  `rejected`, `corrected` or `uncertain`), `corrected_annotation_id` (the
  corrected finding, for `corrected`) and `note`.
- `added_annotation_ids`: findings the person added that are not proposals.
- `counts`: the number of each decision and of added findings.

The proposals of a round are the **newest proposal set of the document when the
round was created**. Older sets on the same document are never targets and are
not in the record. A later import does not change an existing round; its
proposals only become targets of rounds created after it.

`proposals.csv` gives the counts per tool and person ready made. A precision
from the decisions alone is computed per proposal set: group the records by
`proposal_set.annotation_set_id` and compute
`confirmed / (confirmed + rejected + corrected)`. A corrected proposal counts as
not exact. `uncertain` decisions are reported separately and left out of
precision. Added findings are what the tool missed. The precision in
`proposals.csv` instead compares the proposals with the final result.

## Consolidated findings in the export

Since export format `ontotator-final-export/v2` (the `format` field of
`receipt.json`), the receipt tells how each finding of a consolidation came
about. In the T1 bundle every such finding has provenance method `merged`, so
the bundle alone cannot tell an automatically taken-over match from a
consolidator's decision. `receipt.json` holds `consolidations`, keyed by the
submission ID of every consolidation in the archive (selected and
provenance-only):

- `consolidator`: the consolidator's pseudonym (the submission's author).
- `findings`: one entry per finding of the submission, in bundle order, with
  `annotation_id`, `version` and
  - `origin`: `matched` (every annotator marked the same finding; it was taken
    over automatically and not changed), `decided` (the consolidator resolved
    the group, or changed a taken-over finding) or `added` (the consolidator
    added it outside the groups);
  - `decision`: the group's consolidation action, `auto`, `keep` or `choose`;
    `null` for `added` findings and for findings decided in the editor
    without the consolidation view;
  - `edited`: the finding was changed after its group was resolved;
  - `guidelines_unclear`: the consolidator flagged the group;
  - `decision_ids`: the review decisions (under `review_decisions`) that
    produced the finding.
- `counts`: the number of `matched`, `decided` and `added` findings.

The record is derived from the consolidation's stored decisions at export
time, so it is also complete for consolidations submitted before v2. Version
v1 receipts have no `consolidations`; the decisions' `consolidation.action`
under `review_decisions` holds the same information per group there.
