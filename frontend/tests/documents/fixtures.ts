/**
 * Shared Documents fixtures built from the generated API types.
 *
 * Generic builders (`version`, `row`, `group`, `page`, ...) take partial overrides; scenario
 * builders `scenarioS0` to `scenarioS6` follow the data shapes of the Documents spec
 * ("Testing" and the browser scenario table). Later WPs may append builders but must not
 * change existing ones.
 */
import type {
  DecisionBarView,
  DocumentGroupView,
  DocumentRowView,
  DocumentRowsPage,
  DocumentVersionView,
  FinalSelectionSummary,
  NextStepView,
  OpenTranslationReviewView,
  RowStagesView,
  StageCellView,
  RowItemView,
  RowRoundView,
  RowSubmissionView,
  RowSubmissions,
} from "../../src/api/client";
import type { components } from "../../src/api/generated";
import type { VersionRecords } from "../../src/documents/TextVersions";

export type WorkItemView = components["schemas"]["WorkItemView"];
export type ReportIssueView = components["schemas"]["ReportIssueView"];

/** A scenario: one text group, its page and the submissions of each row ("{case}:{language}"). */
export interface DocumentsScenario {
  group: DocumentGroupView;
  page: DocumentRowsPage;
  submissions: Record<string, RowSubmissions>;
}

export const rowKey = (caseId: string, language: string): string => `${caseId}:${language}`;

export function bar(overrides: Partial<DecisionBarView> = {}): DecisionBarView {
  return { total: 0, report_or_pause: 0, confirm_final: 0, translation: 0, missing_final: 0, no_final: 0, shown: 0, finals: 0, in_plan: 0, needs_decision: 0, to_assign: 0, in_progress: 0, decision_categories: {}, done: 0, all: 0, not_decided: 0, facets: {}, ...overrides };
}

/** A stage cell (documents overview); the detail defaults to empty. */
export function stageCell(state: string, tone: StageCellView["tone"], detail: Partial<StageCellView["detail"]> = {}): StageCellView {
  return { state, tone, detail: { people: [], ...detail } };
}

/** Review, Annotation and Final cells; every cell defaults to "none". */
export function stages(overrides: Partial<RowStagesView> = {}): RowStagesView {
  return { review: stageCell("none", "none"), annotation: stageCell("none", "none"), final: stageCell("none", "none"), ...overrides };
}

export function version(overrides: Partial<DocumentVersionView> & Pick<DocumentVersionView, "document_id">): DocumentVersionView {
  return {
    external_id: overrides.document_id,
    version: 1,
    origin: "native",
    derived_from: null,
    chain_id: overrides.chain_id ?? overrides.external_id ?? overrides.document_id,
    chain_name: "Source",
    translation_status: null,
    accepted_without_review: false,
    latest_review_decision: null,
    is_newest_in_chain: true,
    matches_filter: true,
    last_activity_at: null,
    ...overrides,
  };
}

export function work(overrides: Partial<WorkItemView> & Pick<WorkItemView, "assignment_id" | "document_id">): WorkItemView {
  return {
    version: 1,
    author_label: "ann-0001",
    is_me: false,
    task: "annotate",
    status: "open",
    held: false,
    round_ordinal: null,
    round_state: null,
    lead_correction: false,
    moved_to_version: null,
    ...overrides,
  };
}

export function item(overrides: Partial<RowItemView> & Pick<RowItemView, "code" | "cause_id">): RowItemView {
  return {
    cause_revision: 1,
    document_id: null,
    category: null,
    version: null,
    review_decision: null,
    report: null,
    report_id: null,
    assignment_id: null,
    author_label: null,
    ...overrides,
  };
}

export function final(overrides: Partial<FinalSelectionSummary> & Pick<FinalSelectionSummary, "case_id" | "language" | "document_id" | "submission_id">): FinalSelectionSummary {
  return {
    revision: 1,
    selected_at: "2026-10-18T10:05:00Z",
    updated_at: "2026-10-18T10:05:00Z",
    selected_by: "lead-0002",
    kind: "annotation",
    round_ordinal: 1,
    author_label: "ann-0001",
    is_mine: false,
    version: 1,
    chain_name: null,
    recorded_at: "2026-10-18T10:00:00Z",
    is_newest_of_chain: true,
    adjudicator_not_annotator: null,
    ...overrides,
  };
}

export function row(overrides: Partial<DocumentRowView> & Pick<DocumentRowView, "case_id" | "language">): DocumentRowView {
  const versions = overrides.versions ?? [version({ document_id: `${overrides.case_id}-${overrides.language}` })];
  const newest = versions.find(entry => entry.is_newest_in_chain) ?? versions[versions.length - 1];
  return {
    is_source: false,
    position: 1,
    versions,
    parallel_roots: false,
    work: [],
    final: null,
    issues: [],
    notes: [],
    missing_final: { counts: false, reason: "no_submission" },
    categories: [],
    bulk: { document_id: newest.document_id, mode: "checkbox" },
    open: { document_id: newest.document_id, reason: "newest", label: null },
    own_open_assignment_id: null,
    last_activity_at: null,
    pinned: false,
    retained: false,
    matches_decision: true,
    next_step: null,
    steps: [],
    plan_row: { review: false, annotate: true, review_applicable: false, discarded: false, decided: true },
    in_plan: true,
    stages: stages(),
    version_marker: null,
    new: false,
    others_activity_at: null,
    ...overrides,
  };
}

export function group(caseId: string, rows: DocumentRowView[], overrides: Partial<DocumentGroupView> = {}): DocumentGroupView {
  const activity = rows.map(entry => entry.last_activity_at).filter((value): value is string => value !== null).sort();
  return {
    case_id: caseId,
    rows,
    language_count: rows.length,
    final_count: rows.filter(entry => entry.final !== null).length,
    issue_count: rows.reduce((sum, entry) => sum + entry.issues.length, 0),
    note_count: rows.reduce((sum, entry) => sum + entry.notes.length, 0),
    last_activity_at: activity.length ? activity[activity.length - 1] : null,
    has_issue: rows.some(entry => entry.categories.length > 0),
    plan_revision: 1,
    not_in_plan_languages: [],
    ...overrides,
  };
}

/** Bar counts derived from the given groups (distinct rows per category). */
export function barFor(groups: readonly DocumentGroupView[]): DecisionBarView {
  const rows = groups.flatMap(entry => entry.rows);
  const count = (category: DocumentRowView["categories"][number]) => rows.filter(entry => entry.categories.includes(category)).length;
  const total = rows.filter(entry => entry.categories.length > 0).length;
  return bar({
    total,
    report_or_pause: count("report-or-pause"),
    confirm_final: count("confirm-final"),
    translation: count("translation"),
    missing_final: count("missing-final"),
    no_final: rows.filter(entry => entry.final === null).length,
    shown: total,
    // Project-wide in the API; the fixture's project is the given groups.
    finals: rows.filter(entry => entry.final !== null).length,
  });
}

export function page(groups: DocumentGroupView[], overrides: Partial<DocumentRowsPage> = {}): DocumentRowsPage {
  return { groups, page: 1, page_count: 1, group_count: groups.length, bar: barFor(groups), case_found: true, adjudicator_not_annotator: false, ...overrides };
}

export function submission(overrides: Partial<RowSubmissionView> & Pick<RowSubmissionView, "submission_id" | "document_id">): RowSubmissionView {
  return {
    version: 1,
    chain_name: null,
    author_label: "ann-0001",
    is_me: false,
    recorded_at: "2026-10-18T10:00:00Z",
    mode: "independent",
    kind: "annotation",
    round_id: null,
    round_ordinal: null,
    round_state: null,
    is_latest_in_round: null,
    finding_count: 3,
    guideline_version: null,
    guideline_withdrawn: false,
    ...overrides,
  };
}

export function round(overrides: Partial<RowRoundView> & Pick<RowRoundView, "round_id" | "assignment_id" | "document_id">): RowRoundView {
  return {
    predecessor_round_id: null,
    version: 1,
    chain_name: null,
    kind: "annotation",
    mode: "independent",
    state: "submitted",
    author_label: "ann-0001",
    is_me: false,
    round_ordinal: 1,
    submitted: true,
    ...overrides,
  };
}

export function translationReview(overrides: Partial<OpenTranslationReviewView> & Pick<OpenTranslationReviewView, "assignment_id" | "document_id">): OpenTranslationReviewView {
  return { version: 1, chain_name: null, reviewer_label: "rev-0001", is_me: false, ...overrides };
}

export function submissions(caseId: string, language: string, overrides: Partial<RowSubmissions> = {}): RowSubmissions {
  return { case_id: caseId, language, adjudicator_not_annotator: false, submissions: [], rounds: [], open_translation_reviews: [], ...overrides };
}

function scenario(group: DocumentGroupView, rows: Record<string, RowSubmissions>): DocumentsScenario {
  return { group, page: page([group]), submissions: rows };
}

/**
 * S0 `synthetic-accepted`: en native unassigned; de MT accepted, ann-0004 Round 1 submitted and
 * selected, correction v2 ready for review, ann-0004 Round 3 in progress, ann-0003 review submitted.
 * de: confirm-final (text corrected), waiting line Round 3; en: no final, not counted.
 */
export function scenarioS0(): DocumentsScenario {
  const caseId = "synthetic-accepted";
  const en = row({
    case_id: caseId, language: "en", is_source: true, position: 1,
    versions: [version({ document_id: "synthetic-accepted-en", chain_name: "Source" })],
    missing_final: { counts: false, reason: "no_submission" },
  });
  const v1 = version({
    document_id: "synthetic-accepted-de", external_id: "synthetic-accepted-de", chain_id: "synthetic-accepted-de", chain_name: "DeepL",
    origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted", is_newest_in_chain: false,
    last_activity_at: "2026-10-18T10:00:00Z",
  });
  const v2 = version({
    document_id: "synthetic-accepted-de-v2", external_id: "synthetic-accepted-de", chain_id: "synthetic-accepted-de", chain_name: "DeepL",
    version: 2, origin: "correction", derived_from: "synthetic-accepted-de", translation_status: "ready_for_review",
    last_activity_at: "2026-10-19T00:57:00Z",
  });
  const de = row({
    case_id: caseId, language: "de", position: 2, versions: [v1, v2],
    work: [
      work({ assignment_id: 41, document_id: v1.document_id, author_label: "ann-0004", status: "in_progress", round_ordinal: 3, round_state: "open" }),
      work({ assignment_id: 42, document_id: v1.document_id, author_label: "ann-0003", task: "review", status: "submitted" }),
    ],
    final: final({
      case_id: caseId, language: "de", document_id: v1.document_id, submission_id: "sub-s0-r1", author_label: "ann-0004",
      round_ordinal: 1, version: 1, chain_name: "DeepL", is_newest_of_chain: false,
    }),
    issues: [item({
      code: "SELECTED_TEXT_CORRECTED", cause_id: `SELECTED_TEXT_CORRECTED:${v1.document_id}:${v2.document_id}`,
      category: "confirm-final", document_id: v2.document_id, version: 2,
    })],
    notes: [item({ code: "ROUND_REVIEW_PENDING", cause_id: "ROUND_REVIEW_PENDING:round-s0-3", assignment_id: 41, author_label: "ann-0004" })],
    missing_final: { counts: false, reason: null },
    categories: ["confirm-final"],
    bulk: { document_id: v2.document_id, mode: "checkbox" },
    open: { document_id: v1.document_id, reason: "final", label: null },
    last_activity_at: "2026-10-19T00:57:00Z",
  });
  return scenario(group(caseId, [en, de]), {
    [rowKey(caseId, "en")]: submissions(caseId, "en"),
    [rowKey(caseId, "de")]: submissions(caseId, "de", {
      submissions: [
        submission({ submission_id: "sub-s0-r1", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_id: "round-s0-1", round_ordinal: 1, round_state: "superseded", is_latest_in_round: true, recorded_at: "2026-10-18T10:00:00Z" }),
        submission({ submission_id: "sub-s0-review", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0003", mode: "review", kind: "review", recorded_at: "2026-10-18T12:00:00Z" }),
      ],
      rounds: [
        round({ round_id: "round-s0-1", assignment_id: 41, document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_ordinal: 1, state: "superseded" }),
        round({ round_id: "round-s0-2", assignment_id: 41, predecessor_round_id: "round-s0-1", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_ordinal: 2, state: "superseded" }),
        round({ round_id: "round-s0-3", assignment_id: 41, predecessor_round_id: "round-s0-2", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_ordinal: 3, state: "open", submitted: false }),
      ],
    }),
  });
}

/** S1 `case-0042`: en native, two annotators submitted, final chosen; no issues. */
export function scenarioS1(): DocumentsScenario {
  const caseId = "case-0042";
  const document = version({ document_id: "case-0042-en", last_activity_at: "2026-10-17T09:30:00Z" });
  const en = row({
    case_id: caseId, language: "en", is_source: true, versions: [document],
    work: [
      work({ assignment_id: 1, document_id: document.document_id, author_label: "ann-0001", status: "submitted" }),
      work({ assignment_id: 2, document_id: document.document_id, author_label: "ann-0002", status: "submitted" }),
    ],
    final: final({ case_id: caseId, language: "en", document_id: document.document_id, submission_id: "sub-0042-a", author_label: "ann-0001", round_ordinal: null, chain_name: "Source" }),
    missing_final: { counts: false, reason: null },
    open: { document_id: document.document_id, reason: "final", label: null },
    last_activity_at: "2026-10-17T09:30:00Z",
  });
  return scenario(group(caseId, [en]), {
    [rowKey(caseId, "en")]: submissions(caseId, "en", {
      submissions: [
        submission({ submission_id: "sub-0042-a", document_id: document.document_id, author_label: "ann-0001", recorded_at: "2026-10-17T09:00:00Z" }),
        submission({ submission_id: "sub-0042-b", document_id: document.document_id, author_label: "ann-0002", recorded_at: "2026-10-17T09:30:00Z" }),
      ],
    }),
  });
}

/**
 * S2 `case-0108`: en source plus 6 MT languages, de `automatic_check_failed`, 4 finals.
 * de has the translation issue; the group header reads "7 languages, final 4 of 7".
 */
export function scenarioS2(): DocumentsScenario {
  const caseId = "case-0108";
  const languages = ["en", "de", "es", "fr", "it", "nl", "pt"];
  const withFinal = new Set(["en", "es", "fr", "it"]);
  const rows = languages.map((language, index) => {
    const isSource = language === "en";
    const document = version({
      document_id: `case-0108-${language}`,
      chain_name: isSource ? "Source" : "DeepL",
      origin: isSource ? "native" : "machine_translation",
      translation_status: isSource ? null : language === "de" ? "automatic_check_failed" : "accepted",
      last_activity_at: "2026-10-16T08:00:00Z",
    });
    const hasFinal = withFinal.has(language);
    const translationIssue = language === "de"
      ? [item({ code: "TRANSLATION_CHECK_FAILED", cause_id: `TRANSLATION_CHECK_FAILED:${document.document_id}`, category: "translation", document_id: document.document_id, version: 1 })]
      : [];
    return row({
      case_id: caseId, language, is_source: isSource, position: index + 1, versions: [document],
      final: hasFinal ? final({ case_id: caseId, language, document_id: document.document_id, submission_id: `sub-0108-${language}`, chain_name: document.chain_name }) : null,
      issues: translationIssue,
      missing_final: { counts: false, reason: hasFinal ? null : "no_submission" },
      categories: translationIssue.length ? ["translation"] : [],
      last_activity_at: "2026-10-16T08:00:00Z",
    });
  });
  return scenario(group(caseId, rows), Object.fromEntries(languages.map(language => [rowKey(caseId, language), submissions(caseId, language, {
    submissions: withFinal.has(language) ? [submission({ submission_id: `sub-0108-${language}`, document_id: `case-0108-${language}` })] : [],
  })])));
}

/**
 * S3 `case-0211`: de chain v1 MT accepted (final on v1 Round 2), v2 correction accepted,
 * v3 correction ready for review with an open translation review.
 * Final shows "· v1"; SELECTED_TEXT_CORRECTED for v2 and v3; waiting line for the review of v3.
 */
export function scenarioS3(): DocumentsScenario {
  const caseId = "case-0211";
  const chain = { external_id: "case-0211-de", chain_id: "case-0211-de", chain_name: "DeepL" };
  const v1 = version({ ...chain, document_id: "case-0211-de", origin: "machine_translation", translation_status: "accepted", latest_review_decision: "accepted", is_newest_in_chain: false });
  const v2 = version({ ...chain, document_id: "case-0211-de-v2", version: 2, origin: "correction", derived_from: v1.document_id, translation_status: "accepted", latest_review_decision: "accepted", is_newest_in_chain: false });
  const v3 = version({ ...chain, document_id: "case-0211-de-v3", version: 3, origin: "correction", derived_from: v2.document_id, translation_status: "ready_for_review", last_activity_at: "2026-10-19T08:15:00Z" });
  const corrected = (descendant: DocumentVersionView) => item({
    code: "SELECTED_TEXT_CORRECTED", cause_id: `SELECTED_TEXT_CORRECTED:${v1.document_id}:${descendant.document_id}`,
    category: "confirm-final", document_id: descendant.document_id, version: descendant.version,
  });
  const de = row({
    case_id: caseId, language: "de", versions: [v1, v2, v3],
    work: [work({ assignment_id: 77, document_id: v3.document_id, version: 3, author_label: "rev-0007", task: "translation_review", status: "open" })],
    final: final({
      case_id: caseId, language: "de", document_id: v1.document_id, submission_id: "sub-0211-r2", author_label: "ann-0004",
      round_ordinal: 2, version: 1, chain_name: "DeepL", recorded_at: "2026-10-18T10:00:00Z", is_newest_of_chain: false,
    }),
    issues: [corrected(v2), corrected(v3)],
    missing_final: { counts: false, reason: null },
    categories: ["confirm-final"],
    bulk: { document_id: v3.document_id, mode: "checkbox" },
    open: { document_id: v1.document_id, reason: "final", label: null },
    last_activity_at: "2026-10-19T08:15:00Z",
  });
  return scenario(group(caseId, [de]), {
    [rowKey(caseId, "de")]: submissions(caseId, "de", {
      submissions: [
        submission({ submission_id: "sub-0211-r1", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_id: "round-0211-1", round_ordinal: 1, round_state: "superseded", is_latest_in_round: true, recorded_at: "2026-10-17T10:00:00Z" }),
        submission({ submission_id: "sub-0211-r2", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_id: "round-0211-2", round_ordinal: 2, round_state: "submitted", is_latest_in_round: true, recorded_at: "2026-10-18T10:00:00Z" }),
      ],
      rounds: [
        round({ round_id: "round-0211-1", assignment_id: 70, document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_ordinal: 1, state: "superseded" }),
        round({ round_id: "round-0211-2", assignment_id: 70, predecessor_round_id: "round-0211-1", document_id: v1.document_id, chain_name: "DeepL", author_label: "ann-0004", round_ordinal: 2 }),
      ],
      open_translation_reviews: [translationReview({ assignment_id: 77, document_id: v3.document_id, version: 3, chain_name: "DeepL", reviewer_label: "rev-0007" })],
    }),
  });
}

/**
 * S4 `case-0305`: fr two MT roots (Provider A, Provider B), two annotators in progress.
 * "2 independent translations"; bulk selection says "Choose in Text versions".
 */
export function scenarioS4(): DocumentsScenario {
  const caseId = "case-0305";
  const a = version({ document_id: "case-0305-fr-a", chain_name: "Provider A", origin: "machine_translation", translation_status: "accepted", last_activity_at: "2026-10-15T09:00:00Z" });
  const b = version({ document_id: "case-0305-fr-b", chain_name: "Provider B", origin: "machine_translation", translation_status: "accepted", last_activity_at: "2026-10-16T09:00:00Z" });
  const fr = row({
    case_id: caseId, language: "fr", versions: [a, b], parallel_roots: true,
    work: [
      work({ assignment_id: 51, document_id: a.document_id, author_label: "ann-0001", status: "in_progress" }),
      work({ assignment_id: 52, document_id: b.document_id, author_label: "ann-0002", status: "in_progress" }),
    ],
    missing_final: { counts: false, reason: "work_open" },
    bulk: { document_id: null, mode: "choose_in_versions" },
    open: { document_id: b.document_id, reason: "most_recent_root", label: "Provider B v1" },
    last_activity_at: "2026-10-16T09:00:00Z",
  });
  return scenario(group(caseId, [fr]), {
    [rowKey(caseId, "fr")]: submissions(caseId, "fr", {
      rounds: [
        round({ round_id: "round-0305-a", assignment_id: 51, document_id: a.document_id, chain_name: "Provider A", author_label: "ann-0001", state: "open", submitted: false }),
        round({ round_id: "round-0305-b", assignment_id: 52, document_id: b.document_id, chain_name: "Provider B", author_label: "ann-0002", state: "open", submitted: false }),
      ],
    }),
  });
}

/** S5 `case-0377`: en, 3 submissions plus a lead consolidation selected; the final label has no round. */
export function scenarioS5(): DocumentsScenario {
  const caseId = "case-0377";
  const document = version({ document_id: "case-0377-en", last_activity_at: "2026-10-18T10:00:00Z" });
  const en = row({
    case_id: caseId, language: "en", is_source: true, versions: [document],
    work: [1, 2, 3].map(index => work({ assignment_id: 60 + index, document_id: document.document_id, author_label: `ann-000${index}`, status: "submitted" })),
    final: final({
      case_id: caseId, language: "en", document_id: document.document_id, submission_id: "sub-0377-consolidation", kind: "consolidation",
      round_ordinal: null, author_label: "lead-0002", is_mine: true, chain_name: "Source", recorded_at: "2026-10-18T10:00:00Z",
    }),
    missing_final: { counts: false, reason: null },
    open: { document_id: document.document_id, reason: "final", label: null },
    last_activity_at: "2026-10-18T10:00:00Z",
  });
  return scenario(group(caseId, [en]), {
    [rowKey(caseId, "en")]: submissions(caseId, "en", {
      submissions: [
        ...[1, 2, 3].map(index => submission({ submission_id: `sub-0377-${index}`, document_id: document.document_id, author_label: `ann-000${index}`, recorded_at: `2026-10-17T0${index}:00:00Z` })),
        submission({ submission_id: "sub-0377-consolidation", document_id: document.document_id, author_label: "lead-0002", is_me: true, kind: "consolidation", mode: "independent", round_id: "round-0377-c", round_state: "submitted", is_latest_in_round: true, recorded_at: "2026-10-18T10:00:00Z" }),
      ],
      rounds: [round({ round_id: "round-0377-c", assignment_id: 64, document_id: document.document_id, kind: "consolidation", author_label: "lead-0002", is_me: true, round_ordinal: null })],
    }),
  });
}

/** S6 `case-0390`: de, open problem report with a paused task; report-or-pause with the report excerpt. */
export function scenarioS6(): DocumentsScenario {
  const caseId = "case-0390";
  const document = version({ document_id: "case-0390-de", chain_name: "DeepL", origin: "machine_translation", translation_status: "accepted", last_activity_at: "2026-10-19T07:40:00Z" });
  const report: ReportIssueView = { report_id: "report-0390", excerpt: "The translation drops the negation in the second sentence.", reporter_label: "ann-0005", created_at: "2026-10-19T07:40:00Z", task_state: "paused" };
  const de = row({
    case_id: caseId, language: "de", versions: [document],
    work: [work({ assignment_id: 90, document_id: document.document_id, author_label: "ann-0005", status: "in_progress", held: true, round_ordinal: 1, round_state: "open" })],
    issues: [
      item({ code: "OPEN_PROBLEM_REPORT", cause_id: "OPEN_PROBLEM_REPORT:report-0390", category: "report-or-pause", document_id: document.document_id, version: 1, report, report_id: "report-0390", assignment_id: 90, author_label: "ann-0005" }),
    ],
    missing_final: { counts: false, reason: "work_open" },
    categories: ["report-or-pause"],
    last_activity_at: "2026-10-19T07:40:00Z",
  });
  return scenario(group(caseId, [de]), {
    [rowKey(caseId, "de")]: submissions(caseId, "de", {
      rounds: [round({ round_id: "round-0390-1", assignment_id: 90, document_id: document.document_id, chain_name: "DeepL", author_label: "ann-0005", state: "open", submitted: false })],
    }),
  });
}

// ---- Lead workflow (L3): next steps and plan rows ----

/** A next step; defaults to "Assign translation review" owned by the viewing lead. */
export function step(overrides: Partial<NextStepView> = {}): NextStepView {
  return {
    code: "assign_translation_review",
    kind: "assign",
    stage: "translation_review",
    action: null,
    badges: [],
    assigned: null,
    target: null,
    owner: { kind: "you", person: null, count: 0, people: [] },
    detail: null,
    report_id: null,
    assignment_id: null,
    submission_id: null,
    document_id: null,
    ...overrides,
  };
}

/** Default action of a step code (rule table of the spec). */
const STEP_ACTIONS: Partial<Record<NextStepView["code"], NonNullable<NextStepView["action"]>>> = {
  decide_plan: "plan",
  decide_report: "decide_report",
  resume_task: "resume_task",
  confirm_final: "review_changes",
  resolve_rejected: "resolve",
  resolve_queried: "resolve",
  translation_not_accepted: "accept_or_review",
  choose_final: "choose_final",
  assign_translation_review: "assign_translation_review",
  assign_annotation: "assign_annotation",
  handle_text_change: "handle_text_change",
  carry_text_change: "carry_text_change",
  review_source_change: "assign_source_review",
};
const STEP_KINDS: Record<NextStepView["code"], NextStepView["kind"]> = {
  decide_plan: "decision",
  decide_report: "decision", resume_task: "decision", confirm_final: "decision", resolve_rejected: "decision", resolve_queried: "decision",
  translation_not_accepted: "decision", choose_final: "decision", needs_attention: "decision",
  handle_text_change: "decision", carry_text_change: "decision",
  assign_translation_review: "assign", assign_annotation: "assign", review_source_change: "assign",
  translation_review_in_progress: "in_progress", annotation_in_progress: "in_progress", annotation_review_in_progress: "in_progress", waiting_for_translation_review: "in_progress",
  done: "done", translation_accepted: "done",
};

/** A step of `code` with its kind, action and a "You" owner for lead-owned kinds. */
export function stepOf(code: NextStepView["code"], overrides: Partial<NextStepView> = {}): NextStepView {
  const kind = STEP_KINDS[code];
  const owner: NextStepView["owner"] = kind === "decision" || kind === "assign" ? { kind: "you", person: null, count: 0, people: [] } : { kind: "none", person: null, count: 0, people: [] };
  return step({ code, kind, action: STEP_ACTIONS[code] ?? null, badges: kind === "decision" ? ["your_decision"] : [], owner, ...overrides });
}

/** A translation row in the plan with the given next step (Review and Annotate on by default). */
export function planRow(caseId: string, language: string, next: NextStepView | null, overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const isSource = overrides.is_source ?? false;
  return row({
    case_id: caseId,
    language,
    is_source: isSource,
    versions: [version({ document_id: `${caseId}-${language}`, chain_name: isSource ? "Source" : "DeepL", origin: isSource ? "native" : "machine_translation", translation_status: isSource ? null : "ready_for_review" })],
    next_step: next,
    steps: next ? [next] : [],
    plan_row: { review: !isSource, annotate: true, review_applicable: !isSource, discarded: false, decided: true },
    in_plan: next !== null,
    ...overrides,
  });
}

/** A row that is not in the plan (both flags off). */
export function notInPlanRow(caseId: string, language: string, overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const isSource = overrides.is_source ?? false;
  return planRow(caseId, language, null, { plan_row: { review: false, annotate: false, review_applicable: !isSource, discarded: false, decided: true }, in_plan: false, ...overrides });
}

// ---- Lead workflow (L4): acceptance and discard records on text versions ----

export type RecordedVersion = DocumentVersionView & VersionRecords;

/** A text version with optional acceptance and discard records (fields the expanded row reads when present). */
export function recordedVersion(overrides: Partial<RecordedVersion> & Pick<RecordedVersion, "document_id">): RecordedVersion {
  return version(overrides) as RecordedVersion;
}

// ---- Lead correction (F1b) ----

/**
 * A row whose newest version `{caseId}-{language}` (v`version`) was rejected or queried; with
 * `correcting`, the lead's own open translation review of it (assignment 41) is listed.
 */
export function rejectedRow(caseId: string, language: string, options: { decision?: "rejected" | "query"; version?: number; correcting?: boolean } = {}): DocumentRowView {
  const decision = options.decision ?? "rejected";
  const documentId = `${caseId}-${language}`;
  const versionNumber = options.version ?? 1;
  const correcting = options.correcting ?? false;
  const next = correcting
    ? stepOf("translation_review_in_progress", { document_id: documentId })
    : stepOf(decision === "rejected" ? "resolve_rejected" : "resolve_queried", { document_id: documentId });
  return planRow(caseId, language, next, {
    versions: [version({ document_id: documentId, version: versionNumber, chain_name: "DeepL", origin: "machine_translation", translation_status: "reviewed", latest_review_decision: decision })],
    work: correcting ? [work({ assignment_id: 41, document_id: documentId, version: versionNumber, task: "translation_review", status: "in_progress", is_me: true, author_label: "lead-0002", lead_correction: true })] : [],
    own_open_assignment_id: correcting ? 41 : null,
  });
}
