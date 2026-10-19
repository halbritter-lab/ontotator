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
  type RowSubmissions,
  type TranslationReviewRecord,
  type VariantSummary,
} from "../api/client";
import { formatDateTime, labelFor, plural } from "../app/labels";
import { routeHref, type NavigateOptions, type ProjectDocumentsQuery, type Route } from "../app/router";
import { categoryLabels, decisionLabels } from "../translation/labels";
import { Button, Checkbox, Dialog, EmptyState, Select, StatusBadge, TextInput, Toolbar, useMediaQuery } from "../ui";
import { DecisionBar } from "../documents/DecisionBar";
import { DocumentCards } from "../documents/DocumentCards";
import { DocumentsTable, groupName, initialExpandedGroups } from "../documents/DocumentsTable";
import { ExpandedRow, submissionsHeadingId, type ExpandedRowProps, type SelectFinalRequest } from "../documents/ExpandedRow";
import {
  barChanges, failureOf, FinalConfirm, keepRequest, selectionPayload, selectRequest, successMessage,
  type FinalConfirmFailure, type FinalConfirmRequest,
} from "../documents/FinalConfirm";
import { acknowledgeableItems, type KeepRequest } from "../documents/SelectionNotice";
import { RouteLink, rowKeyOf, rowName } from "../documents/RowCells";
import type { TextVersionsTools } from "../documents/TextVersions";
import { workText } from "../documents/labels";
import { useDocumentRows } from "../documents/useDocumentRows";
import { useRowSubmissions } from "../documents/useRowSubmissions";
import { clearVisits, recordDecision, rememberShown, retainedKeys, rowBadges, type RowBadge } from "../documents/visitState";
import { notifyFinalSelectionChanged } from "../variants/finalSelectionState";
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
const languageOfKey = (key: string): string => key.slice(key.lastIndexOf(":") + 1);
const nameOfKey = (key: string): string => `${caseOfKey(key)} · ${languageOfKey(key)}`;

/** The open final-result confirmation; `revision` and `causes` are the row's state at open. */
interface ConfirmState {
  request: FinalConfirmRequest;
  revision: number;
  causes: string;
  busy: boolean;
  failure: FinalConfirmFailure | null;
}

type FocusTarget = { kind: "selected" | "kept" | "row"; rowKey: string };

/** The row's acknowledgeable cause ids as a comparable set. */
const causeSet = (row: DocumentRowView): string => acknowledgeableItems(row).map(item => item.cause_id).sort().join("\n");

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
  // Visit state (Resolved / Changed badges) exists only under a decision filter; it is keyed by
  // the whole request, so a filter or page change starts a new visit.
  const decisionActive = request.decision !== undefined || request.final === "missing";
  const [retainState, setRetainState] = useState<{ identity: string; keys: readonly string[] } | null>(null);
  const retain = !decisionActive ? []
    : retainState?.identity === requestIdentity ? retainState.keys : retainedKeys(projectKey, requestIdentity);
  const rows = useDocumentRows(projectKey, retain.length ? { ...request, retain: [...retain] } : request);
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
  // Rows collapsed automatically because they became Resolved (until the lead opens them again
  // or the filter changes).
  const [autoCollapsedState, setAutoCollapsedState] = useState<{ identity: string; keys: ReadonlySet<string> } | null>(null);
  const autoCollapsed: ReadonlySet<string> = useMemo(
    () => (autoCollapsedState?.identity === requestIdentity ? autoCollapsedState.keys : new Set()), [autoCollapsedState, requestIdentity]);
  const setAutoCollapsed = (keys: ReadonlySet<string>) => setAutoCollapsedState({ identity: requestIdentity, keys });
  const openKeys = useMemo(() => {
    const keys = new Set(query.open ?? []);
    if (deepKey && collapsedDeepKey !== deepKey) keys.add(deepKey);
    for (const key of autoCollapsed) keys.delete(key);
    return keys;
  }, [query.open, deepKey, collapsedDeepKey, autoCollapsed]);
  const { open: _routeOpen, ...queryWithoutOpen } = query;
  const viewQuery: ProjectDocumentsQuery = { ...queryWithoutOpen, ...(openKeys.size ? { open: [...openKeys] } : {}) };

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
    } else {
      next.add(key);
      if (autoCollapsed.has(key)) setAutoCollapsed(new Set([...autoCollapsed].filter(item => item !== key)));
    }
    onNavigate(documentsRoute({ open: [...next] }), { replace: true });
  };

  // Visit state: a filter change clears the other visits of the project.
  useEffect(() => { clearVisits(projectKey, requestIdentity); }, [projectKey, requestIdentity]);

  // Remember the matching rows of each new page, retain them in later requests and badge the
  // remembered rows that stopped matching; Resolved rows collapse once.
  const [badgeState, setBadgeState] = useState<{ identity: string; badges: ReadonlyMap<string, RowBadge> } | null>(null);
  const badges: ReadonlyMap<string, RowBadge> = badgeState?.identity === requestIdentity ? badgeState.badges : new Map();
  useEffect(() => {
    if (!page || !decisionActive) return;
    const rowsShown = page.groups.flatMap(group => group.rows);
    rememberShown(projectKey, requestIdentity, rowsShown);
    const keys = retainedKeys(projectKey, requestIdentity);
    if (keys.some(key => !retain.includes(key))) setRetainState({ identity: requestIdentity, keys });
    const next = rowBadges(projectKey, requestIdentity, rowsShown);
    const resolvedBefore = new Set([...badges].filter(([, badge]) => badge.tone === "success").map(([key]) => key));
    const collapse = [...next].filter(([key, badge]) => badge.tone === "success" && !resolvedBefore.has(key) && openKeys.has(key)).map(([key]) => key);
    setBadgeState({ identity: requestIdentity, badges: next });
    if (collapse.length) {
      setAutoCollapsed(new Set([...autoCollapsed, ...collapse]));
      if (deepKey && collapse.includes(deepKey)) setCollapsedDeepKey(deepKey);
      onNavigate(documentsRoute({ open: [...openKeys].filter(key => !collapse.includes(key)) }), { replace: true });
    }
    // Only a new page carries new row states.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
  // Final-result confirmations: one per page, everything captured at open.
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const [success, setSuccess] = useState<{ text: string; next: string | null } | null>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const pendingSuccess = useRef<{ request: FinalConfirmRequest; before: DocumentRowsPage } | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  const rowDisclosure = (key: string) => [...(rootRef.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])]
    .find(button => button.getAttribute("aria-label") === `Show submissions, ${nameOfKey(key)}`);
  const restoreFocus = (request: FinalConfirmRequest) => (document.getElementById(request.triggerId) ?? rowDisclosure(request.rowKey))?.focus();
  const openConfirm = (request: FinalConfirmRequest, row: DocumentRowView) => {
    const current = confirmRef.current;
    if (current?.busy || current?.request.triggerId === request.triggerId) return;
    if (current) announce("Previous confirmation closed.");
    setSuccess(null);
    setConfirm({ request, revision: row.final?.revision ?? 0, causes: causeSet(row), busy: false, failure: null });
  };
  const cancelConfirm = () => {
    const current = confirmRef.current;
    if (!current || current.busy) return;
    restoreFocus(current.request);
    setConfirm(null);
  };
  const reviewAgain = () => {
    const current = confirmRef.current;
    if (!current) return;
    setConfirm(null);
    rows.reload();
    document.getElementById(submissionsHeadingId(current.request.caseId, current.request.language))?.focus();
  };
  const submitConfirm = () => {
    const current = confirmRef.current;
    if (!current || current.busy || !page) return;
    const { request } = current;
    const before = page;
    setConfirm({ ...current, busy: true, failure: null });
    api.selectFinalResult(projectKey, selectionPayload(request)).then(() => {
      notifyFinalSelectionChanged(projectKey);
      recordDecision(projectKey, request.rowKey);
      pendingSuccess.current = { request, before };
      setConfirm(value => (value?.request === request ? null : value));
      rows.reload();
    }, error => {
      setConfirm(value => (value?.request === request ? { ...value, busy: false, failure: failureOf(error) } : value));
    });
  };

  // A new rows page: report a pending success, and close the confirmation when its row's
  // selection revision or set of acknowledgeable causes changed (other refreshes keep it open).
  useEffect(() => {
    if (!page) return;
    const pending = pendingSuccess.current;
    if (pending && page !== pending.before) {
      pendingSuccess.current = null;
      const { request } = pending;
      const text = [successMessage(request), barChanges(pending.before.bar, page.bar)].filter(Boolean).join(" ");
      const next = query.decision ? pageRows.find(row => rowKeyOf(row) !== request.rowKey && row.matches_decision && row.categories.length > 0) : undefined;
      announce(next ? `${text} Next decision: ${rowName(next)}.` : text);
      setSuccess({ text, next: next ? rowKeyOf(next) : null });
      setFocusTarget({ kind: request.kind === "keep" ? "kept" : "selected", rowKey: request.rowKey });
    }
    const current = confirmRef.current;
    if (!current || current.busy || current.failure) return;
    const row = pageRows.find(item => rowKeyOf(item) === current.request.rowKey);
    if (row && (row.final?.revision ?? 0) === current.revision && causeSet(row) === current.causes) return;
    const inside = document.activeElement?.closest(".final-confirm") != null;
    setConfirm(null);
    if (!row) return;
    if (inside) restoreFocus(current.request);
    announce("The final result or its warnings changed. The confirmation was closed.");
    // Only a new page can change the confirmation's row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Focus after a success (new Final row's View link, or the Submissions heading after Keep) or "Next decision".
  useEffect(() => {
    if (!focusTarget) return;
    setFocusTarget(null);
    if (focusTarget.kind === "row") { rowDisclosure(focusTarget.rowKey)?.focus(); return; }
    const heading = document.getElementById(submissionsHeadingId(caseOfKey(focusTarget.rowKey), languageOfKey(focusTarget.rowKey)));
    const target = focusTarget.kind === "kept" ? heading
      : heading?.closest(".expanded-row")?.querySelector<HTMLElement>("tr.final-row a[aria-label^='View ']");
    (target ?? successRef.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget]);

  const nextDecisionRoute = (key: string) => documentsRoute({ open: [...new Set([...openKeys, key])] });
  const goToRow = (key: string) => {
    setGroupState({ identity: requestIdentity, groups: new Set([...expandedGroups, caseOfKey(key)]) });
    onNavigate(nextDecisionRoute(key), { replace: true });
    setFocusTarget({ kind: "row", rowKey: key });
  };

  const confirmElement = (state: ConfirmState) => <FinalConfirm key={state.request.triggerId} request={state.request} busy={state.busy}
    failure={state.failure} onConfirm={submitConfirm} onCancel={cancelConfirm} onReview={reviewAgain} />;

  const renderExpanded = (row: DocumentRowView) => {
    const notice = rowNotice(row);
    const own = confirm?.request.rowKey === rowKeyOf(row) ? confirm : null;
    return <>
      {notice && <p className="documents-row-notice">{notice}</p>}
      <ExpandedRowLoader row={row} refresh={page} projectKey={projectKey} query={viewQuery} onNavigate={route => onNavigate(route)}
        adjudicatorNotAnnotator={page?.adjudicator_not_annotator ?? false} onAnnounce={announce} textVersionTools={textVersionTools}
        onOpenConfirm={request => openConfirm(request, row)}
        renderConfirm={submission => (own && own.request.kind !== "keep" && own.request.submissionId === submission.submission_id ? confirmElement(own) : null)}
        keepConfirm={own?.request.kind === "keep" ? confirmElement(own) : undefined}
        confirmBusy={confirm?.busy ?? false} />
    </>;
  };

  const rowBadge = (row: DocumentRowView) => {
    const badge = badges.get(rowKeyOf(row));
    return badge && <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>;
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
        onToggleSelect={toggleSelect} renderExpanded={renderExpanded} rowBadge={rowBadge} onNavigate={navigateLink} busy={rows.loading} />;
    } else {
      body = <DocumentsTable page={page} projectKey={projectKey} query={viewQuery} expandedGroups={expandedGroups} onToggleGroup={toggleGroup}
        onToggleRow={toggleRow} selected={selected} onToggleSelect={toggleSelect} renderExpanded={renderExpanded} rowBadge={rowBadge} onNavigate={navigateLink} busy={rows.loading} />;
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
    {success && <div ref={successRef} tabIndex={-1} className="notice notice-success documents-success">
      <div className="notice-content">
        {success.text}
        {success.next && <> <a href={routeHref(nextDecisionRoute(success.next))} onClick={event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); goToRow(success.next!);
        }}>Next decision: {nameOfKey(success.next)}</a></>}
      </div>
    </div>}
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
  /** Opens a final-result confirmation built from this row and its loaded submissions. */
  onOpenConfirm: (request: FinalConfirmRequest) => void;
  renderConfirm: ExpandedRowProps["renderConfirm"];
  keepConfirm?: ExpandedRowProps["keepConfirm"];
  confirmBusy: boolean;
}

/** Loads the submissions of an open row and reloads them whenever the rows refresh. */
function ExpandedRowLoader({ row, refresh, projectKey, onOpenConfirm, ...props }: ExpandedRowLoaderProps): JSX.Element {
  const submissions = useRowSubmissions(projectKey, row.case_id, row.language, true);
  const mounted = useRef(false);
  const { reload } = submissions;
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    reload();
    // Only a new rows page triggers the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  const data: RowSubmissions | null = submissions.data;
  const onSelectFinal = (request: SelectFinalRequest) => onOpenConfirm(selectRequest(row, data, request.submission, request.triggerId));
  const onKeep = (request: KeepRequest) =>
    onOpenConfirm(keepRequest(row, data, request.causeIds, request.triggerId));
  return <ExpandedRow row={row} projectKey={projectKey} submissions={submissions} onSelectFinal={onSelectFinal} onKeep={onKeep} {...props} />;
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
