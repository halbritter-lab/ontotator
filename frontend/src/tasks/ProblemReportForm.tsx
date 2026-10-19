import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { api, ApiError, type AssignmentView, type ProblemReportRequest, type ProblemReportView } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { Button, Checkbox, InlineMessage, Textarea } from "../ui";

const CHANGED_CODES = new Set(["WORKFLOW_REVISION_CONFLICT", "ROUND_KEY_MISMATCH", "REPORT_SUBMISSION_INVALID"]);

type FormError = { kind: "changed" } | { kind: "ambiguous" } | { kind: "other"; error: unknown };

function classify(failure: unknown): FormError {
  if (failure instanceof ApiError && failure.code && CHANGED_CODES.has(failure.code)) return { kind: "changed" };
  if (failure instanceof ApiError && failure.code === "AMBIGUOUS_REVIEW_ROUND") return { kind: "ambiguous" };
  return { kind: "other", error: failure };
}

export interface ProblemReportFormFrame {
  body: ReactNode;
  footer: ReactNode;
  initialFocus: RefObject<HTMLTextAreaElement>;
  /** Escape and the dialog's header Close: asks first when text was typed; undefined while a write is busy. */
  onClose?: () => void;
}

const inlineFrame = ({ body, footer }: ProblemReportFormFrame): JSX.Element => <>{body}<div className="modal-actions">{footer}</div></>;

/**
 * "New problem report": one textarea, one consequence sentence and the footer actions. The caller places
 * body and footer through `frame` (the reporter dialog puts the footer into the dialog footer).
 */
export function ProblemReportForm({ assignment, onSaveBeforeReport, onReported, onBusyChange, onCancel, onClose, onAssignmentReload, frame = inlineFrame }: {
  assignment: AssignmentView;
  onSaveBeforeReport: () => Promise<void>;
  onReported: (report: ProblemReportView) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Cancel (after the discard question when text was typed). */
  onCancel?: () => void;
  /** Escape / header Close without typed text. */
  onClose?: () => void;
  /** "Try again" after a create conflict reloads the task and hands it over here. */
  onAssignmentReload?: (assignment: AssignmentView) => void;
  frame?: (parts: ProblemReportFormFrame) => JSX.Element;
}): JSX.Element {
  const id = useId();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<FormError | null>(null);
  const [saveFailed, setSaveFailed] = useState(false), [keepUnsaved, setKeepUnsaved] = useState(false);
  const [busy, setBusy] = useState(false), [askDiscard, setAskDiscard] = useState(false);
  const active = useRef(false), writing = useRef(false), requests = useRef(new Map<string, ProblemReportRequest>());
  const textarea = useRef<HTMLTextAreaElement>(null), checkbox = useRef<HTMLInputElement>(null), keepWriting = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (askDiscard) keepWriting.current?.focus(); }, [askDiscard]);
  const gated = saveFailed && !keepUnsaved;
  const gateId = `${id}-gate`;

  const submit = async (task: AssignmentView = assignment, fresh = false) => {
    if (writing.current) return;
    const text = reason.trim();
    if (!text) { setFieldError("Describe the problem."); textarea.current?.focus(); return; }
    if (gated) { checkbox.current?.focus(); return; }
    writing.current = true; setBusy(true); onBusyChange?.(true); setError(null); setAskDiscard(false);
    try {
      if (!(saveFailed && keepUnsaved)) {
        try { await onSaveBeforeReport(); }
        catch { if (active.current) { setSaveFailed(true); setKeepUnsaved(false); } return; }
      }
      const key = JSON.stringify([task.id, task.workflow_revision, task.active_round_id, task.last_submission_id, text]);
      if (fresh) requests.current.delete(key);
      let request = requests.current.get(key);
      if (!request) {
        request = { request_id: crypto.randomUUID(), expected_workflow_revision: task.workflow_revision, round_id: task.active_round_id ?? null, submission_id: task.last_submission_id ?? null, reason: text };
        requests.current.set(key, request);
      }
      const report = await api.createProblemReport(task.id, request);
      if (active.current) onReported(report);
    } catch (failure) { if (active.current) setError(classify(failure)); }
    finally { writing.current = false; if (active.current) setBusy(false); onBusyChange?.(false); }
  };

  const tryAgain = async () => {
    if (writing.current) return;
    let fresh: AssignmentView;
    try { fresh = await api.getAssignmentMetadata(assignment.id); }
    catch (failure) { if (active.current) setError({ kind: "other", error: failure }); return; }
    onAssignmentReload?.(fresh);
    await submit(fresh, true);
  };

  const cancel = () => { if (busy) return; if (reason.trim()) setAskDiscard(true); else onCancel?.(); };
  const close = () => { if (reason.trim()) setAskDiscard(true); else onClose?.(); };

  const submitted = assignment.status === "submitted";
  const body = <form className="problem-report-form" onSubmit={event => { event.preventDefault(); void submit(); }} noValidate>
    <Textarea ref={textarea} id={`${id}-text`} label="What is the problem?" rows={6} required value={reason} readOnly={busy}
      hint="Only you and project leads can read this." error={fieldError}
      onChange={event => { setReason(event.target.value); if (fieldError) setFieldError(null); }} />
    {saveFailed && <>
      <InlineMessage tone="error">Your latest changes could not be saved. Nothing was reported.</InlineMessage>
      <Checkbox ref={checkbox} id={`${id}-keep`} label="Report anyway. My unsaved changes stay only in this open editor until I resume and save."
        checked={keepUnsaved} onChange={event => setKeepUnsaved(event.target.checked)} />
      {gated && <p id={gateId} className="field-hint">Check the box to report without saving.</p>}
    </>}
    {error?.kind === "changed" && <InlineMessage tone="error">
      Your task changed in another window or by a project lead. Nothing was reported. Your text is kept.{" "}
      <Button size="sm" onClick={() => { void tryAgain(); }}>Try again</Button>
    </InlineMessage>}
    {error?.kind === "ambiguous" && <InlineMessage tone="error">This task's current round is unclear. Nothing was reported. Ask a project lead.</InlineMessage>}
    {error?.kind === "other" && <ErrorNotice error={error.error} />}
    {askDiscard && <div role="group" aria-label="Discard this report?" className="problem-discard">
      <p>Discard this report? Your text will be lost.</p>
      <Button size="sm" variant="danger" onClick={() => { setAskDiscard(false); onCancel?.(); }}>Discard</Button>{" "}
      <Button size="sm" ref={keepWriting} onClick={() => { setAskDiscard(false); textarea.current?.focus(); }}>Keep writing</Button>
    </div>}
    <p className="problem-consequence">{submitted
      ? "Reporting pauses this task. Your submitted result stays unchanged and readable."
      : "Reporting pauses this task: you cannot save or submit until the pause is released. Your saved work stays."}</p>
  </form>;
  const footer = <>
    <Button variant="primary" loading={busy} aria-disabled={gated || undefined} aria-describedby={gated ? gateId : undefined}
      onClick={() => { void submit(); }}>Report and pause my task</Button>
    <Button variant="quiet" aria-disabled={busy || undefined} onClick={cancel}>Cancel</Button>
  </>;
  return frame({ body, footer, initialFocus: textarea, onClose: busy ? undefined : close });
}
