# T4: Workflows, Comparison and Merge, Blind Mode

Date: 2026-10-14 · Status: **design agreed** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md` (E7, E8, E9) · Builds on T1 (F10, F11), T2 (D6), T3 (A2–A4), T5

T4 adds multi-person workflows on top of assignments:
- sequential hand-over;
- parallel annotation followed by adjudication;
- span suggestions;
- tolerant comparison and merge;
- live agreement;
- a per-user switch to hide other people's annotations.

## Requirements (from the user, 2026-10-14)

- Sequential: user 1 annotates and releases, then user 2 works on it.
- Parallel: users 1 and 2 annotate, then a third user merges the results or decides finally.
- Every user can propose exact spans.
- Comparison and merge must not treat whitespace, a full stop or a comma as a conflict (T1 F11).
- There is no mode choice at the start. Other people's annotations can be switched on and off in the editor, and the editor can be opened with annotations hidden to avoid being influenced.

## Starting point

- **Today's modes:**
  - `independent`: proposals are hidden on the server.
  - `review`: confirm, reject, adopt-and-edit or mark uncertain per target.
  - `assisted`: hidden in the UI.
- **Review rounds** are identified by `target_set_id`. Submissions of different annotators are unioned into the review targets.
- **Not present:** comparison view, merge, adjudication, agreement and span suggestions.
- **After T3,** assignments `(document, user, task)` exist with the tasks `annotate` and `review`.

## Decisions

- **W1, workflows are stage chains with templates.**
  - A project defines an ordered chain of stages. There are three stage types:
    - **annotate**: k people work in parallel and independently;
    - **revise**: one person takes over the result of the previous stage;
    - **adjudicate**: one person merges the parallel results of the previous stage and decides.
  - **Templates:**
    - *Sequential*: annotate (k=1) → revise.
    - *Parallel + adjudication*: annotate (k=2) → adjudicate.

    Templates can be extended, e.g. with an extra revise stage at the end.
  - A stage starts for a document as soon as the previous stage is released for that document. Other documents are not affected.
  - **Languages.** Stages are assigned per document, so every stage uses the language-aware distribution proposal (T3 A2):
    - annotators and revisers must read the document language;
    - adjudicators must read the document language;
    - translation reviewers must read both languages (T5 V5).

    Manually assigning someone whose profile lacks the language is allowed, but needs an explicit confirmation and is audited, because profiles can be incomplete.
  - **Ad-hoc decisions by the project lead,** per document, at any time:
    - reassign a stage;
    - add a participant to an annotate stage;
    - skip a stage;
    - insert an extra stage (e.g. a second revise round);
    - send a document back to an earlier stage (reopen);
    - declare a stage result final.

    The project lead may also take the adjudicator role personally.

    Every intervention is recorded in `audit_events` with an optional reason. Earlier submissions stay immutable. The chain is the default path, and a per-document override is visible in the progress view.
- **W2, revise stage: free editing with a checklist.**
  - The reviser starts with the released result of the previous stage as their draft and may change, delete or add anything.
  - A side panel lists the inherited annotations that are still untouched.
  - *Release* requires that every inherited annotation was deliberately confirmed, changed or deleted. The keyboard flow is kept: j/k to move, 1–4 to decide.
  - Every change is attributed to the reviser:
    - `method`: `adopted` (confirmed unchanged) or `edited`;
    - `source_refs` point to the inherited annotation;
    - D6 records every step.
  - This replaces today's separate `review` mode and its upfront choice.
- **W3, span boundaries are editable wherever terms are editable.** "Proposing spans" (requirement 3) means that whoever revises or adjudicates can change where a span runs, not only its term.
  - **Revise:** span edges can be dragged (the existing drag-resize) or re-selected. The result is `method: edited` with `source_refs` to the original.
  - **Adjudicate:**
    - Where the annotators' spans differ, the adjudicator takes A's or B's span with one click, or draws new boundaries.
    - Differences that F11 normalises away (edge whitespace and punctuation) are not shown as conflicts.
  - There is no separate suggestion object.
- **W4, blind mode.**
  - **Editor switch:** *Show other annotations*. It covers everything not authored by the current user: tool proposals and results of earlier stages.
  - **Personal preference:** *Always open documents blind*.
  - **Parallel peers** in an annotate stage with k ≥ 2 are always hidden until the stage is complete for that document. This is enforced on the server and is not configurable.
  - **Tool proposals:** a per-stage policy set by the project lead, with three values:
    - `hidden` (enforced on the server);
    - `toggle` (starts off);
    - `shown`.
  - **Revise and adjudicate:** the previous result is the working input. These stages can still start blind and reveal it afterwards.
  - **Provenance:** every show/hide is recorded in the edit log (T2 D6). A submission carries `blind: true` (T1 F10) only if nothing foreign was visible at any point of that draft.
  - This replaces the start-of-session mode choice and today's `independent`/`assisted` modes.
- **W5, adjudication view.**
  - **Grouping:** the released results of the annotate stage are grouped with the T1 F11 matcher. With k > 2, mentions are clustered by overlap, and each group shows which annotators contributed (e.g. "2 of 3").
  - **Groups where all annotators agree:**
    - `equal` groups and `compatible` groups (longer span preselected) are prefilled and collapsed.
    - One action confirms all of them. Any single group can be opened and changed.
  - **Groups to decide one by one:**
    - axis conflicts, term conflicts (flagged `ancestor` where applicable) and modifier conflicts;
    - "only some annotators" groups;
    - any group without full agreement.

    For each, the adjudicator takes one annotator's version with one click, edits it (term, axes, modifiers, span boundaries per W3), or rejects it.
  - **Text view:** the text shows each annotator's spans in distinct colours. The selected group is highlighted, and j/k moves between undecided groups.
  - **Result:** `set_kind: adjudicated`. Each annotation records `method` (`adopted`, `merged` or `edited`) and `source_refs` to every contributing annotation.
  - *Release* requires that no undecided group remains.
- **W6, live agreement (E7).**
  - **Computed:** whenever an annotate stage with k ≥ 2 is complete for a document. The computation runs as a job (T2 P6) and uses the T1 F11 matcher.
  - **Metrics:**
    - pairwise F1 on mentions, strict and tolerant;
    - pairwise F1 on the term level, i.e. the set of (`term_id`, axes) per document;
    - modifier agreement;
    - for k > 2, the mean over pairs.

    Kappa is not reported: span annotation has no well-defined negative class.
  - **Aggregated:** per document, per annotator pair, per language and per project. The view lists the documents with the most conflicts first.
  - **Visibility:** the project lead and system admins see agreement. Annotators do not see it while the project runs, so it cannot influence them.
  - The figures are a steering aid. The citable analysis is computed in the benchmark from releases.
- **W7, releases (E8).**
  - The project lead creates a release with a name (e.g. "Gold v1") and a description.
  - **Documents:** by default, all documents with a final stage result. A document without one is excluded and listed. The lead may narrow the selection.
  - The release is a frozen T1 bundle with `set_kind: release`. It records:
    - the source submissions;
    - the guideline references;
    - the ontology pins.

    It is stored on `/data` and its hash is recorded.
  - Releases are immutable. A correction is a new release that names the one it supersedes.
  - All project members can see releases (E8). Phentrieve and the benchmark read only releases (E5).

- **W8, comments on annotations.**
  - **What can be commented:** an annotation, or the document as a whole, e.g. "unclear whether this is a family finding".
  - **Threads:** a comment can be replied to. A thread can be marked *resolved* and reopened.
  - **Immutability:** comments are append-only. A correction is a new comment, and earlier text stays visible. Every comment is recorded in the edit log (T2 D6) with its author.
  - **Visibility follows blind rules (W4):**
    - Comments on a parallel peer's annotations stay hidden until the stage is complete.
    - Comments made in a stage are visible to later stages on the same document, e.g. an annotator's note reaches the adjudicator.
    - The adjudicator's queries are visible to the annotators of that document.
  - **No e-mail (T2 D2):**
    - The task list shows a count of unread comments per document.
    - A comment can address specific people, who see it highlighted.
  - **Export:** comments are not part of T1 releases. They are included in the optional edit-log export (T2 D6).

## Not in T4

- Real-time co-editing of the same draft by several people.
- Agreement statistics for publication (benchmark side, E7).
