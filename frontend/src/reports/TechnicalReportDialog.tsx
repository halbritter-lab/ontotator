import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type TechnicalReportContext, type TechnicalReportReceipt } from "../api/client";
import { errorMessage } from "../admin/errors";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InlineMessage } from "../ui/InlineMessage";
import { Textarea } from "../ui/Textarea";
import "./reports.css";
import { closeTechnicalReport, MAX_DESCRIPTION, reportContext, subscribeTechnicalReport, technicalReportOpen } from "./technicalReport";

function requestId(): string {
  try { if (typeof crypto?.randomUUID === "function") return crypto.randomUUID(); } catch { /* insecure context */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The context lines the report carries, as the reporter sees them before sending. */
export function contextLines(context: TechnicalReportContext): string[] {
  const lines = ["App version and browser"];
  if (context.route) lines.push(`Screen: ${context.route}`);
  if (context.viewport) lines.push(`Window size: ${context.viewport}`);
  const error = context.last_api_error;
  if (error) lines.push(`Last error: ${error.code ?? `HTTP ${error.status}`} at ${new Date(error.at).toLocaleString()}`);
  if (context.crash_message) lines.push(`Error message: ${context.crash_message}`);
  return lines;
}

/**
 * "Report a technical problem": the user describes what happened; the app adds the context. It goes to the
 * system administrators and pauses no task. After sending, the dialog shows the reference (TR-12) to quote.
 * Self-contained (api client and plain ui parts only), so the crash screen can show it while the app is broken.
 */
export function TechnicalReportDialog({ crashMessage, onClose }: { crashMessage?: string; onClose: () => void }): JSX.Element {
  // The context of the moment the dialog opened: a failure of the report itself does not replace it.
  const [context] = useState(() => reportContext(crashMessage));
  const [id] = useState(requestId);
  const [description, setDescription] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<TechnicalReportReceipt | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (receipt) close.current?.focus(); }, [receipt]);

  const send = async () => {
    if (busy) return;
    const text = description.trim();
    if (!text) { setFieldError("Describe what happened."); textarea.current?.focus(); return; }
    setBusy(true); setError(null); setFieldError(null);
    try {
      const sent = await api.sendTechnicalReport({ request_id: id, description: text, context });
      if (active.current) setReceipt(sent);
    } catch (failure) {
      if (active.current) setError(failure);
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const footer = receipt
    ? <Button ref={close} onClick={onClose}>Close</Button>
    : <>
      <Button variant="primary" aria-disabled={busy || undefined} onClick={() => { void send(); }}>{busy ? "Sending…" : "Send report"}</Button>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
    </>;
  return <Dialog open title="Report a technical problem" size="md" initialFocus={receipt ? close : textarea}
    // With text typed only Cancel closes: Esc must not drop what the user wrote.
    onClose={busy || (!receipt && description.trim()) ? undefined : onClose} footer={footer}>
    {receipt ? <InlineMessage tone="success">
      <span className="technical-report-receipt">{`Sent to the administrators. Reference: ${receipt.reference}.`}</span>
      {" "}Quote it if you contact an administrator.
    </InlineMessage> : <>
      <p>For an error message, something that does not load, a crash or general feedback. It goes to the system administrators. Your task is not paused. For a problem with the text itself, use <strong>Report a text problem…</strong> instead.</p>
      <Textarea id="technical-report-description" ref={textarea} label="What happened?" rows={6} maxLength={MAX_DESCRIPTION}
        hint="What did you do, and what did you see? Do not add patient details beyond what is needed."
        error={fieldError ?? undefined} value={description} disabled={busy}
        onChange={event => { setDescription(event.target.value); if (fieldError) setFieldError(null); }} />
      <details className="technical-report-context">
        <summary>Added automatically</summary>
        <ul>{contextLines(context).map(line => <li key={line}>{line}</li>)}</ul>
      </details>
      {error !== null && <InlineMessage tone="error">{errorMessage(error)}</InlineMessage>}
    </>}
  </Dialog>;
}

/** The app's one report dialog, opened by `openTechnicalReport()` from the navigation or the editor's More menu. */
export function TechnicalReportHost(): JSX.Element | null {
  const open = useSyncExternalStore(subscribeTechnicalReport, technicalReportOpen, technicalReportOpen);
  return open ? <TechnicalReportDialog onClose={closeTechnicalReport} /> : null;
}
