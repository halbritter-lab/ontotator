import { useEffect, useRef, useState } from "react";
import { api, type AssignmentView, type ProjectDocumentSummary, type Member, type ProjectSettings, type CaseSummary, type TranslationReviewRecord, type CurrentUser } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Button, Checkbox, DataTable, Dialog, EmptyState, Select, TextInput, Toolbar, type Column } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { UploadPanel } from "./UploadPanel";
import { AssignDialog } from "./AssignDialog";
import { DistributionDialog } from "./DistributionDialog";
import { AssignmentActions } from "./AssignmentActions";
import { originLabels, translationStatusLabels } from "./variantMetadata";

export interface DocumentsPageProps { projectKey: string; query: ProjectDocumentsQuery; onNavigate: (route: Route) => void; canOverrideTranslationStatus?: boolean; currentUser?: Pick<CurrentUser, "username"> }
const statuses = ["unassigned", "open", "in_progress", "submitted", "reopened"];

export function DocumentsPage(props: DocumentsPageProps): JSX.Element {
  return <DocumentEditor key={JSON.stringify([props.projectKey, props.currentUser?.username])} {...props} />;
}
function DocumentEditor({ projectKey, query, onNavigate, canOverrideTranslationStatus = false }: DocumentsPageProps): JSX.Element {
  const [rows, setRows] = useState<ProjectDocumentSummary[]>([]);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [error, setError] = useState<unknown>();
  const [settingsError, setSettingsError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignmentError, setAssignmentError] = useState<unknown>();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [caseError, setCaseError] = useState<unknown>();
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);
  const [assignmentDialog, setAssignmentDialog] = useState<{ kind: "manual" | "distribution"; documents: ProjectDocumentSummary[]; identity: string } | null>(null);
  const selectionIdentity = JSON.stringify([query.language, query.status, query.q, query.select, query.origin, query.translation_status]);
  // Invalidate selection dialogs without remounting the focused filter controls.
  const currentSelection = useRef(selectionIdentity);
  currentSelection.current = selectionIdentity;
  const visibleDialog = assignmentDialog?.identity === selectionIdentity ? assignmentDialog : null;
  useEffect(() => { setAssignmentDialog(null); setReviewDocument(null); }, [selectionIdentity]);
  const request = useRef(0);
  const language = query.language || undefined;
  const status = statuses.includes(query.status ?? "") ? query.status : undefined;
  const q = query.q || undefined;
  const origin = Object.hasOwn(originLabels, query.origin ?? "") ? query.origin : undefined;
  const translationStatus = Object.hasOwn(translationStatusLabels, query.translation_status ?? "") ? query.translation_status : undefined;
  const preselect = query.select;
  useEffect(() => {
    let active = true; setCases(null); setCaseError(undefined);
    void api.listCases(projectKey).then(value => { if (active) setCases(value); }, failure => { if (active) setCaseError(failure); });
    return () => { active = false; };
  }, [projectKey, revision]);
  useEffect(() => {
    let active = true;
    setAssignmentError(undefined); setAssignments([]);
    void Promise.all([api.listAssignments(projectKey), api.listMembers(projectKey)]).then(([inventory, people]) => {
      if (active) { setAssignments(inventory); setMembers(people); }
    }).catch((failure: unknown) => { if (active) setAssignmentError(failure); });
    return () => { active = false; };
  }, [projectKey, revision]);
  useEffect(() => {
    let active = true;
    setSettings(null); setSettingsError(undefined); setUploadOpen(false);
    void api.getProjectSettings(projectKey).then(value => { if (active) setSettings(value); }, err => { if (active) setSettingsError(err); });
    return () => { active = false; };
  }, [projectKey]);
  useEffect(() => {
    const generation = ++request.current;
    setLoading(true); setError(undefined); setRows([]); setSelected(new Set());
    void api.listProjectDocuments(projectKey, { language, status, q, ...(origin ? { origin } : {}), ...(translationStatus ? { translation_status: translationStatus } : {}) }).then(documents => {
      if (request.current !== generation) return;
      setRows(documents);
      setSelected(new Set(preselect && documents.some(doc => doc.document_id === preselect) ? [preselect] : []));
      setLoading(false);
    }, err => { if (request.current === generation) { setError(err); setLoading(false); } });
    return () => { request.current++; };
  }, [projectKey, language, status, q, origin, translationStatus, preselect, revision]);
  const navigate = (patch: ProjectDocumentsQuery) => onNavigate({ name: "projectDocuments", key: projectKey, language: query.language, status: query.status, q: query.q, ...(query.origin === undefined ? {} : { origin: query.origin }), ...(query.translation_status === undefined ? {} : { translation_status: query.translation_status }), select: undefined, ...patch });
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const assignmentsChanged = (identity: string) => { if (currentSelection.current === identity) setRevision(value => value + 1); };
  const columns: Column<ProjectDocumentSummary>[] = [
    { id: "select", header: <Checkbox id="documents-all" label="Select all visible" disabled={!rows.length || loading} checked={rows.length > 0 && rows.every(doc => selected.has(doc.document_id))} onChange={event => setSelected(new Set(event.target.checked ? rows.map(doc => doc.document_id) : []))} />, cell: doc => <Checkbox id={`document-select-${encodeURIComponent(doc.document_id)}`} label={`Select ${doc.document_id}`} checked={selected.has(doc.document_id)} onChange={() => toggle(doc.document_id)} /> },
    { id: "id", header: "Document ID", cell: doc => doc.document_id },
    { id: "external-id", header: "External ID", cell: doc => doc.external_id },
    { id: "case", header: "Case", cell: doc => {
      if (typeof doc.case_id !== "string") return null;
      const destination: Route = { name: "projectCase", key: projectKey, caseId: doc.case_id, variant: doc.document_id };
      return <a href={routeHref(destination)} aria-label={`View case for ${doc.document_id}`} onClick={event => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate(destination);
      }}>{doc.case_id}</a>;
    } },
    { id: "language", header: "Language", cell: doc => doc.language },
    { id: "version", header: "Version", cell: doc => doc.version },
    { id: "origin", header: "Origin", cell: doc => originLabels[doc.origin] },
    { id: "translation-status", header: "Translation status", cell: doc => <span title={doc.status_reason ?? undefined}>{doc.accepted_without_review ? "Accepted without review" : doc.translation_status ? translationStatusLabels[doc.translation_status] : "—"}</span> },
    { id: "reviews", header: "Reviews", cell: doc => doc.translation_status != null ? <Button size="sm" onClick={() => setReviewDocument(doc.document_id)} aria-label={`Reviews for ${doc.document_id}`}>Reviews</Button> : null },
    { id: "assignees", header: "Assignees", cell: doc => doc.assignees?.length ? <ul>{doc.assignees.map(assignee => {
      const actual = assignments.find(item => item.id === assignee.assignment_id && item.document_id === doc.document_id && item.project_key === projectKey && !item.revoked_at);
      return <li key={assignee.assignment_id}><span>{assignee.pseudonym}: {assignee.task} {assignee.status}</span>{actual && <AssignmentActions assignment={actual} members={members} onChanged={() => assignmentsChanged(selectionIdentity)} />}</li>;
    })}</ul> : "Unassigned" },
  ];
  return <section className="detail-section">
    <h1>Documents</h1>
    <Toolbar label="Document filters">
      <Select id="documents-language" label="Language" value={query.language ?? ""} onChange={event => navigate({ language: event.target.value || undefined })}><option value="">All languages</option>{[...new Set([...(settings?.languages ?? []), ...rows.map(doc => doc.language), ...(query.language ? [query.language] : [])])].map(value => <option key={value} value={value}>{value}</option>)}</Select>
      <Select id="documents-status" label="Status" value={status ?? ""} onChange={event => navigate({ status: event.target.value || undefined })}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</Select>
      <TextInput id="documents-prefix" label="ID prefix" value={query.q ?? ""} onChange={event => navigate({ q: event.target.value || undefined })} />
      <Select id="documents-origin" label="Origin" value={origin ?? ""} onChange={event => navigate({ origin: event.target.value || undefined })}><option value="">All origins</option>{Object.entries(originLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Select id="documents-translation-status" label="Translation status" value={translationStatus ?? ""} onChange={event => navigate({ translation_status: event.target.value || undefined })}><option value="">All translation statuses</option>{Object.entries(translationStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
    </Toolbar>
    <Toolbar label="Document actions"><span aria-live="polite">{selected.size} selected</span><Button disabled={!settings} onClick={() => setUploadOpen(true)}>Upload documents</Button><Button disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh documents</Button>
      <Button disabled={loading || !selected.size} onClick={() => setAssignmentDialog({ kind: "manual", documents: rows.filter(doc => selected.has(doc.document_id)), identity: selectionIdentity })}>Assign …</Button>
      <Button disabled={loading || !selected.size} onClick={() => setAssignmentDialog({ kind: "distribution", documents: rows.filter(doc => selected.has(doc.document_id)), identity: selectionIdentity })}>Propose distribution …</Button>
    </Toolbar>
    {settingsError !== undefined && <ErrorNotice error={settingsError} />}
    {error !== undefined && <ErrorNotice error={error} />}
    {assignmentError !== undefined && <ErrorNotice error={assignmentError} />}
    {caseError !== undefined && <ErrorNotice error={caseError} />}
    {loading && <p role="status">Loading documents …</p>}
    <DataTable label="Documents" columns={columns} rows={rows} rowKey={doc => doc.document_id} rowProps={doc => ({ "data-testid": "document-row", selected: selected.has(doc.document_id) })} empty={<EmptyState title="No documents">Try another filter or upload documents to this project.</EmptyState>} />
    <Dialog open={uploadOpen} title="Upload documents" size="lg" onClose={() => setUploadOpen(false)}>{uploadOpen && settings && <UploadPanel key={projectKey} projectKey={projectKey} languages={settings.languages ?? []} canOverrideTranslationStatus={canOverrideTranslationStatus} onImported={() => setRevision(value => value + 1)} />}</Dialog>
    {reviewDocument !== null && <ReviewHistory key={reviewDocument} projectKey={projectKey} documentId={reviewDocument} onClose={() => setReviewDocument(null)} />}
    {visibleDialog?.kind === "manual" && <AssignDialog projectKey={projectKey} cases={cases} documents={visibleDialog.documents} onClose={() => setAssignmentDialog(null)} onChanged={() => assignmentsChanged(visibleDialog.identity)} />}
    {visibleDialog?.kind === "distribution" && <DistributionDialog projectKey={projectKey} cases={cases} documents={visibleDialog.documents} onClose={() => setAssignmentDialog(null)} onChanged={() => assignmentsChanged(visibleDialog.identity)} />}
  </section>;
}

function ReviewHistory({ projectKey, documentId, onClose }: { projectKey: string; documentId: string; onClose: () => void }): JSX.Element {
  const [records, setRecords] = useState<TranslationReviewRecord[] | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void api.listTranslationReviews(projectKey, documentId).then(value => { if (active) setRecords(value); }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [projectKey, documentId]);
  return <Dialog open title={`Translation reviews: ${documentId}`} size="lg" onClose={onClose}>
    {error !== undefined && <ErrorNotice error={error} />}{records === null && error === undefined && <p role="status">Loading reviews …</p>}
    {records?.length === 0 && <p>No translation reviews.</p>}
    {records && <ol>{records.map(record => <li key={record.id}><p>{record.reviewer_pseudonym} · {record.reviewer_qualification} · {record.reviewer_languages.join(", ")} · <time dateTime={record.created_at}>{new Date(record.created_at).toLocaleString()}</time></p><p>{record.decision.replaceAll("_", " ")} · {record.status_before} → {record.status_after}</p><p>{record.clinical_change ? "Clinical change" : "No clinical change"}{record.categories.length ? `: ${record.categories.join(", ")}` : ""}</p>{record.rationale && <p>{record.rationale}</p>}{record.created_variant_id && <p>Created variant: {record.created_variant_id}</p>}</li>)}</ol>}
  </Dialog>;
}
