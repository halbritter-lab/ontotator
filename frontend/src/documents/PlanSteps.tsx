/**
 * The steps of one text's plan in words (spec F5): translation review and annotation, each option with
 * its explanation, including the annotation mode (§1 Q3: one mode per text, lock reason). "Change plan…"
 * of the text card uses `TextPlanDialog`; the bulk "Plan…" dialog reuses `PlanOption` and the copy.
 */
import { useId, useState, type ReactNode } from "react";
import { ApiError, type ConsequencesView, type DocumentRowView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";
import { ACCEPT_EXTERNAL_LABEL, ACCEPTANCE_RECORDED, consequenceLines, PLAN_CHANGED_MESSAGE, WITHDRAW_CHECKBOX, type PlanSaves } from "./PlanChips";

export type PlanMode = "proposals" | "scratch";

export const REVIEW_HELP = { on: "On: a person reviews the machine translation before annotation.", off: "Off: the translation is annotated as it is." } as const;
export const ANNOTATION_LABELS = { off: "Off (not annotated)", proposals: "Annotate from proposals", scratch: "Annotate from scratch" } as const;
/** Without a count (bulk: the counts differ per text) the sentence names "the tool proposals". */
export const proposalsHelp = (count?: number): string =>
  `Annotate from proposals: each annotator confirms, rejects or corrects the ${count === undefined ? "" : `${count} `}tool proposals and adds the findings the tool missed.`;
export const SCRATCH_HELP = "Annotate from scratch: annotators start from the plain text and do not see the proposals.";
export const NO_PROPOSALS_REASON = "This text has no tool proposals, so it is annotated from scratch.";
export const LOCK_REASON = "The annotation of this text has already started this way, so it cannot change.";
const NOTHING = "Nothing to change yet.";

/** One radio with its explanation; an unavailable option keeps focusable (`aria-disabled`) and names its reason. */
export function PlanOption({ group, value, label, help, checked, reason, onChoose }: {
  group: string; value: string; label: ReactNode; help?: string; checked: boolean; reason?: string | null; onChoose: () => void;
}): JSX.Element {
  const id = `${group}-${value}`;
  const describedBy = [help && `${id}-help`, reason && `${id}-reason`].filter(Boolean).join(" ");
  return <div className={reason ? "plan-option is-unavailable" : "plan-option"}>
    <input id={id} type="radio" name={group} value={value} checked={checked}
      aria-disabled={reason ? "true" : undefined} aria-describedby={describedBy || undefined}
      onClick={event => { if (reason) event.preventDefault(); }}
      onChange={() => { if (!reason) onChoose(); }} />
    <label htmlFor={id}>{label}</label>
    {help && <p id={`${id}-help`} className="plan-option-help">{help}</p>}
    {reason && <p id={`${id}-reason`} className="plan-option-reason">{reason}</p>}
  </div>;
}

export interface PlanStepsValue { review: boolean; annotate: boolean; mode: PlanMode | "project" }

export interface PlanStepsProps {
  row: DocumentRowView;
  value: PlanStepsValue;
  onChange: (next: PlanStepsValue) => void;
}

/** The two steps of one text: "Translation review" (translations only) and "Annotation" with its mode. */
export function PlanSteps({ row, value, onChange }: PlanStepsProps): JSX.Element {
  const group = useId().replace(/:/g, "");
  const textMode = row.annotation_mode ?? null;
  const count = textMode?.proposal_count ?? row.proposal_count;
  const follows = row.plan_row?.annotation_mode == null;
  const shownMode = value.mode === "project" ? textMode?.mode : value.mode;
  const projectMarked = value.mode === "project" && textMode?.source === "project" ? textMode.mode : null;
  const reviewApplicable = row.plan_row?.review_applicable ?? !row.is_source;
  const reasonOf = (mode: PlanMode): string | null => {
    if (mode === "proposals" && count === 0) return NO_PROPOSALS_REASON;
    if (textMode?.locked && mode !== textMode.mode) return LOCK_REASON;
    return null;
  };
  // Picking the mode the text already has while it follows the project setting keeps it following.
  const modeFor = (mode: PlanMode): PlanStepsValue["mode"] => (follows && mode === textMode?.mode ? "project" : mode);
  return <div className="plan-steps">
    {reviewApplicable && <fieldset className="plan-step">
      <legend>Translation review</legend>
      <PlanOption group={`${group}-review`} value="on" label="On" help={REVIEW_HELP.on} checked={value.review} onChoose={() => onChange({ ...value, review: true })} />
      <PlanOption group={`${group}-review`} value="off" label="Off" help={REVIEW_HELP.off} checked={!value.review} onChoose={() => onChange({ ...value, review: false })} />
    </fieldset>}
    <fieldset className="plan-step">
      <legend>Annotation</legend>
      <PlanOption group={`${group}-annotation`} value="off" label={ANNOTATION_LABELS.off} checked={!value.annotate} onChoose={() => onChange({ ...value, annotate: false })} />
      {(["proposals", "scratch"] as const).map(mode => <PlanOption key={mode} group={`${group}-annotation`} value={mode}
        label={projectMarked === mode ? `${ANNOTATION_LABELS[mode]} (project setting)` : ANNOTATION_LABELS[mode]}
        help={mode === "proposals" ? proposalsHelp(count) : SCRATCH_HELP}
        checked={value.annotate && shownMode === mode} reason={reasonOf(mode)}
        onChoose={() => onChange({ ...value, annotate: true, mode: modeFor(mode) })} />)}
    </fieldset>
  </div>;
}

export interface TextPlanDialogProps {
  row: DocumentRowView;
  /** The case group's `plan_revision` from the rows page. */
  groupRevision: number;
  saves: PlanSaves;
  onClose: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * "Change plan…" of one text: the steps in words; Save sends the flags and, when it changed, the mode in one
 * row PATCH (nothing is half saved). A refusal shows inline and the dialog keeps the user's choices.
 */
export function TextPlanDialog({ row, groupRevision, saves, onClose }: TextPlanDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const reasonId = `${ids}-save-reason`;
  const [initial] = useState<PlanStepsValue>(() => ({ ...saves.flagsOf(row, groupRevision), mode: row.plan_row?.annotation_mode ?? "project" }));
  const [value, setValue] = useState(initial);
  const [confirming, setConfirming] = useState<ConsequencesView | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const reviewApplicable = row.plan_row?.review_applicable ?? !row.is_source;
  const withdrawing = !!confirming?.withdrawn.length;

  // An undecided row may save its current flags: the PATCH records the decision (VD3).
  const undecided = row.plan_row?.decided === false && !saves.decidedLocally(row);
  const unchanged = !undecided && value.review === initial.review && value.annotate === initial.annotate && value.mode === initial.mode;
  const blocked = unchanged ? NOTHING
    : withdrawing && !understood ? "Confirm that the open tasks are withdrawn."
      : accepting && !reason.trim() ? "Enter a reason." : null;

  const save = async () => {
    if (blocked || saving) return;
    setSaving(true); setError(undefined); setChanged(false);
    try {
      await saves.saveRow(row, {
        annotate: value.annotate,
        ...(reviewApplicable ? { review: value.review } : {}),
        ...(value.mode !== initial.mode ? { annotation_mode: value.mode } : {}),
      }, groupRevision, { confirm: confirming !== null, ...(accepting ? { reason: reason.trim() } : {}) });
      onClose();
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(failure.details)) {
        setConfirming(failure.details as unknown as ConsequencesView); setUnderstood(false);
      } else if (failure instanceof ApiError && failure.code === "WORK_PLAN_INVALID" && isRecord(failure.details) && failure.details.reason === "annotate_not_accepted") {
        setAccepting(true);
      } else if (failure instanceof ApiError && failure.code === "WORK_PLAN_CHANGED") {
        setChanged(true); setConfirming(null);
      } else setError(failure);
    } finally { setSaving(false); }
  };

  const footer = <>
    <span id={reasonId} className="work-plan-save-reason" hidden={!blocked}>{blocked}</span>
    <Button onClick={onClose}>Cancel</Button>
    <Button variant="primary" loading={saving} aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? reasonId : undefined} onClick={() => void save()}>Save</Button>
  </>;

  return <Dialog open title={`Plan for ${row.case_id} ${row.language}`} size="md" onClose={onClose} footer={footer}>
    <div className="work-plan-dialog">
      {changed && <InlineMessage tone="info">{PLAN_CHANGED_MESSAGE}</InlineMessage>}
      <PlanSteps row={row} value={value} onChange={next => { setValue(next); setError(undefined); setConfirming(null); }} />
      {accepting && <div className="work-plan-acceptance">
        <p className="work-plan-acceptance-title">{ACCEPT_EXTERNAL_LABEL}</p>
        <Textarea id={`${ids}-reason`} label="Reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
        <p className="field-hint">{ACCEPTANCE_RECORDED}</p>
      </div>}
      {confirming && <div className="work-plan-warning work-plan-confirm">
        <ul>{consequenceLines(confirming).map(line => <li key={line}>{line}</li>)}</ul>
        {withdrawing && <Checkbox id={`${ids}-understood`} label={WITHDRAW_CHECKBOX} checked={understood} onChange={event => setUnderstood(event.target.checked)} />}
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
