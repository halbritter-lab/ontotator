/**
 * Selection bar of Documents (spec "Selection bar"; documents overview VD4, VD21): "3 texts in 2
 * cases selected", the common next step,
 * "{k} not shown with these filters" (from the selection summary with the current filters) and
 * "Clear selection"; primary "Assign…" (the page's only primary button) and the plan actions
 * "Review + annotate translations", "Annotate only" (one click when no existing work is affected)
 * and "Plan…". Every plan save keeps the selection and shows an Undo toast (D22). The summary and
 * the quick plan actions send the selected texts (`rows`); the plan dialog still edits whole cases.
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type BulkResult, type ConsequencesView, type DocumentRowFilters, type RowRefView, type SelectionSummary, type UndoView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { Button, Checkbox, InlineConfirm, InlineMessage, type ToastMessage, type TriState } from "../ui";
import { PLAN_CHANGED_MESSAGE, UNDO_WITHDRAWN_NOTE, WITHDRAW_CHECKBOX, withdrawnSummary } from "./PlanChips";
import { PlanDialog } from "./PlanDialog";
import { savedSummary, SOURCE_KEY, type PlanChoices } from "./planSummary";
import { runPlanUndo } from "./planUndo";
import { caseOfTextKey, rowRefOf } from "./useTextSelection";

type Preset = "review_and_annotate_translations" | "annotate_only";

export interface SelectionBarProps {
  projectKey: string;
  /** Selected texts `"{case}:{language}"`. */
  keys: ReadonlySet<string>;
  /** The current Documents filters; "{k} not shown" counts selected texts without a matching row. */
  filters: DocumentRowFilters;
  /** Changes whenever the rows reload, so the summary follows plan and assignment changes. */
  refresh?: unknown;
  /** Below 700 px the bar sticks to the bottom of the viewport. */
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

/** Delay before the selection summary is requested (Shift+Arrow can change the selection quickly). */
export const SUMMARY_DELAY_MS = 150;

const ASSIGN_STEP: Readonly<Record<string, string>> = {
  translation_review: "Assign translation review",
  annotate: "Assign annotation",
  review: "Assign annotation review",
};

/** "next step: Assign translation review (de)". */
export const commonStepText = (step: { task: string; language: string }): string =>
  `next step: ${ASSIGN_STEP[step.task] ?? step.task} (${step.language})`;

/** Plan dialog cells of a quick action for the given translation languages. */
function presetChoices(preset: Preset, languages: readonly string[]): PlanChoices {
  const cell: PlanChoices[string] = preset === "annotate_only" ? { annotate: "on" as TriState } : { review: "on", annotate: "on" };
  return Object.fromEntries(languages.filter(language => language !== SOURCE_KEY).map(language => [language, { ...cell }]));
}

type Undo = { kind: "conflict"; undo: UndoView; consequences: ConsequencesView } | { kind: "changed" };

export function SelectionBar({
  projectKey, keys, filters, refresh, narrow = false, limitNote, onClear, onAssign, showToast, onAnnounce, onChanged, onRevisions,
}: SelectionBarProps): JSX.Element | null {
  const id = useId().replace(/:/g, "");
  const latest = useRef({ showToast, onAnnounce, onChanged, onRevisions });
  latest.current = { showToast, onAnnounce, onChanged, onRevisions };
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rows: RowRefView[] = [...keys].map(rowRefOf);
  const caseIds = [...new Set([...keys].map(caseOfTextKey))];
  const idsKey = JSON.stringify([...keys]);
  const filtersKey = JSON.stringify(filters);
  const [summary, setSummary] = useState<{ key: string; value: SelectionSummary } | null>(null);
  useEffect(() => {
    if (!rows.length) return;
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

  const [busy, setBusy] = useState<Preset | null>(null);
  const [error, setError] = useState<unknown>();
  const [plan, setPlan] = useState<{ caseIds: string[]; initial?: PlanChoices } | null>(null);
  const [undoState, setUndoState] = useState<Undo | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [understood, setUnderstood] = useState(false);

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
    setError(undefined); setUndoState(null);
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

  const quick = async (preset: Preset) => {
    if (busy || !rows.length) return;
    const selected = rows;
    const cases = caseIds;
    setBusy(preset); setError(undefined); setUndoState(null);
    latest.current.onAnnounce("Saving…");
    try {
      const result = await api.saveWorkPlans(projectKey, { rows: selected, preset, confirm: false });
      if (!alive.current) return;
      const languages = [...new Set(result.undo.rows.map(row => row.language))];
      saved(result, savedSummary(cases.length, presetChoices(preset, languages)));
    } catch (failure: unknown) {
      if (!alive.current) return;
      const needsDialog = failure instanceof ApiError && (failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" || failure.code === "WORK_PLAN_INVALID");
      if (!needsDialog) { latest.current.onAnnounce(""); setError(failure); return; }
      // Existing work is affected or translations need an acceptance: the plan dialog with the preset.
      try {
        const preview = await api.previewWorkPlans(projectKey, { rows: selected, preset, confirm: false });
        if (!alive.current) return;
        latest.current.onAnnounce("");
        setPlan({ caseIds: cases, initial: presetChoices(preset, preview.languages.map(language => language.key)) });
      } catch (previewFailure: unknown) {
        if (alive.current) { latest.current.onAnnounce(""); setError(previewFailure); }
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const visible = keys.size > 0 || undoState !== null;
  if (!visible && !plan) return null;
  const withdrawing = undoState?.kind === "conflict" && undoState.consequences.withdrawn.length > 0;

  return <>
    {visible && <section className={["selection-bar", narrow && "selection-bar--bottom"].filter(Boolean).join(" ")} aria-label="Selection">
      {keys.size > 0 && <div className="selection-bar-line">
        <p className="selection-bar-summary">
          <strong>{`${plural(keys.size, "text")} in ${plural(caseIds.length, "case")} selected`}</strong>
          {current?.common && <span className="selection-bar-step"> · {commonStepText(current.common)}</span>}
          {current && current.not_shown > 0 && <span className="selection-bar-hidden"> · {current.not_shown} not shown with these filters</span>}
        </p>
        <div className="selection-bar-actions">
          <Button variant="primary" onClick={onAssign}>Assign…</Button>
          <Button loading={busy === "review_and_annotate_translations"} aria-disabled={busy ? true : undefined}
            onClick={() => { void quick("review_and_annotate_translations"); }}>Review + annotate translations</Button>
          <Button loading={busy === "annotate_only"} aria-disabled={busy ? true : undefined} onClick={() => { void quick("annotate_only"); }}>Annotate only</Button>
          <Button aria-disabled={busy ? true : undefined} onClick={() => { if (!busy) setPlan({ caseIds }); }}>Plan…</Button>
          <Button onClick={onClear}>Clear selection</Button>
        </div>
      </div>}
      {limitNote && keys.size > 0 && <p className="selection-bar-limit">{limitNote}</p>}
      {error !== undefined && <div className="selection-bar-error"><ErrorNotice error={error} /></div>}
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
    {plan && <PlanDialog projectKey={projectKey} caseIds={plan.caseIds} initial={plan.initial} onClose={() => setPlan(null)}
      onSaved={(result, message) => { setPlan(null); saved(result, message); }} />}
  </>;
}
