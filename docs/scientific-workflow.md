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
6. Run the analysis command below for each export. Verify expected case coverage,
   check negative/uncertain cases, and inspect the corrected case's selected
   revision and quoted evidence.

This is a technical acceptance procedure. A clinician pilot is still needed to
assess whether the guideline and workflow produce useful, consistent annotation.

## Extract results for analysis

```sh
ontotator analyze annotator-a.zip --annotator A --output annotator-a.json
ontotator analyze annotator-b.zip --annotator B --output annotator-b.json
```

`--mode independent` (annotation) or `--mode review` (consolidation) restricts the
output to that working mode. `--annotator` is repeatable and declares expected people; it
does not remove other contributors present in the package. Without the option,
only people represented by submissions are known. An entirely unsubmitted export
therefore needs an expected annotator ID to produce missing-work rows. Analyze
each per-annotator export separately; absence from another person's scoped export
does not establish absence from the study.

The JSON format is `ontotator-analysis/v1`. It includes the source manifest,
one row per document/person/mode/layer/scope/round, and explicit ambiguity records.
The command validates the archive before producing output. Output is written
atomically and cannot overwrite the input package.

| Row status | Interpretation |
|---|---|
| `missing` | No submitted work for this expected document/person/mode/layer. Drafts are not results. |
| `checked_negative` | The text and layer were checked and the submitted result has no approved annotations or uncertain review targets. |
| `positive` | Checked submission contains approved annotations for this layer. Clinical assertion axes still need interpretation. |
| `uncertain` | At least one review target in this layer remains uncertain. Other approved annotations are retained separately. |
| `unverified` | A historical submission lacks explicit text/layer checking; no confirmed negative is inferred. |
| `ambiguous` | Multiple origin workspaces qualify for the same row; no result is automatically selected. |

The highest draft revision is selected only within the complete origin workspace
key. Wall-clock timestamps do not supersede revisions. Conflicting records at the
same origin/revision fail analysis. Different scopes or review rounds remain
separate and appear in `ambiguities`; choose the study's intended round explicitly
before aggregation. Different working modes and people are never pooled.

Annotation rows preserve term/type/layer, axes, provenance, immutable versions,
text and ontology hashes, and referenced evidence with exact codepoint segments,
cue segments and quoted text. `positive` means the submitted annotation set is
nonempty; an annotation whose clinical assertion is `absent` remains an annotation
and is not equivalent to a document with no findings.

A T1 bundle names, per text, the ontology release recorded with its submission,
which can be older than the project's current release. If its texts were made
under different releases, the newest keeps the layer ID and each older release
gets a layer of its own, `<layer id>@<digest prefix>`, with its release and digest.

`review_targets` retains full proposal records, including rejected and uncertain
targets, separately from approved `annotations`. Decisions refer to those exact
target versions. This keeps uncertainty and rejection interpretable without
promoting their proposals into the approved result set.

For agreement analysis across two exports, first verify the source package/profile
and document text hashes correspond, then choose matching layers, working modes
and intended rounds. Define term equality, ontology-aware matching, span matching
and unknown-axis treatment in the study protocol. The adapter deliberately
computes no agreement statistic and designates no participant as ground truth.

Preserve uncertain targets and ambiguous branches for adjudication outside the
automatic extraction. Hashes establish content identity; the annotator ID is the
logged-in user's pseudonym, so it names the account that did the work.

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

Tool precision is computed per proposal set: group the records by
`proposal_set.annotation_set_id` and compute
`confirmed / (confirmed + rejected + corrected)`. A corrected proposal counts as
not exact. `uncertain` decisions are reported separately and left out of
precision. Added findings are what the tool missed.

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
