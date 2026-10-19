import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  api,
  type AssignmentView,
  type CaseSummary,
  type CurrentUser,
  type DocumentRowView,
  type DocumentRowsPage,
  type DocumentRowsQuery,
  type Member,
  type ProjectDocumentSummary,
  type ProjectSettings,
  type TranslationReviewRecord,
  type VariantSummary,
} from "../api/client";
import { formatDateTime, labelFor, plural } from "../app/labels";
import type { NavigateOptions, ProjectDocumentsQuery, Route } from "../app/router";
import { categoryLabels, decisionLabels } from "../translation/labels";
import { Button, Checkbox, Dialog, EmptyState, Select, TextInput, Toolbar, useMediaQuery } from "../ui";
import { DecisionBar } from "../documents/DecisionBar";
import { DocumentCards } from "../documents/DocumentCards";
import { DocumentsTable, groupName, initialExpandedGroups } from "../documents/DocumentsTable";
import { ExpandedRow } from "../documents/ExpandedRow";
import { RouteLink, rowKeyOf } from "../documents/RowCells";
import type { TextVersionsTools } from "../documents/TextVersions";
import { workText } from "../documents/labels";
import { useDocumentRows } from "../documents/useDocumentRows";
import { useRowSubmissions } from "../documents/useRowSubmissions";
import { AssignDialog } from "./AssignDialog";
import { DistributionDialog } from "./DistributionDialog";
import { ErrorNotice } from "./ErrorNotice";
import { UploadPanel } from "./UploadPanel";
import { originLabels, reviewLanguages, translationStatusLabels } from "./variantMetadata";

export interface DocumentsPageProps {
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route, options?: NavigateOptions) => void;
  /** Lead access (`ProjectSummary.can_manage`); checked before anything loads. */
  canManage: boolean;
  canOverrideTranslationStatus?: boolean;
  currentUser?: Pick<CurrentUser, "username" | "pseudonym">;
}

/** Narrow viewports render cards instead of the table. */
export const NARROW_DOCUMENTS_QUERY = "(max-width: 699px)";

export const STATUS_OPTIONS: readonly (readonly [NonNullable<DocumentRowsQuery["status"]>, string])[] = [
  ["unassigned", "Unassigned"], ["open", "Open"], ["in_progress", "In progress"],
  ["submitted", "Submitted"], ["reopened", "Reopened"], ["held", "Paused"],
];
const TRANSLATION_STATUS_OPTIONS: readonly (readonly [string, string])[] = [
  ...Object.entries(translationStatusLabels), ["accepted_without_review", "Accepted without review"],
];
const DECISIONS = new Set(["all", "report-or-pause", "confirm-final", "translation", "missing-final"]);
const DOCUMENT_FIELDS = ["language", "status", "q", "select", "origin", "translation_status", "case", "decision", "final", "page"] as const;
const SKELETON_HEADERS = ["Select", "Text · language", "Text version(s)", "Work", "Final result", "Issues", "Last activity"];

/** The Documents fields of a route (the page receives the whole route as `query`). */
function documentsQuery(query: ProjectDocumentsQuery): ProjectDocumentsQuery {
  const result: ProjectDocumentsQuery = {};
  for (const field of DOCUMENT_FIELDS) if (query[field] !== undefined && query[field] !== "") result[field] = query[field];
  if (query.open?.length) result.open = [...query.open];
  return result;
}

/** Server query for the rows endpoint; unknown values are dropped, `decision` wins over `final`. */
export function rowsQuery(query: ProjectDocumentsQuery): DocumentRowsQuery {
  const result: DocumentRowsQuery = {};
  if (query.language) result.language = query.language;
  if (STATUS_OPTIONS.some(([value]) => value === query.status)) result.status = query.status as DocumentRowsQuery["status"];
  if (query.q) result.q = query.q;
  if (query.origin && Object.hasOwn(originLabels, query.origin)) result.origin = query.origin as DocumentRowsQuery["origin"];
  if (TRANSLATION_STATUS_OPTIONS.some(([value]) => value === query.translation_status)) result.translation_status = query.translation_status as DocumentRowsQuery["translation_status"];
  if (query.decision && DECISIONS.has(query.decision)) result.decision = query.decision as DocumentRowsQuery["decision"];
  else if (query.final === "missing") result.final = "missing";
  if (query.case) result.case = query.case;
  const page = Number(query.page);
  if (Number.isInteger(page) && page > 1) result.page = page;
  return result;
}

const caseOfKey = (key: string): string => key.slice(0, Math.max(0, key.lastIndexOf(":")));

export function DocumentsPage(props: DocumentsPageProps): JSX.Element {
  if (!props.canManage) {
    return <section className="documents-page">
      <h1>Documents</h1>
      <EmptyState title="Documents is for project leads"
        action={<RouteLink route={{ name: "tasks" }} onNavigate={route => props.onNavigate(route)}>Go to My tasks</RouteLink>}>
        Your tasks for this project are under My tasks.
      </EmptyState>
    </section>;
  }
  return <LeadDocuments key={JSON.stringify([props.projectKey, props.currentUser?.username])} {...props} />;
}

function LeadDocuments({ projectKey, query: route, onNavigate, canOverrideTranslationStatus = false, currentUser }: DocumentsPageProps): JSX.Element {
  const ids = useId();
  const rootRef = useRef<HTMLElement>(null);
  const narrow = useMediaQuery(NARROW_DOCUMENTS_QUERY);
  const query = documentsQuery(route);
  const request = rowsQuery(query);
  const requestIdentity = JSON.stringify(request);
  const filterIdentity = JSON.stringify({ ...request, page: undefined, case: undefined });
  const rows = useDocumentRows(projectKey, request);
  const page: DocumentRowsPage | null = rows.page;

  const [announcement, setAnnouncement] = useState("");
  const announce = (message: string) => setAnnouncement(message);

  // Page data for upload and assignment tools (the rows endpoint does not carry it).
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [settingsError, setSettingsError] = useState<unknown>();
  const [inventory, setInventory] = useState<{ documents: ProjectDocumentSummary[]; cases: CaseSummary[]; assignments: AssignmentView[]; members: Member[] } | null>(null);
  const [inventoryError, setInventoryError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    void api.getProjectSettings(projectKey).then(value => { if (active) setSettings(value); }, failure => { if (active) setSettingsError(failure); });
    return () => { active = false; };
  }, [projectKey]);
  useEffect(() => {
    let active = true;
    setInventoryError(undefined);
    void Promise.all([api.listProjectDocuments(projectKey), api.listCases(projectKey), api.listAssignments(projectKey), api.listMembers(projectKey)])
      .then(([documents, cases, assignments, members]) => { if (active) setInventory({ documents, cases, assignments, members }); },
        failure => { if (active) setInventoryError(failure); });
    return () => { active = false; };
  }, [projectKey, revision]);

  // Announce the number of texts once the data for a changed filter arrives.
  const shownFilters = useRef<string | null>(null);
  useEffect(() => {
    if (!page) return;
    if (shownFilters.current !== null && shownFilters.current !== filterIdentity) announce(`${plural(page.group_count, "text")} shown`);
    shownFilters.current = filterIdentity;
    // Only a new page (never a query change alone) can carry the new count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Deep link `case` + `language`: that row is open until the lead collapses it.
  const deepKey = query.case && query.language ? `${query.case}:${query.language}` : null;
  const [collapsedDeepKey, setCollapsedDeepKey] = useState<string | null>(null);
  const openKeys = useMemo(() => {
    const keys = new Set(query.open ?? []);
    if (deepKey && collapsedDeepKey !== deepKey) keys.add(deepKey);
    return keys;
  }, [query.open, deepKey, collapsedDeepKey]);
  const viewQuery: ProjectDocumentsQuery = { ...query, ...(openKeys.size ? { open: [...openKeys] } : {}) };

  const documentsRoute = (patch: ProjectDocumentsQuery): Route => {
    const next: Route = { name: "projectDocuments", key: projectKey };
    for (const [name, value] of Object.entries({ ...query, ...patch })) {
      if (value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) Object.assign(next, { [name]: value });
    }
    return next;
  };
  const changeFilter = (patch: ProjectDocumentsQuery) => onNavigate(documentsRoute({ ...patch, page: undefined, select: undefined }));
  const toggleRow = (key: string) => {
    const next = new Set(openKeys);
    if (next.has(key)) {
      next.delete(key);
      if (key === deepKey) setCollapsedDeepKey(key);
    } else next.add(key);
    onNavigate(documentsRoute({ open: [...next] }), { replace: true });
  };

  // Group expansion: initial rule per filter set, then the lead's own toggles.
  const [groupState, setGroupState] = useState<{ identity: string; groups: ReadonlySet<string> } | null>(null);
  const expandedGroups = useMemo(() => {
    if (!page) return new Set<string>();
    if (groupState?.identity === requestIdentity) return groupState.groups;
    const initial = initialExpandedGroups(page);
    for (const key of openKeys) initial.add(caseOfKey(key));
    if (query.case) initial.add(query.case);
    return initial;
  }, [page, groupState, requestIdentity, openKeys, query.case]);
  const toggleGroup = (caseId: string) => {
    const next = new Set(expandedGroups);
    if (next.has(caseId)) next.delete(caseId); else next.add(caseId);
    setGroupState({ identity: requestIdentity, groups: next });
  };

  // Bulk selection of exact document IDs; a filter, category or page change starts over.
  const pageRows = useMemo(() => page?.groups.flatMap(group => group.rows) ?? [], [page]);
  const [selection, setSelection] = useState<{ identity: string; ids: ReadonlySet<string> } | null>(null);
  const preselected = useMemo(() => {
    const target = query.select;
    return new Set(target && pageRows.some(row => row.versions.some(version => version.document_id === target)) ? [target] : []);
  }, [query.select, pageRows]);
  const selected: ReadonlySet<string> = selection?.identity === requestIdentity ? selection.ids : preselected;
  const setSelected = (ids: ReadonlySet<string>) => setSelection({ identity: requestIdentity, ids });
  const toggleSelect = (documentId: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(documentId); else next.delete(documentId);
    setSelected(next);
  };
  const selectable = pageRows.filter(row => row.bulk.mode === "checkbox" && row.bulk.document_id != null);
  const skipped = pageRows.length - selectable.length;
  const allSelected = selectable.length > 0 && selectable.every(row => selected.has(row.bulk.document_id!));
  const selectAll = (checked: boolean) => {
    if (!checked) { setSelected(new Set()); announce("Selection cleared."); return; }
    setSelected(new Set([...selected, ...selectable.map(row => row.bulk.document_id!)]));
    announce(`Selected ${plural(selectable.length, "row")}.${skipped ? ` ${plural(skipped, "row")} ${skipped === 1 ? "needs" : "need"} a choice in Text versions.` : ""}`);
  };

  // Assignment dialogs work on the selected versions; a later filter change invalidates them.
  const [dialog, setDialog] = useState<{ kind: "manual" | "distribution"; documents: ProjectDocumentSummary[]; identity: string } | null>(null);
  const currentIdentity = useRef(requestIdentity);
  currentIdentity.current = requestIdentity;
  const visibleDialog = dialog?.identity === requestIdentity ? dialog : null;
  const selectedDocuments = inventory ? inventory.documents.filter(document => selected.has(document.document_id)) : [];
  const assignReasonId = `${ids}-assign-reason`;
  const assignReason = !selected.size ? "Select text versions first." : !inventory ? "Loading assignment data…" : null;
  const openDialog = (kind: "manual" | "distribution") => {
    if (assignReason) { announce(assignReason); return; }
    setDialog({ kind, documents: selectedDocuments, identity: requestIdentity });
  };
  const refreshAll = () => { rows.reload(); setRevision(value => value + 1); };
  const changedFor = (identity: string) => { if (currentIdentity.current === identity) refreshAll(); };

  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewDocument, setReviewDocument] = useState<string | null>(null);

  const textVersionTools = useMemo<TextVersionsTools | undefined>(() => {
    if (!inventory) return undefined;
    const variants = new Map<string, VariantSummary>(inventory.cases.flatMap(item => item.variants).map(variant => [variant.document_id, variant]));
    return {
      username: currentUser?.username ?? "",
      assignments: inventory.assignments,
      members: inventory.members,
      variants,
      requiredLanguages: documentId => reviewLanguages(documentId, variants),
      onAssignmentsChanged: refreshAll,
      onShowTranslationReviews: setReviewDocument,
      bulkSelected: selected,
      onToggleBulk: documentId => toggleSelect(documentId, !selected.has(documentId)),
    };
    // The callbacks close over the current selection; rebuild with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, currentUser?.username, selected, rows.reload, requestIdentity]);

  // Deep link: focus the named row header (or the group header) once its data is shown.
  const focusedDeepLink = useRef<string | null>(null);
  useEffect(() => {
    if (!page || !query.case || !page.case_found) return;
    const identity = JSON.stringify([query.case, query.language ?? null]);
    if (focusedDeepLink.current === identity) return;
    focusedDeepLink.current = identity;
    const group = page.groups.find(item => item.case_id === query.case);
    const labels = [
      ...(query.language ? [`Show submissions, ${query.case} · ${query.language}`] : []),
      ...(group ? [groupName(group)] : []),
    ];
    const buttons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])];
    const target = labels.map(label => buttons.find(button => button.getAttribute("aria-label") === label)).find(Boolean)
      ?? buttons.find(button => button.getAttribute("aria-label")?.startsWith(`Show submissions, ${query.case} · `));
    if (!target) return;
    target.scrollIntoView?.({ block: "center" });
    target.focus();
  }, [page, query.case, query.language]);

  const rowNotice = (row: DocumentRowView): string | null => {
    const named = row.pinned || rowKeyOf(row) === deepKey;
    if (!named) return null;
    if (query.decision && !row.matches_decision) return "This no longer needs your decision.";
    if (!query.decision && rowKeyOf(row) === deepKey && !row.final && !row.missing_final.counts) {
      return `No final result. Not counted as a decision yet: ${row.missing_final.reason === "work_open" ? `work still open: ${workText(row.work)}` : "no submission"}.`;
    }
    return null;
  };
  const renderExpanded = (row: DocumentRowView) => {
    const notice = rowNotice(row);
    return <>
      {notice && <p className="documents-row-notice">{notice}</p>}
      <ExpandedRowLoader row={row} refresh={page} projectKey={projectKey} query={viewQuery} onNavigate={route => onNavigate(route)}
        adjudicatorNotAnnotator={page?.adjudicator_not_annotator ?? false} onAnnounce={announce} textVersionTools={textVersionTools} />
    </>;
  };

  const languages = [...new Set([...(settings?.languages ?? []), ...pageRows.map(row => row.language), ...(query.language ? [query.language] : [])])];
  const status = STATUS_OPTIONS.some(([value]) => value === query.status) ? query.status! : "";
  const origin = query.origin && Object.hasOwn(originLabels, query.origin) ? query.origin : "";
  const translationStatus = TRANSLATION_STATUS_OPTIONS.some(([value]) => value === query.translation_status) ? query.translation_status! : "";
  const showAll: Route = { name: "projectDocuments", key: projectKey };
  const navigateLink = (target: Route) => onNavigate(target);

  let content: JSX.Element;
  if (!page && rows.error != null) {
    content = <div className="documents-error"><ErrorNotice error={rows.error} /><Button onClick={rows.retry}>Retry</Button></div>;
  } else if (!page) {
    content = <DocumentsSkeleton />;
  } else {
    let body: JSX.Element;
    if (query.case && !page.case_found) {
      body = <EmptyState title={`Text ${query.case} not found`} action={<RouteLink route={showAll} onNavigate={navigateLink}>Show all texts</RouteLink>} />;
    } else if (page.groups.length === 0 && request.decision) {
      body = <EmptyState title="Nothing needs your decision" action={<RouteLink route={showAll} onNavigate={navigateLink}>Show all texts</RouteLink>} />;
    } else if (page.groups.length === 0) {
      body = <EmptyState title="No documents">Try another filter or upload documents to this project.</EmptyState>;
    } else if (narrow) {
      body = <DocumentCards page={page} projectKey={projectKey} query={viewQuery} onToggleRow={toggleRow} selected={selected}
        onToggleSelect={toggleSelect} renderExpanded={renderExpanded} onNavigate={navigateLink} busy={rows.loading} />;
    } else {
      body = <DocumentsTable page={page} projectKey={projectKey} query={viewQuery} expandedGroups={expandedGroups} onToggleGroup={toggleGroup}
        onToggleRow={toggleRow} selected={selected} onToggleSelect={toggleSelect} renderExpanded={renderExpanded} onNavigate={navigateLink} busy={rows.loading} />;
    }
    content = <>
      <DecisionBar bar={page.bar} query={query} projectKey={projectKey} onNavigate={navigateLink} />
      {body}
      {page.page_count > 1 && <nav className="documents-paging" aria-label="Pages">
        {page.page > 1 && <RouteLink route={documentsRoute({ page: page.page - 1 > 1 ? String(page.page - 1) : undefined })} onNavigate={navigateLink}>Previous</RouteLink>}
        <span>Page {page.page} of {page.page_count}</span>
        {page.page < page.page_count && <RouteLink route={documentsRoute({ page: String(page.page + 1) })} onNavigate={navigateLink}>Next</RouteLink>}
      </nav>}
    </>;
  }

  return <section className="documents-page" ref={rootRef}>
    <h1>Documents</h1>
    <Toolbar label="Document filters" className="filter-bar documents-filters">
      <Select id="documents-language" label="Language" value={query.language ?? ""} onChange={event => changeFilter({ language: event.target.value || undefined })}>
        <option value="">All languages</option>{languages.map(value => <option key={value} value={value}>{value}</option>)}
      </Select>
      <Select id="documents-status" label="Status" value={status} onChange={event => changeFilter({ status: event.target.value || undefined })}>
        <option value="">All statuses</option>{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <TextInput id="documents-prefix" label="ID" value={query.q ?? ""} onChange={event => changeFilter({ q: event.target.value || undefined })} />
      <details className="documents-more-filters" open={origin !== "" || translationStatus !== "" ? true : undefined}>
        <summary>More filters</summary>
        <div className="documents-more-filters-body">
          <Select id="documents-origin" label="Origin" value={origin} onChange={event => changeFilter({ origin: event.target.value || undefined })}>
            <option value="">All origins</option>{Object.entries(originLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select id="documents-translation-status" label="Translation status" value={translationStatus} onChange={event => changeFilter({ translation_status: event.target.value || undefined })}>
            <option value="">All translation statuses</option>{TRANSLATION_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
      </details>
    </Toolbar>
    <Toolbar label="Document actions" className="documents-actions">
      <Checkbox id={`${ids}-select-all`} label="Select all" checked={allSelected} aria-disabled={selectable.length === 0 ? true : undefined}
        onChange={event => { if (selectable.length) selectAll(event.target.checked); }} />
      <span className="documents-selected-count">{selected.size} selected</span>
      <Button aria-disabled={settings ? undefined : true} onClick={() => { if (settings) setUploadOpen(true); }}>Upload documents</Button>
      <Button onClick={refreshAll}>Refresh</Button>
      <Button aria-disabled={assignReason ? true : undefined} aria-describedby={assignReason ? assignReasonId : undefined} onClick={() => openDialog("manual")}>Assign …</Button>
      <Button aria-disabled={assignReason ? true : undefined} aria-describedby={assignReason ? assignReasonId : undefined} onClick={() => openDialog("distribution")}>Propose distribution …</Button>
      {assignReason && <span id={assignReasonId} className="documents-action-reason">{assignReason}</span>}
    </Toolbar>
    {settingsError !== undefined && <ErrorNotice error={settingsError} />}
    {inventoryError !== undefined && <ErrorNotice error={inventoryError} />}
    {content}
    <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    <Dialog open={uploadOpen} title="Upload documents" size="lg" onClose={() => setUploadOpen(false)}>
      {uploadOpen && settings && <UploadPanel key={projectKey} projectKey={projectKey} languages={settings.languages ?? []} canOverrideTranslationStatus={canOverrideTranslationStatus} onImported={refreshAll} />}
    </Dialog>
    {reviewDocument !== null && <ReviewHistory key={reviewDocument} projectKey={projectKey} documentId={reviewDocument} onClose={() => setReviewDocument(null)} />}
    {visibleDialog?.kind === "manual" && <AssignDialog projectKey={projectKey} cases={inventory?.cases ?? null} documents={visibleDialog.documents} onClose={() => setDialog(null)} onChanged={() => changedFor(visibleDialog.identity)} />}
    {visibleDialog?.kind === "distribution" && <DistributionDialog projectKey={projectKey} cases={inventory?.cases ?? null} documents={visibleDialog.documents} onClose={() => setDialog(null)} onChanged={() => changedFor(visibleDialog.identity)} />}
  </section>;
}

/** Skeleton rows while the first page loads. */
function DocumentsSkeleton(): JSX.Element {
  return <div className="data-table-scroll">
    <table aria-label="Documents" aria-busy="true" className="data-table density-compact documents-table documents-skeleton">
      <thead><tr>{SKELETON_HEADERS.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
      <tbody>{[0, 1, 2, 3, 4].map(index => <tr key={index} className="documents-skeleton-row">
        {SKELETON_HEADERS.map(header => <td key={header}><span className="documents-skeleton-bar" aria-hidden="true" /></td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

interface ExpandedRowLoaderProps {
  row: DocumentRowView;
  /** The current rows page; a new page (refetch) reloads this row's submissions. */
  refresh: DocumentRowsPage | null;
  projectKey: string;
  query: ProjectDocumentsQuery;
  onNavigate: (route: Route) => void;
  adjudicatorNotAnnotator: boolean;
  onAnnounce: (message: string) => void;
  textVersionTools?: TextVersionsTools;
}

/** Loads the submissions of an open row and reloads them whenever the rows refresh. */
function ExpandedRowLoader({ row, refresh, projectKey, ...props }: ExpandedRowLoaderProps): JSX.Element {
  const submissions = useRowSubmissions(projectKey, row.case_id, row.language, true);
  const mounted = useRef(false);
  const { reload } = submissions;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    reload();
    // Only a new rows page triggers the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  return <ExpandedRow row={row} projectKey={projectKey} submissions={submissions} {...props} />;
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
