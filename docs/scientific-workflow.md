# A small scientific annotation workflow

Ontocurator records annotation and consolidation results. A submitted
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
ontocurator analyze annotator-a.zip --annotator A --output annotator-a.json
ontocurator analyze annotator-b.zip --annotator B --output annotator-b.json
```

`--mode independent` (annotation) or `--mode review` (consolidation) restricts the
output to that working mode. `--annotator` is repeatable and declares expected people; it
does not remove other contributors present in the package. Without the option,
only people represented by submissions are known. An entirely unsubmitted export
therefore needs an expected annotator ID to produce missing-work rows. Analyze
each per-annotator export separately; absence from another person's scoped export
does not establish absence from the study.

The JSON format is `ontocurator-analysis/v1`. It includes the source manifest,
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
