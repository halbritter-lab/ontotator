/**
 * Copy of the Documents "Next step" and "Owner" columns (spec "Next step" and "Copy › Steps,
 * Row actions"). Pure functions over the server-derived `NextStepView`; the table, the narrow
 * cards and the row actions share them so names stay identical.
 */
import type { DocumentRowView, NextStepView, StepDetailView } from "../api/client";
import { personLabel } from "../app/identity";
import { plural } from "../app/labels";
import { kindLabels, type SubmissionKind } from "../app/submissionLabels";

export type StepCode = NextStepView["code"];
export type RowAction = NonNullable<NextStepView["action"]>;
export type StepBadge = NonNullable<NextStepView["badges"]>[number];

export const STEP_LABELS: Readonly<Record<StepCode, string>> = {
  decide_report: "Decide on problem report",
  resume_task: "Resume paused task",
  confirm_final: "Confirm final result",
  resolve_rejected: "Resolve rejected translation",
  resolve_queried: "Resolve queried translation",
  translation_not_accepted: "Translation not accepted",
  choose_final: "Choose final result",
  assign_translation_review: "Assign translation review",
  translation_review_in_progress: "Translation review in progress",
  assign_annotation: "Assign annotation",
  annotation_in_progress: "Annotation in progress",
  annotation_review_in_progress: "Annotation review in progress",
  waiting_for_translation_review: "Waiting for translation review",
  done: "Done",
  translation_accepted: "Translation accepted",
  needs_attention: "Needs attention",
};

export const ACTION_LABELS: Readonly<Record<RowAction, string>> = {
  decide_report: "Decide on report…",
  resume_task: "Resume task…",
  review_changes: "Review changes…",
  resolve: "Resolve…",
  accept_or_review: "Assign review or accept…",
  choose_final: "Choose final…",
  assign_translation_review: "Assign translation review…",
  assign_annotation: "Assign annotation…",
};

export const BADGE_LABELS: Readonly<Record<StepBadge, string>> = {
  your_decision: "Your decision",
  check_failed: "Check failed",
  paused: "Paused",
};

/** Next-step filter options grouped by stage (spec "Filters": Next step grouped by stage). */
export const STEP_FILTER_GROUPS: readonly (readonly [string, readonly StepCode[]])[] = [
  ["Any stage", ["decide_report", "resume_task"]],
  ["Translation review", ["resolve_rejected", "resolve_queried", "translation_not_accepted", "assign_translation_review", "translation_review_in_progress", "waiting_for_translation_review"]],
  ["Annotation", ["assign_annotation", "annotation_in_progress", "annotation_review_in_progress"]],
  ["Final result", ["choose_final", "confirm_final"]],
  ["Done", ["done", "translation_accepted"]],
];

export const stepLabel = (code: StepCode): string => STEP_LABELS[code] ?? code;
export const actionLabel = (action: RowAction): string => ACTION_LABELS[action] ?? action;

/** "Annotation · Round 1 · Annotator (ann-0004)" of the row's final result. */
function finalText(row: DocumentRowView, detail: StepDetailView): string | null {
  const final = row.final;
  if (!final) return null;
  const kind = (final.kind ?? "annotation") as SubmissionKind;
  const ordinal = final.round_ordinal ?? detail.round_ordinal ?? null;
  const round = kind === "consolidation" ? null : ordinal == null ? "Initial submission" : `Round ${ordinal}`;
  const author = personLabel(final.author ?? (final.author_label ? { pseudonym: final.author_label, is_me: final.is_mine } : null), { fallback: "Unknown" });
  return ["Final: " + (kindLabels[kind] ?? kind), round, author].filter(Boolean).join(" · ");
}

const ORIGIN_TEXT: Readonly<Record<string, string>> = {
  native: "source",
  machine_translation: "machine translation",
  human_translation: "human translation",
  correction: "correction",
};
const STATUS_TEXT: Readonly<Record<string, string>> = {
  translated: "translated",
  automatic_check_failed: "check failed",
  ready_for_review: "ready for review",
  reviewed: "reviewed",
  accepted: "accepted",
};

/** "v1 machine translation" of a version detail. */
function versionText(detail: StepDetailView): string {
  return [detail.version != null ? `v${detail.version}` : null, detail.origin ? ORIGIN_TEXT[detail.origin] : null].filter(Boolean).join(" ");
}

/** The report excerpt cut at 60 characters. */
export const REPORT_EXCERPT_CHARS = 60;
function cut(text: string): string {
  return text.length > REPORT_EXCERPT_CHARS ? `${text.slice(0, REPORT_EXCERPT_CHARS)}…` : text;
}

function detailText(row: DocumentRowView, detail: StepDetailView): string | null {
  switch (detail.kind) {
    case "version": {
      const status = detail.translation_status ? STATUS_TEXT[detail.translation_status] : null;
      return [versionText(detail), status].filter(Boolean).join(" · ") || null;
    }
    case "waiting":
      return [versionText(detail), "waiting for review"].filter(Boolean).join(" · ");
    case "source_ready":
      return "Source text · ready to annotate";
    case "annotations_submitted": {
      const total = detail.total ?? 0;
      return `${detail.submitted ?? 0} of ${total} ${total === 1 ? "annotation" : "annotations"} submitted`;
    }
    case "round":
      return detail.round_ordinal != null ? `Round ${detail.round_ordinal} · in progress` : "In progress";
    case "report":
      return [detail.excerpt ? `“${cut(detail.excerpt)}”` : null, detail.reporter ? personLabel(detail.reporter) : null, detail.task_paused ? "task paused" : null]
        .filter(Boolean).join(" · ") || null;
    case "final":
      return finalText(row, detail);
    case "review_only":
      return "Review only · not annotated";
    default:
      return null;
  }
}

/** Muted second line under the step: "1 of 2 assigned" (target > 1) and the detail. */
export function secondaryLine(step: NextStepView, row: DocumentRowView): string {
  const assigned = step.target != null && step.target > 1 ? `${step.assigned ?? 0} of ${step.target} assigned` : null;
  const detail = step.detail ? detailText(row, step.detail) : null;
  return [assigned, detail].filter(Boolean).join(" · ");
}

/** Owner column: "You", "Ana Weber (ann-0004)", "2 annotators", or "—". */
export function ownerLabel(step: NextStepView | null | undefined): string {
  const owner = step?.owner;
  if (!step || !owner) return "—";
  switch (owner.kind) {
    case "you": return "You";
    case "person": return personLabel(owner.person);
    case "people": return plural(owner.count, step.stage === "translation_review" ? "reviewer" : "annotator");
    default: return "—";
  }
}

/** "+1 more step" for rows matching several rules. */
export function moreStepsLabel(row: Pick<DocumentRowView, "steps">): string | null {
  const more = (row.steps?.length ?? 0) - 1;
  return more > 0 ? `+${plural(more, "more step")}` : null;
}
