import { useEffect, useRef, useState } from "react";
import { api, type DocumentSummary, type ProjectSettings } from "../api/client";
import type { ProjectDocumentsQuery, Route } from "../app/router";
import { Button, Checkbox, DataTable, Dialog, EmptyState, Select, TextInput, Toolbar, type Column } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { UploadPanel } from "./UploadPanel";

export interface DocumentsPageProps { projectKey: string; query: ProjectDocumentsQuery; onNavigate: (route: Route) => void }
const statuses = ["unassigned", "open", "in_progress", "submitted", "reopened"];

export function DocumentsPage({ projectKey, query, onNavigate }: DocumentsPageProps): JSX.Element {
  const [rows, setRows] = useState<DocumentSummary[]>([]);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<unknown>();
  const [settingsError, setSettingsError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const language = query.language || undefined;
  const status = statuses.includes(query.status ?? "") ? query.status : undefined;
  const q = query.q || undefined;
  const preselect = query.select;
  useEffect(() => {
    let active = true;
    setSettings(null); setSettingsError(undefined); setUploadOpen(false);
    void api.getProjectSettings(projectKey).then(value => { if (active) setSettings(value); }, err => { if (active) setSettingsError(err); });
    return () => { active = false; };
  }, [projectKey]);
  useEffect(() => {
    const generation = ++request.current;
    setLoading(true); setError(undefined); setRows([]); setSelected(new Set());
    void api.listProjectDocuments(projectKey, { language, status, q }).then(documents => {
      if (request.current !== generation) return;
      setRows(documents);
      setSelected(new Set(preselect && documents.some(doc => doc.document_id === preselect) ? [preselect] : []));
      setLoading(false);
    }, err => { if (request.current === generation) { setError(err); setLoading(false); } });
    return () => { request.current++; };
  }, [projectKey, language, status, q, preselect, revision]);
  const navigate = (patch: ProjectDocumentsQuery) => onNavigate({ name: "projectDocuments", key: projectKey, language: query.language, status: query.status, q: query.q, select: undefined, ...patch });
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const columns: Column<DocumentSummary>[] = [
    { id: "select", header: <Checkbox id="documents-all" label="Select all visible" disabled={!rows.length || loading} checked={rows.length > 0 && rows.every(doc => selected.has(doc.document_id))} onChange={event => setSelected(new Set(event.target.checked ? rows.map(doc => doc.document_id) : []))} />, cell: doc => <Checkbox id={`document-select-${encodeURIComponent(doc.document_id)}`} label={`Select ${doc.document_id}`} checked={selected.has(doc.document_id)} onChange={() => toggle(doc.document_id)} /> },
    { id: "id", header: "Document ID", cell: doc => doc.document_id },
    { id: "language", header: "Language", cell: doc => doc.language },
    { id: "assignees", header: "Assignees", cell: doc => doc.assignees?.length ? <ul>{doc.assignees.map(assignee => <li key={assignee.assignment_id}>{assignee.pseudonym}: {assignee.task} {assignee.status}</li>)}</ul> : "Unassigned" },
  ];
  return <section className="detail-section">
    <h1>Documents</h1>
    <Toolbar label="Document filters">
      <Select id="documents-language" label="Language" value={query.language ?? ""} onChange={event => navigate({ language: event.target.value || undefined })}><option value="">All languages</option>{[...new Set([...(settings?.languages ?? []), ...rows.map(doc => doc.language), ...(query.language ? [query.language] : [])])].map(value => <option key={value} value={value}>{value}</option>)}</Select>
      <Select id="documents-status" label="Status" value={status ?? ""} onChange={event => navigate({ status: event.target.value || undefined })}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</Select>
      <TextInput id="documents-prefix" label="ID prefix" value={query.q ?? ""} onChange={event => navigate({ q: event.target.value || undefined })} />
    </Toolbar>
    <Toolbar label="Document actions"><span aria-live="polite">{selected.size} selected</span><Button disabled={!settings} onClick={() => setUploadOpen(true)}>Upload documents</Button><Button disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh documents</Button></Toolbar>
    {settingsError !== undefined && <ErrorNotice error={settingsError} />}
    {error !== undefined && <ErrorNotice error={error} />}
    {loading && <p role="status">Loading documents …</p>}
    <DataTable label="Documents" columns={columns} rows={rows} rowKey={doc => doc.document_id} rowProps={doc => ({ "data-testid": "document-row", selected: selected.has(doc.document_id) })} empty={<EmptyState title="No documents">Try another filter or upload documents to this project.</EmptyState>} />
    <Dialog open={uploadOpen} title="Upload documents" size="lg" onClose={() => setUploadOpen(false)}>{uploadOpen && settings && <UploadPanel key={projectKey} projectKey={projectKey} languages={settings.languages ?? []} onImported={() => setRevision(value => value + 1)} />}</Dialog>
  </section>;
}
