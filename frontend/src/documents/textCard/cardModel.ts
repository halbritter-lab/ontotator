/** The text card's path (U3): the state and tone of Translation, Annotation and Finalization, pure. */
import type { DocumentRowView, NextStepView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import type { PathSegment, PathTone } from "../../ui/StagePath";
import { earlyFinal } from "../finalPanelText";
import { annotatorCount, shortName, stageText, startedOf, startedPart, submittedOf } from "../stageLabels";

export type SegmentId = "translation" | "annotation" | "finalization";
export type CardView = "path" | "history" | "details";

/** A work item of a row (with its assignment date and annotation mode). */
export type CardWorkItem = DocumentRowView["work"][number];

type State = { state: string; tone: PathTone };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The short label of the stage cell (`stageText`), "—" without a cell. */
function cellLabel(row: DocumentRowView, stage: "review" | "annotation" | "final"): string {
  const cell = row.stages?.[stage];
  return cell ? stageText(stage, cell, row).word : "—";
}

/**
 * A running review without the people: "in review", "in review, 1 of 2 started", or "assigned, not started" while
 * no reviewer has saved anything yet (issue 258); null when no review runs.
 */
export function reviewWord(row: DocumentRowView): string | null {
  const cell = row.stages?.review;
  if (cell?.state !== "in_progress" && cell?.state !== "re_review") return null;
  if (startedOf(cell.detail) === "none") return "assigned, not started";
  const part = startedPart(cell.detail);
  return part ? `in review, ${part}` : "in review";
}

export function translationState(row: DocumentRowView): State {
  const cell = row.stages?.review;
  const state = cell?.state;
  if (row.is_source || state === "source") return { state: "source text", tone: "done" };
  if (state === "accepted") return { state: "accepted", tone: "done" };
  if (state === "not_planned" || cell?.detail.note === "review_off") return { state: "not reviewed, optional", tone: "optional" };
  const word = reviewWord(row);
  if (word) {
    const people = (cell?.detail.people ?? []).map(shortName).join(", ");
    return { state: people ? `${word} (${people})` : word, tone: "now" };
  }
  if (!cell || state === "none") return { state: "—", tone: "later" };
  return { state: cellLabel(row, "review"), tone: "now" };
}

export function annotationState(row: DocumentRowView): State {
  const cell = row.stages?.annotation;
  const detail = cell?.detail ?? {};
  const target = detail.target ?? detail.total ?? 0;
  // The server may send no counts: count the row's annotate work items; without any, no count.
  const work = (row.work ?? []).filter(item => item.task === "annotate" && item.moved_to_version == null);
  const total = detail.total ?? detail.target ?? work.length;
  const done = detail.submitted ?? work.filter(item => item.status === "submitted").length;
  const working = cell?.state === "in_progress" || cell?.state === "paused";
  const submitted = total > 0 ? submittedOf(done, total) : working ? "in progress" : "submitted";
  // Issue 258: assigned annotators who have not saved anything yet.
  const started = cell?.state === "in_progress" ? startedOf(detail) : "all";
  const running = started === "none" && done === 0 ? "assigned, not started"
    : started === "all" ? submitted : `${submitted}, ${startedPart(detail)}`;
  switch (cell?.state) {
    case "not_planned": return { state: "not planned", tone: "optional" };
    case "after_review":
    case "blocked": {
      // People here hold a task that opens once the review is accepted (issue 213).
      const people = (detail.people ?? []).map(shortName).join(", ");
      return { state: people ? `waiting for review (${people})` : "after translation review", tone: "later" };
    }
    case "unassigned":
    case "partly_assigned":
    case "undecided": {
      // Never "0 of 0 assigned"; the proposal count is in the Annotation part (and the table's robot icon), not here.
      const assigned = detail.assigned ?? 0;
      return { state: target > 1 ? annotatorCount(assigned, target) : assigned === 0 ? "Unassigned" : `${assigned} assigned`, tone: "now" };
    }
    case "in_progress": return { state: running, tone: "now" };
    case "paused": return { state: submitted, tone: "now" };
    case "submitted":
    case "consolidating": return { state: submitted, tone: "done" };
    case undefined:
    case "none": return { state: "—", tone: "later" };
    default: return { state: cellLabel(row, "annotation"), tone: "now" };
  }
}

/** "18 Oct" of an ISO time; null when there is none. */
export function dayMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function finalizationState(row: DocumentRowView, _now: Date): State {
  const cell = row.stages?.final;
  if (row.stages?.annotation.state === "consolidating") {
    const progress = row.consolidation_progress;
    return { state: progress ? `consolidating (${progress.open} of ${progress.total} groups open)` : "consolidating", tone: "now" };
  }
  switch (cell?.state) {
    case undefined:
    case "none":
    case "after_annotation":
    case "after_review":
      // "Annotators per text" is an upper limit (issue 123): a submitted annotation can be accepted while others run.
      return cell?.state === "after_annotation" && earlyFinal(row) ? { state: "can be accepted", tone: "now" } : { state: "waiting", tone: "later" };
    // A preselected result (a submitted consolidation, the accept rule) or full agreement waits for acceptance, not a comparison.
    case "choose": return (cell.detail.submitted ?? 0) < 2 ? { state: cellLabel(row, "final"), tone: "now" }
      : { state: cell.detail.label_rule === "accept" || (cell.detail.all_match && !earlyFinal(row)) ? "ready to accept" : "ready to compare", tone: "now" };
    case "confirm": return { state: "ready to accept", tone: "now" };
    case "final": {
      const day = dayMonth(row.final?.selected_at ?? cell.detail.at);
      return { state: day ? `accepted ${day}` : "accepted", tone: "done" };
    }
    default: return { state: cellLabel(row, "final"), tone: "now" };
  }
}

export function cardSegments(row: DocumentRowView, now = new Date()): PathSegment[] {
  return [
    { id: "translation", title: "Translation", ...translationState(row) },
    { id: "annotation", title: "Annotation", ...annotationState(row) },
    // Without annotation there is nothing to finalize: an off step, like the others (dashed in the path).
    { id: "finalization", title: "Finalization", ...(row.stages?.annotation.state === "not_planned" && !row.final ? { state: "—", tone: "optional" as const } : finalizationState(row, now)) },
  ];
}

/** Where a lead step of the card sits (issue 332): the report banner, else the part of its stage. */
export type StepPlace = "report" | SegmentId;

const STAGE_SEGMENT: Readonly<Record<NextStepView["stage"], SegmentId | null>> = { translation_review: "translation", annotation: "annotation", final: "finalization", done: null };
const TASK_SEGMENT: Readonly<Record<CardWorkItem["task"], SegmentId>> = { translation_review: "translation", annotate: "annotation", review: "finalization" };

/**
 * The place of a lead step in the text card: "Decide on report…" in the banner of the open report (when the card shows
 * one), every other step in the part of its stage ("Resolve…" in Translation, "Carry to v2…" and "Resume task…" of a
 * paused annotation in Annotation); a step without a stage goes to the part of its task, else Finalization.
 */
export function stepPlace(row: DocumentRowView, step: NextStepView): StepPlace {
  if (step.action === "decide_report" && (row.problem_reports ?? []).some(report => report.state === "open")) return "report";
  const stage = STAGE_SEGMENT[step.stage];
  if (stage) return stage;
  const item = step.assignment_id != null ? row.work.find(entry => entry.assignment_id === step.assignment_id) : undefined;
  return item ? TASK_SEGMENT[item.task] : "finalization";
}

/** On open: the segment that needs work now; else the first that is not done; else Finalization, or Annotation when nothing is planned to finalize. */
export function defaultSegment(segments: readonly PathSegment[], preferred?: SegmentId | null): SegmentId {
  // The part that holds the row's first lead step (issue 332): its button is where the card opens.
  if (preferred && segments.some(s => s.id === preferred)) return preferred;
  const now = segments.find(s => s.tone === "now") ?? segments.find(s => s.tone === "later");
  if (now) return now.id as SegmentId;
  return segments.find(s => s.id === "finalization")?.tone === "optional" ? "annotation" : "finalization";
}

/** The text view of a version (`variant`), with `show` / `compare`; keeps the Documents query for Back. */
export function textViewRoute(projectKey: string, caseId: string, documentId: string, query: ProjectDocumentsQuery, extra: { show?: string; compare?: string } = {}): Route {
  return { name: "projectCase", key: projectKey, caseId, variant: documentId, ...extra, ...(Object.keys(query).length ? { documents: query } : {}) };
}
