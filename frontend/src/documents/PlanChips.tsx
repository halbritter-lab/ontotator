/**
 * Inline plan chips of a Documents row (spec "Inline plan chips (D18)"): one click toggles a flag
 * and saves it at once with an Undo toast (D22). Saves are serialised per case and each uses the
 * latest plan revision this page has seen for the case. Confirmations (consequences, the
 * external-review acceptance, an Undo that would withdraw new work) open inline below the row.
 */
import { useCallback, useId, useRef, useState } from "react";
import { api, ApiError, type ConsequencesView, type DocumentRowView, type PersonRefView, type PlanRowPatch, type UndoView } from "../api/client";
import { textLabel } from "../app/identity";
import { plural } from "../app/labels";
import { errorMessage } from "../admin/errors";
import { Button, Checkbox, InlineConfirm, InlineMessage, PlanChip, Textarea, type ToastMessage } from "../ui";
import { runPlanUndo } from "./planUndo";
import { documentsGroupId, documentsNotInPlanId } from "./RowCells";

export type PlanFlag = "review" | "annotate";
export interface PlanFlagState { review: boolean; annotate: boolean }

export const PLAN_CHANGED_MESSAGE = "This plan changed. Reloaded the current plan.";
export const UNDO_WITHDRAWN_NOTE = "Undo restores the plan, not withdrawn tasks.";
export const WITHDRAW_CHECKBOX = "I understand — withdraw the open tasks";
export const ACCEPT_EXTERNAL_LABEL = "This translation was reviewed outside Ontotator — accept it as it is";
export const ACCEPTANCE_RECORDED = "The acceptance is recorded with your name, the reason and the time.";

const TASK_NAMES: Readonly<Record<string, [string, string]>> = {
  translation_review: ["open translation review", "open translation reviews"],
  annotate: ["open annotation", "open annotations"],
  review: ["open consolidation", "open consolidations"],
};

/** "Ana Weber, ann-0004" (consequence lines put the person in parentheses). */
const personText = (person: PersonRefView): string => (person.display_name?.trim() ? `${person.display_name.trim()}, ${person.pseudonym}` : person.pseudonym);

/** Withdrawn tasks per task kind: "1 open annotation" and "(Annotator, ann-0004; draft kept)". */
function withdrawnParts(consequences: ConsequencesView, drafts: boolean): { noun: string; people: string }[] {
  const parts: { noun: string; people: string }[] = [];
  for (const task of Object.keys(TASK_NAMES)) {
    const items = consequences.withdrawn.filter(item => item.task === task);
    if (!items.length) continue;
    const people = [...new Set(items.map(item => personText(item.person)))].join(", ");
    const [one, many] = TASK_NAMES[task];
    const kept = drafts && task !== "translation_review" ? (items.length === 1 ? "; draft kept" : "; drafts kept") : "";
    parts.push({ noun: `${items.length} ${items.length === 1 ? one : many}`, people: `(${people}${kept})` });
  }
  return parts;
}

/** "1 open translation review (Ana Weber, ann-0004)" per task, joined with "; " (Undo conflict, D22). */
export function withdrawnSummary(consequences: ConsequencesView): string {
  return withdrawnParts(consequences, false).map(part => `${part.noun} ${part.people}`).join("; ");
}

/** Consequence lines of one plan change (spec "Editing after work started"). */
export function consequenceLines(consequences: ConsequencesView): string[] {
  const lines = withdrawnParts(consequences, true).map(part => `${part.noun} will be withdrawn ${part.people}.`);
  const finals = consequences.finals_leaving;
  if (finals.length) lines.push(`${plural(finals.length, "final result")} (${finals.map(item => textLabel(item)).join(", ")}) ${finals.length === 1 ? "stays" : "stay"} in history but ${finals.length === 1 ? "is" : "are"} no longer exported.`);
  for (const item of consequences.restored) lines.push(`${item.language} of ${item.case_id} returns to the plan. Its earlier final result needs your confirmation.`);
  const reports = consequences.open_reports ?? [];
  if (reports.length) lines.push(`${plural(reports.length, "open problem report")} (${reports.map(item => `${textLabel(item)}${item.held ? ", task paused" : ""}`).join(", ")}) ${reports.length === 1 ? "stays" : "stay"} open under Problem reports.`);
  return lines;
}

/** One chip save; kept for Retry, the confirmation and the acceptance. */
interface PlanRequest {
  caseId: string;
  language: string;
  flag: PlanFlag;
  value: boolean;
  groupRevision: number;
}

export type PlanNotice =
  | { kind: "confirm"; request: PlanRequest; consequences: ConsequencesView }
  | { kind: "accept"; request: PlanRequest }
  | { kind: "undo_conflict"; undo: UndoView; consequences: ConsequencesView }
  | { kind: "changed" }
  | { kind: "error"; error: unknown; retry: () => void };

export interface PlanSavesOptions {
  projectKey: string;
  /** The page's one shared polite live region. */
  onAnnounce: (message: string) => void;
  /** A save or undo changed the plan (or it changed elsewhere): refetch the rows. */
  onChanged: () => void;
  showToast: (toast: Omit<ToastMessage, "id">) => void;
}

export interface PlanSaves {
  flagsOf: (row: DocumentRowView, groupRevision: number) => PlanFlagState;
  isBusy: (row: Pick<DocumentRowView, "case_id" | "language">, flag: PlanFlag) => boolean;
  toggle: (row: DocumentRowView, flag: PlanFlag, groupRevision: number) => void;
  noticeOf: (row: Pick<DocumentRowView, "case_id" | "language">) => PlanNotice | null;
  /** A save on this page decided the row (its local flags stand until the rows refetch). */
  decidedLocally: (row: Pick<DocumentRowView, "case_id" | "language">) => boolean;
  sending: (row: Pick<DocumentRowView, "case_id" | "language">) => boolean;
  dismiss: (row: Pick<DocumentRowView, "case_id" | "language">) => void;
  confirm: (row: Pick<DocumentRowView, "case_id" | "language">) => void;
  accept: (row: Pick<DocumentRowView, "case_id" | "language">, reason: string) => void;
  undoAnyway: (row: Pick<DocumentRowView, "case_id" | "language">) => void;
  /**
   * One row PATCH with the flags and the annotation mode ("Change plan…", P4: one transaction): Undo toast on
   * success; every error is thrown to the dialog (revisions of WORK_PLAN_CHANGED are noted first).
   */
  saveRow: (row: DocumentRowView, change: Pick<PlanRowPatch, "review" | "annotate" | "annotation_mode">, groupRevision: number, options?: { confirm?: boolean; reason?: string }) => Promise<void>;
  /** A plan revision seen elsewhere (Resolve options, dialogs). */
  noteRevision: (caseId: string, revision: number) => void;
  /** Latest plan revision known for a case (the group's or a newer saved one). */
  revisionOf: (caseId: string, groupRevision: number) => number;
  /**
   * The rows refetched: drop local flags older than the group's revision and, when a save moved
   * the row out of view and focus fell to the body, focus the case's group label.
   */
  refreshed: (groups: readonly { case_id: string; plan_revision: number }[]) => void;
}

const keyOf = (row: Pick<DocumentRowView, "case_id" | "language">): string => `${row.case_id}:${row.language}`;
const flagName = (flag: PlanFlag): string => (flag === "review" ? "Translation review" : "Annotate");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Plan saves of one page: per-case queue, latest revisions, local flags until the rows refetch, inline notices. */
export function usePlanSaves({ projectKey, onAnnounce, onChanged, showToast }: PlanSavesOptions): PlanSaves {
  const latest = useRef({ onAnnounce, onChanged, showToast });
  latest.current = { onAnnounce, onChanged, showToast };
  const queues = useRef(new Map<string, Promise<void>>());
  const revisions = useRef(new Map<string, number>());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, { flags: PlanFlagState; revision: number }>>(new Map());
  // Requests in flight per key (a counter, so a queued second request keeps the key busy).
  const [busy, setBusy] = useState<ReadonlyMap<string, number>>(new Map());
  const [notices, setNotices] = useState<ReadonlyMap<string, PlanNotice>>(new Map());
  const [sendingKeys, setSendingKeys] = useState<ReadonlyMap<string, number>>(new Map());
  /** The row whose chip gets focus after a confirmed save or an undo, until the rows refetched. */
  const pendingFocus = useRef<{ caseId: string; language: string; flag: PlanFlag | null } | null>(null);

  const setNotice = useCallback((key: string, notice: PlanNotice | null) => setNotices(current => {
    const next = new Map(current);
    if (notice) next.set(key, notice); else next.delete(key);
    return next;
  }), []);
  const mark = (setter: typeof setBusy, key: string, on: boolean) => setter(current => {
    const next = new Map(current);
    const count = (next.get(key) ?? 0) + (on ? 1 : -1);
    if (count > 0) next.set(key, count); else next.delete(key);
    return next;
  });
  /** Focus the row's chip once the notice or toast is gone (deferred to after the re-render). */
  const focusAfterSave = (caseId: string, language: string, flag: PlanFlag | null) => {
    pendingFocus.current = { caseId, language, flag };
    window.setTimeout(() => {
      const active = document.activeElement;
      const lost = active == null || active === document.body || active.closest(".ui-toast-region, .documents-plan-notice") !== null;
      if (lost) focusChip({ case_id: caseId, language }, flag);
    }, 0);
  };
  const noteRevision = useCallback((caseId: string, revision: number) => {
    revisions.current.set(caseId, Math.max(revisions.current.get(caseId) ?? 0, revision));
  }, []);
  const revisionFor = (caseId: string, groupRevision: number): number => Math.max(revisions.current.get(caseId) ?? 0, groupRevision);
  // An idle case starts at once; otherwise the save waits for the case's previous request.
  const enqueue = (caseId: string, task: () => Promise<void>) => {
    const previous = queues.current.get(caseId);
    const next = previous ? previous.then(task) : task();
    const tracked = next.finally(() => { if (queues.current.get(caseId) === tracked) queues.current.delete(caseId); });
    queues.current.set(caseId, tracked);
  };
  const setOverride = (key: string, flags: PlanFlagState, revision: number) => setOverrides(current => new Map(current).set(key, { flags, revision }));

  const noteChanged = (error: ApiError) => {
    const cases = isRecord(error.details) && Array.isArray(error.details.cases) ? error.details.cases : [];
    for (const item of cases) if (isRecord(item) && typeof item.case_id === "string" && typeof item.revision === "number") noteRevision(item.case_id, item.revision);
  };
  const changedElsewhere = (key: string, error: ApiError) => {
    noteChanged(error);
    setNotice(key, { kind: "changed" });
    latest.current.onChanged();
  };

  const undo = (key: string, payload: UndoView, confirm: boolean) => {
    const caseId = payload.rows[0]?.case_id ?? key.slice(0, key.lastIndexOf(":"));
    const language = key.slice(key.lastIndexOf(":") + 1);
    mark(setSendingKeys, key, true);
    latest.current.onAnnounce("Saving…");
    enqueue(caseId, async () => {
      try {
        const outcome = await runPlanUndo(projectKey, payload, { confirm });
        if (outcome.kind === "done") {
          for (const [id, revision] of Object.entries(outcome.revisions)) noteRevision(id, revision);
          for (const item of payload.rows) setOverride(keyOf(item), { review: item.review, annotate: item.annotate }, outcome.revisions[item.case_id] ?? 0);
          setNotice(key, null);
          latest.current.onAnnounce("Plan change undone.");
          focusAfterSave(caseId, language, null);
          latest.current.onChanged();
        } else if (outcome.kind === "needs_confirm") {
          latest.current.onAnnounce("");
          setNotice(key, { kind: "undo_conflict", undo: payload, consequences: outcome.consequences });
        } else {
          latest.current.onAnnounce("");
          for (const item of outcome.cases) noteRevision(item.case_id, item.revision);
          setNotice(key, { kind: "changed" });
          latest.current.onChanged();
        }
      } catch (error: unknown) {
        latest.current.onAnnounce("");
        setNotice(key, { kind: "error", error, retry: () => undo(key, payload, confirm) });
      } finally {
        mark(setSendingKeys, key, false);
      }
    });
  };

  const send = (request: PlanRequest, options: { confirm?: boolean; reason?: string } = {}) => {
    const key = `${request.caseId}:${request.language}`;
    const busyKey = `${key}:${request.flag}`;
    mark(setBusy, busyKey, true);
    mark(setSendingKeys, key, true);
    latest.current.onAnnounce("Saving…");
    enqueue(request.caseId, async () => {
      const body: PlanRowPatch = {
        [request.flag]: request.value,
        expected_revision: revisionFor(request.caseId, request.groupRevision),
        confirm: options.confirm ?? false,
        ...(options.reason !== undefined ? { accept_external_review: { reason: options.reason } } : {}),
      };
      try {
        const result = await api.patchWorkPlan(projectKey, request.caseId, request.language, body);
        noteRevision(request.caseId, result.revision);
        setOverride(key, { review: result.flags.review, annotate: result.flags.annotate }, result.revision);
        setNotice(key, null);
        latest.current.onAnnounce("");
        // A confirmed save or an acceptance closes the inline notice: its chip takes focus.
        if (options.confirm || options.reason !== undefined) focusAfterSave(request.caseId, request.language, request.flag);
        latest.current.showToast({
          message: `${request.language} of ${request.caseId}: ${flagName(request.flag)} ${request.value ? "on" : "off"}`,
          actionLabel: "Undo",
          undo: true,
          onAction: () => undo(key, result.undo, false),
          ...(result.withdrawn.length ? { note: UNDO_WITHDRAWN_NOTE } : {}),
        });
        latest.current.onChanged();
      } catch (error: unknown) {
        latest.current.onAnnounce("");
        if (error instanceof ApiError && error.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(error.details)) {
          setNotice(key, { kind: "confirm", request, consequences: error.details as unknown as ConsequencesView });
        } else if (error instanceof ApiError && error.code === "WORK_PLAN_INVALID" && isRecord(error.details) && error.details.reason === "annotate_not_accepted") {
          setNotice(key, { kind: "accept", request });
        } else if (error instanceof ApiError && error.code === "WORK_PLAN_CHANGED") {
          changedElsewhere(key, error);
        } else {
          setNotice(key, { kind: "error", error, retry: () => send(request, options) });
        }
      } finally {
        mark(setBusy, busyKey, false);
        mark(setSendingKeys, key, false);
      }
    });
  };

  const saveRow: PlanSaves["saveRow"] = (row, change, groupRevision, options = {}) => new Promise((resolve, reject) => {
    const key = keyOf(row);
    mark(setSendingKeys, key, true);
    latest.current.onAnnounce("Saving…");
    // The queued task never rejects (the queue chains with then); the outcome goes to the dialog's promise.
    enqueue(row.case_id, async () => {
      try {
        const result = await api.patchWorkPlan(projectKey, row.case_id, row.language, {
          ...change,
          expected_revision: revisionFor(row.case_id, groupRevision),
          confirm: options.confirm ?? false,
          ...(options.reason !== undefined ? { accept_external_review: { reason: options.reason } } : {}),
        });
        noteRevision(row.case_id, result.revision);
        setOverride(key, { review: result.flags.review, annotate: result.flags.annotate }, result.revision);
        setNotice(key, null);
        latest.current.onAnnounce("");
        latest.current.showToast({
          message: `${row.language} of ${row.case_id}: plan saved`,
          actionLabel: "Undo",
          undo: true,
          onAction: () => undo(key, result.undo, false),
          ...(result.withdrawn.length ? { note: UNDO_WITHDRAWN_NOTE } : {}),
        });
        latest.current.onChanged();
        resolve();
      } catch (error: unknown) {
        latest.current.onAnnounce("");
        if (error instanceof ApiError && error.code === "WORK_PLAN_CHANGED") { noteChanged(error); latest.current.onChanged(); }
        reject(error);
      } finally {
        mark(setSendingKeys, key, false);
      }
    });
  });

  const flagsOf = (row: DocumentRowView, groupRevision: number): PlanFlagState => {
    const override = overrides.get(keyOf(row));
    if (override && override.revision >= groupRevision) return override.flags;
    return { review: row.plan_row?.review ?? false, annotate: row.plan_row?.annotate ?? false };
  };

  const refreshed = (groups: readonly { case_id: string; plan_revision: number }[]) => {
    const groupRevisions = new Map(groups.map(group => [group.case_id, group.plan_revision]));
    setOverrides(current => {
      const stale = [...current].filter(([key, value]) => value.revision < (groupRevisions.get(key.slice(0, key.lastIndexOf(":"))) ?? -Infinity));
      if (!stale.length) return current;
      const next = new Map(current);
      for (const [key] of stale) next.delete(key);
      return next;
    });
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active != null && active !== document.body) return;
      if (focusChip({ case_id: pending.caseId, language: pending.language }, pending.flag)) return;
      (document.getElementById(documentsNotInPlanId(pending.caseId)) ?? document.getElementById(documentsGroupId(pending.caseId)))?.focus();
    }, 0);
  };

  return {
    flagsOf,
    refreshed,
    isBusy: (row, flag) => busy.has(`${keyOf(row)}:${flag}`),
    sending: row => sendingKeys.has(keyOf(row)),
    toggle: (row, flag, groupRevision) => {
      const key = keyOf(row);
      if (busy.has(`${key}:${flag}`)) return;
      const notice = notices.get(key);
      if (notice) setNotice(key, null);
      send({ caseId: row.case_id, language: row.language, flag, value: !flagsOf(row, groupRevision)[flag], groupRevision });
    },
    noticeOf: row => notices.get(keyOf(row)) ?? null,
    decidedLocally: row => overrides.has(keyOf(row)),
    dismiss: row => setNotice(keyOf(row), null),
    confirm: row => {
      const notice = notices.get(keyOf(row));
      if (notice?.kind === "confirm") send(notice.request, { confirm: true });
    },
    accept: (row, reason) => {
      const notice = notices.get(keyOf(row));
      if (notice?.kind === "accept") send(notice.request, { reason });
    },
    undoAnyway: row => {
      const notice = notices.get(keyOf(row));
      if (notice?.kind === "undo_conflict") undo(keyOf(row), notice.undo, true);
    },
    saveRow,
    noteRevision,
    revisionOf: revisionFor,
  };
}

export interface PlanChipsProps {
  row: DocumentRowView;
  /** The case group's `plan_revision` from the rows page. */
  groupRevision: number;
  saves: PlanSaves;
  size?: "table" | "card";
}

/** "Translation review" and "Annotate" chips of one language row; the source (and rows without translation review) only "Annotate". */
export function PlanChips({ row, groupRevision, saves, size = "table" }: PlanChipsProps): JSX.Element {
  const name = textLabel(row);
  if (row.plan_row?.discarded) return <span className="documents-plan-chips documents-plan-discarded">Discarded</span>;
  const flags = saves.flagsOf(row, groupRevision);
  const reviewApplicable = row.plan_row?.review_applicable ?? !row.is_source;
  return <span className="documents-plan-chips" data-plan-row={`${row.case_id}:${row.language}`}>
    {reviewApplicable && <PlanChip kind="review" size={size} pressed={flags.review} name={`${flagName("review")}, ${name}`} busy={saves.isBusy(row, "review")}
      onToggle={() => saves.toggle(row, "review", groupRevision)} />}
    <PlanChip kind="annotate" size={size} pressed={flags.annotate} name={`Annotate, ${name}`} busy={saves.isBusy(row, "annotate")}
      onToggle={() => saves.toggle(row, "annotate", groupRevision)} />
  </span>;
}

/** Focus the row's chip (the given flag's, else the first); false when the row has no chip in view. */
function focusChip(row: Pick<DocumentRowView, "case_id" | "language">, flag: PlanFlag | null): boolean {
  const key = `${row.case_id}:${row.language}`;
  const container = Array.from(document.querySelectorAll("[data-plan-row]")).find(element => element.getAttribute("data-plan-row") === key);
  const chips = container ? Array.from(container.querySelectorAll<HTMLButtonElement>("button.ui-plan-chip")) : [];
  const target = (flag ? chips.find(chip => chip.getAttribute("aria-label")?.startsWith(`${flagName(flag)},`)) : undefined) ?? chips[0];
  target?.focus();
  return target !== undefined;
}

/** Inline confirmation, acceptance, Undo conflict or error under a row; nothing without a notice. */
export function PlanRowNotice({ row, saves }: { row: DocumentRowView; saves: PlanSaves }): JSX.Element | null {
  const notice = saves.noticeOf(row);
  if (!notice) return null;
  return <PlanNoticeContent key={notice.kind} row={row} saves={saves} notice={notice} />;
}

function PlanNoticeContent({ row, saves, notice }: { row: DocumentRowView; saves: PlanSaves; notice: PlanNotice }): JSX.Element {
  const id = useId();
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState("");
  const busy = saves.sending(row);
  const name = textLabel(row);
  const cancel = () => {
    const flag = notice.kind === "confirm" || notice.kind === "accept" ? notice.request.flag : null;
    saves.dismiss(row);
    focusChip(row, flag);
  };
  if (notice.kind === "changed") {
    return <div className="documents-plan-notice"><InlineMessage tone="info">{PLAN_CHANGED_MESSAGE} <Button size="sm" onClick={() => saves.dismiss(row)}>Dismiss</Button></InlineMessage></div>;
  }
  if (notice.kind === "error") {
    return <div className="documents-plan-notice"><InlineMessage tone="error">Could not save the plan of {name}: {errorMessage(notice.error)}{" "}
      <Button size="sm" aria-disabled={busy || undefined} onClick={() => { if (!busy) notice.retry(); }}>Retry</Button>
      <Button size="sm" onClick={cancel}>Dismiss</Button>
    </InlineMessage></div>;
  }
  if (notice.kind === "accept") {
    const missing = !reason.trim();
    return <div className="documents-plan-notice">
      <InlineConfirm title="Annotate without review" busy={busy} confirmLabel="Accept and annotate" onCancel={cancel}
        message={<><p>{ACCEPT_EXTERNAL_LABEL}</p><p className="field-hint">{ACCEPTANCE_RECORDED}</p></>}
        confirmUnavailable={missing ? { reason: "Enter a reason." } : null}
        onConfirm={() => saves.accept(row, reason.trim())}>
        <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
      </InlineConfirm>
    </div>;
  }
  const withdrawing = notice.consequences.withdrawn.length > 0;
  const unavailable = withdrawing && !understood ? { reason: "Confirm that the open tasks are withdrawn." } : null;
  const checkbox = withdrawing && <Checkbox id={`${id}-understood`} label={WITHDRAW_CHECKBOX} checked={understood} onChange={event => setUnderstood(event.target.checked)} />;
  if (notice.kind === "undo_conflict") {
    return <div className="documents-plan-notice">
      <InlineConfirm title="Undo the plan change" busy={busy} confirmLabel="Undo anyway" onCancel={cancel} confirmUnavailable={unavailable}
        message={<p>Since your change, work was assigned: {withdrawnSummary(notice.consequences)} would be withdrawn.</p>}
        onConfirm={() => saves.undoAnyway(row)}>{checkbox}</InlineConfirm>
    </div>;
  }
  return <div className="documents-plan-notice">
    <InlineConfirm title={`Change the plan of ${name}`} busy={busy} confirmLabel="Save" onCancel={cancel} confirmUnavailable={unavailable}
      message={<ul className="documents-plan-consequences">{consequenceLines(notice.consequences).map(line => <li key={line}>{line}</li>)}</ul>}
      onConfirm={() => saves.confirm(row)}>{checkbox}</InlineConfirm>
  </div>;
}
