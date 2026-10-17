import { useEffect, useRef, useState } from "react";
import { api, ApiError, type CurrentUser, type ExportKind } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, InlineMessage, Toolbar } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { useJob } from "./useJob";

export interface ExportPageProps { projectKey: string; currentUser: CurrentUser }
const definitions = [
  { kind: "t1", title: "Annotation results (T1 bundle)", description: "The latest submission of each annotator and task per document, with pseudonyms." },
  { kind: "edit_log", title: "Edit log (JSONL)", description: "Every editing step with pseudonyms, for method analyses." },
  { kind: "translation_reviews", title: "Translation reviews (JSONL)", description: "Immutable translation review decisions with reviewer snapshots and source provenance." },
] as const;
type CardKind = ExportKind | "translation_reviews";
const jobKinds: Record<CardKind, string> = { t1: "t1_export", edit_log: "edit_log_export", translation_reviews: "translation_review_export" };
const exportNames: Record<CardKind, string> = { t1: "an annotation results", edit_log: "an edit log", translation_reviews: "a translation review" };
const denied = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status);
const positiveJobId = (value: string | null) => value !== null && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

function readRemembered(key: string): { id: number | null; storageError: boolean } {
  try { return { id: positiveJobId(sessionStorage.getItem(key)), storageError: false }; }
  catch { return { id: null, storageError: true }; }
}

export function ExportPage({ projectKey, currentUser }: ExportPageProps): JSX.Element {
  return <section><h1>Export</h1>{definitions.map((definition, index) => {
    const storageKey = `ontocurator:export:${JSON.stringify([currentUser.username, projectKey, definition.kind])}`;
    return <ExportCard key={storageKey} projectKey={projectKey} storageKey={storageKey} lead={index === 0} {...definition} />;
  })}</section>;
}

// One primary action per view: only the first (lead) export card carries it.
function ExportCard({ projectKey, storageKey, kind, title, description, lead }: { projectKey: string; storageKey: string; kind: CardKind; title: string; description: string; lead: boolean }): JSX.Element {
  const [remembered] = useState(() => readRemembered(storageKey));
  const [jobId, setJobId] = useState<number | null>(remembered.id);
  const [storageError, setStorageError] = useState(remembered.storageError);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<unknown>();
  const alive = useRef(false);
  const mutation = useRef(false);
  const downloadRequest = useRef(false);
  const { job, error: pollError } = useJob(jobId);
  const expectedKind = jobKinds[kind];
  const correctKind = job?.kind === expectedKind;
  const downloadable = correctKind && job.status === "succeeded";
  const polling = jobId !== null && !pollError && (!job || (job.status !== "failed" && job.status !== "succeeded"));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const remember = (id: number | null) => {
    try { if (id === null) sessionStorage.removeItem(storageKey); else sessionStorage.setItem(storageKey, String(id)); }
    catch { setStorageError(true); }
  };
  useEffect(() => {
    if (pollError !== undefined) {
      setError(pollError);
      if (denied(pollError)) { remember(null); setJobId(null); }
    } else if (job && !correctKind) {
      setError(new Error(`This job is not ${exportNames[kind]} export.`));
      remember(null); setJobId(null);
    }
  }, [pollError, job, correctKind]);
  const start = async () => {
    if (mutation.current || downloadRequest.current || creating || polling) return;
    mutation.current = true; setCreating(true); setError(undefined); setJobId(null); remember(null);
    try {
      const created = await (kind === "translation_reviews" ? api.exportTranslationReviews(projectKey) : api.startExport(projectKey, kind));
      if (!alive.current) return;
      if (!Number.isSafeInteger(created.job_id) || created.job_id <= 0) throw new Error("The server returned an invalid export job ID.");
      setJobId(created.job_id); remember(created.job_id);
    } catch (err: unknown) { if (alive.current) setError(err); }
    finally { if (alive.current) { mutation.current = false; setCreating(false); } }
  };
  const download = async () => {
    if (downloadRequest.current || mutation.current || !correctKind || job?.status !== "succeeded" || jobId === null) return;
    downloadRequest.current = true; setDownloading(true); setError(undefined);
    try {
      // Successful job metadata is not download authorization. Recheck through
      // the authenticated endpoint on every click; never reuse a cached blob.
      const payload = await api.downloadJob(jobId);
      if (alive.current) saveDownload(payload, `${projectKey}-${kind}.${kind === "t1" ? "zip" : "jsonl"}`);
    } catch (err: unknown) {
      if (alive.current) { setError(err); if (denied(err)) { remember(null); setJobId(null); } }
    } finally { if (alive.current) { downloadRequest.current = false; setDownloading(false); } }
  };
  return <section className="detail-section" aria-label={title}>
    <h2>{title}</h2><p>{description}</p>
    <Toolbar label={`${title} actions`}><Button variant={lead && !downloadable ? "primary" : "secondary"} loading={creating} disabled={polling || downloading} onClick={() => { void start(); }}>Create export</Button>
      {downloadable && <Button variant={lead ? "primary" : "secondary"} loading={downloading} onClick={() => { void download(); }}>Download</Button>}
    </Toolbar>
    {polling && <p role="status">Checking export …</p>}
    {correctKind && <p role="status">Export job {job.id}: {job.status}</p>}
    {correctKind && job.status === "failed" && <InlineMessage tone="error">{job.error || "The export failed without further details."}</InlineMessage>}
    {error !== undefined && (error instanceof ApiError && error.status === 403 ? <InlineMessage tone="error">You do not have access to this page.</InlineMessage> : <ErrorNotice error={error} />)}
    {storageError && <InlineMessage tone="warning">This browser cannot remember export jobs. Keep this page open until your export is ready.</InlineMessage>}
  </section>;
}
