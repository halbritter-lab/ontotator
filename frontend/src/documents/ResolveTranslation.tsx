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
import { Button, Checkbox, InlineConfirm, Textarea } from "../ui";
import { stepLabel } from "./nextStepLabels";
import { ACCEPT_EXTERNAL_LABEL, ACCEPTANCE_RECORDED, consequenceLines, WITHDRAW_CHECKBOX } from "./PlanChips";

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
  onCancel: () => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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

function ResolveOptions({ row, projectKey, onAssignReview, onCorrect, onDone, onCancel }: ResolveTranslationProps): JSX.Element {
  const id = useId();
  const heading = useHeadingFocus();
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState("");
  const [consequences, setConsequences] = useState<ConsequencesView | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const title = `${stepLabel(row.next_step?.code ?? "resolve_rejected")}, ${textLabel(row)}`;
  const discardLabel = `Discard the ${row.language} translation`;

  const discard = async () => {
    if (busy || !reason.trim()) return;
    const confirm = consequences !== null;
    setBusy(true); setError(undefined);
    try {
      const result = await api.discardVariant(projectKey, targetDocument(row), { reason: reason.trim(), confirm });
      onDone(`The ${row.language} translation of ${row.case_id} was discarded.`, { caseId: result.case_id, revision: result.revision });
    } catch (failure: unknown) {
      if (failure instanceof ApiError && failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && isRecord(failure.details)) {
        setConsequences(failure.details as unknown as ConsequencesView); setUnderstood(false);
      } else setError(failure);
    } finally { setBusy(false); }
  };

  if (discarding) {
    const withdrawing = (consequences?.withdrawn.length ?? 0) > 0;
    const unavailable = !reason.trim() ? { reason: "Enter a reason." } : withdrawing && !understood ? { reason: "Confirm that the open tasks are withdrawn." } : null;
    return <div className="documents-resolve">
      <InlineConfirm title={`${discardLabel} of ${row.case_id}`} tone="danger" busy={busy} confirmLabel="Discard"
        message={<p>Its versions are marked as discarded. Nothing is deleted.</p>}
        confirmUnavailable={unavailable} onConfirm={() => { void discard(); }}
        onCancel={() => { setDiscarding(false); setConsequences(null); onCancel(); }}>
        <Textarea id={`${id}-reason`} label="Reason" required maxLength={2000} value={reason} disabled={consequences !== null}
          onChange={event => setReason(event.target.value)} />
        {consequences && <ul className="documents-plan-consequences">{consequenceLines(consequences).map(line => <li key={line}>{line}</li>)}</ul>}
        {withdrawing && <Checkbox id={`${id}-understood`} label={WITHDRAW_CHECKBOX} checked={understood} onChange={event => setUnderstood(event.target.checked)} />}
        {error !== undefined && <ErrorNotice error={error} />}
      </InlineConfirm>
    </div>;
  }
  return <div className="documents-resolve" role="group" aria-labelledby={`${id}-title`}>
    <h4 id={`${id}-title`} ref={heading} tabIndex={-1} className="inline-confirm-title">{title}</h4>
    <div className="documents-resolve-actions">
      <Button size="sm" onClick={onAssignReview}>Assign a new review…</Button>
      <Button size="sm" onClick={onCorrect}>Correct the translation…</Button>
      <Button size="sm" onClick={() => setDiscarding(true)}>{discardLabel}…</Button>
      <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

function NotAcceptedOptions({ row, projectKey, revision, onDone, onCancel }: ResolveTranslationProps): JSX.Element {
  const id = useId();
  const heading = useHeadingFocus();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const name = textLabel(row);

  const save = async (kind: "review" | "accept") => {
    if (busy || (kind === "accept" && !reason.trim())) return;
    setBusy(true); setError(undefined);
    try {
      const result = kind === "review"
        ? await api.patchWorkPlan(projectKey, row.case_id, row.language, { review: true, expected_revision: revision, confirm: false })
        : await api.patchWorkPlan(projectKey, row.case_id, row.language, { annotate: true, expected_revision: revision, confirm: false, accept_external_review: { reason: reason.trim() } });
      onDone(kind === "review" ? `Review on for ${name}. Next: Assign translation review.` : `${name} accepted as reviewed outside Ontocurator.`,
        { caseId: result.case_id, revision: result.revision });
    } catch (failure: unknown) {
      setError(failure);
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
    {error !== undefined && <ErrorNotice error={error} />}
    <p className="visually-hidden" role="status">{busy ? "Saving…" : ""}</p>
    <div className="documents-resolve-actions">
      <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
      <Button size="sm" aria-disabled={missing || busy ? true : undefined} aria-describedby={missing ? `${id}-missing` : undefined}
        onClick={() => { void save("accept"); }}>Accept and annotate</Button>
    </div>
  </div>;
}
