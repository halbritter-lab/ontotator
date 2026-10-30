/**
 * Copy of the Documents next steps and row actions (spec "Next step" and "Copy › Steps, Row
 * actions"; documents overview "Copy › Actions"). Pure functions over the server-derived
 * `NextStepView`; the table, the narrow cards and the row actions share them so names stay
 * identical. The Waiting on column lives in `stageLabels.ts` (`waitingOnText`).
 */
import type { DocumentRowView, NextStepView } from "../api/client";

export type StepCode = NextStepView["code"];
export type RowAction = NonNullable<NextStepView["action"]>;

export const STEP_LABELS: Readonly<Record<StepCode, string>> = {
  decide_plan: "Decide the plan",
  decide_report: "Decide on problem report",
  resume_task: "Resume paused task",
  confirm_final: "Confirm final result",
  handle_text_change: "Handle text change",
  carry_text_change: "Carry to v2",
  resolve_rejected: "Resolve rejected translation",
  resolve_queried: "Resolve queried translation",
  translation_not_accepted: "Translation not accepted",
  choose_final: "Choose final result",
  assign_translation_review: "Assign translation review",
  review_source_change: "Review source change",
  translation_review_in_progress: "Translation review in progress",
  assign_annotation: "Assign annotation",
  annotation_in_progress: "Annotation in progress",
  consolidation_in_progress: "Consolidation in progress",
  waiting_for_translation_review: "Waiting for translation review",
  done: "Done",
  translation_accepted: "Translation accepted",
  needs_attention: "Needs attention",
};

export const ACTION_LABELS: Readonly<Record<RowAction, string>> = {
  plan: "Plan…",
  decide_report: "Decide on report…",
  resume_task: "Resume task…",
  review_changes: "Review changes…",
  handle_text_change: "Handle text change…",
  carry_text_change: "Carry to v2…",
  resolve: "Resolve…",
  accept_or_review: "Assign review or accept…",
  // Rendered as "Accept result…" for one submission (`rowActionLabel`, V6/VD16).
  choose_final: "Compare results…",
  assign_translation_review: "Assign review…",
  assign_source_review: "Assign review…",
  assign_annotation: "Assign annotation…",
};

export const stepLabel = (code: StepCode): string => STEP_LABELS[code] ?? code;
export const actionLabel = (action: RowAction): string => ACTION_LABELS[action] ?? action;

/**
 * The action name of a step on its row: "Choose final" follows the server's `stages.final.detail.label_rule` (the
 * final-result panel's rule, VD16): "accept" reads "Accept result…", "compare" "Compare results…"; without the field
 * one submission reads "Accept result…". A "compare" row whose findings all match also reads "Accept result…" (issue
 * 198): the card then offers one "Accept result" under "All findings match (4 of 4)", or "Both submissions have no
 * findings" when neither has any. Like the card (`PanelContent`), not once a final exists or while other annotations
 * are still open (issue 123): the card compares there.
 */
export function rowActionLabel(step: NextStepView, row: Pick<DocumentRowView, "stages"> & Partial<Pick<DocumentRowView, "versions" | "work" | "steps" | "next_step" | "final">>): string {
  if (step.action === "choose_final") {
    const final = row.stages?.final;
    const rule = final?.detail.label_rule ?? (final?.state === "choose" && final.detail.submitted === 1 ? "accept" : "compare");
    const allMatch = final?.detail.compared != null && final.detail.matching === final.detail.compared && !row.final && !annotationsOpen(row);
    return rule === "accept" || allMatch ? "Accept result…" : "Compare results…";
  }
  if (step.action === "handle_text_change" || step.action === "carry_text_change") {
    const target = row.versions?.find(version => version.document_id === step.document_id);
    const base = step.action === "carry_text_change" && target ? `Carry to v${target.version}…` : actionLabel(step.action);
    // Several old-version items on one row: one entry per person, in the server's order (spec V5).
    const same = row.steps || row.next_step ? leadSteps({ steps: row.steps, next_step: row.next_step ?? null }).filter(other => other.action === step.action) : [];
    const item = row.work?.find(entry => entry.assignment_id === step.assignment_id);
    return same.length > 1 && item ? `${base}, ${item.person?.display_name?.trim() || item.person?.pseudonym || item.author_label}` : base;
  }
  return step.action ? actionLabel(step.action) : "";
}

/** Annotate work of the current versions partly submitted, partly open: the card's partial agreement (`earlyFinal`). */
function annotationsOpen(row: Partial<Pick<DocumentRowView, "work" | "stages">>): boolean {
  if (row.stages?.annotation.state === "consolidating") return false;
  const work = (row.work ?? []).filter(item => item.task === "annotate" && item.moved_to_version == null);
  return work.some(item => item.status === "submitted") && work.some(item => item.status !== "submitted");
}

/** The row's lead-owned steps with an action, in the server's order (VD18); falls back to the next step. */
export function leadSteps(row: Pick<DocumentRowView, "next_step" | "steps">): NextStepView[] {
  const steps = row.steps?.length ? row.steps : row.next_step ? [row.next_step] : [];
  return steps.filter(step => step.owner.kind === "you" && step.action != null);
}
