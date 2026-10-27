import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type PauseCandidate, type ProblemActionRequest, type ProblemReportView } from "../api/client";
import { personLabel } from "../app/submissionLabels";
import { Time } from "../app/Time";
import { Button, Checkbox, InlineConfirm, InlineMessage, Textarea, TextInput, type InlineConfirmOutcome } from "../ui";
import { historyItems, reporterName, taskLabel, type Intent } from "./labels";
import type { ReportLink } from "./LeadStatePanel";
import type { LeadReportState } from "./useLeadReport";

const ACTIONS: Record<Intent, ProblemActionRequest["action"]> = {
  resume_close: "resume", close: "resolve", release: "resume", pause: "extend_hold", restart: "restart", reopen: "reopen",
};

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const errorCode = (failure: unknown): string | undefined => failure instanceof ApiError ? failure.code : undefined;
function detailNumber(failure: unknown, key: string): number | null {
  if (!(failure instanceof ApiError) || !failure.details || typeof failure.details !== "object") return null;
  const value = (failure.details as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

/** Ids preselected in "Release pause": the only active pause, or the reporter's task when the route asked to resume it. */
export function releasePreselection(report: ProblemReportView, routeResume: boolean): number[] {
  const active = (report.holds ?? []).filter(h => h.active).map(h => h.assignment_id);
  if (active.length === 1) return active;
  if (routeResume && active.includes(report.assignment_id)) return [report.assignment_id];
  return [];
}

export interface LeadConfirmProps {
  intent: Intent;
  report: ProblemReportView;
  /** Final result label of the report's row ("None" when there is none). */
  finalText: string;
  /** Initial selection of "Release pause". */
  preselect?: number[];
  lead: Pick<LeadReportState, "candidates" | "candidatesError" | "candidatesLoading" | "loadCandidates" | "reload">;
  /** `request_id` per `[report_id, revision, action, reason, ids]`: Retry never applies twice. Owned by the page. */
  requests: Map<string, string>;
  /** Why the intent is unavailable now (for example after "Review again"); the confirm button then explains instead of sending. */
  unavailable: string | null;
  reportLink: ReportLink;
  onDone: (intent: Intent, before: ProblemReportView, after: ProblemReportView, released?: number[]) => void;
  onCancel: () => void;
}

/** The InlineConfirm of one lead intent (Close, Release pause, Pause other tasks, Agree empty restart, Reopen). */
export function LeadConfirm({ intent, report, finalText, preselect = [], lead, requests, unavailable, reportLink, onDone, onCancel }: LeadConfirmProps): JSX.Element {
  const id = useId();
  const reporter = reporterName(report);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>(intent === "release" ? preselect : []);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InlineConfirmOutcome | null>(null);
  const [conflictText, setConflictText] = useState<string>("");
  const [notice, setNotice] = useState<ReactNode>(null);
  const writing = useRef(false), alive = useRef(true);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (intent === "pause") lead.loadCandidates(); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeHolds = (report.holds ?? []).filter(h => h.active);

  const ids = (): number[] => {
    if (intent === "restart") return [report.assignment_id];
    if (intent === "release") return selected.filter(value => activeHolds.some(h => h.assignment_id === value));
    if (intent === "resume_close") return activeHolds.map(h => h.assignment_id);
    if (intent === "pause") return selected;
    return [];
  };

  const submit = async () => {
    if (writing.current) return;
    if (unavailable) return;
    const text = reason.trim();
    const chosen = ids();
    let invalid = false;
    if ((intent === "release" || intent === "pause") && !chosen.length) { setSelectionError("Choose at least one task."); invalid = true; }
    if (intent === "restart" && !agreed) { setAgreeError(`Confirm that you agreed the restart with ${reporter}.`); invalid = true; }
    if (!text) { setReasonError("Enter a reason."); reasonRef.current?.focus(); invalid = true; }
    if (invalid) return;
    // `request_id` per request content: a Retry replays a step that already applied instead of applying it twice.
    const send = (view: ProblemReportView, action: ProblemActionRequest["action"], ids: number[]) => {
      const key = JSON.stringify([view.report_id, view.revision, action, text, ids]);
      let requestId = requests.get(key);
      if (!requestId) { requestId = crypto.randomUUID(); requests.set(key, requestId); }
      return api.actOnProblemReport(view.report_id, { request_id: requestId, expected_revision: view.revision, action, reason: text, assignment_ids: ids });
    };
    writing.current = true; setBusy(true); setOutcome(null); setNotice(null);
    try {
      let after = await send(report, ACTIONS[intent], chosen);
      // "Close and resume": release the pauses, then close with the same outcome text.
      if (intent === "resume_close") after = await send(after, "resolve", []);
      if (alive.current) onDone(intent, report, after, intent === "release" || intent === "resume_close" ? chosen : undefined);
    } catch (failure) {
      if (!alive.current) return;
      const code = errorCode(failure);
      if (code === "WORKFLOW_REVISION_CONFLICT") {
        const fresh = await lead.reload();
        if (!alive.current) return;
        const newest = fresh ? [...(fresh.events ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).pop() : undefined;
        const items = fresh ? historyItems(fresh) : [];
        setConflictText(items.length > 1 ? items[items.length - 1]!.sentence : "");
        setOutcome({ kind: "conflict", changedBy: newest ? personLabel(newest.actor_label, newest.actor_label === fresh?.viewer_label, newest.actor) : null, changedAt: newest?.created_at ?? null,
          onReview: () => { setOutcome(null); void lead.reload(); } });
      } else if (code === "TASK_HELD") {
        const task = detailNumber(failure, "assignment_id") ?? report.assignment_id;
        // The other pause may be newer than this page: read it from a fresh view.
        const fresh = await lead.reload();
        if (!alive.current) return;
        const otherOf = (view: ProblemReportView | null) => (view?.holds ?? []).find(h => h.assignment_id === task && (h.other_active_holds?.length ?? 0) > 0)?.other_active_holds?.[0];
        const other = otherOf(fresh) ?? otherOf(report);
        setNotice(<>Task {task} is also paused by another report. Nothing changed. Release that pause first.{other && <> {reportLink(other.report_id, "Open report")}</>}</>);
      } else if (code === "ASSIGNMENT_NOT_FOUND") {
        const task = detailNumber(failure, "assignment_id") ?? chosen[0];
        setNotice(`Task ${task} is no longer available (revoked or moved). Nothing changed.`);
        if (intent === "pause") { setSelected([]); lead.loadCandidates(true); }
        else void lead.reload();
      } else if (code === "RESTART_AGREEMENT_REQUIRED") {
        setAgreed(false); setAgreeError(`Confirm that you agreed the restart with ${reporter}.`);
      } else if (code === "HOLD_TARGET_REQUIRED") {
        setSelectionError("Choose at least one task.");
      } else if (code === "REPORT_REASON_REQUIRED") {
        setReasonError("Enter a reason.");
      } else if (failure instanceof ApiError && failure.status === 401) {
        setOutcome({ kind: "session" });
      } else {
        setOutcome({ kind: "error", onRetry: () => { void submit(); } });
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const reasonField = (label: string, rows: number, hint?: ReactNode) => <Textarea ref={reasonRef} id={`${id}-reason`} label={label} rows={rows} required hint={hint}
    value={reason} readOnly={busy} error={reasonError ?? undefined}
    onChange={event => { setReason(event.target.value); setReasonError(null); }} />;
  const toggle = (value: number, checked: boolean) => {
    setSelectionError(null);
    setSelected(current => checked ? [...current.filter(x => x !== value), value] : current.filter(x => x !== value));
  };
  const selectionAlert = selectionError && <p id={`${id}-selection-error`} className="field-hint field-hint-error" role="alert">{selectionError}</p>;
  const noticeBlock = notice && <InlineMessage tone="error">{notice}</InlineMessage>;

  let title: string, message: ReactNode, confirmLabel: string, body: ReactNode, tone: "primary" | "danger" = "primary";
  switch (intent) {
    case "resume_close": {
      const paused = activeHolds.map(h => `Task ${h.assignment_id}`);
      title = `Close and resume ${paused.join(", ")}`;
      message = `${paused.join(", ")} can continue and the report closes. Pauses from other reports stay.`;
      confirmLabel = "Close and resume";
      body = reasonField(`Outcome for ${reporter}`, 4, `${reporter} sees this in the report.`);
      break;
    }
    case "close": {
      title = "Close report";
      const paused = activeHolds.map(h => `Task ${h.assignment_id}`);
      message = !paused.length ? "No task is paused by this report."
        : paused.length === 1 ? `${paused[0]} stays paused. Release it separately with Release pause.`
        : `${paused.slice(0, -1).join(", ")} and ${paused[paused.length - 1]} stay paused. Release them separately with Release pause.`;
      confirmLabel = "Close report";
      body = reasonField(`Outcome for ${reporter}`, 4, `${reporter} sees this in the report.`);
      break;
    }
    case "release": {
      title = "Release pause";
      message = "Lets the selected tasks continue. Pauses from other reports stay.";
      const n = ids().length;
      confirmLabel = n > 1 ? `Release ${n} pauses` : "Release pause";
      body = <>
        <fieldset className="lead-task-picker" aria-describedby={selectionError ? `${id}-selection-error` : undefined}>
          <legend>Paused by this report</legend>
          {activeHolds.map(hold => <Checkbox key={hold.hold_id} id={`${id}-release-${hold.assignment_id}`}
            label={taskLabel(hold)}
            hint={<>paused since <Time iso={hold.created_at} />{(hold.other_active_holds?.length ?? 0) > 0 && <>. Also paused by another report: stays paused</>}</>}
            checked={selected.includes(hold.assignment_id)} readOnly={busy}
            onChange={event => { if (!busy) toggle(hold.assignment_id, event.target.checked); }} />)}
          {selectionAlert}
        </fieldset>
        {reasonField("Reason", 3, "Recorded in the history. The reporter sees it.")}
      </>;
      break;
    }
    case "pause": {
      title = "Pause other tasks";
      message = "Stops work on the selected tasks. Their owners see only your reason, not this report.";
      const n = selected.length;
      confirmLabel = n ? `Pause ${n} ${plural(n, "task", "tasks")}` : "Pause tasks";
      const all = lead.candidates ?? [];
      const sameText = all.filter(c => c.same_text);
      const query = search.trim().toLowerCase();
      const others = query ? all.filter(c => !c.same_text && (c.case_id.toLowerCase().startsWith(query) || c.owner_label.toLowerCase().includes(query) || !!c.owner?.display_name?.toLowerCase().includes(query))) : [];
      const row = (candidate: PauseCandidate) => {
        const paused = candidate.paused_by_this_report;
        const label = `${taskLabel(candidate)}${candidate.reporter_task && !paused ? " (reporter's task)" : ""}`;
        return <Checkbox key={candidate.assignment_id} id={`${id}-pause-${candidate.assignment_id}`} label={label}
          hint={paused ? "Already paused by this report" : undefined}
          aria-disabled={paused || undefined} checked={!paused && selected.includes(candidate.assignment_id)} readOnly={busy}
          onChange={event => { if (!paused && !busy) toggle(candidate.assignment_id, event.target.checked); }} />;
      };
      body = <>
        {lead.candidatesLoading && <InlineMessage tone="info">Loading tasks…</InlineMessage>}
        {lead.candidatesError !== undefined && !lead.candidatesLoading && <InlineMessage tone="error">Could not load the tasks. <Button size="sm" onClick={() => lead.loadCandidates(true)}>Retry</Button></InlineMessage>}
        {lead.candidates && <>
          <fieldset className="lead-task-picker">
            <legend>Same text: {report.case_id}</legend>
            {sameText.length ? sameText.map(row) : <p>No other task on this text.</p>}
          </fieldset>
          <fieldset className="lead-task-picker">
            <legend>Other tasks in this project</legend>
            <TextInput id={`${id}-search`} label="Search other tasks" hint="Text ID or person" value={search} onChange={event => setSearch(event.target.value)} />
            {query && (others.length ? others.map(row) : <p>No task matches.</p>)}
          </fieldset>
          {selectionAlert}
        </>}
        {reasonField("Reason shown to the task owners", 3, "They do not see this report.")}
      </>;
      break;
    }
    case "restart": {
      title = `Agree empty restart of Task ${report.assignment_id}`;
      const current = report.current_round_ordinal;
      tone = "danger";
      confirmLabel = "Restart with empty round";
      message = <ul className="lead-restart-facts">
        <li>{current == null ? "The current round is abandoned and kept; a new empty round starts." : `Round ${current} is abandoned and kept; Round ${current + 1} starts empty.`}</li>
        <li>{report.task === "translation_review"
          ? "The current translation draft is kept in the report history; the text and form start fresh."
          : "The new round has no earlier or machine findings."}</li>
        <li>This report closes; its pause on Task {report.assignment_id} is released.</li>
        <li>Final result stays: {finalText}.</li>
      </ul>;
      body = <>
        <Checkbox id={`${id}-agreed`} label={`I agreed this restart with ${reporter}`} required checked={agreed} readOnly={busy}
          aria-describedby={agreeError ? `${id}-agreed-error` : undefined}
          onChange={event => { if (!busy) { setAgreed(event.target.checked); setAgreeError(null); } }} />
        {agreeError && <p id={`${id}-agreed-error`} className="field-hint field-hint-error" role="alert">{agreeError}</p>}
        {reasonField(`Reason (becomes the outcome ${reporter} sees)`, 3)}
      </>;
      break;
    }
    case "reopen": {
      title = "Reopen report";
      message = "The report becomes open again. No task is paused again.";
      confirmLabel = "Reopen report";
      body = reasonField("Reason", 3, `Recorded in the history. ${reporter} sees it.`);
      break;
    }
  }

  return <InlineConfirm title={title} message={message} confirmLabel={confirmLabel} tone={tone} busy={busy} headingLevel={3}
    onConfirm={() => { void submit(); }} onCancel={onCancel} outcome={outcome}
    conflictMessage={<>This report changed since you opened it. Nothing was saved.{conflictText && <> {conflictText}</>}</>}
    confirmUnavailable={unavailable ? { reason: unavailable } : null}>
    {body}
    {noticeBlock}
  </InlineConfirm>;
}
