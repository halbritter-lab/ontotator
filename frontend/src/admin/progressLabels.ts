/**
 * Copy and Documents filters of the Progress page (spec "Screens › Progress (D9)").
 *
 * Every count links to Documents filtered to those rows. Where the Documents
 * filters cannot express a count exactly (one step code per filter), the link
 * uses the closest filter.
 */
import type { ProgressLedeView, ProgressStagesView } from "../api/client";
import type { ProjectDocumentsQuery } from "../app/router";

/** "1 case" / "2 cases"; ``plural`` defaults to the singular plus "s". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ledeSentence(lede: ProgressLedeView): string {
  return [
    countLabel(lede.cases, "case"),
    countLabel(lede.translations_to_review, "translation to review", "translations to review"),
    `${countLabel(lede.versions_to_annotate, "language version to annotate", "language versions to annotate")} (${lede.not_in_plan} not in plan).`,
  ].join(" · ");
}

export function doneSentence(done: number, total: number, word: string): string {
  return `${done} of ${total} ${word}`;
}

export interface StageRow {
  key: string;
  label: string;
  count: number;
  query: ProjectDocumentsQuery;
  /** A problem-report pause: shown with a warning icon next to the text. */
  warning?: boolean;
}

export interface StageCard {
  id: "translation_review" | "annotation" | "final";
  title: string;
  scope: string;
  done: string;
  doneCount: number;
  total: number;
  rows: StageRow[];
  /** Muted text after the "Export final results…" link (Final result card only). */
  footer?: string;
}

const row = (counts: Record<string, number>, key: string, label: string, query: ProjectDocumentsQuery, warning?: boolean): StageRow =>
  ({ key, label, count: counts[key] ?? 0, query, ...(warning ? { warning } : {}) });

export function stageCards(stages: ProgressStagesView, annotationsPerText: number | null): StageCard[] {
  const review = stages.translation_review, annotation = stages.annotation, final = stages.final;
  const perText = annotationsPerText == null ? "" : ` · ${countLabel(annotationsPerText, "annotation per text", "annotations per text")}`;
  return [
    {
      id: "translation_review", title: "Translation review",
      scope: `${countLabel(review.total, "translation")} selected for review`,
      done: doneSentence(review.done, review.total, "accepted"), doneCount: review.done, total: review.total,
      rows: [
        row(review.counts, "to_assign", "To assign", { step: "assign_translation_review" }),
        row(review.counts, "in_review", "In review", { step: "translation_review_in_progress" }),
        row(review.counts, "check_failed_with_reviewer", "Check failed, with reviewer", { translation_status: "automatic_check_failed", step: "translation_review_in_progress" }),
        row(review.counts, "rejected_or_queried", "Rejected or queried · your decision", { decision: "translation" }),
        row(review.counts, "accepted", "Accepted", { translation_status: "accepted" }),
      ],
    },
    {
      id: "annotation", title: "Annotation",
      scope: `${countLabel(annotation.total, "language version")} selected${perText}`,
      done: doneSentence(annotation.done, annotation.total, "fully submitted"), doneCount: annotation.done, total: annotation.total,
      rows: [
        row(annotation.counts, "waiting_for_review", "Waiting for translation review", { step: "waiting_for_translation_review" }),
        row(annotation.counts, "to_assign", "To assign", { step: "assign_annotation" }),
        row(annotation.counts, "in_progress", "In progress", { step: "annotation_in_progress" }),
        row(annotation.counts, "paused", "Paused by a problem report", { status: "held" }, true),
        row(annotation.counts, "submitted", "Submitted", { status: "submitted" }),
      ],
    },
    {
      id: "final", title: "Final result",
      scope: `${countLabel(final.total, "language version")} selected for annotation`,
      done: doneSentence(final.done, final.total, "final"), doneCount: final.done, total: final.total,
      rows: [
        row(final.counts, "not_ready", "Not ready (work open)", { final: "none" }),
        row(final.counts, "to_choose", "To choose · your decision", { step: "choose_final" }),
        row(final.counts, "to_confirm", "To confirm · your decision", { step: "confirm_final" }),
        row(final.counts, "final", "Final", { stage: "done" }),
      ],
      footer: `(${final.counts.final ?? 0} final, ${final.counts.would_be_omitted ?? 0} would be omitted)`,
    },
  ];
}
