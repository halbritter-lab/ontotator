/**
 * Lead options for a translation that blocks the plan, shown under the Documents row.
 * - `resolve` (rule 4, D5): exactly "Assign a new review…", "Correct the translation…" and
 *   "Discard the {language} translation…" (reason required, consequences confirmed inline).
 * - `not_accepted` (rule 4a, D24): "Turn Review on" or the external-review acceptance with a reason.
 */
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type ConsequencesView, type DocumentRowView } from "../api/client";
import { textLabel } from "../app/identity";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, InlineConfirm, InlineMessage, Textarea } from "../ui";
import { stepLabel } from "./nextStepLabels";
import { ACCEPT_EXTERNAL_LABEL, ACCEPTANCE_RECORDED, consequenceLines, PLAN_CHANGED_MESSAGE, WITHDRAW_CHECKBOX } from "./PlanChips";

export interface ResolveTranslationProps {
  mode: "resolve" | "not_accepted";
  row: DocumentRowView;
  projectKey: string;
  /** Latest known plan revision of the case. */
  revision: number;
  /** "Assign a new review…": the assign dialog for a translation review of this row. */
  onAssignReview: () => void;
  /** "Correct the translation…": the existing correction flow. */
  onCorrect: () => void;
  /** Saved: the announcement and the case's new plan revision. */
  onDone: (message: string, saved: { caseId: string; revision: number }) => void;
  /** The plan changed elsewhere (409 `WORK_PLAN_CHANGED`): a case's current revision; the page refetches. */
  onChanged: (caseId: string, revision: number) => void;
  /** The page's one shared polite live region ("Saving…"). */
  onAnnounce: (message: string) => void;
  onCancel: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A 409 `WORK_PLAN_CHANGED`: report each case's current revision from `details.cases` (at least
 * the row's case, so the page refetches) and return true; any other failure returns false.
 */
function reportPlanChanged(failure: unknown, props: Pick<ResolveTranslationProps, "row" | "revision" | "onChanged">): boolean {
  if (!(failure instanceof ApiError) || failure.code !== "WORK_PLAN_CHANGED") return false;
  const cases = isRecord(failure.details) && Array.isArray(failure.details.cases) ? failure.details.cases : [];
  const revisions = cases.flatMap(item => (isRecord(item) && typeof item.case_id === "string" && typeof item.revision === "number" ? [[item.case_id, item.revision] as const] : []));
  if (!revisions.length) props.onChanged(props.row.case_id, props.revision);
  for (const [caseId, revision] of revisions) props.onChanged(caseId, revision);
  return true;
}

function ChangedMessage(): JSX.Element {
  return <InlineMessage tone="info">{PLAN_CHANGED_MESSAGE}</InlineMessage>;
}

/** The version the options act on: the step's version, else the newest version of the row. */
function targetDocument(row: DocumentRowView): string {
  return row.next_step?.document_id ?? row.versions.find(entry => entry.is_newest_in_chain)?.document_id ?? row.open.document_id;
}

export function ResolveTranslation(props: ResolveTranslationProps): JSX.Element {
  return props.mode === "resolve" ? <ResolveOptions {...props} /> : <NotAcceptedOptions {...props} />;
}

function useHeadingFocus() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return heading;
}

function ResolveOptions(props: ResolveTranslationProps): JSX.Element {
  const { row, projectKey, onAssignReview, onCorrect, onDone, onAnnounce, onCancel } = props;
  const id = useId();
  const heading = useHeadingFocus();
  const discardButton = useRef<HTMLButtonElement>(null);
  const [discarding, setDiscarding] = useState(false);
  const [backToOptions, setBackToOptions] = useState(false);
  const [reason, setReason] = useState("");
  const [consequences, setConsequences] = useState<ConsequencesView | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const title = `${stepLabel(row.next_step?.code ?? "resolve_rejected")}, ${textLabel(row)}`;
  const discardLabel = `Discard the ${row.language} translation`;

  // Cancel in the discard step returns to the three options with focus on "Discard…".
  useEffect(() => {
    if (!backToOptions || discarding) return;
    setBackToOptions(false);
    discardButton.current?.focus();
  }, [backToOptions, discarding]);

  const discard = async () => {
    if (busy || !reason.trim()) return;
    const confirm = consequences !== null;
    setBusy(true); setError(undefined); setChanged(false);
    onAnnounce("Saving…");
    try {
      const result = await api.discardVariant(projectKey, targetDocument(row), { reason: reason.trim(), confirm });
      onDone(`The ${row.language} translation of ${row.case_id} was discarded.`, { caseId: result.case_id, revision: result.revision });
    } catch (failure: unknown) {
      onAnnounce("");
      if (failure instanceof ApiError && failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(failure.details)) {
        setConsequences(failure.details as unknown as ConsequencesView); setUnderstood(false);
      } else if (reportPlanChanged(failure, props)) {
        setConsequences(null); setUnderstood(false); setChanged(true);
      } else setError(failure);
    } finally { setBusy(false); }
  };
  const backFromDiscard = () => {
    setDiscarding(false); setConsequences(null); setUnderstood(false); setError(undefined); setChanged(false);
    setBackToOptions(true);
  };

  if (discarding) {
    const withdrawing = (consequences?.withdrawn.length ?? 0) > 0;
    const unavailable = !reason.trim() ? { reason: "Enter a reason." } : withdrawing && !understood ? { reason: "Confirm that the open tasks are withdrawn." } : null;
    return <div className="documents-resolve">
      <InlineConfirm title={`${discardLabel} of ${row.case_id}`} tone="danger" busy={busy} confirmLabel="Discard"
        message={<p>Its versions are marked as discarded. Nothing is deleted.</p>}
        confirmUnavailable={unavailable} onConfirm={() => { void discard(); }}
        onCancel={backFromDiscard}>
        {/* Read-only (not disabled) once the consequences are shown: it stays focusable and readable. */}
        <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason}
          readOnly={consequences !== null} aria-disabled={consequences !== null || undefined}
          onChange={event => { if (consequences === null) setReason(event.target.value); }} />
        {consequences && <ul className="documents-plan-consequences">{consequenceLines(consequences).map(line => <li key={line}>{line}</li>)}</ul>}
        {withdrawing && <Checkbox id={`${id}-understood`} label={WITHDRAW_CHECKBOX} checked={understood} onChange={event => setUnderstood(event.target.checked)} />}
        {changed && <ChangedMessage />}
        {error !== undefined && <ErrorNotice error={error} />}
      </InlineConfirm>
    </div>;
  }
  return <div className="documents-resolve" role="group" aria-labelledby={`${id}-title`}>
    <h4 id={`${id}-title`} ref={heading} tabIndex={-1} className="inline-confirm-title">{title}</h4>
    <div className="documents-resolve-actions">
      <Button size="sm" onClick={onAssignReview}>Assign a new review…</Button>
      <Button size="sm" onClick={onCorrect}>Correct the translation…</Button>
      <Button ref={discardButton} size="sm" onClick={() => setDiscarding(true)}>{discardLabel}…</Button>
      <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

function NotAcceptedOptions(props: ResolveTranslationProps): JSX.Element {
  const { row, projectKey, revision, onDone, onAnnounce, onCancel } = props;
  const id = useId();
  const heading = useHeadingFocus();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const name = textLabel(row);

  const save = async (kind: "review" | "accept") => {
    if (busy || (kind === "accept" && !reason.trim())) return;
    setBusy(true); setError(undefined); setChanged(false);
    onAnnounce("Saving…");
    try {
      const result = kind === "review"
        ? await api.patchWorkPlan(projectKey, row.case_id, row.language, { review: true, expected_revision: revision, confirm: false })
        : await api.patchWorkPlan(projectKey, row.case_id, row.language, { annotate: true, expected_revision: revision, confirm: false, accept_external_review: { reason: reason.trim() } });
      onDone(kind === "review" ? `Review on for ${name}. Next: Assign translation review.` : `${name} accepted as reviewed outside Ontocurator.`,
        { caseId: result.case_id, revision: result.revision });
    } catch (failure: unknown) {
      onAnnounce("");
      if (reportPlanChanged(failure, props)) setChanged(true); else setError(failure);
    } finally { setBusy(false); }
  };

  const missing = !reason.trim();
  return <div className="documents-resolve" role="group" aria-labelledby={`${id}-title`}>
    <h4 id={`${id}-title`} ref={heading} tabIndex={-1} className="inline-confirm-title">{`${stepLabel("translation_not_accepted")}, ${name}`}</h4>
    <p>Annotation needs an accepted translation.</p>
    <div className="documents-resolve-actions">
      <Button size="sm" aria-disabled={busy || undefined} onClick={() => { void save("review"); }}>Turn Review on</Button>
    </div>
    <p>{ACCEPT_EXTERNAL_LABEL}</p>
    <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />
    <p className="field-hint">{ACCEPTANCE_RECORDED}</p>
    {missing && <p id={`${id}-missing`} className="action-reason">Enter a reason.</p>}
    {changed && <ChangedMessage />}
    {error !== undefined && <ErrorNotice error={error} />}
    <div className="documents-resolve-actions">
      <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
      <Button size="sm" aria-disabled={missing || busy ? true : undefined} aria-describedby={missing ? `${id}-missing` : undefined}
        onClick={() => { void save("accept"); }}>Accept and annotate</Button>
    </div>
  </div>;
}
