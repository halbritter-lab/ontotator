import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ProjectJobView } from "../api/client";
import { saveDownload } from "../api/download";
import { personLabel } from "../app/identity";
import { Time } from "../app/Time";
import { Button, EmptyValue, StatusBadge } from "../ui";
import { ErrorNotice } from "./ErrorNotice";

/** The export jobs the history lists, with their row title and the file suffix of the download. */
const exportKinds: Record<string, { title: string; suffix: string }> = {
  final_t1_export: { title: "Final results", suffix: "zip" },
  final_phenopacket_export: { title: "Phenopackets", suffix: "zip" },
  t1_export: { title: "Annotation results", suffix: "zip" },
  edit_log_export: { title: "Edit log", suffix: "jsonl" },
  work_time_export: { title: "Working time", suffix: "jsonl" },
  translation_review_export: { title: "Translation reviews", suffix: "jsonl" },
};
const stateLabels: Record<ProjectJobView["status"], string> = { queued: "Waiting", running: "Running", succeeded: "Ready", failed: "Failed" };
const PAGE = 20;
const hidden = (error: unknown) => error instanceof ApiError && [403, 404].includes(error.status);

function requester(job: ProjectJobView): JSX.Element | string {
  if (job.requested_by) return personLabel(job.requested_by);
  if (job.requested_by_command_line) return "Command line";
  return <EmptyValue />;
}

/**
 * Every export of the project, newest first, also those started by others or with an API token (issue 355). Leads and
 * system admins only: anyone else is refused by the server, and the section stays away. People appear as the
 * server names them (person references, never logins). `revision` reloads the first page.
 */
export function ExportHistory({ projectKey, revision = 0 }: { projectKey: string; revision?: number }): JSX.Element | null {
  const [jobs, setJobs] = useState<ProjectJobView[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState<number | null>(null);
  const request = useRef(0);

  const load = useCallback(async (offset: number) => {
    const ticket = ++request.current;
    setLoading(true); setError(undefined);
    try {
      const page = await api.listProjectJobs(projectKey, { kind: Object.keys(exportKinds), limit: PAGE, offset });
      if (ticket !== request.current) return;
      setJobs(current => offset === 0 ? page.jobs : [...current, ...page.jobs.filter(job => !current.some(seen => seen.id === job.id))]);
      setTotal(page.total); setLoaded(true);
    } catch (err: unknown) {
      if (ticket !== request.current) return;
      if (hidden(err)) setRefused(true); else setError(err);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [projectKey]);
  useEffect(() => {
    void load(0);
    const requests = request;
    // A late answer for an earlier project or revision is dropped.
    return () => { requests.current++; };
  }, [load, revision, reload]);

  const download = async (job: ProjectJobView) => {
    if (downloading !== null) return;
    setDownloading(job.id); setError(undefined);
    try {
      // The list is no download authorization: the download route checks again on every click.
      const payload = await api.downloadJob(job.id);
      saveDownload(payload, `${projectKey}-${job.id}.${exportKinds[job.kind]?.suffix ?? "zip"}`);
    } catch (err: unknown) { setError(err); }
    finally { setDownloading(null); }
  };

  if (refused) return null;
  return <section className="export-research export-history" aria-labelledby="export-history-heading">
    <div className="export-history-head">
      <h2 id="export-history-heading">Export history</h2>
      <Button size="sm" variant="quiet" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh history</Button>
    </div>
    <p className="export-research-lede">Every export of this project, newest first, also those started by others or with an API token.</p>
    {error !== undefined && <ErrorNotice error={error} onRetry={loaded ? undefined : () => setReload(value => value + 1)} />}
    {loaded && jobs.length === 0 && <p className="cell-secondary">No exports yet.</p>}
    {jobs.length > 0 && <table className="data-table export-research-table export-history-table">
      <thead><tr>
        <th scope="col">Export</th><th scope="col">State</th><th scope="col">Requested by</th>
        <th scope="col">Started</th><th scope="col">Finished</th><th scope="col"><span className="visually-hidden">Action</span></th>
      </tr></thead>
      <tbody>{jobs.map(job => <tr key={job.id} aria-label={`${exportKinds[job.kind]?.title ?? job.kind} ${job.id}`}>
        <th scope="row">{exportKinds[job.kind]?.title ?? job.kind}</th>
        <td>
          <StatusBadge status={job.status}>{stateLabels[job.status]}</StatusBadge>
          {job.status === "failed" && (job.error_code || job.error) && <p className="export-row-status" title={job.error ?? undefined}>{job.error_code ?? job.error}</p>}
        </td>
        <td>{requester(job)}</td>
        <td>{job.started_at ? <Time iso={job.started_at} /> : <EmptyValue />}</td>
        <td>{job.finished_at ? <Time iso={job.finished_at} /> : <EmptyValue />}</td>
        <td>{job.download_path && <Button size="sm" variant="secondary" loading={downloading === job.id} disabled={downloading !== null && downloading !== job.id} onClick={() => { void download(job); }}>Download</Button>}</td>
      </tr>)}</tbody>
    </table>}
    {jobs.length < total && <div><Button size="sm" variant="secondary" loading={loading} onClick={() => { void load(jobs.length); }}>Show older exports</Button></div>}
  </section>;
}
