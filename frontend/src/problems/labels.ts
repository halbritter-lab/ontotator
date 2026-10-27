/**
 * All user-visible problem report wording (reporter dialog, lead page, timeline).
 * Pure functions, no React. UI vocabulary: "Open" / "Closed" / "Withdrawn" for the report,
 * "Paused" / "Resumed" / "Restarted" for tasks; never "hold" or "resolve" in UI text.
 */
import type { ProblemReportView, ReportEventView, ReportHoldView } from "../api/client";
import { textLabel, type PersonRef } from "../app/identity";
import { formatTime, personLabel } from "../app/submissionLabels";
import type { StatusTone } from "../ui";

interface TaskIdentity { assignment_id: number; owner_label: string; owner?: PersonRef | null }

type Ref = PersonRef | null | undefined;

/** A task owner: "Ana Weber (ann-0004)" when the view carries a display name (leads), else the pseudonym. */
function ownerName(t: TaskIdentity): string {
  return personLabel(t.owner_label, false, t.owner);
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "A", "A and B", "A, B and C". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const holdsOf = (r: ProblemReportView): ReportHoldView[] => r.holds ?? [];
const activeHolds = (r: ProblemReportView): ReportHoldView[] => holdsOf(r).filter(h => h.active);
const byCreatedAt = (a: { created_at: string }, b: { created_at: string }): number => Date.parse(a.created_at) - Date.parse(b.created_at);

/** The reporter's own task: its hold (owner label) when present, else the report's own fields. */
function reporterTask(r: ProblemReportView): TaskIdentity {
  const own = holdsOf(r).find(h => h.assignment_id === r.assignment_id);
  return { assignment_id: r.assignment_id, owner_label: own?.owner_label ?? r.reporter_label, owner: own ? own.owner : r.reporter };
}

/** The reporter as a lead reads them: "Ana Weber (ann-0004)"; other viewers keep the pseudonym. */
export function reporterName(r: ProblemReportView): string {
  if (!r.viewer_is_lead) return r.reporter_label;
  return personLabel(r.reporter_label, false, r.reporter);
}

/** First line of the report text, cut at `max` characters at a word boundary with an ellipsis. */
export function reportTitle(text: string, max = 80): string {
  const line = (text.split(/\r?\n/, 1)[0] ?? "").trim();
  if (line.length <= max) return line;
  if (line[max] === " ") return `${line.slice(0, max).trimEnd()}…`;
  const head = line.slice(0, max);
  const boundary = head.lastIndexOf(" ");
  return `${(boundary > 0 ? head.slice(0, boundary) : head).trimEnd()}…`;
}

export function reportStateBadge(r: ProblemReportView): { text: "Open" | "Closed" | "Withdrawn"; tone: StatusTone } {
  if (r.state === "resolved") return { text: "Closed", tone: "success" };
  if (r.state === "withdrawn") return { text: "Withdrawn", tone: "neutral" };
  return { text: "Open", tone: "info" };
}

/** A person as the viewer reads it inside a sentence: "you" (reporter view); in lead view "Ana Weber (ann-0004)" or "lead-0002 (you)". */
function personInText(r: ProblemReportView, label: string, ref?: Ref): string {
  if (r.viewer_is_lead) return personLabel(label, label === r.viewer_label, ref);
  return label === r.viewer_label ? "you" : label;
}

/** "Open" | "Closed by ann-0002, 19 Oct, 01:31" | "Withdrawn by you, …". */
export function reportStateFact(r: ProblemReportView, now?: Date): string {
  const { text } = reportStateBadge(r);
  if (r.state === "open") return text;
  const by = r.state_changed_by_label ? ` by ${personInText(r, r.state_changed_by_label, r.state_changed_by)}` : "";
  const at = r.state_changed_at ? `, ${formatTime(r.state_changed_at, { now })}` : "";
  return `${text}${by}${at}`;
}

/** "Task 4, ann-0004, accepted-translation, de"; with a display name (leads) "Task 4, Ana Weber (ann-0004), …". */
export function taskLabel(t: TaskIdentity & { case_id: string; language: string }): string {
  return `Task ${t.assignment_id}, ${taskOwnerText(t)}`;
}

/** The owner and text of a task without its number: "Ana Weber (ann-0004), accepted-translation de". */
export function taskOwnerText(t: TaskIdentity & { case_id: string; language: string }): string {
  return `${ownerName(t)}, ${textLabel(t)}`;
}

/** Running-text reference: "Task 4 (ann-0004)"; with a display name "Task 4, Ana Weber (ann-0004)" (never nested parentheses). */
export function taskRef(t: TaskIdentity): string {
  const name = ownerName(t);
  return name === t.owner_label ? `Task ${t.assignment_id} (${t.owner_label})` : `Task ${t.assignment_id}, ${name}`;
}

export type TaskFactKind = "paused" | "repaused" | "resumed" | "restarted" | "withdrawn" | "unknown-release";

/** State of this report's pause on the reporter's own task (reporter dialog, "Your task"). */
export function yourTaskFact(r: ProblemReportView): { kind: TaskFactKind; text: string; at: string | null } {
  const own = holdsOf(r).filter(h => h.assignment_id === r.assignment_id).sort(byCreatedAt);
  const newest = own[own.length - 1];
  if (!newest) return { kind: "unknown-release", text: "Released (no record of who released it)", at: null };
  if (newest.active) {
    return own.length > 1
      ? { kind: "repaused", text: `Paused again by ${newest.created_by_label}`, at: newest.created_at }
      : { kind: "paused", text: "Paused since", at: newest.created_at };
  }
  const at = newest.released_at ?? null;
  switch (newest.release_action) {
    case "restart": {
      const ordinal = (r.events ?? []).find(e => e.event_id === newest.release_event_id)?.round_ordinal;
      return { kind: "restarted", text: ordinal == null ? "Restarted with an empty round" : `Restarted with an empty Round ${ordinal}`, at };
    }
    case "withdraw":
      return { kind: "withdrawn", text: "Resumed when you withdrew the report", at };
    case "resume":
      return { kind: "resumed", text: newest.released_by_label === r.reporter_label || !newest.released_by_label ? "Resumed by you" : `Resumed by ${newest.released_by_label}`, at };
    default:
      return { kind: "unknown-release", text: "Released (no record of who released it)", at };
  }
}

export interface HistoryItem {
  key: string;
  sentence: string;
  at: string;
  quoteLabel?: "Reason" | "Outcome" | "Reason shown to their owners";
  quote?: string;
  draft?: { text?: string; form?: Record<string, unknown> };
}

function draftOf(e: ReportEventView): HistoryItem["draft"] {
  const raw = e.abandoned_translation_draft;
  if (!raw || typeof raw !== "object") return undefined;
  const draft: NonNullable<HistoryItem["draft"]> = {};
  if (typeof raw.text === "string") draft.text = raw.text;
  if (raw.form && typeof raw.form === "object" && !Array.isArray(raw.form)) draft.form = raw.form as Record<string, unknown>;
  return draft.text === undefined && draft.form === undefined ? undefined : draft;
}

/** Tasks an event names in lead view; an event with no `affected` list but `own_task` names the reporter's task. */
function eventTasks(r: ProblemReportView, e: ReportEventView): TaskIdentity[] {
  if (e.affected?.length) return e.affected;
  return e.own_task ? [reporterTask(r)] : [];
}

function eventSentence(r: ProblemReportView, e: ReportEventView, actor: string): Omit<HistoryItem, "key" | "at"> | null {
  const lead = r.viewer_is_lead;
  const reason = e.reason ?? undefined;
  const withReason = (sentence: string, quoteLabel: HistoryItem["quoteLabel"] = "Reason"): Omit<HistoryItem, "key" | "at"> =>
    reason ? { sentence, quoteLabel, quote: reason } : { sentence };
  const tasks = eventTasks(r, e);
  const refs = joinList(tasks.map(taskRef));
  switch (e.action) {
    case "resume": {
      if (!lead) {
        if (!e.own_task) return null; // only other tasks: never shown to the reporter
        return withReason(e.actor_label === r.reporter_label ? "You resumed your task." : `${actor} released the pause on your task.`);
      }
      if (!tasks.length) return withReason(`${actor} released a pause.`);
      const ownOnly = tasks.every(t => t.owner_label === e.actor_label);
      return withReason(ownOnly ? `${actor} resumed ${refs}.` : `${actor} released the pause on ${refs}.`);
    }
    case "resolve":
      return withReason(`${actor} closed the report.`, "Outcome");
    case "extend_hold": {
      if (!lead) return e.own_task ? withReason(`${actor} paused your task again.`) : null;
      const label = "Reason shown to their owners";
      return withReason(`${actor} paused ${tasks.length ? refs : "other tasks"}.${reason ? ` ${label}:` : ""}`, label);
    }
    case "restart": {
      const next = e.round_ordinal == null ? null : `Round ${e.round_ordinal}`;
      const prior = e.abandoned_round_ordinal == null ? null : `Round ${e.abandoned_round_ordinal}`;
      const sentence = lead
        ? `${actor} agreed an empty restart of Task ${r.assignment_id}. ${prior ?? "The previous round"} abandoned and kept; ${next ?? "A new round"} started empty. Report closed.`
        : `${actor} restarted your task with an empty ${next ?? "round"}. ${prior ?? "The previous round"} is kept. Report closed.`;
      const item = withReason(sentence, "Outcome");
      const draft = draftOf(e);
      return draft ? { ...item, draft } : item;
    }
    case "withdraw": {
      let resumed = "";
      if (lead && e.affected?.length) resumed = ` ${joinList(e.affected.map(t => `Task ${t.assignment_id}`))} resumed.`;
      if (!lead && e.own_task) resumed = " Your task resumed.";
      return withReason(`${actor} withdrew the report.${resumed}`);
    }
    case "reopen":
      return withReason(`${actor} reopened the report.`);
    default:
      return withReason(`${actor} recorded "${e.action}".`);
  }
}

/** Timeline items, oldest first, creation first; wording and redaction follow `r.viewer_is_lead`. */
export function historyItems(r: ProblemReportView): HistoryItem[] {
  const actorOf = (label: string, ref?: Ref): string => {
    if (r.viewer_is_lead) return personLabel(label, label === r.viewer_label, ref);
    return label === r.reporter_label ? "You" : label;
  };
  const created: HistoryItem = r.viewer_is_lead
    ? { key: "created", at: r.created_at ?? "", sentence: `${actorOf(r.reporter_label, r.reporter)} reported the problem. Task ${r.assignment_id} paused.` }
    : { key: "created", at: r.created_at ?? "", sentence: "You reported the problem. Your task paused." };
  const events = [...(r.events ?? [])].sort(byCreatedAt);
  const items = events.flatMap(e => {
    const item = eventSentence(r, e, actorOf(e.actor_label, e.actor));
    return item ? [{ key: e.event_id, at: e.created_at, ...item }] : [];
  });
  return [created, ...items];
}

/** Toolbar "Report a text problem" badge and the visually hidden part of its accessible name. */
export function toolbarEntry(reports: ProblemReportView[] | null, held: boolean): { badge: string | null; paused: boolean; accessibleSuffix: string } {
  const open = (reports ?? []).filter(r => r.state === "open").length;
  const openText = `${open} open`;
  const openReports = `${open} open ${plural(open, "report", "reports")}`;
  if (held) {
    return { badge: open ? `Paused, ${openText}` : "Paused", paused: true, accessibleSuffix: open ? `Task paused, ${openReports}` : "Task paused" };
  }
  if (open) return { badge: openText, paused: false, accessibleSuffix: openReports };
  return { badge: null, paused: false, accessibleSuffix: "for this task" };
}

export type Intent = "resume_close" | "close" | "release" | "pause" | "restart" | "reopen";

function stateReason(r: ProblemReportView): string | null {
  if (r.state === "resolved") return "The report is closed.";
  if (r.state === "withdrawn") return "The report is withdrawn.";
  return null;
}

/**
 * Labels, consequence lines and unavailability reasons of the lead intents. The page shows only the available ones;
 * the reason still guards a confirmation that was open when the intent became unavailable.
 */
export function intentState(r: ProblemReportView): Record<Intent, { label: string; consequence: string; unavailable: string | null }> {
  const active = activeHolds(r);
  const blockedByState = stateReason(r);
  const paused = joinList(active.map(h => `Task ${h.assignment_id}`));
  const stays = active.length === 1 ? "stays paused until you release it" : "stay paused until you release them";
  const otherReportPauses = holdsOf(r).some(h => h.assignment_id === r.assignment_id && (h.other_active_holds?.length ?? 0) > 0);
  const stayedState = r.state === "resolved" ? "The report stays closed." : r.state === "withdrawn" ? "The report stays withdrawn." : "The report stays open.";
  return {
    // R-16: the common outcome, one step, the answer to the reporter in the same card.
    resume_close: {
      label: `Close and resume ${paused}`,
      consequence: `Lets ${paused} continue and closes the report.`,
      unavailable: blockedByState ?? (active.length ? null : "No task is paused by this report."),
    },
    close: {
      label: active.length ? "Close, keep paused…" : "Close report…",
      consequence: active.length ? `${paused} ${stays}.` : `Records your answer for ${reporterName(r)}.`,
      unavailable: blockedByState,
    },
    release: {
      // A closed report that still pauses tasks has this one step left: it names the tasks.
      label: r.state === "open" ? "Release pause…" : `Release pause on ${paused}…`,
      consequence: `Lets ${r.state === "open" ? "the selected tasks" : paused} continue. ${stayedState}`,
      unavailable: active.length ? null : "No task is paused by this report.",
    },
    pause: {
      label: "Pause other tasks…",
      consequence: "Owners see your reason, not this report.",
      unavailable: blockedByState,
    },
    restart: {
      label: "Agree empty restart…",
      consequence: `Task ${r.assignment_id} starts with an empty round; the report closes.`,
      unavailable: blockedByState ?? (otherReportPauses ? `Task ${r.assignment_id} is also paused by another report. Release that pause first.` : null),
    },
    reopen: {
      label: "Reopen report…",
      consequence: "Makes it open again; nothing is paused again.",
      unavailable: r.state === "open" ? "The report is open." : null,
    },
  };
}

/** Success message after a lead action: what changed and what did not, from the views before and after. */
export function leadOutcome(intent: Intent, before: ProblemReportView, after: ProblemReportView, released?: number[]): string {
  const afterActive = activeHolds(after);
  const stillState = after.state === "resolved" ? "The report is still closed." : after.state === "withdrawn" ? "The report is still withdrawn." : "The report is still open.";
  switch (intent) {
    case "close": {
      if (!afterActive.length) return "Report closed. No task is paused by it any more. The final result did not change.";
      const tasks = joinList(afterActive.map(h => `Task ${h.assignment_id}`));
      return afterActive.length === 1
        ? `Report closed. ${tasks} is still paused by this report; release it when work can continue.`
        : `Report closed. ${tasks} are still paused by this report; release them when work can continue.`;
    }
    case "resume_close":
    case "release": {
      const ids = released ?? activeHolds(before).filter(h => !afterActive.some(a => a.hold_id === h.hold_id)).map(h => h.assignment_id);
      const tasks = ids.map(id => holdsOf(after).find(h => h.assignment_id === id) ?? holdsOf(before).find(h => h.assignment_id === id) ?? { assignment_id: id, owner_label: "" });
      const refs = joinList(tasks.map(t => (t.owner_label ? taskRef(t) : `Task ${t.assignment_id}`)));
      const elsewhere = ids
        .filter(id => holdsOf(after).some(h => h.assignment_id === id && (h.other_active_holds?.length ?? 0) > 0))
        .map(id => ` Task ${id} is still paused by another report.`)
        .join("");
      if (intent === "resume_close") return `Report closed. Released ${plural(ids.length, "the pause", "the pauses")} on ${refs}. The final result did not change.${elsewhere}`;
      return `Released ${plural(ids.length, "the pause", "the pauses")} on ${refs}. ${stillState}${elsewhere}`;
    }
    case "pause": {
      const wasActive = new Set(activeHolds(before).map(h => h.hold_id));
      const added = afterActive.filter(h => !wasActive.has(h.hold_id));
      return `Paused ${joinList(added.map(taskRef))}. Their owners see your reason. ${stillState}`;
    }
    case "restart": {
      const restart = [...(after.events ?? [])].sort(byCreatedAt).filter(e => e.action === "restart").pop();
      const next = restart?.round_ordinal ?? after.current_round_ordinal;
      const prior = restart ? restart.abandoned_round_ordinal : before.current_round_ordinal;
      const started = next == null ? "an empty round" : `an empty Round ${next}`;
      const kept = prior == null ? "The previous round" : `Round ${prior}`;
      return `Task ${after.assignment_id} restarted with ${started}. ${kept} is kept in the history. Report closed. The final result did not change.`;
    }
    case "reopen":
      return "Report reopened. No task was paused again.";
  }
}

const CONFLICT_REASONS: Record<string, string> = {
  REPORT_RESOLVED: "The report was closed in the meantime.",
  REPORT_WITHDRAWN: "The report was withdrawn in the meantime.",
  REPORT_OPEN: "The report is already open.",
  REPORT_LEAD_ACTED: "A project lead has already acted on this report, so it can no longer be withdrawn. Resume your task with a reason and ask a project lead to close the report.",
};

/** Sentence for a `WORKFLOW_REVISION_CONFLICT` `details.reason` of a report action; null for other reasons. */
export function conflictReasonText(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? CONFLICT_REASONS[reason] ?? null : null;
}

/** The task's banner for an answered report (R-26): "Your problem report was answered: Source fixed. You can continue." */
export function answerNotice(r: ProblemReportView, held: boolean): string {
  const last = historyItems(r).at(-1);
  const outcome = (r.state === "resolved" && r.resolution ? r.resolution : last?.quote ?? last?.sentence ?? reportStateFact(r)).trim().replace(/\.$/, "");
  return `Your problem report was answered: ${outcome}.${held ? "" : " You can continue."}`;
}
