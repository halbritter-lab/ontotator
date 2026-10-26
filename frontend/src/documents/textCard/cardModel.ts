/** The text card's path (U3): the state and tone of Translation, Annotation and Finalization, pure. */
import type { DocumentRowView } from "../../api/client";
import type { ProjectDocumentsQuery, Route } from "../../app/router";
import type { PathSegment, PathTone } from "../../ui/StagePath";
import { shortName, stageText } from "../stageLabels";

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

export function translationState(row: DocumentRowView): State {
  const cell = row.stages?.review;
  const state = cell?.state;
  if (row.is_source || state === "source") return { state: "source text", tone: "done" };
  if (state === "accepted") return { state: "accepted", tone: "done" };
  if (state === "not_planned" || cell?.detail.note === "review_off") return { state: "not reviewed, optional", tone: "optional" };
  if (state === "in_progress" || state === "re_review") {
    const people = (cell?.detail.people ?? []).map(shortName).join(", ");
    return { state: people ? `in review (${people})` : "in review", tone: "now" };
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
  const submitted = total > 0 ? `${done} of ${total} submitted` : cell?.state === "in_progress" || cell?.state === "paused" ? "in progress" : "submitted";
  switch (cell?.state) {
    case "not_planned": return { state: "not planned", tone: "optional" };
    case "after_review":
    case "blocked": return { state: "after translation review", tone: "later" };
    case "unassigned":
    case "partly_assigned":
    case "undecided": {
      // Never "0 of 0 assigned"; the proposal count is in the Annotation part (and the table's robot icon), not here.
      const assigned = detail.assigned ?? 0;
      return { state: assigned === 0 ? "Unassigned" : target > 0 ? `${assigned} of ${target} assigned` : `${assigned} assigned`, tone: "now" };
    }
    case "in_progress":
    case "paused": return { state: submitted, tone: "now" };
    case "submitted":
    case "consolidating": return { state: submitted, tone: "done" };
    case undefined:
    case "none": return { state: "—", tone: "later" };
    default: return { state: cellLabel(row, "annotation"), tone: "now" };
  }
}

/** "18 Oct" of an ISO time; null when there is none. */
function dayMonth(iso: string | null | undefined): string | null {
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
    case "after_review": return { state: "waiting", tone: "later" };
    // A preselected result (a submitted consolidation, the accept rule) waits for acceptance, not a comparison.
    case "choose": return cell.detail.label_rule === "accept" ? { state: "ready to accept", tone: "now" }
      : (cell.detail.submitted ?? 0) >= 2 ? { state: "ready to compare", tone: "now" } : { state: cellLabel(row, "final"), tone: "now" };
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

/** On open: the segment that needs work now; else the first that is not done; else Finalization. */
export function defaultSegment(segments: readonly PathSegment[]): SegmentId {
  const now = segments.find(s => s.tone === "now") ?? segments.find(s => s.tone === "later");
  return (now?.id ?? "finalization") as SegmentId;
}

/** The text view of a version (`variant`), with `show` / `compare`; keeps the Documents query for Back. */
export function textViewRoute(projectKey: string, caseId: string, documentId: string, query: ProjectDocumentsQuery, extra: { show?: string; compare?: string } = {}): Route {
  return { name: "projectCase", key: projectKey, caseId, variant: documentId, ...extra, ...(Object.keys(query).length ? { documents: query } : {}) };
}
