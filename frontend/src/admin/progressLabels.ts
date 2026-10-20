/**
 * Copy of the Progress page (spec "Screens › Progress (D9)").
 *
 * Every count links to Documents with the query the server counted it by
 * (`ProgressStageView.links`, follow-up spec FD11); this module holds no query
 * of its own, it only turns those queries into Documents route fields.
 */
import type { DocumentLinkQuery, ProgressLedeView, ProgressStagesView } from "../api/client";
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
  /** The server's Documents query for this count; absent: the count is shown without a link. */
  query?: ProjectDocumentsQuery;
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

/** A server link as Documents route fields: lists comma-joined, empty values dropped. */
export function linkQuery(link: DocumentLinkQuery): ProjectDocumentsQuery {
  const query: ProjectDocumentsQuery = {};
  for (const [name, value] of Object.entries(link) as [keyof DocumentLinkQuery, unknown][]) {
    const text = Array.isArray(value) ? value.join(",") : value;
    if (typeof text === "string" && text !== "") query[name] = text;
  }
  return query;
}

type Stage = ProgressStagesView[keyof ProgressStagesView];

const row = (stage: Stage, key: string, label: string, warning?: boolean): StageRow => {
  const link = stage.links?.[key];
  return { key, label, count: stage.counts[key] ?? 0, ...(link ? { query: linkQuery(link) } : {}), ...(warning ? { warning } : {}) };
};

export function stageCards(stages: ProgressStagesView, annotationsPerText: number | null): StageCard[] {
  const review = stages.translation_review, annotation = stages.annotation, final = stages.final;
  const perText = annotationsPerText == null ? "" : ` · ${countLabel(annotationsPerText, "annotation per text", "annotations per text")}`;
  return [
    {
      id: "translation_review", title: "Translation review",
      scope: `${countLabel(review.total, "translation")} selected for review`,
      done: doneSentence(review.done, review.total, "accepted"), doneCount: review.done, total: review.total,
      rows: [
        row(review, "to_assign", "To assign"),
        row(review, "in_review", "In review"),
        row(review, "check_failed_with_reviewer", "Check failed, with reviewer"),
        row(review, "rejected_or_queried", "Rejected or queried · your decision"),
        row(review, "accepted", "Accepted"),
      ],
    },
    {
      id: "annotation", title: "Annotation",
      scope: `${countLabel(annotation.total, "language version")} selected${perText}`,
      done: doneSentence(annotation.done, annotation.total, "fully submitted"), doneCount: annotation.done, total: annotation.total,
      rows: [
        row(annotation, "waiting_for_review", "Waiting for translation review"),
        row(annotation, "to_assign", "To assign"),
        row(annotation, "in_progress", "In progress"),
        row(annotation, "paused", "Paused by a problem report", true),
        row(annotation, "submitted", "Submitted"),
      ],
    },
    {
      id: "final", title: "Final result",
      scope: `${countLabel(final.total, "language version")} selected for annotation`,
      done: doneSentence(final.done, final.total, "final"), doneCount: final.done, total: final.total,
      rows: [
        row(final, "not_ready", "Not ready (work open)"),
        row(final, "to_choose", "To choose · your decision"),
        row(final, "to_confirm", "To confirm · your decision"),
        row(final, "final", "Final"),
      ],
      footer: `(${final.counts.final ?? 0} final, ${final.counts.would_be_omitted ?? 0} would be omitted)`,
    },
  ];
}
