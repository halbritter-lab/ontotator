/**
 * The steps of one text's plan in words (spec F5): translation review and annotation, each option with
 * its explanation, including the annotation mode (§1 Q3: one mode per text, lock reason). "Add to plan…"
 * uses `TextPlanDialog`; the text card edits each step in place (`CardPlanSelect`, same save); the bulk "Plan…"
 * dialog reuses `PlanOption` and the copy.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { ApiError, type ConsequencesView, type DocumentRowView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, Dialog, InlineMessage, Textarea } from "../ui";
import { IconCheck } from "../ui/icons";
import { shortName } from "./stageLabels";
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
 * The save of one text's plan, shared by the dialog and the card's selects: one row PATCH with the flags and,
 * when it changed, the mode (nothing is half saved). A refusal that needs more (withdrawing open tasks, an
 * acceptance reason) or a plan changed elsewhere shows in `extras`; saving again sends the confirmation.
 */
export function usePlanRowSave(row: DocumentRowView, groupRevision: number, saves: PlanSaves) {
  const ids = useId().replace(/:/g, "");
  const [confirming, setConfirming] = useState<ConsequencesView | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const reviewApplicable = row.plan_row?.review_applicable ?? !row.is_source;
  const withdrawing = !!confirming?.withdrawn.length;
  /** What the next save still needs, or null. */
  const pending = withdrawing && !understood ? "Confirm that the open tasks are withdrawn."
    : accepting && !reason.trim() ? "Enter a reason." : null;
  const clear = () => { setError(undefined); setConfirming(null); };
  const reset = () => { clear(); setAccepting(false); setReason(""); setUnderstood(false); setChanged(false); };

  /** Saves `value` (against `initial`); true when saved. */
  const save = async (value: PlanStepsValue, initial: PlanStepsValue): Promise<boolean> => {
    if (saving) return false;
    setSaving(true); setError(undefined); setChanged(false);
    try {
      await saves.saveRow(row, {
        annotate: value.annotate,
        ...(reviewApplicable ? { review: value.review } : {}),
        ...(value.mode !== initial.mode ? { annotation_mode: value.mode } : {}),
      }, groupRevision, { confirm: confirming !== null, ...(accepting ? { reason: reason.trim() } : {}) });
      reset();
      return true;
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(failure.details)) {
        setConfirming(failure.details as unknown as ConsequencesView); setUnderstood(false);
      } else if (failure instanceof ApiError && failure.code === "WORK_PLAN_INVALID" && isRecord(failure.details) && failure.details.reason === "annotate_not_accepted") {
        setAccepting(true);
      } else if (failure instanceof ApiError && failure.code === "WORK_PLAN_CHANGED") {
        setChanged(true); setConfirming(null);
      } else setError(failure);
      return false;
    } finally { setSaving(false); }
  };

  const extras = <>
    {changed && <InlineMessage tone="info">{PLAN_CHANGED_MESSAGE}</InlineMessage>}
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
  </>;
  /** A refusal waits for the user (confirmation, reason, or an error to read). */
  const open = confirming !== null || accepting || changed || error !== undefined;
  return { save, saving, pending, clear, reset, extras, open, needsMore: confirming !== null || accepting };
}

/**
 * "Add to plan…" (and the former "Change plan…") of one text: the steps in words; Save sends the flags and, when
 * it changed, the mode in one row PATCH. A refusal shows inline and the dialog keeps the user's choices.
 */
export function TextPlanDialog({ row, groupRevision, saves, onClose }: TextPlanDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const reasonId = `${ids}-save-reason`;
  const [initial] = useState<PlanStepsValue>(() => ({ ...saves.flagsOf(row, groupRevision), mode: row.plan_row?.annotation_mode ?? "project" }));
  const [value, setValue] = useState(initial);
  const plan = usePlanRowSave(row, groupRevision, saves);

  // An undecided row may save its current flags: the PATCH records the decision (VD3).
  const undecided = row.plan_row?.decided === false && !saves.decidedLocally(row);
  const unchanged = !undecided && value.review === initial.review && value.annotate === initial.annotate && value.mode === initial.mode;
  const blocked = unchanged ? NOTHING : plan.pending;

  const save = async () => {
    if (blocked || plan.saving) return;
    if (await plan.save(value, initial)) onClose();
  };

  const footer = <>
    <span id={reasonId} className="dialog-footer-reason" hidden={!blocked}>{blocked}</span>
    <Button onClick={onClose}>Cancel</Button>
    <Button variant="primary" loading={plan.saving} aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? reasonId : undefined} onClick={() => void save()}>Save</Button>
  </>;

  return <Dialog open title={`Plan for ${row.case_id} ${row.language}`} size="md" onClose={onClose} footer={footer}>
    <div className="work-plan-dialog">
      <PlanSteps row={row} value={value} onChange={next => { setValue(next); plan.clear(); }} />
      {plan.extras}
    </div>
  </Dialog>;
}

/** Select options of the card's plan controls. */
const CARD_ANNOTATION_OPTIONS = { proposals: "From proposals", scratch: "From scratch", off: "Off" } as const;

/** What the current choice of a card plan control means (the line under it). */
export function cardChoiceLine(step: "review" | "annotation", choice: string, count: number): string {
  if (step === "review") return choice === "on" ? "A person reviews the translation before annotation." : "The translation is annotated as it is.";
  if (choice === "off") return "This text is not annotated.";
  if (choice === "proposals") return `Annotators start from the ${count === 1 ? "1 tool proposal" : `${count} tool proposals`} and confirm, reject or correct them.`;
  return count > 0 ? "Annotators start from the plain text and do not see the proposals." : "No tool proposals for this text, so annotation starts from scratch.";
}

/**
 * One step of the plan in the text card (M1 card mockup v3): a segmented control with every choice ("Review: On | Off",
 * "From proposals | From scratch | Off"), radio semantics with arrow keys; the current choice is filled and ticked,
 * another saves at once through the plan save of `TextPlanDialog`, one line below says what the choice means. A locked
 * mode or a missing proposal set keeps the choices focusable (`aria-disabled`) and says why.
 */
export function CardPlanSelect({ row, step, groupRevision, saves }: {
  row: DocumentRowView;
  step: "review" | "annotation";
  groupRevision: number;
  saves: PlanSaves;
}): JSX.Element | null {
  const id = useId().replace(/:/g, "");
  const plan = usePlanRowSave(row, groupRevision, saves);
  const current: PlanStepsValue = { ...saves.flagsOf(row, groupRevision), mode: row.plan_row?.annotation_mode ?? "project" };
  const [chosen, setChosen] = useState<PlanStepsValue | null>(null);
  const [saved, setSaved] = useState(false);
  // The refetched row carries the saved plan: the local choice gives way to it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setChosen(previous => (saved ? null : previous)); }, [row]);
  const textMode = row.annotation_mode ?? null;
  // "no_proposals": the text's current version has none (counts may come from other versions).
  const count = textMode?.source === "no_proposals" ? 0 : textMode?.proposal_count ?? row.proposal_count ?? 0;
  const follows = row.plan_row?.annotation_mode == null;
  // The choice stands while it saves, waits for a confirmation or awaits the refetch; after a plain error the saved plan shows.
  const value = chosen && (plan.saving || plan.needsMore || saved) ? chosen : current;
  const shownMode = (value.mode === "project" ? textMode?.mode : value.mode) ?? (count > 0 ? "proposals" : "scratch");
  const locked = step === "annotation" && !!textMode?.locked;
  if (step === "review" && !(row.plan_row?.review_applicable ?? !row.is_source)) return null;

  const selected = step === "review" ? (value.review ? "on" : "off") : value.annotate ? shownMode : "off";
  // Submitted work fixes the mode for good; unsubmitted work only until its assignment is removed (#17.1).
  const annotations = row.work.filter(item => item.task === "annotate" && item.moved_to_version == null);
  const submittedWork = annotations.find(item => item.status === "submitted");
  const starter = submittedWork ?? annotations[0];
  const starterName = starter ? (starter.person ? shortName(starter.person) : starter.author_label) : "an annotator";
  const modeWords = textMode?.mode === "scratch" ? "from scratch" : "from proposals";
  const lockLine = !locked ? null : submittedWork
    ? `Fixed: ${starterName} has submitted work started ${modeWords}, so the mode no longer changes.`
    : `Fixed: ${starterName} has started ${modeWords}. Remove the unsubmitted assignment below to change it.`;
  const choices = step === "review"
    ? [{ value: "on", label: "On" }, { value: "off", label: "Off" }]
    : [{ value: "proposals", label: CARD_ANNOTATION_OPTIONS.proposals }, { value: "scratch", label: CARD_ANNOTATION_OPTIONS.scratch }, { value: "off", label: CARD_ANNOTATION_OPTIONS.off }];
  const reasonOf = (choice: string): string | null => locked ? lockLine
    : step === "annotation" && choice === "proposals" && count === 0 && selected !== "proposals" ? NO_PROPOSALS_REASON : null;
  const nextOf = (choice: string): PlanStepsValue => {
    if (step === "review") return { ...value, review: choice === "on" };
    if (choice === "off") return { ...value, annotate: false };
    const mode = choice as PlanMode;
    // Picking the mode the text already has while it follows the project setting keeps it following.
    return { ...value, annotate: true, mode: follows && mode === textMode?.mode ? "project" : mode };
  };
  const run = async (next: PlanStepsValue) => {
    setSaved(false);
    if (await plan.save(next, current)) setSaved(true);
  };
  const choose = (choice: string) => {
    if (reasonOf(choice) || plan.saving || choice === selected) return;
    const next = nextOf(choice);
    plan.reset();
    setChosen(next);
    void run(next);
  };
  const cancel = () => { plan.reset(); setChosen(null); setSaved(false); };
  const lineId = `${id}-line`;
  const title = step === "review" ? "Review" : "Annotation plan";

  return <div className="text-card-plan-control">
    <span className="text-card-plan-line">
      {step === "review" && <span id={`${id}-label`} className="text-card-plan-label" aria-hidden="true">Review</span>}
      <span role="radiogroup" aria-label={title} aria-describedby={lineId} aria-busy={plan.saving || undefined} className="segmented">
        {choices.map(choice => {
          const checked = selected === choice.value;
          const reason = reasonOf(choice.value);
          return <label key={choice.value} className="segment" data-checked={checked || undefined} data-unavailable={reason ? true : undefined}>
            <input type="radio" name={`${id}-choice`} value={choice.value} checked={checked}
              aria-disabled={reason ? "true" : undefined} aria-describedby={reason ? lineId : undefined}
              onClick={event => { if (reason) event.preventDefault(); }}
              onChange={() => choose(choice.value)} />
            {checked && <IconCheck className="segment-check" />}{choice.label}
          </label>;
        })}
      </span>
      <span className="text-card-muted" role="status">{plan.saving ? "Saving…" : saved && !plan.open ? "Saved" : ""}</span>
    </span>
    <p id={lineId} className="text-card-muted text-card-plan-help">{lockLine ?? cardChoiceLine(step, selected, count)}
      {!lockLine && step === "annotation" && count === 0 && selected !== "proposals" && selected !== "scratch" ? ` ${NO_PROPOSALS_REASON}` : ""}</p>

    {plan.open && <div className="text-card-plan-refusal">
      {plan.extras}
      {plan.needsMore && <div className="text-card-actions">
        {plan.pending && <span id={`${id}-pending`} className="text-card-muted">{plan.pending}</span>}
        <Button size="sm" variant="primary" loading={plan.saving} aria-disabled={plan.pending ? true : undefined}
          onClick={() => { if (!plan.pending && chosen) void run(chosen); }}>Save change</Button>
        <Button size="sm" onClick={cancel}>Cancel</Button>
      </div>}
    </div>}
  </div>;
}
