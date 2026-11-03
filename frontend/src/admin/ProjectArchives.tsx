import { useState } from "react";
import { api, type JobView, type ProjectSummary } from "../api/client";
import { saveDownload } from "../api/download";
import { Button, Checkbox, InlineMessage, Select, TextInput } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { useJob } from "./useJob";

const archiveJob = (id: number): Promise<JobView> => api.adminGetArchiveJob(id);

interface ImportedPerson { pseudonym: string; archived_pseudonym?: string; username?: string; linked_to?: string }
interface ImportResult {
  project: string;
  name: string;
  renamed: boolean;
  archived_project: string;
  rows: number;
  renamed_pseudonyms?: Record<string, string>;
  people: { mapped: ImportedPerson[]; pseudonym_only: ImportedPerson[] };
  verification: { ok: boolean; rows_checked: number; files_checked: number };
}

/** A failed job's error text without the exception class ("DomainError: "). */
const failure = (job: JobView) => (job.error ?? "The job failed.").replace(/^\w+Error: /, "");

/**
 * Projects page, administrators only (issue 306): export one project as a project archive for another server, and import
 * an archive as a new project. Both run as jobs; the import checks every table against the archive's manifest.
 */
export function ProjectArchives({ projects }: { projects: readonly ProjectSummary[] }): JSX.Element {
  const [projectKey, setProjectKey] = useState("");
  const [withOntologies, setWithOntologies] = useState(true);
  const [exportId, setExportId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [rename, setRename] = useState(false);
  const [importId, setImportId] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const exported = useJob(exportId, { get: archiveJob });
  const imported = useJob(importId, { get: archiveJob });
  const chosen = projectKey || projects[0]?.project_key || "";
  const running = (job: JobView | null, id: number | null) => id !== null && (job === null || job.status === "queued" || job.status === "running");

  const startExport = async () => {
    setBusy(true); setError(null);
    try { setExportId((await api.adminExportArchive(chosen, withOntologies)).job_id); }
    catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const download = async () => {
    if (exportId === null) return;
    setError(null);
    try { saveDownload(await api.adminDownloadArchive(exportId), `${chosen}-archive.zip`); } catch (cause) { setError(cause); }
  };
  const startImport = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      setImportId((await api.adminImportArchive(file, rename)).job_id);
      setFile(null); setFileKey(value => value + 1);
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const result = imported.job?.status === "succeeded" ? imported.job.result as unknown as ImportResult : null;

  return <section className="project-archives" aria-labelledby="project-archives-heading">
    <h2 id="project-archives-heading">Project archives</h2>
    <p>A project archive holds one complete project with its people and files, to move it to another server. It names people with their e-mail addresses: keep it private.</p>
    {error != null && <ErrorNotice error={error} />}
    <h3>Export a project</h3>
    {projects.length === 0 ? <p>There is no project to export.</p> : <>
      <Select id="project-archive-project" label="Project" value={chosen} onChange={event => setProjectKey(event.target.value)}>
        {projects.map(item => <option key={item.project_key} value={item.project_key}>{item.name} ({item.project_key})</option>)}
      </Select>
      <Checkbox id="project-archive-ontologies" label="Include ontology files" checked={withOntologies}
        hint="Without them, the other server must have the same ontology and translation files."
        onChange={event => setWithOntologies(event.target.checked)} />
      <Button variant="primary" loading={busy || running(exported.job, exportId)} onClick={() => { void startExport(); }}>Export archive</Button>
    </>}
    {exported.error != null && <ErrorNotice error={exported.error} />}
    {exported.job?.status === "failed" && <InlineMessage tone="error" title="Export failed">{failure(exported.job)}</InlineMessage>}
    {exported.job?.status === "succeeded" && <InlineMessage tone="success" title="Archive ready">
      <p>{String(exported.job.result?.rows ?? 0)} rows and {String(exported.job.result?.blobs ?? 0)} files.</p>
      <Button size="sm" onClick={() => { void download(); }}>Download archive</Button>
    </InlineMessage>}
    <h3>Import an archive</h3>
    <TextInput key={fileKey} id="project-archive-file" type="file" label="Archive file (.zip)" accept=".zip,application/zip"
      onChange={event => setFile(event.target.files?.[0] ?? null)} />
    <Checkbox id="project-archive-rename" label="Give people new pseudonyms where theirs are taken here" checked={rename}
      hint="Otherwise an archive whose work names a pseudonym someone here already has is refused."
      onChange={event => setRename(event.target.checked)} />
    <Button variant="primary" disabled={!file} loading={busy || running(imported.job, importId)} onClick={() => { void startImport(); }}>Import archive</Button>
    {imported.error != null && <ErrorNotice error={imported.error} />}
    {imported.job?.status === "failed" && <InlineMessage tone="error" title="Import failed">{failure(imported.job)}</InlineMessage>}
    {result && <InlineMessage tone="success" title="Project imported">
      <p>{result.name} ({result.project}){result.renamed ? `, renamed from ${result.archived_project}` : ""}: {result.rows} rows, {result.verification.ok ? "verified against the manifest" : "not verified"}.</p>
      <p>Matched to people here: {result.people.mapped.map(item => item.username ?? item.pseudonym).join(", ") || "nobody"}.
        {" "}Pseudonym-only people: {result.people.pseudonym_only.map(item => item.pseudonym).join(", ") || "none"}.</p>
    </InlineMessage>}
  </section>;
}
