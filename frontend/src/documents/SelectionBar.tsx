/**
 * Selection bar of Documents (spec "Selection bar"; documents overview VD4, VD21; owner decision R-3 of
 * 2026-10-26: it shows from one selected text on): "4 texts in 2 cases selected (2 source texts not shown)" (from the
 * selection summary with the current filters), the common next step, the "Show selected" toggle and
 * "Clear selection"; primary "Assign…" (the page's only primary button; it names the work, "Assign review…" or
 * "Assign annotation…", once the summary knows it; issue 129, U3) and "Plan…" (M2 decision M-1: the two
 * translation plan presets live in the plan dialog's quick choice). Every plan save keeps the selection and shows an
 * Undo toast (D22); a save that changes nothing says why instead. The summary sends the selected texts (`rows`); the
 * plan dialog edits whole cases.
 * The bar floats at the bottom of the viewport over the content (`useFloatingBar`): its arrival never moves the
 * table; the page reserves its height as bottom padding. Its place in the DOM keeps the focus order.
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, type BulkResult, type ConsequencesView, type DocumentRowFilters, type RowRefView, type SelectionSummary, type UndoView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, InlineConfirm, InlineMessage, type ToastMessage } from "../ui";
import { PLAN_CHANGED_MESSAGE, UNDO_WITHDRAWN_NOTE, WITHDRAW_CHECKBOX, withdrawnSummary } from "./PlanChips";
import { PlanDialog } from "./PlanDialog";
import { runPlanUndo } from "./planUndo";
import { useFloatingBar } from "./useFloatingBar";
import { caseOfTextKey, rowRefOf } from "./useTextSelection";

export interface SelectionBarProps {
  projectKey: string;
  /** Selected texts `"{case}:{language}"`. */
  keys: ReadonlySet<string>;
  /** The current Documents filters; "({k} texts not shown)" counts selected texts without a matching row. */
  filters: DocumentRowFilters;
  /** The list shows only the selected texts (issue 210). */
  showSelected?: boolean;
  onToggleShowSelected?: () => void;
  /** Changes whenever the rows reload, so the summary follows plan and assignment changes. */
  refresh?: unknown;
  /** Below 700 px (cards layout): compact actions that start on their own line. */
  narrow?: boolean;
  /** "Selection is limited to 2000 cases. Selected the first 2000." after a capped selection. */
  limitNote?: string | null;
  onClear: () => void;
  onAssign: () => void;
  showToast: (toast: Omit<ToastMessage, "id">) => void;
  /** The page's one polite live region. */
  onAnnounce: (message: string) => void;
  /** A plan save or undo changed rows: refetch them. */
  onChanged: () => void;
  /** Plan revisions returned by a save or undo (chips use them for their next save). */
  onRevisions?: (revisions: Record<string, number>) => void;
}

/** One checked text already shows the bar (owner decision R-3, 2026-10-26). */
const MIN_TEXTS = 1;

/** Delay before the selection summary is requested (Shift+Arrow can change the selection quickly). */
export const SUMMARY_DELAY_MS = 150;

const ASSIGN_STEP: Readonly<Record<string, string>> = {
  translation_review: "Assign translation review",
  annotate: "Assign annotation",
};

/**
 * "next step: Assign translation review (de)"; a mixed selection names every step, one language list per task:
 * "next steps: Assign annotation (en, es)" (issue 195; the assign dialog takes one language at a time).
 */
export function nextStepsText(steps: readonly { task: string; language: string }[]): string {
  const byTask = new Map<string, string[]>();
  for (const step of steps) byTask.set(step.task, [...(byTask.get(step.task) ?? []), step.language]);
  const parts = [...byTask].map(([task, languages]) => `${ASSIGN_STEP[task] ?? task} (${[...new Set(languages)].join(", ")})`);
  return `${steps.length > 1 ? "next steps" : "next step"}: ${parts.join("; ")}`;
}

const ASSIGN_BUTTON: Readonly<Record<string, string>> = { translation_review: "review", annotate: "annotation" };

/**
 * The primary button names what gets assigned (issue 129, U3): "Assign review…", "Assign annotation…" or both
 * ("Assign review or annotation…"); "Assign…" while the summary loads or when nothing can be assigned.
 */
export function assignButtonText(summary: Pick<SelectionSummary, "steps"> | null): string {
  const tasks = new Set((summary?.steps ?? []).map(step => step.task).filter(task => task in ASSIGN_BUTTON));
  const words = Object.keys(ASSIGN_BUTTON).filter(task => tasks.has(task)).map(task => ASSIGN_BUTTON[task]);
  return words.length ? `Assign ${words.join(" or ")}…` : "Assign…";
}

/** " (2 source texts not shown)": what the filters hide of the selection, however many of them are source texts. */
export function hiddenText({ not_shown: total = 0, not_shown_sources: sources = 0 }: Pick<SelectionSummary, "not_shown" | "not_shown_sources">): string {
  return ` (${plural(total, sources === total ? "source text" : "text")} not shown)`;
}

/** Why a plan save changed nothing: presets skip source texts (`skipped_rows`), the rest already had the plan. */
export function nothingChangedText(result: BulkResult, selected: number): string {
  const skipped = result.skipped_rows?.length ?? 0;
  if (skipped && skipped >= selected) return "Nothing changed: the selected texts are source texts; these plan actions apply to translations only.";
  if (skipped) return `Nothing changed: ${plural(skipped, "selected text")} ${skipped === 1 ? "is a source text" : "are source texts"}, the others already have this plan.`;
  return "Nothing changed: the selected texts already have this plan.";
}

type Undo = { kind: "conflict"; undo: UndoView; consequences: ConsequencesView } | { kind: "changed" };

export function SelectionBar({
  projectKey, keys, filters, showSelected = false, onToggleShowSelected, refresh, narrow = false, limitNote, onClear, onAssign, showToast, onAnnounce, onChanged, onRevisions,
}: SelectionBarProps): JSX.Element | null {
  const id = useId().replace(/:/g, "");
  const latest = useRef({ showToast, onAnnounce, onChanged, onRevisions });
  latest.current = { showToast, onAnnounce, onChanged, onRevisions };
  const alive = useRef(true);
  const section = useRef<HTMLElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rows: RowRefView[] = [...keys].map(rowRefOf);
  const caseIds = [...new Set([...keys].map(caseOfTextKey))];
  const idsKey = JSON.stringify([...keys]);
  const filtersKey = JSON.stringify(filters);
  const [summary, setSummary] = useState<{ key: string; value: SelectionSummary } | null>(null);
  useEffect(() => {
    if (rows.length < MIN_TEXTS) return;
    let active = true;
    const key = idsKey + filtersKey;
    const timer = window.setTimeout(() => {
      api.selectionSummary(projectKey, { rows }, filters).then(value => { if (active) setSummary({ key, value }); }, () => { if (active) setSummary(null); });
    }, SUMMARY_DELAY_MS);
    return () => { active = false; window.clearTimeout(timer); };
    // The keys stand for the selection and the filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, idsKey, filtersKey, refresh]);
  const current = summary?.key === idsKey + filtersKey ? summary.value : null;

  const [error, setError] = useState<unknown>();
  const [plan, setPlan] = useState<string[] | null>(null);
  const [undoState, setUndoState] = useState<Undo | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [understood, setUnderstood] = useState(false);
  /** "Nothing changed: …" for the selection it was saved for. */
  const [nothing, setNothing] = useState<{ key: string; text: string } | null>(null);

  const undo = (payload: UndoView, confirm: boolean) => {
    setUndoBusy(true);
    latest.current.onAnnounce("Saving…");
    runPlanUndo(projectKey, payload, { confirm }).then(outcome => {
      if (!alive.current) return;
      if (outcome.kind === "done") {
        setUndoState(null);
        latest.current.onRevisions?.(outcome.revisions);
        latest.current.onAnnounce("Plan change undone.");
      } else if (outcome.kind === "needs_confirm") {
        latest.current.onAnnounce("");
        setUnderstood(false);
        setUndoState({ kind: "conflict", undo: payload, consequences: outcome.consequences });
        return;
      } else {
        latest.current.onAnnounce(PLAN_CHANGED_MESSAGE);
        latest.current.onRevisions?.(Object.fromEntries(outcome.cases.map(item => [item.case_id, item.revision])));
        setUndoState({ kind: "changed" });
      }
      latest.current.onChanged();
    }, (failure: unknown) => {
      if (!alive.current) return;
      latest.current.onAnnounce("");
      setError(failure);
    }).finally(() => { if (alive.current) setUndoBusy(false); });
  };

  /** After any plan save: Undo toast, refetch, the selection stays. */
  const saved = (result: BulkResult, message: string) => {
    setError(undefined); setUndoState(null); setNothing(null);
    if (!result.changed_rows || !result.undo.rows.length) {
      const text = nothingChangedText(result, rows.length);
      setNothing({ key: idsKey, text });
      latest.current.onAnnounce(text);
      return;
    }
    latest.current.onRevisions?.(result.revisions);
    latest.current.onAnnounce(message);
    latest.current.showToast({
      message,
      actionLabel: "Undo",
      undo: true,
      onAction: () => undo(result.undo, false),
      ...(result.withdrawn.length ? { note: UNDO_WITHDRAWN_NOTE } : {}),
    });
    latest.current.onChanged();
  };

  const visible = keys.size >= MIN_TEXTS || undoState !== null;
  useFloatingBar(section, visible);
  if (!visible && !plan) return null;
  const withdrawing = undoState?.kind === "conflict" && undoState.consequences.withdrawn.length > 0;

  return <>
    {visible && <section ref={section} className={["selection-bar", narrow && "selection-bar--narrow"].filter(Boolean).join(" ")} aria-label="Selection">
      {keys.size >= MIN_TEXTS && <div className="selection-bar-line">
        <p className="selection-bar-summary">
          <strong>{`${plural(keys.size, "text")} in ${plural(caseIds.length, "case")} selected`}</strong>
          {current && (current.not_shown ?? 0) > 0 && <span className="selection-bar-hidden">{hiddenText(current)}</span>}
          {current?.common && <span className="selection-bar-step">, {nextStepsText(current.steps.length ? current.steps : [current.common])}</span>}
        </p>
        <div className="selection-bar-actions">
          <Button variant="primary" onClick={onAssign}>{assignButtonText(current)}</Button>
          <Button onClick={() => setPlan(caseIds)}>Plan…</Button>
          <Button aria-pressed={showSelected} onClick={onToggleShowSelected}>Show selected</Button>
          <Button onClick={onClear}>Clear selection</Button>
        </div>
      </div>}
      {limitNote && keys.size >= MIN_TEXTS && <p className="selection-bar-limit">{limitNote}</p>}
      {error !== undefined && <div className="selection-bar-error"><ErrorNotice error={error} /></div>}
      {nothing?.key === idsKey && keys.size >= MIN_TEXTS && <InlineMessage tone="info">{nothing.text}</InlineMessage>}
      {undoState?.kind === "changed" && <InlineMessage tone="info">{PLAN_CHANGED_MESSAGE}</InlineMessage>}
      {undoState?.kind === "conflict" && <div className="selection-bar-undo">
        <InlineConfirm title="Undo the plan change" busy={undoBusy} confirmLabel="Undo anyway"
          confirmUnavailable={withdrawing && !understood ? { reason: "Confirm that the open tasks are withdrawn." } : null}
          message={<p>Since your change, work was assigned: {withdrawnSummary(undoState.consequences)} would be withdrawn.</p>}
          onCancel={() => setUndoState(null)} onConfirm={() => undo(undoState.undo, true)}>
          {withdrawing && <Checkbox id={`${id}-understood`} label={WITHDRAW_CHECKBOX} checked={understood} onChange={event => setUnderstood(event.target.checked)} />}
        </InlineConfirm>
      </div>}
    </section>}
    {plan && <PlanDialog projectKey={projectKey} caseIds={plan} rows={rows} onClose={() => setPlan(null)}
      onSaved={(result, message) => { setPlan(null); saved(result, message); }} />}
  </>;
}
