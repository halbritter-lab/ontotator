import { useEffect, useRef, useState } from "react";
import { api, ApiError, type CurrentUser, type ExportKind } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, InlineMessage, Toolbar } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { ERROR_MESSAGES } from "./errors";
import { useJob } from "./useJob";
import { jobStatusLabels, labelFor } from "../app/labels";

export interface ExportPageProps { projectKey: string; currentUser: CurrentUser }
const jsonl = "JSONL file: one JSON record per line";
const definitions = [
  { kind: "t1", title: "Annotation results", format: "ZIP of T1 (ontospan) bundles",
    description: "The latest submission of each person for each document and task, with pseudonyms instead of names. Use it for analysis or to load the annotations into another tool that reads ontospan. Unresolved proposals are included in exports with a separate reviewer flag and note. Clinical axis values are unchanged. Bundles with reviewer flags cannot currently be re-imported into proposal storage." },
  { kind: "edit_log", title: "Edit log", format: jsonl,
    description: "Every editing step in order, with pseudonyms. For method studies, such as how long annotation took or how decisions changed; read it with a script, for example in Python or R." },
  { kind: "translation_reviews", title: "Translation reviews", format: jsonl,
    description: "Every translation review decision, with the reviewer's qualification at that time and the source text it refers to. For reporting on translation quality." },
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

const record = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exportFailureReasons: Record<string, string> = {
  UNKNOWN_TERM: "The term is not in the project's pinned ontology.",
  OBSOLETE_TERM: "The term is obsolete in the project's pinned ontology.",
  INCOMPLETE_AXES: "Required clinical axis values are missing.",
  TARGET_NOT_FOUND: "The original finding version is missing.",
};

function ExportFailure({ result, error }: { result: Record<string, unknown> | null; error: string | null }): JSX.Element {
  const failure = record(result?.error);
  const details = record(failure?.details);
  const cause = record(details?.cause);
  if (failure?.code !== "EXPORT_UNRESOLVED_INVALID" || !details || typeof cause?.code !== "string") {
    return <InlineMessage tone="error">{error || "The export failed without further details."}</InlineMessage>;
  }
  const causeDetails = record(cause.details);
  return <InlineMessage tone="error">
    <p>{ERROR_MESSAGES.EXPORT_UNRESOLVED_INVALID}</p>
    <p>Document: {String(details.document_id)} · Submission: {String(details.submission_id)}</p>
    <p>Finding: {String(details.annotation_id)} · Version: {String(details.version)}</p>
    <p>{exportFailureReasons[cause.code] || ERROR_MESSAGES[cause.code] || "The finding does not meet the project profile."} ({cause.code})</p>
    {typeof cause.details === "string" && <p>{cause.details}</p>}
    {typeof causeDetails?.term_id === "string" && <p>Term: {causeDetails.term_id}</p>}
    <p>If this review is not available to reopen, ask the project lead or server operator to correct its imported history.</p>
  </InlineMessage>;
}

export function ExportPage({ projectKey, currentUser }: ExportPageProps): JSX.Element {
  return <section><h1>Export</h1>{definitions.map((definition, index) => {
    const storageKey = `ontocurator:export:${JSON.stringify([currentUser.username, projectKey, definition.kind])}`;
    return <ExportCard key={storageKey} projectKey={projectKey} storageKey={storageKey} lead={index === 0} {...definition} />;
  })}</section>;
}

// One primary action per view: only the first (lead) export card carries it.
function ExportCard({ projectKey, storageKey, kind, title, format, description, lead }: { projectKey: string; storageKey: string; kind: CardKind; title: string; format: string; description: string; lead: boolean }): JSX.Element {
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
    <h2>{title}</h2><p>{description}</p><p className="cell-secondary">Format: {format}</p>
    <Toolbar label={`${title} actions`}><Button variant={lead && !downloadable ? "primary" : "secondary"} loading={creating} disabled={polling || downloading} onClick={() => { void start(); }}>Create export</Button>
      {downloadable && <Button variant={lead ? "primary" : "secondary"} loading={downloading} onClick={() => { void download(); }}>Download</Button>}
    </Toolbar>
    {polling && <p role="status">Checking export …</p>}
    {correctKind && <p role="status">Export {job.id}: {labelFor(jobStatusLabels, job.status)}</p>}
    {correctKind && job.status === "failed" && <ExportFailure result={job.result} error={job.error} />}
    {downloadable && kind === "t1" && typeof job.result?.counts === "object" && job.result.counts !== null && <p>
      {String((job.result.counts as Record<string, unknown>).uncertain ?? 0)} unresolved result(s) included with reviewer flags; {String((job.result.counts as Record<string, unknown>).rejected ?? 0)} rejected result(s) omitted.
    </p>}
    {downloadable && Array.isArray(job.result?.warnings) && job.result.warnings.map((warning, index) => {
      if (typeof warning !== "object" || warning === null || !("code" in warning) || warning.code !== "LEGACY_UNRESOLVED_NOTE_MISSING") return null;
      const item = warning as Record<string, unknown>;
      return <InlineMessage key={index} tone="warning">Historical unresolved proposal {String(item.annotation_id)} ({String(item.version)}) has no reviewer note. It is included with its reviewer flag and without an invented note.</InlineMessage>;
    })}
    {error !== undefined && (error instanceof ApiError && error.status === 403 ? <InlineMessage tone="error">You do not have access to this page.</InlineMessage> : <ErrorNotice error={error} />)}
    {storageError && <InlineMessage tone="warning">This browser cannot remember export jobs. Keep this page open until your export is ready.</InlineMessage>}
  </section>;
}
