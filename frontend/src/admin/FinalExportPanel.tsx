import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FinalPreflight } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, Checkbox, InlineMessage } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { routeHref } from "../app/router";
import { FINAL_SELECTION_CHANGED } from "../variants/finalSelectionState";
import { useJob } from "./useJob";
import { Time } from "../app/Time";

type Row = { case_id: string; language: string };
type Line = Row & { why: string };
const rowKey = (row: Row) => JSON.stringify([row.case_id, row.language]);
/** Every omission also arrives as this warning; it is listed under "Left out", not under "Needs your decision". */
const LEFT_OUT = "MISSING_FINAL_SELECTION";
/** Rows beyond this collapse behind "Show all {n}", so a large project does not push the actions off screen. */
const SHOWN_ROWS = 5;
/** One group of the "what needs attention" table: a header row, the first rows, then "Show all {n}". */
function Group({ projectKey, title, lines, muted = false }: { projectKey: string; title: string; lines: readonly Line[]; muted?: boolean }): JSX.Element | null {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  return <tbody aria-label={title}>
    <tr className="final-export-group"><th scope="rowgroup" colSpan={3}>{title} ({lines.length})</th></tr>
    {(all ? lines : lines.slice(0, SHOWN_ROWS)).map((line, index) => <tr key={`${rowKey(line)}-${index}`}>
      <td>{line.case_id} {line.language}</td>
      <td className={muted ? "cell-muted" : undefined}>{line.why}</td>
      <td><a className="btn btn-secondary btn-sm" aria-label={`Open in Documents, ${line.case_id} ${line.language}`}
        href={routeHref({ name: "projectDocuments", key: projectKey, case: line.case_id, language: line.language })}>Open in Documents</a></td>
    </tr>)}
    {!all && lines.length > SHOWN_ROWS && <tr><td colSpan={3}><Button size="sm" onClick={() => setAll(true)}>Show all {lines.length}</Button></td></tr>}
  </tbody>;
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
 * changes (while the page is visible) rerun it. "Create final export" is primary; open decisions and
 * left-out texts ask for the acknowledgement, which names the counts; the download stays an explicit click.
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
  const [exported, setExported] = useState(0);
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
    if (needsAck(state) && !accepted) { acknowledgement.current?.focus(); return; }
    creatingRef.current = true;
    setExported(state.selections.length);
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
  const warnings = state ? state.warnings.filter(warning => warning.code !== LEFT_OUT) : [];
  const decided = new Set(warnings.map(rowKey));
  // One row per text, whatever number of warnings it has.
  const decisions = [...decided].map(key => {
    const lines = warnings.filter(warning => rowKey(warning) === key);
    return { ...lines[0], why: [...new Set(lines.map(warning => warning.reason))].join(" ") };
  });
  // One row per text: a text that needs a decision is not listed again under "Left out".
  const leftOut = (state?.omissions ?? []).filter(row => !decided.has(rowKey(row)));
  const clear = state && !state.warnings.length && !state.omissions.length && !notInPlan.length;
  const blockedBy = creating ? undefined
    : checking ? "final-export-checking"
    : !state ? "final-export-recheck"
    : !state.selections.length ? "final-export-empty"
    : needsAck(state) && !accepted ? "final-export-ack-hint" : undefined;
  return <section className="final-export-card" aria-labelledby="final-export-heading">
    <div className="final-export-head">
      <div>
        <h2 id="final-export-heading">Final results</h2>
        <p className="final-export-lede">The results you accepted as final, with a receipt. A missing result is never replaced by another submission.</p>
      </div>
      {phase === "check" && <Button ref={checkButton} variant="quiet" size="sm" loading={checking} aria-disabled={creating ? "true" : undefined} aria-describedby={creating ? "final-export-creating-hint" : undefined} onClick={checkAgain}>Check again</Button>}
    </div>
    {changed && <InlineMessage tone="info">{CHANGED_TEXT[changed]}</InlineMessage>}
    {phase === "check" && <>
      {checking && <p id="final-export-checking" role="status">Checking final results…</p>}
      {checkError != null && <ErrorNotice error={checkError} />}
      {error != null && <ErrorNotice error={error} />}
      {!checking && !state && <p id="final-export-recheck" className="field-hint">Check again to confirm the current selections and warnings.</p>}
      {state && <section className="final-export-check" aria-label="Export check">
        {clear && state.selections.length > 0
          ? <p className="final-export-clear"><span className="final-export-ok" aria-hidden="true">✓</span> {state.selections.length === 1 ? "The text has a final result." : `All ${state.selections.length} texts have a final result.`} Nothing to check.</p>
          : <>
            <dl className="stat-row stat-row--number-first">
              <div><dt>ready to export</dt><dd>{state.selections.length}</dd></div>
              <div><dt>left out: no final result</dt><dd>{leftOut.length}</dd></div>
              <div><dt>need your decision</dt><dd>{decided.size}</dd></div>
            </dl>
            {!clear && <table className="data-table final-export-table">
              <caption className="visually-hidden">Texts that need attention</caption>
              <thead><tr><th scope="col">Text</th><th scope="col">Why</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
              <Group projectKey={projectKey} title="Needs your decision" lines={decisions} />
              <Group projectKey={projectKey} title="Left out: no final result" muted lines={leftOut.map(row => ({ ...row, why: "No final result selected" }))} />
              <Group projectKey={projectKey} title="Not planned, not exported" muted lines={notInPlan.map(row => ({ ...row, why: "Annotate is off in the work plan. For information only." }))} />
            </table>}
          </>}
        {!state.selections.length && <InlineMessage tone="info"><span id="final-export-empty">No final results are selected yet. Accept submitted results in Documents to include them.</span>{" "}
          <a href={routeHref({ name: "projectDocuments", key: projectKey })}>Go to Documents</a></InlineMessage>}
        {needsAck(state) && <Checkbox ref={acknowledgement} id="final-export-ack"
          label={`Export ${state.selections.length === 1 ? "the 1 result as it is" : `the ${state.selections.length} results as they are`}${state.omissions.length ? `; leave out the other ${state.omissions.length === 1 ? "text" : `${state.omissions.length} texts`}` : ""}`}
          checked={accepted} disabled={creating} onChange={event => setAccepted(event.target.checked)} />}
      </section>}
      {creating && <p id="final-export-creating-hint" className="field-hint">The export is being created.</p>}
      <div className="final-export-actions" role="group" aria-label="Final export actions">
        <Button variant="primary" loading={creating} aria-disabled={blockedBy ? "true" : undefined} aria-describedby={blockedBy} onClick={() => { void start(); }}>Create final export</Button>
        {blockedBy === "final-export-ack-hint" && <span id="final-export-ack-hint" className="field-hint">Tick the box above to continue.</span>}
      </div>
    </>}
    {jobError != null && <ErrorNotice error={jobError} />}
    {job && !succeeded && !failed && <p role="status">Creating the final export…</p>}
    {failed && <InlineMessage tone="error"><p>Final export could not be created.</p><details><summary>Technical diagnostics</summary><pre>{job.error}</pre></details></InlineMessage>}
    {phase === "job" && <>
      {error != null && <ErrorNotice error={error} />}
      {succeeded && <InlineMessage tone="success" title={`Final export ready: ${exported} ${exported === 1 ? "result" : "results"}`}>
        <p>Created <Time iso={job.finished_at ?? job.created_at} />.</p>
      </InlineMessage>}
      {!succeeded && <p id="final-export-download-hint" className="field-hint">The download is available when the export has finished.</p>}
      <div className="final-export-actions" role="group" aria-label="Final export download">
        <Button variant="primary" loading={downloading} aria-disabled={succeeded ? undefined : "true"} aria-describedby={succeeded ? undefined : "final-export-download-hint"} onClick={() => { void download(); }}>Download (ZIP)</Button>
        {succeeded && <Button onClick={newExport}>Prepare a new export</Button>}
      </div>
    </>}
    {phase === "check" && <details className="final-export-details"><summary>What is in the file?</summary>
      <p className="cell-secondary">A ZIP with one result file per text, a plain-language guide (README.txt) and a table of every result (index.csv).</p></details>}
  </section>;
}

/** Open decisions and left-out texts both need the lead's explicit, counted confirmation (issue 194). */
function needsAck(state: FinalPreflight): boolean {
  return state.omissions.length > 0 || state.warnings.some(warning => warning.code !== LEFT_OUT);
}
