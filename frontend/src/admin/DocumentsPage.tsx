import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type AssignmentView, type ProjectDocumentSummary, type Member, type ProjectSettings, type CaseSummary, type TranslationReviewRecord, type CurrentUser } from "../api/client";
import { routeHref, type ProjectDocumentsQuery, type Route } from "../app/router";
import { Button, Checkbox, DataTable, Dialog, EmptyState, InlineMessage, Select, StatusBadge, TextInput, Toolbar, type Column } from "../ui";
import { ErrorNotice } from "./ErrorNotice";
import { UploadPanel } from "./UploadPanel";
import { AssignDialog } from "./AssignDialog";
import { DistributionDialog } from "./DistributionDialog";
import { AssignmentActions } from "./AssignmentActions";
import { AssigneeSummary } from "./assignmentUI";
import { assignmentStatusLabels, formatDateTime, labelFor } from "../app/labels";
import { categoryLabels, decisionLabels } from "../translation/labels";
import { originLabels, translationStatusLabels, reviewLanguages } from "./variantMetadata";
import { buildDocumentTree, type DocumentVersionNode } from '../variants/documentTree';
import { SubmissionHistory } from '../variants/SubmissionHistory';
import { useFinalSelectionState } from '../variants/finalSelectionState';
import { TranslationCorrectionAction } from '../variants/TranslationCorrectionAction';

export interface DocumentsPageProps { projectKey: string; query: ProjectDocumentsQuery; onNavigate: (route: Route) => void; canOverrideTranslationStatus?: boolean; currentUser?: Pick<CurrentUser, "username"> }
const statuses = ["unassigned", "open", "in_progress", "submitted", "reopened"];
function disclosureKey(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const parent = event.currentTarget.parentElement;
  if (!(parent instanceof HTMLDetailsElement)) return;
  event.preventDefault();
  parent.open = !parent.open;
}

export function DocumentsPage(props: DocumentsPageProps): JSX.Element {
  return <DocumentEditor key={JSON.stringify([props.projectKey, props.currentUser?.username])} {...props} />;
}
function DocumentEditor({ projectKey, query, onNavigate, canOverrideTranslationStatus = false, currentUser }: DocumentsPageProps): JSX.Element {
  const finalResults = useFinalSelectionState(projectKey, currentUser?.username);
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
  const tree = cases ? buildDocumentTree(cases, new Set(rows.map(row => row.document_id))) : [];
  const groupedIds = new Set<string>();
  const collect = (node: DocumentVersionNode) => { if (node.matching) groupedIds.add(node.variant.document_id); node.children.forEach(collect); };
  tree.forEach(item => item.languages.forEach(language => language.roots.forEach(collect)));
  const returnFilters: ProjectDocumentsQuery = Object.fromEntries(Object.entries(query).filter(([key, value]) =>
    ['language', 'status', 'q', 'select', 'origin', 'translation_status'].includes(key) && value !== undefined));
  const destinationFor = (caseId: string, documentId: string): Route => ({ name: 'projectCase', key: projectKey, caseId, variant: documentId,
    ...(Object.keys(returnFilters).length ? { documents: returnFilters } : {}) });
  const columns: Column<ProjectDocumentSummary>[] = [
    { id: "select", header: <Checkbox id="documents-all" label={<span className="visually-hidden">Select all visible</span>} disabled={!rows.length || loading} checked={rows.length > 0 && rows.every(doc => selected.has(doc.document_id))} onChange={event => setSelected(new Set(event.target.checked ? rows.map(doc => doc.document_id) : []))} />, cell: doc => <Checkbox id={`document-select-${encodeURIComponent(doc.document_id)}`} label={<span className="visually-hidden">Select {doc.document_id}</span>} checked={selected.has(doc.document_id)} onChange={() => toggle(doc.document_id)} /> },
    { id: "id", header: "Document ID", cell: doc => doc.document_id },
    // The external ID only adds information when some row's differs from its document ID.
    ...(rows.some(doc => doc.external_id && doc.external_id !== doc.document_id) ? [{ id: "external-id", header: "External ID", cell: (doc: ProjectDocumentSummary) => doc.external_id }] : []),
    { id: "case", header: "Case", cell: doc => {
      if (typeof doc.case_id !== "string") return null;
      const destination = destinationFor(doc.case_id, doc.document_id);
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
    { id: "assignees", header: "Assignees", cell: doc => doc.assignees?.length ? <ul className="assignee-list">{doc.assignees.map(assignee => {
      const actual = assignments.find(item => item.id === assignee.assignment_id && item.document_id === doc.document_id && item.project_key === projectKey && !item.revoked_at);
      return <li key={assignee.assignment_id}><AssigneeSummary name={members.find(member => member.username === assignee.username)?.display_name} {...assignee} />{actual && <AssignmentActions assignment={actual} members={members} onChanged={() => assignmentsChanged(selectionIdentity)} />}</li>;
    })}</ul> : "Unassigned" },
  ];
  const renderVersion = (node: DocumentVersionNode): JSX.Element => {
    const version = node.variant;
    const doc = rows.find(row => row.document_id === version.document_id);
    const destination = destinationFor(version.case_id, version.document_id);
    const final = finalResults.state?.selections.find(selection => selection.case_id === version.case_id && selection.language === version.language && selection.document_id === version.document_id);
    return <li key={version.document_id}>
      <details className="document-version">
        <summary onKeyDown={disclosureKey}>v{version.version} · {originLabels[version.origin]}{(doc?.accepted_without_review || version.translation_status) && <span title={doc?.status_reason ?? undefined}> · {doc?.accepted_without_review ? 'Accepted without review' : version.translation_status ? translationStatusLabels[version.translation_status] : ''}</span>}
          <span className="cell-secondary"> · {version.external_id}</span>
        </summary>
        {doc ? <div className="document-version-body" data-testid="document-row">
          {final && <p><StatusBadge tone="success">Selected final result</StatusBadge>{' '}{final.submission_id}</p>}
          <div className="document-version-actions">
            <Checkbox id={`document-select-${encodeURIComponent(doc.document_id)}`} label={<span className="visually-hidden">Select {doc.document_id}</span>} checked={selected.has(doc.document_id)} onChange={() => toggle(doc.document_id)} />
            <a href={routeHref(destination)} aria-label={`View text ${doc.document_id}`} onClick={event => {
              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault(); onNavigate(destination);
            }}>View text</a>
            <SubmissionHistory projectKey={projectKey} documentId={doc.document_id} username={currentUser?.username ?? ''} selectionContext={{ caseId: version.case_id, language: version.language }} />
            <TranslationCorrectionAction projectKey={projectKey} variant={version} username={currentUser?.username ?? ''}
              requiredLanguages={reviewLanguages(version.document_id, new Map((cases?.find(item => item.case_id === version.case_id)?.variants ?? []).map(row => [row.document_id, row])))} />
            {doc.translation_status != null && <Button size="sm" onClick={() => setReviewDocument(doc.document_id)} aria-label={`Translation reviews for ${doc.document_id}`}>Translation reviews</Button>}
          </div>
          <div className="document-version-work"><h3>Assignments</h3>{columns.find(column => column.id === 'assignees')!.cell(doc)}</div>
          <details><summary>Text version details</summary><dl><dt>Document ID</dt><dd>{doc.document_id}</dd>
            {version.derived_from && <><dt>{version.origin === 'correction' ? 'Earlier text version' : 'Translation source'}</dt><dd>{cases?.find(item => item.case_id === version.case_id)?.variants.some(row => row.document_id === version.derived_from && row.case_id === version.case_id)
              ? <a href={routeHref(destinationFor(version.case_id, version.derived_from))} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(destinationFor(version.case_id, version.derived_from!)); }}>{version.derived_from}</a>
              : 'Unavailable'}</dd></>}
          </dl></details>
        </div> : <p className="cell-secondary">Earlier version outside current filters</p>}
        {node.issue && <p className="cell-secondary">{node.issue}</p>}
      </details>
      {!!node.children.length && <ul className="document-corrections">{node.children.map(renderVersion)}</ul>}
    </li>;
  };
  return <section>
    <h1>Documents</h1>
    <Toolbar label="Document filters" className="filter-bar">
      <Select id="documents-language" label="Language" value={query.language ?? ""} onChange={event => navigate({ language: event.target.value || undefined })}><option value="">All languages</option>{[...new Set([...(settings?.languages ?? []), ...rows.map(doc => doc.language), ...(query.language ? [query.language] : [])])].map(value => <option key={value} value={value}>{value}</option>)}</Select>
      <Select id="documents-status" label="Status" value={status ?? ""} onChange={event => navigate({ status: event.target.value || undefined })}><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{labelFor(assignmentStatusLabels, value)}</option>)}</Select>
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
    {finalResults.loading && <InlineMessage tone="info">Loading final selections…</InlineMessage>}
    {finalResults.error != null && <InlineMessage tone="warning">Final selections are unavailable. <Button size="sm" onClick={finalResults.reload}>Retry final selections</Button></InlineMessage>}
    {loading && <p role="status">Loading documents …</p>}
    {tree.length > 0 && <>
      <Checkbox id="documents-all" label="Select all visible" checked={rows.length > 0 && rows.every(doc => selected.has(doc.document_id))} onChange={event => setSelected(new Set(event.target.checked ? rows.map(doc => doc.document_id) : []))} />
      <div className="document-tree">{tree.map(item => <details key={item.caseId} className="logical-text" aria-label={`Text ${item.caseId}`} open>
        <summary onKeyDown={disclosureKey}>{item.caseId}</summary>
        {item.languages.map(language => {
          const final = finalResults.state?.selections.find(selection => selection.case_id === item.caseId && selection.language === language.language);
          const matching = rows.filter(row => row.case_id === item.caseId && row.language === language.language);
          const assignedCount = matching.filter(row => (row.assignees?.length ?? 0) > 0).length;
          return <details key={language.language} className="document-language" aria-label={`Language ${language.language} for ${item.caseId}`} open>
            <summary onKeyDown={disclosureKey}>{language.language} · {matching.length} text {matching.length === 1 ? 'version' : 'versions'}
              <span className="cell-secondary"> · {assignedCount ? `${assignedCount} assigned` : 'Unassigned'}</span>
              <span className="document-language-final">{final ? `Final result selected: ${final.document_id} · ${final.submission_id}` : finalResults.state ? 'No final result selected' : ''}</span>
            </summary>
            {final && !rows.some(row => row.document_id === final.document_id) && <p>Final result outside current filters: <a href={routeHref(destinationFor(item.caseId, final.document_id))}>{final.document_id}</a> · {final.submission_id}</p>}
            <ul className="document-version-list">{language.roots.map(renderVersion)}</ul>
          </details>;
        })}
      </details>)}</div>
    </>}
    {(tree.length === 0 || rows.some(row => !groupedIds.has(row.document_id))) && <DataTable label="Documents" columns={tree.length ? columns.filter(column => column.id !== 'select') : columns} rows={tree.length ? rows.filter(row => !groupedIds.has(row.document_id)) : rows} rowKey={doc => doc.document_id} rowProps={doc => ({ "data-testid": "document-row", selected: selected.has(doc.document_id) })} empty={<EmptyState title="No documents">Try another filter or upload documents to this project.</EmptyState>} />}
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
  return <Dialog open title={`Translation reviews: ${documentId}`} size="lg" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
    {error !== undefined && <ErrorNotice error={error} />}{records === null && error === undefined && <p role="status">Loading reviews …</p>}
    {records?.length === 0 && <p>No one has reviewed this translation yet.</p>}
    {records && <ol className="review-history">{records.map(record => <li key={record.id}>
      <p><strong>{labelFor(decisionLabels, record.decision)}</strong> by {record.reviewer_pseudonym} · <time dateTime={record.created_at}>{formatDateTime(record.created_at)}</time></p>
      <p className="cell-secondary">{[record.reviewer_qualification, record.reviewer_languages.length ? `reads ${record.reviewer_languages.join(", ")}` : ""].filter(Boolean).join(" · ")}</p>
      <p>{record.status_before === record.status_after ? `Translation status stayed ${labelFor(translationStatusLabels, record.status_after)}.` : `Translation status changed from ${labelFor(translationStatusLabels, record.status_before)} to ${labelFor(translationStatusLabels, record.status_after)}.`}</p>
      <p>{record.clinical_change ? "Clinical change" : "No clinical change"}{record.categories.length ? `: ${record.categories.map(category => labelFor(categoryLabels, category)).join(", ")}` : ""}</p>
      {record.rationale && <p>{record.rationale}</p>}{record.created_variant_id && <p>Created variant: {record.created_variant_id}</p>}
    </li>)}</ol>}
  </Dialog>;
}
