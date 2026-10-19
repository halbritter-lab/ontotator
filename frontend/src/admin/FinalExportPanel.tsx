import { useRef, useState, useEffect } from "react";
import { api, type FinalPreflight } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, Checkbox, InlineMessage } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { WorkflowWarnings } from "./ProjectDashboardPage";
import { useJob } from "./useJob";

export function FinalExportPanel({ projectKey, username }: { projectKey: string; username: string }): JSX.Element {
  return <FinalExportContent key={JSON.stringify([projectKey, username])} projectKey={projectKey} />;
}
function FinalExportContent({ projectKey }: { projectKey: string }): JSX.Element {
  const [state, setState] = useState<FinalPreflight>();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [jobId, setJobId] = useState<number | null>(null);
  const requestId = useRef("");
  const alive = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const { job, error: jobError } = useJob(jobId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const invalidate = (event: Event) => {
      if ((event as CustomEvent<{ projectKey: string }>).detail.projectKey !== projectKey) return;
      generation.current += 1;
      setState(undefined); setAccepted(false);
    };
    window.addEventListener("ontocurator:final-selection-changed", invalidate);
    return () => window.removeEventListener("ontocurator:final-selection-changed", invalidate);
  }, [projectKey]);
  const review = async () => {
    if (pending.current) return;
    pending.current = true;
    const current = ++generation.current;
    setBusy(true); setAccepted(false); setError(undefined); setState(undefined);
    try { const next = await api.finalExportPreflight(projectKey); if (alive.current && current === generation.current) { setState(next); requestId.current = crypto.randomUUID(); } }
    catch (err) { if (alive.current) setError(err); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const start = async () => {
    if (!state || pending.current || !state.selections.length || (state.warnings.length > 0 && !accepted)) return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try {
      const result = await api.startFinalExport(projectKey, { request_id: requestId.current, state_digest: state.state_digest, acknowledged_warnings: state.warnings.map(({ id, cause_revision }) => ({ id, cause_revision })), accepted_omissions: state.omissions });
      if (alive.current) { setJobId(result.job_id); setState(undefined); setAccepted(false); }
    } catch (err) { if (alive.current) { setError(err); setState(undefined); setAccepted(false); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const download = async () => {
    if (!jobId || pending.current || job?.kind !== "final_t1_export" || job.status !== "succeeded") return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try { const file = await api.downloadJob(jobId); if (alive.current) saveDownload(file, `${projectKey}-final.zip`); }
    catch (err) { if (alive.current) setError(err); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="detail-section" aria-label="Selected final results"><h2>Selected final results</h2><p>Export the exact results selected by the lead, with an audit receipt. Missing selections are disclosed; another submission is never substituted.</p>
    <Button variant="primary" disabled={busy} onClick={() => { void review(); }}>Review final export</Button>
    {error != null && <><ErrorNotice error={error} /><p>Review final export again to confirm the current selections and warnings.</p></>}
    {state && <div><h3>Export preflight</h3><p>{state.selections.length} selected results</p><WorkflowWarnings state={state} />
      {state.warnings.length > 0 && <Checkbox id="final-export-ack" label="Export these selected results with the listed warnings and omissions" checked={accepted} onChange={event => setAccepted(event.target.checked)} />}
      {!state.selections.length && <InlineMessage tone="warning">Select at least one submitted result before exporting.</InlineMessage>}
      <Button disabled={busy || !state.selections.length || (state.warnings.length > 0 && !accepted)} onClick={() => { void start(); }}>Create final export</Button>
      <a href={`#/projects/${encodeURIComponent(projectKey)}/documents`}>Return to results</a>
    </div>}
    {jobError != null && <ErrorNotice error={jobError} />}
    {job && <p role="status">Final export {job.id}: {job.status}</p>}
    {job?.status === "failed" && <InlineMessage tone="error"><p>Final export could not be created.</p><details><summary>Technical diagnostics</summary><pre>{job.error}</pre></details></InlineMessage>}
    {job?.kind === "final_t1_export" && job.status === "succeeded" && <Button disabled={busy} onClick={() => { void download(); }}>Download final export</Button>}
  </section>;
}
