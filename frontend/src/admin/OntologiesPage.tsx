import { useEffect, useRef, useState } from "react";
import { api, ApiError, type AdminOntology, type OntologyUploadResult } from "../api/client";
import { routeHref, type Route } from "../app/router";
import { Button, DataTable, EmptyState, Field, InlineMessage, Toolbar, type Column, EmptyValue } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { formatDateTime } from "../app/labels";

export interface OntologiesPageProps { onNavigate: (route: Route) => void }

export function OntologiesPage({ onNavigate }: OntologiesPageProps): JSX.Element {
  const [inventory, setInventory] = useState<AdminOntology[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [selection, setSelection] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>();
  const [outcomes, setOutcomes] = useState<OntologyUploadResult[] | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<unknown>();
  const lifetime = useRef(0);
  const request = useRef(0);
  const uploading = useRef(false);

  const refresh = async (epoch: number) => {
    const generation = ++request.current;
    setLoading(true); setLoadError(undefined);
    try {
      const rows = await api.adminListOntologies();
      if (lifetime.current === epoch && request.current === generation) setInventory(rows);
    } catch (error: unknown) {
      if (lifetime.current === epoch && request.current === generation) setLoadError(error);
    } finally {
      if (lifetime.current === epoch && request.current === generation) setLoading(false);
    }
  };

  useEffect(() => {
    const epoch = ++lifetime.current;
    void refresh(epoch);
    return () => { lifetime.current++; request.current++; };
  }, []);

  const submit = async () => {
    if (uploading.current || loading || inventory === null || !selection.length) return;
    const epoch = lifetime.current;
    uploading.current = true; setBusy(true); setUploadError(undefined); setOutcomes(null);
    try {
      const results = await api.adminUploadOntologies(selection);
      if (lifetime.current === epoch) setOutcomes(results);
    } catch (error: unknown) {
      if (lifetime.current === epoch) setUploadError(error);
    } finally {
      // Each file persists independently. A refused later file can leave
      // earlier files stored, so every settled request needs a fresh inventory.
      if (lifetime.current === epoch) {
        await refresh(epoch);
        if (lifetime.current === epoch) { uploading.current = false; setBusy(false); }
      }
    }
  };

  const copy = async (item: AdminOntology) => {
    if (copying !== null) return;
    const epoch = lifetime.current;
    setCopying(item.sha256); setCopied(null); setCopyError(undefined);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(item.sha256);
      if (lifetime.current === epoch) setCopied(item.filename);
    } catch (error: unknown) {
      if (lifetime.current === epoch) setCopyError(error);
    } finally {
      if (lifetime.current === epoch) setCopying(null);
    }
  };

  const columns: Column<AdminOntology>[] = [
    { id: "filename", header: "File name", cell: item => item.filename, sortValue: item => item.filename },
    { id: "kind", header: "Kind", cell: item => item.kind },
    { id: "prefix", header: "Prefix", cell: item => item.prefix },
    { id: "release", header: "Release", cell: item => item.release ?? <EmptyValue /> },
    { id: "language", header: "Language", cell: item => item.language ?? <EmptyValue /> },
    { id: "sha", header: "SHA-256", cell: item => <><code title={item.sha256}>{item.sha256.slice(0, 12)}</code>{" "}<Button size="sm" aria-label={`Copy SHA-256 for ${item.filename}`} disabled={copying !== null} onClick={() => { void copy(item); }}>Copy</Button></> },
    { id: "uploaded", header: "Uploaded at", cell: item => <time dateTime={item.uploaded_at}>{formatDateTime(item.uploaded_at)}</time> },
    { id: "projects", header: "Pinned by", cell: item => item.projects.length ? <ul className="pinned-projects">{item.projects.map(key => {
      // The Ontology tab holds the pins (issue 168).
      const route: Route = { name: "projectSettings", key, section: "ontology" };
      return <li key={key}><a href={routeHref(route)} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate(route);
      }}>{key}</a></li>;
    })}</ul> : "Not pinned" },
  ];
  const outcomeLabels: Record<OntologyUploadResult["status"], string> = { added: "Added", already_present: "Already present" };
  const outcomeColumns: Column<OntologyUploadResult & { inputIndex: number }>[] = [
    { id: "filename", header: "Uploaded file", cell: result => result.filename },
    { id: "status", header: "Result", cell: result => outcomeLabels[result.status] },
  ];

  return <div className="density-compact">
    <section className="detail-section">
      <h1>Ontologies</h1>
      <Field id="ontology-files" label="Ontology files" hint="OBO Graph JSON ontologies and Babelon translation files">
        <input type="file" className="form-control" accept=".json,.tsv" multiple disabled={busy} onChange={event => {
          setSelection(Array.from(event.target.files ?? [])); setUploadError(undefined); setOutcomes(null);
        }} />
      </Field>
      <p>Files are stored individually. If an upload fails, earlier files may already be available below.</p>
      <Toolbar label="Ontology upload">
        <Button variant="primary" disabled={busy || loading || inventory === null || !selection.length} onClick={() => { void submit(); }}>Upload files</Button>
      </Toolbar>
      {busy && <InlineMessage tone="info">Uploading {selection.length} {selection.length === 1 ? "file" : "files"} …</InlineMessage>}
      {uploadError !== undefined && <>
        <ErrorNotice error={uploadError} />
        {uploadError instanceof ApiError && uploadError.code === "INVALID_ONTOLOGY" && <p>{uploadError.message}</p>}
      </>}
      {outcomes !== null && <DataTable label="Upload results" rows={outcomes.map((result, inputIndex) => ({ ...result, inputIndex }))} columns={outcomeColumns} rowKey={result => String(result.inputIndex)} />}
    </section>
    <section className="detail-section" aria-label="Ontology inventory">
      <h2>Uploaded files</h2>
      <Toolbar label="Inventory actions"><Button disabled={busy || loading} onClick={() => { void refresh(lifetime.current); }}>Refresh inventory</Button></Toolbar>
      {loading && <InlineMessage tone="info">Loading ontology files…</InlineMessage>}
      {loadError !== undefined && <ErrorNotice error={loadError} />}
      {copyError !== undefined && <ErrorNotice error={copyError} />}
      {copied && <InlineMessage tone="success">Copied SHA-256 for {copied}.</InlineMessage>}
      {inventory !== null && <DataTable label="Ontology files" rows={inventory} columns={columns} rowKey={item => item.sha256} empty={<EmptyState title="No ontology files uploaded yet." />} />}
    </section>
  </div>;
}
