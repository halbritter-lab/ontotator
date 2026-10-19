import { useRef, useState, useEffect } from "react";
import { api, type FinalPreflight } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, Checkbox, InlineMessage, Toolbar } from "../ui";
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
  const [changed, setChanged] = useState(false);
  const requestId = useRef("");
  const alive = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const preflightOpen = useRef(false);
  const focusPrepare = useRef(false);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const acknowledgement = useRef<HTMLInputElement>(null);
  const { job, error: jobError } = useJob(jobId);
  preflightOpen.current = state !== undefined;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const invalidate = (event: Event) => {
      if ((event as CustomEvent<{ projectKey: string }>).detail.projectKey !== projectKey) return;
      if (preflightOpen.current || pending.current) setChanged(true);
      generation.current += 1;
      setState(undefined); setAccepted(false);
    };
    window.addEventListener("ontocurator:final-selection-changed", invalidate);
    return () => window.removeEventListener("ontocurator:final-selection-changed", invalidate);
  }, [projectKey]);
  useEffect(() => { if (state) heading.current?.focus(); }, [state]);
  useEffect(() => {
    if (focusPrepare.current && prepareButton.current) { focusPrepare.current = false; prepareButton.current.focus(); }
  });
  const review = async () => {
    if (pending.current) return;
    pending.current = true;
    const current = ++generation.current;
    setBusy(true); setAccepted(false); setError(undefined); setState(undefined); setChanged(false);
    try { const next = await api.finalExportPreflight(projectKey); if (alive.current && current === generation.current) { setState(next); requestId.current = crypto.randomUUID(); } }
    catch (err) { if (alive.current) setError(err); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const start = async () => {
    if (!state || pending.current || !state.selections.length) return;
    if (state.warnings.length > 0 && !accepted) { acknowledgement.current?.focus(); return; }
    pending.current = true;
    setBusy(true); setError(undefined);
    try {
      const result = await api.startFinalExport(projectKey, { request_id: requestId.current, state_digest: state.state_digest, acknowledged_warnings: state.warnings.map(({ id, cause_revision }) => ({ id, cause_revision })), accepted_omissions: state.omissions });
      if (alive.current) { setJobId(result.job_id); setState(undefined); setAccepted(false); }
    } catch (err) { if (alive.current) { setError(err); setState(undefined); setAccepted(false); focusPrepare.current = true; } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const creating = busy && state !== undefined;
  const cancel = () => {
    if (creating) return;
    generation.current += 1;
    setState(undefined); setAccepted(false); setError(undefined); setChanged(false);
    focusPrepare.current = true;
  };
  const download = async () => {
    if (!jobId || pending.current || job?.kind !== "final_t1_export" || job.status !== "succeeded") return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try { const file = await api.downloadJob(jobId); if (alive.current) saveDownload(file, `${projectKey}-final.zip`); }
    catch (err) { if (alive.current) setError(err); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const newExport = () => { setJobId(null); setError(undefined); focusPrepare.current = true; };
  const failed = job?.status === "failed";
  const succeeded = job?.kind === "final_t1_export" && job.status === "succeeded";
  const phase = state ? "preflight" : jobId !== null && !failed && jobError == null ? "job" : "idle";
  const blockedBy = !state ? undefined
    : !state.selections.length ? "final-export-empty"
    : state.warnings.length > 0 && !accepted ? "final-export-ack-hint" : undefined;
  return <section className="detail-section" aria-label="Selected final results"><h2>Selected final results</h2>
    <p>Export the exact results selected by the lead, with an audit receipt. Missing selections are disclosed; another submission is never substituted.</p>
    <p>The archive includes README.txt and index.csv, a plain-language guide and a table of every result.</p>
    {changed && <InlineMessage tone="info">Final selections changed. Prepare the export again.</InlineMessage>}
    {phase === "idle" && <Button ref={prepareButton} variant="primary" loading={busy} onClick={() => { void review(); }}>Prepare final export</Button>}
    {error != null && <><ErrorNotice error={error} /><p>Prepare the final export again to confirm the current selections and warnings.</p></>}
    {state && <section className="final-export-preflight" aria-labelledby="final-export-preflight-heading">
      <h3 id="final-export-preflight-heading" ref={heading} tabIndex={-1}>Export preflight</h3>
      <p>{state.selections.length} selected results · {state.warnings.length} warnings · {state.omissions.length} omitted</p>
      <WorkflowWarnings state={state} />
      {state.warnings.length > 0 && <Checkbox ref={acknowledgement} id="final-export-ack" label="Export these selected results with the listed warnings and omissions" checked={accepted} disabled={creating} onChange={event => setAccepted(event.target.checked)} />}
      {!state.selections.length && <InlineMessage tone="warning"><span id="final-export-empty">Select at least one submitted result before exporting.</span></InlineMessage>}
      {blockedBy === "final-export-ack-hint" && <p id="final-export-ack-hint" className="field-hint">Confirm the warnings and omissions above to continue.</p>}
      {creating && <p id="final-export-cancel-hint" className="field-hint">The export is being created.</p>}
      <Toolbar label="Final export actions">
        <Button variant="primary" loading={creating} aria-disabled={blockedBy ? "true" : undefined} aria-describedby={blockedBy} onClick={() => { void start(); }}>Create final export</Button>
        <Button variant="quiet" aria-disabled={creating ? "true" : undefined} aria-describedby={creating ? "final-export-cancel-hint" : undefined} onClick={cancel}>Cancel</Button>
      </Toolbar>
    </section>}
    {jobError != null && <ErrorNotice error={jobError} />}
    {job && <p role="status">Final export {job.id}: {job.status}</p>}
    {failed && <InlineMessage tone="error"><p>Final export could not be created.</p><details><summary>Technical diagnostics</summary><pre>{job.error}</pre></details></InlineMessage>}
    {phase === "job" && (succeeded
      ? <Toolbar label="Final export download">
          <Button variant="primary" loading={busy} onClick={() => { void download(); }}>Download final export</Button>
          <Button onClick={newExport}>Prepare a new export</Button>
        </Toolbar>
      : <>
          <p id="final-export-download-hint" className="field-hint">The download is available when the export has finished.</p>
          <Button variant="primary" aria-disabled="true" aria-describedby="final-export-download-hint">Download final export</Button>
        </>)}
  </section>;
}
