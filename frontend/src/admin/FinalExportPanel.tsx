import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FinalPreflight } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, Checkbox, InlineMessage, Toolbar } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { routeHref } from "../app/router";
import { FINAL_SELECTION_CHANGED } from "../variants/finalSelectionState";
import { useJob } from "./useJob";

function RowLink({ projectKey, caseId, language }: { projectKey: string; caseId: string; language: string }): JSX.Element {
  return <a href={routeHref({ name: "projectDocuments", key: projectKey, case: caseId, language })}>Show {caseId} · {language}</a>;
}
function WorkflowWarnings({ projectKey, state }: { projectKey: string; state: FinalPreflight }): JSX.Element {
  const notInPlan = state.not_in_plan ?? [];
  return <>
    {state.warnings.length > 0
      ? <ul className="final-warning-list">{state.warnings.map(warning => <li key={warning.id}><strong>{warning.case_id} · {warning.language}</strong><p>{warning.reason}</p><RowLink projectKey={projectKey} caseId={warning.case_id} language={warning.language} /></li>)}</ul>
      : <p>No open workflow warnings.</p>}
    {state.omissions.length > 0 && <><p>Omitted without a final selection:</p>
      <ul className="final-warning-list" aria-label="Omitted without a final selection">{state.omissions.map(item => <li key={JSON.stringify([item.case_id, item.language])}><RowLink projectKey={projectKey} caseId={item.case_id} language={item.language} /></li>)}</ul></>}
    {notInPlan.length > 0 && <><p>Not in plan, not exported: these rows have a final result, but Annotate is off in the work plan. For information; nothing to confirm.</p>
      <ul className="final-warning-list" aria-label="Not in plan, not exported">{notInPlan.map(item => <li key={JSON.stringify([item.case_id, item.language])}><RowLink projectKey={projectKey} caseId={item.case_id} language={item.language} /></li>)}</ul></>}
  </>;
}

type Changed = "rerun" | "hidden" | "after_job";
const CHANGED_TEXT: Record<Changed, string> = {
  rerun: "Final selections changed. The check was run again.",
  hidden: "Final selections changed. The check runs again when you return to this page.",
  after_job: "Final selections changed after this export was created.",
};

export function FinalExportPanel({ projectKey, username }: { projectKey: string; username: string }): JSX.Element {
  return <FinalExportContent key={JSON.stringify([projectKey, username])} projectKey={projectKey} />;
}
/**
 * The final export (D8): the preflight runs when the panel opens, "Check again" and final-selection
 * changes (while the page is visible) rerun it. "Create final export" is primary; warnings keep the
 * acknowledgement; the download stays an explicit click.
 */
function FinalExportContent({ projectKey }: { projectKey: string }): JSX.Element {
  const [state, setState] = useState<FinalPreflight>();
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState<unknown>();
  const [accepted, setAccepted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [jobId, setJobId] = useState<number | null>(null);
  const [changed, setChanged] = useState<Changed | null>(null);
  const requestId = useRef("");
  const alive = useRef(false);
  const creatingRef = useRef(false);
  const downloadingRef = useRef(false);
  const generation = useRef(0);
  const inJob = useRef(false);
  const staleWhileHidden = useRef(false);
  const focusCheck = useRef(false);
  const checkButton = useRef<HTMLButtonElement>(null);
  const acknowledgement = useRef<HTMLInputElement>(null);
  const { job, error: jobError } = useJob(jobId);
  const failed = job?.status === "failed";
  const succeeded = job?.kind === "final_t1_export" && job.status === "succeeded";
  const phase = jobId !== null && !failed && jobError == null ? "job" : "check";
  inJob.current = phase === "job" || creating;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const review = useCallback(async () => {
    if (creatingRef.current) return;
    const current = ++generation.current;
    staleWhileHidden.current = false;
    setChecking(true); setState(undefined); setAccepted(false); setCheckError(undefined); setError(undefined);
    try {
      const next = await api.finalExportPreflight(projectKey);
      if (alive.current && current === generation.current) { setState(next); requestId.current = crypto.randomUUID(); }
    } catch (err) { if (alive.current && current === generation.current) setCheckError(err); }
    finally { if (alive.current && current === generation.current) setChecking(false); }
  }, [projectKey]);

  useEffect(() => { void review(); }, [review]);
  useEffect(() => {
    const invalidate = (event: Event) => {
      if ((event as CustomEvent<{ projectKey?: string }>).detail?.projectKey !== projectKey) return;
      if (inJob.current) { setChanged("after_job"); return; }
      if (document.visibilityState === "hidden") {
        generation.current += 1; staleWhileHidden.current = true;
        setState(undefined); setAccepted(false); setChecking(false); setChanged("hidden");
        return;
      }
      setChanged("rerun");
      void review();
    };
    const visible = () => {
      if (document.visibilityState === "hidden" || !staleWhileHidden.current || inJob.current) return;
      setChanged("rerun");
      void review();
    };
    window.addEventListener(FINAL_SELECTION_CHANGED, invalidate);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener(FINAL_SELECTION_CHANGED, invalidate); document.removeEventListener("visibilitychange", visible); };
  }, [projectKey, review]);
  useEffect(() => {
    if (focusCheck.current && checkButton.current) { focusCheck.current = false; checkButton.current.focus(); }
  });

  const checkAgain = () => {
    if (creatingRef.current) return;
    setJobId(null); setChanged(null);
    void review();
  };
  const start = async () => {
    if (!state || checking || creatingRef.current || !state.selections.length) return;
    if (state.warnings.length > 0 && !accepted) { acknowledgement.current?.focus(); return; }
    creatingRef.current = true;
    setCreating(true); setError(undefined);
    try {
      const result = await api.startFinalExport(projectKey, { request_id: requestId.current, state_digest: state.state_digest, acknowledged_warnings: state.warnings.map(({ id, cause_revision }) => ({ id, cause_revision })), accepted_omissions: state.omissions });
      if (alive.current) { setJobId(result.job_id); setState(undefined); setAccepted(false); }
    } catch (err) { if (alive.current) { setError(err); setState(undefined); setAccepted(false); setChanged(null); focusCheck.current = true; } }
    finally { creatingRef.current = false; if (alive.current) setCreating(false); }
  };
  const download = async () => {
    if (!jobId || downloadingRef.current || !succeeded) return;
    downloadingRef.current = true;
    setDownloading(true); setError(undefined);
    try { const file = await api.downloadJob(jobId); if (alive.current) saveDownload(file, `${projectKey}-final.zip`); }
    catch (err) { if (alive.current) setError(err); }
    finally { downloadingRef.current = false; if (alive.current) setDownloading(false); }
  };
  const newExport = () => { focusCheck.current = true; checkAgain(); };

  const notInPlan = state?.not_in_plan ?? [];
  const blockedBy = creating ? undefined
    : checking ? "final-export-checking"
    : !state ? "final-export-recheck"
    : !state.selections.length ? "final-export-empty"
    : state.warnings.length > 0 && !accepted ? "final-export-ack-hint" : undefined;
  return <section className="detail-section" aria-label="Selected final results"><h2>Selected final results</h2>
    <p>Export the exact results selected by the lead, with an audit receipt. Missing selections are disclosed; another submission is never substituted.</p>
    <p>The archive includes README.txt and index.csv, a plain-language guide and a table of every result.</p>
    {changed && <InlineMessage tone="info">{CHANGED_TEXT[changed]}</InlineMessage>}
    {phase === "check" && <>
      {checking && <p id="final-export-checking" role="status">Checking final results…</p>}
      {checkError != null && <ErrorNotice error={checkError} />}
      {error != null && <ErrorNotice error={error} />}
      {!checking && !state && <p id="final-export-recheck" className="field-hint">Check again to confirm the current selections and warnings.</p>}
      {state && <section className="final-export-preflight" aria-labelledby="final-export-preflight-heading">
        <h3 id="final-export-preflight-heading" tabIndex={-1}>Export preflight</h3>
        <p>{state.selections.length} selected results · {state.warnings.length} warnings · {state.omissions.length} omitted{notInPlan.length > 0 && ` · ${notInPlan.length} not in plan`}</p>
        <WorkflowWarnings projectKey={projectKey} state={state} />
        {state.warnings.length > 0 && <Checkbox ref={acknowledgement} id="final-export-ack" label="Export these selected results with the listed warnings and omissions" checked={accepted} disabled={creating} onChange={event => setAccepted(event.target.checked)} />}
        {!state.selections.length && <InlineMessage tone="warning"><span id="final-export-empty">Select at least one submitted result before exporting.</span></InlineMessage>}
        {blockedBy === "final-export-ack-hint" && <p id="final-export-ack-hint" className="field-hint">Confirm the warnings and omissions above to continue.</p>}
      </section>}
      {creating && <p id="final-export-creating-hint" className="field-hint">The export is being created.</p>}
      <Toolbar label="Final export actions">
        <Button variant="primary" loading={creating} aria-disabled={blockedBy ? "true" : undefined} aria-describedby={blockedBy} onClick={() => { void start(); }}>Create final export</Button>
        <Button ref={checkButton} loading={checking} aria-disabled={creating ? "true" : undefined} aria-describedby={creating ? "final-export-creating-hint" : undefined} onClick={checkAgain}>Check again</Button>
      </Toolbar>
    </>}
    {jobError != null && <ErrorNotice error={jobError} />}
    {job && <p role="status">Final export {job.id}: {job.status}</p>}
    {failed && <InlineMessage tone="error"><p>Final export could not be created.</p><details><summary>Technical diagnostics</summary><pre>{job.error}</pre></details></InlineMessage>}
    {phase === "job" && <>
      {error != null && <ErrorNotice error={error} />}
      {succeeded
        ? <Toolbar label="Final export download">
            <Button variant="primary" loading={downloading} onClick={() => { void download(); }}>Download final export</Button>
            <Button onClick={newExport}>Prepare a new export</Button>
          </Toolbar>
        : <>
            <p id="final-export-download-hint" className="field-hint">The download is available when the export has finished.</p>
            <Button variant="primary" aria-disabled="true" aria-describedby="final-export-download-hint">Download final export</Button>
          </>}
    </>}
  </section>;
}
